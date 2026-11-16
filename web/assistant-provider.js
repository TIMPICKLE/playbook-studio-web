import { runBoardAssistant, BOARD_AGENT_LIMITS } from './assistant-harness.js';
import { providerMessages } from './locales/assistant-provider.js';
import { validatePlay, COLORS, clone, decodeWorkspace, encodeWorkspace } from './model.js';
import { submitResultTool } from './assistant-schema.js';
import { buildModelRequest, parseModelResponse, resolveModelEndpoint } from './model-protocol.js';
import { getPlayLeague, isFlag5Play } from './game-formats.js';

export const DEFAULT_BOARD_MODEL = 'gpt-6.1-terra';
const words = locale => providerMessages[locale === 'en' ? 'en' : 'zh-CN'];
const text = (value, limit) => typeof value === 'string' ? value.trim().slice(0, limit) : '';
const validPoint = point => point && [point.x, point.y].every(n => Number.isFinite(n) && n >= 0 && n <= 100);

export function boardAssistantInput({ instruction, board, locale, mode, previous, editor }) {
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
  const flag5 = isFlag5Play(play);
  const compactPlayers = play.players.map(p => {
    const original = (board?.players || rawPlayers).find(item => item.id === p.id) || p;
    return {...p, name:text(original.name || p.name,100), position:text(original.position || p.label,40), ...(original.number != null ? {number:text(String(original.number),12)} : {}), ...(flag5 ? { gameFormat: 'flag5' } : {})};
  });
  const selected = board?.selectedPlayerId;
  let editorContext;
  if (editor) {
    const data=editor.data ? decodeWorkspace(encodeWorkspace(editor.data)) : undefined;
    if (data) {
      const index=data.plays.findIndex(item => item.id === play.id);
      if (index < 0) throw new Error(words(locale).invalid);
      data.plays[index]=clone(play);
    }
    const view=editor.view && typeof editor.view === 'object' && !Array.isArray(editor.view) ? clone(editor.view) : {};
    if (JSON.stringify(view).length > 12000) throw new Error(words(locale).invalid);
    editorContext={data,selectedId:play.id,view,readOnly:editor.readOnly === true};
  }
  return {instruction:instruction.trim(),locale:locale === 'en' ? 'en' : 'zh-CN',mode:['edit','search'].includes(mode) ? mode : 'auto',
    ...(editorContext ? {editor:editorContext} : {}),
    previous:Array.isArray(previous) ? previous.slice(-5) : [],
    board:{...play, playId:play.id, players:compactPlayers, play, playersPerSide:getPlayLeague(play), gameFormat:flag5 ? 'flag5' : 'unspecified',
      geometry:{losY:67,xUnitsPerYard:1.875,yUnitsPerYard:2,offenseDirection:'decreasing_y', ...(flag5 ? { scale:'diagram_grid', regulationFieldVerified:false } : {})},
      ...(play.players.some(p => p.id === selected) ? {selectedPlayerId:selected} : {})}};
}

function transport(config, locale, fetchImpl, readResponse, signal, onRequest) {
  const max = BOARD_AGENT_LIMITS.replyTokens;
  return async (messages, definitions, allowTools, {forceSubmit = false} = {}) => {
    const makeRequest = (history, tools, toolChoice) => buildModelRequest(config,history,{tools,toolChoice,maxTokens:max,browser:config.browser === true});
    const payload = makeRequest(messages,definitions,forceSubmit ? {type:'function',function:{name:'submit_result'}} : 'auto');
    const send = async ({headers,body}) => {
      if (signal?.aborted) throw signal.reason || new DOMException('The assistant request was cancelled.', 'AbortError');
      const request = new AbortController();
      const abort = () => request.abort(signal.reason);
      signal?.addEventListener('abort', abort, {once:true});
      let timedOut = false, reading = false, rejectAbort;
      const aborted = new Promise((_,reject) => { rejectAbort = reject; });
      const stopped = () => rejectAbort(request.signal.reason);
      request.signal.addEventListener('abort', stopped, {once:true});
      const timer = setTimeout(() => { timedOut = true; request.abort(); },90000);
      try {
        const operation = async () => {
          onRequest?.();
          const response = await fetchImpl(config.endpoint, {method:'POST',headers,credentials:'omit',redirect:'error',body:JSON.stringify(body),signal:request.signal});
          reading = true;
          let data;
          try { data = await readResponse(response); }
          catch (error) {
            if (response.ok || request.signal.aborted) throw error;
            data = {};
          }
          return {response,data};
        };
        // Race the body reader too: provider headers alone are not a completed
        // response, and custom readers need not implement AbortSignal support.
        return await Promise.race([operation(),aborted]);
      } catch {
        if (signal?.aborted) throw signal.reason || new DOMException('The assistant request was cancelled.', 'AbortError');
        throw new Error(timedOut ? words(locale).timeout : reading ? words(locale).invalid : words(locale).network);
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener('abort', abort);
        request.signal.removeEventListener('abort', stopped);
      }
    };
    let {response,data} = await send(payload);
    let textFallback = false;
    if (!response.ok) {
      const detail = String(data?.error?.message || data?.message || '');
      const unsupportedChoice = forceSubmit && [400,422].includes(response.status) &&
        /tool[_ -]?choice|forced? tool|function selection/i.test(detail) && /not supported|unsupported|does not support|not allowed/i.test(detail);
      if (!unsupportedChoice) throw new Error(words(locale).failed + ' (HTTP ' + response.status + ')');
      textFallback = true;
      const fallbackMessages = [...messages,{role:'user',content:'This provider cannot force a tool. Return only the inner result object as JSON according to this generated contract: '+JSON.stringify(submitResultTool.function.parameters.properties.result)}];
      const fallback = makeRequest(fallbackMessages,config.protocol === 'anthropic' ? definitions : [],'auto');
      delete fallback.body.tool_choice;
      ({response,data} = await send(fallback));
      if (!response.ok) throw new Error(words(locale).failed + ' (HTTP ' + response.status + ')');
    }
    try { return {...parseModelResponse(config,data),textFallback}; }
    catch (error) { throw new Error(words(locale).invalid + (error?.message ? ' ' + error.message : '')); }
  };
}

export async function invokeBoardModel(config, input, { signal, fetchImpl = fetch, readResponse = r => r.json(), runtime, searchCatalog, onTool, onEvent, reauthorize } = {}) {
  let providerCalls = 0;
  const send = transport(config, input.locale, fetchImpl, readResponse, signal, () => providerCalls++);
  const result = await runBoardAssistant({ input, runtime, searchCatalog, signal, onTool, onEvent,
    async callModel(messages, tools, allowTools, options) {
      if (reauthorize) await reauthorize();
      return send(messages, tools, allowTools, options);
    } });
  return {...result,providerCalls};
}

export async function requestBoardAssistant({ instruction, board, locale, mode, previous, editor, model, signal, workspace, request, fetchImpl, runtime, loadCatalog, onTool, onEvent }) {
  const input = boardAssistantInput({ instruction, board, locale, mode, previous, editor });
  const provider = model?.provider || 'openai';
  const modelId = model?.model?.trim() || (provider === 'openai' ? DEFAULT_BOARD_MODEL : '');
  const apiKey = model?.apiKey?.trim();
  if (!modelId || modelId.length > 160 || !apiKey || apiKey.length > 512 || /[^\x21-\x7e]/.test(apiKey)) throw new Error(words(locale).settings);
  const config = { ...model, provider, model: modelId, apiKey };
  if (workspace) {
    // The Worker supplies authoritative workspace data; transmit only local view state.
    const payloadInput={...input,...(input.editor ? {editor:{view:input.editor.view}} : {})};
    const path = '/api/workspaces/' + encodeURIComponent(workspace.id) + '/board-assistant';
    if (!onTool && !onEvent) return request(path, {method:'POST', body:{...payloadInput, model:config, revision:workspace.revision}, signal});
    const response = await (fetchImpl || fetch)(path, {method:'POST', credentials:'same-origin', cache:'no-store',
      headers:{'Content-Type':'application/json'}, body:JSON.stringify({...payloadInput, model:config, revision:workspace.revision, stream:true}), signal});
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
  let resolved;
  try { resolved=resolveModelEndpoint(config); }
  catch (error) { throw new Error(words(locale).settings + (error?.message ? ' ' + error.message : '')); }
  const searchCatalog = async(args, options) => {
    const { searchMaddenCatalog, loadAssistantCatalog } = await import('./assistant-search.js');
    return searchMaddenCatalog(await (loadCatalog || loadAssistantCatalog)(), args, options);
  };
  if (input.editor) input.editor.loadCatalog = loadCatalog || (await import('./assistant-search.js')).loadAssistantCatalog;
  return invokeBoardModel({ ...resolved, browser:true }, input, {
    runtime: runtime || await import('./vendor/assistant-langgraph.js'), signal, fetchImpl, searchCatalog, onTool, onEvent,
  });
}
