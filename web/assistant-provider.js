import { runBoardAssistant, BOARD_AGENT_LIMITS } from './assistant-harness.js';
import { providerMessages } from './locales/assistant-provider.js';

export const DEFAULT_BOARD_MODEL = 'gpt-6.1-terra';
const endpoints = new Map([
  ['openai', 'https://api.openai.com/v1/chat/completions'],
  ['openrouter', 'https://openrouter.ai/api/v1/chat/completions'],
]);
const words = locale => providerMessages[locale === 'en' ? 'en' : 'zh-CN'];
const text = (value, limit) => typeof value === 'string' ? value.trim().slice(0, limit) : '';
const validPoint = point => point && [point.x, point.y].every(n => Number.isFinite(n) && n >= 0 && n <= 100);

export function boardAssistantInput({ instruction, board, locale, mode, previous }) {
  if (typeof instruction !== 'string' || !instruction.trim() || instruction.length > 2000)
    throw new Error(words(locale).instruction);
  const players = (Array.isArray(board?.players) ? board.players : []).slice(0, 48)
    .filter(p => validPoint(p) && typeof p.id === 'string')
    .map(p => {
      const name = text(p.name, 100);
      return { id: p.id, label: text(p.label, 80), position: text(p.position, 40), side: p.side, x: p.x, y: p.y,
        ...(p.number != null ? { number: text(String(p.number), 12) } : {}),
        ...(name ? { name } : {}) };
    });
  const selected = board?.selectedPlayerId;
  const routes = (Array.isArray(board?.routes) ? board.routes : []).slice(0, 100)
    .filter(r => players.some(p => p.id === r?.playerId) && Array.isArray(r.points))
    .map(r => ({ id: text(r.id, 100), playerId: r.playerId, kind: text(r.kind, 16), optional: !!r.optional, delay: r.delay, duration: r.duration, blockTargets: r.blockTargets,
      points: r.points.filter(validPoint).slice(0, 32).map(({ x, y }) => ({ x, y })) }));
  return { instruction: instruction.trim(), locale: locale === 'en' ? 'en' : 'zh-CN', mode: ['edit', 'search'].includes(mode) ? mode : 'auto',
    previous: Array.isArray(previous) ? previous.slice(-5) : [],
    board: { playId: text(board?.playId ?? board?.id, 100), title: text(board?.title, 120), book: board?.book, formation: board?.formation, ball: board?.ball, zones: board?.zones || [], annotations: board?.annotations || [], geometry: { losY: 67, xUnitsPerYard: 1.875, yUnitsPerYard: 2, offenseDirection: 'decreasing_y' }, players, routes,
      ...(players.some(p => p.id === selected) ? { selectedPlayerId: selected } : {}) } };
}

function anthropicMessages(messages) {
  const out = [];
  for (const m of messages.slice(1)) {
    if (m.role === 'tool') {
      const block = { type: 'tool_result', tool_use_id: m.tool_call_id, content: m.content };
      const last = out.at(-1);
      if (last?.role === 'user' && Array.isArray(last.content)) last.content.push(block);
      else out.push({ role: 'user', content: [block] });
    } else out.push({ role: m.role, content: m.anthropicContent ?? m.content });
  }
  return out;
}

function transport(config, locale, fetchImpl, readResponse, signal) {
  const anthropic = config.protocol === 'anthropic';
  const max = BOARD_AGENT_LIMITS.replyTokens;
  return async (messages, definitions, allowTools) => {
    const headers = { 'Content-Type': 'application/json' };
    let payload;
    if (anthropic) {
      headers['x-api-key'] = config.apiKey;
      headers['anthropic-version'] = '2023-06-01';
      payload = { model: config.model, system: messages[0].content, messages: anthropicMessages(messages), max_tokens: max,
        tools: definitions.map(({ function: f }) => ({ name: f.name, description: f.description, input_schema: f.parameters })),
        tool_choice: { type: allowTools ? 'auto' : 'none' } };
    } else {
      headers.Authorization = 'Bearer ' + config.apiKey;
      payload = { model: config.model, messages, tools: definitions, tool_choice: allowTools ? 'auto' : 'none',
        ...(config.provider === 'openai' ? { max_completion_tokens: max } : { max_tokens: max }) };
    }
    // Terra's Chat Completions endpoint accepts function tools with reasoning disabled.
    if (config.provider === 'openai' && config.model === 'gpt-6.1-terra') payload.reasoning_effort = 'none';
    if (config.provider === 'deepseek') payload.thinking = { type: 'disabled' };
    let response;
    try { response = await fetchImpl(config.endpoint, { method: 'POST', headers, credentials: 'omit', redirect: 'error', body: JSON.stringify(payload), signal }); }
    catch { throw new Error(signal.aborted ? words(locale).timeout : words(locale).network); }
    if (!response.ok) throw new Error(words(locale).failed + ' (HTTP ' + response.status + ')');
    let data;
    try { data = await readResponse(response); } catch { throw new Error(words(locale).invalid); }
    if (anthropic && Array.isArray(data?.content)) {
      const calls = data.content.filter(b => b.type === 'tool_use').map(b => ({ id: b.id, type: 'function', function: { name: b.name, arguments: JSON.stringify(b.input) } }));
      return { role: 'assistant', anthropicContent: data.content, content: data.content.filter(b => b.type === 'text').map(b => b.text).join(''), tool_calls: calls };
    }
    const m = data?.choices?.[0]?.message;
    if (!m || (m.tool_calls != null && !Array.isArray(m.tool_calls))) throw new Error(words(locale).invalid);
    return { role: 'assistant', content: typeof m.content === 'string' ? m.content : null,
      ...(Array.isArray(m.tool_calls) && m.tool_calls.length ? { tool_calls: m.tool_calls } : {}),
      ...(typeof m.reasoning_content === 'string' ? { reasoning_content: m.reasoning_content } : {}) };
  };
}

export async function invokeBoardModel(config, input, { signal, fetchImpl = fetch, readResponse = r => r.json(), runtime, searchCatalog, onTool, reauthorize } = {}) {
  const run = new AbortController();
  const abort = () => run.abort();
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) abort();
  const timer = setTimeout(abort, 90000);
  try {
    const send = transport(config, input.locale, fetchImpl, readResponse, run.signal);
    return await runBoardAssistant({ input, runtime, searchCatalog, signal: run.signal, onTool,
      async callModel(messages, tools, allowTools) {
        if (reauthorize) await reauthorize();
        return send(messages, tools, allowTools);
      } });
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}

export async function requestBoardAssistant({ instruction, board, locale, mode, previous, model, signal, workspace, request, fetchImpl, runtime, loadCatalog, onTool }) {
  const input = boardAssistantInput({ instruction, board, locale, mode, previous });
  const provider = model?.provider || 'openai';
  const modelId = model?.model?.trim() || (provider === 'openai' ? DEFAULT_BOARD_MODEL : '');
  const apiKey = model?.apiKey?.trim();
  if (!modelId || modelId.length > 160 || !apiKey || apiKey.length > 512 || /[^\x21-\x7e]/.test(apiKey)) throw new Error(words(locale).settings);
  const config = { ...model, provider, model: modelId, apiKey };
  if (workspace) {
    const path = '/api/workspaces/' + encodeURIComponent(workspace.id) + '/board-assistant';
    if (!onTool) return request(path, {method:'POST', body:{...input, model:config, revision:workspace.revision}, signal});
    const response = await (fetchImpl || fetch)(path, {method:'POST', credentials:'same-origin', cache:'no-store',
      headers:{'Content-Type':'application/json'}, body:JSON.stringify({...input, model:config, revision:workspace.revision, stream:true}), signal});
    if (!response.ok) {
      let payload; try { payload = await response.json(); } catch { payload = {}; }
      throw Object.assign(new Error(payload.error || words(locale).failed), {status:response.status});
    }
    const reader = response.body.getReader(), decoder = new TextDecoder();
    let pending = '', result;
    while (true) {
      const {value, done} = await reader.read();
      pending += decoder.decode(value || new Uint8Array(), {stream:!done});
      const lines = pending.split('\n'); pending = lines.pop();
      for (const line of lines) {
        if (!line) continue;
        const event = JSON.parse(line);
        if (event.type === 'tool') onTool(event.name, event.args);
        if (event.type === 'result') result = event.result;
        if (event.type === 'error') throw Object.assign(new Error(event.error), {status:event.status});
      }
      if (done) break;
    }
    if (!result) throw new Error(words(locale).invalid);
    return result;
  }
  const endpoint = endpoints.get(provider);
  if (!endpoint) throw new Error(words(locale).unsupported);
  const searchCatalog = async(args, options) => {
    const { searchMaddenCatalog, loadAssistantCatalog } = await import('./assistant-search.js');
    return searchMaddenCatalog(await (loadCatalog || loadAssistantCatalog)(), args, options);
  };
  return invokeBoardModel({ ...config, protocol: 'openai', endpoint }, input, {
    runtime: runtime || await import('./vendor/assistant-langgraph.js'), signal, fetchImpl, searchCatalog, onTool,
  });
}
