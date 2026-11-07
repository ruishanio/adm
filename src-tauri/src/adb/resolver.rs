use crate::models::{AdbSource, Result, Settings};
use std::path::{Path, PathBuf};

const BINARY: &str = if cfg!(windows) { "adb.exe" } else { "adb" };
pub(crate) const BUNDLED_MISSING: &str = "未找到内置 ADB，请重新安装 ADM 或切换到系统 ADB。";
pub(crate) const SYSTEM_MISSING: &str =
    "未找到系统 ADB，请选择文件或安装 Android SDK Platform-Tools。";
pub(crate) const CUSTOM_MISSING: &str = "所选 ADB 文件不可用，请重新选择或自动搜索。";

fn executable(path: &Path) -> bool {
    let Ok(meta) = path.metadata() else {
        return false;
    };
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if meta.permissions().mode() & 0o111 == 0 {
            return false;
        }
    }
    meta.is_file()
}

fn system_roots() -> Vec<PathBuf> {
    let mut roots = Vec::new();
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
    // Finder 启动的应用不一定继承终端的 PATH，补查 Homebrew 的标准安装位置。
    #[cfg(target_os = "macos")]
    roots.extend([
        PathBuf::from("/opt/homebrew/bin"),
        PathBuf::from("/usr/local/bin"),
    ]);
    roots
}

/// 按已选来源定位 ADB。内置与系统候选互斥；手选文件失效时保留选择，由用户决定是否重新搜索。
fn resolve(
    settings: &Settings,
    bundled: &[PathBuf],
    system: impl FnOnce() -> Vec<PathBuf>,
) -> Result<PathBuf> {
    if settings.adb_source == AdbSource::Bundled {
        return bundled
            .iter()
            .find(|p| executable(p))
            .cloned()
            .ok_or_else(|| BUNDLED_MISSING.into());
    }
    if !settings.adb_path.is_empty() {
        let path = PathBuf::from(&settings.adb_path);
        return executable(&path)
            .then_some(path)
            .ok_or_else(|| CUSTOM_MISSING.into());
    }
    let excluded: Vec<_> = bundled
        .iter()
        .filter_map(|p| p.canonicalize().ok())
        .collect();
    system()
        .into_iter()
        .filter(|p| p.is_absolute())
        .map(|p| p.join(BINARY))
        .find(|p| {
            executable(p)
                && p.canonicalize()
                    .is_ok_and(|candidate| !excluded.contains(&candidate))
        })
        .ok_or_else(|| SYSTEM_MISSING.into())
}

pub fn find_adb(settings: &Settings, resources: &Path) -> Result<PathBuf> {
    let bundled = [
        resources.join("platform-tools").join(BINARY),
        #[cfg(debug_assertions)]
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("resources/platform-tools")
            .join(BINARY),
    ];
    resolve(settings, &bundled, system_roots)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn switches_sources_without_cross_fallback() {
        let tmp = tempfile::tempdir().unwrap();
        let sys_dir = tmp.path().join("sdk");
        fs::create_dir(&sys_dir).unwrap();
        let bundled = tmp.path().join(BINARY);
        let sys = sys_dir.join(BINARY);
        for path in [&bundled, &sys] {
            fs::write(path, b"adb").unwrap();
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                fs::set_permissions(path, fs::Permissions::from_mode(0o755)).unwrap();
            }
        }
        let bundles = std::slice::from_ref(&bundled);
        let roots = || vec![tmp.path().to_owned(), sys_dir.clone()];
        let mut s = Settings {
            adb_path: sys.to_string_lossy().into_owned(),
            ..Settings::default()
        };
        assert_eq!(resolve(&s, bundles, roots).unwrap(), bundled);
        fs::remove_file(&bundled).unwrap();
        assert_eq!(resolve(&s, bundles, roots).unwrap_err(), BUNDLED_MISSING);
        fs::copy(&sys, &bundled).unwrap();
        s.adb_source = AdbSource::System;
        s.adb_path.clear();
        assert_eq!(resolve(&s, bundles, roots).unwrap(), sys);
        assert_eq!(
            resolve(&s, bundles, || vec![tmp.path().to_owned()]).unwrap_err(),
            SYSTEM_MISSING
        );
        s.adb_path = tmp
            .path()
            .join("removed-adb")
            .to_string_lossy()
            .into_owned();
        assert_eq!(resolve(&s, bundles, roots).unwrap_err(), CUSTOM_MISSING);
        s.adb_path = sys.to_string_lossy().into_owned();
        assert_eq!(resolve(&s, bundles, Vec::new).unwrap(), sys);
    }
}
