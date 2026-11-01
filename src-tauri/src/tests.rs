use crate::{adb::Adb, apk::*, models::*, parsing::*, process::*, settings::SettingsStore};
use std::{
    fs,
    io::Write,
    path::Path,
    sync::{atomic::Ordering, Arc, Mutex},
};
const ADMIN: &str = "com.example.app/com.example.app.Admin";
const MANIFEST: &[u8] = include_bytes!("../../tests/Fixtures/AndroidManifest.axml");
fn target() -> Target {
    Target {
        serial: "emulator-5570".into(),
        transport_id: "42".into(),
    }
}
fn apk() -> Apk {
    Apk {
        id: "fixture".into(),
        file_name: "test.apk".into(),
        package_name: "com.example.app".into(),
        version_name: "1.0".into(),
        version_code: "42".into(),
        minimum_sdk: "23".into(),
        size: 123,
        admins: vec![ADMIN.into()],
    }
}
struct FakeState {
    calls: Vec<Vec<String>>,
    owner: String,
    users: String,
    accounts: String,
    transport: String,
    version: String,
    pull_fail: bool,
    conflict: bool,
}
impl Default for FakeState {
    fn default() -> Self {
        Self {
            calls: vec![],
            owner: String::new(),
            users: "UserInfo{0:Owner:13}".into(),
            accounts: "Accounts: 0".into(),
            transport: "42".into(),
            version: "42".into(),
            pull_fail: false,
            conflict: false,
        }
    }
}
#[derive(Default)]
struct Fake(Mutex<FakeState>);
impl Runner for Fake {
    fn run(
        &self,
        _: &Path,
        args: &[String],
        _: &Cancel,
        _: u64,
        input: Option<&str>,
    ) -> Result<Output> {
        let mut s = self.0.lock().unwrap();
        s.calls.push(args.to_vec());
        let has = |value: &str| args.iter().any(|a| a == value);
        let out = if args[0] == "devices" {
            format!(
                "emulator-5570 device model:SDK transport_id:{}",
                s.transport
            )
        } else if has("device_policy") {
            format!(
                "Device Policy Manager state:\n{}",
                if s.owner.is_empty() {
                    String::new()
                } else {
                    format!(" Device Owner:\n admin=ComponentInfo{{{}}}", s.owner)
                }
            )
        } else if has("path") {
            "package:/data/app/test/base.apk".into()
        } else if has("query-receivers") {
            ADMIN.into()
        } else if has("users") {
            s.users.clone()
        } else if has("account") {
            s.accounts.clone()
        } else if has("set-device-owner") {
            s.owner = args.last().unwrap().clone();
            "Success: Device owner set".into()
        } else if has("install") {
            "Success\n".into()
        } else if has("package") {
            format!("versionCode={}", s.version)
        } else if args[0] == "connect" {
            "failed to connect".into()
        } else if args[0] == "pair" {
            assert_eq!(args, ["pair", "localhost:5555"]);
            assert_eq!(input, Some("123456"));
            "Successfully paired to localhost".into()
        } else if has("pull") {
            fs::write(args.last().unwrap(), "new").unwrap();
            if s.pull_fail {
                return Err("cancelled".into());
            }
            String::new()
        } else if has("sh") && s.conflict {
            return Ok(Output {
                stdout: String::new(),
                stderr: "同名文件已存在".into(),
                code: 1,
            });
        } else {
            String::new()
        };
        Ok(Output {
            stdout: out,
            stderr: String::new(),
            code: 0,
        })
    }
}
fn fake() -> (Adb, Arc<Fake>) {
    let runner = Arc::new(Fake::default());
    (
        Adb {
            executable: "adb".into(),
            runner: runner.clone(),
            cancel: cancellation(),
        },
        runner,
    )
}
#[test]
fn devices_keep_transport() {
    let list=parse_devices("List of devices attached\nemulator-5570 device model:Android_SDK transport_id:42\nabc unauthorized transport_id:43\n10.0.0.1:5555 offline transport_id:44\n* daemon started successfully");
    assert_eq!(list.len(), 3);
    assert_eq!(list[0].transport_id, "42");
    assert_eq!(list[1].state, "unauthorized");
    assert_eq!(list[2].state, "offline");
}
#[test]
fn endpoint_rejects_unsafe_input() {
    for value in [
        "x:0",
        "x:65536",
        "localabstract:adb",
        "host;touch:5555",
        "-x:5555",
        "host:abc",
    ] {
        assert!(endpoint(value).is_err(), "{value}");
    }
    assert_eq!(endpoint(" [::1]:5555 ").unwrap(), "[::1]:5555");
    assert_eq!(
        endpoint("android.local:37123").unwrap(),
        "android.local:37123"
    );
}
#[test]
fn components_and_shell_quoting() {
    assert_eq!(
        component("com.example.app/.Admin$Nested").unwrap(),
        "com.example.app/com.example.app.Admin$Nested"
    );
    assert_eq!(component("com.example.app/Admin").unwrap(), ADMIN);
    assert!(component("com.example.app/.Admin;reboot").is_err());
    assert_eq!(shell_arg("a b'c$d"), "'a b'\\''c$d'");
}
#[test]
fn unknown_owner_fails_closed() {
    assert_eq!(parse_owner("Device Policy Manager state:").unwrap(), None);
    assert_eq!(parse_owner("Device Policy Manager state:\n Device Owner:\n admin=ComponentInfo{com.example.app/.Admin}").unwrap().as_deref(),Some(ADMIN));
    assert!(parse_owner("permission denied").is_err());
    assert!(parse_owner("Device Policy Manager\n Device Owner: unknown").is_err());
}
#[test]
fn directory_protocol_keeps_complex_names() {
    let list = parse_files(
        "/sdcard",
        "ATF1\x0081a4 12 1730000000\0a 'b\n$.txt\x0041ed 4096 1730000001\0目录\0END\0",
    )
    .unwrap();
    assert_eq!(list[0].r#type, "directory");
    assert_eq!(list[1].name, "a 'b\n$.txt");
    assert_eq!(list[1].size, 12);
}
#[test]
fn directory_protocol_rejects_truncation() {
    for value in [
        "",
        "ATF1\0",
        "ATF1\0bad\0file\0END\0",
        "ATF1\x0081a4 1 0\0../oops\0END\0",
    ] {
        assert!(parse_files("/sdcard", value).is_err());
    }
}
#[test]
fn path_normalization_and_child_boundary() {
    assert_eq!(remote_path("/a/../../b//./c").unwrap(), "/b/c");
    assert!(remote_path("relative").is_err());
    assert!(child_path("/a", "../b").is_err());
    assert_eq!(child_path("/", ".hidden").unwrap(), "/.hidden");
}
#[test]
fn real_binary_manifest() {
    let info = parse_manifest(MANIFEST).unwrap();
    assert_eq!(info.package_name, "com.ruinext.androidtool.fixture");
    assert_eq!(info.version_code, "42");
    assert_eq!(info.version_name, "1.0");
    assert_eq!(info.minimum_sdk, "23");
    assert_eq!(
        info.admins,
        ["com.ruinext.androidtool.fixture/com.ruinext.androidtool.fixture.AdminReceiver"]
    );
}
#[test]
fn corrupt_manifest_rejected() {
    for offset in [0, 4, 8, 28] {
        let mut data = MANIFEST.to_vec();
        data[offset..offset + 4].fill(255);
        assert!(parse_manifest(&data).is_err(), "{offset}");
    }
    assert!(parse_manifest(b"<!DOCTYPE manifest SYSTEM 'file:///etc/passwd'>").is_err());
}
#[test]
fn zip_metadata_hash_and_invalid_package() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("fixture.apk");
    let mut writer = zip::ZipWriter::new(fs::File::create(&path).unwrap());
    writer
        .start_file(
            "AndroidManifest.xml",
            zip::write::SimpleFileOptions::default(),
        )
        .unwrap();
    writer.write_all(MANIFEST).unwrap();
    writer.finish().unwrap();
    let apk = read_apk(&path, &cancellation()).unwrap();
    assert_eq!(apk.info.file_name, "fixture.apk");
    assert_eq!(apk.hash.len(), 64);
    assert_eq!(apk.info.admins.len(), 1);
    fs::write(&path, "bad zip").unwrap();
    assert!(read_apk(&path, &cancellation()).is_err());
}
#[test]
fn stale_transport_never_installs() {
    let (adb, f) = fake();
    f.0.lock().unwrap().transport = "99".into();
    assert!(adb
        .install(&target(), &apk(), Path::new("test.apk"), false)
        .unwrap_err()
        .contains("重连"));
    assert!(!f
        .0
        .lock()
        .unwrap()
        .calls
        .iter()
        .any(|a| a.iter().any(|a| a == "install")));
}
#[test]
fn install_binds_transport_and_reads_version() {
    let (adb, f) = fake();
    adb.install(&target(), &apk(), Path::new("test.apk"), true)
        .unwrap();
    assert!(f
        .0
        .lock()
        .unwrap()
        .calls
        .iter()
        .any(|a| a == &["-t", "42", "install", "-r", "-t", "--user", "0", "test.apk"]));
    f.0.lock().unwrap().version = "41".into();
    assert!(adb
        .install(&target(), &apk(), Path::new("test.apk"), false)
        .unwrap_err()
        .contains("回读版本不一致"));
}
#[test]
fn zero_exit_failed_connect_rejected() {
    assert!(fake().0.connect("localhost:5555").is_err());
}
#[test]
fn pair_code_uses_stdin() {
    fake().0.pair("localhost:5555", "123456").unwrap();
    assert!(fake().0.pair("localhost:5555", "bad").is_err());
}
#[test]
fn owner_readback_is_idempotent() {
    let (adb, f) = fake();
    assert!(adb.check_owner(&target(), ADMIN).unwrap().can_set);
    adb.set_owner(&target(), ADMIN).unwrap();
    adb.set_owner(&target(), ADMIN).unwrap();
    assert_eq!(
        f.0.lock()
            .unwrap()
            .calls
            .iter()
            .filter(|a| a.iter().any(|a| a == "set-device-owner"))
            .count(),
        1
    );
}
#[test]
fn owner_barriers_block_execution() {
    for kind in 0..4 {
        let (adb, f) = fake();
        {
            let mut s = f.0.lock().unwrap();
            match kind {
                0 => s.accounts = "Accounts: 1".into(),
                1 => s.accounts = "unknown".into(),
                2 => s.users += "\nUserInfo{10:Work:1}",
                _ => s.owner = "com.other.app/.Admin".into(),
            }
        }
        assert!(adb.set_owner(&target(), ADMIN).is_err());
        assert!(!f
            .0
            .lock()
            .unwrap()
            .calls
            .iter()
            .any(|a| a.iter().any(|a| a == "set-device-owner")));
    }
}
#[test]
fn owner_rechecks_after_preflight() {
    let (adb, f) = fake();
    assert!(adb.check_owner(&target(), ADMIN).unwrap().can_set);
    f.0.lock().unwrap().accounts = "Accounts: 1".into();
    assert!(adb
        .set_owner(&target(), ADMIN)
        .unwrap_err()
        .contains("账号"));
}
#[test]
fn download_failure_preserves_existing_file() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("file.txt");
    fs::write(&path, "old").unwrap();
    let (adb, f) = fake();
    f.0.lock().unwrap().pull_fail = true;
    assert!(adb.download(&target(), "/sdcard/file.txt", &path).is_err());
    assert_eq!(fs::read_to_string(&path).unwrap(), "old");
    f.0.lock().unwrap().pull_fail = false;
    adb.download(&target(), "/sdcard/file.txt", &path).unwrap();
    assert_eq!(fs::read_to_string(&path).unwrap(), "new");
}
#[test]
fn upload_conflict_does_not_push() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("file.txt");
    fs::write(&path, "data").unwrap();
    let (adb, f) = fake();
    f.0.lock().unwrap().conflict = true;
    assert!(adb
        .upload(&target(), &path, "/sdcard")
        .unwrap_err()
        .contains("同名"));
    assert!(!f
        .0
        .lock()
        .unwrap()
        .calls
        .iter()
        .any(|a| a.iter().any(|a| a == "push")));
}
#[test]
fn migrates_legacy_preferences_without_modifying_source() {
    let dir = tempfile::tempdir().unwrap();
    let old = dir.path().join("legacy.json");
    let next = dir.path().join("next.json");
    let content = r#"{"AdbPath":"/sdk/adb","Endpoint":"localhost:5555","DeviceNames":{"serial":"工位一"},"HiddenDevices":["old"]}"#;
    fs::write(&old, content).unwrap();
    let mut store = SettingsStore::load(next.clone(), std::slice::from_ref(&old));
    assert_eq!(store.value.device_names["serial"], "工位一");
    assert_eq!(store.value.hidden_devices, ["old"]);
    let mut value = store.value.clone();
    value.sidebar_width = 300.;
    store.save(value).unwrap();
    assert_eq!(SettingsStore::load(next, &[]).value.sidebar_width, 300.);
    assert_eq!(fs::read_to_string(old).unwrap(), content);
}
fn node(script: &str, args: &[&str], cancel: &Cancel, timeout: u64) -> Result<Output> {
    let mut parameters = vec!["-e".into(), script.into()];
    parameters.extend(args.iter().map(|s| s.to_string()));
    NativeRunner.run(Path::new("node"), &parameters, cancel, timeout, None)
}
#[test]
fn local_arguments_never_expand_shell() {
    let value = "hello;$(touch /tmp/never-run) '$HOME'";
    assert_eq!(
        node(
            "process.stdout.write(process.argv[1])",
            &[value],
            &cancellation(),
            5000
        )
        .unwrap()
        .stdout,
        value
    );
}
#[test]
fn cancellation_stops_only_current_client() {
    let cancel = cancellation();
    let pending = cancel.clone();
    let handle = std::thread::spawn(move || node("setTimeout(()=>{},60000)", &[], &pending, 5000));
    std::thread::sleep(std::time::Duration::from_millis(100));
    cancel.store(true, Ordering::SeqCst);
    assert!(handle
        .join()
        .unwrap()
        .unwrap_err()
        .contains("设备上的操作可能继续"));
    assert!(node("console.log('ok')", &[], &cancellation(), 5000)
        .unwrap()
        .stdout
        .contains("ok"));
}
#[test]
fn timeout_and_output_limit() {
    assert!(node("setTimeout(()=>{},60000)", &[], &cancellation(), 25)
        .unwrap_err()
        .contains("超时"));
    assert!(node(
        "process.stdout.write('a'.repeat(17*1024*1024))",
        &[],
        &cancellation(),
        5000
    )
    .unwrap_err()
    .contains("输出过大"));
}
#[test]
fn ipc_target_rejects_injected_fields() {
    assert!(serde_json::from_value::<Target>(
        serde_json::json!({"serial":"x","transportId":"1","command":"reboot"})
    )
    .is_err());
}

#[test]
fn language_preferences_preserve_legacy_data_and_survive_reload() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("settings.json");
    fs::write(
        &path,
        r#"{"language":"unknown","DeviceNames":{"serial":"工位一"}}"#,
    )
    .unwrap();
    let mut store = SettingsStore::load(path.clone(), &[]);
    assert!(store.value.language.is_empty());
    assert_eq!(store.value.device_names["serial"], "工位一");
    let mut next = store.value.clone();
    next.language = "en".into();
    store.save(next).unwrap();
    let restored = SettingsStore::load(path, &[]);
    assert_eq!(restored.value.language, "en");
    assert_eq!(restored.value.device_names["serial"], "工位一");
}

#[test]
fn details_preserve_core_data_when_optional_sampling_fails() {
    let (adb, runner) = fake();
    runner.0.lock().unwrap().conflict = true;
    let info = adb.details(&target()).unwrap();
    assert!(info.owner.is_none());
    assert!(info.system.runtime.memory_total.is_none());
    let calls = &runner.0.lock().unwrap().calls;
    assert!(calls
        .iter()
        .filter(|a| a.contains(&"shell".into()))
        .all(|a| a[0] == "-t" && a[1] == "42"));
    assert_eq!(calls.iter().filter(|a| a[0] == "devices").count(), 2);
}

#[test]
fn details_do_not_swallow_cancellation() {
    let (adb, _) = fake();
    adb.cancel.store(true, Ordering::SeqCst);
    assert!(adb.details(&target()).unwrap_err().contains("停止等待"));
}
