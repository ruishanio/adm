use tauri::{
    menu::{
        AboutMetadata, Menu, PredefinedMenuItem as Item, Submenu, HELP_SUBMENU_ID,
        WINDOW_SUBMENU_ID,
    },
    AppHandle,
};

/// 启动时将 ADM 偏好传给系统菜单；只覆盖本进程的易失域，不写系统或其他应用的语言设置。
/// AppKit 的自动填充、听写和窗口排列文案由系统提供，切换后需重启应用才能重新载入。
pub fn initialize_language(language: &str) {
    if !super::i18n::is_supported(language) {
        return;
    }
    use objc2_foundation::{NSArgumentDomain, NSArray, NSMutableCopying, NSString, NSUserDefaults};
    let language = NSString::from_str(match language {
        "zh-CN" => "zh-Hans",
        "zh-TW" => "zh-Hant",
        other => other,
    });
    let languages = NSArray::from_slice(&[&*language]);
    let defaults = NSUserDefaults::standardUserDefaults();
    // 保留现有启动参数；写入的值为标准属性列表数组，且 NSArgumentDomain 是只读系统常量。
    unsafe {
        let arguments = defaults
            .volatileDomainForName(NSArgumentDomain)
            .mutableCopy();
        arguments.insert(&*NSString::from_str("AppleLanguages"), languages.as_ref());
        defaults.setVolatileDomain_forName(&arguments, NSArgumentDomain);
    }
}

/// 按已保存的界面语言创建 macOS 菜单；首次尚未确定语言时使用英语，前端识别后再同步。
/// 保留系统预定义动作，使编辑快捷键、窗口操作与原生菜单行为一致。
pub fn build(app: &AppHandle, language: &str) -> tauri::Result<Menu<tauri::Wry>> {
    let text = |source| super::i18n::text(language, source);
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
                        Some(text("关于 ADM")),
                        Some(AboutMetadata {
                            name: Some("ADM".into()),
                            version: Some(app.package_info().version.to_string()),
                            ..Default::default()
                        }),
                    )?,
                    &Item::separator(app)?,
                    &Item::services(app, Some(text("服务")))?,
                    &Item::separator(app)?,
                    &Item::hide(app, Some(text("隐藏 ADM")))?,
                    &Item::hide_others(app, Some(text("隐藏其他")))?,
                    &Item::separator(app)?,
                    &Item::quit(app, Some(text("退出 ADM")))?,
                ],
            )?,
            &Submenu::with_items(
                app,
                text("文件"),
                true,
                &[&Item::close_window(app, Some(text("关闭窗口")))?],
            )?,
            &Submenu::with_items(
                app,
                text("编辑"),
                true,
                &[
                    &Item::undo(app, Some(text("撤销")))?,
                    &Item::redo(app, Some(text("重做")))?,
                    &Item::separator(app)?,
                    &Item::cut(app, Some(text("剪切")))?,
                    &Item::copy(app, Some(text("拷贝")))?,
                    &Item::paste(app, Some(text("粘贴")))?,
                    &Item::select_all(app, Some(text("全选")))?,
                ],
            )?,
            &Submenu::with_items(
                app,
                text("显示"),
                true,
                &[&Item::fullscreen(app, Some(text("切换全屏")))?],
            )?,
            // 保留 Tauri 的原生窗口/帮助菜单标识，避免翻译后丢失系统集成。
            &Submenu::with_id_and_items(
                app,
                WINDOW_SUBMENU_ID,
                text("窗口"),
                true,
                &[
                    &Item::minimize(app, Some(text("最小化")))?,
                    &Item::maximize(app, Some(text("缩放")))?,
                    &Item::separator(app)?,
                    &Item::close_window(app, Some(text("关闭窗口")))?,
                ],
            )?,
            &Submenu::with_id_and_items(app, HELP_SUBMENU_ID, text("帮助"), true, &[])?,
        ],
    )
}
