# scrcpy Android 服务端

ADM 以 [scrcpy v5.0.1](https://github.com/Genymobile/scrcpy/tree/v5.0.1/server) 为基础构建，源码和构建脚本位于 ADM 仓库的 `android/scrcpy-server/`。本版修改了视频编码故障处理，并添加 OpenH264 兼容模式。版本与 SHA-256 记录在 `version.json`。

- scrcpy，Copyright (C) 2018–2026 Genymobile。Apache-2.0，见 `LICENSE`。
- OpenH264，Copyright (c) 2013, Cisco Systems。从 [v2.6.0 源码](https://github.com/cisco/openh264/tree/v2.6.0) 构建设备端编码器，见 `OpenH264-LICENSE.txt`。
- 随 JNI 库链接的 Android NDK 运行库声明见 `NDK-Runtime-NOTICE.txt`。

Rust 桌面端处理协议、会话、输入与录像。升级服务端时需验证视频会话头、控制消息和设备兼容模式。
