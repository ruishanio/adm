# ADM 图标矢量源文件

`adm-icon.svg` 根据已确认的三台设备图标重绘。背板、底座、前中后三台设备和 Android 标记分别分组，轮廓、屏幕、配色、渐变均可编辑；没有嵌入位图、字体或外部资源。

三个槽口分别按原图校准，各自的前壁轮廓同时用于遮挡设备底部。修改时应同步调整同一槽口的开口与前壁，避免悬浮黑缝；材质由 SVG 渐变和轻微的程序化滤镜组成。

- 画布：`1254 × 1254`，默认显示尺寸：`1024 × 1024`。
- 方形背板以外为透明区域。
- 可使用 Figma、Illustrator、Inkscape 或浏览器打开。
- 去除 `background-tile` 分组可得到不带浅色背板的标志。
- 已接入应用：macOS 使用 ICNS，Windows 使用 ICO，窗口图标使用配套 PNG。

## 更新应用图标

修改 `resources/branding/adm-icon.svg` 后，在项目根目录运行：

```sh
npm run icons:generate
```

命令使用项目锁定的 Tauri CLI，同步生成 `src-tauri/icons/` 中的 ICNS、ICO、32 / 128 / 256 / 512 像素 PNG，并更新 `icon.svg` 副本。仅保留 macOS 和 Windows 所需资源。请勿单独修改生成文件。

`src-tauri/tauri.conf.json` 已引用这些资源，开发模式重新启动或重新打包后生效。生成结果随项目保存，CI 构建无需额外安装图像工具。

## Android 标记署名

The Android robot is reproduced or modified from work created and shared by Google and used according to terms described in the [Creative Commons 3.0 Attribution License](https://creativecommons.org/licenses/by/3.0/).

参考：[Android brand guidelines](https://developer.android.com/distribute/marketing-tools/brand-guidelines)。
