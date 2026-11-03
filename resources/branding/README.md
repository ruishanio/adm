# ADM 图标 3D 源文件

图标由三台依次排列的设备、带真实凹腔的深色底座、薄荷绿色 Android 标记和圆角背板组成。当前采用清亮青绿背板（`#2BD9B4`）与深蓝、蓝灰、深灰机身；放大主体后仍保留圆角和透明安全边距。机身、背板配色和主体占比可通过 `scene.json` 调整。全部造型均为 3D 几何体；材质、灯光、遮挡和接触阴影由 Blender 渲染，不依赖 SVG、贴图或外部字体。

| 文件 | 用途 |
| --- | --- |
| `adm-icon.blend` | 可直接编辑的完整场景，包含模型、材质、摄像机、灯光和合成节点 |
| `adm-icon.glb` | 可在通用 3D 查看器中旋转的模型，不含背板与摄影棚 |
| `adm-icon.png` | 2048 × 2048、RGBA 透明背景的应用图标母版 |
| `scene.json` | 程序化重建时的造型、配色、相机和渲染参数 |

`scripts/render-icon.py` 提供不依赖 SVG 的参数化建模实现。槽口与机身使用同一组位置参数，两端余量对称；设备底部插入凹槽，由真实几何遮挡消除悬浮感。屏幕保持留白，摄像机采用低视角的两点透视。

## 编辑与渲染

使用 Blender 4.5 LTS 打开 `adm-icon.blend`。按集合编辑设备、底座、背板和灯光；默认已经设置好图标相机和 Cycles 渲染器。保存修改后执行：

```sh
npm run icons:render
npm run icons:generate
```

第一步渲染已保存的 `.blend`，更新 PNG 母版和 GLB 模型；第二步使用项目锁定的 Tauri CLI，将 PNG 导出为 `src-tauri/icons/` 中的 ICNS、ICO、32 / 128 / 256 / 512 像素 PNG。重新启动开发应用或重新打包后生效。

Blender 不在 PATH 或标准安装位置时，通过 `ADM_BLENDER_PATH` 指定可执行文件。例如 macOS：

```sh
ADM_BLENDER_PATH=/Applications/Blender.app/Contents/MacOS/Blender npm run icons:render
```

快速预览不会覆盖模型源文件和正式母版：

```sh
npm run icons:render -- --preview --size 768 --samples 32 --output artifacts/branding/preview.png
```

如需修改参数并重新生成全部几何，编辑 `scene.json` 后执行：

```sh
npm run icons:render -- --rebuild
```

**`--rebuild` 会覆盖 `.blend` 中手工调整的场景。** 日常在 Blender 中编辑后只需运行默认渲染命令，不要使用该参数。渲染器优先使用可用 GPU；可用 `--cpu` 强制使用 CPU。平台和 Blender 版本不同可能带来细微的光照差异。

仅调整机身、背板配色、焦距和移轴构图时，编辑 `scene.json` 的 `colors.front`、`colors.middle`、`colors.rear`、`colors.tile`、`colors.tile_edge`、`camera.lens`、`camera.shift_x` 和 `camera.shift_y`，然后执行 `npm run icons:render -- --update-style`。该模式保留现有设备、槽口、标记的几何与灯光，补偿背板尺寸以维持图标外轮廓；可加 `--preview` 先看效果，不覆盖正式源文件。

## 打包

3D 源文件和 PNG 母版保留在本目录，平台图标随项目保存。CI 和普通应用打包只使用已生成的图标，不需要 Blender，也不会将 `.blend`、`.glb` 或建模脚本带入安装包。图标生成流程不再使用 SVG。

## Android 标记署名

The Android robot is reproduced or modified from work created and shared by Google and used according to terms described in the [Creative Commons 3.0 Attribution License](https://creativecommons.org/licenses/by/3.0/).

该署名同时保存在 Blender 场景内的 `Android attribution.txt` 文本中。
