use super::{decoded, encoded};
use crate::{models::*, process::Cancel, service::Service};
use serde_json::{json, Value};
use tauri_plugin_dialog::DialogExt;

impl Service {
    pub(crate) fn files_command(
        &self,
        app: &tauri::AppHandle,
        method: &str,
        args: Value,
        cancel: Cancel,
    ) -> Result<Value> {
        match method {
            "listFiles" => {
                let (target, path): (Target, String) = decoded(args)?;
                encoded(self.adb(cancel)?.list_files(&target, &path)?)
            }
            "mkdir" => {
                let (target, path, name): (Target, String, String) = decoded(args)?;
                self.adb(cancel)?.mkdir(&target, &path, &name)?;
                Ok(Value::Null)
            }
            "upload" => {
                let (target, path, kind): (Target, String, String) = decoded(args)?;
                let picker = app.dialog().file();
                let chosen = match kind.as_str() {
                    "files" => picker.set_title("上传文件到设备").blocking_pick_files(),
                    "folders" => picker.set_title("上传文件夹到设备").blocking_pick_folders(),
                    _ => return Err("不支持的上传类型。".into()),
                };
                if let Some(chosen) = chosen {
                    let adb = self.adb(cancel)?;
                    for (index, item) in chosen.into_iter().enumerate() {
                        let local = item.into_path().map_err(|e| e.to_string())?;
                        adb.upload(&target, &local, &path).map_err(|e| {
                            format!(
                                "已上传 {index} 项；{} 上传失败：{e}",
                                local.file_name().unwrap_or_default().to_string_lossy()
                            )
                        })?;
                    }
                    Ok(json!(true))
                } else {
                    Ok(json!(false))
                }
            }
            "renameFile" => {
                let (target, directory, name, next): (Target, String, String, String) =
                    decoded(args)?;
                self.adb(cancel)?
                    .rename_file(&target, &directory, &name, &next)?;
                Ok(Value::Null)
            }
            "deleteFile" => {
                let (target, directory, name, consent): (Target, String, String, bool) =
                    decoded(args)?;
                self.adb(cancel)?
                    .delete_file(&target, &directory, &name, consent)?;
                Ok(Value::Null)
            }
            "download" => {
                let (target, path): (Target, String) = decoded(args)?;
                let name = path.rsplit('/').next().unwrap_or("download");
                let chosen = app
                    .dialog()
                    .file()
                    .set_title("下载设备文件")
                    .set_file_name(name)
                    .blocking_save_file();
                if let Some(chosen) = chosen {
                    self.adb(cancel)?.download(
                        &target,
                        &path,
                        &chosen.into_path().map_err(|e| e.to_string())?,
                    )?;
                    Ok(json!(true))
                } else {
                    Ok(json!(false))
                }
            }
            _ => Err("不支持的操作。".into()),
        }
    }
}
