use super::{decoded, decoded_empty, encoded};
use crate::apps::install::InstallOperations;
use crate::{
    adb::process::{cancellation, Cancel},
    apps::apk,
    models::*,
    parsing,
    state::AppState,
};
use serde_json::Value;
use std::path::PathBuf;
use tauri_plugin_clipboard_manager::ClipboardExt;
use tauri_plugin_dialog::DialogExt;

impl AppState {
    pub(crate) fn apps_command(
        &self,
        app: &tauri::AppHandle,
        method: &str,
        args: Value,
        cancel: Cancel,
    ) -> Result<Value> {
        match method {
            "chooseApk" => {
                decoded_empty(args)?;
                let path = app
                    .dialog()
                    .file()
                    .set_title(self.localized("选择 APK"))
                    .add_filter(self.localized("Android 安装包"), &["apk"])
                    .blocking_pick_file();
                match path {
                    Some(path) => encoded(
                        self.inspect(path.into_path().map_err(|e| e.to_string())?, &cancel)?,
                    ),
                    None => Ok(Value::Null),
                }
            }
            "inspectApk" => {
                let (path,): (String,) = decoded(args)?;
                let path = PathBuf::from(path);
                // 仅接受本窗口操作系统拖放事件授权的路径，前端不能任意读取本机文件。
                if !self.drops.lock().unwrap().remove(&path) {
                    return Err("拖放文件来源已失效，请重新拖入或使用选择文件。".into());
                }
                encoded(self.inspect(path, &cancel)?)
            }
            "install" => {
                let (target, id): (Target, String) = decoded(args)?;
                let record = self.apk.lock().unwrap().clone().ok_or("请先选择安装包。")?;
                if record.info.id != id {
                    return Err("安装包已变化，请重新选择。".into());
                }
                if apk::file_hash(&record.path, &cancel)? != record.hash {
                    return Err("APK 文件内容已变化，请重新选择并核对。".into());
                }
                self.adb(cancel)?
                    .install(&target, &record.info, &record.path)?;
                Ok(Value::Null)
            }
            "listApps" => {
                let (target,): (Target,) = decoded(args)?;
                encoded(self.adb(cancel)?.list_apps(&target)?)
            }
            "appDetails" => {
                let (target, package): (Target, String) = decoded(args)?;
                encoded(self.adb(cancel)?.app_details(&target, &package)?)
            }
            "appIcons" => {
                let (target, packages): (Target, Vec<String>) = decoded(args)?;
                encoded(self.adb(cancellation())?.app_icons(&target, &packages)?)
            }
            "appRunning" => {
                let (target,): (Target,) = decoded(args)?;
                encoded(self.adb(cancellation())?.app_running(&target)?)
            }
            "appAction" => {
                let (target, package, version, action, consent): (
                    Target,
                    String,
                    String,
                    String,
                    bool,
                ) = decoded(args)?;
                self.adb(cancel)?
                    .app_action(&target, &package, &version, &action, consent)?;
                Ok(Value::Null)
            }
            "copyPackage" => {
                let (package,): (String,) = decoded(args)?;
                if package != "android" && !parsing::valid_package(&package) {
                    return Err("应用包名无效。".into());
                }
                app.clipboard()
                    .write_text(package)
                    .map_err(|e| e.to_string())?;
                Ok(Value::Null)
            }
            "uninstallApp" => {
                let (target, package, version, consent): (Target, String, String, bool) =
                    decoded(args)?;
                self.adb(cancel)?
                    .uninstall_app(&target, &package, &version, consent)?;
                Ok(Value::Null)
            }
            _ => Err("不支持的操作。".into()),
        }
    }
}
