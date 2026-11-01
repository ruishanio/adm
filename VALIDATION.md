# Tauri 迁移验证记录

日期：2026-11-01。版本：1.0.0。技术栈：Tauri 2、Vue 3、TypeScript、shadcn-vue、Tailwind CSS 4。目标：macOS Apple Silicon、Windows x64。

## 本机已验证

- Vue 严格类型检查、生产构建和 11 项前端测试通过：跨设备目录缓存、重连撤销授权、跨页保留 APK、安装后展开所有者配置、组件变更撤销授权、IPC 参数契约、检查与勾选门槛、配对/连接地址区分、方向键切换、忙碌时禁止关闭、弹窗焦点恢复。
- Rust 24 项回归测试通过：真实 aapt 二进制清单、损坏偏移/ZIP、参数转义、进程取消/超时/输出上限、传输会话校验、安装版本回读、所有者执行前重查与幂等、文件同名保护、下载失败保留原内容、旧版偏好迁移。Clippy 无警告。
- 专用模拟器 `AndroidToolSmoke_20261101`（emulator-5570）通过真实安装与回读、设备所有者检查/设置/回读/重复设置、回环 TCP 连接与覆盖安装、中文/空格/引号/$ 文件名上传下载、同名保护和内容比对。已清理本次测试包、所有者、随机目录与临时 TCP 连接；未操作其他设备的安装或管理状态。
- Tauri 原生 macOS 窗口已实际读取设备信息和共享目录，系统文件选择器能读取测试 APK 的包名、版本和管理组件；右键菜单、连接对话框与三页均可使用。
- macOS ARM64 安装包已生成并通过原生程序自检、架构、包内 ADB、ZIP 完整性和临时签名检查。第一轮 DMG 10,538,432 字节，对比 Electron v1.0.0-ci.4 的 127,847,972 字节，减少约 91.8%；最终构建的精确大小以 build-info.json 为准。
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

GitHub CI 分别执行前后端构建与回归检查。tag 工作流生成 DMG、NSIS EXE 和 ZIP；macOS 只读挂载 DMG 核对内容、签名和 Applications 链接，Windows 在临时 Runner 静默安装、自检、核对 ADB 并卸载。具体结果以该 tag 的 Package 运行记录为准。

Windows 桌面窗口、贴靠、高 DPI、各厂商 USB 驱动、实体设备 USB 连接和 Android 11+ 无线配对仍需目标硬件验收。模拟器 TCP 测试不等于实体无线配对验收。macOS 为临时签名、Windows 未签名，正式签名与公证需独立完成。

Electron 和 Avalonia 的历史验证不作为本次 Tauri 验收依据；可从 Git 历史和本机忽略的源码备份查阅。
