# Tauri 迁移验证记录

日期：2026-11-01。版本：1.0.0。技术栈：Tauri 2、Vue 3、TypeScript、shadcn-vue、Tailwind CSS 4。目标：macOS Apple Silicon、Windows x64。

## 本机已验证

- Vue 严格类型检查、生产构建和 11 项前端测试通过：跨设备目录缓存、重连撤销授权、跨页保留 APK、安装后展开所有者配置、组件变更撤销授权、IPC 参数契约、检查与勾选门槛、配对/连接地址区分、方向键切换、忙碌时禁止关闭、弹窗焦点恢复。
- Rust 24 项回归测试通过：真实 aapt 二进制清单、损坏偏移/ZIP、参数转义、进程取消/超时/输出上限、传输会话校验、安装版本回读、所有者执行前重查与幂等、文件同名保护、下载失败保留原内容、旧版偏好迁移。Clippy 无警告。
- 专用模拟器 `AndroidToolSmoke_20261101`（emulator-5570）通过真实安装与回读、设备所有者检查/设置/回读/重复设置、回环 TCP 连接与覆盖安装、中文/空格/引号/$ 文件名上传下载、同名保护和内容比对。已清理本次测试包、所有者、随机目录与临时 TCP 连接；未操作其他设备的安装或管理状态。
- Tauri 原生 macOS 窗口已实际读取设备信息和共享目录，系统文件选择器能读取测试 APK 的包名、版本和管理组件；右键菜单、连接对话框与三页均可使用。已在 920 × 640 最小窗口核对内容换行，并实际拖动侧栏验证 220 最小宽度和工作区宽度约束。
- macOS ARM64 安装包已生成并通过原生程序自检、架构、包内 ADB、ZIP 完整性和临时签名检查。
- 分发包无 Electron、Chromium、Node/Bun 运行时。macOS 使用系统 WKWebView；Windows 使用 WebView2，缺失时安装器联网下载。

## 验证命令

```sh
npm run build
npm test
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo clippy --manifest-path src-tauri/Cargo.toml --locked --all-targets -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml --locked
npm run package:mac
```

专用模拟器测试默认忽略。需要先构建 `scripts/build_test_apk.py` 的测试夹具，并显式设置环境变量：

```sh
ADM_SMOKE_SERIAL=emulator-5570 \
ADM_SMOKE_APK="$PWD/artifacts/test-fixture/android-tool-fixture.apk" \
cargo test --manifest-path src-tauri/Cargo.toml smoke::dedicated_emulator -- --ignored --nocapture
```

测试先核对专用 AVD 名称、固定夹具包名、已有所有者和安装状态；拒绝物理设备、业务模拟器或已存在夹具的环境。CI 不执行此测试，也不连接真实设备。

## 跨平台验证边界

[常规 CI](https://github.com/ruishanio/adm/actions/runs/41285085728) 的 macOS、Windows 构建与回归检查均已通过。[测试 tag v1.0.0-tauri.3 的 Package 工作流](https://github.com/ruishanio/adm/actions/runs/41285085763) 也在两端全部通过，产物对应提交 `c8ff91ca2efc216f2b318bb650600ed2fd134a8d`。

该工作流生成 DMG、NSIS EXE 和 ZIP；macOS 已只读挂载 DMG 核对内容、签名和 Applications 链接，Windows 已在临时 Runner 静默安装、逐字节核对安装内容、运行原生自检及内置 ADB，并成功卸载。Windows 打包禁用安装器类型二进制补丁，使安装版与便携版主程序保持一致；项目没有依赖该补丁的自动更新器。

最终安装包体积如下，前后均保留内置 ADB，按字节计算降幅：

| 平台 | Electron v1.0.0-ci.4 | Tauri v1.0.0-tauri.3 | 减少 |
| --- | ---: | ---: | ---: |
| macOS ARM64 DMG | 127,847,972 | 10,525,463 | 91.77% |
| Windows x64 NSIS EXE | 124,598,730 | 4,975,450 | 96.01% |

GitHub 两份产物已下载至本机忽略目录 `release/ci/mac-arm64/`、`release/ci/win-x64/`，已核对外层 artifact SHA-256，以及内层安装包、ZIP 的体积、SHA-256、tag 和提交号。各平台同时保留 `build-info.json` 和 `SHA256SUMS.txt`；本地路径不进入 Git。

Windows 桌面窗口、贴靠、高 DPI、各厂商 USB 驱动、实体设备 USB 连接和 Android 11+ 无线配对仍需目标硬件验收。模拟器 TCP 测试不等于实体无线配对验收。原生拖放事件和授权边界已实现并检查；本轮实际 APK 输入验证使用系统文件选择器，尚未手动验收 Finder 拖入动作。macOS 为临时签名、Windows 未签名，正式签名与公证需独立完成。

Electron 和 Avalonia 的历史验证不作为本次 Tauri 验收依据；可从 Git 历史和本机忽略的源码备份查阅。
