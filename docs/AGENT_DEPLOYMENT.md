# AI Agent 部署手册

**简体中文** · [English](AGENT_DEPLOYMENT.en.md) · [返回 README](../README.md)

把本节交给 Codex、Claude Code 或其他能操作文件和终端的 AI Agent，即可按目标环境执行部署。**先确定需要哪一种版本**：

| 目标 | 当前支持 | 数据和功能 |
|---|---|---|
| 本机体验 | Node.js 静态工作台 | 浏览器本地保存，支持球员管理、画图、演练、导入导出与 AI 分析演示，不提供账号或云端共享 |
| GitHub Pages / 静态托管 | 仓库已有构建脚本与 Pages 工作流 | 与本机静态版相同，数据属于访问者自己的浏览器 |
| 云端协作 | 当前实现运行在 ChatGPT Sites + Worker + D1 | 支持账号、战术本共享及 AI 对位分析；部署者需要自己的站点、数据库和平台授权 |

> **分发前必读：** `.openai/hosting.json` 中的 `project_id` 属于原项目，不能用于创建他人的站点或覆盖原站。`web/landing.html` 和 `web/cloud.js` 的云端入口目前指向原项目；发布独立副本前，Agent 应替换为部署者自己的云端地址。没有自建云端时，应按部署者意愿移除入口，或清楚标注该入口会前往原项目。不要把本项目 MIT 许可误认为涵盖 Madden / Huddle.gg 原图；公开分发前需核实素材许可。

### 一段可以直接发给 Agent 的指令

```text
请根据 docs/AGENT_DEPLOYMENT.md 部署 Playbook Studio。

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

   产物的 `index.html` 是卡片工作台，`local.html` 可直达编辑器，`landing.html` 保留旧版迁移指南。不要只复制 `web/` 或漏掉生成的图片资源。Pages 的具体仓库权限与设置见 [GitHub 官方说明](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site)。

**Agent 验收：**从 Pages 根地址免登录进入三张卡片，新增球员后刷新并搜索该球员，再返回工作台。验证 `local.html` 可直达编辑器、中英文切换、战术编辑、刷新保存、Madden 图片和 JSON 导出；查看 Actions 是否成功。说明浏览器数据不会自动同步到其他用户或设备，也没有云端账号和云端共享；验证 AI 演示入口、默认攻防叠图与空 Key 的提示。语言与数据在不同域名之间互不共享。

### 路径 C：自己的云端协作站点

当前云端依赖 **Vinext / Cloudflare Worker、D1 数据库（绑定名 `DB`）、数据库迁移，以及经过平台验证的身份入口**。使用 ChatGPT Sites 时，应由有权操作的部署者创建**自己的新 Site 和新数据库**，并让 Agent 按该环境提供的 Sites 工作流读取新项目配置、构建、应用迁移、发布和检查状态。不要在没有核实目标的情况下对已有站点或数据库执行初始化、重置或迁移。

初始化团队账号需要在目标站点的安全运行时配置一次性 `PLAYBOOK_SETUP_KEY`。`POST /api/auth/bootstrap` 使用 `X-Playbook-Setup-Key` 和 JSON `accounts` 列表：首个账号为 `owner`，后续为 `editor` 或 `viewer`；账号对象包含 `username`、`password`、`role` 和可选显示名称 `name`；用户名为 3–32 位，以字母开头，只能包含小写字母、数字和下划线；密码为 8–128 个字符。该接口还要求请求的 `Origin` 与站点源完全一致；成功后不可再次初始化或当作密码重置使用。初始化完成后移除一次性密钥。凭据应通过平台安全入口提供，不要写进仓库、日志、终端命令参数或聊天记录。具体约束以 `server/auth.mjs` 和 [云端架构与运维](CLOUD.md) 为准。

**Agent 验收：**访问 HTTPS 登录页，检查 `/api/health`，确认匿名用户无法读取战术本；再使用授权账号验证登录、创建或读取战术本、自动保存、刷新恢复及中英文切换。按需要用两个授权账号验证成员权限；AI 分析使用各自服务商的模型与 API Key，需单独验证。报告 Site 地址、源码版本、数据库和测试结果，不要输出账号密码或密钥。

> `npm run build && npm start` 启动的是本地 Worker / Wrangler 环境，**不是**已经配置好的公网生产部署。仓库目前没有可直接运行的通用 VPS 自托管云端方案；迁移到其他 Worker / D1 平台需要另行完成部署配置、迁移和可信身份验证，不能直接信任公网请求中的 Sites 身份头。平台缺失或权限不足时，应如实报告，不能以静态页面冒充完整云端版。
