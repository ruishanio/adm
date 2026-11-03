//! 应用查询、资源和管理操作只针对主用户 0，与安装功能保持一致，不跨用户修改应用。
pub(crate) mod apk;
pub(crate) mod install;
use crate::{
    adb::process::{cancellation, check_cancel},
    adb::Adb,
    models::*,
    parsing::{component, friendly_error, parse_owner, re, valid_package},
};
use std::collections::{BTreeMap, HashSet};
use std::io::Write;
use uuid::Uuid;

const LABEL_READER: &[u8] = include_bytes!("../../../android/app-labels/app-labels.jar");

/// 只接受读取器的版本化 JSON 行；无名称、包名回退和异常资源不伪造友好名称。
fn parse_labels(text: &str) -> Result<BTreeMap<String, String>> {
    if text.len() > 4 * 1024 * 1024 {
        return Err("应用名称数据过大。".into());
    }
    let json = text
        .lines()
        .find_map(|line| line.strip_prefix("ADM_LABELS_V1:"))
        .ok_or("未能读取应用名称。")?;
    let labels: BTreeMap<String, String> =
        serde_json::from_str(json).map_err(|_| "应用名称数据无效。")?;
    Ok(labels
        .into_iter()
        .filter_map(|(package, label)| {
            let label = label.split_whitespace().collect::<Vec<_>>().join(" ");
            (package_valid(&package)
                && !label.is_empty()
                && label != package
                && label.chars().count() <= 512
                && !label.chars().any(char::is_control))
            .then_some((package, label))
        })
        .collect())
}

/// 只接受版本化、大小受限的辅助数据；缺失字段保持未知，不把失败伪装成零字节。
pub(crate) fn reader_json<T: serde::de::DeserializeOwned>(text: &str, marker: &str) -> Result<T> {
    if text.len() > 4 * 1024 * 1024 {
        return Err("应用资源数据过大。".into());
    }
    let value = text
        .lines()
        .find_map(|line| line.strip_prefix(marker))
        .ok_or("应用资源读取失败。")?;
    serde_json::from_str(value).map_err(|_| "应用资源格式无效。".into())
}
fn parse_metadata(text: &str) -> Result<BTreeMap<String, AppMetadata>> {
    let mut data: BTreeMap<String, AppMetadata> = reader_json(text, "ADM_APPS_V1:")?;
    data.retain(|package, item| {
        if !package_valid(package) {
            return false;
        }
        if item
            .version
            .as_ref()
            .is_some_and(|v| v.name.len() > 1024 || !re(r"^\d{1,20}$").is_match(&v.code))
        {
            item.version = None;
        }
        if item.apk_size == Some(0) {
            item.apk_size = None;
        }
        if item
            .launch_component
            .as_ref()
            .is_some_and(|c| !c.starts_with(&format!("{package}/")) || component(c).is_err())
        {
            item.launch_component = None;
        }
        true
    });
    Ok(data)
}

fn package_valid(package: &str) -> bool {
    package.len() <= 255 && (package == "android" || valid_package(package))
}

/// 解析 pm 的包名或路径列表；路径可能包含多个等号，必须从最后一个等号分割。
fn packages(text: &str, paths: bool) -> Result<BTreeMap<String, String>> {
    let mut result = BTreeMap::new();
    for line in text.lines().map(str::trim).filter(|s| !s.is_empty()) {
        let value = line
            .strip_prefix("package:")
            .ok_or("无法读取已安装应用列表，请重试。")?;
        let (path, package) = if paths {
            let (path, package) = value.rsplit_once('=').ok_or("应用路径格式不受支持。")?;
            if !path.starts_with('/') {
                return Err("应用路径格式不受支持。".into());
            }
            (path, package)
        } else {
            ("", value)
        };
        if !package_valid(package) {
            return Err("设备返回了无效的应用包名。".into());
        }
        result.insert(package.to_string(), path.to_string());
    }
    Ok(result)
}

/// 从指定包的 Packages 段读取信息，排除旧系统包记录及其他用户的安装时间。
fn parse_details(text: &str, app: InstalledApp) -> Result<AppDetails> {
    let header = format!("  Package [{}] (", app.package_name);
    let section = text
        .split_once("Packages:\n")
        .map(|(_, s)| s)
        .ok_or("无法解析应用信息。")?;
    let start = section
        .lines()
        .position(|l| l.starts_with(&header))
        .ok_or("应用已移除，请刷新列表。")?;
    let lines: Vec<_> = section
        .lines()
        .skip(start + 1)
        .take_while(|l| l.trim().is_empty() || l.starts_with("    "))
        .collect();
    let body = lines.join("\n");
    let value = |key: &str| -> String {
        lines
            .iter()
            .map(|l| l.trim())
            .find_map(|l| l.strip_prefix(&format!("{key}=")))
            .filter(|s| *s != "null")
            .unwrap_or("")
            .to_string()
    };
    let number = |key: &str| {
        re(&format!(r"\b{key}=(\d+)\b"))
            .captures(&body)
            .map(|m| m[1].to_string())
            .unwrap_or_default()
    };
    let user = lines
        .iter()
        .position(|l| l.trim_start().starts_with("User 0:"))
        .ok_or("无法确认主用户的应用状态。")?;
    if !lines[user]
        .split_whitespace()
        .any(|s| s == "installed=true")
    {
        return Err("应用未安装到主用户，请刷新列表。".into());
    }
    let version_code = number("versionCode");
    if version_code.is_empty() {
        return Err("无法读取应用版本，请刷新重试。".into());
    }
    let user_time = lines
        .iter()
        .skip(user + 1)
        .take_while(|l| !l.trim_start().starts_with("User "))
        .find_map(|l| l.trim().strip_prefix("firstInstallTime="));
    // Android 新版本将首次安装时间放在用户段；旧版本在包级别。
    let first_install_time = user_time.map(str::to_string).unwrap_or_else(|| {
        lines[..user]
            .iter()
            .find_map(|l| l.trim().strip_prefix("firstInstallTime="))
            .unwrap_or("")
            .to_string()
    });
    Ok(AppDetails {
        app,
        version_name: value("versionName"),
        version_code,
        minimum_sdk: number("minSdk"),
        target_sdk: number("targetSdk"),
        uid: number("userId"),
        first_install_time,
        last_update_time: value("lastUpdateTime"),
        installer: value("installerPackageName"),
    })
}

impl Adb {
    /// 临时运行自有 DEX；输入为固定传输会话和读取模式，返回带版本标记的资源 JSON。
    pub(crate) fn app_reader(&self, target: &Target, mode: &[&str]) -> Result<String> {
        let mut local = tempfile::NamedTempFile::new().map_err(|e| e.to_string())?;
        local.write_all(LABEL_READER).map_err(|e| e.to_string())?;
        let remote = format!("/data/local/tmp/adm-app-labels-{}.jar", Uuid::new_v4());
        let mut push = self.target(target)?;
        push.extend([
            "push".into(),
            local.path().to_string_lossy().into_owned(),
            remote.clone(),
        ]);
        let result = (|| {
            self.cmd(push, 20000, None)?;
            // 新版 Android 禁止加载可写 DEX；读取器不需要持久化或修改应用权限。
            self.shell(target, &["chmod", "444", &remote])?;
            let classpath = format!("CLASSPATH={remote}");
            let mut args = vec![
                "env",
                &classpath,
                "app_process",
                "/",
                "com.ruinext.adm.AppLabels",
            ];
            args.extend_from_slice(mode);
            self.shell(target, &args)
        })();
        // 取消等待后仍尝试清理本次唯一文件；固定 transport_id，绝不切换到重连后的设备。
        let mut cleanup = self.target(target)?;
        cleanup.extend(["shell".into(), "rm".into(), "-f".into(), remote]);
        let _ = self
            .runner
            .run(&self.executable, &cleanup, &cancellation(), 5000, None);
        result
    }

    pub fn list_apps(&self, target: &Target) -> Result<Vec<InstalledApp>> {
        self.ensure_online(target)?;
        let all = packages(
            &self.shell(target, &["pm", "list", "packages", "-f", "--user", "0"])?,
            true,
        )?;
        let system: HashSet<_> = packages(
            &self.shell(target, &["pm", "list", "packages", "-s", "--user", "0"])?,
            false,
        )?
        .into_keys()
        .collect();
        let disabled: HashSet<_> = packages(
            &self.shell(target, &["pm", "list", "packages", "-d", "--user", "0"])?,
            false,
        )?
        .into_keys()
        .collect();
        // 厂商限制 app_process 或某个资源损坏时保留包名列表，取消和断线则仍然中止。
        let resources = if all.is_empty() {
            String::new()
        } else {
            self.app_reader(target, &[]).unwrap_or_default()
        };
        let mut labels = parse_labels(&resources).unwrap_or_default();
        let mut metadata = parse_metadata(&resources).unwrap_or_default();
        check_cancel(&self.cancel)?;
        self.ensure_online(target)?;
        Ok(all
            .into_iter()
            .map(|(package_name, apk_path)| InstalledApp {
                metadata: metadata.remove(&package_name).unwrap_or_default(),
                system: system.contains(&package_name),
                enabled: !disabled.contains(&package_name),
                label: labels.remove(&package_name),
                package_name,
                apk_path,
            })
            .collect())
    }

    pub fn app_icons(
        &self,
        target: &Target,
        packages: &[String],
    ) -> Result<BTreeMap<String, String>> {
        if packages.is_empty() || packages.len() > 24 || packages.iter().any(|p| !package_valid(p))
        {
            return Err("图标请求参数无效。".into());
        }
        self.ensure_online(target)?;
        let mut mode = vec!["icons"];
        mode.extend(packages.iter().map(String::as_str));
        let data: BTreeMap<String, String> =
            reader_json(&self.app_reader(target, &mode)?, "ADM_ICONS_V1:")?;
        self.ensure_online(target)?;
        Ok(data
            .into_iter()
            .filter(|(package, icon)| {
                packages.contains(package)
                    && icon.len() <= 65536
                    && icon.starts_with("iVBORw0KGgo")
                    && re(r"^[A-Za-z0-9+/]+={0,2}$").is_match(icon)
            })
            .map(|(package, icon)| (package, format!("data:image/png;base64,{icon}")))
            .collect())
    }
    /// 一次查询主用户的全部关联进程，包括多进程及缓存进程；失败交由界面显示未知。
    pub fn app_running(&self, target: &Target) -> Result<Vec<String>> {
        self.ensure_online(target)?;
        let mut packages: Vec<String> =
            reader_json(&self.app_reader(target, &["running"])?, "ADM_RUNNING_V1:")?;
        if packages.is_empty()
            || packages.len() > 20000
            || packages.iter().any(|p| !package_valid(p))
        {
            return Err("无法确认应用运行状态。".into());
        }
        packages.sort();
        packages.dedup();
        self.ensure_online(target)?;
        Ok(packages)
    }
    /// 危险操作只面向主用户普通应用，拒绝所有者；固定会话与版本，确认后再次核对。
    pub fn app_action(
        &self,
        target: &Target,
        package: &str,
        version: &str,
        action: &str,
        consent: bool,
    ) -> Result<()> {
        if !["launch", "force-stop", "clear-data"].contains(&action)
            || !package_valid(package)
            || !re(r"^\d{1,20}$").is_match(version)
        {
            return Err("应用操作参数无效。".into());
        }
        if action != "launch" && !consent {
            return Err("请先确认应用操作。".into());
        }
        let details = self.app_details(target, package)?;
        if details.app.system {
            return Err("系统应用仅支持查看。".into());
        }
        if details.version_code != version {
            return Err("应用版本已变化，请重新确认操作。".into());
        }
        if action != "launch" {
            self.check_app_owner(target, package)?;
        }
        self.ensure_online(target)?;
        match action {
            "launch" => {
                if !details.app.enabled {
                    return Err("应用已禁用，无法打开。".into());
                }
                let component = details
                    .app
                    .metadata
                    .launch_component
                    .ok_or("此应用没有可用的启动入口。")?;
                let output = self.shell(
                    target,
                    &["am", "start", "-W", "--user", "0", "-n", &component],
                )?;
                if !output.contains("Starting: Intent")
                    || output.contains("Error")
                    || output.contains("Exception")
                {
                    return Err(friendly_error(&output));
                }
            }
            "clear-data" => {
                let output = self.shell(target, &["pm", "clear", "--user", "0", package])?;
                if !re(r"(?m)^Success\s*$").is_match(&output) {
                    return Err(friendly_error(&output));
                }
            }
            _ => {
                let output = self.shell(target, &["am", "force-stop", "--user", "0", package])?;
                if !output.trim().is_empty() {
                    return Err(friendly_error(&output));
                }
            }
        }
        self.ensure_online(target)?;
        Ok(())
    }
    fn check_app_owner(&self, target: &Target, package: &str) -> Result<()> {
        let owner = parse_owner(&self.shell(target, &["dumpsys", "device_policy"])?)?;
        if owner.is_some_and(|c| c.starts_with(&format!("{package}/"))) {
            return Err("设备所有者应用不支持此操作。".into());
        }
        Ok(())
    }

    pub fn app_details(&self, target: &Target, package: &str) -> Result<AppDetails> {
        if !package_valid(package) {
            return Err("应用包名无效。".into());
        }
        let app = self
            .list_apps(target)?
            .into_iter()
            .find(|a| a.package_name == package)
            .ok_or("应用已移除，请刷新列表。")?;
        let text = self.shell(target, &["dumpsys", "package", package])?;
        let details = parse_details(&text.replace("\r\n", "\n"), app)?;
        self.ensure_online(target)?;
        Ok(details)
    }

    /// 卸载已确认的包和版本；重新检查会话及系统属性，系统应用只读，成功后按用户回读确认。
    pub fn uninstall_app(
        &self,
        target: &Target,
        package: &str,
        version: &str,
        consent: bool,
    ) -> Result<()> {
        if !consent {
            return Err("请先确认卸载应用及其数据。".into());
        }
        if !package_valid(package) || !re(r"^\d{1,20}$").is_match(version) {
            return Err("卸载参数无效，请重新查看应用信息。".into());
        }
        let details = self.app_details(target, package)?;
        if details.app.system {
            return Err("系统应用仅支持查看，不支持卸载。".into());
        }
        if details.version_code != version {
            return Err("应用版本已变化，请重新查看信息并确认卸载。".into());
        }
        self.check_app_owner(target, package)?;
        // --versionCode 在设备端再次核对，避免确认后更新造成误卸载；不使用 -k 保留数据。
        let output = self.shell(
            target,
            &[
                "pm",
                "uninstall",
                "--user",
                "0",
                "--versionCode",
                version,
                package,
            ],
        )?;
        if !re(r"(?m)^Success\s*$").is_match(&output) {
            return Err(friendly_error(&output));
        }
        self.ensure_online(target)?;
        let remaining = packages(
            &self.shell(target, &["pm", "list", "packages", "--user", "0", package])?,
            false,
        )?;
        if remaining.contains_key(package) {
            return Err("系统报告卸载成功，但应用仍在列表中，请刷新核对。".into());
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::adb::process::{cancellation, Cancel, Output, Runner};
    use std::{
        path::Path,
        sync::{Arc, Mutex},
    };

    #[derive(Default)]
    struct FakeState {
        calls: Vec<Vec<String>>,
        system: bool,
        owner: bool,
        removed: bool,
        failure: bool,
        stale: bool,
        retain: bool,
        labels_fail: bool,
        cancel_labels: bool,
        stale_after_labels: bool,
        cleanup_cancelled: bool,
    }
    #[derive(Default)]
    struct Fake(Mutex<FakeState>);
    impl Runner for Fake {
        fn run(
            &self,
            _: &Path,
            args: &[String],
            cancel: &Cancel,
            _: u64,
            _: Option<&str>,
        ) -> Result<Output> {
            let mut s = self.0.lock().unwrap();
            s.calls.push(args.to_vec());
            let has = |value: &str| args.iter().any(|a| a == value);
            let out = if args[0] == "devices" {
                format!(
                    "emulator-5570 device model:Test transport_id:{}",
                    if s.stale { "99" } else { "42" }
                )
            } else if has("rm") {
                s.cleanup_cancelled = cancel.load(std::sync::atomic::Ordering::SeqCst);
                String::new()
            } else if has("app_process") {
                if s.cancel_labels {
                    cancel.store(true, std::sync::atomic::Ordering::SeqCst);
                    return Err("cancelled".into());
                }
                if s.labels_fail {
                    return Err("app_process unavailable".into());
                }
                if s.stale_after_labels {
                    s.stale = true;
                }
                if has("admins") {
                    r#"ADM_ADMINS_V1:[{"component":"com.example.app/.Admin","label":"中文应用"}]"#
                        .into()
                } else if has("running") {
                    "ADM_RUNNING_V1:[\"com.example.app\"]".into()
                } else if has("icons") {
                    "ADM_ICONS_V1:{\"com.example.app\":\"iVBORw0KGgoAAAA=\",\"com.other.app\":\"iVBORw0KGgoAAAA=\"}".into()
                } else {
                    "ADM_LABELS_V1:{\"com.example.app\":\"中文应用\",\"com.example.other\":\"其他用户应用\"}\nADM_APPS_V1:{\"com.example.app\":{\"version\":{\"name\":\"1.0\",\"code\":\"42\"},\"apkSize\":2048,\"launchComponent\":\"com.example.app/.Main\"}}".into()
                }
            } else if has("clear") {
                if s.failure {
                    "Failed".into()
                } else {
                    "Success\n".into()
                }
            } else if has("force-stop") {
                if s.failure {
                    "SecurityException: denied".into()
                } else {
                    String::new()
                }
            } else if has("start") {
                if s.failure {
                    "Error: Activity not found".into()
                } else {
                    "Starting: Intent { cmp=com.example.app/.Main }".into()
                }
            } else if has("uninstall") {
                if s.failure {
                    "Failure [DELETE_FAILED_DEVICE_POLICY_MANAGER]".into()
                } else {
                    s.removed = !s.retain;
                    "Success\n".into()
                }
            } else if has("device_policy") {
                if s.owner {
                    "Device Policy Manager state:\nDevice Owner:\n admin=ComponentInfo{com.example.app/.Admin}".into()
                } else {
                    "Device Policy Manager state:".into()
                }
            } else if has("dumpsys") {
                "Packages:\n  Package [com.example.app] (abc):\n    versionCode=42 minSdk=23 targetSdk=35\n    versionName=1.0\n    User 0: installed=true enabled=0\n".into()
            } else if has("-d") || (has("-s") && !s.system) || s.removed {
                String::new()
            } else if has("-f") {
                "package:/data/app/test==/base.apk=com.example.app\n".into()
            } else {
                "package:com.example.app\n".into()
            };
            Ok(Output {
                stdout: out,
                stderr: String::new(),
                code: 0,
            })
        }
    }
    fn fake() -> (Adb, Arc<Fake>, Target) {
        let runner = Arc::new(Fake::default());
        (
            Adb {
                executable: "adb".into(),
                runner: runner.clone(),
                cancel: cancellation(),
            },
            runner,
            Target {
                serial: "emulator-5570".into(),
                transport_id: "42".into(),
            },
        )
    }
    #[test]
    fn names_are_merged_by_package_and_helper_files_are_cleaned() {
        let (adb, runner, target) = fake();
        let apps = adb.list_apps(&target).unwrap();
        assert_eq!(apps.len(), 1);
        assert_eq!(apps[0].label.as_deref(), Some("中文应用"));
        assert_eq!(
            adb.app_details(&target, "com.example.app")
                .unwrap()
                .app
                .label,
            apps[0].label
        );
        let state = runner.0.lock().unwrap();
        let pushes: Vec<_> = state
            .calls
            .iter()
            .filter(|c| c.iter().any(|s| s == "push"))
            .collect();
        let cleanups: Vec<_> = state
            .calls
            .iter()
            .filter(|c| c.iter().any(|s| s == "rm"))
            .collect();
        assert_eq!(pushes.len(), cleanups.len());
        for (push, cleanup) in pushes.iter().zip(cleanups) {
            assert_eq!(&push[..2], ["-t", "42"]);
            assert_eq!(&cleanup[..5], ["-t", "42", "shell", "rm", "-f"]);
            assert_eq!(push.last(), cleanup.last());
            assert!(push
                .last()
                .unwrap()
                .starts_with("/data/local/tmp/adm-app-labels-"));
        }
    }
    #[test]
    fn label_failure_keeps_apps_but_cancel_and_disconnect_never_publish_results() {
        let (adb, runner, target) = fake();
        runner.0.lock().unwrap().labels_fail = true;
        let apps = adb.list_apps(&target).unwrap();
        assert_eq!(apps.len(), 1);
        assert_eq!(apps[0].label, None);
        runner.0.lock().unwrap().cancel_labels = true;
        assert!(adb.list_apps(&target).unwrap_err().contains("停止等待"));
        assert!(!runner.0.lock().unwrap().cleanup_cancelled);
        assert!(runner
            .0
            .lock()
            .unwrap()
            .calls
            .last()
            .unwrap()
            .contains(&"rm".into()));
        let (adb, runner, target) = fake();
        runner.0.lock().unwrap().stale_after_labels = true;
        assert!(adb.list_apps(&target).unwrap_err().contains("重连"));
    }
    #[test]
    fn admin_scan_binds_transport_cleans_reader_and_rejects_unavailable_results() {
        let (adb, runner, target) = fake();
        let admins = adb.scan_device_admins(&target).unwrap();
        assert_eq!(admins[0].component, "com.example.app/com.example.app.Admin");
        assert_eq!(admins[0].label.as_deref(), Some("中文应用"));
        {
            let s = runner.0.lock().unwrap();
            let read = s
                .calls
                .iter()
                .find(|c| c.contains(&"app_process".into()))
                .unwrap();
            assert_eq!(&read[..2], ["-t", "42"]);
            assert_eq!(read.last().unwrap(), "admins");
            let push = s.calls.iter().find(|c| c.contains(&"push".into())).unwrap();
            let cleanup = s.calls.iter().find(|c| c.contains(&"rm".into())).unwrap();
            assert_eq!(push.last(), cleanup.last());
        }
        runner.0.lock().unwrap().labels_fail = true;
        assert!(adb
            .scan_device_admins(&target)
            .unwrap_err()
            .contains("无法扫描"));
        runner.0.lock().unwrap().cancel_labels = true;
        assert!(adb
            .scan_device_admins(&target)
            .unwrap_err()
            .contains("停止等待"));
        assert!(!runner.0.lock().unwrap().cleanup_cancelled);
        let (adb, runner, target) = fake();
        runner.0.lock().unwrap().stale_after_labels = true;
        assert!(adb
            .scan_device_admins(&target)
            .unwrap_err()
            .contains("重连"));
    }
    #[test]
    fn label_parser_preserves_unicode_and_rejects_invalid_or_missing_names() {
        let labels = parse_labels("system diagnostic\nADM_LABELS_V1:{\"com.example.app\":\"  中文\\nNotes  \",\"com.example.empty\":\" \",\"com.example.test\":\"com.example.test\",\"bad;name\":\"fake\"}\n").unwrap();
        assert_eq!(labels.len(), 1);
        assert_eq!(labels["com.example.app"], "中文 Notes");
        assert!(parse_labels("ADM_LABELS_V1:{\"com.example.app\":null}").is_err());
        assert!(parse_labels("Failed to start").is_err());
    }
    #[test]
    fn uninstall_requires_consent_valid_input_and_same_session_version() {
        let (adb, runner, target) = fake();
        assert!(adb
            .uninstall_app(&target, "com.example.app", "42", false)
            .is_err());
        assert!(adb
            .uninstall_app(&target, "com.example.app;reboot", "42", true)
            .is_err());
        assert!(runner.0.lock().unwrap().calls.is_empty());
        assert!(adb
            .uninstall_app(&target, "com.example.app", "41", true)
            .unwrap_err()
            .contains("版本已变化"));
        runner.0.lock().unwrap().stale = true;
        assert!(adb
            .uninstall_app(&target, "com.example.app", "42", true)
            .unwrap_err()
            .contains("重连"));
        assert!(!runner
            .0
            .lock()
            .unwrap()
            .calls
            .iter()
            .any(|c| c.iter().any(|s| s == "uninstall")));
    }
    #[test]
    fn system_apps_are_read_only_and_policy_failure_is_not_success() {
        let (adb, runner, target) = fake();
        runner.0.lock().unwrap().system = true;
        assert!(
            adb.app_details(&target, "com.example.app")
                .unwrap()
                .app
                .system
        );
        assert!(adb
            .uninstall_app(&target, "com.example.app", "42", true)
            .unwrap_err()
            .contains("系统应用"));
        assert!(!runner
            .0
            .lock()
            .unwrap()
            .calls
            .iter()
            .any(|c| c.iter().any(|s| s == "uninstall")));
        {
            let mut state = runner.0.lock().unwrap();
            state.system = false;
            state.failure = true;
        }
        assert!(adb
            .uninstall_app(&target, "com.example.app", "42", true)
            .unwrap_err()
            .contains("DELETE_FAILED_DEVICE_POLICY_MANAGER"));
    }
    #[test]
    fn uninstall_is_scoped_to_user_zero_and_verified() {
        let (adb, runner, target) = fake();
        adb.uninstall_app(&target, "com.example.app", "42", true)
            .unwrap();
        assert!(runner.0.lock().unwrap().calls.contains(
            &[
                "-t",
                "42",
                "shell",
                "pm",
                "uninstall",
                "--user",
                "0",
                "--versionCode",
                "42",
                "com.example.app"
            ]
            .map(str::to_string)
            .to_vec()
        ));
        assert!(adb.list_apps(&target).unwrap().is_empty());
        {
            let mut state = runner.0.lock().unwrap();
            state.removed = false;
            state.retain = true;
        }
        assert!(adb
            .uninstall_app(&target, "com.example.app", "42", true)
            .unwrap_err()
            .contains("仍在列表"));
    }
    #[test]
    fn parses_paths_with_equals_and_rejects_errors() {
        let list = packages("package:/data/app/~~abc==/com.example.app-xyz==/base.apk=com.example.app\npackage:/system/framework/framework-res.apk=android\n", true).unwrap();
        assert_eq!(
            list["com.example.app"],
            "/data/app/~~abc==/com.example.app-xyz==/base.apk"
        );
        assert!(packages("Error: package manager unavailable", false).is_err());
        assert!(packages("package:com.example;reboot", false).is_err());
        assert!(packages("", false).unwrap().is_empty());
    }
    #[test]
    fn details_use_exact_package_and_user_zero() {
        let app = InstalledApp {
            metadata: AppMetadata::default(),
            package_name: "com.example.app".into(),
            label: Some("示例应用".into()),
            apk_path: "/data/app/base.apk".into(),
            system: false,
            enabled: true,
        };
        let dump = "Packages:\n  Package [com.example.app] (abcd):\n    userId=10123\n    versionCode=42 minSdk=23 targetSdk=35\n    versionName=1.0 beta\n    lastUpdateTime=2026-11-01 12:00:00\n    User 10: installed=true\n      firstInstallTime=wrong\n    User 0: installed=true enabled=0\n      firstInstallTime=2026-10-01 12:00:00\nHidden system packages:\n  Package [com.example.app] (old):\n    versionCode=1\n";
        let d = parse_details(dump, app.clone()).unwrap();
        assert_eq!(d.version_code, "42");
        assert_eq!(d.version_name, "1.0 beta");
        assert_eq!(d.first_install_time, "2026-10-01 12:00:00");
        assert!(parse_details(
            &dump.replace("User 0: installed=true", "User 0: installed=false"),
            app.clone()
        )
        .is_err());
        assert!(parse_details("Unable to find package", app).is_err());
    }
    #[test]
    fn metadata_and_icons_are_bounded_and_running_failures_stay_unknown() {
        let (adb, runner, target) = fake();
        let app = adb.list_apps(&target).unwrap().remove(0);
        assert_eq!(app.metadata.version.unwrap().code, "42");
        assert_eq!(app.metadata.apk_size, Some(2048));
        let icons = adb.app_icons(&target, &["com.example.app".into()]).unwrap();
        assert_eq!(icons.len(), 1);
        assert!(icons["com.example.app"].starts_with("data:image/png;base64,"));
        assert!(adb
            .app_icons(&target, &["com.example.app;reboot".into()])
            .is_err());
        assert!(adb
            .app_icons(&target, &vec!["com.example.app".into(); 25])
            .is_err());
        assert_eq!(adb.app_running(&target).unwrap(), vec!["com.example.app"]);
        runner.0.lock().unwrap().labels_fail = true;
        assert!(adb.app_running(&target).is_err());
        let invalid = parse_metadata(r#"ADM_APPS_V1:{"com.example.app":{"version":{"name":"x","code":"bad"},"apkSize":0,"launchComponent":"com.other.app/.Main"}}"#).unwrap();
        let meta = &invalid["com.example.app"];
        assert!(
            meta.version.is_none() && meta.apk_size.is_none() && meta.launch_component.is_none()
        );
    }
    #[test]
    fn app_actions_require_consent_current_version_and_protect_system_and_owner() {
        let (adb, runner, target) = fake();
        for action in ["force-stop", "clear-data"] {
            assert!(adb
                .app_action(&target, "com.example.app", "42", action, false)
                .is_err());
            assert!(adb
                .app_action(&target, "com.example.app", "41", action, true)
                .is_err());
        }
        assert!(adb
            .app_action(&target, "com.example.app", "42", "shell", true)
            .is_err());
        assert!(adb
            .app_action(&target, "com.example.app;reboot", "42", "launch", true)
            .is_err());
        runner.0.lock().unwrap().system = true;
        assert!(adb
            .app_action(&target, "com.example.app", "42", "force-stop", true)
            .is_err());
        {
            let mut s = runner.0.lock().unwrap();
            s.system = false;
            s.owner = true;
        }
        assert!(adb
            .app_action(&target, "com.example.app", "42", "clear-data", true)
            .is_err());
        assert!(adb
            .uninstall_app(&target, "com.example.app", "42", true)
            .is_err());
        let state = runner.0.lock().unwrap();
        assert!(!state.calls.iter().any(|c| c.iter().any(|arg| [
            "force-stop",
            "clear",
            "start",
            "uninstall"
        ]
        .contains(&arg.as_str()))));
    }
    #[test]
    fn app_actions_scope_user_and_surface_device_failure() {
        let (adb, runner, target) = fake();
        for action in ["launch", "force-stop", "clear-data"] {
            adb.app_action(&target, "com.example.app", "42", action, true)
                .unwrap();
        }
        {
            let s = runner.0.lock().unwrap();
            for command in ["start", "force-stop", "clear"] {
                let args = s
                    .calls
                    .iter()
                    .find(|a| a.iter().any(|v| v == command))
                    .unwrap();
                assert_eq!(&args[..2], &["-t", "42"]);
                assert!(args.windows(2).any(|w| w == ["--user", "0"]));
            }
        }
        runner.0.lock().unwrap().failure = true;
        for action in ["launch", "force-stop", "clear-data"] {
            assert!(adb
                .app_action(&target, "com.example.app", "42", action, true)
                .is_err());
        }
        runner.0.lock().unwrap().stale = true;
        assert!(adb
            .app_action(&target, "com.example.app", "42", "clear-data", true)
            .is_err());
    }
}
