# 源码获取 / Source code

ADM 自有代码以 MIT 许可提供：https://github.com/ruishanio/adm 。第三方组件保持各自许可。

## MPL 2.0 组件

本目录 `sources/` 随应用附带以下未经修改的原始 crates.io 源码归档：

- cssparser 0.37.0
- cssparser-macros 0.7.1（过程宏，保守归档）
- dtoa-short 0.3.5
- option-ext 0.2.0
- selectors 0.38.0

`.crate` 是 gzip 压缩的 tar 源码包，可用 `tar -xzf 文件名.crate` 解压。
版本、原始下载地址和 SHA-256 见 `sources.json`；摘要与 `Cargo.lock` 校验一致。
这些源码继续按 MPL 2.0 提供。源码的获取与修改权不受 ADM 的 MIT 许可或第三方运行时条款限制。

macOS：Finder 中对 ADM.app 选择「显示包内容」，进入 `Contents/Resources/legal/sources/`。
Windows：ADM 安装目录或便携版目录中的 `legal/sources/`。
仓库中也保留同样的归档，不依赖临时 GitHub Actions 产物存储。

Unmodified source archives for the five MPL-2.0 components listed above accompany
this application in `legal/sources/` (macOS: `Contents/Resources/legal/sources/`).
These `.crate` files are gzip-compressed tar archives. Exact upstream URLs and
SHA-256 hashes matching Cargo.lock are in `sources.json`. The covered source
remains available under MPL 2.0; other terms do not restrict those source rights.

## 其他组件

`catalog.json` 和 `THIRD-PARTY-NOTICES.txt` 列出 npm/crates.io 的精确版本源码地址，
原始许可和版权声明。Rust 清单保守覆盖两个平台的依赖解析结果，包含构建工具和宏，
不表示所有清单代码都进入可执行文件。标准库声明也包含本应用未启用的平台和功能。
多重许可原文均予保留；AND 义务不会被单个 MIT 标题替代。

## ADB 分发核对尚未完成

ADB 来自 Google 官方 Platform-Tools 37.0.1，build 15733141。对应压缩包的 SHA-256
固定在 `scripts/package_ci.py`。官方 NOTICE 未改动，随 platform-tools 和本许可目录交付。
开发参考源码：https://android.googlesource.com/platform/packages/modules/adb/ 。

该链接不是此二进制的完整对应源码证明。静态包含的 libusb 涉及 LGPL 2.1，仍需取得
与二进制对应的源代码、构建说明和重新链接材料，或采用经过核实的其他合规分发方式。
目前不提供无法兑现的源码书面要约，也不宣称仅有 NOTICE 就完成了这部分义务。
发布核对状态见 `release-review.json`；待办未关闭时自动产物上传会中止。

ADB source/relinking review is pending. The AOSP development repository is not
proof of source correspondence for Google's prebuilt build 15733141. Its bundled
libusb requires further LGPL compliance work. This document is not a source-code
offer and does not assert that the original NOTICE alone satisfies that work.
