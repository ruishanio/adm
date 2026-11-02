use crate::models::Result;
use std::{path::Path, process::Command};

/// 用系统文本应用打开随包声明；仅接受后端资源目录，不允许前端指定路径或命令。
pub fn open_notices(resources: &Path) -> Result<()> {
    let path = resources.join("legal/THIRD-PARTY-NOTICES.txt");
    // 开发运行可读取仓库内的同一文件；发行版只能使用安装目录中的声明。
    #[cfg(debug_assertions)]
    let path = if path.is_file() {
        path
    } else {
        Path::new(env!("CARGO_MANIFEST_DIR")).join("../legal/THIRD-PARTY-NOTICES.txt")
    };
    if !path.is_file() {
        return Err("未找到随应用附带的第三方声明文件。".into());
    }
    #[cfg(target_os = "macos")]
    {
        let status = Command::new("/usr/bin/open")
            .arg("-t")
            .arg(&path)
            .status()
            .map_err(|e| format!("无法打开第三方声明：{e}"))?;
        if !status.success() {
            return Err("无法打开第三方声明，请检查默认文本应用。".into());
        }
        Ok(())
    }
    #[cfg(target_os = "windows")]
    {
        let system = std::env::var_os("SystemRoot").ok_or("无法定位系统文本应用。")?;
        // 直接启动记事本，不经 shell 或文件关联；不等待用户关闭阅读窗口。
        let mut child = Command::new(Path::new(&system).join("System32/notepad.exe"))
            .arg(&path)
            .spawn()
            .map_err(|e| format!("无法打开第三方声明：{e}"))?;
        std::thread::spawn(move || {
            let _ = child.wait();
        });
        Ok(())
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    Err("当前平台不支持打开声明文件。".into())
}
