# Android Device Manager（ADM）桌面设计约束

## 产品边界

Tauri 2 / Vue 3 / TypeScript / shadcn-vue / Tailwind CSS 4，面向 macOS 和 Windows 的 Android 运维工具。以设备选择、信息查看、安装和文件操作为主。保留浅色双区和设备图标；不采用网页首页的 Hero、营销卡片或移动端底栏。

## 技能依据与取舍

设计阶段使用的 UI UX Pro Max 位于本机 `.agents/skills/ui-ux-pro-max/`，仅作可选辅助工具，不随仓库提交；以下规则是项目保留的设计依据。上游来源为 https://github.com/nextlevelbuilder/ui-ux-pro-max-skill，采用版本为 `bf41cbc3ce63e30c922e58ef48741ba6133f9aa9`。

- 已运行 `developer tool desktop utility --design-system --density 8 --variance 2`。Minimalism 的简洁层级符合目标；生成的 FAQ 落地页、深色绿色配色和外部字体不符合已确认需求，未照搬或作为默认规则保存。
- 收窄检索 `Fluent 2 desktop utility --domain style -n 1`，命中 `fluent-2`：采用语义变量、低干扰层级、统一控件状态和平台适配原则；本项目为自定义桌面视觉，不宣称实现完整 Fluent 2。
- `secondary text contrast --domain ux` 命中 Contrast Readability / Color Contrast；正常文字至少 4.5:1。
- `form progressive disclosure --domain ux` 实际命中 Submit Feedback / Form Labels，只采纳标签和反馈规则；渐进展开来自技能 quick-reference 的 Forms 条目，不伪称检索命中。
- Vue 使用组合式共享状态；标签页、复选框、对话框和右键菜单以 shadcn-vue / Reka UI 作为可访问交互基础，仍遵循本项目桌面尺寸与语义配色。

## 视觉与尺寸

用户明确要求增加多种颜色的小面积点缀，不使用统一红色或陶土色主题。工作区保持白色、侧栏浅灰、正文深灰；大面积底色和标签文字不随功能染色。保留桌面工具密度，避免整页染色、渐变、发光、磨砂、插画和浮起的设备卡片。

功能色固定用于图标：设备和信息蓝色、安装包紫色、文件夹琥珀色、设备所有者青绿色；应用标识使用浅薄荷底。文件夹和在线设备图标可带浅色填充。常规按钮保持中性，主操作及键盘焦点统一蓝色，成功/错误继续使用状态色。图标、文字和选中背景共同表达含义，禁止按设备序号随机分配颜色。

局部检索 `color meaning consistency --domain ux` 命中 Color Only / Color Contrast；采用颜色之外保留文字和图标、检查对比度的规则。上述功能配色为本项目设计取舍，不宣称是技能自动生成的配色方案。

系统字体：macOS 系统字体 / Windows Segoe UI / 中文系统回退；不下载字体。正文和表单 13px，辅助文字 12px，工作区设备名 16px。间距按 4/8/12/16/24px 组合；普通控件 macOS 28px、Windows 32px，图标按钮至少 28px。此处是鼠标/键盘桌面工具，不套用手机 44/48pt 触控规则。

统一变量放在 `src/renderer/styles.css`：foreground、muted、surface、sidebar、line、control-border、accent、selection、brand、device、install、folder、owner、success、error、focus、radius、spacing、motion。正常文字对比度 >=4.5:1；用于识别控件的边界和焦点 >=3:1。淡分隔线仅作分组，不承担控件边界。

Lucide 线性图标：控件 16px、设备 24px、页头 24px，统一 1.5px 笔画。设备图标与两行文本对齐。图标不是按钮时隐藏辅助语义；只有图标的按钮必须有可访问名称。

## 页面与交互

- 左侧应用标题使用 ADM，搭配小型设备标识；正式名称 Android Device Manager 在设置页、窗口与应用菜单提供，不设中文名。不保留独立标题栏行。macOS 仅在侧栏顶部避让原生三色按钮；Windows 窗口按钮融入工作区右上角，通过 Tauri 窗口 API 最小化、最大化/还原和关闭；设备摘要避让按钮区域。应用标题与设备摘要可拖动窗口，列表和标签正常点击。
- “已连接”分组右侧显示在线数量和刷新按钮；分组始终存在，零在线设备时刷新入口仍可用。
- 侧栏设备行 52px，淡蓝灰选中底与细色标，显示名称、传输标识、图标和状态；分组标题和设备详情提供文字状态。离线设备图标保持中性灰。右键备注/隐藏保留，F2 保留。
- 侧栏最小 220px，工作区最小 640px；分隔位置保留鼠标拖动和键盘替代，不添加明显凹槽。
- 顶部只显示当前设备与连接摘要，16px 标题；标签页有图标、文字及明确选中样式，不加大幅装饰区。
- 信息页采用一致标签列和数据列；长序列号、组件名称允许换行，必要的完整信息不能只靠鼠标悬停。
- 设备所有者：先呈现当前状态；配置区域可展开，选择管理组件后保留检查、明确授权和设置三步。安装后配置流程必须自动展开，不隐藏当前失败反馈。
- 安装页的拖放区适度留白，选择文件和拖放等价；保留完整包信息、选项和目标设备。文件页保留紧凑表格和清晰工具栏。
- 对话框布局统一；标签与输入显式关联，帮助文字与错误就近显示；Esc 关闭并返回触发按钮，任务执行时禁止误关闭。
- 禁用态不能靠透明度掩盖说明。一个区域最多一个主操作；异步过程保留状态和停止等待。
- 动效仅限 100ms 控件颜色反馈与执行中指示；遵循 reduced-motion，不使用入场、弹跳、缩放动画。

## 交付检查

验证默认 1100×740、920×640 最小窗口对应的窄工作区、侧栏最小宽度、长设备名称与长组件、所有标签页、连接与设置对话框、键盘 Tab/方向键/Esc、选中/悬停/禁用和主操作文字对比度。仅支持浅色，不声称已验收深色或移动端。macOS 实测与 Windows 静态/构建检查分别记录。
