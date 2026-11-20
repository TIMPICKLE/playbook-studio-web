import { createBoardTools } from './assistant-tools.js';
import { providerMessages } from './locales/assistant-provider.js';
import { proposeEdit } from './assistant-proposal.js';
import { parseBoardResult, SubmitResultSchema, submitResultTool } from './assistant-schema.js';
import { conversationContext } from './assistant-session.js';

// These bound individual payloads, not how much useful work a coach may request.
export const BOARD_AGENT_LIMITS = Object.freeze({ parallelCalls: 5, replyTokens: 1800, transcriptBytes: 120000 });
const repeatedRoundsBeforeFinish = 3;
const encoder = new TextEncoder();
const canonical = value => JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);
const instructions = `You are a football coaching assistant. Use read-only tools to inspect the current diagram and resolve real IDs. Do not guess missing or ambiguous players. Use resolve_players for explicit groups such as OL. Before answering about the current play, read_board and distinguish diagram facts from tactical suggestions. If read order is not recorded, say it is unknown.
Choose operations by intent: defense_formation for adding or resetting a supported defensive personnel alignment, route for a measured route-tree concept, block for ordered contacts or a blocking scheme, motion for pre-snap movement, move_player for alignment, pass for ball timing, zone for coverage, timing for an existing route, remove_route to remove an assignment, and annotate for coach notes. To add a 4-3 defense to an offensive diagram, read_board then preview_edit with {kind:"defense_formation",formation:"4-3",mode:"add"}; this creates the defensive players without actor IDs. No Madden catalog search or new empty board is needed. Use mode:"reset" only when the coach explicitly asks to replace or reset the existing defense. A 4-3 front does not imply a coverage; do not invent coverage assignments. Coordinates and geometry are the domain layer's responsibility. Prefer semantic route concepts with depth in yards. Inspect stored route intent when following up.
Before submitting any edit, call preview_edit with the entire operation group. Inspect the returned measured effects, breaks and target order. Correct a mismatch before submitting the same group through submit_result. An edit is a proposal until the coach accepts it.
Search Madden by concepts, tags or similarity, inspect catalog evidence, and explain recommendations briefly and conditionally. Use answer for grounded board questions, clarify for missing information, and handoff when the coach needs the separate offense-versus-defense analysis. Keep the original instruction and any named coverage or defense in handoff context.
This is one continuing conversation about a single play. previous lists its earlier turns, oldest first, each with a status: pending edits are staged in the working draft, are already part of the board you read and will be committed together with your next edit, so build on them and never repeat or undo them unless asked; applied or redone edits are committed; undone edits have been reverted and are absent unless later edits recreated them; stale edits need a fresh preview and are not on the board; discarded edits were rejected by the coach and are not on the board; failed turns ended in an error and the next message usually completes them. staged counts the pending turns. focus names the players and routes of the most recent turn that had a subject. When the instruction omits its subject or refers back ("it", "that route", "deeper", "change it to a post", "再深两码", "改成向内"), apply it to focus, otherwise to selectedPlayerId; read_board shows their current routes and stored intent. Ask with clarify only when there is no such subject or several unrelated subjects fit equally, and name the candidates. A current multi-selection is explicit group context, not permission to pick its first player. For a singular ambiguous request such as "move him" with several selected players, return clarify and name the candidates. An explicit request to move the group targets the whole selection. Players listed in focus or selected are already confirmed on this board; resolve any other player through tools. Use submit_result to finish in the user's language. Only if the provider requires text fallback, return an object conforming to that tool's result schema as plain JSON.`;
const editorInstructions = `You are also a full editor command interface. Discover list_capabilities and get_command_schema rather than claiming an editor feature is unavailable. read_board exposes diagram objects; read_editor exposes the real workspace, roster, formations, personnel groups and device state. Use preview_edit for play commands including object creation/update/removal, complete route editing, ball, metadata, mirror, formation, opponents, spacing and personnel. New player_add/route_add/zone_add/annotation_add may declare an as alias; subsequent operations can reference it as $alias. Never invent persisted IDs. Use preview_actions then submit_result kind editor with the identical actions for workspace CRUD, saving formations, catalog imports, selection, tools, draft, history, playback, view, layout, filters, panels, navigation, export, print and file interactions. Keep workspace, local and interaction lanes separate. Tools prepare proposals only; the host applies writes and executes device actions. A file picker or print dialog is awaiting_user, not a completed import or print. Respect capability availability and explain actual device/reference/read-only constraints. The knowledge base provides coaching evidence; executable abilities come from the command registry, not Madden search.`;

const filmInstructions = `For coaching film, inspect read_film for the timeline source, available events, player IDs, film controls and lesson. When source is staged, its events describe the pending preview. Before live playback the coach must apply or discard it; relay the notice and preserve that choice. For committed plays, use control_film for requested device actions. It performs the action and returns the actual state. To show the release and compare two players, use the release event from read_film, focus their two actual IDs, then explain the returned comparison. Several calls may be needed in one request. Use stable IDs for duplicates and ask which player if ambiguous. Depth is the designed downfield distance from the line of scrimmage; report yards only when calibrated. Read or reveal hidden answers and explicitly save a local lesson only when asked. Recheck a moving scene for current-time questions. Respect device and trial restrictions and explain real errors or missing events. Submit a grounded answer based on receipts. Never simulate film control via workspace edits or deferred dialog proposals.`;

export function validateBoardReply(value, input, tools, {requirePreview = false} = {}) {
  const msg = providerMessages[input.locale];
  const invalid = reason => { throw new Error(reason || msg.invalid); };
  const legacy = value?.kind === 'edit' && !value.operations && value.operation;
  const result = parseBoardResult(value);
  if (result.kind === 'clarify') return result;
  if (result.kind === 'editor') {
    if (!tools.didReadEditor() || (requirePreview && !tools.getActionPreview(result.actions))) invalid('Call read_editor and preview_actions with this complete action group before submitting.');
    return result;
  }
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
    if ((!tools.didReadBoard() && !tools.didObserveFilm()) || !(result.highlights || []).every(id => tools.resolved.has(id) || tools.routeIds.has(id))) invalid();
    return {...result, highlights:result.highlights || []};
  }
  if (result.kind === 'handoff') {
    if (result.playId !== input.board.playId) invalid();
    return {...result, context:{...result.context, instruction:result.context?.instruction || input.instruction}};
  }
  tools.assertReferences(result.operations);
  proposeEdit(input.board.play || input.board, result.operations, {locale:input.locale,roster:input.editor?.data?.roster,formations:input.editor?.data?.formations,depthChart:input.editor?.data?.depthChart});
  if (requirePreview && !tools.getPreview(result.operations)) invalid('Call preview_edit with this complete operation group and inspect its effects before submitting.');
  return legacy ? {kind:'edit',operation:result.operations[0]} : result;
}

export async function runBoardAssistant({ runtime, input, callModel, searchCatalog, film, signal, onTool, onEvent }) {
  const { Annotation, StateGraph, START, END } = runtime;
  const limits = BOARD_AGENT_LIMITS, msg = providerMessages[input.locale];
  const thread = conversationContext(input);
  const tools = createBoardTools(input, searchCatalog, film), used = [];
  const flagInstructions = input.board.gameFormat === 'flag5' ? '\nThe current play explicitly uses 5v5 flag football. Read its format and formation capabilities. The center may receive after the snap; do not assume an offensive blocking line, contact blocking, tackling or kicking. To add a flag defense to a five-player offensive diagram, preview_edit with {kind:"opponents_set",enabled:true,count:5}; use formation_apply for the current side with its named Flag 5 template. Do not use the eleven-player defense_formation operation to satisfy a flag-defense request; it remains available only for an explicit 4-3/tackle comparison. Madden catalog plays remain their original eleven-player diagrams, not ready-made flag plays. Rushing distance/eligibility, QB running and regulation field dimensions depend on the competition and are unconfirmed. Route yardages use the existing diagram grid; do not claim that this is a regulation flag field.' : '';
  const conversation = [{role:'system',content:instructions + '\n' + editorInstructions + (film ? '\n' + filmInstructions : '') + flagInstructions + '\nThe selected mode is a preference, not a restriction. Use any available capability needed by the current instruction. Madden contains offensive plays even when the current diagram is defensive.'}, {role:'user',content:JSON.stringify({instruction:input.instruction,locale:input.locale,selectedPlayerId:input.board.selectedPlayerId,selectedPlayerIds:input.board.selectedPlayerIds,playersPerSide:input.board.playersPerSide,gameFormat:input.board.gameFormat,mode:input.mode,previous:input.previous,...(thread.focus ? {focus:thread.focus} : {}),...(thread.staged ? {staged:thread.staged} : {})})}];
  let pending, result, submitted, submission = 'text', repairs = 0, repeatedRounds = 0;
  let lastFilmScene = null;
  const facts = new Map(), progressFacts = new Set();
  const checked = () => { if (signal?.aborted) throw signal.reason || new DOMException('The assistant request was cancelled.', 'AbortError'); };
  const emit = event => onEvent?.(event);
  const summary = output => JSON.stringify(output).slice(0,1800);
  const localized = detail => msg.operationErrors?.[detail] || (input.locale === 'en' ? detail || msg.invalid : msg.invalid);
  const recordProgress = (name, output) => {
    let evidence = [];
    if (name === 'read_board') evidence = [{type:'board',value:output}];
    if (name === 'read_editor') evidence = [{type:'editor',value:output}];
    if (name === 'list_capabilities') evidence = (output.capabilities || []).map(value => ({type:'capability',value}));
    if (name === 'get_command_schema') evidence = [{type:'command_schema',value:output}];
    if (name === 'resolve_player' || name === 'resolve_players') {
      const results = name === 'resolve_player' ? [output] : output.results || [];
      evidence = results.filter(item => ['found','ambiguous'].includes(item.status)).flatMap(item =>
        (item.candidates || []).map(value => ({type:item.status === 'found' ? 'resolved_player' : 'player_candidate',value})));
    }
    if (name === 'search_madden') evidence = (output.candidates || []).map(value => ({type:'catalog_candidate',value}));
    if (['preview_edit','preview_actions','read_film','control_film'].includes(name)) evidence = [{type:name,value:output}];
    let progressed = false;
    if (name === 'control_film' || name === 'read_film') {
      const scene = canonical(output);
      // Repeatedly alternating two requested frames still changes the actual device.
      progressed = name === 'control_film' && scene !== lastFilmScene;
      lastFilmScene = scene;
    }
    for (const fact of evidence) {
      const key = canonical(fact);
      if (!progressFacts.has(key)) progressed = true;
      progressFacts.add(key);
    }
    return progressed;
  };
  const compactHistory = () => {
    if (encoder.encode(JSON.stringify(conversation)).length <= limits.transcriptBytes) return;
    // Keep complete tool-call/result pairs in the latest exchange. Older calls
    // become exact, deduplicated observations, so IDs and measured previews are
    // still available to the model and to the tool registry's validator.
    let latest = conversation.length - 1;
    while (latest > 2 && conversation[latest].role !== 'assistant') latest--;
    if (conversation[latest]?.role !== 'assistant') latest = conversation.length;
    const recent = conversation.slice(latest);
    const recentKeys = new Set(), callsById = new Map();
    for (const message of recent) {
      for (const call of message.tool_calls || []) callsById.set(call.id,call.function);
      const fn = callsById.get(message.tool_call_id);
      if (message.role === 'tool' && fn) {
        try { recentKeys.add(canonical({tool:fn.name,args:JSON.parse(fn.arguments),result:JSON.parse(message.content)})); }
        catch { /* Malformed protocol messages are handled by the repair path. */ }
      }
    }
    const earlier = [...facts].filter(([key]) => !recentKeys.has(key)).map(([,fact]) => fact);
    const heading = tools.didObserveFilm() ? 'Earlier tool evidence (including executed device receipts): ' : 'Earlier read-only tool evidence (exact deduplicated observations, not accepted edits): ';
    const memory = earlier.length ? [{role:'user',content:heading + JSON.stringify(earlier)}] : [];
    conversation.splice(2,conversation.length - 2,...memory,...recent);
    emit({type:'context_compacted',facts:earlier.length});
    // This is a compaction target, not a request quota. Essential evidence may
    // itself exceed it; never discard references or reject productive work here.
  };
  const state = Annotation.Root({next:Annotation(),modelCalls:Annotation(),repaired:Annotation()});
  const graph = new StateGraph(state)
    .addNode('model', async state => {
      checked();
      const lookupAllowed = repeatedRounds < repeatedRoundsBeforeFinish;
      if (!lookupAllowed) conversation.push({role:'user',content:'Recent tool calls repeated existing results without new evidence. Use the evidence already available and call submit_result now with a grounded result, or clarify what could not be completed. Do not repeat those lookups.'});
      compactHistory();
      const modelCalls = state.modelCalls + 1;
      emit({type:'model_step',count:modelCalls});
      pending = await callModel(conversation, [...(lookupAllowed ? tools.definitions : []),submitResultTool], lookupAllowed, {forceSubmit:!lookupAllowed});
      checked();
      submitted = null;
      const calls = pending.tool_calls || [];
      if (calls.length > limits.parallelCalls) throw new Error(msg.invalid);
      if (!lookupAllowed && calls.some(call => call?.function?.name !== 'submit_result')) {
        result = {kind:'clarify',message:msg.noProgress};
        submission = 'none';
        emit({type:'result',kind:result.kind,summary:result.message});
        return {modelCalls,next:END};
      }
      return {modelCalls,next:calls.length ? 'tools' : 'validate'};
    })
    .addNode('tools', async () => {
      const {textFallback, ...modelMessage} = pending;
      conversation.push(modelMessage);
      const ids = new Set();
      let previewFailed = false, progressed = false;
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
        if (call?.type !== 'function' || typeof call.id !== 'string' || !call.id || ids.has(call.id) || typeof fn?.name !== 'string' || typeof fn.arguments !== 'string' || fn.arguments.length > (['preview_edit','preview_actions','submit_result'].includes(fn.name) ? 24000 : 2000)) throw new Error(msg.invalid);
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
        if (!output.error) {
          const key = canonical({tool:fn.name,args,result:output});
          facts.set(key,{tool:fn.name,args,result:output});
          if (recordProgress(fn.name,output)) progressed = true;
        }
        emit({type:'tool',name:fn.name,args,summary:summary(output)});
        // Persistence and version conflicts require the coach's choice. Stop here so
        // neither another device action nor a model-written success can supersede it.
        const filmCommand = fn.name === 'control_film' ? args?.command : null;
        const persistence = filmCommand?.operation === 'lesson' && ['save','load'].includes(filmCommand.action);
        if (output.error && (persistence || ['FILM_PREVIEW_PENDING','FILM_BOARD_CHANGED'].includes(output.code))) {
          result = {kind:'error',status:'failed',code:output.code || 'FILM_STORAGE_FAILED',message:output.error,receipt:output};
          submission = 'device';
          emit({type:'result',kind:result.kind,summary:result.message});
          return {next:END};
        }
        if (['preview_edit','preview_actions'].includes(fn.name) && output.error) {
          emit({type:'validation_error',error:String(output.error).slice(0,700)});
          if (repairs >= 1) throw new Error(localized(output.error));
          repairs++; previewFailed = true;
        }
        conversation.push({role:'tool',tool_call_id:call.id,content:JSON.stringify(output)});
      }
      repeatedRounds = progressed ? 0 : repeatedRounds + 1;
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
        if (state.repaired) throw new Error(localized(detail));
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
    .addConditionalEdges('model',s=>s.next,['tools','validate',END])
    .addConditionalEdges('tools',s=>s.next,['model','validate',END])
    .addConditionalEdges('validate',s=>s.next,['model',END]).compile();
  // Progress, cancellation and the provider's timeout terminate the run. A
  // fixed graph-step ceiling would silently reintroduce the old usage quota.
  const finalState = await graph.invoke({next:'model',modelCalls:0,repaired:false},{recursionLimit:Number.MAX_SAFE_INTEGER,signal});
  checked();
  return {...result,...(result.kind === 'clarify' && thread.selection.length > 1 ? {candidates:thread.selection} : {}),toolsUsed:used,modelCalls:finalState.modelCalls,repairs,submission};
}
