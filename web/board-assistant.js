import { getLocale } from './i18n.js';
import { escapeHTML as e } from './model.js';
import en from './locales/board-assistant.en.js';
import zh from './locales/board-assistant.zh-CN.js';

const symbols = {
  spark: '<path d="m11 2 2.1 6.6L20 11l-6.9 2.3L11 20l-2.2-6.7L2 11l6.8-2.4zM19 2v4m-2-2h4"/>',
  settings: '<path d="M3 7h6m4 0h8M3 17h11m4 0h3"/><circle cx="11" cy="7" r="2"/><circle cx="16" cy="17" r="2"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>', send: '<path d="M12 19V5m-6 6 6-6 6 6"/>',
  mic: '<rect x="9" y="3" width="6" height="12" rx="3"/><path d="M5 11a7 7 0 0 0 14 0m-7 7v3m-3 0h6"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="2"/>'
};
const glyph = name => '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + symbols[name] + '</svg>';
const copy = () => getLocale() === 'en' ? en : zh;

export function createBoardAssistant({host, getContext, onRequest, onAdd, onHighlight, onHandoff}) {
  const doc = host.ownerDocument, win = doc.defaultView;
  const root = doc.createElement('div');
  root.className = 'board-ai';
  root.innerHTML = `<button type="button" class="ba-fab" data-ba="open" aria-expanded="false" aria-controls="board-ai-panel">${glyph('spark')}<b>AI</b></button>
    <section class="ba-panel" id="board-ai-panel" role="dialog" aria-modal="false" aria-labelledby="board-ai-heading" hidden>
      <header class="ba-header"><button type="button" class="ba-expand ba-pill" data-ba="expand" data-text="expand"></button><div class="ba-heading" data-ba-drag>${glyph('spark')}<div><h2 id="board-ai-heading" data-text="title"></h2><small class="ba-scope"></small></div></div>
        <button type="button" class="ba-icon" data-ba="settings">${glyph('settings')}</button><button type="button" class="ba-icon" data-ba="close">${glyph('close')}</button></header>
      <div class="ba-content"><div class="ba-config" hidden><label><span data-text="provider"></span><select data-ba-provider><option value="openai">OpenAI</option><option value="openrouter">OpenRouter</option></select></label>
        <label><span data-text="model"></span><input data-ba-model value="gpt-6.1-terra" maxlength="150" autocomplete="off" spellcheck="false"></label>
        <label><span data-text="key"></span><input data-ba-key type="password" autocomplete="off" maxlength="512" spellcheck="false"></label><small data-text="keyHint"></small>
        <button type="button" class="ba-pill" data-ba="done" data-text="done"></button></div>
        <div class="ba-output" hidden></div><div class="ba-welcome"><strong data-ba-guide></strong><div class="ba-examples">
        <button class="ba-pill" type="button" data-ba="edit" data-text="edit"></button>
        <button class="ba-pill" type="button" data-ba="search" data-text="search"></button></div></div></div>
      <footer class="ba-footer"><button type="button" class="ba-mode ba-pill" data-ba="clear-mode" hidden></button><div class="ba-status" role="status" aria-live="polite"></div>
        <div class="ba-compose"><textarea rows="2" maxlength="1600" data-ba-prompt></textarea>
        <div class="ba-controls"><button type="button" class="ba-icon" data-ba="mic">${glyph('mic')}</button>
        <button type="button" class="ba-icon ba-send" data-ba="send">${glyph('send')}</button></div></div></footer></section>`;
  const q = selector => root.querySelector(selector);
  const button = name => q('[data-ba="' + name + '"]');
  const panel = q('.ba-panel'), output = q('.ba-output'), config = q('.ba-config'), prompt = q('[data-ba-prompt]');
  const status = q('.ba-status'), key = q('[data-ba-key]'), model = q('[data-ba-model]'), provider = q('[data-ba-provider]');
  const Speech = win.SpeechRecognition || win.webkitSpeechRecognition;
  let scope, locale, pending, recognition, reply, clarification = '', selectedMode = 'auto', destroyed = false;
  let previous = [], requestInstruction = '';
  const remember = record => { previous = [...previous, record].slice(-5); };
  function clearPreview() { if (reply?.kind === 'preview') reply.discard?.(); }

  function announce(message = '', error = false, spokenOnly = false) {
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
    button('send').disabled = !running && (!prompt.value.trim() || !!recognition);
    button('mic').disabled = running || !Speech;
    button('mic').setAttribute('aria-pressed', String(!!recognition));
    label(button('mic'), Speech ? (recognition ? lang.micStop : lang.mic) : lang.micUnavailable);
    button('settings').disabled = running;
    button('settings').setAttribute('aria-expanded', String(!config.hidden));
    prompt.readOnly = running;
  }
  function outputView() {
    const lang = copy();
    output.replaceChildren();
    output.hidden = !reply || !config.hidden;
    q('.ba-welcome').hidden = !!reply || !config.hidden;
    if (!reply) return;
    if (reply.kind !== 'search') {
      const message = doc.createElement('p');
      message.textContent = reply.message || lang.change;
      output.append(message);
      if (reply.kind === 'preview') {
        if (Array.isArray(reply.changes)) { const list = doc.createElement('ul'); for (const change of reply.changes) { const li = doc.createElement('li'); li.textContent = String(change); list.append(li); } output.append(list); }
        for (const action of ['apply','discard','rehearse']) { if (action === 'rehearse' && !reply.rehearse) continue; const control = doc.createElement('button'); control.type = 'button'; control.className = 'ba-pill'; control.dataset.ba = action; control.textContent = lang[action]; output.append(control); }
      }
      if (reply.kind === 'handoff' && onHandoff) { const go = doc.createElement('button'); go.type = 'button'; go.className = 'ba-pill'; go.dataset.ba = 'handoff'; go.textContent = lang.handoff; output.append(go); }
      if (reply.undo) {
        const undo = doc.createElement('button');
        undo.type = 'button'; undo.className = 'ba-pill'; undo.dataset.ba = 'undo';
        undo.textContent = lang.undo;
        output.append(undo);
      }
      return;
    }
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
  }
  function stopSpeech() {
    const instance = recognition;
    recognition = null;
    if (instance) {
      instance.onresult = instance.onerror = instance.onend = null;
      instance.abort();
    }
  }
  function cancel() {
    pending?.abort(); pending = null;
    stopSpeech(); updateButtons(); announce();
  }
  function reset() {
    cancel(); clearPreview(); clarification = ''; selectedMode = 'auto'; reply = null; previous = [];
    prompt.value = ''; prompt.placeholder = copy().prompt;
    outputView(); updateButtons();
  }
  function showConfig(show) {
    config.hidden = !show; outputView(); updateButtons();
    if (show) key.focus();
  }
  function close({clear = false} = {}) {
    if (reply?.kind === 'preview') { clearPreview(); reply = null; outputView(); }
    cancel(); panel.hidden = true; button('open').hidden = false;
    button('open').setAttribute('aria-expanded', 'false'); config.hidden = true;
    if (clear) { key.value = ''; reset(); }
    if (root.contains(doc.activeElement)) button('open').focus();
  }
  function refresh() {
    const ctx = getContext(), lang = copy();
    if (locale !== getLocale()) {
      locale = getLocale();
      for (const n of root.querySelectorAll('[data-text]')) n.textContent = lang[n.dataset.text];
      for (const action of ['open','settings','close']) label(button(action), lang[action]);
      label(prompt, lang.prompt);
      q('[data-ba-drag]').title = lang.move;
    }
    if (scope !== ctx.scope) { scope = ctx.scope; reset(); }
    q('.ba-scope').textContent = ctx.title || '';
    q('[data-ba-guide]').textContent = ctx.readOnly ? lang.guideSearch : lang.guide;
    button('edit').hidden = !!ctx.readOnly;
    prompt.placeholder = clarification ? lang.clarified : lang.prompt;
    updateButtons(); outputView();
  }
  function mount(next) {
    if (destroyed || !next) return;
    host = next;
    if (root.parentElement !== next) next.append(root);
    refresh();
  }
  function open() {
    refresh(); panel.hidden = false; button('open').hidden = true;
    button('open').setAttribute('aria-expanded', 'true'); prompt.focus();
  }
  async function send() {
    if (pending) { cancel(); prompt.focus(); return; }
    const lang = copy(), text = prompt.value.trim();
    if (!text || recognition) return;
    if (!key.value.trim() || !model.value.trim()) { showConfig(true); announce(lang.configure); return; }
    const requestScope = getContext().scope;
    const control = new AbortController();
    pending = control;
    const instruction = text;
    clearPreview(); requestInstruction = instruction;
    const progress = [];
    config.hidden = true; reply = null; outputView(); updateButtons(); announce(lang.loading);
    try {
      const result = await onRequest({prompt:instruction, mode:selectedMode, provider:provider.value, model:model.value.trim(),
        apiKey:key.value.trim(), signal:control.signal, locale:getLocale(), previous:previous.slice(),
        onTool(name, args) {
          if (pending !== control || control.signal.aborted) return;
          const selectors = name === 'resolve_players' ? args?.selectors : name === 'resolve_player' ? [args] : [];
          const subjects = (Array.isArray(selectors) ? selectors : []).map(item => [item?.role, item?.name, item?.number && '#' + item.number].filter(Boolean).join(' ')).filter(Boolean);
          const label = (lang.toolProgress[name] || lang.loading).replace(/[…\s]+$/, '');
          progress.push(subjects.length ? `${label} ${subjects.join(', ').slice(0, 160)}` : label);
          announce(progress.slice(-10).join(' → '));
        }});
      if (pending !== control || destroyed || requestScope !== getContext().scope) return;
      reply = result;
      clarification = result.kind === 'clarify' ? result.message : '';
      if (result.kind !== 'preview') remember({instruction, kind:result.kind, summary:result.summary || result.message || '', message:result.message, operations:result.operations});
      if (result.kind === 'answer' && result.highlights) onHighlight?.(result.highlights);
      if (result.kind === 'preview' && win.matchMedia?.('(max-width: 600px)').matches) panel.classList.add('ba-collapsed');
      prompt.value = '';
      prompt.placeholder = clarification ? lang.clarified : lang.prompt;
      outputView(); q('.ba-content').scrollTop = 0;
      announce(result.kind === 'search' ? lang.matches + ' · ' + result.items.length : result.message || lang.change, false, true);
      if (clarification) prompt.focus();
    } catch (error) {
      if (pending === control && !control.signal.aborted) announce(error?.message || lang.error, true);
    } finally {
      if (pending === control) { pending = null; updateButtons(); }
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
    else if (action === 'close') close();
    else if (action === 'settings' || action === 'done') { showConfig(action !== 'done' && config.hidden); if (config.hidden) prompt.focus(); }
    else if (action === 'send') void send();
    else if (action === 'mic') dictate();
    else if (action === 'add') void add(Number(b.dataset.index), b);
    else if (action === 'clear-mode') { selectedMode = 'auto'; updateButtons(); }
    else if (action === 'expand') panel.classList.remove('ba-collapsed');
    else if (action === 'handoff') onHandoff?.(reply);
    else if (action === 'discard' && reply?.kind === 'preview') { clearPreview(); reply = null; panel.classList.remove('ba-collapsed'); outputView(); announce(copy().discarded); }
    else if (action === 'rehearse' && reply?.kind === 'preview') reply.rehearse?.();
    else if (action === 'apply' && reply?.kind === 'preview') {
      const preview = reply; b.disabled = true;
      Promise.resolve().then(() => preview.apply()).then(result => {
        if (reply !== preview) return;
        reply = result; panel.classList.remove('ba-collapsed');
        remember({instruction:requestInstruction, kind:'edit', summary:result.summary || result.message || preview.message, operations:result.operations || preview.operations, routeIds:result.routeIds || [], playerIds:result.playerIds || []});
        outputView(); announce(result.message || copy().change);
      }).catch(error => { if (reply === preview) { b.disabled = false; announce(error?.message || copy().error, true); } });
    }
    else if (action === 'undo' && reply?.undo) {
      const applied = reply.undo(); reply = null; outputView(); announce(applied === false ? copy().undoExpired : copy().undone);
    } else if (action === 'edit' || action === 'search') {
      selectedMode = action; clarification = ''; prompt.value = copy()[action + 'Example']; updateButtons(); prompt.focus(); prompt.select();
    }
  });
  prompt.addEventListener('input', updateButtons);
  provider.addEventListener('change', () => { key.value = ''; model.value = provider.value === 'openrouter' ? 'openai/gpt-6.1-terra' : 'gpt-6.1-terra'; key.focus(); });
  root.addEventListener('keydown', event => {
    event.stopPropagation();
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
    if (event.button !== 0 || event.isPrimary === false) return;
    const bounds = panel.getBoundingClientRect();
    drag = {x:event.clientX - bounds.left, y:event.clientY - bounds.top};
    grip.setPointerCapture?.(event.pointerId);
  });
  grip.addEventListener('pointermove', event => {
    if (!drag) return;
    const bounds = root.getBoundingClientRect();
    positionPanel(event.clientX - bounds.left - drag.x, event.clientY - bounds.top - drag.y);
  });
  grip.addEventListener('lostpointercapture', () => { drag = null; });
  grip.addEventListener('pointerup', () => { drag = null; });
  grip.addEventListener('dblclick', () => { panel.style.left = ''; panel.style.top = ''; panel.style.right = ''; });
  function positionPanel(x, y) {
    const clamp = (value, max) => Math.max(4, Math.min(value, max - 4));
    panel.style.left = clamp(x, root.clientWidth - panel.offsetWidth) + 'px';
    panel.style.top = clamp(y, root.clientHeight - panel.offsetHeight) + 'px';
    panel.style.right = 'auto';
  }
  // A dragged panel must remain reachable when results arrive or the board shrinks.
  const resize = win.ResizeObserver && new win.ResizeObserver(() => {
    if (!panel.hidden && panel.style.left) positionPanel(parseFloat(panel.style.left), parseFloat(panel.style.top));
  });
  resize?.observe(root); resize?.observe(panel);
  function destroy() { destroyed = true; resize?.disconnect(); close({clear:true}); root.remove(); }
  mount(host);
  return {mount, refresh, open, close, destroy};
}
