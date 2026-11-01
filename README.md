# Android Device Manager（ADM）

正式名称 **Android Device Manager**，简称 **ADM**，不设中文名。项目目录继续使用 `android-tool/`。

独立的 Android 设备管理桌面应用，使用 **Electron + React + TypeScript**，支持 macOS 和 Windows。运行时不依赖 .NET、Java 或 Android Studio。ADB 随发布包附带。

## 开发

需要 Node.js 22.12+（建议 Node.js 24）。

```sh
npm ci
npm run dev
```

React 界面支持热更新；修改主进程或 preload 后重新运行开发命令。

```sh
npm run typecheck
npm test
npm run build
npm start
```

开发时自动查找 Android SDK 的 platform-tools、环境变量 `ANDROID_SDK_ROOT` / `ANDROID_HOME` 或 PATH；也可在应用设置中选择 ADB。

## 功能与操作

- **设备**：每 5 秒自动发现 USB、模拟器和网络 ADB 设备。右键备注名称、复制标识或从本机列表移除；设置中可恢复隐藏条目。备注不修改 Android 系统名称。
- **连接**：侧栏「连接设备」包含网络连接、Android 11+ 无线调试配对和 USB 指引。配对地址与连接地址的端口通常不同；配对成功后填写连接地址。USB 设备需开启调试并在设备上授权；Windows 可能需要厂商驱动。
- **设备信息**：系统版本、制造商、型号、架构、安全补丁与序列号；同页配置设备所有者。
- **安装应用**：拖入或选择一个完整 APK，读取二进制清单、版本和管理组件；覆盖安装到主用户，成功后回读包路径和版本。支持显式允许 `testOnly` 测试包，不支持拆分 APK / AAB / APKS。
- **设备所有者**：填写或选择管理组件，检查安装状态、现有所有者、用户和账号，再勾选授权执行。执行前再次检查，成功后回读确认。仅支持单一主用户（用户 0）；不移除账号、工作资料或现有所有者，也不重置设备。
- **文件管理**：默认浏览 `/sdcard`，双击文件夹进入；支持路径输入、上一级、上传单文件、下载普通文件和新建目录。上传不覆盖同名项，下载通过系统保存对话框确认覆盖。失败和取消不破坏既有本地目标文件。

浅色双区工作台：侧栏可拖动调整，最小 220px，工作区最小 640px。macOS 使用系统红黄绿按钮；Windows 使用原生标题栏覆盖按钮。快捷键 `⌘/Ctrl+O` 选择 APK、`⌘/Ctrl+R` 刷新设备或当前目录、`⌘/Ctrl+L` 连接设备、`⌘/Ctrl+,` 设置；设备行 `F2` 修改备注。

「停止等待」只终止本次 ADB 客户端，设备端已提交的安装或所有者操作可能继续，需刷新核对结果。

## 架构

UI / UX 修改遵循项目内 [UI UX Pro Max 技能](.agents/skills/ui-ux-pro-max/SKILL.md)与[桌面设计约束](design-system/android-tool/MASTER.md)，入口写入 `AGENTS.md`。样式集中使用语义变量，采用中性底色、少量功能图标色、紧凑桌面控件和系统字体；设备所有者配置可展开，从安装流程进入时自动展开。

```text
src/main/          Electron 窗口、白名单 IPC、ADB 服务、APK 解析与偏好存储
src/preload/       contextBridge 固定业务 API，拖放 File 转受控本地路径
src/renderer/      React 页面、统一桌面控件样式与交互
src/shared/        跨进程类型契约
tests/unit/        解析、进程取消、会话校验、安装/所有者回读和文件保护测试
tests/Fixtures/    真实 aapt 二进制清单与独立测试 APK 源码
scripts/           构建、打包与专用模拟器验证
```

渲染层启用 `sandbox`、`contextIsolation`，禁用 Node 集成；IPC 校验来源及参数，不提供通用 shell 执行接口。ADB 使用异步子进程和参数数组，远端 shell 参数单独转义。操作绑定 `transport_id`，重连后的旧会话不能继续操作。

APK 在主进程解析，限制清单和字符串池大小，安装前核对 SHA-256 指纹。用户任务串行执行；设备轮询在操作期间使用缓存。配对码经 stdin 提交，不写入设置或命令参数。改名后固定沿用 Electron `appData/Android Tool/` 作为 `userData` 和会话目录，配置仍位于其下的 `settings.json`，保留备注、隐藏设备、侧栏宽度和 ADB 偏好；仍兼容读取旧 Avalonia 的 `AndroidTool/settings.json`。应用标识 `com.ruinext.androidtool` 保持不变，避免仅因产品改名而产生第二套数据。

## 打包

准备对应系统的官方 platform-tools（包含 `NOTICE.txt` 和 `source.properties`）。

```sh
ADB_DIR=/path/to/mac/platform-tools npm run package:mac
ADB_DIR=/path/to/windows/platform-tools npm run package:win
```

默认 macOS ARM64；Intel 版本执行 `npm run build` 后 `node scripts/package.mjs mac --x64`。macOS 默认 SDK 目录为 `~/Library/Android/sdk/platform-tools`，Windows 默认使用 `vendor/windows/platform-tools`。产物写入 `release/`，打包脚本校验 ADB 的平台格式。

打包生成 `Android Device Manager.app`、Windows 的 `Android Device Manager.exe`，ZIP 使用 `ADM-版本-mac/win-架构.zip`。当前为本地开发分发，正式外部分发需 Developer ID 签名与公证、Windows 代码签名。平台原生交互与真实 USB／无线配对应在目标系统和硬件上验收。

## 仓库内容

仓库保留 Electron / React 源码、测试夹具、构建脚本、设计约束和固定版本的 UI UX Pro Max 技能。依赖、构建产物、安装包、ADB / Electron 下载缓存、测试报告、模拟器数据、环境配置和签名私钥由 `.gitignore` 排除；依赖版本以 `package-lock.json` 为准。

迁移前的 Avalonia 工程已移出当前源码树。清理时将其源码、测试与文档校验备份到本机 `artifacts/archive/avalonia-source-20261101.tar.gz`，该备份不入库，当前开发、构建和测试均不依赖它。

## 技术参考与许可

采用 [Electron 隔离与安全实践](https://www.electronjs.org/docs/latest/tutorial/security)、[系统窗口按钮](https://www.electronjs.org/docs/latest/tutorial/custom-title-bar)及 [webUtils 文件拖放 API](https://www.electronjs.org/docs/latest/api/web-utils)。图标使用 Lucide（ISC）；ADB 为官方 Android SDK Platform-Tools，打包保留其 NOTICE。
