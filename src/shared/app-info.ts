import metadata from '../../package.json';

// 产品名称与打包元数据保持同源，避免窗口、菜单和界面出现不同名称。
export const APP_NAME = metadata.productName;
export const APP_SHORT_NAME = metadata.shortName;
