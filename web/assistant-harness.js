import { createBoardTools } from './assistant-tools.js';
import { providerMessages } from './locales/assistant-provider.js';
import { proposeEdit } from './assistant-proposal.js';
import { parseBoardResult, SubmitResultSchema, submitResultTool } from './assistant-schema.js';

export const BOARD_AGENT_LIMITS = Object.freeze({ modelCalls: 6, toolCalls: 10, parallelCalls: 5, replyTokens: 1800, transcriptBytes: 120000 });
const instructions = `You are a football coaching assistant. Use read-only tools to inspect the current diagram and resolve real IDs. Do not guess missing or ambiguous players. Use resolve_players for explicit groups such as OL. Before answering about the current play, read_board and distinguish diagram facts from tactical suggestions. If read order is not recorded, say it is unknown.
Choose operations by intent: route for a measured route-tree concept, block for ordered contacts or a blocking scheme, motion for pre-snap movement, move_player for alignment, pass for ball timing, zone for coverage, timing for an existing route, remove_route to remove an assignment, and annotate for coach notes. Coordinates and geometry are the domain layer's responsibility. Prefer semantic route concepts with depth in yards. Inspect stored route intent when following up.
Before submitting any edit, call preview_edit with the entire operation group. Inspect the returned measured effects, breaks and target order. Correct a mismatch before submitting the same group through submit_result. An edit is a proposal until the coach accepts it.
Search Madden by concepts, tags or similarity, inspect catalog evidence, and explain recommendations briefly and conditionally. Use answer for grounded board questions, clarify for missing information, and handoff when the coach needs the separate offense-versus-defense analysis. Keep the original instruction and any named coverage or defense in handoff context.
Previous entries are structured context from this same play, including accepted or discarded proposals. Confirm current IDs through tools. Use submit_result to finish in the user's language. Only if the provider requires text fallback, return an object conforming to that tool's result schema as plain JSON.`;

export function validateBoardReply(value, input, tools, {requirePreview = false} = {}) {
  const msg = providerMessages[input.locale];
  const invalid = reason => { throw new Error(reason || msg.invalid); };
  const legacy = value?.kind === 'edit' && !value.operations && value.operation;
  const result = parseBoardResult(value);
  if ((input.mode === 'search' && result.kind === 'edit') || ((input.mode === 'edit' || input.board.book === 'defense') && result.kind === 'search')) invalid();
  if (result.kind === 'clarify') return result;
  if (result.kind === 'search') {
    if (!tools.didSearch()) invalid();
    const allowed = new Set(tools.candidates.keys());
    for (const match of result.matches) if (!allowed.delete(match.id)) invalid();
    const ranks = tools.getSimilarRanks();
    if (ranks) {
      if (result.matches.some(match => !ranks.has(match.id))) invalid();
      result.matches.sort((a,b) => ranks.get(a.id) - ranks.get(b.id));
    }
    return result;
  }
  if (result.kind === 'answer') {
    if (!tools.didReadBoard() || !(result.highlights || []).every(id => tools.resolved.has(id) || tools.routeIds.has(id))) invalid();
    return {...result, highlights:result.highlights || []};
  }
  if (result.kind === 'handoff') {
    if (result.playId !== input.board.playId) invalid();
    return {...result, context:{...result.context, instruction:result.context?.instruction || input.instruction}};
  }
  tools.assertReferences(result.operations);
  proposeEdit(input.board.play || input.board, result.operations, {locale:input.locale});
  if (requirePreview && !tools.getPreview(result.operations)) invalid('Call preview_edit with this complete operation group and inspect its effects before submitting.');
  return legacy ? {kind:'edit',operation:result.operations[0]} : result;
}

export async function runBoardAssistant({ runtime, input, callModel, searchCatalog, signal, onTool, onEvent }) {
  if (input.board.book === 'defense' && input.mode === 'search') return {
    kind:'clarify', message: input.locale === 'en' ? 'The Madden catalog contains offense plays. Switch to an offense playbook to search.' : 'Madden 战术库目前为进攻战术，请切换到进攻战术本后搜索。',
    toolsUsed:[], modelCalls:0, repairs:0, submission:'none',
  };
  const { Annotation, StateGraph, START, END } = runtime;
  const limits = BOARD_AGENT_LIMITS, msg = providerMessages[input.locale];
  const tools = createBoardTools(input, searchCatalog), used = [];
  const conversation = [{role:'system',content:instructions}, {role:'user',content:JSON.stringify({instruction:input.instruction,locale:input.locale,selectedPlayerId:input.board.selectedPlayerId,mode:input.mode,previous:input.previous})}];
  let pending, result, submitted, submission = 'text', repairs = 0;
  const checked = () => { if (signal?.aborted) throw new Error(msg.timeout); };
  const emit = event => onEvent?.(event);
  const summary = output => JSON.stringify(output).slice(0,1800);
  const localized = detail => msg.operationErrors?.[detail] || (input.locale === 'en' ? detail || msg.invalid : msg.invalid);
  const state = Annotation.Root({next:Annotation(),modelCalls:Annotation(),repaired:Annotation()});
  const graph = new StateGraph(state)
    .addNode('model', async state => {
      checked();
      if (state.modelCalls >= limits.modelCalls || new TextEncoder().encode(JSON.stringify(conversation)).length > limits.transcriptBytes) throw new Error(msg.limit);
      const modelCalls = state.modelCalls + 1;
      const lookupAllowed = modelCalls < limits.modelCalls && used.length < limits.toolCalls - 1;
      emit({type:'model_step',count:modelCalls});
      pending = await callModel(conversation, [...(lookupAllowed ? tools.definitions : []),submitResultTool], lookupAllowed, {forceSubmit:!lookupAllowed});
      checked();
      submitted = null;
      const calls = pending.tool_calls || [];
      if (calls.length > limits.parallelCalls || used.length + calls.length > limits.toolCalls) throw new Error(msg.limit);
      if (!lookupAllowed && calls.some(call => call?.function?.name !== 'submit_result')) throw new Error(msg.limit);
      return {modelCalls,next:calls.length ? 'tools' : 'validate'};
    })
    .addNode('tools', async () => {
      const {textFallback, ...modelMessage} = pending;
      conversation.push(modelMessage);
      const ids = new Set();
      let previewFailed = false;
      if (pending.tool_calls.length > 1 && pending.tool_calls.some(call => call?.function?.name === 'submit_result')) {
        const error = 'Preview the proposal, inspect the returned effects, then call submit_result alone in a later message.';
        for (const call of pending.tool_calls) {
          if (typeof call?.id !== 'string' || !call.id || ids.has(call.id)) throw new Error(msg.invalid);
          ids.add(call.id); used.push(call.function?.name || 'unknown');
          conversation.push({role:'tool',tool_call_id:call.id,content:JSON.stringify({error})});
        }
        submitted = {protocolError:error,alreadyResponded:true};
        return {next:'validate'};
      }
      for (const call of pending.tool_calls) {
        checked();
        const fn = call?.function;
        if (call?.type !== 'function' || typeof call.id !== 'string' || !call.id || ids.has(call.id) || typeof fn?.name !== 'string' || typeof fn.arguments !== 'string' || fn.arguments.length > (['preview_edit','submit_result'].includes(fn.name) ? 24000 : 2000)) throw new Error(msg.invalid);
        ids.add(call.id); used.push(fn.name);
        let args;
        try { args = JSON.parse(fn.arguments); } catch { args = null; }
        onTool?.(fn.name,args);
        if (fn.name === 'submit_result') {
          if (pending.tool_calls.length !== 1) throw new Error('Submit the final result separately from read-only tools.');
          submitted = {callId:call.id,args}; submission = 'tool';
          emit({type:'tool',name:fn.name,args,summary:'Final result submitted for validation.'});
          return {next:'validate'};
        }
        const output = await tools.run(fn.name,args);
        emit({type:'tool',name:fn.name,args,summary:summary(output)});
        if (fn.name === 'preview_edit' && output.error) {
          emit({type:'validation_error',error:String(output.error).slice(0,700)});
          if (repairs >= 1) throw new Error(localized(output.error));
          repairs++; previewFailed = true;
        }
        conversation.push({role:'tool',tool_call_id:call.id,content:JSON.stringify(output)});
      }
      return {next:'model',...(previewFailed ? {repaired:true} : {})};
    })
    .addNode('validate', state => {
      const raw = pending.content;
      try {
        let value;
        if (submitted?.protocolError) throw new Error(submitted.protocolError);
        if (submitted) {
          value = parseBoardResult(submitted.args?.result);
          SubmitResultSchema.parse(submitted.args);
        }
        else {
          if (!pending.textFallback) throw new Error('Finish by calling submit_result rather than returning a text result.');
          if (typeof raw !== 'string' || raw.length > 32000) throw new Error(msg.invalid);
          value = JSON.parse(raw.replace(/^\s*```(?:json)?\s*/i,'').replace(/\s*```\s*$/,''));
        }
        result = validateBoardReply(value,input,tools,{requirePreview:true});
      } catch (error) {
        const detail = error instanceof Error ? error.message : '';
        emit({type:'validation_error',error:detail.slice(0,700)});
        if (state.repaired || state.modelCalls >= limits.modelCalls) throw new Error(localized(detail));
        repairs++;
        if (submitted && !submitted.alreadyResponded) conversation.push({role:'tool',tool_call_id:submitted.callId,content:JSON.stringify({error:detail})});
        else if (!submitted) conversation.push({role:'assistant',content:typeof raw === 'string' ? raw.slice(0,3000) : ''});
        conversation.push({role:'user',content:'The result was rejected: ' + detail.slice(0,700) + '. Recheck tools and preview the complete edit before resubmitting, or ask for clarification.'});
        return {next:'model',repaired:true};
      }
      emit({type:'result',kind:result.kind,summary:result.summary || result.message || (result.matches ? `${result.matches.length} catalog matches` : '')});
      return {next:END};
    })
    .addEdge(START,'model')
    .addConditionalEdges('model',s=>s.next,['tools','validate'])
    .addConditionalEdges('tools',s=>s.next,['model','validate'])
    .addConditionalEdges('validate',s=>s.next,['model',END]).compile();
  const finalState = await graph.invoke({next:'model',modelCalls:0,repaired:false},{recursionLimit:20,signal});
  checked();
  return {...result,toolsUsed:used,modelCalls:finalState.modelCalls,repairs,submission};
}
