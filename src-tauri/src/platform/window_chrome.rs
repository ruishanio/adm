//! macOS 原生窗口布局；按钮的尺寸、边距和全屏恢复交由 AppKit 管理。
use objc2::MainThreadMarker;
use objc2_app_kit::{
    NSTitlebarSeparatorStyle, NSToolbar, NSWindow, NSWindowStyleMask, NSWindowToolbarStyle,
};
use tauri::{WebviewWindow, Window};

/// 在主线程为主窗口启用紧凑工具栏布局，保留透明标题区及系统窗口按钮。
/// 参数为 Tauri 主窗口；无法取得原生窗口或调用线程错误时返回启动错误。
pub fn configure(window: &WebviewWindow) -> Result<(), Box<dyn std::error::Error>> {
    let mtm = MainThreadMarker::new().ok_or("macOS 窗口布局必须在主线程设置")?;
    let pointer = window.ns_window()?;
    // 指针来自仍存活的 Tauri 窗口，仅在主线程本次调用内借用，不接管其生命周期。
    let native = unsafe { &*pointer.cast::<NSWindow>() };
    let toolbar = NSToolbar::new(mtm);
    toolbar.setAllowsUserCustomization(false);

    // 空工具栏只启用系统标题区布局；不添加操作、标题或独立的背景分隔线。
    native.setToolbarStyle(NSWindowToolbarStyle::UnifiedCompact);
    native.setToolbar(Some(&toolbar));
    toolbar.setVisible(true);
    native.setTitlebarAppearsTransparent(true);
    native.setTitlebarSeparatorStyle(NSTitlebarSeparatorStyle::None);
    Ok(())
}

/// 根据原生全屏状态同步空工具栏；普通最大化继续使用系统按钮布局。
/// 参数为发生尺寸变化的主窗口；无法取得原生窗口或不在主线程时返回错误。
pub fn sync_toolbar_visibility(window: &Window) -> Result<(), Box<dyn std::error::Error>> {
    let _mtm = MainThreadMarker::new().ok_or("macOS 工具栏状态必须在主线程同步")?;
    let pointer = window.ns_window()?;
    // 仅在主线程事件回调内借用仍存活的 NSWindow，不接管其生命周期。
    let native = unsafe { &*pointer.cast::<NSWindow>() };
    if let Some(toolbar) = native.toolbar() {
        // Overlay 内容会延伸到标题区；全屏时必须隐藏空工具栏，避免原生白条覆盖设备标题。
        // Tao 在进入和退出全屏完成后都会发送 Resized，因此退出时也会恢复系统按钮布局。
        let visible = !native.styleMask().contains(NSWindowStyleMask::FullScreen);
        if toolbar.isVisible() != visible {
            // 可见性变化本身可能触发布局事件，只在状态改变时设置以避免重复布局。
            toolbar.setVisible(visible);
        }
    }
    Ok(())
}
