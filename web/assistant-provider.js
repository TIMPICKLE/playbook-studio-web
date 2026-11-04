import { runBoardAssistant, BOARD_AGENT_LIMITS } from './assistant-harness.js';
import { providerMessages } from './locales/assistant-provider.js';
import { validatePlay, COLORS } from './model.js';
import { submitResultTool } from './assistant-schema.js';

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
  const source = board?.play || board || {};
  const rawPlayers = Array.isArray(source.players) ? source.players : [];
  const players = rawPlayers.map(p => ({...p, name:p.name || '', color:p.color || COLORS[p.side] || COLORS.offense, shape:p.shape || (p.side === 'defense' ? 'square' : 'circle')}));
  const routes = (source.routes || []).map(r => ({...r, color:r.color || players.find(p => p.id === r.playerId)?.color || COLORS.route,
    delay:r.delay ?? 0, duration:r.duration ?? 4, endCap:r.endCap || (r.kind === 'block' ? 'bar' : 'arrow')}));
  const play = validatePlay({...source, id:source.id || board?.playId || 'assistant-play', title:source.title || 'Current play', book:source.book || 'offense',
    formation:source.formation || 'Custom', category:source.category || 'Custom', personnel:source.personnel || 'Custom', notes:source.notes || '', createdAt:source.createdAt || '',
    players, routes, zones:source.zones || [], annotations:source.annotations || [],
    ball:source.ball || {holderId:players[0]?.id || '',receiverId:'',passAt:2,arriveAt:3}});
  const compactPlayers = play.players.map(p => {
    const original = (board?.players || rawPlayers).find(item => item.id === p.id) || p;
    return {...p, name:text(original.name || p.name,100), position:text(original.position || p.label,40), ...(original.number != null ? {number:text(String(original.number),12)} : {})};
  });
  const selected = board?.selectedPlayerId;
  return {instruction:instruction.trim(),locale:locale === 'en' ? 'en' : 'zh-CN',mode:['edit','search'].includes(mode) ? mode : 'auto',
    previous:Array.isArray(previous) ? previous.slice(-5) : [],
    board:{...play, playId:play.id, players:compactPlayers, play,
      geometry:{losY:67,xUnitsPerYard:1.875,yUnitsPerYard:2,offenseDirection:'decreasing_y'},
      ...(play.players.some(p => p.id === selected) ? {selectedPlayerId:selected} : {})}};
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

function transport(config, locale, fetchImpl, readResponse, signal, onRequest) {
  const anthropic = config.protocol === 'anthropic';
  const max = BOARD_AGENT_LIMITS.replyTokens;
  return async (messages, definitions, allowTools, {forceSubmit = false} = {}) => {
    const headers = { 'Content-Type': 'application/json' };
    let payload;
    if (anthropic) {
      headers['x-api-key'] = config.apiKey;
      headers['anthropic-version'] = '2023-06-01';
      payload = { model: config.model, system: messages[0].content, messages: anthropicMessages(messages), max_tokens: max,
        tools: definitions.map(({ function: f }) => ({ name: f.name, description: f.description, input_schema: f.parameters })),
        tool_choice: forceSubmit ? {type:'tool',name:'submit_result'} : {type:'auto'} };
    } else {
      headers.Authorization = 'Bearer ' + config.apiKey;
      payload = { model: config.model, messages, tools: definitions, tool_choice: forceSubmit ? {type:'function',function:{name:'submit_result'}} : 'auto',
        ...(config.provider === 'openai' ? { max_completion_tokens: max } : { max_tokens: max }) };
    }
    // Terra's Chat Completions endpoint accepts function tools with reasoning disabled.
    if (config.provider === 'openai' && config.model === 'gpt-6.1-terra') payload.reasoning_effort = 'none';
    if (config.provider === 'deepseek') payload.thinking = { type: 'disabled' };
    const send = async body => {
      try { onRequest?.(); return await fetchImpl(config.endpoint, {method:'POST',headers,credentials:'omit',redirect:'error',body:JSON.stringify(body),signal}); }
      catch { throw new Error(signal.aborted ? words(locale).timeout : words(locale).network); }
    };
    let response = await send(payload);
    let data, textFallback = false;
    if (!response.ok) {
      let errorPayload;
      try { errorPayload = await readResponse(response); } catch { errorPayload = {}; }
      const detail = String(errorPayload?.error?.message || errorPayload?.message || '');
      const unsupportedChoice = forceSubmit && [400,422].includes(response.status) &&
        /tool[_ -]?choice|forced? tool|function selection/i.test(detail) && /not supported|unsupported|does not support|not allowed/i.test(detail);
      if (!unsupportedChoice) throw new Error(words(locale).failed + ' (HTTP ' + response.status + ')');
      textFallback = true;
      const {tools,tool_choice,...fallback} = payload;
      fallback.messages = [...payload.messages,{role:'user',content:'This provider cannot force a tool. Return only the inner result object as JSON according to this generated contract: '+JSON.stringify(submitResultTool.function.parameters.properties.result)}];
      response = await send(fallback);
      if (!response.ok) throw new Error(words(locale).failed + ' (HTTP ' + response.status + ')');
    }
    try { data = await readResponse(response); } catch { throw new Error(words(locale).invalid); }
    if (anthropic && Array.isArray(data?.content)) {
      const calls = data.content.filter(b => b.type === 'tool_use').map(b => ({ id: b.id, type: 'function', function: { name: b.name, arguments: JSON.stringify(b.input) } }));
      return { role: 'assistant', textFallback, anthropicContent: data.content, content: data.content.filter(b => b.type === 'text').map(b => b.text).join(''), tool_calls: calls };
    }
    const m = data?.choices?.[0]?.message;
    if (!m || (m.tool_calls != null && !Array.isArray(m.tool_calls))) throw new Error(words(locale).invalid);
    return { role: 'assistant', textFallback, content: typeof m.content === 'string' ? m.content : null,
      ...(Array.isArray(m.tool_calls) && m.tool_calls.length ? { tool_calls: m.tool_calls } : {}),
      ...(typeof m.reasoning_content === 'string' ? { reasoning_content: m.reasoning_content } : {}) };
  };
}

export async function invokeBoardModel(config, input, { signal, fetchImpl = fetch, readResponse = r => r.json(), runtime, searchCatalog, onTool, onEvent, reauthorize } = {}) {
  const run = new AbortController();
  const abort = () => run.abort();
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) abort();
  const timer = setTimeout(abort, 90000);
  try {
    let providerCalls = 0;
    const send = transport(config, input.locale, fetchImpl, readResponse, run.signal, () => providerCalls++);
    const result = await runBoardAssistant({ input, runtime, searchCatalog, signal: run.signal, onTool, onEvent,
      async callModel(messages, tools, allowTools, options) {
        if (reauthorize) await reauthorize();
        return send(messages, tools, allowTools, options);
      } });
    return {...result,providerCalls};
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}

export async function requestBoardAssistant({ instruction, board, locale, mode, previous, model, signal, workspace, request, fetchImpl, runtime, loadCatalog, onTool, onEvent }) {
  const input = boardAssistantInput({ instruction, board, locale, mode, previous });
  const provider = model?.provider || 'openai';
  const modelId = model?.model?.trim() || (provider === 'openai' ? DEFAULT_BOARD_MODEL : '');
  const apiKey = model?.apiKey?.trim();
  if (!modelId || modelId.length > 160 || !apiKey || apiKey.length > 512 || /[^\x21-\x7e]/.test(apiKey)) throw new Error(words(locale).settings);
  const config = { ...model, provider, model: modelId, apiKey };
  if (workspace) {
    const path = '/api/workspaces/' + encodeURIComponent(workspace.id) + '/board-assistant';
    if (!onTool && !onEvent) return request(path, {method:'POST', body:{...input, model:config, revision:workspace.revision}, signal});
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
        if (event.type === 'tool') onTool?.(event.name,event.args);
        if (event.type === 'trace') onEvent?.(event.event);
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
    runtime: runtime || await import('./vendor/assistant-langgraph.js'), signal, fetchImpl, searchCatalog, onTool, onEvent,
  });
}
