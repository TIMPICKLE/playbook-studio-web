# Local Deployment & AI Troubleshooting Matrix

Fast diagnosis and recovery runbook for coding agents deploying or debugging Playbook Studio locally.

---

## 1. Install, Build & Database Errors

| Symptom / Exact Error | Root Cause | Exact Fix |
|---|---|---|
| `Run this installer with npm run install:ci.` | Executed `node scripts/install-ci.mjs` directly without npm | Run `npm run install:ci` from repo root |
| `sharp` / `libvips` native build failure during `npm ci` | Used raw `npm ci` instead of `npm run install:ci` | Use `npm run install:ci` (automatically sets `SHARP_IGNORE_GLOBAL_LIBVIPS=1`) |
| `ENOENT: dist/server/wrangler.json` | Ran D1 migration or `npm start` before building | Run `npm run build` first |
| `table already exists` during `wrangler d1 execute` | Rerunning non-idempotent `0000_*.sql` or `0001_*.sql` on an existing DB | **NEVER delete `.wrangler/state/`**. Inspect tables via `SELECT name FROM sqlite_master WHERE type='table';` and apply only missing SQL files |
| `/api/health` returns HTTP `503` `{"ready":false}` or D1 query error | Running `npm run start:local` (no Worker), DB not migrated, or mismatched `--persist-to` directory | Start with `npm start -- --port 8787` and confirm migrations targeted the exact same `--persist-to .wrangler/state` |
| `npm start` fails or binds another port (`8788` etc.) | Port `8787` is already occupied | Stop conflicting process or pass explicit `-- --port <PORT>` and update `Origin` + browser URL to match |
| Custom `AI_ALLOWED_HOSTS` stops working after code update | `npm run build` regenerates `dist/`, wiping `dist/server/.dev.vars` | Restore `AI_ALLOWED_HOSTS` from `.sites-runtime/dev.vars.backup` into `dist/server/.dev.vars`, then restart `npm start` |
| `npm run dev` opens logged-in mock account / ignores `.dev.vars` | `npm run dev` runs Vite/Vinext on port `5173` with `sites({ mockAuth: true })` | Stop `npm run dev`; full local deployment requires `npm run build` + `npm start -- --port 8787` |
| `npm run start:local` fails on Windows (`ENOENT` `/C:/...`) | `scripts/serve.mjs` uses `new URL(...).pathname` instead of `fileURLToPath` | On Windows, prefer full local deployment (`npm run build` + `npm start -- --port 8787`) and access `/editor/index.html` (or `/editor/local.html` for static mode) |

---

## 2. Auth, Bootstrap & Origin Errors

| HTTP Status | Exact Message (ZH) | Root Cause | Exact Fix |
|---|---|---|---|
| `400` | `账号须为 3–32 位小写字母、数字或下划线，并以字母开头` / `密码须为 8–128 个字符` / `初始账号配置不正确` | Invalid username regex, password length, duplicate username, or first account role ≠ `owner` | Fix `.sites-runtime/local-accounts.json` to match `server/auth.mjs` constraints (1–10 accounts, first `owner`, rest `editor`/`viewer`) |
| `401` | `请先登录` | Session cookie missing/expired, or accessed via `localhost` while cookie was issued for `127.0.0.1` | Always use `http://127.0.0.1:8787/editor/index.html` consistently |
| `403` | `请求来源不正确` | Non-GET/HEAD request missing `Origin` header, or `Origin` (`localhost`) ≠ request URL origin (`127.0.0.1`) | Send exact `Origin: http://127.0.0.1:8787` matching the target URL |
| `404` | `接口不存在` (on `POST /api/auth/bootstrap`) | `PLAYBOOK_SETUP_KEY` not present in `dist/server/.dev.vars`, server not restarted after adding it, or wrong `X-Playbook-Setup-Key` header | Check `dist/server/.dev.vars` (NOT repo root `.dev.vars`), restart `npm start`, verify script reads `dist/server/.dev.vars` |
| `409` | `初始账号已创建，不会重复创建或重置密码` | `app_setup(key='team-accounts-v3')` already exists | Accounts are already bootstrapped; sign in directly (bootstrap cannot reset passwords; owner can reset member accounts in UI or via DB inspection) |
| `429` | `尝试次数过多，请 15 分钟后重试，或联系管理员` | Exceeded 8 failed login/password attempts in 15 min window (`auth_throttles`) | Wait 15 minutes or inspect/clear the specific throttle row in local D1 only if the local owner explicitly asks |
| Logged in, but UI shows demo / browser-only banner | Opened `/editor/local.html` instead of `/editor/index.html` | `web/cloud.js` treats `/local` paths as static `localStorage` mode | Navigate to `http://127.0.0.1:8787/editor/index.html` (or `/editor/`) |
| `ECONNREFUSED` on `http://localhost:8787` | `npm start` binds strictly to `--ip 127.0.0.1` (IPv4) while `localhost` resolves to `::1` | Use `http://127.0.0.1:8787` everywhere |

---

## 3. AI Endpoint & Model Connection Errors

| HTTP Status | Exact Message / Symptom | Root Cause | Exact Fix |
|---|---|---|---|
| **`503`** | **`为保护战术数据，请管理员关闭服务端的 LangSmith 跟踪后再分析`** | Host shell or `.dev.vars` has `LANGCHAIN_TRACING` (even `"false"`!), `LANGSMITH_TRACING`, `LANGSMITH_TRACING_V2`, `LANGCHAIN_TRACING_V2`, `LANGCHAIN_VERBOSE`, `LANGSMITH_OTEL_ENABLED`, `OTEL_ENABLED`, or `LANGSMITH_TRACING_MODE` set | Restart server with `env -u LANGCHAIN_TRACING -u LANGCHAIN_TRACING_V2 -u LANGSMITH_TRACING -u LANGSMITH_TRACING_V2 -u LANGCHAIN_VERBOSE -u LANGSMITH_OTEL_ENABLED -u OTEL_ENABLED -u LANGSMITH_TRACING_MODE npm start -- --port 8787` and remove any such vars from `.dev.vars` |
| `400` | `自定义地址不在管理员允许的安全主机列表中` | Custom gateway hostname missing from `AI_ALLOWED_HOSTS`, or URL uses `http:`, custom port, IP address, `localhost`, `.local`, `.internal`, query string, or credentials | Add bare lowercase hostname to `AI_ALLOWED_HOSTS` in `dist/server/.dev.vars`, restart server, and ensure URL is standard-port `https://` |
| `400` / `404` / `502` | `模型服务不支持工具调用配置或模型 ID 不正确` or `HTTP 400` / `HTTP 404` | Left prefilled default model (`gpt-6.1-terra` or `deepseek-flash`) with a personal API key, wrong API protocol for that model, or custom base URL missing `/v1` | Replace model ID with an active tool-calling model on the user's account (`gpt-4o`, `deepseek-chat`, `claude-sonnet-4-6`); verify protocol matches provider; include `/v1` explicitly for custom gateways |
| `401` / `403` / `502` | `模型服务拒绝了 API Key 或账号权限` | Invalid key, key belongs to another provider, or user assumed Claude Code CLI login works as Anthropic API key | Re-enter valid API key in the browser AI settings panel (remember: keys are cleared on page refresh and provider switch) |
| `402` / `502` | `模型服务账户余额不足` | Provider account has zero balance / billing disabled | Top up or enable billing at the selected model provider |
| `429` | `分析请求过于频繁，请稍后重试` (local) or `模型服务达到额度或频率限制` (upstream) | Hit shared local limit (**12 AI requests / 60s** across Board Assistant + Matchup Analysis) or upstream provider rate limit | Wait 60s and retry |
| `409` | `战术本已改变，请重新生成提案` / `战术本已更新，请刷新后重新选择战术` | Playbook revision changed while AI request was in flight | Refresh/regenerate preview or re-run matchup analysis against the latest revision |
| `413` / `400` | `请求体过大` / `分析上下文过大` | Exceeded `48 KB` matchup body, `950 KB` general body, or `250 KB` conversation budget | Reduce custom knowledge cards/notes or simplify play scope |
| `502` | `模型回复过长` / `模型未返回可识别的分析格式` | Upstream response exceeded `200 KB` (`limitedResponse`) or model failed JSON/tool contract | Narrow analysis question or switch to a stronger tool-calling model |
| `504` | `分析已取消或超时` | Hit `90s` server/provider timeout or user aborted | Retry with a faster model or simpler single-step instruction |
| Browser CORS error | Only happens in static mode (`/editor/local.html` or `start:local`) | Provider blocks direct browser cross-origin requests | Use **full local deployment** (`/editor/index.html` on `127.0.0.1:8787`), where the local Worker API proxies requests server-side |
| Local Ollama (`http://localhost:11434`) rejected | Server SSRF guard rejects HTTP, non-443 ports, `localhost`, and IPs | Put Ollama behind a standard-port `443` HTTPS reverse proxy with a real hostname (not `.local`/`.internal`), add that hostname to `AI_ALLOWED_HOSTS`, and restart; or use a cloud-compatible provider |
