//! 更新地址、公钥和安装目标均由 Rust 决定，前端只确认已检查过的版本。
use super::{decoded, decoded_empty};
use crate::{models::Result, state::AppState};
use serde_json::{json, Value};
use std::{path::Path, time::Duration};
use tauri::{AppHandle, Emitter};
use tauri_plugin_updater::{Error, Update, UpdaterExt};

pub(crate) struct PendingUpdate {
    update: Update,
    bytes: Option<Vec<u8>>,
}

fn portable() -> bool {
    #[cfg(windows)]
    {
        // 安装器生成卸载程序；独立 EXE 或缺失标记的便携副本也不应启动 NSIS。
        std::env::current_exe()
            .ok()
            .and_then(|p| p.parent().map(Path::to_owned))
            .is_none_or(|dir| {
                dir.join("ADM-portable.txt").is_file() || !dir.join("uninstall.exe").is_file()
            })
    }
    #[cfg(not(windows))]
    false
}

fn installable() -> bool {
    if cfg!(windows) {
        return !portable();
    }
    // 开发模式下当前可执行文件并不在 .app 内，不能让更新器替换开发目录。
    std::env::current_exe().ok().is_some_and(|p| {
        p.ends_with("Contents/MacOS/adm")
            && p.ancestors()
                .nth(3)
                .and_then(Path::extension)
                .is_some_and(|ext| ext == "app")
    })
}

impl AppState {
    /// 处理检查、下载和安装；args 仅允许版本字符串，返回界面摘要或空结果。
    pub(crate) fn update_command(
        &self,
        app: &AppHandle,
        method: &str,
        args: Value,
    ) -> Result<Value> {
        let mut pending = self
            .pending_update
            .try_lock()
            .map_err(|_| self.localized("更新操作正在进行。"))?;
        if method == "checkUpdate" {
            decoded_empty(args)?;
            let builder = app.updater_builder().timeout(Duration::from_secs(120));
            #[cfg(windows)]
            let builder = {
                use std::sync::Arc;
                use tauri::Manager;
                let handle = app.clone();
                builder.on_before_exit(move || {
                    // Windows 安装器直接退出进程，不会走普通 Exit 回调。
                    handle.state::<Arc<AppState>>().stop_sessions();
                    crate::adb::child_process::suspend_for_update();
                    handle.cleanup_before_exit();
                })
            };
            let updater = builder.build().map_err(|e| e.to_string())?;
            let next = tauri::async_runtime::block_on(updater.check())
                .map_err(|_| self.localized("无法获取更新清单，请稍后重试。"))?;
            let info = next.as_ref().map(|item| {
                json!({
                    "version": item.version, "notes": item.body, "portable": portable(),
                })
            });
            *pending = next.map(|update| PendingUpdate {
                update,
                bytes: None,
            });
            return Ok(json!(info));
        }
        let (version,): (String,) = decoded(args)?;
        let item = pending
            .as_mut()
            .filter(|p| p.update.version == version)
            .ok_or_else(|| self.localized("请重新检查更新。"))?;
        #[cfg(windows)]
        if method == "openPortableUpdate" && portable() {
            // 版本已经按 SemVer 解析，只允许打开官方仓库对应版本的便携 ZIP。
            let url = format!("https://github.com/ruishanio/adm/releases/download/v{version}/ADM-{version}-win-x64.zip");
            std::process::Command::new(
                Path::new(&std::env::var_os("SystemRoot").ok_or("SystemRoot")?)
                    .join("explorer.exe"),
            )
            .arg(url)
            .status()
            .map_err(|e| e.to_string())?;
            return Ok(Value::Null);
        }
        if !installable() {
            return Err(self.localized("请从已安装的 ADM 打开更新。"));
        }
        match method {
            "downloadUpdate" => {
                let mut received = 0u64;
                let mut last = None;
                item.bytes = Some(
                    tauri::async_runtime::block_on(item.update.download(
                        |chunk, total| {
                            received += chunk as u64;
                            if let Some(size) = total.filter(|n| *n > 0) {
                                let percent = (100 * received / size).min(100);
                                if last != Some(percent) {
                                    last = Some(percent);
                                    let _ = app.emit_to("main", "adm-update-progress", percent);
                                }
                            }
                        },
                        || {},
                    ))
                    .map_err(|error| match error {
                        Error::Minisign(_)
                        | Error::SignatureUtf8(_)
                        | Error::Base64(_)
                        | Error::SignedVersionMismatch { .. }
                        | Error::MissingSignedVersion => {
                            self.localized("更新包未通过签名校验，请重新下载。")
                        }
                        other => other.to_string(),
                    })?,
                );
            }
            "installUpdate" => {
                // 与设备写任务共用锁，下载后再次检查实时录像，允许忙时稍后重试而无需重下。
                let _operation = self
                    .begin()
                    .map_err(|_| self.localized("请等设备操作完成后再更新。"))?;
                if self.control.is_recording() {
                    return Err(self.localized("请先结束设备录像，再安装更新。"));
                }
                let bytes = item
                    .bytes
                    .as_ref()
                    .ok_or_else(|| self.localized("请先下载更新。"))?;
                item.update.install(bytes).map_err(|e| {
                    #[cfg(windows)]
                    crate::adb::child_process::resume_after_failed_update();
                    e.to_string()
                })?;
                app.restart();
            }
            _ => return Err("不支持的操作。".into()),
        }
        Ok(Value::Null)
    }
}
