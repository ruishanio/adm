# ADM Android 投屏服务端

源码取自 [scrcpy v5.0.1 的 server 目录](https://github.com/Genymobile/scrcpy/tree/v5.0.1/server)，保留上游 Java、AIDL 和测试。ADM 在 SurfaceEncoder 中增加故障切换，并用会话头的保留位报告兼容模式。控制、旋转、录像请求关键帧仍走原控制通道。

正常设备优先使用 MediaCodec。x86_64 Android 6.0 及以上设备遇到系统编码器创建或运行失败时，可在同一会话内切换到进程内 OpenH264，最高长边 1280、30 FPS。无新帧、断线或主动关闭不会触发切换。桌面端收到带参数集的关键帧后，在本次运行中按设备序列号与 ADB transport ID 记住模式。

## 构建

在 macOS 或 Linux 上准备 JDK 21、Android SDK Platform 36、Build Tools 36.0.0、NDK r27c、GNU make、NASM 和 Python 3。设置 `ANDROID_HOME`、`ANDROID_NDK_HOME` 后，从仓库根目录运行：

```sh
python3 android/scrcpy-server/build.py
python3 android/scrcpy-server/build.py --check
```

构建脚本校验并编译 OpenH264 v2.6.0 源码，将 JNI 库与 DEX 写入同一 JAR，并更新 `src-tauri/resources/scrcpy/` 的产物、摘要和声明。常规桌面构建直接使用已校验的产物。第一次运行构建脚本需要下载 OpenH264 源码。

## 设备验证

`ADM_CONTROL_COMPAT_SERIAL` 仅用于显式指定已知编码器故障的测试机。该测试会启动系统编码器、验证自动切换及 MP4 录制，并确认在相同 ADB 连接上重开投屏不会再次启动故障编码器。

```sh
cargo test --manifest-path src-tauri/Cargo.toml real_encoder_crash_falls_back_and_reconnects -- --ignored
```
