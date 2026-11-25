# Playbook Studio · Agent Instructions

This repository contains **Playbook Studio**, an American football playbook workspace (frontend under `web/`, Cloudflare Worker + D1 API under `server/` and `app/`, Drizzle SQL migrations under `drizzle/`).

## Local Deployment & AI Setup Skill

When asked to install, build, initialize, run, upgrade, troubleshoot, or configure AI models for a local Playbook Studio deployment, read and follow:

- **[`skills/playbook-studio-local-deploy/SKILL.md`](skills/playbook-studio-local-deploy/SKILL.md)** (complete 7-phase runbook, preflight checks, idempotent-safe D1 inspection, AI configuration, and verification)
- Reference modules under `skills/playbook-studio-local-deploy/references/`:
  - [`ai-providers-and-protocols.md`](skills/playbook-studio-local-deploy/references/ai-providers-and-protocols.md)
  - [`troubleshooting.md`](skills/playbook-studio-local-deploy/references/troubleshooting.md)
  - [`verification-checklist.md`](skills/playbook-studio-local-deploy/references/verification-checklist.md)

Human-facing bilingual guides live in [`docs/AGENT_DEPLOYMENT.md`](docs/AGENT_DEPLOYMENT.md) / [`docs/AGENT_DEPLOYMENT.en.md`](docs/AGENT_DEPLOYMENT.en.md) and [`docs/AI_GUIDE.md`](docs/AI_GUIDE.md) / [`docs/AI_GUIDE.en.md`](docs/AI_GUIDE.en.md).

## Hard Guardrails

1. **Runtime & Install**: Require **Node.js >= 22.13.0** (Node 24 recommended). Always install via `npm run install:ci` — do not invoke `node scripts/install-ci.mjs` directly.
2. **Full Local Deployment vs Dev/Static**: Full local deployment uses `npm run build` followed by `npm start -- --port 8787` and entry `http://127.0.0.1:8787/editor/index.html`. Do **not** use `npm run dev` (mockAuth, port 5173, ignores `dist/server/.dev.vars`) or `npm run start:local` (static only, no API/D1) as a substitute for full deployment.
3. **Preserve Data & Secrets**:
   - Never delete `.wrangler/state/` to fix SQL migration errors; inspect existing tables first (`drizzle/0000_*.sql` and `0001_*.sql` are non-idempotent).
   - Never commit or print `PLAYBOOK_SETUP_KEY`, team account passwords, API keys, `.dev.vars`, `.sites-runtime/`, `.wrangler/`, or `dist/`.
   - Remove `PLAYBOOK_SETUP_KEY` from `dist/server/.dev.vars` and delete `.sites-runtime/local-accounts.json` immediately after account bootstrap.
4. **AI Is Strictly BYOK**: The backend has **no** server-side LLM API key env vars (`OPENAI_API_KEY` / `DEEPSEEK_API_KEY` in `.dev.vars` have no effect). Keys live only in browser page memory. Ensure host shell `LANGCHAIN_*` / `LANGSMITH_*` / `OTEL_ENABLED` tracing variables are unset before starting the server, or both AI APIs will fail closed with HTTP `503`.
5. **No Unrequested Public Publish**: Never publish to ChatGPT Sites / Cloudflare or reuse `.openai/hosting.json` Site ID unless explicitly requested for a new target environment.

## Verification Commands

```bash
npm run check       # JavaScript syntax checks
npm run typecheck   # TypeScript checks
npm test            # Automated test suite
```
