# Verification Checklist & Handoff Report Template

Run these checks after Phase 4 (clean restart with `PLAYBOOK_SETUP_KEY` removed). Never report a step as verified unless you actually executed it and observed the expected output.

---

## 1. Automated CLI & HTTP Verification (No Secrets Printed)

### 1.1 API Health & Auth Gate
```bash
# 1. Health check must return HTTP 200 and ready:true
curl -fsS http://127.0.0.1:8787/api/health

# 2. Unauthenticated workspace access must return HTTP 401
curl -s -o /dev/null -w "unauth_workspaces=%{http_code}\n" http://127.0.0.1:8787/api/workspaces

# 3. Bootstrap endpoint must be closed (HTTP 404)
curl -s -o /dev/null -w "closed_bootstrap=%{http_code}\n" \
  -X POST http://127.0.0.1:8787/api/auth/bootstrap \
  -H "Origin: http://127.0.0.1:8787" \
  -H "Content-Type: application/json" \
  -d '{}'

# 4. Full editor HTML must serve HTTP 200
curl -s -o /dev/null -w "editor_html=%{http_code}\n" http://127.0.0.1:8787/editor/index.html
```

Expected results:
- `GET /api/health` → `{"ready":true,"storage":"cloud","version":"3.1.0"}`
- `unauth_workspaces=401`
- `closed_bootstrap=404`
- `editor_html=200`

### 1.2 Authenticated Login, Save & Restart Persistence (When Credentials Are Available Locally)
If the user authorized the agent to verify login/save end-to-end:
1. `POST http://127.0.0.1:8787/api/auth/login` with `Origin: http://127.0.0.1:8787` and store cookie in a temporary ignored jar (e.g. `.sites-runtime/verify-cookie.txt`, mode `0600`).
2. `GET /api/session` and `GET /api/workspaces` with that cookie → verify HTTP `200` and workspace list returned.
3. Optional write test: `PUT /api/workspaces/:id` with matching `revision` → verify `revision` increments.
4. Restart `npm start -- --port 8787` and re-fetch `GET /api/workspaces` → verify persisted data & revision survive restart.
5. Delete `.sites-runtime/verify-cookie.txt` immediately after testing.

### 1.3 Repository Integrity Checks (Recommended on Upgrade / Code Changes)
```bash
npm run check
npm run typecheck
npm test
```

### 1.4 Clean Working Tree & Secret Hygiene Check
```bash
git status --short
test ! -f .sites-runtime/local-accounts.json && echo "accounts_file_removed=ok"
! grep -q "PLAYBOOK_SETUP_KEY" dist/server/.dev.vars 2>/dev/null && echo "setup_key_removed=ok"
```

---

## 2. Browser & AI Feature Verification Matrix

| Check | Action | Expected Result | Status Rule |
|---|---|---|---|
| Login & Workspace | Open `http://127.0.0.1:8787/editor/index.html` and sign in | Loads team playbook (NOT browser-only demo banner) | Verify or mark `USER_TO_VERIFY` |
| Edit & Autosave | Drag a player / edit route, wait for save indicator, reload | Changes persist cleanly | Verify or mark `USER_TO_VERIFY` |
| Madden Library | Open `Madden NFL 战术库`, filter team/formation, preview & add editable play | Art images load (from materialized `web/data/huddle-art/`), play imports | Verify or mark `USER_TO_VERIFY` |
| Rehearsal & Coach Film | Switch to `战术演练` or click `讲解` on desktop | Timeline scrubs smoothly; Coach Film compares player depth | Verify or mark `USER_TO_VERIFY` |
| Export JSON | Click `导出` → JSON | Valid JSON backup downloads | Verify or mark `USER_TO_VERIFY` |
| AI Matchup Local Brief (No Key) | Open `AI 战局分析`, select offense & defense | Overlay diagram + diagram facts brief + knowledge cards render with **no API key** | Verify or mark `USER_TO_VERIFY` |
| AI Board Assistant (Live LLM) | Open `✦ AI` → Settings → select provider, **real model ID**, API key → send `"添加完整的 4–3 防守，保留进攻"` | Translucent preview appears; `应用` writes 11 defenders; Undo reverts cleanly | **Must mark `UNVERIFIED` unless tested with a user-authorized live key** |
| AI Matchup Analysis (Live LLM) | Configure provider + real model ID + API key → click `分析对局` | Sourced conditional scenarios render with clickable diagram/knowledge highlights | **Must mark `UNVERIFIED` unless tested with a user-authorized live key** |

---

## 3. Standardized Handoff Report Template

Always present a concise report with these exact sections at the end of deployment:

```markdown
## Playbook Studio Local Deployment Report

- **Source Version**: `<short-sha>` (`<branch>`)
- **Full App URL**: `http://127.0.0.1:8787/editor/index.html` (do not use `/editor/local.html` for accounts/DB)
- **Database Path**: `.wrangler/state/` (local D1 binding `DB` — back up while server is stopped; never delete)
- **Runtime Config**: `dist/server/.dev.vars` (`PLAYBOOK_SETUP_KEY` removed; custom `AI_ALLOWED_HOSTS`: `<list or none>`)

### Verification Results
- ✅ Passed: `<list only checks actually executed and passed>`
- ⚠️ Unverified / Pending User Action:
  - Live AI calls (Board Assistant & Matchup Analysis): **UNVERIFIED** (requires user's own provider API key entered in browser memory)
  - `<any browser/role checks not yet run>`

### Connecting AI (Next Steps in Browser)
1. Open **✦ AI** (editor) or **AI 战局分析 → 02 连接模型** (settings are shared).
2. Choose **Provider → API Format**, **replace the prefilled default model ID** (`gpt-6.1-terra` / `deepseek-flash`) with an active tool-calling model on your account (e.g., `gpt-4o`, `deepseek-chat`, `claude-sonnet-4-6`), and enter your **API Key**.
3. API keys stay **only in current page memory** and must be re-entered after a page refresh.
4. For a custom HTTPS gateway, confirm its bare hostname is listed in `dist/server/.dev.vars` (`AI_ALLOWED_HOSTS`) and mirrored in `.sites-runtime/dev.vars.backup`.

### Daily Operations
- **Start**: `env -u LANGCHAIN_TRACING -u LANGCHAIN_TRACING_V2 -u LANGSMITH_TRACING -u LANGSMITH_TRACING_V2 -u LANGCHAIN_VERBOSE -u LANGSMITH_OTEL_ENABLED -u OTEL_ENABLED -u LANGSMITH_TRACING_MODE npm start -- --port 8787`
- **Stop**: `Ctrl+C` in the server terminal
- **Backup**: Stop server → archive `.wrangler/state/` + export JSON playbooks from UI
- **Upgrade**: Back up `.wrangler/state/` and `dist/server/.dev.vars` → `git pull` → `npm run install:ci` → `npm run build` → restore `dist/server/.dev.vars` → inspect tables & apply only new SQL migrations → start server
```
