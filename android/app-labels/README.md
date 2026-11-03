# 应用资源读取器

ADM 自有 MIT 源码，临时通过 ADB 的 `app_process` 读取主用户应用资源及进程快照，不安装 APK，不要求 root，不更改应用数据。名称使用设备当前语言，由 Android `PackageManager.getApplicationLabel` 解析，支持资源及 split APK；没有名称的包回退到包名。

`app-labels.jar` 仅包含本目录 Java 源码编译出的 DEX，直接嵌入 Rust 程序。Android SDK 仅在重建此文件时使用，桌面开发、CI 打包和使用 ADM 不需要 Java 或 Android SDK。

重建（JDK 21，Android Build Tools 36.0.0，platform android-36）：

```sh
python3 scripts/build_app_labels.py --sdk /path/to/Android/sdk
```

脚本固定 ZIP 元信息；修改 Java 后必须重建并一同保存 JAR。已在 Android 10 和 13 模拟器验证。系统上下文初始化依赖 `ActivityThread` 的反射入口，厂商限制或后续 Android 变更可能导致读取失败；此时 ADM 保留包名列表，不伪造应用名称。

读取模式（均为只读）：

- 默认模式：`ADM_LABELS_V1` 输出名称，`ADM_APPS_V1` 输出版本、主 APK / split APK 文件总大小及启动组件。每个字段独立降级，失败不填零。
- `icons <包名...>`：单次最多 24 个，`ADM_ICONS_V1` 输出 64×64 PNG；通过系统 Drawable 渲染，兼容位图、矢量和自适应图标。
- `running`：`ADM_RUNNING_V1` 输出 `RunningAppProcessInfo.pkgList` 关联到主用户的包名，包含后台及缓存进程；无法读取有效进程时返回错误，桌面端显示未知。
- `admins`：`ADM_ADMINS_V1` 输出主用户已启用的设备管理接收器及应用名称；通过 `DEVICE_ADMIN_ENABLED` 查询、`BIND_DEVICE_ADMIN` 权限和 `DeviceAdminInfo` 元数据解析筛选，不激活管理员或更改所有者。读取失败明确报错，不能当作没有候选应用。

桌面端仅为可见行请求图标，并按设备会话、包路径和版本缓存；运行状态独立串行轮询，约每 5 秒读取一次，隐藏页面后停止新请求。

每次读取只上传一个带 UUID 的临时文件，用固定 ADB 传输会话运行并清理；取消时单独尝试清理，设备突然断开时可能遗留该临时文件，不跨会话追删。不会常驻或收集应用数据。

API 参考：[Android PackageManager](https://developer.android.com/reference/android/content/pm/PackageManager#getApplicationLabel(android.content.pm.ApplicationInfo))。
