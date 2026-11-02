# Windows 安装器分发核对

此记录用于说明实际使用的组件和验证方式，未完成的项目仍由 `release-review.json` 阻止公开发布。

## NSIS 与安装器插件

- 锁定的 Tauri CLI 为 2.12.4，其 bundler 固定下载 NSIS 3.13，归档 SHA-1 为
  `db14f8af2ea346b786c6ae19343f61aaf5e09b8e`；已下载并核对一致。
- ADM 明确使用 `zlib` 压缩和未修改的 x86-unicode 安装器。NSIS 主体、NSISdl、
  StartMenu、System、nsDialogs 及 Modern UI 的原始声明已保存在 `vendor/nsis-3.13-*`。
  上游聚合 COPYING 中同时保留未使用的压缩器条款，不代表这些压缩器进入 ADM。
- Tauri 还固定使用 `nsis_tauri_utils` 0.5.3，下载文件预期 SHA-1 为
  `75197fee3c6a814fe035788d1c34ead39349b860`，由 bundler 校验。
  原始 MIT 许可保存在 `vendor/nsis-tauri-utils-0.5.3-LICENSE-MIT.txt`。
  插件采用的 `windows-sys` 0.61.2、`windows-link` 与 Rust 标准库声明在离线清单中保留。

版本、下载地址与具体插件来自
[Tauri CLI 2.12.4 的 NSIS bundler 源码](https://github.com/tauri-apps/tauri/blob/tauri-cli-v2.12.4/crates/tauri-bundler/src/bundle/windows/nsis/mod.rs)，
原文的 SHA-256 与归档内路径记录于 `upstream.json`。

## MSVC 运行库

当前应用使用 Windows Runner 的 Visual Studio/MSVC 构建。Tauri release 构建通过
`static_vcruntime` 链接 `libcmt.lib` 和 `libvcruntime.lib`；该 crate 的 MIT 许可
仅覆盖链接辅助代码，不重新授权 Microsoft 库。`bundle.windows.bundleVCruntime`
维持默认 `false`，不把系统目录中的 Microsoft DLL 复制到安装包。

发布前仍须记录本次 Windows Runner 的 Visual Studio/MSVC 版本及实际产物依赖，
确认没有调试版运行库或未说明的额外 DLL。构建工具和 Microsoft 可分发代码的使用
受其相应条款约束，不能根据 Rust crate 的 MIT 许可推定所有二进制均为 MIT。

依据：[Microsoft C++ 文件分发说明](https://learn.microsoft.com/en-us/cpp/windows/redistributing-visual-cpp-files)
及 [Visual Studio 2022 可分发文件清单](https://learn.microsoft.com/en-us/visualstudio/releases/2022/redistribution)。

## WebView2 与安装流程

`tauri.windows.conf.json` 指定 `WINDOWS-INSTALLER.txt` 作为许可页，包含 ADM 的 MIT
原文、WebView2 Runtime 完整条款和 SmartScreen/隐私通知。缺少运行时时，安装器通过
Microsoft 官方 Evergreen Bootstrapper 下载；运行时不被 ADM 的 MIT 许可覆盖。

`scripts/verify_windows_license.py` 在 Windows CI 打开本次构建的真实安装器，进入
许可页，读取可见富文本控件并逐字归一化比对完整正文，再退出，不自动接受条款。
正文不匹配、截断或未显示页面都会阻止上传。其检查结果写入
`artifacts/windows-license-page.json`，记录安装器与许可文件摘要。
现有 `package_ci.py smoke-install` 另行检查静默安装、完整许可资源、主程序、ADB
和卸载流程。新许可页检查尚待 Windows Runner 实际执行，不能以本机语法检查替代。
