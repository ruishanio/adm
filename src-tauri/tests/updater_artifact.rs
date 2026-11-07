//! 使用生产公钥和真实分发包测试更新；只有测试进程使用临时目录和回环 HTTP。
use serde_json::{json, Value};
use std::{fs, time::Duration};
use tauri::test::{mock_builder, mock_context, noop_assets};
use tauri_plugin_updater::UpdaterExt;

#[test]
#[ignore = "需要当前平台已签名的最终更新包，通过 scripts/updater_ci.py test 执行"]
fn signed_package_from_feed() {
    let endpoint = std::env::var("ADM_TEST_FEED").unwrap();
    assert!(endpoint.starts_with("http://127.0.0.1:"));
    let temp = tempfile::tempdir().unwrap();
    let executable = temp.path().join("ADM.app/Contents/MacOS/adm");
    fs::create_dir_all(executable.parent().unwrap()).unwrap();
    fs::write(&executable, b"previous version").unwrap();
    let config: Value = serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
    let mut plugin = config["plugins"]["updater"].clone();
    plugin["endpoints"] = json!([endpoint]);
    plugin["dangerousInsecureTransportProtocol"] = json!(true);
    let mut ctx = mock_context(noop_assets());
    ctx.config_mut().plugins.0.insert("updater".into(), plugin);
    let app = mock_builder()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .build(ctx)
        .unwrap();
    let builder = app
        .updater_builder()
        .executable_path(&executable)
        .no_proxy()
        .timeout(Duration::from_secs(30));
    #[cfg(windows)]
    let builder = if let Ok(dir) = std::env::var("ADM_TEST_NSIS_DIR") {
        assert_eq!(std::env::var("GITHUB_ACTIONS").as_deref(), Ok("true"));
        assert!(std::path::Path::new(&dir).starts_with(std::env::var("RUNNER_TEMP").unwrap()));
        builder
            .installer_args(["/S".to_string(), format!("/D={dir}")])
            .restart_after_install(false)
    } else {
        builder
    };
    let updater = builder.build().unwrap();
    let update = tauri::async_runtime::block_on(updater.check())
        .unwrap()
        .unwrap();
    assert_eq!(update.version, env!("CARGO_PKG_VERSION"));
    let mut bytes = tauri::async_runtime::block_on(update.download(|_, _| {}, || {})).unwrap();
    bytes[0] ^= 1;
    assert!(update.verify(&bytes).is_err());
    bytes[0] ^= 1;
    let mut changed = update.raw_json.clone();
    changed["version"] = json!("999.0.0");
    assert!(updater
        .restore_update(changed)
        .unwrap()
        .unwrap()
        .verify(&bytes)
        .is_err());
    #[cfg(windows)]
    if std::env::var_os("ADM_TEST_NSIS_DIR").is_some() {
        // 安装器会接管并退出进程；父进程在临时 Runner 目录核对最终文件、版本及卸载结果。
        update.install(&bytes).unwrap();
    }
    #[cfg(target_os = "macos")]
    {
        use std::process::Command;
        // 实际替换隔离目录下的旧 app，然后从更新后的二进制读取版本和内置资源。
        update.install(&bytes).unwrap();
        let report = temp.path().join("self-check.json");
        assert!(Command::new(&executable)
            .arg("--adm-self-check")
            .arg(&report)
            .status()
            .unwrap()
            .success());
        let result: Value = serde_json::from_slice(&fs::read(report).unwrap()).unwrap();
        assert_eq!(result["version"], update.version);
        if std::env::var("ADM_REQUIRE_NOTARIZATION").as_deref() == Ok("true") {
            for (cmd, args) in [
                ("codesign", vec!["--verify", "--deep", "--strict"]),
                ("xcrun", vec!["stapler", "validate"]),
                ("spctl", vec!["--assess", "--type", "execute"]),
            ] {
                assert!(Command::new(cmd)
                    .args(args)
                    .arg(temp.path().join("ADM.app"))
                    .status()
                    .unwrap()
                    .success());
            }
        }
    }
}
