import { createBoardTools } from './assistant-tools.js';
import { providerMessages } from './locales/assistant-provider.js';

export const BOARD_AGENT_LIMITS = Object.freeze({ modelCalls: 6, toolCalls: 10, parallelCalls: 5, replyTokens: 1800, transcriptBytes: 120000 });
const instructions = `You are a football coaching assistant. Use read-only tools to inspect the board and find real player IDs before making proposals. Before answering a question about the current play, call read_board and ground the answer in its contents. Distinguish visible facts from tactical suggestions. If the diagram does not specify a read order, explicitly say it is unknown rather than claiming a first read. Use resolve_players with selectMany for explicit groups such as the OL. Do not guess when a target is missing or ambiguous. Search Madden by concepts, tags or similarToCurrent. Explain recommendations briefly and conditionally.
Return JSON in the user's language:
{"kind":"edit","summary":"brief changes","operations":[{"kind":"route","playerId":"resolved ID","concept":"dig","depthYards":12,"breakTo":"inside"}]}.
Operations may be block with playerId and targetIds, or playerIds, scheme and direction; route with concept, depthYards and breakTo (or points); motion with playerId,type,toward; move_player with playerId,dxYards,dyYards or alignment; pass with receiverId,throwAt,arriveAt; zone with preset,side and optional playerId; timing with playerId,delay,duration; remove_route with playerId; annotate with text,nearId.
{"kind":"search","matches":[{"id":"actual catalog ID","reason":"brief evidence"}]}
{"kind":"answer","message":"answer grounded in board","highlights":["resolved player or inspected route ID"]}
{"kind":"handoff","message":"why matchup analysis is appropriate","playId":"current play ID"}
{"kind":"clarify","message":"question"}.
Previous entries describe earlier work in the same editor; use current tools to confirm referenced IDs. Progress is determined by tools, never claim an edit is already applied.`;

export function validateBoardReply(value, input, tools) {
  const invalid = () => { throw new Error(providerMessages[input.locale].invalid); };
  if ((input.mode === 'search' && value?.kind === 'edit') || ((input.mode === 'edit' || input.board.book === 'defense') && value?.kind === 'search')) invalid();
  const line = (s, max) => typeof s === 'string' ? s.trim().slice(0, max) : '';
  if (value?.kind === 'clarify' && line(value.message, 420)) return { kind: 'clarify', message: line(value.message, 420) };
  if (value?.kind === 'search' && tools.didSearch() && Array.isArray(value.matches) && value.matches.length <= 4) {
    const allowed = new Set(tools.candidates.keys());
    const matches = value.matches.map(m => {
      if (!m || !allowed.delete(m.id) || !line(m.reason, 450)) invalid();
      return { id: m.id, reason: line(m.reason, 450) };
    });
    const similarRanks = tools.getSimilarRanks();
    if (similarRanks) {
      if (matches.some(match => !similarRanks.has(match.id))) invalid();
      matches.sort((a, b) => similarRanks.get(a.id) - similarRanks.get(b.id));
    }
    return { kind: 'search', matches };
  }
  if (value?.kind === 'answer' && line(value.message, 1500) && tools.didReadBoard()) {
    const highlights = value.highlights || [];
    if (!Array.isArray(highlights) || highlights.length > 32 || !highlights.every(id => tools.resolved.has(id) || tools.routeIds.has(id))) invalid();
    return { kind: 'answer', message: line(value.message, 1500), highlights };
  }
  if (value?.kind === 'handoff' && line(value.message, 420) && value.playId === input.board.playId)
    return {kind:'handoff', message:line(value.message, 420), playId:value.playId};
  if (value?.kind !== 'edit') invalid();
  const legacy = !value.operations && value.operation;
  const operations = legacy ? [value.operation] : value.operations;
  if (!Array.isArray(operations) || !operations.length || operations.length > 32) invalid();
  const kinds = ['block', 'route', 'motion', 'move_player', 'pass', 'zone', 'timing', 'remove_route', 'annotate'];
  const coordinate = n => Number.isFinite(n) && n >= 0 && n <= 100;
  for (const op of operations) {
    if (!op || typeof op !== 'object' || !kinds.includes(op.kind)) invalid();
    const ids = [op.playerId, op.receiverId, op.nearId, ...(Array.isArray(op.playerIds) ? op.playerIds : []), ...(Array.isArray(op.targetIds) ? op.targetIds : [])].filter(id => id != null);
    if (!ids.every(id => typeof id === 'string' && tools.resolved.has(id))) invalid();
    if (op.routeId && (!tools.routeIds.has(op.routeId) || !op.playerId ||
      !input.board.routes.some(route => route.id === op.routeId && route.playerId === op.playerId))) invalid();
    if (['route','motion','move_player','timing','remove_route'].includes(op.kind) && !op.playerId) invalid();
    if (op.kind === 'block') {
      const actors = op.playerIds || [op.playerId];
      if (!actors.length || actors.length > 20 || actors.some(id => !id)) invalid();
      if (op.targetIds) {
        if (!Array.isArray(op.targetIds) || !op.targetIds.length || op.targetIds.length > 6 || new Set(op.targetIds).size !== op.targetIds.length) invalid();
        if (actors.some(id => op.targetIds.some(target => input.board.players.find(p => p.id === id)?.side === input.board.players.find(p => p.id === target)?.side))) invalid();
      } else if (!['zone','gap','pass_pro'].includes(op.scheme)) invalid();
    }
    if (op.kind === 'route' && op.points && (!Array.isArray(op.points) || !op.points.length || op.points.length > 32 || !op.points.every(p => p && coordinate(p.x) && coordinate(p.y)))) invalid();
    if (op.kind === 'route' && !op.points && (!['slant','out','in','dig','curl','comeback','hitch','post','corner','go','fade','seam','flat','wheel','drag','screen'].includes(op.concept) || !Number.isFinite(op.depthYards) || op.depthYards <= 0 || op.depthYards > 40 || (op.breakTo && !['inside','outside'].includes(op.breakTo)))) invalid();
    if (op.kind === 'pass' && !op.receiverId) invalid();
    if (op.kind === 'annotate' && (!op.nearId || !line(op.text, 300))) invalid();
  }
  if (legacy) return {kind:'edit', operation:operations[0]};
  return {kind:'edit', summary:line(value.summary, 500), operations};

}

// Each invocation owns its transcript and tool evidence. Credentials stay in the transport closure.
export async function runBoardAssistant({ runtime, input, callModel, searchCatalog, signal, onTool }) {
  if (input.board.book === 'defense' && input.mode === 'search') return {
    kind:'clarify', message: input.locale === 'en' ? 'The Madden catalog contains offense plays. Switch to an offense playbook to search.' : 'Madden 战术库目前为进攻战术，请切换到进攻战术本后搜索。',
    toolsUsed:[], modelCalls:0,
  };
  const { Annotation, StateGraph, START, END } = runtime;
  const limits = BOARD_AGENT_LIMITS;
  const msg = providerMessages[input.locale];
  const tools = createBoardTools(input, searchCatalog);
  const used = [];
  const conversation = [{ role: 'system', content: instructions }, { role: 'user',
    content: JSON.stringify({ instruction: input.instruction, locale: input.locale, selectedPlayerId: input.board.selectedPlayerId, mode: input.mode, previous: input.previous }) }];
  let pending, result;
  const checked = () => { if (signal?.aborted) throw new Error(msg.timeout); };
  const state = Annotation.Root({ next: Annotation(), modelCalls: Annotation(), repaired: Annotation() });
  const graph = new StateGraph(state)
    .addNode('model', async state => {
      checked();
      if (state.modelCalls >= limits.modelCalls || new TextEncoder().encode(JSON.stringify(conversation)).length > limits.transcriptBytes) throw new Error(msg.limit);
      const modelCalls = state.modelCalls + 1;
      const allowTools = modelCalls < limits.modelCalls && used.length < limits.toolCalls;
      pending = await callModel(conversation, tools.definitions, allowTools);
      checked();
      const calls = pending.tool_calls || [];
      if (calls.length && (!allowTools || calls.length > limits.parallelCalls || used.length + calls.length > limits.toolCalls)) throw new Error(msg.limit);
      return { modelCalls, next: calls.length ? 'tools' : 'validate' };
    })
    .addNode('tools', async () => {
      conversation.push(pending);
      const ids = new Set();
      for (const call of pending.tool_calls) {
        checked();
        const fn = call?.function;
        if (call?.type !== 'function' || typeof call.id !== 'string' || !call.id || ids.has(call.id) ||
          typeof fn?.name !== 'string' || typeof fn.arguments !== 'string' || fn.arguments.length > 2000) throw new Error(msg.invalid);
        ids.add(call.id);
        let args;
        try { args = JSON.parse(fn.arguments); } catch { args = null; }
        used.push(fn.name);
        onTool?.(fn.name, args);
        const output = await tools.run(fn.name, args);
        conversation.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(output) });
      }
      return { next: 'model' };
    })
    .addNode('validate', state => {
      const raw = pending.content;
      try {
        if (typeof raw !== 'string' || raw.length > 32000) throw new Error(msg.invalid);
        result = validateBoardReply(JSON.parse(raw.replace(/^\s*```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '')), input, tools);
      } catch {
        if (state.repaired || state.modelCalls >= limits.modelCalls) throw new Error(msg.invalid);
        conversation.push({ role: 'assistant', content: typeof raw === 'string' ? raw.slice(0, 3000) : '' },
          { role: 'user', content: 'Invalid or ungrounded JSON. Inspect the required tools and retry with their exact IDs, or ask for clarification.' });
        return { next: 'model', repaired: true };
      }
      return { next: END };
    })
    .addEdge(START, 'model')
    .addConditionalEdges('model', s => s.next, ['tools', 'validate'])
    .addEdge('tools', 'model')
    .addConditionalEdges('validate', s => s.next, ['model', END]).compile();
  const finalState = await graph.invoke({ next: 'model', modelCalls: 0, repaired: false }, { recursionLimit: 20, signal });
  checked();
  return { ...result, toolsUsed: used, modelCalls: finalState.modelCalls };
}
