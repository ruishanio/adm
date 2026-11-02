use crate::models::Result;
use std::path::{Path, PathBuf};
pub fn find_adb(configured: &str, resources: &Path) -> Result<PathBuf> {
    if !configured.is_empty() {
        let path = PathBuf::from(configured);
        return if path.is_file() {
            Ok(path)
        } else {
            Err("自定义 ADB 路径不存在，请在设置中重新选择。".into())
        };
    }
    let executable = if cfg!(windows) { "adb.exe" } else { "adb" };
    let mut roots = vec![
        resources.join("platform-tools"),
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources/platform-tools"),
    ];
    for key in ["ANDROID_SDK_ROOT", "ANDROID_HOME"] {
        if let Some(root) = std::env::var_os(key) {
            roots.push(PathBuf::from(root).join("platform-tools"));
        }
    }
    if cfg!(windows) {
        if let Some(root) = std::env::var_os("LOCALAPPDATA") {
            roots.push(PathBuf::from(root).join("Android/Sdk/platform-tools"));
        }
    } else if let Some(home) = dirs::home_dir() {
        roots.push(home.join("Library/Android/sdk/platform-tools"));
    }
    if let Some(paths) = std::env::var_os("PATH") {
        roots.extend(std::env::split_paths(&paths));
    }
    roots
        .into_iter()
        .map(|p| p.join(executable))
        .find(|p| p.is_file())
        .ok_or_else(|| "未找到 ADB，请在设置中选择 platform-tools 中的 ADB。".into())
}
