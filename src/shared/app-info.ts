import metadata from '../../package.json';

// 产品名称与打包元数据保持同源，避免窗口、菜单和界面出现不同名称。
export const APP_NAME = metadata.productName;
export const APP_FULL_NAME = metadata.fullName;
// 原生快照返回前也使用构建版本，避免侧栏和设置页残留旧版号。
export const APP_VERSION = metadata.version;
