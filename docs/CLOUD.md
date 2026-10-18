# 云端架构与运维

## 运行与存储

云端编辑器位于 `/editor/index.html`。根路由跳转到编辑器，`/api/*` 由 Vinext / Cloudflare Worker 执行。`.openai/hosting.json` 声明 D1 逻辑绑定 `DB`；没有使用 R2。当前保存的是战术、名单、模板和配置 JSON，没有上传任意附件的功能。

GitHub Pages 发布入口和旧版导出工具，并保留 `local.html` 静态编辑器。它不保存共享数据、不持有服务器凭证。两个域名的浏览器存储互相隔离，因此旧版迁移须导出 / 上传 JSON。

| 数据表 | 用途 |
|---|---|
| users | 登录用户的服务端身份、邮箱与显示名 |
| workspaces | 战术本完整 JSON、版本号、最近修改人和时间 |
| members | 战术本与用户的关联，以及 owner / editor / viewer 角色 |
| invites | 邮箱绑定邀请、SHA-256 token 摘要、角色、有效期与状态 |
| snapshots | 最近 20 个保存版本的完整 JSON |
| audit_events | 创建、保存、邀请、加入、成员权限调整与恢复的内部审计记录 |

D1 是持久云端数据库，战术不会因刷新或换设备消失。每个战术本隔离访问，不存在所有访客自动共享全部战术的公共目录。

## v3 团队账号与登录

新增 `accounts`、`account_sessions`、`auth_throttles`、`app_setup` 四张表。团队账号为独立用户名 / 密码，不要求分发对象注册 ChatGPT。原有 `getChatGPTUser()` 与登录集成仍保留，旧数据与邮箱邀请可以继续使用。

密码使用随机盐和 PBKDF2-SHA256（100,000 次），数据库不保存明文。登录 token 为 256 位随机值，数据库只保存 SHA-256 摘要。生产 Cookie 使用 `__Host-` 前缀、HttpOnly、Secure、SameSite=Lax，有效期 7 天。密码更新或管理员重置会使旧会话失效。登录和改密存在服务端尝试次数限制；所有修改请求仍检查 Origin。

`PLAYBOOK_SETUP_KEY` 通过 Sites 原生运行时秘密配置，只用于一次性初始化。初始化 endpoint 不接受未授权请求；事务中的唯一配置行防止部署或重试时重新创建 / 重置账号。初始密码由所有者单独接收，不包含在源码、迁移、浏览器脚本或部署配置中。初始化后移除此运行时秘密。

初始团队管理员及成员共用同一份战术本；若有站点所有者的现有战术本，则保留其内容并加入账号。后续可在「成员与权限」新建账号或调整角色。重置密码仅允许账号创建者在其管理的战术本中操作，防止其他战术本的管理员通过重置共享成员账号取得额外数据。

| 方法与路径 | 用途 |
|---|---|
| POST `/api/auth/login` | 账号密码验证与 Cookie 会话 |
| POST `/api/auth/logout` | 撤销会话 |
| POST `/api/auth/password` | 验证当前密码后修改自己的密码，撤销旧会话 |
| POST `/api/auth/bootstrap` | 运行时秘密授权的一次性初始账号配置 |
| POST `/api/workspaces/:id/accounts` | 管理员创建 editor / viewer 账号并加入当前战术本 |
| POST `/api/workspaces/:id/members/:userId/password` | 创建者管理员重置自己创建的成员账号密码 |

## 原有 ChatGPT 登录与权限

使用官方 `app/chatgpt-auth.ts`。选择原登录方式时，浏览器通过普通链接前往 `/signin-with-chatgpt`，退出使用 `/signout-with-chatgpt`。生产环境由 Sites 边缘验证会话并注入身份；API 不接受 JSON 中的 userId / role 作为权限依据，也没有客户端保存的后端密钥。

入口允许访客打开登录页面，数据 API 必须有有效身份且属于对应战术本。管理员可邀请、移除、调整成员，并恢复历史；编辑者可改数据；只读成员只能读。创建者固定为 owner，不能被降级或移除。邀请 token 由加密随机数生成，仅数据库存摘要，绑定规范化邮箱，7 天有效；接受或撤销后不可再用。

所有修改请求检查同源 Origin。返回 JSON 均禁止缓存；Service Worker 排除 API 与登录 / 回调 / 退出端点。用户输入通过已有备份模型校验，UI 输出转义。应用只管理自己战术本的成员，不赋予成员 Sites 项目的源码或部署权限。

## 协作与恢复

保存使用 `revision` 比较并更新（CAS）。D1 batch 事务同时更新主记录、快照、清理过旧快照及写入审计记录。UPDATE 内再次检查成员角色，防止权限检查后立即被撤销仍能写入。失败的 CAS 不写入新快照。

客户端约 900 ms 自动保存，每 6 秒空闲轮询；编辑中不主动替换正在输入的内容。收到 409 时，客户端以原版本、本机修改和最新云端版本进行三方合并。带 ID 的对象集合可合并独立新增 / 删除；路线点序列为整体值。同一字段的竞争修改、删除与修改冲突须人工选择，不直接覆盖云端。

未同步草稿按登录用户与战术本 ID 保存在原浏览器，用于断网、请求失败与刷新恢复。成功同步后删除草稿。它不是跨设备的离线副本，也不保证在断网状态下重新登录或冷启动。权限变更时停止保存并提供草稿下载。管理员恢复历史会生成新版本，也受 CAS 保护。

## API

所有路径相对于站点源；除 health / session 外均要求登录，战术路径还检查成员权限。

| 方法与路径 | 用途 / 权限 |
|---|---|
| GET `/api/health` | 数据库及部署版本健康检查，不返回用户数据 |
| GET `/api/session` | 当前验证身份，匿名返回 null |
| GET / POST `/api/workspaces` | 列出自己参与的战术本 / 创建自己的战术本 |
| GET / PUT `/api/workspaces/:id` | 读取 / 带 revision 保存，写入须 owner 或 editor |
| GET `/api/workspaces/:id/members` | 管理员查看成员及待接受邀请 |
| PATCH / DELETE `/api/workspaces/:id/members/:userId` | 管理员调整为 editor / viewer 或移除 |
| POST `/api/workspaces/:id/invites` | 管理员创建 email + role 邀请 |
| DELETE `/api/workspaces/:id/invites/:inviteId` | 管理员撤销邀请 |
| GET `/api/invites/:token` | 对应邮箱查看有效邀请 |
| POST `/api/invites/:token/accept` | 对应邮箱接受一次性邀请 |
| GET `/api/workspaces/:id/history` | 成员列出最近 20 个版本 |
| GET `/api/workspaces/:id/history/:revision` | 成员下载某一版本 |
| POST `/api/workspaces/:id/history/:revision/restore` | 管理员带当前 revision 恢复 |

## 数据库迁移与部署

Drizzle 以 `db/schema.ts` 为源，通过 `npm run db:generate` 生成 `drizzle/` 中的结构迁移。已部署的迁移不可编辑；模型变化应生成新的迁移。迁移只包含表和索引结构，教学示例在创建战术本时写入。

Sites 生产发布由官方 build / package / source workflow 执行，并自动提供绑定、应用迁移。构建输出为 `dist/`，源编辑器为 `web/`，二者不能混用。`.sites-runtime/`、本地数据库、产物和 `.env*` 不提交。

公共 GitHub 仓库保留可复现源码与检查工作流。自行部署到其它 Worker / D1 服务时，必须替换为该平台验证过的登录机制；不能把 Sites 的身份头当作可直接由公网用户可信提交的身份。

## 验证边界

SQL 集成测试使用 Node SQLite 执行实际迁移与 API SQL，包括权限、邀请、CAS、历史和撤销权限时的竞态。同步和 Happy DOM 测试覆盖客户端冲突、离线草稿、只读控件、角色变化、保存、迁移与邀请界面。

这些测试不等同于两个真实 ChatGPT 账号登录后的人工端到端协作验证。公开入口、健康端点和匿名禁止访问另做上线核验；真实触摸、PNG 下载和打印尺寸仍需设备验证。
