# 开发与构建

[返回 README](../README.md) · [使用指南](usage.md)

## 准备环境

| 依赖    | 要求                                                          |
| ------- | ------------------------------------------------------------- |
| Node.js | 24，使用 `npm ci` 从锁文件安装依赖                            |
| Rust    | 1.99.1，由 `rust-toolchain.toml` 固定，包含 rustfmt 与 Clippy |
| Python  | Python 3，用于准备与验证打包资源                              |
| macOS   | Apple Silicon、Xcode Command Line Tools                       |
| Windows | x64、Visual Studio Build Tools 的 C++ 桌面开发组件、WebView2  |

完整平台依赖参见 [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/)。

```sh
git clone https://github.com/ruishanio/adm.git
cd adm
npm ci
```

首次构建前，运行当前系统对应的资源准备命令。脚本从 Google 官方仓库下载固定版本 Platform-Tools 并校验 SHA-256，因此需要联网。

```sh
# macOS Apple Silicon
python3 scripts/package_ci.py prepare mac arm64

# Windows x64
python scripts/package_ci.py prepare win x64
```

```sh
npm run dev
```

Vue 界面支持热更新，Rust 后端修改后由 Tauri 自动重新编译。`npm run dev:web` 仅启动前端开发服务器，不提供原生 ADB 能力，也不代表支持浏览器版产品。

开发环境可从 Android SDK、环境变量 `ANDROID_SDK_ROOT` / `ANDROID_HOME` 或 PATH 查找 ADB，也可在应用设置中指定路径。终端用户使用发布包时无需安装 Node.js、Rust 或开发工具。

## 项目结构

```text
src/renderer/          Vue 页面、组合式状态、组件与桌面样式
src/shared/            业务接口类型与多语言资源
src-tauri/src/         Rust 窗口、业务 IPC、ADB、APK 解析和偏好存储
src-tauri/             Tauri 配置、权限能力、图标与 Cargo 锁文件
tests/unit/            前端状态、组件交互与 IPC 契约测试
tests/Fixtures/        二进制清单夹具与独立测试 APK 源码
scripts/               打包、产物检查、安装验证与测试 APK 构建
docs/                  使用、开发与多语言文档
design-system/         桌面 UI 与交互约束
.github/workflows/     持续集成与 tag 打包
```

Rust 测试位于 `src-tauri/src/tests.rs` 等模块中。修改 UI 前阅读 [桌面设计约束](../design-system/android-tool/MASTER.md)，开发规范见 [AGENTS.md](../AGENTS.md)。

## 本地检查

```sh
npm run typecheck
npm test
npm run build
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo clippy --manifest-path src-tauri/Cargo.toml --locked --all-targets -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml --locked
```

`npm run build` 检查类型并构建前端；生成桌面安装包使用下面的打包命令。设备连接、APK 安装、设备所有者回读和文件传输仍需要在明确选定的目标设备上验证，自动化测试不能代替设备验收。已有验证见 [VALIDATION.md](../VALIDATION.md)。

## 本地打包

在对应平台的原生架构机器上运行：

```sh
npm run package:mac  # Apple Silicon macOS
npm run package:win  # Windows x64
```

脚本自动准备 Platform-Tools 37.0.1，校验 SHA-256，保留 ADB、必要 DLL 和 NOTICE，然后构建 Tauri 应用。仅支持 macOS ARM64 与 Windows x64，输出位于 `release/`：

| 产物                         | 用途                               |
| ---------------------------- | ---------------------------------- |
| `ADM-版本-mac-arm64.dmg`     | macOS 安装镜像                     |
| `ADM-版本-mac-arm64.zip`     | 包含 `.app` 的压缩包               |
| `ADM-版本-win-x64-setup.exe` | Windows NSIS 安装器                |
| `ADM-版本-win-x64.zip`       | Windows 便携包，需已有 WebView2    |
| `SHA256SUMS.txt`             | 分发文件校验摘要                   |
| `build-info.json`            | 版本、tag / commit、架构与产物信息 |

macOS 最低 13.3，使用系统 WKWebView；Windows 使用 WebView2，安装器在缺少运行时时联网下载。Windows 按当前用户安装，卸载保留配置。旧 Electron 安装器与当前 Tauri 安装器不同，迁移时建议先卸载旧程序再安装新版。

当前 macOS 使用 ad-hoc 签名，Windows 未签名。正式外部分发的 Developer ID 签名、公证及 Windows 代码签名需要单独配置。

## GitHub Actions

### CI

[CI 工作流](../.github/workflows/ci.yml) 在推送到 `master`、面向 `master` 的 PR 和手动触发时执行。在 macOS ARM64 与 Windows x64 上分别准备依赖，运行前端类型检查、构建与测试，以及 Rust 格式、Clippy 和测试检查。一个平台失败不会取消另一个平台。

### Tag 构建

[Package 工作流](../.github/workflows/package.yml) 由 `v*` tag 触发。tag 需匹配 `package.json` 中的版本，可带测试后缀，例如版本 `0.1.0` 对应 `v0.1.0` 或 `v0.1.0-test.1`。

流程执行检查与测试、生产构建、打包、完整性检查及安装验证：macOS 挂载 DMG 检查应用和签名；Windows 在临时 Runner 上执行静默安装、文件回读和卸载。

成功后上传 `ADM-<tag>-<平台架构>` Artifact，包含安装包、应用 ZIP 和校验信息，保留 30 天。下载入口为 [Package 运行记录](https://github.com/ruishanio/adm/actions/workflows/package.yml)，不自动创建 GitHub Release。应用内部版本仍以 `package.json` 为准，测试后缀只区分构建 tag。

CI 不连接真实 Android 设备，也不执行 APK 安装或设置设备所有者。

## 运行边界与配置

- **受控业务命令**：前端使用系统 WebView，CSP 与主窗口 capability 限制脚本及原生调用。Rust 只暴露固定业务命令，不提供通用 shell 或文件系统入口。
- **路径与设备会话**：本地文件由系统选择器或本窗口原生拖放授予路径；设备操作绑定 `transport_id`，重连后旧会话不能继续操作。
- **进程与任务**：ADB 使用参数数组，远端 shell 参数单独转义，耗时操作在后台线程运行。用户任务串行执行，轮询在操作期间使用缓存。
- **APK 与配对**：清单解析限制大小，安装前核对 SHA-256；无线配对码经 stdin 提交，不写入设置或命令参数。

配置保存位置：

| 平台    | 文件                                                       |
| ------- | ---------------------------------------------------------- |
| macOS   | `~/Library/Application Support/Android Tool/settings.json` |
| Windows | `%APPDATA%/Android Tool/settings.json`                     |

这些历史路径和应用标识 `com.ruinext.androidtool` 保留以兼容升级，存储语言、设备备注、隐藏条目、侧栏宽度与 ADB 偏好。读取时兼容旧 `AndroidTool/settings.json` 路径及 PascalCase 字段。

依赖、安装包、ADB 下载缓存、Rust target、测试报告与本机技能由 `.gitignore` 排除；依赖版本以 `package-lock.json` 和 `src-tauri/Cargo.lock` 锁定。迁移前的 Electron 实现保留在 Git 历史中，当前构建不依赖旧工程。

## 维护文档截图

README 截图位于 `docs/images/`，展示实际界面组件，设备标识、地址和文件列表使用样例数据。更新时保持截图与功能说明一致，避免包含个人文件、真实设备信息或调试悬浮层；截图只用于展示界面，不作为设备操作验收证据。
