//! IPC 边界保持固定业务协议；只读会话与串行写操作在这里统一分流。
mod apps;
mod devices;
mod files;
mod logs;
mod performance;
mod settings;
use crate::{adb::process::cancellation, models::Result, state::AppState};
use serde::{de::DeserializeOwned, Serialize};
use serde_json::{json, Value};
use std::sync::Arc;
use tauri::Manager;
impl AppState {
    pub(crate) fn dispatch(
        &self,
        app: tauri::AppHandle,
        method: String,
        args: Value,
    ) -> Result<Value> {
        if method == "cancel" {
            decoded_empty(args)?;
            self.cancel();
            return Ok(Value::Null);
        }
        // 连续只读会话不抢占安装/文件任务；其他命令沿用同一个互斥与取消生命周期。
        let operation = if matches!(
            method.as_str(),
            "refresh"
                | "appIcons"
                | "appRunning"
                | "startPerformance"
                | "samplePerformance"
                | "stopPerformance"
                | "startLogcat"
                | "readLogcat"
                | "stopLogcat"
                | "logcatApps"
                | "exportLogcat"
        ) {
            None
        } else {
            Some(self.begin()?)
        };
        let cancel = operation
            .as_ref()
            .map(|value| value.1.clone())
            .unwrap_or_else(cancellation);
        match method.as_str() {
            "refresh" | "details" | "connect" | "pair" | "checkOwner" | "setOwner" => {
                self.devices_command(&app, &method, args, cancel)
            }
            "chooseApk" | "inspectApk" | "install" | "listApps" | "appDetails" | "appIcons"
            | "appRunning" | "appAction" | "copyPackage" | "uninstallApp" => {
                self.apps_command(&app, &method, args, cancel)
            }
            "listFiles" | "mkdir" | "upload" | "renameFile" | "deleteFile" | "download" => {
                self.files_command(&app, &method, args, cancel)
            }
            "startLogcat" | "readLogcat" | "stopLogcat" | "logcatApps" | "exportLogcat" => {
                self.logs_command(&app, &method, args, cancel)
            }
            "startPerformance" | "samplePerformance" | "stopPerformance" => {
                self.performance_command(&app, &method, args, cancel)
            }
            "rename" | "hide" | "copySerial" | "restore" | "sidebarWidth" | "language"
            | "chooseAdb" | "resetAdb" => self.settings_command(&app, &method, args, cancel),
            _ => Err("不支持的操作。".into()),
        }
    }
}
pub(crate) fn decoded<T: DeserializeOwned>(value: Value) -> Result<T> {
    serde_json::from_value(value).map_err(|_| "请求参数不正确，请重新选择设备或文件。".into())
}
pub(crate) fn decoded_empty(value: Value) -> Result<()> {
    if value == json!([]) {
        Ok(())
    } else {
        Err("操作不接受额外参数。".into())
    }
}
pub(crate) fn encoded(value: impl Serialize) -> Result<Value> {
    serde_json::to_value(value).map_err(|e| e.to_string())
}
#[tauri::command]
pub(crate) async fn adm_call(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, Arc<AppState>>,
    method: String,
    args: Value,
) -> Result<Value> {
    if window.label() != "main" || method.len() > 32 || args.to_string().len() > 16384 {
        return Err("请求来源或参数无效。".into());
    }
    let service = state.inner().clone();
    let app = window.app_handle().clone();
    tauri::async_runtime::spawn_blocking(move || service.dispatch(app, method, args))
        .await
        .map_err(|e| e.to_string())?
}
