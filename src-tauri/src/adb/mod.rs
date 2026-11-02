//! ADB 传输、目标会话校验与进程执行；不依赖桌面命令或具体业务模块。
pub(crate) mod child_process;
pub(crate) mod process;
mod resolver;
use crate::{models::*, parsing::*};
use process::{Cancel, NativeRunner, Runner};
pub(crate) use resolver::find_adb;
use std::{path::PathBuf, sync::Arc};
pub struct Adb {
    pub executable: PathBuf,
    pub runner: Arc<dyn Runner>,
    pub cancel: Cancel,
}
impl Adb {
    pub fn new(executable: PathBuf, cancel: Cancel) -> Self {
        Self {
            executable,
            runner: Arc::new(NativeRunner),
            cancel,
        }
    }
    pub fn cmd(&self, args: Vec<String>, timeout: u64, input: Option<&str>) -> Result<String> {
        let output = self
            .runner
            .run(&self.executable, &args, &self.cancel, timeout, input)?;
        if output.code != 0 {
            return Err(friendly_error(&format!(
                "{}\n{}",
                output.stdout, output.stderr
            )));
        }
        Ok(output.stdout)
    }
    pub fn simple(&self, args: &[&str]) -> Result<String> {
        self.cmd(args.iter().map(|s| s.to_string()).collect(), 20000, None)
    }
    pub fn devices(&self) -> Result<Vec<Device>> {
        Ok(parse_devices(&self.simple(&["devices", "-l"])?))
    }
    pub(crate) fn target(&self, device: &Target) -> Result<Vec<String>> {
        if device.serial.is_empty()
            || device.serial.len() > 512
            || device.transport_id.len() > 32
            || !re(r"^[1-9]\d*$").is_match(&device.transport_id)
        {
            return Err("设备缺少传输标识，请更新 ADB 并重新选择设备。".into());
        }
        Ok(vec!["-t".into(), device.transport_id.clone()])
    }
    pub fn ensure_online(&self, device: &Target) -> Result<()> {
        self.target(device)?;
        if !self.devices()?.iter().any(|d| {
            d.serial == device.serial
                && d.transport_id == device.transport_id
                && d.state == "device"
        }) {
            return Err("设备已断开、重连或尚未授权，请刷新并重新选择设备。".into());
        }
        Ok(())
    }
    pub fn shell(&self, device: &Target, args: &[&str]) -> Result<String> {
        let mut full = self.target(device)?;
        full.push("shell".into());
        full.extend(args.iter().map(|s| shell_arg(s)));
        self.cmd(full, 20000, None)
    }
    pub(crate) fn script(&self, device: &Target, script: &str, args: &[&str]) -> Result<String> {
        let mut full = vec!["sh", "-c", script, "android-tool"];
        full.extend(args);
        self.shell(device, &full)
    }
    pub(crate) fn installed(&self, device: &Target, pkg: &str) -> Result<()> {
        if !valid_package(pkg) {
            return Err("APK 包名格式不正确。".into());
        }
        if !re(r"(?m)^package:").is_match(&self.shell(device, &["pm", "path", "--user", "0", pkg])?)
        {
            return Err(format!("应用尚未安装到主用户：{pkg}"));
        }
        Ok(())
    }
}
