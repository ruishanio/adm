# 应用名称读取器

ADM 自有 MIT 源码，临时通过 ADB 的 `app_process` 读取主用户应用名称，不安装 APK，不要求 root，不更改应用数据。名称使用设备当前语言，由 Android `PackageManager.getApplicationLabel` 解析，支持资源及 split APK；没有名称的包回退到包名。

`app-labels.jar` 仅包含本目录 Java 源码编译出的 DEX，直接嵌入 Rust 程序。Android SDK 仅在重建此文件时使用，桌面开发、CI 打包和使用 ADM 不需要 Java 或 Android SDK。

重建（JDK 21，Android Build Tools 36.0.0，platform android-36）：

```sh
python3 scripts/build_app_labels.py --sdk /path/to/Android/sdk
```

脚本固定 ZIP 元信息；修改 Java 后必须重建并一同保存 JAR。已在 Android 10 和 13 模拟器验证。系统上下文初始化依赖 `ActivityThread` 的反射入口，厂商限制或后续 Android 变更可能导致读取失败；此时 ADM 保留包名列表，不伪造应用名称。

每次读取只上传一个带 UUID 的临时文件，用固定 ADB 传输会话运行并清理；取消时单独尝试清理，设备突然断开时可能遗留该临时文件，不跨会话追删。不会常驻或收集应用数据。

API 参考：[Android PackageManager](https://developer.android.com/reference/android/content/pm/PackageManager#getApplicationLabel(android.content.pm.ApplicationInfo))。
