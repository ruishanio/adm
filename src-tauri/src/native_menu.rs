use tauri::{
    menu::{
        AboutMetadata, Menu, PredefinedMenuItem as Item, Submenu, HELP_SUBMENU_ID,
        WINDOW_SUBMENU_ID,
    },
    AppHandle,
};

/// 按已保存的界面语言创建 macOS 菜单；首次尚未确定语言时使用英语，前端识别后再同步。
/// 保留系统预定义动作，使编辑快捷键、窗口操作与原生菜单行为一致。
pub fn build(app: &AppHandle, language: &str) -> tauri::Result<Menu<tauri::Wry>> {
    let text = |zh, en| if language == "zh-CN" { zh } else { en };
    Menu::with_items(
        app,
        &[
            &Submenu::with_items(
                app,
                "ADM",
                true,
                &[
                    &Item::about(
                        app,
                        Some(text("关于 ADM", "About ADM")),
                        Some(AboutMetadata {
                            name: Some("ADM".into()),
                            version: Some(app.package_info().version.to_string()),
                            ..Default::default()
                        }),
                    )?,
                    &Item::separator(app)?,
                    &Item::services(app, Some(text("服务", "Services")))?,
                    &Item::separator(app)?,
                    &Item::hide(app, Some(text("隐藏 ADM", "Hide ADM")))?,
                    &Item::hide_others(app, Some(text("隐藏其他", "Hide Others")))?,
                    &Item::separator(app)?,
                    &Item::quit(app, Some(text("退出 ADM", "Quit ADM")))?,
                ],
            )?,
            &Submenu::with_items(
                app,
                text("文件", "File"),
                true,
                &[&Item::close_window(
                    app,
                    Some(text("关闭窗口", "Close Window")),
                )?],
            )?,
            &Submenu::with_items(
                app,
                text("编辑", "Edit"),
                true,
                &[
                    &Item::undo(app, Some(text("撤销", "Undo")))?,
                    &Item::redo(app, Some(text("重做", "Redo")))?,
                    &Item::separator(app)?,
                    &Item::cut(app, Some(text("剪切", "Cut")))?,
                    &Item::copy(app, Some(text("拷贝", "Copy")))?,
                    &Item::paste(app, Some(text("粘贴", "Paste")))?,
                    &Item::select_all(app, Some(text("全选", "Select All")))?,
                ],
            )?,
            &Submenu::with_items(
                app,
                text("显示", "View"),
                true,
                &[&Item::fullscreen(
                    app,
                    Some(text("切换全屏", "Toggle Full Screen")),
                )?],
            )?,
            // 保留 Tauri 的原生窗口/帮助菜单标识，避免翻译后丢失系统集成。
            &Submenu::with_id_and_items(
                app,
                WINDOW_SUBMENU_ID,
                text("窗口", "Window"),
                true,
                &[
                    &Item::minimize(app, Some(text("最小化", "Minimize")))?,
                    &Item::maximize(app, Some(text("缩放", "Zoom")))?,
                    &Item::separator(app)?,
                    &Item::close_window(app, Some(text("关闭窗口", "Close Window")))?,
                ],
            )?,
            &Submenu::with_id_and_items(app, HELP_SUBMENU_ID, text("帮助", "Help"), true, &[])?,
        ],
    )
}
