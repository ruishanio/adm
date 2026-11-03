use super::{decoded, encoded};
use crate::{
    adb::process::cancellation,
    control::protocol::Input,
    models::{Result, Target},
    state::AppState,
};
use serde_json::Value;
use std::sync::Arc;
use tauri::ipc::{Channel, Response};
use tauri_plugin_dialog::DialogExt;

#[tauri::command]
pub(crate) async fn adm_control_start(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, Arc<AppState>>,
    target: Target,
    max_size: u32,
    video: Channel<Response>,
) -> Result<String> {
    if window.label() != "main" {
        return Err("请求来源无效。".into());
    }
    let service = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        service.control.start(
            service.adb(cancellation())?,
            target,
            &service.resources,
            max_size,
            video,
        )
    })
    .await
    .map_err(|e| e.to_string())?
}
impl AppState {
    pub(crate) fn control_command(
        &self,
        app: &tauri::AppHandle,
        method: &str,
        args: Value,
    ) -> Result<Value> {
        match method {
            "stopControl" => {
                let (id,): (String,) = decoded(args)?;
                self.control.stop(&id);
                Ok(Value::Null)
            }
            "controlStatus" => {
                let (id,): (String,) = decoded(args)?;
                encoded(self.control.get(&id)?.snapshot())
            }
            "controlAck" => {
                let (id, seq): (String, u64) = decoded(args)?;
                self.control.get(&id)?.acknowledge(seq);
                Ok(Value::Null)
            }
            "controlInput" => {
                let (id, input): (String, Input) = decoded(args)?;
                self.control.get(&id)?.input(input)?;
                Ok(Value::Null)
            }
            "controlStopRecording" => {
                let (id,): (String,) = decoded(args)?;
                encoded(self.control.get(&id)?.stop_recording())
            }
            "controlScreenshot" | "controlRecord" => {
                let (id,): (String,) = decoded(args)?;
                self.control.get(&id)?;
                let recording = method == "controlRecord";
                let extension = if recording { "mp4" } else { "png" };
                let chosen = app
                    .dialog()
                    .file()
                    .set_title(if recording {
                        "保存设备录像"
                    } else {
                        "保存设备截图"
                    })
                    .set_file_name(format!(
                        "ADM-{}.{}",
                        std::time::SystemTime::now()
                            .duration_since(std::time::UNIX_EPOCH)
                            .unwrap_or_default()
                            .as_secs(),
                        extension
                    ))
                    .add_filter(if recording { "MP4" } else { "PNG" }, &[extension])
                    .blocking_save_file();
                if let Some(chosen) = chosen {
                    // 原生对话框返回后重新取得会话，切换设备期间不能向旧目标继续操作。
                    let session = self.control.get(&id)?;
                    let path = chosen.into_path().map_err(|e| e.to_string())?;
                    if recording {
                        session.record(&path)?;
                    } else {
                        session.screenshot(&path)?;
                    }
                    encoded(true)
                } else {
                    encoded(false)
                }
            }
            "controlPower" => {
                let (id, action, consent): (String, String, bool) = decoded(args)?;
                if !consent || !["reboot", "shutdown"].contains(&action.as_str()) {
                    return Err("请确认设备电源操作。".into());
                }
                let session = self.control.get(&id)?;
                session.stop_recording();
                session.power(&action, consent)?;
                self.control.stop(&id);
                Ok(Value::Null)
            }
            _ => Err("不支持的操作。".into()),
        }
    }
}
