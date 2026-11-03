# Accessibility

English | [简体中文](#无障碍说明)

ADM aims to make desktop device management usable with a keyboard and assistive technology. The supported desktop targets are **macOS on Apple Silicon** and **Windows x64**.

## Current support and limits

- Shared controls include keyboard focus indicators and accessible names. Dialogs have titles and restore focus when closed.
- Sidebar and table-column dividers can be focused with the keyboard, adjusted with the left and right arrow keys, and reset with Home.
- Interface transitions and animations respect the system's reduced-motion preference. Live device video is separate from these interface effects.
- The mirrored Android screen is a video surface: it does not expose the device's accessibility tree to a desktop screen reader. Performance charts and virtualized lists also need further assistive-technology testing.
- Full workflows have not been comprehensively audited with VoiceOver on macOS or Narrator/NVDA on Windows. High contrast, magnification, and text scaling still need broader verification; this document does not claim complete accessibility conformance.

## Report a barrier

Use the [accessibility issue form](https://github.com/ruishanio/adm/issues/new?template=03-accessibility.yml). Describe what you were trying to do, where you got blocked, and what you expected. Include the ADM version, desktop OS, and assistive tool or display settings if relevant. You do not need to disclose a disability or medical information. Screenshots and recordings are optional; remove private data before attaching them.

For code contributions, follow [CONTRIBUTING.md](CONTRIBUTING.md): check keyboard operation, focus behavior, labels, and the affected platform, and state any untested environments.

## 无障碍说明

ADM 希望让键盘及辅助技术用户也能完成桌面设备管理。当前支持的平台为 **macOS Apple Silicon** 和 **Windows x64**。

### 当前支持与限制

- 公共控件提供键盘焦点指示及无障碍名称；弹窗包含标题，关闭后恢复焦点。
- 侧栏和表格列宽分隔线可以通过键盘聚焦，使用左右方向键调整，并通过 Home 恢复默认值。
- 界面的过渡和动画遵循系统“减少动态效果”偏好；实时设备画面不属于这些界面动画。
- Android 镜像是视频画面，不会向桌面屏幕阅读器提供设备端的无障碍节点树。性能曲线及虚拟列表也仍需更多辅助技术验证。
- 尚未使用 macOS VoiceOver、Windows 讲述人或 NVDA 对完整流程进行全面审计；高对比度、放大及文字缩放也需要更广泛验证。本说明不代表已完全符合无障碍标准。

### 反馈使用障碍

请使用[无障碍问题表单](https://github.com/ruishanio/adm/issues/new?template=03-accessibility.yml)，说明想完成的操作、遇到障碍的位置及预期行为，并提供 ADM 版本、桌面系统，以及相关的辅助工具或显示设置。不需要披露残障情况或医疗信息。截图和录屏不是必需项，提供前请移除私人信息。

参与修改时，请参考[贡献指南](resources/readme/translations/CONTRIBUTING.zh-CN.md)，验证键盘操作、焦点行为、控件名称及受影响的平台，并说明未验证的环境。
