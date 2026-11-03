use super::{decoded, encoded};
use crate::{
    adb::process::{cancellation, Cancel},
    logs,
    models::*,
    state::AppState,
};
use serde_json::{json, Value};
use tauri_plugin_dialog::DialogExt;

impl AppState {
    pub(crate) fn logs_command(
        &self,
        app: &tauri::AppHandle,
        method: &str,
        args: Value,
        _cancel: Cancel,
    ) -> Result<Value> {
        match method {
            "startLogcat" => {
                let (target,): (Target,) = decoded(args)?;
                encoded(self.logs.start(self.adb(cancellation())?, target)?)
            }
            "readLogcat" => {
                let (id, after): (String, u64) = decoded(args)?;
                encoded(self.logs.read(&id, after)?)
            }
            "stopLogcat" => {
                let (id,): (String,) = decoded(args)?;
                self.logs.stop(&id);
                Ok(Value::Null)
            }
            "logcatApps" => {
                let (target,): (Target,) = decoded(args)?;
                encoded(self.adb(cancellation())?.logcat_apps(&target)?)
            }
            "exportLogcat" => {
                let (id, filter, through): (String, logs::LogFilter, u64) = decoded(args)?;
                let text = self.logs.export(&id, filter, through)?;
                let path = app
                    .dialog()
                    .file()
                    .set_title(self.localized("导出日志"))
                    .set_file_name("logcat.log")
                    .add_filter("Logcat", &["log", "txt"])
                    .blocking_save_file();
                if let Some(path) = path {
                    logs::save_export(&path.into_path().map_err(|e| e.to_string())?, &text)?;
                    return Ok(json!(true));
                }
                Ok(json!(false))
            }
            _ => Err("不支持的操作。".into()),
        }
    }
}
