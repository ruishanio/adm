use super::*;
use crate::adb::process::cancellation;

#[test]
fn mp4_contains_avc_samples_with_normalized_timestamps() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("test.mp4");
    let config = [
        0, 0, 0, 1, 0x67, 0x42, 0xc0, 0x1f, 0xda, 0x02, 0x80, 0x2d, 0xd0, 0x80, 0x80, 0xa0, 0, 0,
        0, 1, 0x68, 0xce, 0x3c, 0x80,
    ];
    let mut recording = Recording::new(&path, (640, 360), &config).unwrap();
    recording
        .packet(100_000, false, &[0, 0, 1, 0x41, 1])
        .unwrap();
    recording
        .packet(200_000, true, &[0, 0, 1, 0x65, 1])
        .unwrap();
    recording
        .packet(250_000, false, &[0, 0, 1, 0x41, 2])
        .unwrap();
    recording.finish().unwrap();
    let size = std::fs::metadata(&path).unwrap().len();
    let mut reader = mp4::Mp4Reader::read_header(std::fs::File::open(path).unwrap(), size).unwrap();
    let track = &reader.tracks()[&1];
    assert_eq!(track.width(), 640);
    assert_eq!(track.height(), 360);
    assert_eq!(track.sample_count(), 2);
    let first = reader.read_sample(1, 1).unwrap().unwrap();
    assert_eq!(first.start_time, 0);
    assert_eq!(first.duration, 50_000);
    assert!(first.is_sync);
    assert_eq!(&first.bytes[..], &[0, 0, 0, 2, 0x65, 1]);
}

/// 显式选择专用模拟器，检查实际码流、MP4、PNG、旋转和会话清理；不执行重启/关机。
#[test]
#[ignore = "需要 ADM_CONTROL_SERIAL，普通模拟器只读采集，旋转仅允许 AndroidToolSmoke_ 专用模拟器"]
fn dedicated_control_stream_recording_and_rotation() {
    let serial = std::env::var("ADM_CONTROL_SERIAL").unwrap();
    assert!(serial.starts_with("emulator-"));
    let root = Path::new(env!("CARGO_MANIFEST_DIR"));
    let resources = root.join("resources");
    let adb = Adb::new(
        resources
            .join("platform-tools")
            .join(if cfg!(windows) { "adb.exe" } else { "adb" }),
        cancellation(),
    );
    let dedicated = adb
        .simple(&["-s", &serial, "emu", "avd", "name"])
        .unwrap()
        .starts_with("AndroidToolSmoke_");
    let device = adb
        .devices()
        .unwrap()
        .into_iter()
        .find(|d| d.serial == serial && d.state == "device")
        .unwrap();
    let target = Target {
        serial,
        transport_id: device.transport_id,
    };
    let before = adb.simple(&["forward", "--list"]).unwrap();
    let (tx, rx) = std::sync::mpsc::sync_channel(8);
    let channel = Channel::new(move |response| {
        if let tauri::ipc::InvokeResponseBody::Raw(data) = response {
            let _ = tx.try_send(data);
        }
        Ok(())
    });
    let control = Control::default();
    let id = control
        .start(adb, target, &resources, 1080, channel)
        .unwrap();
    let session = control.get(&id).unwrap();
    let packet = rx
        .recv_timeout(Duration::from_secs(10))
        .unwrap_or_else(|e| panic!("首帧失败：{e}，{}", session.snapshot().error));
    assert!(packet.len() > 32);
    session.acknowledge(u64::from_be_bytes(packet[..8].try_into().unwrap()));
    let size = (session.snapshot().width, session.snapshot().height);
    assert!(size.0 > 0 && size.1 > 0);
    let directory = root.parent().unwrap().join("artifacts/control-native");
    std::fs::create_dir_all(&directory).unwrap();
    session.record(&directory.join("device.mp4")).unwrap();
    let deadline = Instant::now() + Duration::from_secs(3);
    while Instant::now() < deadline {
        if let Ok(packet) = rx.recv_timeout(Duration::from_millis(300)) {
            session.acknowledge(u64::from_be_bytes(packet[..8].try_into().unwrap()));
        }
    }
    let status = session.stop_recording();
    assert!(!status.recording);
    assert!(
        status.recording_notice.contains("录像已保存"),
        "{}",
        status.recording_notice
    );
    session.screenshot(&directory.join("device.png")).unwrap();
    let path = directory.join("device.mp4");
    let length = std::fs::metadata(&path).unwrap().len();
    let reader = mp4::Mp4Reader::read_header(std::fs::File::open(path).unwrap(), length).unwrap();
    assert!(reader.tracks()[&1].sample_count() >= 1);
    if dedicated {
        session.input(protocol::Input::Rotate).unwrap();
    }
    let deadline = Instant::now() + Duration::from_secs(5);
    let mut rotated = false;
    while dedicated && Instant::now() < deadline {
        if let Ok(packet) = rx.recv_timeout(Duration::from_millis(200)) {
            session.acknowledge(u64::from_be_bytes(packet[..8].try_into().unwrap()));
        }
        let s = session.snapshot();
        if (s.width, s.height) == (size.1, size.0) {
            rotated = true;
            break;
        }
    }
    if dedicated {
        session.input(protocol::Input::Rotate).unwrap();
    }
    control.stop(&id);
    assert!(control.get(&id).is_err());
    assert_eq!(session.adb.simple(&["forward", "--list"]).unwrap(), before);
    assert!(!dedicated || rotated, "旋转后未收到横竖互换的画面尺寸");
    println!(
        "真实控制验收通过：{}x{}，MP4 {} bytes，PNG、端口清理",
        size.0, size.1, length
    );
}

/// 对显式指定的故障设备验收：首个真实软编码关键帧、录像重置和同一 transport 二次连接。
#[test]
#[ignore = "需要 ADM_CONTROL_COMPAT_SERIAL 指向已知系统编码器故障的 Android x86_64 测试机"]
fn real_encoder_crash_falls_back_and_reconnects() {
    let serial = std::env::var("ADM_CONTROL_COMPAT_SERIAL").unwrap();
    let resources = Path::new(env!("CARGO_MANIFEST_DIR")).join("resources");
    let control = Control::default();
    for attempt in 0..2 {
        let adb = Adb::new(
            resources
                .join("platform-tools")
                .join(if cfg!(windows) { "adb.exe" } else { "adb" }),
            cancellation(),
        );
        let device = adb
            .devices()
            .unwrap()
            .into_iter()
            .find(|d| d.serial == serial && d.state == "device")
            .unwrap();
        let target = Target {
            serial: serial.clone(),
            transport_id: device.transport_id,
        };
        let (tx, rx) = std::sync::mpsc::channel();
        let channel = Channel::new(move |response| {
            if let tauri::ipc::InvokeResponseBody::Raw(packet) = response {
                let _ = tx.send(packet);
            }
            Ok(())
        });
        let pid = |adb: &Adb| {
            adb.simple(&[
                "-s",
                &serial,
                "shell",
                "getprop",
                "init.svc_debug_pid.media.swcodec",
            ])
            .unwrap()
        };
        let before = pid(&adb);
        let id = control
            .start(adb, target, &resources, 1600, channel)
            .unwrap();
        let session = control.get(&id).unwrap();
        let packet = rx.recv_timeout(Duration::from_secs(10)).unwrap();
        let status = session.snapshot();
        assert!(status.compatibility && status.running && status.width.max(status.height) <= 1280);
        let config = u32::from_be_bytes(packet[28..32].try_into().unwrap()) as usize;
        assert!(
            config > 0
                && protocol::nals(&packet[32 + config..])
                    .iter()
                    .any(|nal| nal[0] & 31 == 5)
        );
        session.acknowledge(u64::from_be_bytes(packet[..8].try_into().unwrap()));
        if attempt == 1 {
            assert!(!before.trim().is_empty());
            assert_eq!(
                before,
                pid(&session.adb),
                "同一连接再次打开投屏不应重新触发系统编码器崩溃"
            );
        }
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("compat.mp4");
        session.record(&path).unwrap();
        let until = Instant::now() + Duration::from_secs(4);
        while Instant::now() < until {
            if let Ok(packet) = rx.recv_timeout(Duration::from_millis(200)) {
                session.acknowledge(u64::from_be_bytes(packet[..8].try_into().unwrap()));
            }
        }
        assert!(session
            .stop_recording()
            .recording_notice
            .contains("录像已保存"));
        let file = std::fs::File::open(path).unwrap();
        let len = file.metadata().unwrap().len();
        let mp4 = mp4::Mp4Reader::read_header(file, len).unwrap();
        assert!(mp4.tracks()[&1].sample_count() > 0);
        control.stop(&id);
    }
}
