# ADM 官网

独立的静态产品官网，默认英文，支持简体中文、繁体中文、日语、法语、德语、西班牙语和俄语。首屏采用带细颗粒的蓝灰渐变背景、居中的可交互 ADM 模型，以及下方的标题与下载入口；下方以蓝灰配色展示左侧功能切换、右侧对应截图，再接浅色下载区与常见问题。下载标题旁显示版本号，下方按平台排列系统要求与深色下载按钮。

## 构建与预览

本目录使用独立的 `website` 分支，不依赖桌面应用工作区。运行：

```sh
npm ci
npm run dev
```

打开 `http://127.0.0.1:5383/`。`npm run build` 检查八种语言、生成静态语言页面并验证 SEO 产物，输出到 `dist/`；`npm run preview` 在 5384 端口预览构建结果。资源从站点根路径加载，部署目标为自定义域名根目录 [adm.ruishanio.com](https://adm.ruishanio.com/)。

## 发布

官网源码在独立的 `website` 分支，桌面应用仍由 `master` 分支维护。推送 `website` 后，GitHub Actions 自动安装依赖、检查模型交互与八种语言、构建 `dist/`，再部署到 GitHub Pages。

仓库 Settings → Pages 的 Source 使用 GitHub Actions。发布流程在 `.github/workflows/pages.yml`；构建产物不提交到源码分支。仓库 About 的 Website 指向 `https://adm.ruishanio.com/`。

Settings → Environments → github-pages 的 Deployment branches and tags 需包含精确分支名 `website`，否则构建成功后仍会被环境规则阻止部署。

自定义域名在 Settings → Pages 中设置为 `adm.ruishanio.com`，阿里云 DNS 的 `adm` CNAME 指向 `ruishanio.github.io`（不带协议或路径）。等待 DNS 校验和证书签发后启用 Enforce HTTPS；此 Actions 发布方式不依赖源码中的 CNAME 文件。

## 搜索与 AI 搜索发现

- 默认英文位于 `/`，其余语言位于 `/zh-CN/`、`/zh-TW/`、`/ja/`、`/fr/`、`/de/`、`/es/`、`/ru/`。每个页面的初始 HTML 已包含对应语言正文、FAQ、下载要求和元信息，抓取时不依赖 JavaScript。
- 语言入口提供真实链接；每页有自身 canonical、全部语言的双向 hreflang 和 x-default。旧 `?lang=` 链接继续兼容，浏览器将其归一为语言路径并保留锚点与 UTM 参数。语言由网址决定，不再由本地存储自动覆盖。
- 标题、简介、Open Graph、社交卡片与 WebSite / WebPage / SoftwareApplication JSON-LD 共用 `seo.js`。软件版本来自下载区；结构化信息与可见正文一致，不虚构评分、评价或下载量，不承诺 Google 软件富结果。
- 构建生成 `/sitemap.xml` 和 `/robots.txt`，允许普通搜索与 AI 搜索抓取公开内容。`OAI-SearchBot` 负责 ChatGPT 搜索，与用于训练的 `GPTBot` 不同；当前通配规则延续公开网站默认允许抓取的行为，不单独更改训练策略。
- `npm run check:seo` 可单独复查已有产物，正式构建也自动运行：检查八种语言的无脚本正文、规范链接、语言互链、结构化信息、静态资源和站点地图。

上线后的运营步骤（需要站长账号，代码构建不等于已完成收录）：

1. 在 Google Search Console 与 Bing Webmaster Tools 验证站点所有权，提交 `https://adm.ruishanio.com/sitemap.xml`，检查首页及中文页能否抓取、是否收录。
2. 优先补充经过实际验证的中英文教程，例如「在 Mac 上安装 APK」「Android 文件传输」「Android 投屏与键鼠控制」；说明前提、步骤、限制和版本，提供稳定链接，避免堆砌关键词或生成大量重复页面。
3. 观察搜索展现、有效点击、下载转化与 AI 引荐来源；保留 `utm_source=chatgpt.com` 便于未来接入统计。本站尚未接入流量统计，也不能据此宣称排名或 AI 引用已提升。

依据：[Google AI 搜索说明](https://developers.google.com/search/docs/appearance/ai-features)、[Google 多语言页面说明](https://developers.google.com/search/docs/specialty/international/localized-versions)、[OpenAI 搜索爬虫说明](https://developers.openai.com/api/docs/bots)。Google 的 AI 搜索不要求特殊 AI 文件；不把 `llms.txt` 当作收录条件或排名保证。

## 首屏交互

布局参考 [Transmit 官网首屏](https://panic.com/transmit/)，使用本地 ADM 三台手机与底座的原始模型。顶部保留 ADM 字标、语言选择和 GitHub 图标；主下载入口位于模型与标题下方。模型贴近页头排布，首屏随内容自然延展。八种语言统一采用两行标题、相同高度的说明区和等宽下载按钮，切换语言时主内容不跳位。

- 模型经过正面向左右两侧往复摆动，左右各展示约 49°，不转到背面；比例始终不变。
- 鼠标在同一台设备上停留 220ms 后才触发拔起；实际离开插槽后息屏，再轻摇三下，期间整体暂停摆动。快速掠过或尚未离座就取消时保持亮屏。
- 移开鼠标后，设备收正插回，落座后屏幕柔和闪亮三次并保持常亮，再恢复左右摆动。
- 原插槽与拔起路径保留稳定命中区，避免设备移动后反复触发悬停。
- 触屏轻点设备切换拔起与插回，点击空白或滚动页面也会复位。
- 聚焦模型后，左右方向键选择设备；Esc 复位并暂停摆动，空格键切换左右摆动。

减少动态效果时停用自动摆动、提起轻摇与屏幕闪亮，交互直接切换姿态和亮屏状态。离开视口或切换到后台后停止渲染。模型加载失败、WebGL 不可用或上下文丢失时，显示透明背景的静态模型；正文与下载入口不受影响。

## 内容区

- 桌面端左侧四项功能（设备信息、屏幕控制、应用管理、文件管理）作为唯一切换入口，右侧显示对应截图；窄屏依次展示标题、功能列表和截图。
- 下载区标题旁显示版本号，下方为 macOS / Windows 系统要求与深色下载按钮；两个平台在同一渐变容器内并排，以间距和细分隔线分组，不嵌套子卡片；版本号以普通小字与标题文字基线对齐，窄屏纵向排列。
- 不显示截图放大入口、演示角标、连接提示、下载区指南入口、安装长说明、版本尾注、FAQ 眉题或页脚附加说明。素材归属记录保存在 `public/assets/NOTICE.txt`。

## 文件与维护

- `index.html`、`style.css`、`hero.css`：页面、通用样式与首屏布局。
- `hero-model.js`：设备分组、独立屏幕材质、悬停选取、拔起与回插状态。
- `hero-scene.js`：渲染、鼠标/触屏/键盘输入、可见性与资源释放。
- `i18n.js`、`app.js`：八种语言、四项功能与截图联动切换；中文使用中文截图，其余语言使用英文截图。
- `language-picker.js`：紧凑的语言入口与单选浮层，支持方向键、Home/End、输入定位、确认选择和 Esc 收起；选择后同步语言路径，支持浏览器前进与后退。
- `seo.js`：语言网址、产品标题、社交分享信息与结构化数据。
- `scripts/build.mjs`：文案检查、八种语言预渲染、站点地图与抓取规则生成。
- `scripts/check-seo.mjs`：构建后的搜索抓取检查。
- `scripts/check-hero-model.mjs`：独立悬停、命中稳定、轻摇、落座闪亮、双侧摆动、快速改选、未离座取消不断电与减少动态效果检查，通过 `npm run check:model` 运行。
- `public/assets/`：本分支的模型、图标、中英文截图及 Three.js 许可。

`model-fallback.png` 由同一 GLB 的默认视角直接渲染，保留透明背景。正式桌面应用图标与 GLB 不在这里修改。

文案需同步八种语言和 HTML 默认英文。中文网页显示简体中文应用截图，其余语言使用英文截图。当前下载链接指向已核实的 GitHub `v0.1.4` 安装包；版本更新后同步维护标题版本号与两个安装包链接。

截图使用真实界面组件配合演示数据，不能作为连接真实设备的在线演示。不要把内部设备信息、真实 IP、日志或个人文件加入官网资产。
