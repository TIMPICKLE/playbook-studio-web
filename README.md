**简体中文** · [English](README.en.md)

<div align="center">

<img src="docs/assets/brand/playbook-studio-logo-dark.svg" alt="Playbook Studio" width="420">

# Playbook Studio

美式橄榄球战术工作台：布阵、画路线、演练、分析攻防对位，并与球队共享战术本。

[打开云端版](https://playbook-studio-tim.kind-wolf-6204.chatgpt.site/editor/) · [无需登录体验](https://timpickle.github.io/playbook-studio-web/local.html) · [图解教程](#图解教程) · [AI 部署](#ai-agent-部署手册) · [本地开发](#本地开发)

</div>

![新版银灰工作台：左侧战术本、中央球场、下方浮动工具栏与右侧属性面板](docs/assets/readme/editor-silver.jpg)

左侧选战术，中央布阵与画线，右侧调整属性；球场下方切换「布阵与画线」和「战术演练」。以下截图均来自当前版本的本地演示，使用内置示例与 Madden 目录战术。

## 能做什么

| 场景 | 已实现的功能 |
|---|---|
| **设计战术** | 拖动攻防球员，绘制跑动、阻挡、开球前移动、传球线、覆盖区域与文字；支持曲线、选项路线、镜像、撤销和重做 |
| **讲解与演练** | 播放、暂停、循环、调速和拖动时间轴；设置路线起跑时间、跑动时长、持球人与传接球时机 |
| **建立战术本** | 按进攻、防守、特勤分类，搜索、收藏、复制，保存阵型模板、球员名单与教练笔记 |
| **导入 Madden 战术** | 从 Eagles / Ravens 目录筛选、预览和加入战术；437 个条目可直接编辑球员与路线 |
| **AI 分析攻防对位** | 在云端选择一攻一守，使用自己的模型服务与 API Key，查看条件情景、球员选择、证据和缺失信息 |
| **团队共享** | 云端自动保存、跨设备访问、战术本级成员权限、冲突处理与最近 20 个保存版本 |
| **导出与打印** | 导出 PNG、SVG、单个战术或完整战术本 JSON；打印 A4 战术本、9 格腕带卡和 Call Sheet |

界面支持简体中文和英文，可在语言菜单切换；用户输入的战术名称和笔记保留原文。详见[多语言开发说明](docs/I18N.md)。

当前界面采用银灰与石墨色，绘图与演练控件集中在球场下方的浮动工具栏。云端工作台提供「编辑战术本」和「AI分析战局」两个入口；手机和 iPad 使用传统模式及触摸操作。

## 快速开始

1. 打开[无需登录的本地演示](https://timpickle.github.io/playbook-studio-web/local.html)，选择内置示例，或点击 **「新建战术」**。
2. 拖动球员调整站位。在 **「添加对象」** 中可以加入球员，也可以一次加入完整的 **4–3 防守阵型**。
3. 选中球员，选择 **「跑动」** 或按 `R`，依次点击路线点，按 `Enter` 或点击 **「完成」**。
4. 切换到 **「战术演练」**，使用工具栏播放、暂停或调整进度；按空格也可播放 / 暂停。
5. 保存到当前浏览器，或导出 JSON 备份。需要团队共享时，使用[云端版](https://playbook-studio-tim.kind-wolf-6204.chatgpt.site/editor/)登录并创建战术本。

内置 Mesh、Four Verticals、Flood、Slants、Inside Zone、Cover 3、Nickel Blitz 和 Field Goal 八个教学示例。阵型支持 6、7、8、9、11、12 人制，并可另存自定义模板。

<details>
<summary>常用快捷键</summary>

| 操作 | 快捷键 | 操作 | 快捷键 |
|---|---|---|---|
| 选择 / 移动 | `V` | 跑动路线 | `R` |
| 阻挡 | `B` | 开球前移动 | `M` |
| 传球线 | `P` | 防守区域 / 文字 | `Z` / `T` |
| 播放 / 暂停 | `Space` | 完成路线 | `Enter` |
| 撤销 | `Ctrl / ⌘ + Z` | 重做 | `Ctrl / ⌘ + Shift + Z` |
| 取消 / 关闭 | `Esc` | 删除选中对象 | `Delete` |

</details>

## 图解教程

### 1. 选中路线，调整节点与时序

从左侧打开 **Mesh · 浅交叉**，点击球场中的一条路线。路线上的实心节点可以拖动；右侧会从「战术详情」切换成「路线设置」。

![选中 Y 的路线后，球场显示可拖动节点，右侧显示线型、曲线和动画时序设置](docs/assets/readme/route-editing-silver.jpg)

| 想做什么 | 在哪里操作 |
|---|---|
| 改变跑位方向或深度 | 拖动选中路线的实心节点 |
| 新画一条路线 | 选中球员 → 点击「跑动」或按 `R` → 点击转折点 → 按 `Enter` 完成 |
| 调整线条样式 | 右侧设置线型、颜色、末端样式或「平滑曲线」 |
| 调整起跑与到达时间 | 右侧「动画时序」设置启动延迟、跑动时长，单位为秒 |
| 撤回刚才的修改 | 点击标题右侧的撤销按钮，或按 `Ctrl / ⌘ + Z` |

### 2. 拖动时间轴，检查交叉与传接球

点击球场下方的 **「战术演练」**，再点击播放或按空格。拖动进度条可以停在指定时刻，检查球员位置；工具栏还可调整速度、循环播放或重置动画。

![Mesh 演练停在 2.6 秒的传球中阶段，底部工具栏展示播放、时间轴、速度和循环控件](docs/assets/readme/rehearsal-silver.jpg)

图中停在 **2.6 秒**，可对照交叉路线与传球位置。需要继续改图时，切回 **「布阵与画线」**；传球人、接球人和传球时机在右侧 **「足球移动」** 中设置。

## Madden 战术库

按球队、阵型大类、具体阵型或英文名称筛选，预览后拖入战术本，或点击 **「＋ 加入」**。手机端可直接使用加入按钮。导入支持去重，并提供最近一次符合条件的加入撤销。

### 3. 筛选并加入可编辑战术

1. 点击左侧 **「Madden NFL 战术库」**，选择 **Eagles** 或 **Ravens**。
2. 勾选 **「仅看可编辑」**，再选择阵型。例如下图的 **Gun → Gun Bunch TE**。
3. 点击卡片图片可放大预览；点击 **「＋ 加入可编辑版」**，或把卡片拖到左侧虚线框。
4. 关闭战术库，在工作台继续编辑。标题旁的 **「原图对照」** 可查看来源图片，**「整理锋线间距」** 可调整拥挤的站位。

![Eagles 的 Gun Bunch TE 筛选结果：仅看可编辑开关、战术卡片、加入按钮与左侧拖入区域](docs/assets/readme/madden-library-silver.jpg)

**加入后的 MESH**：原图中的路线已成为可选中、可修改的对象，可以继续调整球员、路线节点和演练时序。

![导入后的 Madden MESH：银灰工作台中展示可编辑球员、彩色路线、原图对照与锋线间距操作](docs/assets/readme/madden-editable-silver.jpg)

| 当前 Madden 27 目录快照 | 数量 |
|---|---:|
| Eagles 战术条目 | 620 |
| Ravens 战术条目 | 588 |
| **条目总计** | **1,208** |
| 可编辑条目 | 437 |
| 仅原图条目 | 771 |
| 去重后的原图文件 | 1,121 |

**可编辑战术**可以移动球员、修改可见路线、镜像和演练，并打开原图对照。导入时会整理锋线间距；已有可编辑战术也可使用「整理锋线间距」，操作支持撤销。

**原图战术**可以收藏、记录笔记、导出和打印；图片中的球员不能直接移动，原版路线不能自动演练。可编辑版本依据图片可见内容重建，图外路线、真实时序和比赛决策无法由图片确定；演练使用可调整的默认时序。

[目录数据](web/data/huddle-catalog.json) · [数据说明](docs/MADDEN_BATCH.md) · [识别记录](docs/MADDEN_REVIEW_2026-10-28-FINAL.md)

## AI 攻防对位分析

这项功能已在云端工作台提供，拥有战术本读取权限的成员均可使用：

1. 进入 **「AI分析战局」**，从同一本战术本中选择一套进攻和一套防守。
2. 可选观察位置与覆盖类型，必要时镜像防守图；这些调整只用于本次分析，不修改原战术。
3. 选择服务商，填写支持工具调用的模型名称与个人 API Key，再发起分析。
4. 查看总览与条件情景，切换观察对象，在攻防叠图中查看对应球员、路线和区域。

支持 DeepSeek（OpenAI / Anthropic 两种接口格式）、Anthropic、OpenRouter 和 OpenAI；自定义 HTTPS 服务需要管理员配置允许的主机。后端通过 **LangGraph 组织单个带只读工具的分析 Agent**，检查权限、战术版本、结果格式与证据引用；一次分析最多发起 **4 次模型请求**。

应用不持久化保存 API Key，刷新或退出后需重新填写。调用经鉴权后端转发到所选服务商，会发送所选战术的必要数据，并可能产生费用；默认不发送姓名、名单、图片和笔记，可主动附上笔记。分析区分已保存事实、几何观察和模型假设，不预测胜率或真实比赛结果。原图条目无法提供可编辑坐标，分析信息会相应受限。

[实现说明](docs/AI_MATCHUP_IMPLEMENTATION.md) · [Agent 工作流与工具](docs/AI_MATCHUP_AGENT_DESIGN.md) · [后续分析能力规划](docs/AI_MATCHUP_ANALYSIS_ROADMAP.md)

## 传统与数字化模式

| 模式 | 体验 |
|---|---|
| **传统模式** | 默认开启；平面棋子、清晰路线，关闭装饰动效，适合日常布阵与阅读 |
| **数字化模式** | 桌面可选；透视战术板、立体棋子、玻璃金属材质，以及随演练变化的路线、跑动、阻挡、传球与区域反馈 |

从右上角 **「显示模式」** 切换。下图展示银灰玻璃界面与立体棋子的**兼容视图**：本次截图环境不支持 WebGL，因此不代表完整 WebGL 3D 渲染效果。

![数字化模式的兼容视图：银灰玻璃控件、透视战术板与立体棋子](docs/assets/readme/digital-compatible-silver.jpg)

手机和 iPad 固定使用传统模式，仍可编辑和演练。WebGL 不可用时，数字化模式切换到可操作的兼容视图。系统要求减少动态效果时保留材质、停止装饰运动。

画板支持 **100–300% 缩放**、适应屏幕与调整高度；桌面还可调整宽度或展开画板。显示偏好保存在当前设备，不修改共享战术。详见[数字化战术板说明](docs/DIGITAL_BOARD.md)。

## 云端协作与数据保存

| 入口 | 使用方式 | 数据与能力 |
|---|---|---|
| [云端版](https://playbook-studio-tim.kind-wolf-6204.chatgpt.site/editor/) | 使用管理员分配的账号密码，或原有 ChatGPT 登录入口 | 云端数据库、成员权限、跨设备访问、历史版本与 AI 分析 |
| [无需登录演示](https://timpickle.github.io/playbook-studio-web/local.html) | 直接打开编辑器 | 数据保存在当前浏览器；提供绘图、演练与导入导出，不提供云端账号、共享或 AI 分析 |
| [GitHub Pages 入口](https://timpickle.github.io/playbook-studio-web/) | 项目入口与旧版迁移 | 链接云端版、导出旧浏览器数据并打开本地演示 |

云端以**战术本**为共享单位，每本的成员权限独立：管理员管理成员与恢复历史，编辑者修改战术，只读成员查看、演练、导出和打印。在「成员与权限」中可以新建成员账号或加入已有账号；邮箱邀请链接需自行复制发送。

修改自动保存，成员更新通过后台轮询同步。冲突处理会保留本机草稿，并让用户确认无法自动合并的内容；管理员可以从最近 **20 个已保存版本**恢复。断网草稿用于原设备恢复，不保证离线重新登录或冷启动。重要战术建议另存 JSON 备份。

旧版迁移需在**原设备、原浏览器**打开 GitHub Pages，导出本地战术，再在云端新建或导入时上传 JSON。两个域名的浏览器存储互相隔离；新建时上传为完整导入，编辑器内的「导入战术本」为追加导入。

独立球队层级、球队主账号和完整多租户管理仍在规划中，当前已实现的是战术本级协作。详见[云端技术说明](docs/CLOUD.md)与[多球队路线图](docs/MULTI_TENANCY_ROADMAP.md)。

## AI Agent 部署手册

把本节交给 Codex、Claude Code 或其他能操作文件和终端的 AI Agent，即可按目标环境执行部署。**先确定需要哪一种版本**：

| 目标 | 当前支持 | 数据和功能 |
|---|---|---|
| 本机体验 | Node.js 静态编辑器 | 浏览器本地保存；支持画图、演练和导入导出，不提供账号、云端共享或 AI 分析 |
| GitHub Pages / 静态托管 | 仓库已有构建脚本与 Pages 工作流 | 与本机静态版相同，数据属于访问者自己的浏览器 |
| 云端协作 | 当前实现运行在 ChatGPT Sites + Worker + D1 | 支持账号、战术本共享及 AI 对位分析；部署者需要自己的站点、数据库和平台授权 |

> **分发前必读：** `.openai/hosting.json` 中的 `project_id` 属于原项目，不能用于创建他人的站点或覆盖原站。`web/landing.html` 和 `web/cloud.js` 的云端入口目前指向原项目；发布独立副本前，Agent 应替换为部署者自己的云端地址。没有自建云端时，应按部署者意愿移除入口，或清楚标注该入口会前往原项目。不要把本项目 MIT 许可误认为涵盖 Madden / Huddle.gg 原图；公开分发前需核实素材许可。

### 一段可以直接发给 Agent 的指令

```text
请根据仓库 README 的「AI Agent 部署手册」部署 Playbook Studio。

我的目标：[本机体验 / GitHub Pages 静态版 / 我自己的 ChatGPT Sites 云端版]
目标仓库或部署平台：[填写地址或账户；本机体验可留空]
公开范围：[仅本机 / 指定范围 / 公开]

先读取 README、package.json、docs/CLOUD.md 和相关配置，检查当前分支及未提交改动。
按我的目标选择部署方式，保留现有数据；不要复用仓库中原作者的 Site ID、数据库、云端地址或凭据。
如果目标、平台权限或是否公开尚不明确，先向我确认；需要登录或密钥时，使用平台的安全授权方式，不要让我把密码或 API Key 发到对话中。
完成配置、构建和必要的检查后，在我授权的目标发布；验证实际入口、核心操作、数据保存和能力边界。
最后告诉我访问地址、部署版本、验证结果、数据保存位置，以及未完成的事项；遇到阻碍时说明真实原因，不要声称未验证的功能已可用。
```

### 路径 A：本机静态体验

需要 **Node.js 24**（项目最低要求 22.13.0）和 Git。若已有检出，请先检查分支和未提交改动；不要覆盖其他人的文件。

```bash
git clone https://github.com/TIMPICKLE/playbook-studio-web.git
cd playbook-studio-web
npm run start:local
```

浏览器打开 `http://localhost:3000/`。启动脚本会从仓库内的打包资源还原 Madden 图片；终止服务可按 `Ctrl+C`。这是开发用静态服务，不应当作为公开生产服务；数据存在当前浏览器，清理数据或换设备前请导出 JSON。

**Agent 验收：**确认页面和一张 Madden 图片可加载，尝试移动球员、画线、切换中英文、刷新后读取本地改动，并导出 JSON。静态服务不提供 `/api/*`，不要把接口 404 描述为云端部署成功。

### 路径 B：GitHub Pages / 静态托管

1. Fork 或准备一个**自己有发布权限**的仓库。先处理上面提到的原项目云端链接，不要把它们误当作自己部署的后端。
2. 确认仓库允许 GitHub Actions 运行；在仓库 **Settings → Pages → Build and deployment → Source** 选择 **GitHub Actions**。已有的 `.github/workflows/pages.yml` 会部署静态产物；若仓库的默认分支不是 `main`，先调整工作流中的分支条件。
3. 工作流在 `main` 的 `web/**`、`scripts/prepare-pages.mjs` 或该工作流文件变化时自动运行；也可在 Actions 手动运行 **Deploy GitHub Pages**。仅修改 README 不会触发该工作流。查看运行状态和 Pages 配置中的实际地址。
4. 无需 GitHub Pages 时，也可在本机生成静态文件，再由用户选择的静态托管服务发布整个 `github-pages/` 目录：

   ```bash
   node scripts/prepare-pages.mjs
   ```

   产物的 `index.html` 是入口，`local.html` 是编辑器。不要只复制 `web/` 或漏掉生成的图片资源。Pages 的具体仓库权限与设置见 [GitHub 官方说明](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site)。

**Agent 验收：**打开实际 Pages 根地址及其下的 `local.html`，验证中英文、战术编辑、刷新保存、Madden 图片和 JSON 导出；查看 Actions 是否成功。说明浏览器数据不会自动同步到其他用户或设备，也没有云端账号和 AI 分析。语言与数据在不同域名之间互不共享。

### 路径 C：自己的云端协作站点

当前云端依赖 **Vinext / Cloudflare Worker、D1 数据库（绑定名 `DB`）、数据库迁移，以及经过平台验证的身份入口**。使用 ChatGPT Sites 时，应由有权操作的部署者创建**自己的新 Site 和新数据库**，并让 Agent 按该环境提供的 Sites 工作流读取新项目配置、构建、应用迁移、发布和检查状态。不要在没有核实目标的情况下对已有站点或数据库执行初始化、重置或迁移。

初始化团队账号需要在目标站点的安全运行时配置一次性 `PLAYBOOK_SETUP_KEY`。`POST /api/auth/bootstrap` 使用 `X-Playbook-Setup-Key` 和 JSON `accounts` 列表：首个账号为 `owner`，后续为 `editor` 或 `viewer`；账号对象包含 `username`、`password`、`role` 和可选显示名称 `name`；用户名为 3–32 位，以字母开头，只能包含小写字母、数字和下划线；密码为 8–128 个字符。该接口还要求请求的 `Origin` 与站点源完全一致；成功后不可再次初始化或当作密码重置使用。初始化完成后移除一次性密钥。凭据应通过平台安全入口提供，不要写进仓库、日志、终端命令参数或聊天记录。具体约束以 `server/auth.mjs` 和 [云端架构与运维](docs/CLOUD.md) 为准。

**Agent 验收：**访问 HTTPS 登录页，检查 `/api/health`，确认匿名用户无法读取战术本；再使用授权账号验证登录、创建或读取战术本、自动保存、刷新恢复及中英文切换。按需要用两个授权账号验证成员权限；AI 分析使用各自服务商的模型与 API Key，需单独验证。报告 Site 地址、源码版本、数据库和测试结果，不要输出账号密码或密钥。

> `npm run build && npm start` 启动的是本地 Worker / Wrangler 环境，**不是**已经配置好的公网生产部署。仓库目前没有可直接运行的通用 VPS 自托管云端方案；迁移到其他 Worker / D1 平台需要另行完成部署配置、迁移和可信身份验证，不能直接信任公网请求中的 Sites 身份头。平台缺失或权限不足时，应如实报告，不能以静态页面冒充完整云端版。


## 本地开发

推荐 **Node.js 24**（仓库声明最低版本为 22.13.0）。

```bash
git clone https://github.com/TIMPICKLE/playbook-studio-web.git
cd playbook-studio-web
npm ci --ignore-scripts

# 启动静态编辑器：http://localhost:3000/
npm run start:local
```

战术图资源由脚本从仓库中的打包文件解出，显示时不需要访问第三方图片站点。静态服务适合编辑器开发；云端 API、账号和共享数据依赖 Worker / D1 运行时。

```bash
npm run check       # JavaScript 语法检查
npm run typecheck   # TypeScript 检查
npm test            # 模型、界面、权限和同步测试
npm run dev         # Vinext 开发环境
npm run build       # 准备编辑器资源并构建 Worker
```

生产构建先将 `web/` 复制到 `public/editor/`，再输出到 `dist/`。GitHub Pages 提供静态体验；ChatGPT Sites 部署使用 Cloudflare Worker 与 D1。独立服务器适配仍在规划中，不能直接把静态目录当作完整云端服务部署。

| 组成 | 主要实现 |
|---|---|
| 编辑器与演练 | 原生 JavaScript、SVG、CSS；数字化视图使用 Three.js |
| Web 与 API | Vinext、React、Cloudflare Workers |
| 云端数据 | Cloudflare D1、Drizzle |
| AI 分析 | LangGraph、LangChain，支持工具调用的第三方模型 |
| 验证 | Node.js Test Runner、Happy DOM、TypeScript |

数据库结构迁移使用 `npm run db:generate`；Madden 数据刷新使用 `npm run import:huddle`。部署、迁移与身份接入说明见 [CLOUD.md](docs/CLOUD.md)。

## 使用边界与许可

- 战术演练用于教学图示，不包含自主防守 AI 或真实比赛物理模拟；AI 对位分析也不是比赛预测器。
- 云端单份战术本请求上限约 **950 KB**。原图条目即使导出 SVG，内部仍是图片，不会自动转换成可编辑矢量路线。实际打印与腕带尺寸需按设备校准。
- 本地数据属于当前浏览器，清除浏览器数据或更换设备前请先导出；云端保存不替代个人备份。
- 项目参考公开功能独立实现，不接入 Playmaker X 后端，也未验证其文件格式兼容性。
- 源代码采用 [MIT License](LICENSE)。Madden / Huddle.gg 原始图片、游戏素材、官方运行时模板及第三方组件保留各自许可；**Madden 原图不适用本项目的 MIT 许可证**。目录来源：[Eagles](https://huddle.gg/playbooks/eagles-off/) / [Ravens](https://huddle.gg/playbooks/ravens-off/)。

## 进一步了解

[交互与视觉设计](docs/DESIGN.md) · [液态材质](docs/LIQUID_MATERIALS.md) · [验证记录](docs/VALIDATION.md) · [公开脚本调查](docs/PUBLIC_BUNDLE_STATIC_FINDINGS.md) · [调查复现说明](docs/REA_REPRODUCE.md)

---

## 赞助者

欢迎个人、团队和企业支持 Playbook Studio 的持续开发。下方为赞助者预留展示位，期待你的加入。

![三个赞助者预留展示位，等待加入](docs/assets/brand/sponsor-placeholders.svg)

**有意赞助？[通过 Issue 联系维护者](https://github.com/TIMPICKLE/playbook-studio-web/issues)。**
