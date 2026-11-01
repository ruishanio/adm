# Android Device Manager（ADM）

[![CI](https://github.com/ruishanio/adm/actions/workflows/ci.yml/badge.svg?branch=master)](https://github.com/ruishanio/adm/actions/workflows/ci.yml)

正式名称 **Android Device Manager**，简称 **ADM**，不设中文名。项目目录继续使用 `android-tool/`。

独立的 Android 设备管理桌面应用，使用 **Tauri 2 + Vue 3 + TypeScript + shadcn-vue + Tailwind CSS 4**，仅支持 **macOS Apple Silicon（ARM64）和 Windows x64**。macOS 最低 13.3，使用系统 WKWebView；Windows 10/11 使用 WebView2，未安装时由安装器联网下载。应用不携带 Chromium 或 Node.js 运行时，不依赖 .NET、Java 或 Android Studio。ADB 随发布包附带。

源码仓库：[ruishanio/adm](https://github.com/ruishanio/adm)，SSH 地址为 `git@github.com:ruishanio/adm.git`，主分支为 `master`。

## 开发

需要 Python 3、Node.js 24、Rust 1.99.1（`rust-toolchain.toml` 固定）及平台编译工具：macOS 安装 Xcode Command Line Tools；Windows 安装 Visual Studio Build Tools 的 C++ 桌面开发组件和 WebView2。参见 [Tauri 开发环境](https://v2.tauri.app/start/prerequisites/)。

```sh
npm ci

# 首次构建先准备 ADB 资源（仅运行当前系统对应的一行）
python3 scripts/package_ci.py prepare mac arm64  # macOS
python scripts/package_ci.py prepare win x64    # Windows

npm run dev
```

Vue 界面热更新，Rust 后端修改后由 Tauri 自动重新编译。开发与测试使用 Node.js，分发包不含 Node.js。

```sh
npm run typecheck
npm test
npm run build
cargo test --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
```

开发时自动查找 Android SDK 的 platform-tools、环境变量 `ANDROID_SDK_ROOT` / `ANDROID_HOME` 或 PATH；也可在应用设置中选择 ADB。

## 持续集成

GitHub Actions 在推送到 `master`、提交面向 `master` 的 PR 或手动触发时运行。macOS 和 Windows 分别使用 Node.js 24，从锁文件安装依赖，执行 Vue/TypeScript 检查、前端构建、Rust 格式/Clippy 检查和前后端自动化测试；一个平台失败不会取消另一个平台的检查。

CI 不连接真实设备，不执行 APK 安装或设备所有者设置。常规 CI 负责构建测试；推送版本 tag 时，另由 `Package` 工作流生成分发包。

### tag 打包

推送 `v<package.json 版本>` 或带测试后缀的 tag（例如 `v1.0.0-tauri.1`）后，GitHub 生成 macOS Apple Silicon（ARM64）的 DMG、Windows x64 的安装 EXE，同时保留两端应用 ZIP。工作流使用固定版本 Platform-Tools 37.0.1 并校验 SHA-256，运行测试、生产构建、打包和产物完整性检查；macOS 挂载 DMG 核对内容与签名，Windows 在临时 Runner 上实际执行静默安装、文件回读和卸载。

在 [Package 运行记录](https://github.com/ruishanio/adm/actions/workflows/package.yml)底部的 Artifacts 下载对应平台产物，保留 30 天。下载文件中包含安装包、应用 ZIP、`SHA256SUMS.txt` 和记录 tag/commit 的 `build-info.json`；应用版本仍以 `package.json` 为准，测试后缀仅用于区分 tag。打开 DMG 后将应用拖入 Applications；Windows 运行 `ADM-版本-win-x64-setup.exe` 按向导安装，可选择安装目录。所有应用包均附带 ADB，Windows 卸载时保留用户配置。

该流程上传测试产物，不自动创建 GitHub Release；macOS 使用临时签名，Windows 未签名，正式签名、公证与目标设备验收仍需独立完成。

## 功能与操作

- **设备**：每 5 秒自动发现 USB、模拟器和网络 ADB 设备。右键备注名称、复制标识或从本机列表移除；设置中可恢复隐藏条目。备注不修改 Android 系统名称。
- **连接**：侧栏「连接设备」包含网络连接、Android 11+ 无线调试配对和 USB 指引。配对地址与连接地址的端口通常不同；配对成功后填写连接地址。USB 设备需开启调试并在设备上授权；Windows 可能需要厂商驱动。
- **设备信息**：系统版本、制造商、型号、架构、安全补丁与序列号；同页配置设备所有者。
- **安装应用**：拖入或选择一个完整 APK，读取二进制清单、版本和管理组件；覆盖安装到主用户，成功后回读包路径和版本。支持显式允许 `testOnly` 测试包，不支持拆分 APK / AAB / APKS。
- **设备所有者**：填写或选择管理组件，检查安装状态、现有所有者、用户和账号，再勾选授权执行。执行前再次检查，成功后回读确认。仅支持单一主用户（用户 0）；不移除账号、工作资料或现有所有者，也不重置设备。
- **文件管理**：默认浏览 `/sdcard`，双击文件夹进入；支持路径输入、上一级、上传单文件、下载普通文件和新建目录。上传不覆盖同名项，下载通过系统保存对话框确认覆盖。失败和取消不破坏既有本地目标文件。

浅色双区工作台：侧栏可拖动调整，最小 220px，工作区最小 640px。macOS 使用系统红黄绿按钮；Windows 使用集成于工作区的窗口按钮。快捷键 `⌘/Ctrl+O` 选择 APK、`⌘/Ctrl+R` 刷新设备或当前目录、`⌘/Ctrl+L` 连接设备、`⌘/Ctrl+,` 设置；设备行 `F2` 修改备注。

「停止等待」只终止本次 ADB 客户端，设备端已提交的安装或所有者操作可能继续，需刷新核对结果。

## 架构

UI / UX 修改遵循项目内[桌面设计约束](design-system/android-tool/MASTER.md)，入口写入 `AGENTS.md`。UI UX Pro Max 仅作为本机可选辅助工具，技能文件不随仓库提交。样式集中使用语义变量，采用中性底色、少量功能图标色、紧凑桌面控件和系统字体；设备所有者配置可展开，从安装流程进入时自动展开。

```text
src-tauri/src/      Rust 窗口、受控 IPC、ADB 服务、APK 解析与偏好存储
src-tauri/          Tauri 配置、权限能力、图标与 Cargo 锁文件
src/renderer/      Vue 页面、组合式状态、shadcn-vue 组件与桌面样式
src/shared/        前端业务接口类型
tests/unit/        Vue 状态、组件交互与 IPC 契约测试
src-tauri/src/tests.rs  Rust 解析、进程、设备操作与文件保护测试
tests/Fixtures/    真实 aapt 二进制清单与独立测试 APK 源码
scripts/           打包、产物和安装验证、测试 APK 构建
```

前端使用系统 WebView；CSP 和主窗口 capability 限制脚本与原生命令。Rust 仅暴露固定业务命令，校验参数，不提供通用 shell 或文件系统接口；文件由系统选择器或本窗口原生拖放事件授予路径。ADB 使用参数数组，远端 shell 参数单独转义，耗时操作在后台线程执行。操作绑定 `transport_id`，重连后的旧会话不能继续操作。

APK 在 Rust 中解析，限制清单和字符串池大小，安装前核对 SHA-256 指纹。用户任务串行执行；设备轮询在操作期间使用缓存。配对码经 stdin 提交，不写入设置或命令参数。配置继续沿用 macOS `~/Library/Application Support/Android Tool/settings.json` 和 Windows `%APPDATA%/Android Tool/settings.json`，保留备注、隐藏设备、侧栏宽度和 ADB 偏好；兼容读取旧 Avalonia 的 `AndroidTool/settings.json` 和 PascalCase 字段。应用标识 `com.ruinext.androidtool` 保持不变。

## 打包

打包脚本从 Google 官方仓库准备固定 Platform-Tools 37.0.1，并校验 SHA-256，只保留 ADB、必要 DLL 和 NOTICE。初次构建需要联网。

```sh
npm run package:mac  # 在 Apple Silicon macOS 构建
npm run package:win  # 在 Windows x64 构建
```

仅生成 macOS ARM64 / Windows x64，产物位于 `release/`：

- `ADM-版本-mac-arm64.dmg` 和包含 `.app` 的 ZIP。
- `ADM-版本-win-x64-setup.exe` 和便携 ZIP。便携包需要系统已安装 WebView2。
- `SHA256SUMS.txt` 和 `build-info.json`，记录版本、commit、架构、包大小与摘要。

macOS 使用临时签名，Windows 未签名；正式外部分发仍需 Developer ID 签名与公证及 Windows 代码签名。Windows 旧 Electron 安装器和 Tauri 安装器不同，迁移时建议先卸载旧程序再安装新版，用户设置保留。

## 仓库内容

仓库保留 Tauri / Vue 源码、测试夹具、构建脚本和设计约束。依赖、构建产物、安装包、ADB 下载缓存、Rust target、自动生成的 schema、测试报告、本机 UI UX Pro Max 技能、环境配置和签名私钥由 `.gitignore` 排除；依赖以 `package-lock.json` 和 `src-tauri/Cargo.lock` 锁定。

迁移前 Electron 源码可从 Git 历史 `a341b29` 获取，本机另有忽略的 `artifacts/archive/electron-before-tauri-a341b29.tar.gz` 备份。当前构建和运行均不依赖旧工程。

## 技术参考与许可

采用 [Tauri 安全与权限](https://v2.tauri.app/security/)、[Vue 3](https://vuejs.org/) 和 [shadcn-vue](https://www.shadcn-vue.com/)。图标使用 Lucide（ISC）；前端第三方许可随静态资源嵌入应用；ADB 为官方 Android SDK Platform-Tools，打包保留其 NOTICE。
