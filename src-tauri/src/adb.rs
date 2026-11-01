use crate::{
    models::*,
    parsing::*,
    process::{cancellation, check_cancel, Cancel, NativeRunner, Runner},
};
use std::{
    path::{Path, PathBuf},
    sync::Arc,
};
use uuid::Uuid;
const LIST_SCRIPT: &str = r#"[ -d "$1" ] && [ -r "$1" ] && [ -x "$1" ] || { echo "目录不存在或无访问权限" >&2; exit 1; }; cd "$1" || exit 1; printf "ATF1\000"; for p in ./* ./.[!.]* ./..?*; do [ -e "$p" ] || [ -L "$p" ] || continue; m=$(stat -c "%f %s %Y" "$p") || exit 1; printf "%s\000%s\000" "$m" "${p#./}"; done; printf "END\000""#;
const NO_CLOBBER: &str =
    r#"[ ! -e "$1" ] && [ ! -L "$1" ] || { echo "同名文件已存在，请更换文件名" >&2; exit 1; }"#;
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
    fn target(&self, device: &Target) -> Result<Vec<String>> {
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
    fn script(&self, device: &Target, script: &str, args: &[&str]) -> Result<String> {
        let mut full = vec!["sh", "-c", script, "android-tool"];
        full.extend(args);
        self.shell(device, &full)
    }
    pub fn details(&self, device: &Target) -> Result<Details> {
        self.ensure_online(device)?;
        let properties = self.shell(device, &["getprop"])?;
        let pattern = re(r"(?m)^\[([^\]]+)\]: \[(.*)\]\r?$");
        let values: std::collections::BTreeMap<String, String> = pattern
            .captures_iter(&properties)
            .map(|m| (m[1].into(), m[2].into()))
            .collect();
        let get = |key: &str| {
            values
                .get(key)
                .filter(|v| !v.is_empty())
                .cloned()
                .unwrap_or_else(|| "—".into())
        };
        Ok(Details {
            android: get("ro.build.version.release"),
            api: get("ro.build.version.sdk"),
            manufacturer: get("ro.product.manufacturer"),
            model: get("ro.product.model"),
            architecture: get("ro.product.cpu.abilist"),
            patch: get("ro.build.version.security_patch"),
            serial: get("ro.serialno"),
            owner: parse_owner(&self.shell(device, &["dumpsys", "device_policy"])?)?,
        })
    }
    pub fn connect(&self, address: &str) -> Result<String> {
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
    pub fn pair(&self, address: &str, code: &str) -> Result<()> {
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
    fn installed(&self, device: &Target, pkg: &str) -> Result<()> {
        if !valid_package(pkg) {
            return Err("APK 包名格式不正确。".into());
        }
        if !re(r"(?m)^package:").is_match(&self.shell(device, &["pm", "path", "--user", "0", pkg])?)
        {
            return Err(format!("应用尚未安装到主用户：{pkg}"));
        }
        Ok(())
    }
    pub fn install(&self, device: &Target, apk: &Apk, path: &Path, allow_test: bool) -> Result<()> {
        self.ensure_online(device)?;
        let mut args = self.target(device)?;
        args.extend(["install".into(), "-r".into()]);
        if allow_test {
            args.push("-t".into());
        }
        args.extend([
            "--user".into(),
            "0".into(),
            path.to_string_lossy().into_owned(),
        ]);
        let output = self.cmd(args, 300000, None)?;
        if !re(r"(?m)^Success\s*$").is_match(&output) {
            return Err(friendly_error(&output));
        }
        self.installed(device, &apk.package_name)?;
        let readback = self.shell(device, &["dumpsys", "package", &apk.package_name])?;
        if !re(&format!(
            r"\bversionCode={}\b",
            regex::escape(&apk.version_code)
        ))
        .is_match(&readback)
        {
            return Err("系统报告安装成功，但回读版本不一致，请核对结果。".into());
        }
        Ok(())
    }
    /// 以目标会话和规范化组件检查主用户、账号及 Receiver；未知输出阻断设置，返回可执行条件。
    pub fn check_owner(&self, device: &Target, name: &str) -> Result<OwnerCheck> {
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
    pub fn set_owner(&self, device: &Target, name: &str) -> Result<()> {
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
    pub fn list_files(&self, device: &Target, directory: &str) -> Result<Vec<DeviceFile>> {
        let directory = remote_path(directory)?;
        self.ensure_online(device)?;
        parse_files(
            &directory,
            &self.script(device, LIST_SCRIPT, &[&directory])?,
        )
    }
    pub fn mkdir(&self, device: &Target, directory: &str, name: &str) -> Result<()> {
        if name.len() > 255 || name.chars().any(|c| c.is_control()) {
            return Err("文件夹名称不能包含控制字符，且不能超过 255 字节。".into());
        }
        let path = child_path(directory, name)?;
        self.ensure_online(device)?;
        self.shell(device, &["mkdir", &path])?;
        Ok(())
    }
    /// 先上传本次独占的临时文件，再无覆盖提交；失败或取消仅清理本次文件，不影响已有文件。
    pub fn upload(&self, device: &Target, local: &Path, directory: &str) -> Result<()> {
        if !local.is_file() {
            return Err("请选择普通文件。".into());
        }
        let destination = child_path(
            directory,
            &local.file_name().ok_or("文件名无效")?.to_string_lossy(),
        )?;
        let temporary = child_path(
            directory,
            &format!(".android-tool-upload-{}", Uuid::new_v4()),
        )?;
        self.ensure_online(device)?;
        self.script(device, NO_CLOBBER, &[&destination])?;
        let result = (|| {
            let mut args = self.target(device)?;
            args.extend([
                "push".into(),
                local.to_string_lossy().into_owned(),
                temporary.clone(),
            ]);
            self.cmd(args, 1800000, None)?;
            self.script(device,r#"[ ! -e "$2" ] && [ ! -L "$2" ] || { echo "同名文件已存在" >&2; exit 1; }; mv -n "$1" "$2" || exit 1; [ ! -e "$1" ] && [ -f "$2" ] && [ ! -L "$2" ]"#,&[&temporary,&destination])?;
            Ok(())
        })();
        let mut cleanup = self.target(device)?;
        cleanup.extend([
            "shell".into(),
            "rm".into(),
            "-f".into(),
            shell_arg(&temporary),
        ]);
        let _ = self
            .runner
            .run(&self.executable, &cleanup, &cancellation(), 3000, None);
        result
    }
    /// 下载到同目录独占文件，成功后原子替换；取消或失败保留原目标内容。
    pub fn download(&self, device: &Target, remote: &str, local: &Path) -> Result<()> {
        let remote = remote_path(remote)?;
        self.ensure_online(device)?;
        self.script(
            device,
            r#"[ -f "$1" ] && [ ! -L "$1" ] || { echo "仅支持下载普通文件" >&2; exit 1; }"#,
            &[&remote],
        )?;
        let temporary = tempfile::NamedTempFile::new_in(local.parent().ok_or("下载路径无效")?)
            .map_err(|e| e.to_string())?;
        let mut args = self.target(device)?;
        args.extend([
            "pull".into(),
            remote,
            temporary.path().to_string_lossy().into_owned(),
        ]);
        self.cmd(args, 1800000, None)?;
        check_cancel(&self.cancel)?;
        temporary
            .persist(local)
            .map_err(|e| format!("无法保存下载文件：{e}"))?;
        Ok(())
    }
}
