---
name: playbook-studio-local-deploy
description: Deploy Playbook Studio locally with full frontend, Cloudflare Worker API, persistent local D1 database, team accounts, and AI provider/gateway configuration. Use when a user asks an agent to install, build, initialize, run, upgrade, troubleshoot, or configure AI models for a local Playbook Studio instance.
---

# Playbook Studio · Local Full Deployment & AI Setup Skill

Use this skill to perform a safe, reproducible, end-to-end **local full deployment** of Playbook Studio on the user's machine (frontend + local Cloudflare Worker API + persistent local D1 SQLite database + team accounts + optional AI custom gateway configuration) and hand off clear AI connection instructions.

Run all commands from the repository root. Default scope is **local-only (`127.0.0.1`)** — do not publish publicly unless the user explicitly asks and supplies their own hosting target.

## Reference Modules

Load these targeted references as needed:
- **[`references/ai-providers-and-protocols.md`](references/ai-providers-and-protocols.md)** — Exact 5 providers × 3 protocols, default model ID gotcha, custom gateway `AI_ALLOWED_HOSTS` & SSRF rules, `assertPrivateRuntime` LangSmith/OTEL 503 trap, shared rate limits, payload/knowledge limits, and Coach Film relay contract.
- **[`references/troubleshooting.md`](references/troubleshooting.md)** — Complete diagnosis matrix for HTTP `400`–`504` errors, Wrangler/D1 migration errors, `dist/` rebuild resets, `127.0.0.1` vs `localhost` issues, Windows caveats, and Ollama/local-LLM constraints.
- **[`references/verification-checklist.md`](references/verification-checklist.md)** — Automated CLI/HTTP smoke tests, persistence checks, browser/AI verification criteria, and the standardized handoff report template.

---

## Mode Selection (Choose Correctly First)

| Mode | Command | Entry URL | Database & Accounts | AI Request Path |
|---|---|---|---|---|
| **Full local deployment (DEFAULT)** | `npm run build` then `npm start -- --port 8787` | `http://127.0.0.1:8787/editor/index.html` (or `/editor/`) | Local D1 in `.wrangler/state/`, real password accounts | Local Worker API proxies HTTPS to provider |
| Static no-sign-in preview | `npm run start:local` | `http://localhost:3000/` | Browser `localStorage` only, no API/accounts | Browser direct fetch (requires provider CORS) |
| Framework dev server (dev only) | `npm run dev` | `http://localhost:5173/` | Uses `sites({ mockAuth: true })`, ignores `dist/server/.dev.vars` | **Do NOT use for local deployment** |

> **Critical**: Opening `/editor/local.html` even on `127.0.0.1:8787` runs static `localStorage` mode, NOT the authenticated database mode (`web/cloud.js` switches mode based on path). Always direct users to `/editor/index.html` or `/editor/` (root `/` redirects to `/editor/index.html`).

---

## Hard Safety & Security Guardrails

1. **Never delete `.wrangler/state/`** to resolve a migration error — it holds the user's persistent database.
2. **Never print, log, or commit secrets**: `PLAYBOOK_SETUP_KEY`, user passwords, session cookies, and LLM API keys must never appear in stdout, chat transcripts, command-line arguments, or Git commits.
3. **Never write `OPENAI_API_KEY`, `DEEPSEEK_API_KEY`, or `ANTHROPIC_API_KEY` into `dist/server/.dev.vars`** expecting keyless AI — the backend does **not** read server-side provider API keys. AI is strictly **BYOK in browser page memory**.
4. **Never leave `PLAYBOOK_SETUP_KEY` active** after account bootstrap, and always delete `.sites-runtime/local-accounts.json` once bootstrap succeeds.
5. **Never claim live AI is verified** unless an actual model call succeeded with a user-authorized API key; otherwise explicitly mark live LLM calls as `UNVERIFIED` in the handoff report.
6. **Never reuse `.openai/hosting.json` Site ID** or publish to remote Cloudflare / ChatGPT Sites by default.

---

## Phase 0 · Preflight & Environment Audit

Run these read-only checks before installing or modifying anything:

```bash
node --version
git --version
git status --short
git rev-parse --short HEAD
```

Check these 5 conditions:

1. **Node.js version**: Must be `>= 22.13.0` (**Node 24** recommended). If lower, stop and ask the user to switch Node versions (e.g., via `nvm` / `fnm` / Homebrew) before proceeding.
2. **Execution profile**: Check whether `.sites-runtime/execution-profile.json` exists. Normal local machines run in `"portable"` mode (file absent). Only `"managed-linux"` uses `scripts/install-ci.sh`.
3. **LangSmith / LangChain / OTEL Host Shell Trap (CRITICAL)**:
   ```bash
   env | grep -iE '^(LANG(CHAIN|SMITH)|OTEL)_' || echo "clean"
   ```
   `server/matchup-agent.mjs` (`assertPrivateRuntime`) inspects **both** Worker `env` AND host `process.env`. If `LANGCHAIN_TRACING` is set to **any non-empty string** (even `"false"`!) or `LANGSMITH_TRACING` / `LANGSMITH_TRACING_V2` / `LANGCHAIN_TRACING_V2` / `LANGCHAIN_VERBOSE` / `LANGSMITH_OTEL_ENABLED` / `OTEL_ENABLED` is `true`/`1`/`yes`, or `LANGSMITH_TRACING_MODE` is not `off`/`disabled`/`none`, **both AI endpoints fail closed with HTTP `503`** (`为保护战术数据，请管理员关闭服务端的 LangSmith 跟踪后再分析`). Record any matches so you unset them when launching `npm start`.
4. **Port `8787` availability**: Check if port `8787` is already bound (`lsof -i :8787` / `ss -ltnp | grep 8787` on Linux/macOS, or `netstat -ano | findstr 8787` on Windows). If occupied by another app, agree on an alternate port (e.g., `8788`) and use that port consistently for `Origin` and access URLs.
5. **Preserve existing state & runtime vars (Upgrade / Re-deploy scenario)**:
   - Check if `.wrangler/state` already exists (`ls -la .wrangler/state 2>/dev/null`). If yes, this is an **existing deployment** — do not wipe it and do not blindly rerun SQL migrations.
   - Check if `dist/server/.dev.vars` already exists (`test -f dist/server/.dev.vars && echo "exists"`). Because `npm run build` regenerates `dist/`, copy non-setup runtime settings (such as `AI_ALLOWED_HOSTS`) to an ignored backup file `.sites-runtime/dev.vars.backup` (mode `0600`) **before** running `npm run build`.

---

## Phase 1 · Install Dependencies & Build Complete Application

```bash
npm run install:ci
npm run build
```

Important notes:
- Always invoke `npm run install:ci` (running `node scripts/install-ci.mjs` directly throws because it checks `process.env.npm_execpath`). The script automatically sets `SHARP_IGNORE_GLOBAL_LIBVIPS=1` so `miniflare`/`sharp` installs cleanly without failing on system `libvips`.
- `npm run build` runs `scripts/prepare-web.mjs` (restoring bundled Madden art from `vendor/huddle-art/art-*.bin` into `web/data/huddle-art/` and syncing `web/` → `public/editor/`) and compiles the Cloudflare Worker bundle + `dist/server/wrangler.json`.
- Verify `dist/server/wrangler.json` exists after the build completes.
- If you backed up `.sites-runtime/dev.vars.backup` in Phase 0, restore it to `dist/server/.dev.vars` now (stripping any stale `PLAYBOOK_SETUP_KEY` line).

---

## Phase 2 · Idempotent-Safe D1 Database Inspection & Migration

The two migration files under `drizzle/` do **not** use `IF NOT EXISTS`. Never run them blindly against an existing database.

### Step 2.1 — Inspect existing tables (read-only)

```bash
npx --no-install wrangler d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --command "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;"
```

### Step 2.2 — Apply only missing migrations

| Inspection Result | Action |
|---|---|
| Neither `workspaces` nor `accounts` exists (fresh DB) | Run **both** `0000_curved_toad_men.sql` and `0001_optimal_turbo.sql` in order |
| `workspaces` exists, `accounts` missing (legacy v1 DB) | Run **only** `0001_optimal_turbo.sql` |
| Both `workspaces` and `accounts` exist | **Skip both migrations** (if future versions add `0002_*.sql`, inspect and apply only unapplied files) |

Commands (run only what the table above calls for):

```bash
npx --no-install wrangler d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0000_curved_toad_men.sql
npx --no-install wrangler d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0001_optimal_turbo.sql
```

### Step 2.3 — Check whether team accounts are already bootstrapped

```bash
npx --no-install wrangler d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --command "SELECT key, created_at FROM app_setup WHERE key='team-accounts-v3';"
```

- If a row is returned → accounts are **already initialized**. Skip account bootstrap in Phase 3 (calling `/api/auth/bootstrap` again returns `409` and cannot reset passwords) and proceed straight to starting the server and verification.
- If empty → continue to Phase 3.

---

## Phase 3 · Configure Setup Key, Start Server & Bootstrap Accounts

### Step 3.1 — Write one-time `PLAYBOOK_SETUP_KEY` into `dist/server/.dev.vars`

Never print the key to stdout. If `dist/server/.dev.vars` does not exist yet:

```bash
node --input-type=module -e "import { randomBytes } from 'node:crypto'; import { writeFileSync } from 'node:fs'; writeFileSync('dist/server/.dev.vars', 'PLAYBOOK_SETUP_KEY=' + randomBytes(32).toString('hex') + '\n', { flag: 'wx', mode: 0o600 });"
```

If `dist/server/.dev.vars` already exists (e.g., restored `AI_ALLOWED_HOSTS`), append `PLAYBOOK_SETUP_KEY` safely without overwriting existing lines:

```bash
node --input-type=module -e "import { randomBytes } from 'node:crypto'; import { readFileSync, writeFileSync } from 'node:fs'; const p = 'dist/server/.dev.vars'; const lines = readFileSync(p, 'utf8').split(/\r?\n/).filter(l => l && !l.startsWith('PLAYBOOK_SETUP_KEY=')); lines.push('PLAYBOOK_SETUP_KEY=' + randomBytes(32).toString('hex')); writeFileSync(p, lines.join('\n') + '\n', { mode: 0o600 });"
```

### Step 3.2 — Start the local Worker server

Always clear any host LangSmith/LangChain/OTEL tracing env vars in the server process environment:

```bash
env -u LANGCHAIN_TRACING -u LANGCHAIN_TRACING_V2 -u LANGSMITH_TRACING -u LANGSMITH_TRACING_V2 -u LANGCHAIN_VERBOSE -u LANGSMITH_OTEL_ENABLED -u OTEL_ENABLED -u LANGSMITH_TRACING_MODE \
  npm start -- --port 8787
```

Wait until health check passes:

```bash
curl -fsS http://127.0.0.1:8787/api/health
```

Expected response (HTTP `200`): `{"ready":true,"storage":"cloud","version":"3.1.0"}`.

### Step 3.3 — Provision initial team accounts via ignored local file

1. Ask the user for their desired initial username(s) and password(s) — OR, if the user asks the agent to generate an initial local account, write credentials directly into `.sites-runtime/local-accounts.json` (gitignored, mode `0600`) and instruct the user where to view/change the password after first login without printing secrets to shared logs.
2. Account validation rules (`server/auth.mjs`):
   - `accounts` array length: `1–10`
   - First account **must** have `"role": "owner"`; remaining accounts must be `"editor"` or `"viewer"`
   - `username`: `/^[a-z][a-z0-9_]{2,31}$/` (3–32 lowercase alphanumeric/underscore, starts with a letter; unique)
   - `password`: `8–128` characters (never keep a placeholder string)
   - `name`: `1–60` characters
3. Create `.sites-runtime/local-accounts.json`:
   ```json
   {
     "accounts": [
       {
         "username": "coach",
         "password": "REPLACE_WITH_STRONG_PASSWORD",
         "name": "Coach",
         "role": "owner"
       }
     ]
   }
   ```
4. Execute bootstrap using `http://127.0.0.1:8787` consistently for both URL and `Origin` header (prevents `403 请求来源不正确`):

```bash
node --env-file=dist/server/.dev.vars --input-type=module -e "
import { readFile } from 'node:fs/promises';
const origin = 'http://127.0.0.1:8787';
const payload = JSON.parse(await readFile('.sites-runtime/local-accounts.json', 'utf8'));
if (!Array.isArray(payload.accounts) || payload.accounts.some(a => !a.password || a.password.includes('REPLACE_WITH'))) {
  throw new Error('Replace placeholder password in .sites-runtime/local-accounts.json first.');
}
const res = await fetch(origin + '/api/auth/bootstrap', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Origin: origin,
    'X-Playbook-Setup-Key': process.env.PLAYBOOK_SETUP_KEY,
  },
  body: JSON.stringify(payload),
});
const body = await res.json();
if (!res.ok) throw new Error('Bootstrap failed (' + res.status + '): ' + (body.error || JSON.stringify(body)));
console.log('Bootstrapped workspace:', body.workspaceId, 'accounts:', body.accounts.map(a => a.username + '(' + a.role + ')').join(', '));
"
```

---

## Phase 4 · Close Bootstrap & Restart Cleanly

1. **Stop** the running `npm start` process (`Ctrl+C` / terminate background job).
2. **Strip `PLAYBOOK_SETUP_KEY`** from `dist/server/.dev.vars` while preserving other settings (like `AI_ALLOWED_HOSTS`):
   ```bash
   node --input-type=module -e "import { readFileSync, writeFileSync, rmSync } from 'node:fs'; const p = 'dist/server/.dev.vars'; const keep = readFileSync(p, 'utf8').split(/\r?\n/).filter(l => l && !l.startsWith('PLAYBOOK_SETUP_KEY=')); if (keep.length) writeFileSync(p, keep.join('\n') + '\n', { mode: 0o600 }); else rmSync(p, { force: true });"
   ```
3. **Delete the temporary accounts file**:
   ```bash
   rm -f .sites-runtime/local-accounts.json
   ```
4. **Restart the server** cleanly (with LangSmith/OTEL vars unset):
   ```bash
   env -u LANGCHAIN_TRACING -u LANGCHAIN_TRACING_V2 -u LANGSMITH_TRACING -u LANGSMITH_TRACING_V2 -u LANGCHAIN_VERBOSE -u LANGSMITH_OTEL_ENABLED -u OTEL_ENABLED -u LANGSMITH_TRACING_MODE \
     npm start -- --port 8787
   ```
5. **Confirm bootstrap is closed** (must return HTTP `404`):
   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" -X POST http://127.0.0.1:8787/api/auth/bootstrap -H "Origin: http://127.0.0.1:8787" -H "Content-Type: application/json" -d '{}'
   ```

---

## Phase 5 · AI Capability Configuration & Custom Gateway Setup

Read [`references/ai-providers-and-protocols.md`](references/ai-providers-and-protocols.md) whenever the user asks to configure AI, connect a custom gateway, import a knowledge pack, or troubleshoot model calls.

Key facts to communicate and apply accurately:

1. **Both AI entry points share one browser model configuration**:
   - **Board Assistant (`战术板助手`)**: Editor → `✦ AI` button or right-hand `AI 助手` tab → Settings (also powers **Coach Film Room** `讲解` AI commands).
   - **AI Matchup Analysis (`AI分析战局`)**: Top nav `AI 战局分析` → left panel `02 连接模型`. (Diagram overlay + local diagram brief + retrieved knowledge work **without an API key**.)
2. **Strictly BYOK (page-memory credentials)**:
   - Non-secret settings (`provider`, `protocol`, `model`, `baseUrl`) persist in `localStorage` (`playbook-studio:model-connection:v1`).
   - The `API Key` stays **only in current page memory** and must be re-entered after a page reload, provider switch, or sign-out.
   - Local deployment does **not** supply free model credits or read `OPENAI_API_KEY` from `.dev.vars`.
3. **Critical Default Model ID Warning**:
   - The UI prefills `gpt-6.1-terra` for OpenAI and `deepseek-flash` for DeepSeek. When using personal API keys, remind the user to replace the prefilled model ID with an active, tool-calling-capable model on their account (e.g., `gpt-4o`, `deepseek-chat`, `claude-sonnet-4-6`, `openai/gpt-4o-mini`).
4. **Custom HTTPS Model Gateway (`AI_ALLOWED_HOSTS`)**:
   - Only needed when the user selects **Custom (`其他兼容服务`)** in the UI.
   - Add comma-separated **hostnames only** (no scheme, path, or port) to `dist/server/.dev.vars`, **and save a copy to `.sites-runtime/dev.vars.backup`** so future `npm run build` runs can restore it:
     ```dotenv
     AI_ALLOWED_HOSTS="gateway.example.com,api.example.net"
     ```
   - Restart `npm start -- --port 8787` after changing `.dev.vars`.
   - In the UI, enter the full HTTPS base path required by the gateway (e.g., `https://gateway.example.com/v1` — the app **never auto-inserts `/v1`**).
   - **Local Ollama / LAN IPs cannot be connected directly** because `server/matchup.mjs` strictly rejects HTTP, non-443 ports, `localhost`, `*.local`, `*.internal`, IPv4, and IPv6 addresses.

---

## Phase 6 · Verification & Structured Handoff

Follow [`references/verification-checklist.md`](references/verification-checklist.md) to run all automated checks (API health, unauthenticated `401` guard, closed bootstrap `404`, authenticated login + persistence across restart when authorized, plus `npm run check`, `npm run typecheck`, `npm test` if code was touched or verification was requested).

End every deployment with the structured handoff report from `references/verification-checklist.md`, always stating:
- Exact commit SHA (`git rev-parse --short HEAD`)
- Full app entry URL (`http://127.0.0.1:8787/editor/index.html`) vs static demo warning (`/editor/local.html`)
- Persistent database path (`.wrangler/state/`) and runtime config path (`dist/server/.dev.vars` + backup reminder before rebuilds)
- Daily start/stop/backup/upgrade commands
- Verified vs `UNVERIFIED` items (explicitly mark live LLM execution `UNVERIFIED` if no user-authorized API key was tested)
- Clear next steps for configuring AI provider + real model ID + page-memory API key in the browser.
