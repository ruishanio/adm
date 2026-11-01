use crate::models::Result;
use std::{
    io::{Read, Write},
    path::Path,
    process::{Command, Stdio},
    sync::{
        atomic::{AtomicBool, AtomicUsize, Ordering},
        Arc,
    },
    thread,
    time::{Duration, Instant},
};
pub type Cancel = Arc<AtomicBool>;
pub fn cancellation() -> Cancel {
    Arc::new(AtomicBool::new(false))
}
pub fn check_cancel(cancel: &Cancel) -> Result<()> {
    if cancel.load(Ordering::SeqCst) {
        Err("已停止等待；设备上的操作可能继续，请刷新核对结果。".into())
    } else {
        Ok(())
    }
}
#[derive(Debug)]
pub struct Output {
    pub stdout: String,
    pub stderr: String,
    pub code: i32,
}
pub trait Runner: Send + Sync {
    fn run(
        &self,
        executable: &Path,
        args: &[String],
        cancel: &Cancel,
        timeout: u64,
        input: Option<&str>,
    ) -> Result<Output>;
}
pub struct NativeRunner;
fn collect(mut stream: impl Read, total: Arc<AtomicUsize>, overflow: Arc<AtomicBool>) -> Vec<u8> {
    let mut result = Vec::new();
    let mut buffer = [0; 8192];
    while let Ok(size) = stream.read(&mut buffer) {
        if size == 0 {
            break;
        }
        if total.fetch_add(size, Ordering::SeqCst) + size > 16 * 1024 * 1024 {
            overflow.store(true, Ordering::SeqCst);
            break;
        }
        result.extend_from_slice(&buffer[..size]);
    }
    result
}
impl Runner for NativeRunner {
    /// 使用参数数组启动 ADB。cancel/timeout 只终止本次客户端，返回退出码与有界输出，不关闭 ADB 服务。
    fn run(
        &self,
        executable: &Path,
        args: &[String],
        cancel: &Cancel,
        timeout: u64,
        input: Option<&str>,
    ) -> Result<Output> {
        check_cancel(cancel)?;
        let mut command = Command::new(executable);
        command
            .args(args)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            command.creation_flags(0x08000000);
        }
        let mut child = command.spawn().map_err(|e| format!("无法启动 ADB：{e}"))?;
        if let Some(mut stdin) = child.stdin.take() {
            if let Some(input) = input {
                let _ = writeln!(stdin, "{input}");
            }
        }
        let total = Arc::new(AtomicUsize::new(0));
        let overflow = Arc::new(AtomicBool::new(false));
        let out = child.stdout.take().ok_or("无法读取 ADB 输出")?;
        let err = child.stderr.take().ok_or("无法读取 ADB 错误")?;
        let (t, o) = (total.clone(), overflow.clone());
        let stdout = thread::spawn(move || collect(out, t, o));
        let (t, o) = (total.clone(), overflow.clone());
        let stderr = thread::spawn(move || collect(err, t, o));
        let start = Instant::now();
        let mut failure = None;
        let status = loop {
            if cancel.load(Ordering::SeqCst) {
                failure = Some("已停止等待；设备上的操作可能继续，请刷新核对结果。");
            } else if start.elapsed() > Duration::from_millis(timeout) {
                failure = Some("操作超时；设备端可能仍在处理，请刷新核对结果。");
            } else if overflow.load(Ordering::SeqCst) {
                failure = Some("设备输出过大，请缩小操作范围。");
            }
            if failure.is_some() {
                let _ = child.kill();
                break child.wait();
            }
            match child.try_wait() {
                Ok(Some(status)) => break Ok(status),
                Err(e) => {
                    let _ = child.kill();
                    let _ = child.wait();
                    break Err(e);
                }
                _ => thread::sleep(Duration::from_millis(25)),
            }
        };
        let stdout = stdout.join().map_err(|_| "读取设备输出失败")?;
        let stderr = stderr.join().map_err(|_| "读取设备错误失败")?;
        if let Some(error) = failure {
            return Err(error.into());
        }
        if overflow.load(Ordering::SeqCst) {
            return Err("设备输出过大，请缩小操作范围。".into());
        }
        check_cancel(cancel)?;
        Ok(Output {
            stdout: String::from_utf8_lossy(&stdout).into_owned(),
            stderr: String::from_utf8_lossy(&stderr).into_owned(),
            code: status.map_err(|e| e.to_string())?.code().unwrap_or(-1),
        })
    }
}
