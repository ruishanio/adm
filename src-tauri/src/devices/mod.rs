use crate::{
    adb::{process::check_cancel, Adb},
    models::*,
    parsing::*,
};
pub(crate) mod info;

/// 按业务提供 ADB 操作；调用方显式引入能力，底层客户端不反向依赖业务。
pub(crate) trait DeviceOperations {
    fn details(&self, device: &Target) -> Result<Details>;
    fn connect(&self, address: &str) -> Result<String>;
    fn pair(&self, address: &str, code: &str) -> Result<()>;
    fn check_owner(&self, device: &Target, name: &str) -> Result<OwnerCheck>;
    fn set_owner(&self, device: &Target, name: &str) -> Result<()>;
}
impl DeviceOperations for Adb {
    fn details(&self, device: &Target) -> Result<Details> {
        self.ensure_online(device)?;
        let properties = self.shell(device, &["getprop"])?;
        let owner = parse_owner(&self.shell(device, &["dumpsys", "device_policy"])?)?;
        // 扩展采样失败不遮蔽基础信息，但取消和传输会话失效仍必须中止。
        let runtime = self
            .script(device, crate::devices::info::RUNTIME_SCRIPT, &[])
            .unwrap_or_default();
        check_cancel(&self.cancel)?;
        self.ensure_online(device)?;
        Ok(crate::devices::info::parse_details(
            &properties,
            &runtime,
            owner,
        ))
    }
    fn connect(&self, address: &str) -> Result<String> {
        let address = endpoint(address)?;
        let output = self.simple(&["connect", &address])?;
        if !re(r"(?m)^(?:already )?connected to ").is_match(&output) {
            return Err(friendly_error(&output));
        }
        if !self
            .devices()?
            .iter()
            .any(|d| d.serial.eq_ignore_ascii_case(&address) && d.state == "device")
        {
            return Err("连接请求已发出，但设备未就绪；请确认调试授权后刷新。".into());
        }
        Ok(address)
    }
    fn pair(&self, address: &str, code: &str) -> Result<()> {
        let address = endpoint(address)?;
        if !re(r"^\d{6}$").is_match(code.trim()) {
            return Err("请输入 6 位配对码。".into());
        }
        // 配对码只通过 stdin 传递，不进入进程参数、偏好设置或日志。
        let output = self.cmd(vec!["pair".into(), address], 40000, Some(code.trim()))?;
        if !output.contains("Successfully paired to") {
            return Err(format!("配对失败，请检查地址、配对码和有效期。\n{output}"));
        }
        Ok(())
    }
    /// 以目标会话和规范化组件检查主用户、账号及 Receiver；未知输出阻断设置，返回可执行条件。
    fn check_owner(&self, device: &Target, name: &str) -> Result<OwnerCheck> {
        let name = component(name)?;
        self.ensure_online(device)?;
        let policy = self.shell(device, &["dumpsys", "device_policy"])?;
        let owner = parse_owner(&policy)?;
        let blocked = |summary: String| {
            Ok(OwnerCheck {
                can_set: false,
                already_set: false,
                summary,
            })
        };
        if owner.as_deref() == Some(&name) {
            return Ok(OwnerCheck {
                can_set: false,
                already_set: true,
                summary: "该组件已经是设备所有者，无需重复设置。".into(),
            });
        }
        if let Some(owner) = owner {
            return blocked(format!("已配置其他设备所有者：{owner}"));
        }
        if re(r"(?i)Profile Owner\s*[:(]").is_match(&policy) {
            return blocked("设备已有工作资料管理者。".into());
        }
        if policy.contains("mHasFeature=false") {
            return blocked("此系统未提供设备管理功能。".into());
        }
        let pkg = name.split('/').next().unwrap();
        self.installed(device, pkg)?;
        let receivers = self.shell(
            device,
            &[
                "pm",
                "query-receivers",
                "--components",
                "--user",
                "0",
                "-a",
                "android.app.action.DEVICE_ADMIN_ENABLED",
                "-p",
                pkg,
            ],
        )?;
        if !receivers
            .lines()
            .any(|line| component(line).ok().as_deref() == Some(&name))
        {
            return blocked("未找到已启用的设备管理组件，请核对 Receiver 声明。".into());
        }
        let users = self.shell(device, &["pm", "list", "users"])?;
        let pattern = re(r"UserInfo\{(\d+):");
        let users: Vec<_> = pattern
            .captures_iter(&users)
            .map(|m| m[1].to_string())
            .collect();
        if users != ["0"] {
            return blocked("仅支持单一主用户（用户 0），请处理其他用户或工作资料。".into());
        }
        let accounts = self.shell(device, &["dumpsys", "account"])?;
        let pattern = re(r"Accounts:\s*(\d+)");
        let accounts: Vec<_> = pattern
            .captures_iter(&accounts)
            .map(|m| m[1].to_string())
            .collect();
        if accounts.is_empty() {
            return blocked("无法确认设备账号状态，请检查系统权限限制。".into());
        }
        if accounts.iter().any(|n| n != "0") {
            return blocked("设备仍有账号，请在设备设置中处理后重试。".into());
        }
        Ok(OwnerCheck {
            can_set: true,
            already_set: false,
            summary: "检查通过：组件已安装、单一主用户、无账号且无其他所有者。".into(),
        })
    }
    fn set_owner(&self, device: &Target, name: &str) -> Result<()> {
        let name = component(name)?;
        // 执行前重查，界面展示的条件不能替代当前系统状态；执行后必须回读同一组件。
        let check = self.check_owner(device, &name)?;
        if check.already_set {
            return Ok(());
        }
        if !check.can_set {
            return Err(check.summary);
        }
        let output = self.shell(device, &["dpm", "set-device-owner", "--user", "0", &name])?;
        if !re(r"(?m)^Success:").is_match(&output) {
            return Err(friendly_error(&output));
        }
        if parse_owner(&self.shell(device, &["dumpsys", "device_policy"])?)?.as_deref()
            != Some(&name)
        {
            return Err("命令已提交，但未确认设备所有者，请刷新核对。".into());
        }
        Ok(())
    }
}
