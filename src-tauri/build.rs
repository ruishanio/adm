fn main() {
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows")
        && std::env::var("CARGO_CFG_TARGET_ENV").as_deref() == Ok("msvc")
    {
        // 集成测试是独立 EXE，未继承 Tauri 主程序的清单；须显式加载 Common Controls v6。
        // 仅给测试目标嵌入清单，避免与主程序已有的资源清单重复。
        let manifest =
            std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/windows.manifest");
        println!("cargo:rerun-if-changed={}", manifest.display());
        println!("cargo:rustc-link-arg-tests=/MANIFEST:EMBED");
        println!(
            "cargo:rustc-link-arg-tests=/MANIFESTINPUT:{}",
            manifest.display()
        );
    }
    // 仅向本地主窗口授权业务命令，远程页面不具备调用本机功能的权限。
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&["adm_call", "adm_control_start"]),
    ))
    .expect("生成 Tauri 权限失败");
}
