本目录是 ADM 自有测试素材，用于验证资源名称、自适应图标和多个管理 Receiver。
preview.apk 仅含编译资源与清单，不含代码、未签名，不用于安装。

重新生成：使用 Android SDK 的 aapt2 compile --dir res -o /tmp/adm-preview-res.zip，然后 aapt2 link -I "$ANDROID_SDK_ROOT/platforms/android-35/android.jar" --manifest AndroidManifest.xml -o preview.apk /tmp/adm-preview-res.zip。SDK 仅用于重新生成测试素材，ADM 运行时不依赖 SDK。
