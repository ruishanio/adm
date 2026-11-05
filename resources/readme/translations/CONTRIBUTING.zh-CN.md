# 参与 ADM 开发

[English](../../../CONTRIBUTING.md) | **简体中文**

[返回 README](README.zh-CN.md)

修改前请阅读 [AGENTS.md](../../../AGENTS.md)。本文说明开发环境、项目结构和验证方式。

前端使用 **Vue 3、TypeScript、Tailwind CSS 4 与 shadcn-vue**，桌面框架为 **Tauri 2**。Rust 后端处理 ADB、设备操作及本地资源；界面使用系统 WebView，不内置 Chromium 或 Node.js 运行时。

设备控制的桌面端由 Rust 实现会话、协议、输入与 MP4 封装，前端使用 WebCodecs 解码；Android 端使用基于 scrcpy 修改的 ADM 服务端。具体版本、来源与许可见 [服务端说明](../../../src-tauri/resources/scrcpy/README.md)。

## 社区协作与反馈

请遵守[行为准则](../../../CODE_OF_CONDUCT.md#行为准则)。问题反馈、功能建议及无障碍问题可以使用 [Issue 表单](https://github.com/ruishanio/adm/issues/new/choose)，支持中文或英文。提交前请检索已有问题，并移除日志或截图中的私人信息。

安全漏洞请通过[安全政策](../../../SECURITY.md#安全政策)中的私密渠道反馈，不要发布到公开 Issue 或 PR。无障碍支持、已知限制及反馈方式见[无障碍说明](../../../ACCESSIBILITY.md#无障碍说明)。

## 本地开发

需要 Node.js 24、Python 3.10+、rustup，以及 [Tauri 平台开发依赖](https://v2.tauri.app/start/prerequisites/)。Rust 版本和组件由 [rust-toolchain.toml](../../../rust-toolchain.toml) 固定。macOS 需 Xcode Command Line Tools；Windows 需 MSVC C++ 构建工具和 WebView2。

```sh
git clone https://github.com/ruishanio/adm.git
cd adm
npm ci
```

准备对应平台的 ADB 资源，以下两条命令选择一条执行。脚本会从 Google 官方源下载固定版本并验证 SHA-256，同时校验仓库内的 scrcpy 服务端。

```sh
# macOS Apple Silicon
python3 scripts/package_ci.py prepare mac arm64

# Windows x64
python scripts/package_ci.py prepare win x64
```

```sh
npm run dev
```

`npm run dev` 启动完整 Tauri 应用；`npm run dev:web` 仅启动前端开发服务器，普通浏览器中无法直接执行 ADB 操作。

## 检查与打包

```sh
npm test
npm run build
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo clippy --manifest-path src-tauri/Cargo.toml --locked --all-targets -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml --locked
python3 -m unittest discover -s tests/release -v
```

Windows 的 Python 命令使用 `python`。`npm run build` 包含模块边界检查、TypeScript 检查和前端生产构建，不生成桌面安装包。

在对应系统中生成安装包和应用 ZIP，产物位于 `release/`：

```sh
# macOS Apple Silicon
npm run package:mac

# Windows x64
npm run package:win
```

打包脚本会准备资源、构建应用并验证分发包。macOS DMG 的窗口、图标位置和英文安装引导由 [layout.json](../../../resources/dmg/layout.json) 管理；DMG 构建工具隔离在 `artifacts/dmg-tools/`，不随应用分发。

[CI](../../../.github/workflows/ci.yml) 在 macOS 与 Windows 上执行检查和测试。[Package](../../../.github/workflows/package.yml) 在版本 tag 推送后构建两个平台；分发包与安装验证全部通过后发布 Release。公开附件为两平台的安装包与 ZIP，构建记录和校验清单保存于 Actions 的 `release-records-<tag>` Artifact。

Package 也支持手动 **Run workflow** 验证构建。手动运行只上传 Actions 构建附件，即使选择 tag 也不会发布 Release。

### macOS 签名与公证

运行 Package 前，在仓库 **Actions Secrets** 中配置：

| Secret | 内容 |
| --- | --- |
| `APPLE_CERTIFICATE` | Developer ID Application `.p12` 的 Base64，包含私钥和证书链 |
| `APPLE_CERTIFICATE_PASSWORD` | 导出 `.p12` 时设置的密码 |
| `APPLE_SIGNING_IDENTITY` | 完整的 `Developer ID Application: 组织名称 (TEAMID)` 身份 |
| `APPLE_ID` | Apple 账户邮箱 |
| `APPLE_PASSWORD` | Apple **App 专用密码**，不是账户登录密码 |
| `APPLE_TEAM_ID` | 与证书一致的开发者团队 ID |

macOS 任务会把凭据导入临时钥匙串，为 ADM 和内置原生工具添加安全时间戳及强化运行时签名，再公证应用、附加票据并生成最终 ZIP 和 DMG；DMG 会独立签名、公证及附加票据。上传前检查 Gatekeeper、ZIP 解压和 DMG 挂载结果。缺少凭据、公证拒绝或超时会直接失败，不会发布未公证的替代包。退出时清理临时钥匙串，签名材料不进入构建附件；公证诊断保存在 `notarization-<run-id>-<attempt>` 附件中。

普通 CI/PR 检查和 Windows 构建不接触上述 Secrets。本地 `npm run package:mac` 仍使用临时签名；需要正式签名时，安全注入上述六项环境变量后运行 `python3 scripts/notarize_macos.py`，最后运行 `python3 scripts/package_ci.py verify mac arm64` 更新校验清单。不要将密码写入 shell 历史、跟踪文件或日志。参见 [Apple 公证流程](https://developer.apple.com/documentation/security/customizing-the-notarization-workflow)。

## 目录结构

```text
src/
  app/                 # 根布局、依赖注入与跨功能协调
  features/            # 设备、性能、控制、应用、文件、日志与设置
  shared/              # 公共 UI、样式、工具与通信协议
src-tauri/
  src/
    commands/          # IPC 入口与参数校验
    adb/               # ADB 定位、执行与进程管理
    devices/ apps/ files/ logs/ performance/ control/
    settings/ platform/
    state.rs           # 会话、任务与资源生命周期
  resources/           # 随应用打包的 ADB 与 scrcpy 服务端资源
resources/             # 图标设计源、DMG 配置与 README 图片
scripts/               # 开发、构建、打包和发布脚本
tests/                 # 前端及发布流程测试、APK 测试样例
```

模块边界和协作规范见 [AGENTS.md](../../../AGENTS.md)。

## 提交改动

- 保持功能模块边界，新增关键逻辑的注释使用中文。
- 提交消息采用 Conventional Commits：英文类型、中文主题，例如 `fix(apps): 修复应用列表刷新`。
- PR 标题与说明使用中文，写清问题、行为变化和验证结果。涉及破坏性变更时，说明影响范围与迁移方式。
- 界面改动验证默认及最小窗口、键盘交互、长文本和禁用状态；按 [AGENTS.md](../../../AGENTS.md) 检查全部六个标签页。区分实际验证与未验证的平台。

修改 README 截图时，使用仓库中的实际界面组件，并注明演示数据；避免公开真实设备标识、内网地址与个人文件。

README 以根目录英文版为基准，翻译位于 `resources/readme/translations/`。修改功能说明时，同步更新各语言版本；中英文贡献指南也应保持一致。
