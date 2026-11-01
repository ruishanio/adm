fn main() {
    // 仅向本地主窗口授权业务命令，远程页面不具备调用本机功能的权限。
    tauri_build::try_build(
        tauri_build::Attributes::new()
            .app_manifest(tauri_build::AppManifest::new().commands(&["adm_call"])),
    )
    .expect("生成 Tauri 权限失败");
}
