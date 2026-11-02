use super::{decoded, decoded_empty};
#[cfg(target_os = "macos")]
use crate::native_menu;
use crate::{adb, models::*, process::Cancel, service::Service};
use serde_json::{json, Value};
use tauri_plugin_clipboard_manager::ClipboardExt;
use tauri_plugin_dialog::DialogExt;

impl Service {
    pub(crate) fn settings_command(
        &self,
        app: &tauri::AppHandle,
        method: &str,
        args: Value,
        cancel: Cancel,
    ) -> Result<Value> {
        match method {
            "rename" => {
                let (serial, name): (String, String) = decoded(args)?;
                if serial.is_empty() || serial.len() > 512 || name.chars().count() > 80 {
                    return Err("设备备注参数无效。".into());
                }
                self.update(|s| {
                    if name.trim().is_empty() {
                        s.device_names.remove(&serial);
                    } else {
                        s.device_names.insert(serial, name.trim().into());
                    }
                })?;
                Ok(Value::Null)
            }
            "hide" => {
                let (serial,): (String,) = decoded(args)?;
                if serial.is_empty() || serial.len() > 512 {
                    return Err("设备标识无效。".into());
                }
                self.update(|s| {
                    if !s.hidden_devices.contains(&serial) {
                        s.hidden_devices.push(serial);
                    }
                })?;
                Ok(Value::Null)
            }
            "copySerial" => {
                let (serial,): (String,) = decoded(args)?;
                if serial.len() > 512 {
                    return Err("设备标识无效。".into());
                }
                app.clipboard()
                    .write_text(serial)
                    .map_err(|e| e.to_string())?;
                Ok(Value::Null)
            }
            "restore" => {
                decoded_empty(args)?;
                self.update(|s| s.hidden_devices.clear())?;
                Ok(Value::Null)
            }
            "sidebarWidth" => {
                let (width,): (f64,) = decoded(args)?;
                if !width.is_finite() || !(220.0..=3000.0).contains(&width) {
                    return Err("侧栏宽度无效。".into());
                }
                self.update(|s| s.sidebar_width = width)?;
                Ok(Value::Null)
            }
            "language" => {
                let (language,): (String,) = decoded(args)?;
                if !["zh-CN", "en"].contains(&language.as_str()) {
                    return Err("不支持的界面语言。".into());
                }
                #[cfg(target_os = "macos")]
                let previous_menu = app
                    .set_menu(native_menu::build(app, &language).map_err(|e| e.to_string())?)
                    .map_err(|e| e.to_string())?;
                let saved = self.update(|s| s.language = language);
                #[cfg(target_os = "macos")]
                if let Err(error) = &saved {
                    // 保存失败时前端保持原语言，原生菜单也恢复，避免两套界面语言不一致。
                    let restored = match previous_menu {
                        Some(menu) => app.set_menu(menu),
                        None => app.remove_menu(),
                    };
                    restored.map_err(|e| format!("{error}；恢复菜单失败：{e}"))?;
                }
                saved?;
                Ok(Value::Null)
            }
            "chooseAdb" => {
                decoded_empty(args)?;
                let chosen = app
                    .dialog()
                    .file()
                    .set_title("选择 ADB 可执行文件")
                    .blocking_pick_file();
                if let Some(chosen) = chosen {
                    let path = chosen.into_path().map_err(|e| e.to_string())?;
                    let name = path
                        .file_name()
                        .unwrap_or_default()
                        .to_string_lossy()
                        .to_lowercase();
                    if name != if cfg!(windows) { "adb.exe" } else { "adb" } {
                        return Err("请选择官方 platform-tools 中的 adb。".into());
                    }
                    if !adb::Adb::new(path.clone(), cancel)
                        .simple(&["version"])?
                        .contains("Android Debug Bridge")
                    {
                        return Err("该程序不是有效的 ADB。".into());
                    }
                    self.update(|s| s.adb_path = path.to_string_lossy().into_owned())?;
                    Ok(json!(true))
                } else {
                    Ok(json!(false))
                }
            }
            "resetAdb" => {
                decoded_empty(args)?;
                self.update(|s| s.adb_path.clear())?;
                Ok(Value::Null)
            }
            _ => Err("不支持的操作。".into()),
        }
    }
}
