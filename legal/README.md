# ADM 许可材料维护

`LICENSE` 是 ADM 自有代码的 MIT 许可副本。第三方条款独立适用，不能统一改写为 MIT。
`catalog.json` 用于内部材料校验，不在界面中逐项展示；`THIRD-PARTY-NOTICES.txt` 是可直接阅读的完整文本，
可从“设置 → 第三方许可 → 查看完整声明”用系统文本应用离线打开。
`sources/` 保存 MPL 原始源码；`vendor/` 保存独立 SDK、图形和 crate 补充声明；
`upstream.json` 记录其来源及摘要。

## 更新依赖后

1. `npm ci`，安装 `rust-toolchain.toml` 指定的 Rust 工具链及文档组件。
2. 审查新增依赖许可、启用 features、复制代码和第三方二进制。缺少正文的 crate 必须补取匹配提交的原始条款，记录进 `upstream.json`，不得用泛用 MIT 覆盖未知许可。
3. 在项目根目录运行 `python3 scripts/generate-licenses.py`（Windows 用 `python`）。生成器读取两个目标的 Cargo metadata、锁文件和本机包原文；日常构建不会重新联网生成。
4. 审阅 `legal/` 差异，运行 `npm run licenses:check`、`npm test`、`npm run build`。构建还核对 Vite 实际打包的所有前端组件均有许可。
5. 分别构建 macOS ARM64 / Windows x64，校验 ZIP、安装后资源及源码归档。源码与应用一起保留，不能仅依赖会过期的 CI 下载链接。
6. 在 `release-review.json` 如实保留待办、证据与分发决策。只有全部核实才标为 `ready`；当前决定继续官方 ADB 方案，使用 `open-review` + `retain-official-adb`，不把未核实事项写成已完成。`npm run licenses:release-check` 仍校验全部材料完整性和决策记录；默认 `pending` 状态继续阻止上传。

第三方原文不翻译或删减；中文说明不替代原条款。完整多重许可文本均保留，明确的 OR
表达式优先选择 MIT，记录于 `selection`；AND 表达式对应的声明须同时保留。清单包含构建依赖是保守归档，不是
宣称它们全部进入二进制。应用依赖系统字体和 macOS WebKit，不复制系统文件。

## 发布待办

- ADB：37.0.1-15733141 的实际静态组件与对应源码、libusb 重新链接材料。
- Windows 预检已完成实际安装、许可页全文、NSIS 插件及运行库来源检查，见 [验证记录](WINDOWS-DISTRIBUTION.md)。WebView2 Runtime 的终端用户条款与隐私通知不能由 SDK 的 BSD 许可替代。
- 分发者应核实自己的 Xcode / Windows 构建工具使用授权。此目录不代替对工具链协议的接受或权利人的法律判断。

上游依据：

- [MPL 2.0](https://www.mozilla.org/en-US/MPL/2.0/)
- [Android 品牌指南](https://developer.android.com/distribute/marketing-tools/brand-guidelines)
- [WebView2 分发](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/distribution)
- [WebView2 官方运行时条款入口](https://developer.microsoft.com/en-us/microsoft-edge/webview2/)
- [NSIS 许可](https://nsis.sourceforge.io/Docs/AppendixI.html)
- [Microsoft C++ 运行库分发](https://learn.microsoft.com/en-us/cpp/windows/redistributing-visual-cpp-files)
