//! 平台原生集成，业务模块不直接处理桌面菜单。
#[cfg(target_os = "macos")]
pub(crate) mod native_menu;
