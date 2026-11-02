use crate::{adb::Adb, models::*, parsing::*};
use std::path::Path;

/// 按业务提供 ADB 操作；调用方显式引入能力，底层客户端不反向依赖业务。
pub(crate) trait InstallOperations {
    fn install(&self, device: &Target, apk: &Apk, path: &Path, allow_test: bool) -> Result<()>;
}
impl InstallOperations for Adb {
    fn install(&self, device: &Target, apk: &Apk, path: &Path, allow_test: bool) -> Result<()> {
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
}
