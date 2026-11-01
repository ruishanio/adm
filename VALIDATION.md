# Electron 重构验证记录

日期：2026-11-01。版本：1.0.0。宿主系统：macOS ARM64。

后续 UI UX Pro Max 约束调整已通过 7 组 46 项测试及生产构建，窗口、键盘和配色验证详见 [界面验证记录](design-system/android-tool/VALIDATION.md)。下方设备操作与跨平台初始打包记录属于 Electron 迁移验收；本轮界面更新未重复执行设备写入测试。

## 已验证

- TypeScript 严格类型检查通过，启用未使用局部变量检查。
- 6 组、43 项自动测试通过：真实 aapt 二进制清单、ZIP 损坏、ADB 参数与取消、多设备会话、安装版本回读、所有者预检查/幂等、文件同名保护/下载失败保留旧文件、旧版偏好迁移，以及 React 跨设备目录缓存、断连撤销授权、跨页保留 APK。
- 独立模拟器 `AndroidToolSmoke_20261101`（`emulator-5570`，Android 10）验证通过：安装并回读版本、设备所有者检查/设置/回读/重复设置、回环 TCP 连接与覆盖安装、中文/空格/引号/$ 文件名传输、同名保护及下载内容比对。
- 上述模拟器测试完成后，已清理测试包、测试所有者、随机目录和本次临时 TCP 连接；未修改其他模拟器或物理设备。
- macOS Electron 真实窗口已验证：设备列表及系统信息、文件目录、系统 APK 选择器、APK 元信息、原生右键菜单、备注保存及清空、连接弹窗与输入焦点、Esc 关闭、侧栏鼠标拖动/键盘调整及 220px/640px 最小宽度。
- 开发模式真实窗口从 Vite 载入成功，React 热更新生效；开发内联脚本采用逐次 nonce，发布页面不允许内联脚本。
- macOS ARM64、macOS Intel（x64）及 Windows x64 的可运行目录和 ZIP 均已生成。两个 macOS `.app` 均通过 `codesign --verify --deep --strict` 本地临时签名校验；ARM64 发布包已实际启动，设置页确认使用包内 ADB。
- Windows Electron 官方发行文件因自动下载中断，改为从官方 GitHub Release 下载，并与 Electron 提供的 SHA-256 校验值核对后，通过 `ELECTRON_DIST` 指定解压目录完成打包。Windows 可执行文件、ADB 及依赖 DLL 已核对为 Windows 格式。
- 三个平台的应用 ASAR 均只包含构建产物和 `package.json`，不含 Avalonia、.NET 或开发依赖；macOS 包内 ADB 同时包含 ARM64 / x64 架构。
- `npm audit --omit=dev`：0 个已知漏洞。完整开发依赖树仍有 electron-builder 间接依赖 minimatch 引出的 moderate 通告，未强制跨主版本覆盖打包器内部依赖；这些依赖不进入应用 ASAR。

## 验证命令

```sh
npm run typecheck
npm test
npm run build
npm run smoke:device -- emulator-5570 artifacts/test-fixture/android-tool-fixture.apk
```

设备测试脚本会先核对模拟器名称、测试包名、现有所有者和已安装包，拒绝物理设备、业务模拟器或已有管理配置。测试 APK 构建沿用 `scripts/build_test_apk.py`，仅构建夹具需要 JDK / Android SDK build-tools。

## 尚需目标环境验收

Windows 原生窗口按钮/贴靠、高 DPI、多厂商 USB 驱动、实体设备 USB 调试和 Android 11+ 无线配对，需要在对应系统和硬件上继续验收。模拟器 TCP 连通与 mock 配对测试不等同于实体无线配对验收。macOS Intel 的构建成功也不等于 Intel 实机验收。正式外部分发需单独完成正式签名和公证。

旧版 Avalonia 源码与历史验证记录已归入本机 `artifacts/archive/avalonia-source-20261101.tar.gz`，不入库，也不作为新版验证依据。

## 首次入库前清理

2026-11-01：删除旧版分发包、已迁移 Avalonia 工程及构建产物、重复下载的技能仓库、旧设计预览和临时缓存，释放约 3.07 GiB。本机备份含 75 个旧版源码、测试和文档文件，逐文件比对通过；保留当前 ADM 应用包、测试夹具、模拟器状态及后续打包所需的运行时缓存。

补齐 `.gitignore`、`.prettierignore` 与 `.gitattributes`，将 Android 二进制清单标记为 binary，避免跨平台换行转换损坏测试夹具。清理后重新执行 `npm test`（7 组 46 项通过）和 `npm run build`（类型检查、生产构建通过）。本次仅进行仓库整理，未重新执行设备写入验收。
