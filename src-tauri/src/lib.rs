mod adb;
mod apk;
mod device_info;
mod models;
#[cfg(target_os = "macos")]
mod native_menu;
mod parsing;
mod process;
mod settings;
#[cfg(test)]
mod smoke;
#[cfg(test)]
mod tests;
use models::*;
use process::{cancellation, Cancel};
use serde::{de::DeserializeOwned, Serialize};
use serde_json::{json, Value};
use std::{
    collections::HashSet,
    path::PathBuf,
    sync::{atomic::Ordering, Arc, Mutex},
};
use tauri::{DragDropEvent, Manager, WindowEvent};
use tauri_plugin_clipboard_manager::ClipboardExt;
use tauri_plugin_dialog::DialogExt;
struct Service {
    store: Mutex<settings::SettingsStore>,
    devices: Mutex<Vec<Device>>,
    apk: Mutex<Option<apk::ApkRecord>>,
    active: Mutex<Option<Cancel>>,
    drops: Mutex<HashSet<PathBuf>>,
    resources: PathBuf,
}
struct Operation<'a>(&'a Service, Cancel);
impl Drop for Operation<'_> {
    fn drop(&mut self) {
        *self.0.active.lock().unwrap() = None;
    }
}
impl Service {
    fn begin(&self) -> Result<Operation<'_>> {
        let mut active = self.active.lock().unwrap();
        if active.is_some() {
            return Err("另一项操作正在执行，请等待完成。".into());
        }
        let cancel = cancellation();
        *active = Some(cancel.clone());
        Ok(Operation(self, cancel))
    }
    fn cancel(&self) {
        if let Some(cancel) = self.active.lock().unwrap().as_ref() {
            cancel.store(true, Ordering::SeqCst);
        }
    }
    fn adb(&self, cancel: Cancel) -> Result<adb::Adb> {
        Ok(adb::Adb::new(
            settings::find_adb(&self.store.lock().unwrap().value.adb_path, &self.resources)?,
            cancel,
        ))
    }
    fn update(&self, apply: impl FnOnce(&mut Settings)) -> Result<()> {
        let mut store = self.store.lock().unwrap();
        let mut next = store.value.clone();
        apply(&mut next);
        store.save(next)
    }
    fn inspect(&self, path: PathBuf, cancel: &Cancel) -> Result<Value> {
        let record = apk::read_apk(&path, cancel)?;
        let info = encoded(&record.info)?;
        *self.apk.lock().unwrap() = Some(record);
        Ok(info)
    }
    /// 分发主窗口业务请求：app 提供原生对话框，method/args 为方法名及参数数组；返回 JSON 结果或中文错误。
    fn dispatch(&self, app: tauri::AppHandle, method: String, args: Value) -> Result<Value> {
        if method == "cancel" {
            let (): () = decoded_empty(args)?;
            self.cancel();
            return Ok(Value::Null);
        }
        if method == "refresh" {
            decoded_empty(args)?;
            let store = self.store.lock().unwrap().value.clone();
            let mut error = None;
            let mut adb_path = String::new();
            match self.adb(cancellation()) {
                Ok(adb) => {
                    adb_path = adb.executable.to_string_lossy().into_owned();
                    if self.active.lock().unwrap().is_none() {
                        match adb.devices() {
                            Ok(list) => *self.devices.lock().unwrap() = list,
                            Err(e) => {
                                error = Some(e);
                                self.devices.lock().unwrap().clear();
                            }
                        }
                    }
                }
                Err(e) => {
                    error = Some(e);
                    self.devices.lock().unwrap().clear();
                }
            }
            let devices: Vec<_> = self
                .devices
                .lock()
                .unwrap()
                .iter()
                .filter(|d| !store.hidden_devices.contains(&d.serial))
                .cloned()
                .collect();
            return Ok(
                json!({"devices":devices,"settings":store,"adbPath":adb_path,"platform":if cfg!(windows){"win32"}else{"darwin"},"version":app.package_info().version.to_string(),"error":error}),
            );
        }
        let operation = self.begin()?;
        let cancel = operation.1.clone();
        match method.as_str() {
            "details" => {
                let (target,): (Target,) = decoded(args)?;
                encoded(self.adb(cancel)?.details(&target)?)
            }
            "connect" => {
                let (endpoint,): (String,) = decoded(args)?;
                let endpoint = self.adb(cancel)?.connect(&endpoint)?;
                self.update(|s| {
                    s.endpoint = endpoint.clone();
                    s.hidden_devices.retain(|v| v != &endpoint);
                })?;
                Ok(Value::Null)
            }
            "pair" => {
                let (endpoint, code): (String, String) = decoded(args)?;
                self.adb(cancel)?.pair(&endpoint, &code)?;
                Ok(Value::Null)
            }
            "chooseApk" => {
                decoded_empty(args)?;
                let path = app
                    .dialog()
                    .file()
                    .set_title("选择 APK")
                    .add_filter("Android 安装包", &["apk"])
                    .blocking_pick_file();
                match path {
                    Some(path) => {
                        self.inspect(path.into_path().map_err(|e| e.to_string())?, &cancel)
                    }
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
                self.inspect(path, &cancel)
            }
            "install" => {
                let (target, id, allow_test): (Target, String, bool) = decoded(args)?;
                let record = self.apk.lock().unwrap().clone().ok_or("请先选择安装包。")?;
                if record.info.id != id {
                    return Err("安装包已变化，请重新选择。".into());
                }
                if apk::file_hash(&record.path, &cancel)? != record.hash {
                    return Err("APK 文件内容已变化，请重新选择并核对。".into());
                }
                self.adb(cancel)?
                    .install(&target, &record.info, &record.path, allow_test)?;
                Ok(Value::Null)
            }
            "checkOwner" => {
                let (target, name): (Target, String) = decoded(args)?;
                encoded(self.adb(cancel)?.check_owner(&target, &name)?)
            }
            "setOwner" => {
                let (target, name, consent): (Target, String, bool) = decoded(args)?;
                if !consent {
                    return Err("请明确确认设备所有者授权。".into());
                }
                self.adb(cancel)?.set_owner(&target, &name)?;
                Ok(Value::Null)
            }
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
                    .set_menu(native_menu::build(&app, &language).map_err(|e| e.to_string())?)
                    .map_err(|e| e.to_string())?;
                if let Err(error) = self.update(|s| s.language = language) {
                    // 保存失败时前端保持原语言，原生菜单也恢复，避免两套界面语言不一致。
                    #[cfg(target_os = "macos")]
                    {
                        let restored = match previous_menu {
                            Some(menu) => app.set_menu(menu),
                            None => app.remove_menu(),
                        };
                        restored.map_err(|e| format!("{error}；恢复菜单失败：{e}"))?;
                    }
                    return Err(error);
                }
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
fn decoded<T: DeserializeOwned>(value: Value) -> Result<T> {
    serde_json::from_value(value).map_err(|_| "请求参数不正确，请重新选择设备或文件。".into())
}
fn decoded_empty(value: Value) -> Result<()> {
    if value == json!([]) {
        Ok(())
    } else {
        Err("操作不接受额外参数。".into())
    }
}
fn encoded(value: impl Serialize) -> Result<Value> {
    serde_json::to_value(value).map_err(|e| e.to_string())
}
#[tauri::command]
async fn adm_call(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, Arc<Service>>,
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
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .setup(|app| {
            let config = dirs::config_dir().unwrap_or_default();
            let local = dirs::data_local_dir().unwrap_or_default();
            let store = settings::SettingsStore::load(
                settings::data_path(),
                &[
                    config.join("AndroidTool/settings.json"),
                    local.join("AndroidTool/settings.json"),
                ],
            );
            // 菜单与界面使用同一份偏好；重启时不再回到框架默认的英文菜单。
            #[cfg(target_os = "macos")]
            app.set_menu(native_menu::build(app.handle(), &store.value.language)?)?;
            app.manage(Arc::new(Service {
                store: Mutex::new(store),
                devices: Mutex::new(vec![]),
                apk: Mutex::new(None),
                active: Mutex::new(None),
                drops: Mutex::new(HashSet::new()),
                resources: app.path().resource_dir()?,
            }));
            Ok(())
        })
        .on_window_event(|window, event| {
            let Some(state) = window.try_state::<Arc<Service>>() else {
                return;
            };
            match event {
                WindowEvent::DragDrop(DragDropEvent::Drop { paths, .. }) => {
                    let mut grants = state.drops.lock().unwrap();
                    grants.clear();
                    if paths.len() == 1 {
                        grants.insert(paths[0].clone());
                    }
                }
                WindowEvent::Destroyed => state.cancel(),
                _ => {}
            }
        })
        .invoke_handler(tauri::generate_handler![adm_call])
        .run(tauri::generate_context!())
        .expect("ADM 启动失败");
}

/// 检查安装目录内的原生程序与 ADB，返回构建版本及架构；不使用开发机 SDK 回退路径。
pub fn self_check() -> Result<Value> {
    let executable = std::env::current_exe().map_err(|e| e.to_string())?;
    let root = executable.parent().ok_or("主程序目录无效")?;
    let resources = if cfg!(target_os = "macos") {
        root.join("../Resources")
    } else {
        root.to_path_buf()
    };
    let adb = resources
        .join("platform-tools")
        .join(if cfg!(windows) { "adb.exe" } else { "adb" });
    if !adb.is_file() {
        return Err("安装目录缺少 ADB".into());
    }
    let version = adb::Adb::new(adb, cancellation()).simple(&["version"])?;
    if !version.contains("Android Debug Bridge version") {
        return Err("随包 ADB 无法运行".into());
    }
    Ok(
        json!({"framework":"Tauri 2","version":env!("CARGO_PKG_VERSION"),"arch":std::env::consts::ARCH,"adb":version}),
    )
}
