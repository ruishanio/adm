# scrcpy Android 服务端

固定版本 5.0.1，未修改的官方 Android 服务端。来源与 SHA-256 见 `version.json`，原许可保留在同目录 `LICENSE`。

Copyright (C) 2018–2026 Genymobile。按 Apache-2.0 分发。源码：https://github.com/Genymobile/scrcpy/tree/v5.0.1/server

ADM 自行以 Rust 实现桌面端协议、会话、输入与录像；不分发 scrcpy 的 SDL/FFmpeg 桌面客户端。内部协议与本服务端版本绑定，升级必须同步核对视频会话头和控制消息，并执行设备回归。
