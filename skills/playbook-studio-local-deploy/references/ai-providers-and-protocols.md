# AI Providers, Protocols, Security Invariants & Budgets

Exact implementation contract verified against `web/model-protocol.js`, `web/model-connection.js`, `web/assistant-provider.js`, `web/assistant-harness.js`, `server/api.mjs`, `server/matchup.mjs`, `server/matchup-agent.mjs`, `server/board-film-relay.mjs`, `web/knowledge-base.js`, `web/knowledge-store.js`, and `web/analysis-evidence.js`.

---

## 1. Two AI Entry Points & Shared Model Connection

| Entry Point | UI Location | Works Without API Key? | Cloud Local Mode Execution | Static Mode Execution |
|---|---|---|---|---|
| **Board Assistant (`战术板助手`)** + **Coach Film AI (`讲解` AI 助手)** | Editor → `✦ AI` button or right-hand `AI 助手` tab; or Film Room → `AI 助手` | UI welcome card & safety strip visible; sending instructions requires API key | `POST /api/workspaces/:id/board-assistant` (NDJSON streaming + tool loop via `@langchain/langgraph`; encrypted AES-GCM relay for live Coach Film device commands) | Browser direct `fetch` (provider must allow CORS) |
| **AI Matchup Analysis (`AI分析战局`)** | Top navigation → `AI 战局分析` → left panel `02 连接模型` | **Yes** for overlay diagram, local diagram facts brief, and retrieved knowledge cards; **API key required** for conditional scenario generation & follow-ups | `POST /api/workspaces/:id/matchup-analysis` (read-only LangGraph tool agent: `get_matchup_context`, `inspect_player`, `inspect_route_coverage`, `read_coverage_rule`, `search_knowledge`) | Browser single-shot `fetch` (`web/ai-demo.js`, `maxTokens: 1800`) |

### Credential Lifecycle (Strictly BYOK)

- **No server-side LLM API key env vars exist** in this repository (`web/app.js` never sets `serverConfigured`, and `server/` never reads `OPENAI_API_KEY` or `DEEPSEEK_API_KEY`). Do **not** put provider API keys into `dist/server/.dev.vars`.
- Non-secret preferences (`provider`, `protocol`, `model`, `baseUrl`) are stored in browser `localStorage` under key `playbook-studio:model-connection:v1` (`web/model-connection.js:4`).
- `apiKey` is kept **only in current page JavaScript memory**. It is stripped on load, never written to playbooks/exports/`localStorage`/D1, cleared on sign-out or permission loss, and cleared when switching providers. Switching API protocol within the same provider preserves `model`, `apiKey`, and `baseUrl`.

---

## 2. Supported Providers, Protocols, Endpoints & Default Model Trap

Defined in `web/model-protocol.js:5-14`:

| Provider ID | UI Label | Supported Protocols | Default Protocol | Prefilled Default Model | Resolved Endpoint(s) |
|---|---|---|---|---|---|
| `openai` | OpenAI | `openai`, `responses` | `openai` | `gpt-6.1-terra` ⚠️ | `https://api.openai.com/v1/chat/completions`<br>`https://api.openai.com/v1/responses` |
| `deepseek` | DeepSeek | `openai`, `anthropic` | `openai` | `deepseek-flash` ⚠️ | `https://api.deepseek.com/chat/completions`<br>`https://api.deepseek.com/anthropic/v1/messages` |
| `anthropic` | Anthropic / Claude | `anthropic` | `anthropic` | `claude-sonnet-4-6` | `https://api.anthropic.com/v1/messages` |
| `openrouter` | OpenRouter | `openai`, `responses` | `openai` | `openai/gpt-4o-mini` | `https://openrouter.ai/api/v1/chat/completions`<br>`https://openrouter.ai/api/v1/responses` |
| `custom` | Custom (`其他兼容服务`) | `openai`, `anthropic`, `responses` | `openai` | *(empty)* | User-supplied HTTPS base URL + protocol suffix |

> **⚠️ Default Model ID Trap**: Board Assistant initializes to `openai` / `gpt-6.1-terra`, and cloud Matchup Analysis initializes to `deepseek` / `deepseek-flash` (demo initializes to `openrouter` / `openai/gpt-4o-mini`). When a user supplies their own personal API key without changing the prefilled model ID, providers often return HTTP `400` or `404`. Always instruct users to enter an active model ID enabled on their provider account that supports **function/tool calling** for the chosen protocol (e.g., `gpt-4o`, `deepseek-chat`, `claude-sonnet-4-6`).

### Protocol Wire Details (`web/model-protocol.js:136-181`)

- **`openai` (OpenAI Chat Completions)**:
  - Header: `Authorization: Bearer <apiKey>`
  - Uses `max_completion_tokens` for `openai`, `max_tokens` for other providers.
  - Note: For `provider === 'openai'` and `model === 'gpt-6.1-terra'`, sends `reasoning_effort: 'none'`.
  - Note: For `provider === 'deepseek'`, sends `thinking: { type: 'disabled' }`.
- **`anthropic` (Anthropic Messages)**:
  - Headers: `x-api-key: <apiKey>`, `anthropic-version: 2023-06-01` (and `anthropic-dangerous-direct-browser-access: true` only in browser-direct static mode to `api.anthropic.com`).
  - Note: Services labeled "Claude Code Messages" refer to the **Anthropic Messages API format** with API credentials — **not** Claude Code CLI login or consumer subscription auth.
- **`responses` (OpenAI Responses)**:
  - Header: `Authorization: Bearer <apiKey>`
  - Sends `store: false`, `include: ['reasoning.encrypted_content']`, `tools[].strict: false`. Stateless continuation is managed by the app; users do not supply `response_id`.
- **Tool-choice fallback**: In Board Assistant (`web/assistant-provider.js:96-107`), if a provider rejects forced `tool_choice` with HTTP `400`/`422`, the client automatically retries once with plain JSON schema text fallback.

---

## 3. Custom HTTPS Gateway (`AI_ALLOWED_HOSTS`) & SSRF Rules

When `provider === 'custom'`, **both** client URL normalization (`web/model-protocol.js:38-50`) and server SSRF enforcement (`server/matchup.mjs:66-71`) apply:

### Path Normalization Rules
- The app **retains** any prefix path (e.g., `/team/v1` or `/api/v1`) and appends or replaces only the final protocol suffix:
  - `openai` → `/chat/completions`
  - `anthropic` → `/messages`
  - `responses` → `/responses`
- The app **never automatically inserts `/v1`**. If the gateway requires `/v1`, include it in the base URL (e.g., `https://gateway.example.com/v1`).

### Server Allowlist (`dist/server/.dev.vars`)
```dotenv
AI_ALLOWED_HOSTS="gateway.example.com,api.example.net"
```
- Enter lowercase **hostnames only** (comma-separated, no `https://`, no path, no port).
- **Strict rejections** (returns HTTP `400 自定义地址不在管理员允许的安全主机列表中`):
  - Any scheme other than `https:`
  - Any port other than standard `443` (or omitted)
  - Embedded credentials (`user:pass@`), query parameters (`?`), or fragments (`#`)
  - `localhost`, `*.localhost`, `*.local`, `*.internal`
  - IPv4 literals (`/^[0-9.]+$/`) or IPv6 literals (`:` or `[`)
  - Redirect responses are blocked (`redirect: 'manual'` / `'error'`)
- **Implication for Ollama / Local LLMs**: You **cannot** directly enter `http://localhost:11434/v1` or `http://127.0.0.1:11434/v1`. To route to a private or self-hosted OpenAI/Anthropic-compatible gateway, expose it behind a standard-port `443` HTTPS domain (not `.local`/`.internal`/IP) and add that domain to `AI_ALLOWED_HOSTS`.
- **Rebuild warning**: `npm run build` wipes `dist/`, including `dist/server/.dev.vars`. Keep a gitignored backup in `.sites-runtime/dev.vars.backup` (mode `0600`) and restore `AI_ALLOWED_HOSTS` after every rebuild, then restart `npm start`.

---

## 4. `assertPrivateRuntime` LangSmith / OTEL Fail-Closed Trap

Both `/board-assistant` (`server/api.mjs:153`) and `/matchup-analysis` (`server/matchup-agent.mjs:149`) call `assertPrivateRuntime(env)` (`server/matchup-agent.mjs:29-42`), which inspects **both Worker `env` and host Node `process.env`**:

- Fails closed with **HTTP `503`** (`为保护战术数据，请管理员关闭服务端的 LangSmith 跟踪后再分析`) if **any** of the following hold:
  1. `LANGCHAIN_TRACING` is set to **any non-empty string** — **including `"false"`, `"0"`, or `"off"`** (legacy LangChain treats any non-empty string as truthy).
  2. Any of these is `'true'`, `'1'`, or `'yes'` (case-insensitive):
     `LANGSMITH_TRACING`, `LANGSMITH_TRACING_V2`, `LANGCHAIN_TRACING`, `LANGCHAIN_TRACING_V2`, `LANGCHAIN_VERBOSE`, `LANGSMITH_OTEL_ENABLED`, `OTEL_ENABLED`.
  3. `LANGSMITH_TRACING_MODE` is set to a non-empty value other than `'off'`, `'disabled'`, or `'none'`.

**Always launch `npm start` with all 8 variables unset** if the host shell has developer observability tools configured.

---

## 5. Exact Limits, Timeouts, Rate Limits & Knowledge Constraints

| Category | Exact Value | Source |
|---|---|---|
| Shared AI rate limit (Board Assistant + Matchup Analysis) | **12 requests / 60s** per user (`auth_throttles`, key `matchup:<userId>`) → HTTP `429` (`分析请求过于频繁，请稍后重试`); skipped on Coach Film relay resume | `server/api.mjs:28-32,155,236` |
| Board Assistant per-provider-HTTP timeout | `90,000 ms` (90s); no total 90s cap and no fixed 6-turn/10-tool cap; stops after `3` consecutive rounds with no new progress facts | `web/assistant-provider.js:68`, `web/assistant-harness.js:8-9` |
| Board Assistant payload/token budgets (`BOARD_AGENT_LIMITS`) | `parallelCalls: 5`, `replyTokens: 1800`, `transcriptBytes: 120,000`; HTTP body max `MAX_BODY = 950,000` bytes; upstream response max `200,000` bytes | `web/assistant-harness.js:8`, `server/http.mjs:1`, `server/matchup.mjs:95` |
| Coach Film relay continuation token | AES-GCM encrypted + gzipped; expires after **30 minutes**; service key stored in `app_setup(key='board-film-relay-aes-v1')` | `server/board-film-relay.mjs:4,90` |
| Matchup Analysis timeout & budgets (`AGENT_LIMITS`) | Server timeout `90,000 ms` (client `95,000 ms`); `modelCalls: 4`, `toolRounds: 2`, `toolCalls: 6`, `toolRequestsPerTurn: 12`, `toolArguments: 2048`, `contextBytes: 120,000`, `conversationBytes: 250,000`, `maxTokens: 3500`, `recursionLimit: 16`; HTTP body max `48,000` bytes | `server/api.mjs:217,245`, `server/matchup-agent.mjs:9,107,217` |
| Coach notes opt-in cap (Matchup Analysis) | `3,000` chars/play (cloud) / `2,000` chars/play (static demo); default OFF | `server/matchup.mjs:21`, `web/ai-demo.js:20` |
| Built-in coaching knowledge corpus | **13** bilingual principles across **6** sources (`web/data/football-knowledge.js`) | `web/data/football-knowledge.js` |
| Custom knowledge pack limits | Single import file max `1,000,000` bytes / `400` cards / `80` sources / `4,000` chars per card; per-query retrieval max `6` cards / `24,000` UTF-8 bytes; wire cap `32,000` bytes; browser `localStorage` cap `2,000,000` bytes per playbook (local-only, not synced to cloud) | `web/knowledge-base.js:3`, `web/analysis-evidence.js:5-6`, `web/knowledge-store.js:4` |

---

## 6. Safety Workflow & 5v5 Flag Football Notes

- **Preview-first safety UX**: Board Assistant edits (players, routes, zones, formations, playbook CRUD) always render as a translucent **staged preview** first; users can **preview-rehearse**, refine over multiple turns, pick specific change groups, click **Apply (`应用`)** to write as one undoable transaction, or **Discard (`放弃`)**. File/print actions return `awaiting_user` and require clicking **Continue (`继续`)**.
- **5v5 Flag Football**: Flag plays carry explicit `league: 5` (`gameFormat: 'flag5'`) metadata. The AI does not assume offensive line blocking or tackle rules, excludes unadapted 11-player coaching cards from flag matchup retrieval (custom flag knowledge packs can be imported), and warns when comparing 5v5 against 11-player formations.
