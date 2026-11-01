//! 显式启用的专用模拟器验收，不参与 CI，也不允许对物理或业务设备执行写入。
use crate::{adb::Adb, apk::read_apk, models::Target, process::cancellation};
use std::{fs, path::PathBuf};
#[test]
#[ignore = "需要 ADM_SMOKE_SERIAL 与 ADM_SMOKE_APK，仅允许 AndroidToolSmoke_ 专用模拟器"]
fn dedicated_emulator() {
    let serial = std::env::var("ADM_SMOKE_SERIAL").expect("缺少专用模拟器序列号");
    assert!(serial.starts_with("emulator-"));
    let path = PathBuf::from(std::env::var("ADM_SMOKE_APK").expect("缺少测试 APK"));
    let adb = Adb::new(
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("resources/platform-tools")
            .join(if cfg!(windows) { "adb.exe" } else { "adb" }),
        cancellation(),
    );
    assert!(adb
        .simple(&["-s", &serial, "emu", "avd", "name"])
        .unwrap()
        .starts_with("AndroidToolSmoke_"));
    let apk = read_apk(&path, &cancellation()).unwrap();
    assert_eq!(apk.info.package_name, "com.ruinext.androidtool.fixture");
    assert_eq!(apk.info.admins.len(), 1);
    let device = adb
        .devices()
        .unwrap()
        .into_iter()
        .find(|d| d.serial == serial && d.state == "device")
        .expect("模拟器未就绪");
    let target = Target {
        serial: device.serial,
        transport_id: device.transport_id,
    };
    assert!(
        adb.details(&target).unwrap().owner.is_none(),
        "已有所有者，拒绝更改"
    );
    assert!(
        !adb.shell(&target, &["pm", "list", "packages", &apk.info.package_name])
            .unwrap()
            .contains(&apk.info.package_name),
        "夹具已存在，拒绝覆盖"
    );
    let directory = format!(".adm-tauri-test-{}", uuid::Uuid::new_v4());
    let remote = format!("/sdcard/{directory}");
    let local = tempfile::tempdir().unwrap();
    let endpoint = format!(
        "127.0.0.1:{}",
        serial
            .strip_prefix("emulator-")
            .unwrap()
            .parse::<u16>()
            .unwrap()
            + 1
    );
    let had_network = adb.devices().unwrap().iter().any(|d| d.serial == endpoint);
    // 无论断言是否成功都清理本次夹具；只有通过上面的无既存状态检查才进入此范围。
    let outcome = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        adb.install(&target, &apk.info, &apk.path, true).unwrap();
        assert!(
            adb.check_owner(&target, &apk.info.admins[0])
                .unwrap()
                .can_set
        );
        adb.set_owner(&target, &apk.info.admins[0]).unwrap();
        adb.set_owner(&target, &apk.info.admins[0]).unwrap();
        assert_eq!(
            adb.details(&target).unwrap().owner.as_deref(),
            Some(apk.info.admins[0].as_str())
        );
        println!("通过：APK 安装与版本回读；所有者检查、设置、回读与幂等");
        adb.connect(&endpoint).unwrap();
        let network = adb
            .devices()
            .unwrap()
            .into_iter()
            .find(|d| d.serial == endpoint)
            .unwrap();
        adb.install(
            &Target {
                serial: network.serial,
                transport_id: network.transport_id,
            },
            &apk.info,
            &apk.path,
            true,
        )
        .unwrap();
        println!("通过：回环 TCP 连接与覆盖安装");
        adb.mkdir(&target, "/sdcard", &directory).unwrap();
        let name = "中文 ' $ file.txt";
        let source = local.path().join(name);
        let dest = local.path().join("downloaded.txt");
        let content = "Tauri + Vue + TypeScript\n中文文件传输\n";
        fs::write(&source, content).unwrap();
        adb.upload(&target, &source, &remote).unwrap();
        assert_eq!(adb.list_files(&target, &remote).unwrap()[0].name, name);
        assert!(adb
            .upload(&target, &source, &remote)
            .unwrap_err()
            .contains("同名"));
        adb.download(&target, &format!("{remote}/{name}"), &dest)
            .unwrap();
        assert_eq!(fs::read_to_string(dest).unwrap(), content);
        println!("通过：目录创建、特殊文件名上传、同名保护、下载内容比对");
    }));
    let directory_cleanup = adb.shell(&target, &["rm", "-rf", &remote]);
    let admin_cleanup = adb.shell(
        &target,
        &["dpm", "remove-active-admin", &apk.info.admins[0]],
    );
    let package_cleanup = adb.simple(&["-s", &serial, "uninstall", &apk.info.package_name]);
    let network_cleanup = if !had_network {
        adb.simple(&["disconnect", &endpoint])
    } else {
        Ok(String::new())
    };
    directory_cleanup.unwrap();
    admin_cleanup.unwrap();
    package_cleanup.unwrap();
    network_cleanup.unwrap();
    assert!(adb.details(&target).unwrap().owner.is_none());
    assert!(!adb
        .shell(&target, &["pm", "list", "packages", &apk.info.package_name])
        .unwrap()
        .contains(&apk.info.package_name));
    println!("通过：本次所有者、安装包、随机目录和临时 TCP 连接均已清理");
    if let Err(error) = outcome {
        std::panic::resume_unwind(error);
    }
}

/// 仅验证本次新文件能力，在专用模拟器的随机目录内执行，不安装 APK 或更改所有者。
#[test]
#[ignore = "需要 ADM_SMOKE_SERIAL，仅允许 AndroidToolSmoke_ 专用模拟器"]
fn dedicated_file_operations() {
    let serial = std::env::var("ADM_SMOKE_SERIAL").expect("缺少专用模拟器序列号");
    assert!(serial.starts_with("emulator-"));
    let adb = Adb::new(
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("resources/platform-tools")
            .join(if cfg!(windows) { "adb.exe" } else { "adb" }),
        cancellation(),
    );
    assert!(adb
        .simple(&["-s", &serial, "emu", "avd", "name"])
        .unwrap()
        .starts_with("AndroidToolSmoke_"));
    let device = adb
        .devices()
        .unwrap()
        .into_iter()
        .find(|d| d.serial == serial && d.state == "device")
        .unwrap();
    let target = Target {
        serial: device.serial,
        transport_id: device.transport_id,
    };
    let directory = format!(".adm-files-test-{}", uuid::Uuid::new_v4());
    let remote = format!("/sdcard/{directory}");
    let local = tempfile::tempdir().unwrap();
    let folder = local.path().join("中文 ' $ 文件夹");
    fs::create_dir_all(folder.join("nested/empty")).unwrap();
    fs::write(folder.join(".hidden"), "hidden").unwrap();
    fs::write(folder.join("nested/内容.txt"), "ADM folder content").unwrap();
    adb.mkdir(&target, "/sdcard", &directory).unwrap();
    let outcome = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        adb.upload(&target, &folder, &remote).unwrap();
        let empty = local.path().join("empty-root");
        fs::create_dir(&empty).unwrap();
        adb.upload(&target, &empty, &remote).unwrap();
        assert!(adb
            .list_files(&target, &format!("{remote}/empty-root"))
            .unwrap()
            .is_empty());
        adb.delete_file(&target, &remote, "empty-root", true)
            .unwrap();
        let folder_name = folder.file_name().unwrap().to_str().unwrap();
        let child = format!("{remote}/{folder_name}");
        assert!(adb
            .list_files(&target, &format!("{child}/nested"))
            .unwrap()
            .iter()
            .any(|f| f.name == "empty" && f.r#type == "directory"));
        let downloaded = local.path().join("download.txt");
        adb.download(&target, &format!("{child}/nested/内容.txt"), &downloaded)
            .unwrap();
        assert_eq!(
            fs::read_to_string(&downloaded).unwrap(),
            "ADM folder content"
        );
        assert!(adb
            .upload(&target, &folder, &remote)
            .unwrap_err()
            .contains("同名"));
        adb.rename_file(&target, &remote, folder_name, "改名 文件夹")
            .unwrap();
        let renamed = format!("{remote}/改名 文件夹");
        adb.rename_file(
            &target,
            &format!("{renamed}/nested"),
            "内容.txt",
            "内容 ' $.txt",
        )
        .unwrap();
        let entries = adb
            .list_files(&target, &format!("{renamed}/nested"))
            .unwrap();
        assert!(entries.iter().any(|f| f.name == "内容 ' $.txt"));
        assert!(adb
            .rename_file(
                &target,
                &format!("{renamed}/nested"),
                "内容 ' $.txt",
                "empty"
            )
            .unwrap_err()
            .contains("同名"));
        assert!(adb
            .delete_file(&target, &remote, "改名 文件夹", false)
            .is_err());
        adb.delete_file(&target, &format!("{renamed}/nested"), "内容 ' $.txt", true)
            .unwrap();
        adb.delete_file(&target, &remote, "改名 文件夹", true)
            .unwrap();
        assert!(adb.list_files(&target, &remote).unwrap().is_empty());
        println!("通过：目录上传、空目录、隐藏项、中文及特殊名称、下载比对、同名保护、文件/目录重命名、确认删除和清理");
    }));
    adb.shell(&target, &["rm", "-rf", &remote]).unwrap();
    if let Err(error) = outcome {
        std::panic::resume_unwind(error);
    }
}
