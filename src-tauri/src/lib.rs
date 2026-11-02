mod adb;
mod apps;
mod commands;
mod devices;
mod files;
mod logs;
mod models;
mod parsing;
mod performance;
mod platform;
mod settings;
#[cfg(test)]
mod smoke;
mod state;
#[cfg(test)]
mod tests;
use adb::process::cancellation;
use models::Result;
use serde_json::{json, Value};
use state::AppState;
use std::sync::Arc;
use tauri::{DragDropEvent, Manager, WindowEvent};
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
            app.set_menu(platform::native_menu::build(
                app.handle(),
                &store.value.language,
            )?)?;
            app.manage(Arc::new(AppState::new(store, app.path().resource_dir()?)));
            Ok(())
        })
        .on_window_event(|window, event| {
            let Some(state) = window.try_state::<Arc<AppState>>() else {
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
                WindowEvent::Destroyed => {
                    state.stop_sessions();
                }
                _ => {}
            }
        })
        .invoke_handler(tauri::generate_handler![commands::adm_call])
        .build(tauri::generate_context!())
        .expect("ADM 启动失败")
        .run(|app, event| {
            // 原生菜单退出不保证先销毁窗口；在最终 Exit 回调返回前回收本次进程持有的客户端。
            if matches!(event, tauri::RunEvent::Exit) {
                if let Some(state) = app.try_state::<Arc<AppState>>() {
                    state.shutdown();
                } else {
                    adb::child_process::shutdown();
                }
            }
        });
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
