import { getLocale } from './i18n.js';
import { escapeHTML as e } from './model.js';
import en from './locales/board-assistant.en.js';
import zh from './locales/board-assistant.zh-CN.js';
import { MODEL_PROVIDER_PRESETS, PROTOCOL_OPTIONS } from './model-protocol.js';
import { getModelConnection, setModelConnection, subscribeModelConnection } from './model-connection.js';
import { createConversation, conversationRecords, TURN_STATUS } from './assistant-session.js';

const symbols = {
  spark: '<path d="m11 2 2.1 6.6L20 11l-6.9 2.3L11 20l-2.2-6.7L2 11l6.8-2.4zM19 2v4m-2-2h4"/>',
  settings: '<path d="M3 7h6m4 0h8M3 17h11m4 0h3"/><circle cx="11" cy="7" r="2"/><circle cx="16" cy="17" r="2"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>', send: '<path d="M12 19V5m-6 6 6-6 6 6"/>',
  mic: '<rect x="9" y="3" width="6" height="12" rx="3"/><path d="M5 11a7 7 0 0 0 14 0m-7 7v3m-3 0h6"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="2"/>'
};
const glyph = name => '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + symbols[name] + '</svg>';
const copy = () => getLocale() === 'en' ? en : zh;

export function createBoardAssistant({host, getContext, onRequest, onAdd, onHighlight, onHandoff, onPanelChange, onSelectTarget}) {
  const doc = host.ownerDocument, win = doc.defaultView;
  const root = doc.createElement('div');
  root.className = 'board-ai';
  root.innerHTML = `<button type="button" class="ba-fab" data-ba="open" aria-expanded="false" aria-controls="board-ai-panel">${glyph('spark')}<b>AI</b></button>
    <section class="ba-panel" id="board-ai-panel" role="dialog" aria-modal="false" aria-labelledby="board-ai-heading" hidden>
      <nav class="ba-mode-switch" aria-label="AI"><button type="button" class="ba-pill" data-ba="properties" data-text="properties"></button><button type="button" class="ba-pill" aria-pressed="true" data-text="assistantTab"></button></nav><header class="ba-header"><button type="button" class="ba-expand ba-pill" data-ba="expand" data-text="expand"></button><div class="ba-heading" data-ba-drag>${glyph('spark')}<div><h2 id="board-ai-heading" data-text="title"></h2><small class="ba-scope"></small></div></div>
        <button type="button" class="ba-pill" data-ba="float" data-text="float"></button><button type="button" class="ba-icon" data-ba="settings">${glyph('settings')}</button><button type="button" class="ba-icon" data-ba="close">${glyph('close')}</button></header>
      <div class="ba-content"><div class="ba-config" hidden><label><span data-text="provider"></span><select data-ba-provider>${Object.entries(MODEL_PROVIDER_PRESETS).map(([id,preset])=>`<option value="${e(id)}">${e(preset.label)}</option>`).join('')}</select></label>
        <label><span data-text="protocol"></span><select data-ba-protocol></select></label>
        <label data-ba-custom hidden><span>API Base URL</span><input data-ba-base-url type="url" maxlength="400" autocomplete="off" spellcheck="false" placeholder="https://api.example.com/v1"><small data-ba-url-hint></small></label>
        <label><span data-text="model"></span><input data-ba-model value="gpt-6.1-terra" maxlength="160" autocomplete="off" spellcheck="false"><small class="ba-model-hint" data-text="modelHint"></small></label>
        <label><span data-text="key"></span><input data-ba-key type="password" autocomplete="off" maxlength="512" spellcheck="false"></label><small data-text="keyHint"></small>
        <button type="button" class="ba-pill" data-ba="done" data-text="done"></button></div>
        <details class="ba-history" open hidden><summary data-ba-history-title></summary><ol class="ba-history-list"></ol></details><div class="ba-run-state" role="status" aria-live="polite" hidden></div><div class="ba-output" hidden></div><div class="ba-welcome"><strong data-ba-guide></strong><div class="ba-ready-banner" data-ba-ready><span class="ba-ready-status"><i aria-hidden="true"></i><span data-ba-ready-text></span></span><button type="button" class="ba-ready-action" data-ba="settings" data-ba-ready-btn></button></div><ul class="ba-safety-strip" aria-label="AI safety"><li data-text="safetyPreview"></li><li data-text="safetyIterate"></li><li data-text="safetyUndo"></li></ul><div class="ba-examples">
        <button class="ba-pill" type="button" data-ba="edit" data-text="edit"></button>
        <button class="ba-pill" type="button" data-ba="route-edit" data-text="routeEdit"></button>
        <button class="ba-pill" type="button" data-ba="search" data-text="search"></button></div></div>
        <details class="ba-trace" hidden><summary data-ba-trace-title></summary><ol class="ba-trace-list"></ol></details></div>
      <footer class="ba-footer"><button type="button" class="ba-mode ba-pill" data-ba="clear-mode" hidden></button><div class="ba-status" role="status" aria-live="polite"></div>
        <div class="ba-compose"><textarea rows="2" maxlength="1600" data-ba-prompt></textarea><input type="password" class="ba-covered-prompt" maxlength="1600" autocomplete="off" spellcheck="false" hidden>
        <div class="ba-controls"><button type="button" class="ba-icon" data-ba="mic">${glyph('mic')}</button>
        <button type="button" class="ba-icon ba-send" data-ba="send">${glyph('send')}</button></div></div></footer></section>`;
  const q = selector => root.querySelector(selector);
  const button = name => q('[data-ba="' + name + '"]');
  const panel = q('.ba-panel'), output = q('.ba-output'), config = q('.ba-config');
  const ordinaryPrompt = q('[data-ba-prompt]'), coveredPrompt = q('.ba-covered-prompt');
  let prompt = ordinaryPrompt, sharedLesson = false, coveredDraft = '';
  const status = q('.ba-status'), key = q('[data-ba-key]'), model = q('[data-ba-model]'), provider = q('[data-ba-provider]');
  const protocol = q('[data-ba-protocol]'), baseUrl = q('[data-ba-base-url]');
  provider.value = 'openai';
  function syncModelOptions(reset = false) {
    const preset = MODEL_PROVIDER_PRESETS[provider.value];
    const selected = !reset && preset.protocols.includes(protocol.value) ? protocol.value : preset.defaultProtocol;
    protocol.innerHTML = preset.protocols.map(value=>`<option value="${e(value)}">${e(PROTOCOL_OPTIONS[value])}</option>`).join('');
    protocol.value = selected;
    q('[data-ba-custom]').hidden = provider.value !== 'custom';
    q('[data-ba-url-hint]').textContent = getContext().serverProxy ? copy().customCloudHint : copy().customBrowserHint;
    const custom = provider.querySelector('option[value="custom"]');
    if (custom) custom.textContent = copy().customProvider;
  }
  syncModelOptions();
  function readConnection() { return {provider:provider.value,protocol:protocol.value,model:model.value.trim(),baseUrl:baseUrl.value.trim(),apiKey:key.value.trim()}; }
  function loadConnection(connection) {
    if (!connection || pending || !MODEL_PROVIDER_PRESETS[connection.provider]) return;
    provider.value = connection.provider; protocol.value = connection.protocol;
    model.value = typeof connection.model === 'string' ? connection.model : MODEL_PROVIDER_PRESETS[connection.provider].defaultModel; baseUrl.value = connection.baseUrl || ''; key.value = connection.apiKey || '';
    syncModelOptions();
  }
  // Initialized after state declarations below; subscriptions never write back.
  const Speech = win.SpeechRecognition || win.webkitSpeechRecognition;
  let scope, locale, pending, recognition, reply, applying, continuing, clarification = '', selectedMode = 'auto', destroyed = false;
  let trace = [], runNumber = 0;
  // `reply` is the latest answer on screen. `staged` is the uncommitted preview
  // handle of this conversation; it outlives later answers, errors and turns
  // until the coach applies or discards it. `stagedTurns` are its thread records.
  let thread = createConversation();
  const sessions = new Map();
  let targetCandidates = [];
  let runState = 'idle', activeInstruction = '', lastError = null, lastAppliedTurns = [], floatingRequested = false;
  let staged = null, stagedTurns = [], selectedGroups = new Set(), groupError = '';
  loadConnection(getModelConnection());
  const serverReady = () => !!getContext().serverConfigured;
  function updateReadyBanner() {
    const banner = q('[data-ba-ready]'), text = q('[data-ba-ready-text]'), action = q('[data-ba-ready-btn]');
    if (!banner || !text || !action) return;
    const lang = copy(), hasKey = !!key.value.trim(), modelId = model.value.trim(), server = serverReady();
    const ready = server || (hasKey && !!modelId);
    banner.dataset.state = ready ? 'ready' : 'setup';
    if (hasKey && modelId) {
      const providerLabel = provider.value === 'custom' ? lang.customProvider : (MODEL_PROVIDER_PRESETS[provider.value]?.label || provider.value);
      text.textContent = `${lang.readyConfigured} · ${providerLabel} · ${modelId}`;
    } else if (server) {
      text.textContent = lang.readyServer;
    } else {
      text.textContent = lang.readyUnconfigured;
    }
    action.textContent = ready ? lang.editConfigAction : lang.configureAction;
  }
  const unsubscribeConnection = subscribeModelConnection(connection => { loadConnection(connection); updateReadyBanner(); });
  const turnsOf = handle => Array.isArray(handle.turns) && handle.turns.length ? handle.turns : [handle];
  const describe = (turn, fallback) => ({summary:turn.summary || turn.message || fallback?.message || '', operations:turn.operations || fallback?.operations || [],
    routeIds:turn.routeIds || [], zoneIds:turn.zoneIds || [], playerIds:turn.playerIds || []});
  function stage(handle, instruction) {
    const turns = turnsOf(handle);
    for (const dropped of stagedTurns.slice(turns.length)) thread.settle(dropped, TURN_STATUS.discarded);
    stagedTurns = turns.map((turn, index) => stagedTurns[index]
      ? thread.settle(stagedTurns[index], TURN_STATUS.pending, describe(turn))
      : thread.add({instruction:turn.instruction || instruction || '', kind:'edit', status:TURN_STATUS.pending, ...describe(turn)}));
    if (staged && reply === staged) reply = handle;
    staged = handle; selectedGroups = new Set(turns.map((_,index)=>index)); groupError = '';
  }
  function settleStaged(status, result) {
    const turns = result ? turnsOf(result) : [];
    stagedTurns.forEach((record, index) => thread.settle(record, status, {...(turns[index] ? describe(turns[index], staged) : {}), ...(result?.transactionId ? {transactionId:result.transactionId} : {})}));
    stagedTurns = [];
  }
  function discardStaged(keepRecord = true, status = TURN_STATUS.discarded) {
    if (!staged) return;
    if (keepRecord) settleStaged(status); else stagedTurns = [];
    const handle = staged;
    staged = null;
    if (reply === handle) reply = null;
    handle.discard?.();
  }
  function safeTraceValue(value, depth = 0) {
    if (depth > 5) return '…';
    if (typeof value === 'string') {
      const credential = key.value.trim();
      return (credential ? value.split(credential).join('[redacted]') : value).slice(0, 2400);
    }
    if (Array.isArray(value)) return value.slice(0, 32).map(item => safeTraceValue(item, depth + 1));
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).slice(0, 40)
      .filter(([name]) => !/api.?key|authorization|password|secret|token|reasoning|thinking/i.test(name))
      .map(([name, item]) => [name, safeTraceValue(item, depth + 1)]));
    return ['number','boolean'].includes(typeof value) || value === null ? value : undefined;
  }
  function traceView() {
    const details = q('.ba-trace'), list = q('.ba-trace-list'), lang = copy();
    details.hidden = sharedLesson || !trace.length || !config.hidden;
    q('[data-ba-trace-title]').textContent = `${lang.viewProcess} · ${trace.length}`;
    list.replaceChildren();
    if (sharedLesson) return;
    for (const entry of trace) {
      const item = doc.createElement('li'), title = doc.createElement('strong');
      const label = entry.type === 'tool' ? lang.traceTool : entry.type === 'validation_error' ? lang.traceValidation : lang.traceResult;
      title.textContent = `${entry.run} · ${label}${entry.name ? ' · ' + entry.name : entry.kind ? ' · ' + entry.kind : ''}`;
      item.append(title);
      if (entry.args !== undefined) { const params = doc.createElement('pre'); params.textContent = JSON.stringify(entry.args, null, 2).slice(0, 6000); item.append(params); }
      if (entry.summary || entry.error) { const text = doc.createElement('p'); text.textContent = entry.error || entry.summary; item.append(text); }
      if (entry.type === 'validation_error') item.classList.add('ba-trace-error');
      list.append(item);
    }
  }
  function recordEvent(event) {
    if (!event || !['tool','validation_error','result'].includes(event.type)) return;
    const entry = {type:event.type, run:runNumber};
    if (typeof event.name === 'string') entry.name = safeTraceValue(event.name);
    if (event.type === 'tool' && event.args !== undefined) entry.args = safeTraceValue(event.args);
    if (typeof event.kind === 'string') entry.kind = safeTraceValue(event.kind);
    if (typeof event.summary === 'string') entry.summary = safeTraceValue(event.summary);
    if (typeof event.error === 'string') entry.error = safeTraceValue(event.error);
    if (event.type === 'tool' && ['resolve_player','resolve_players'].includes(event.name) && typeof event.summary === 'string') {
      try {
        const result = JSON.parse(event.summary), groups = event.name === 'resolve_players' ? result.results || [] : [result];
        targetCandidates = groups.filter(group => group.status === 'ambiguous').flatMap(group => group.candidates || [])
          .filter(candidate => typeof candidate.id === 'string' && typeof candidate.label === 'string').slice(0,22);
      } catch { /* A diagnostic summary may be truncated; never guess candidates. */ }
    }
    trace = [...trace, entry].filter(item => item.run > runNumber - 5).slice(-100);
    traceView();
  }

  function announce(message = '', error = false, spokenOnly = false, code) {
    if (sharedLesson && message) {
      const lang = copy();
      const safe = [lang.configure, lang.customUrlRequired, lang.listening, lang.micError, lang.micDenied];
      if (!safe.includes(message)) message = code === 'LESSON_CONFLICT' ? lang.lessonConflict : error ? lang.runStates.failed : '';
    }
    status.textContent = message;
    status.classList.toggle('ba-error', error);
    status.classList.toggle('ba-spoken-only', spokenOnly);
  }
  function label(element, value) {
    element.title = value;
    element.setAttribute('aria-label', value);
  }
  function updateButtons() {
    const lang = copy(), running = !!pending;
    const mode = button('clear-mode'); mode.hidden = selectedMode === 'auto';
    mode.textContent = selectedMode === 'auto' ? '' : lang[selectedMode] + ' ×';
    mode.setAttribute('aria-label', lang.clearMode);
    label(button('send'), running ? lang.cancel : lang.send);
    button('send').innerHTML = glyph(running ? 'stop' : 'send');
    button('send').disabled = !!continuing || !!applying || (!running && (!prompt.value.trim() || !!recognition));
    button('mic').disabled = running || !Speech;
    button('mic').setAttribute('aria-pressed', String(!!recognition));
    label(button('mic'), Speech ? (recognition ? lang.micStop : lang.mic) : lang.micUnavailable);
    button('settings').disabled = running;
    button('settings').setAttribute('aria-expanded', String(!config.hidden));
    const readyBtn = q('[data-ba-ready-btn]');
    if (readyBtn) readyBtn.disabled = running;
    prompt.readOnly = running || !!applying || !!continuing;
  }
  function pill(action, text, disabled = false) {
    const control = doc.createElement('button');
    control.type = 'button'; control.className = 'ba-pill'; control.dataset.ba = action;
    control.textContent = text; control.disabled = disabled;
    return control;
  }
  function stagedView(lang) {
    const visible = staged.isVisible?.() !== false, busy = !!pending || applying === staged;
    const groups = turnsOf(staged), selectable = typeof staged.selectTurns === 'function' && groups.length > 1;
    const selectionChanged = selectable && selectedGroups.size !== groups.length;
    const message = doc.createElement('p');
    if (reply === staged) message.textContent = staged.message || lang.change;
    else { message.className = 'ba-staged-title'; message.textContent = `${lang.pendingTitle} · ${stagedTurns.length}`; }
    output.append(message);
    if (Array.isArray(staged.changes)) { const list = doc.createElement('ul'); for (const change of staged.changes) { const li = doc.createElement('li'); li.textContent = String(change); list.append(li); } output.append(list); }
    if (selectable) {
      const fieldset = doc.createElement('fieldset'); fieldset.className = 'ba-proposal-groups';
      const legend = doc.createElement('legend'); legend.textContent = lang.chooseGroups; fieldset.append(legend);
      groups.forEach((turn,index) => {
        const label = doc.createElement('label'), check = doc.createElement('input'), text = doc.createElement('span');
        check.type = 'checkbox'; check.dataset.baGroup = String(index); check.checked = selectedGroups.has(index); check.disabled = busy;
        text.textContent = `${index+1}. ${turn.summary || turn.instruction || lang.change}`;
        label.append(check,text); fieldset.append(label);
      });
      const actions = doc.createElement('div'); actions.className = 'ba-group-actions';
      actions.append(pill('update-groups',lang.updateGroups,busy || !selectionChanged || !selectedGroups.size));
      const hint = doc.createElement('small'); hint.textContent = lang.groupHint; actions.append(hint); fieldset.append(actions);
      const error = doc.createElement('p'); error.className = 'ba-group-error'; error.setAttribute('role','alert');
      error.textContent = !selectedGroups.size ? lang.groupRequired : groupError; error.hidden = !error.textContent;
      fieldset.append(error); output.append(fieldset);
    }
    output.append(pill('apply', visible ? lang.apply : lang.repreview, busy || selectionChanged), pill('discard', lang.discard, busy));
    if (staged.revert) output.append(pill('revert', lang.revert, busy || selectionChanged));
    if (visible && staged.rehearse) output.append(pill('rehearse', lang.rehearse));
  }
  function historyView() {
    const lang = copy(), records = thread.records(), history = q('.ba-history'), list = q('.ba-history-list');
    history.hidden = sharedLesson || !records.length || !config.hidden;
    q('[data-ba-history-title]').textContent = `${lang.conversation} · ${records.length}`;
    list.replaceChildren();
    if (!sharedLesson) records.forEach((record, index) => {
      const item = doc.createElement('li'); item.className = 'ba-turn';
      const heading = doc.createElement('div'); heading.className = 'ba-turn-heading';
      const state = doc.createElement('span'); state.className = 'ba-turn-status'; state.dataset.status = record.status || 'answered';
      state.textContent = lang.turnStates[record.status || (record.kind === 'clarify' ? 'clarify' : 'answered')] || lang.turnStates.answered;
      heading.append(state); item.append(heading);
      if (record.instruction) { const user = doc.createElement('p'); user.className = 'ba-turn-user'; user.textContent = record.instruction; item.append(user); }
      const message = record.summary || record.message;
      if (message) { const answer = doc.createElement('p'); answer.className = 'ba-turn-answer'; answer.textContent = message; item.append(answer); }
      if (record.status === TURN_STATUS.stale && record.instruction) { const action = pill('repreview-turn', lang.resumePreview, !!pending || !!staged || !!applying); action.dataset.turnIndex = String(index); item.append(action); }
      list.append(item);
    });
    const running = q('.ba-run-state');
    running.dataset.state = runState;
    running.hidden = !config.hidden || runState === 'idle';
    running.textContent = lang.runStates[runState] || lang.loading;
  }
  function outputView() {
    const content = q('.ba-content'), scrollTop = content.scrollTop;
    const followLatest = content.scrollHeight - content.clientHeight - scrollTop < 48;
    const lang = copy();
    traceView(); historyView();
    output.replaceChildren();
    if (sharedLesson) {
      output.hidden = !config.hidden;
      q('.ba-welcome').hidden = true;
      if (config.hidden) {
        const hint = doc.createElement('p'); hint.textContent = lang.sharedLesson;
        output.append(hint);
        if (lastError && !pending) output.append(pill('retry', lang.retry, !!applying));
        if (staged) output.append(pill('discard', lang.discard, !!pending || !!applying));
      }
      return;
    }
    output.hidden = (!reply && !staged) || !config.hidden;
    q('.ba-welcome').hidden = !!reply || !!staged || !config.hidden;
    if (reply?.kind === 'search') {
      const items = reply.items || [];
      output.innerHTML = '<p class="ba-results-title">' + (items.length ? lang.matches + ' · ' + items.length : lang.empty) + '</p>';
      for (const [i, item] of items.entries()) {
        const card = doc.createElement('article');
        card.className = 'ba-card';
        const image = /^\.?\/?data\/huddle-art\/[\w.-]+$/.test(item.image || '') ? '<img loading="lazy" draggable="false" src="' + e(item.image) + '" alt="">' : '';
        const details = [item.team, item.formation, item.editable ? lang.editable : lang.reference].filter(Boolean).join(' · ');
        card.innerHTML = `<div class="ba-card-top">${image}<div><small>${e(details)}</small><strong>${e(item.title)}</strong></div><button class="ba-pill" type="button" data-ba="add" data-index="${i}" ${item.added || getContext().readOnly ? 'disabled' : ''}>${item.added ? lang.added : lang.add}</button></div>
        <p><small class="ba-why">${e(lang.reason)}</small> ${e(item.reason || '')}</p>`;
        output.append(card);
      }
    } else if (reply && reply !== staged) {
      const message = doc.createElement('p');
      message.textContent = reply.message || lang.change;
      output.append(message);
      if (reply.action?.run) output.append(pill('continue', reply.action.label));
      if (reply.kind === 'handoff' && onHandoff) output.append(pill('handoff', lang.handoff));
      if (reply.undo) output.append(pill('undo', lang.undo));
      if (reply.kind === 'clarify' && targetCandidates.length) {
        const candidates = doc.createElement('div'); candidates.className = 'ba-candidates';
        targetCandidates.forEach((candidate, index) => {
          const fieldPosition = Number.isFinite(candidate.x) ? candidate.x < 44 ? lang.fieldLeft : candidate.x > 56 ? lang.fieldRight : lang.fieldMiddle : '';
          const label = [String(index+1) + '. ' + candidate.label,candidate.name,candidate.number ? '#' + candidate.number : '',fieldPosition,candidate.side === 'defense' ? lang.defense : candidate.side === 'offense' ? lang.offense : ''].filter(Boolean).join(' · ');
          const choose = pill('choose-target', label); choose.dataset.targetIndex = String(index); choose.addEventListener('pointerenter',()=>onHighlight?.([candidate.id])); choose.addEventListener('focus',()=>onHighlight?.([candidate.id])); candidates.append(choose);
        });
        output.append(candidates);
      }
    }
    if (staged) stagedView(lang);
    if (lastError && !pending) {
      output.hidden = !config.hidden;
      const recovery = doc.createElement('div'); recovery.className = 'ba-recovery';
      const message = doc.createElement('p'); message.textContent = lastError.message;
      recovery.append(message, pill('retry', lang.retry, !!applying), pill('settings', lang.settings));
      output.append(recovery);
    }
    // Rebuilding the last reply must not jump a coach back to the oldest turn.
    content.scrollTop = followLatest ? content.scrollHeight : scrollTop;
  }
  function stopSpeech() {
    const instance = recognition;
    recognition = null;
    if (instance) {
      instance.onresult = instance.onerror = instance.onend = null;
      instance.abort();
    }
  }
  function cancel({record = true} = {}) {
    if (pending) {
      pending.abort(); pending = null;
      if (record && activeInstruction) thread.add({instruction:activeInstruction,kind:'error',status:TURN_STATUS.canceled,message:copy().canceled});
      runState = 'canceled';
    }
    activeInstruction = ''; stopSpeech(); updateButtons(); announce(); outputView();
  }
  function reset() {
    cancel({record:false}); continuing = null; discardStaged(false); clarification = ''; selectedMode = 'auto'; reply = null; thread.clear(); sessions.clear(); trace = []; runNumber = 0; runState = 'idle'; lastError = null; lastAppliedTurns = []; targetCandidates = [];
    q('.ba-trace').open = false;
    prompt.value = ''; prompt.placeholder = copy().prompt;
    outputView(); updateButtons();
  }
  function showConfig(show) {
    if (show) syncModelOptions();
    config.hidden = !show; updateReadyBanner(); outputView(); updateButtons();
    if (show) key.focus();
  }
  function promptText() {
    return sharedLesson && coveredDraft.replace(/[\r\n]/g, '') === prompt.value ? coveredDraft : prompt.value;
  }
  function setPrompt(value) {
    coveredDraft = sharedLesson ? value : '';
    prompt.value = value;
  }
  function setSharedLesson(active) {
    if (sharedLesson === active) return;
    const draft = promptText(), hadFocus = doc.activeElement === prompt;
    stopSpeech();
    prompt.hidden = true; prompt.removeAttribute('data-ba-prompt'); prompt.value = '';
    sharedLesson = active;
    panel.toggleAttribute('data-ba-shared-lesson', active);
    prompt = active ? coveredPrompt : ordinaryPrompt;
    prompt.hidden = false; prompt.setAttribute('data-ba-prompt','');
    setPrompt(draft);
    label(prompt, active ? copy().sharedPrompt : copy().prompt);
    prompt.placeholder = active ? copy().sharedPrompt : clarification ? copy().clarified : copy().prompt;
    announce(); updateButtons(); outputView();
    if (hadFocus) prompt.focus({preventScroll:true});
  }
  // An open panel is a window of the whole page, not of the pitch: it lives in a
  // viewport layer so it can be moved anywhere and is never clipped by the board.
  // Phones and touch tablets dock it above the software keyboard instead.
  let position = null, presentation = null;
  function placePanel() {
    if (position) return positionPanel(position.x, position.y);
    const anchor = host.getBoundingClientRect(), layer = root.getBoundingClientRect();
    positionPanel(anchor.right - layer.left - panel.offsetWidth - 10, anchor.top - layer.top + 10);
  }
  function syncPanelLayout() {
    const opened = !panel.hidden, dockHost = presentation?.host ?? getContext().dockHost;
    const docked = !presentation && opened && (win.innerWidth <= 600 || !!win.matchMedia?.('(any-pointer: coarse)').matches);
    const floating = !presentation && opened && (docked || floatingRequested || !dockHost);
    root.classList.toggle('ba-floating', floating);
    root.classList.toggle('ba-docked', docked);
    root.classList.toggle('ba-task-panel', opened && !floating);
    button('float').hidden = !!presentation || !dockHost || docked;
    button('float').textContent = floatingRequested ? copy().dock : copy().float;
    q('.ba-mode-switch').hidden = !!presentation || !dockHost || floating;
    if (presentation || win.innerWidth > 600) panel.classList.remove('ba-collapsed');
    const parent = presentation?.host ?? (floating ? doc.body : opened && dockHost ? dockHost : host);
    if (root.parentElement !== parent) parent.append(root);
    if (docked || !floating) { panel.style.left = ''; panel.style.top = ''; panel.style.right = ''; }
    else placePanel();
    if (presentation) presentation.onOpenChange(opened);
    else onPanelChange?.({open:opened,docked,floating,touchSheet:docked});
  }
  function setOpen(opened) {
    panel.hidden = !opened;
    button('open').hidden = opened;
    button('open').setAttribute('aria-expanded', String(opened));
    syncPanelLayout();
  }
  function close({clear = false, suspend = false} = {}) {
    // Collapsing is a view action: the uncommitted proposal and conversation stay intact.
    const returnFocus = root.contains(doc.activeElement);
    if (suspend) cancel();
    stopSpeech(); config.hidden = true; setOpen(false);
    if (clear) { key.value = ''; reset(); updateReadyBanner(); }
    if (returnFocus) (presentation?.trigger ?? button('open')).focus();
  }
  function updateGuide(ctx = getContext(), lang = copy()) {
    q('[data-ba-guide]').textContent = presentation?.guide ?? (ctx.readOnly ? lang.guideSearch : lang.guide);
  }
  function refresh() {
    const ctx = getContext(), lang = copy();
    if (locale !== getLocale()) {
      locale = getLocale();
      for (const n of root.querySelectorAll('[data-text]')) n.textContent = lang[n.dataset.text];
      for (const action of ['open','settings','close']) label(button(action), lang[action]);
      label(prompt, sharedLesson ? lang.sharedPrompt : lang.prompt);
      q('[data-ba-drag]').title = lang.move;
      syncModelOptions();
    }
    if (scope !== ctx.scope) switchScope(ctx.scope);
    q('.ba-scope').textContent = ctx.title || '';
    updateGuide(ctx, lang);
    button('edit').hidden = !!ctx.readOnly;
    button('route-edit').hidden = !!ctx.readOnly;
    prompt.placeholder = sharedLesson ? lang.sharedPrompt : clarification ? lang.clarified : lang.prompt;
    updateReadyBanner();
    updateButtons(); outputView();
  }
  function mount(next) {
    if (destroyed || !next) return;
    host = next;
    refresh(); syncPanelLayout();
  }
  function open() {
    refresh(); setOpen(true); prompt.focus();
  }
  // A full-screen view owns its own dialog layer. Move this instance into that
  // layer, keeping its request, draft and staged confirmation in the same session.
  function presentIn(next, {trigger, onOpenChange, guide, examples = []}) {
    const state = {host:next, trigger, onOpenChange, guide};
    const wasOpen = !panel.hidden, wasCollapsed = panel.classList.contains('ba-collapsed');
    const ordinaryExamples = q('.ba-examples');
    const localExamples = doc.createElement('div');
    localExamples.className = 'ba-examples';
    for (const example of examples) {
      const exampleButton = doc.createElement('button');
      exampleButton.type = 'button';
      exampleButton.className = 'ba-pill';
      exampleButton.textContent = example.label;
      exampleButton.addEventListener('click', () => {
        selectedMode = 'auto';
        clarification = '';
        compose(example.prompt);
      });
      localExamples.append(exampleButton);
    }
    ordinaryExamples.hidden = true;
    ordinaryExamples.after(localExamples);
    presentation = state;
    panel.setAttribute('role', 'region');
    panel.removeAttribute('aria-modal');
    updateGuide();
    syncPanelLayout();
    return () => {
      if (presentation !== state || destroyed) return;
      setSharedLesson(false);
      presentation = null;
      localExamples.remove();
      ordinaryExamples.hidden = false;
      panel.setAttribute('role', 'dialog');
      panel.setAttribute('aria-modal', 'false');
      panel.classList.toggle('ba-collapsed', wasCollapsed);
      if (!wasOpen) { config.hidden = true; stopSpeech(); }
      updateGuide();
      setOpen(wasOpen);
      return wasOpen ? prompt : button('open');
    };
  }
  async function send() {
    if (pending) { cancel(); prompt.focus(); return; }
    const lang = copy(), text = promptText().trim();
    if (!text || recognition || applying || continuing) return;
    if (!key.value.trim() || !model.value.trim()) { showConfig(true); announce(lang.configure); return; }
    if (provider.value === 'custom' && !baseUrl.value.trim()) { showConfig(true); announce(lang.customUrlRequired,true); baseUrl.focus(); return; }
    // A playbook transaction cannot be built upon; it is confirmed or dropped first.
    if (staged && !staged.stackable) { announce(lang.resolveFirst, true); return; }
    if (staged?.selectTurns && selectedGroups.size !== turnsOf(staged).length) { announce(lang.updateGroupsFirst,true); return; }
    setModelConnection(readConnection());
    const requestScope = getContext().scope;
    const control = new AbortController();
    pending = control;
    const instruction = text; activeInstruction = instruction; lastError = null; targetCandidates = []; runState = 'running';
    runNumber++;
    const progress = [];
    config.hidden = true; reply = null; outputView(); updateButtons(); announce(lang.loading);
    try {
      const result = await onRequest({prompt:instruction, mode:selectedMode, provider:provider.value, protocol:protocol.value, baseUrl:provider.value === 'custom' ? baseUrl.value.trim() : '', model:model.value.trim(),
        apiKey:key.value.trim(), signal:control.signal, locale:getLocale(), previous:conversationRecords(thread.records()),
        onEvent(event) { if (pending === control && !control.signal.aborted && requestScope === getContext().scope) recordEvent(event); },
        onTool(name, args) {
          if (pending !== control || control.signal.aborted) return;
          const selectors = name === 'resolve_players' ? args?.selectors : name === 'resolve_player' ? [args] : [];
          const subjects = (Array.isArray(selectors) ? selectors : []).map(item => [item?.role, item?.name, item?.number && '#' + item.number].filter(Boolean).join(' ')).filter(Boolean);
          const label = (lang.toolProgress[name] || lang.loading).replace(/[…\s]+$/, '');
          progress.push(subjects.length ? `${label} ${subjects.join(', ').slice(0, 160)}` : label);
          announce(progress.slice(-10).join(' → '));
        }});
      if (pending !== control || destroyed || (requestScope !== getContext().scope && result.scope !== getContext().scope)) return;
      clarification = result.kind === 'clarify' ? result.message : '';
      if (result.kind === 'clarify' && Array.isArray(result.candidates)) targetCandidates = result.candidates.filter(candidate=>typeof candidate?.id==='string'&&typeof candidate?.label==='string').slice(0,40);
      if (result.kind === 'preview') {
        if (staged && !result.stackable) discardStaged();
        stage(result, instruction);
      } else {
        const record = thread.add({instruction, kind:result.kind, summary:result.summary || result.message || '', message:result.message, operations:result.operations,
          ...(result.transactionId ? {transactionId:result.transactionId} : {}), ...(result.kind === 'edit' ? {status:TURN_STATUS.applied} : {})});
        if (result.kind === 'edit') lastAppliedTurns = [record];
      }
      reply = result; runState = result.kind === 'preview' ? 'preview' : result.kind === 'clarify' ? 'clarify' : 'complete';
      if (result.kind === 'answer' && result.highlights) onHighlight?.(result.highlights);
      if (!presentation && result.kind === 'preview' && win.matchMedia?.('(max-width: 600px)').matches) panel.classList.add('ba-collapsed');
      setPrompt('');
      prompt.placeholder = sharedLesson ? lang.sharedPrompt : clarification ? lang.clarified : lang.prompt;
      outputView(); q('.ba-content').scrollTop = q('.ba-content').scrollHeight;
      announce(result.kind === 'search' ? lang.matches + ' · ' + result.items.length : result.message || lang.change, false, true);
      if (clarification) prompt.focus();
    } catch (error) {
      if (pending === control && !control.signal.aborted) {
        // A failed turn stays in the thread: the next message usually completes it.
        thread.add({instruction, kind:'error', status:TURN_STATUS.failed, message:String(error?.message || lang.error).slice(0, 400)});
        lastError = {instruction,message:String(error?.message || lang.error).slice(0,400)}; runState = 'failed';
        announce(lastError.message, true, false, error?.code);
      }
    } finally {
      if (pending === control) { pending = null; activeInstruction = ''; updateButtons(); outputView(); }
    }
  }
  function dictate() {
    if (recognition) { recognition.stop(); return; }
    if (!Speech || pending) return;
    const lang = copy(), base = prompt.value.trim(), instance = new Speech();
    recognition = instance; instance.lang = getLocale() === 'en' ? 'en-US' : 'zh-CN';
    instance.continuous = false; instance.interimResults = false;
    instance.onresult = event => {
      const transcript = Array.from(event.results, part => part[0]?.transcript || '').join(' ').trim();
      if (transcript) prompt.value = [base, transcript].filter(Boolean).join(' ').slice(0, prompt.maxLength);
      announce(transcript ? '' : lang.micError); prompt.focus();
    };
    instance.onerror = event => announce(['not-allowed','service-not-allowed'].includes(event.error) ? lang.micDenied : lang.micError, true);
    instance.onend = () => { recognition = null; if (status.textContent === lang.listening) announce(); updateButtons(); };
    try { instance.start(); announce(lang.listening); updateButtons(); }
    catch { recognition = null; announce(lang.micError, true); updateButtons(); }
  }
  async function add(index, element) {
    const item = reply?.items?.[index];
    if (!item || item.added || getContext().readOnly) return;
    const previous = reply;
    element.disabled = true;
    // Preserve an in-flight import across unrelated editor repaints.
    item.added = true;
    try {
      if (await onAdd(item.id) === false) throw Error(copy().addFailed);
    } catch (error) { item.added = false; if (previous === reply) announce(error.message || copy().addFailed, true); }
    if (previous === reply) outputView();
  }
  root.addEventListener('click', event => {
    event.stopPropagation();
    const b = event.target.closest('button[data-ba]');
    if (!b || b.disabled) return;
    const action = b.dataset.ba;
    if (action === 'open') open();
    else if (action === 'close' || action === 'properties') close();
    else if (action === 'float') { floatingRequested = !floatingRequested; syncPanelLayout(); }
    else if (action === 'retry' && lastError) {
      if (lastError.action === 'apply' && staged) { lastError = null; button('apply')?.click(); }
      else { prompt.value = lastError.instruction; void send(); }
    }
    else if (action === 'choose-target') {
      const candidate = targetCandidates[Number(b.dataset.targetIndex)];
      if (candidate) {
        onSelectTarget?.(candidate.id); onHighlight?.([candidate.id]);
        thread.add({instruction:copy().selectedTarget + ' ' + candidate.label,kind:'answer',playerIds:[candidate.id],summary:copy().targetReady});
        prompt.value = copy().continueSelected; updateButtons(); historyView(); prompt.focus();
      }
    }
    else if (action === 'repreview-turn') { const record = thread.records()[Number(b.dataset.turnIndex)]; if (record?.status === TURN_STATUS.stale && !staged) { prompt.value = record.instruction; void send(); } }
    else if (action === 'settings' || action === 'done') { if (action === 'done') setModelConnection(readConnection()); showConfig(action !== 'done' && config.hidden); if (config.hidden) prompt.focus(); }
    else if (action === 'send') void send();
    else if (action === 'mic') dictate();
    else if (action === 'add') void add(Number(b.dataset.index), b);
    else if (action === 'clear-mode') { selectedMode = 'auto'; updateButtons(); }
    else if (action === 'expand') panel.classList.remove('ba-collapsed');
    else if (action === 'handoff') onHandoff?.(reply);
    else if (action === 'continue' && reply?.action?.run && !continuing) {
      const previousReply = reply, instruction = thread.records().at(-1)?.instruction || '';
      continuing = previousReply; b.disabled = true; updateButtons();
      // Invoke inside the actual click so file and print dialogs retain activation.
      // A trusted conversion can navigate to a new play before returning its receipt.
      try {
        Promise.resolve(previousReply.action.run()).then(result => {
          if (continuing !== previousReply || destroyed || !result) return;
          if (reply !== previousReply && result.scope !== getContext().scope) return;
          reply = result;
          if (result.kind === 'edit') {
            const record = thread.add({instruction,kind:'edit',status:TURN_STATUS.applied,summary:result.summary || result.message || '',...(result.transactionId ? {transactionId:result.transactionId} : {})});
            lastAppliedTurns = [record]; runState = 'applied';
          }
          outputView(); announce(result.message || copy().change);
        }).catch(error => { if (continuing === previousReply) announce(error?.message || copy().error,true); }).finally(() => {
          if (continuing === previousReply) continuing = null;
          if (b.isConnected) b.disabled = false;
          if (!destroyed) updateButtons();
        });
      } catch (error) { continuing = null; b.disabled = false; updateButtons(); announce(error?.message || copy().error,true); }
    }
    else if (action === 'discard' && staged) { discardStaged(); lastError = null; runState = 'idle'; panel.classList.remove('ba-collapsed'); outputView(); announce(copy().discarded); }
    else if (action === 'rehearse' && staged) staged.rehearse?.();
    else if (action === 'update-groups' && staged?.selectTurns && !pending && !applying && selectedGroups.size) {
      const preview = staged, indices = [...selectedGroups].sort((a,b)=>a-b), oldRecords = stagedTurns.slice();
      applying = preview; runState = 'previewing'; outputView(); updateButtons();
      Promise.resolve().then(()=>preview.selectTurns(indices)).then(next => {
        if (staged !== preview) return;
        oldRecords.forEach((record,index)=>{if(!indices.includes(index))thread.settle(record,TURN_STATUS.discarded);});
        stagedTurns = indices.map(index=>oldRecords[index]);
        stage(next); reply = next; runState = 'preview'; lastError = null;
        announce(copy().groupsUpdated);
      }).catch(error=>{if(staged===preview){groupError=String(error?.message || copy().groupDependency).slice(0,500);runState='preview';announce(groupError,true);}}).finally(()=>{
        if(applying===preview)applying=null;
        if(!destroyed){updateButtons();outputView();}
      });
    }
    else if (action === 'revert' && staged?.revert && !pending) {
      try { stage(staged.revert()); lastError = null; runState = 'preview'; outputView(); announce(copy().reverted); }
      catch (error) { announce(error?.message || copy().error, true); }
    }
    else if (action === 'apply' && staged && applying !== staged && !pending) {
      const preview = staged; applying = preview; b.disabled = true; runState = 'applying'; updateButtons(); historyView();
      Promise.resolve().then(() => preview.apply()).then(result => {
        if (staged !== preview) return;
        panel.classList.remove('ba-collapsed');
        // A rebased proposal comes back as a fresh preview and waits for another confirmation.
        if (result.kind === 'preview') { stage(result); runState = 'preview'; }
        else { lastAppliedTurns = stagedTurns.slice(); settleStaged(TURN_STATUS.applied, result); staged = null; reply = result; runState = 'applied'; }
        announce(result.message || copy().change);
      }).catch(error => { if (staged === preview) {
        lastError = {action:'apply',instruction:stagedTurns.at(-1)?.instruction || '',message:String(error?.message || copy().error).slice(0,400)};
        runState = 'failed'; announce(lastError.message,true);
      } }).finally(() => {
        if (applying === preview) applying = null;
        if (!destroyed) { updateButtons(); outputView(); }
      });
    }
    else if (action === 'undo' && reply?.undo) {
      const applied = reply.undo();
      if (applied !== false) {
        if (reply?.transactionId) notifyTransaction({id:reply.transactionId,status:TURN_STATUS.undone});
        else lastAppliedTurns.forEach(turn => thread.settle(turn,TURN_STATUS.undone));
        reply = null; runState = 'undone';
      }
      outputView(); announce(applied === false ? copy().undoExpired : copy().undone);
    } else if (action === 'route-edit') {
      selectedMode = 'edit'; clarification = ''; compose(copy().routeEditExample);
    } else if (action === 'edit' || action === 'search') {
      selectedMode = action; clarification = ''; prompt.value = copy()[action + 'Example']; updateButtons(); prompt.focus(); prompt.select();
    }
  });
  root.addEventListener('change',event=>{
    const input = event.target.closest('[data-ba-group]');
    if (!input || !staged?.selectTurns || pending || applying) return;
    const index = Number(input.dataset.baGroup);
    if (input.checked) selectedGroups.add(index); else selectedGroups.delete(index);
    groupError = '';
    const changed = selectedGroups.size !== turnsOf(staged).length;
    const apply = button('apply'), update = button('update-groups'), revert = button('revert');
    if (apply) apply.disabled = changed;
    if (revert) revert.disabled = changed;
    if (update) update.disabled = !changed || !selectedGroups.size;
    const error = q('.ba-group-error'); if(error){error.textContent=!selectedGroups.size?copy().groupRequired:'';error.hidden=!error.textContent;}
  });
  ordinaryPrompt.addEventListener('input', updateButtons);
  coveredPrompt.addEventListener('input', () => { coveredDraft = ''; updateButtons(); });
  provider.addEventListener('change', () => { key.value = ''; baseUrl.value = ''; model.value = MODEL_PROVIDER_PRESETS[provider.value].defaultModel; syncModelOptions(true); updateReadyBanner(); key.focus(); });
  for (const field of [model, key]) field.addEventListener('input', updateReadyBanner);
  root.addEventListener('keydown', event => {
    if (!presentation || event.key !== 'Tab') event.stopPropagation();
    if (event.isComposing || event.keyCode === 229) return;
    if (event.key === 'Escape') { event.preventDefault(); close(); }
    if (event.target === prompt && event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); if (!pending) void send(); }
  });
  for (const name of ['pointerdown','pointermove','pointerup','pointercancel','dblclick','wheel','contextmenu']) {
    root.addEventListener(name, event => event.stopPropagation());
  }
  const grip = q('[data-ba-drag]');
  let drag;
  grip.addEventListener('pointerdown', event => {
    if (event.button !== 0 || event.isPrimary === false || !root.classList.contains('ba-floating') || root.classList.contains('ba-docked')) return;
    const bounds = panel.getBoundingClientRect();
    drag = {x:event.clientX - bounds.left, y:event.clientY - bounds.top};
    grip.setPointerCapture?.(event.pointerId);
  });
  grip.addEventListener('pointermove', event => {
    if (!drag) return;
    const bounds = root.getBoundingClientRect();
    positionPanel(event.clientX - bounds.left - drag.x, event.clientY - bounds.top - drag.y);
    position = {x:parseFloat(panel.style.left), y:parseFloat(panel.style.top)};
  });
  grip.addEventListener('lostpointercapture', () => { drag = null; });
  grip.addEventListener('pointerup', () => { drag = null; });
  grip.addEventListener('dblclick', () => { if (!presentation) { position = null; floatingRequested = false; syncPanelLayout(); } });
  function positionPanel(x, y) {
    const clamp = (value, max) => Math.max(4, Math.min(value, max - 4));
    // Unchanged values are not rewritten, so a size observer cannot re-trigger itself.
    const next = {left:clamp(x, root.clientWidth - panel.offsetWidth) + 'px', top:clamp(y, root.clientHeight - panel.offsetHeight) + 'px', right:'auto'};
    for (const [name, value] of Object.entries(next)) if (panel.style[name] !== value) panel.style[name] = value;
  }
  // A dragged panel must remain reachable when results arrive or the board shrinks.
  const resize = win.ResizeObserver && new win.ResizeObserver(() => {
    if (!panel.hidden && panel.style.left && !root.classList.contains('ba-docked')) positionPanel(parseFloat(panel.style.left), parseFloat(panel.style.top));
  });
  resize?.observe(root); resize?.observe(panel);
  win.addEventListener('resize', syncPanelLayout);
  function destroy() { destroyed = true; unsubscribeConnection(); resize?.disconnect(); win.removeEventListener('resize', syncPanelLayout); close({clear:true}); root.remove(); }
  mount(host);
  function refreshPreview() { if (staged) outputView(); }
  function saveSession() {
    if (scope == null) return;
    sessions.set(scope,{thread,reply:reply?.kind === 'preview' ? null : reply,trace,runNumber,clarification,selectedMode,prompt:promptText(),lastError,lastAppliedTurns,targetCandidates});
  }
  function switchScope(next, {adopting = false} = {}) {
    if (scope === next) return;
    const movingTransaction = adopting && applying && applying === staged;
    // Trusted host navigation may be the result of this very request. Keep its
    // signal alive so the acknowledged navigation result can settle in the new scope.
    if (!adopting) { continuing = null; cancel(); }
    if (staged && !movingTransaction) discardStaged(true,TURN_STATUS.stale);
    saveSession();
    const saved = sessions.get(next);
    scope = next; thread = saved?.thread || createConversation();
    reply = saved?.reply || null; trace = saved?.trace || []; runNumber = saved?.runNumber || 0;
    clarification = saved?.clarification || ''; selectedMode = saved?.selectedMode || 'auto';
    setPrompt(saved?.prompt || ''); lastError = saved?.lastError || null; lastAppliedTurns = saved?.lastAppliedTurns || []; targetCandidates = saved?.targetCandidates || [];
    runState = staged && movingTransaction ? 'applying' : lastError ? 'failed' : 'idle';
    q('.ba-trace').open = false;
  }
  function adoptScope(next) { switchScope(next,{adopting:true}); }
  function notifyTransaction({id,status} = {}) {
    let changed = thread.settleTransaction(id,status);
    for (const session of sessions.values()) {
      changed = session.thread.settleTransaction(id,status) || changed;
      if (session.reply?.transactionId === id && status === TURN_STATUS.undone) session.reply = null;
    }
    if (changed) { if (reply?.transactionId === id && status === TURN_STATUS.undone) reply = null; outputView(); }
    return changed;
  }
  function compose(instruction, {send:submit = false} = {}) {
    if (destroyed) return;
    open(); setPrompt(String(instruction || '').slice(0,prompt.maxLength)); updateButtons(); prompt.focus();
    if (submit) void send();
  }
  return {mount, presentIn, setSharedLesson, refresh, refreshLayout:syncPanelLayout, refreshPreview, open, close, destroy, adoptScope, notifyTransaction, compose, isServerConfigured: () => serverReady()};
}
