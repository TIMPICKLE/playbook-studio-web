import { getLocale } from './i18n.js';
import { escapeHTML as e } from './model.js';
import { tt } from './training-i18n.js';
import { trainingDemo } from './training-demo.js';
import { correctSelection, drillStatus, feedbackTargets, trainingScene } from './training-model.js';
import { createTrainingField } from './training-field.js';
import { trainingProgress, trainingResult } from './training-progress.js';

const modeKey = { pov: 'read', field: 'field', mixed: 'mixed' };
const actions = {
  back: '<path d="m13 5-7 7 7 7M7 12h14"/>', play: '<path d="m8 5 11 7-11 7z"/>',
  arrow: '<path d="M4 12h15m-6-6 6 6-6 6"/>', repeat: '<path d="M4 5v6h6M5 11a8 8 0 1 1 1 7"/>',
  film: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M7 5v14m10-14v14M3 10h4m10 0h4M3 14h4m10 0h4"/>',
  hint: '<path d="M9 18h6m-5 3h4M8 14a6 6 0 1 1 8 0l-1 2H9z"/>',
  check: '<path d="m4 12 5 5L20 6"/>', grid: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M12 4v16M6 9h2m8 6h2"/>',
  eye: '<path d="M2 12s4-6 10-6 10 6 10 6-4 6-10 6S2 12 2 12z"/><circle cx="12" cy="12" r="2.3"/>',
  plus: '<path d="M12 4v16M4 12h16"/>'
};
const icon = name => '<svg class="tr-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + actions[name] + '</svg>';
const action = (key, label, cls = '', graphic = '', attrs = '') => '<button type="button" data-tr="' + key + '" class="tr-btn ' + cls + '" ' + attrs + '>' + (graphic ? icon(graphic) : '') + e(label) + '</button>';
const byRole = role => String(role || '').trim().toUpperCase();
const grade = answer => answer?.correct ? (answer.hinted ? 'assisted' : 'independent') : answer ? 'miss' : 'unseen';
const stamp = (answer) => '<span class="tr-stamp tr-' + grade(answer) + '">' + e(tt(trainingResult(answer))) + '</span>';

function scoutArt() {
  return '<svg class="tr-art" viewBox="0 0 240 130" fill="none" aria-hidden="true"><g stroke="currentColor" opacity=".25"><path d="M16 111h213M31 82h184M52 57h144M69 35h111M82 17h85M24 117l67-106m113 106-44-106M67 117l42-106m56 106-18-106" stroke-dasharray="4 5"/></g><g stroke="currentColor" stroke-width="1.8"><path d="M74 79l28-24V34m-22 43h62l17-15" opacity=".65"/><circle cx="75" cy="79" r="5"/><circle cx="96" cy="79" r="5"/><rect x="111" y="74" width="10" height="10" rx="1"/><circle cx="136" cy="79" r="5"/><circle cx="156" cy="79" r="5"/><path d="m77 53 6 6m0-6-6 6m55-16 6 6m0-6-6 6m30 11 6 6m0-6-6 6"/></g></svg>';
}

export function createTrainingView({ root, getData, getUserScope = () => 'guest', canEdit = () => false, onBack, onAuthor }) {
  const win = root.ownerDocument.defaultView;
  const progress = trainingProgress(getUserScope, () => win.localStorage);
  const getScope = () => JSON.stringify(getUserScope());
  let scope, role = '', entries = [], coachItems = [], round = [], index = 0, results = [], active, field, raf = 0;
  let screen = 'library', mode = 'field', usedModes, selected, hinted, answer, time, preference = 'pov';
  const find = selector => root.querySelector(selector);
  const focusTitle = () => { find('h1')?.focus({ preventScroll: true }); root.scrollIntoView?.({ block: 'start' }); };
  const titleOf = item => item.drill.title || tt('neutralName');
  const visible = () => entries.filter(entry => !role || byRole(entry.drill.role) === role);

  function collect() {
    const demo = trainingDemo(getLocale());
    const data = getData() || {};
    const sourceRows = (source, book) => (book.drills || []).map(drill => ({
      key: JSON.stringify([source, drill.id]), source, drill, plays: book.plays || [], status: drillStatus(drill, book.plays || [])
    }));
    coachItems = sourceRows('team', data);
    entries = [...coachItems, ...sourceRows('demo', demo)].filter(item => item.status === 'published');
  }

  function release() {
    win.cancelAnimationFrame(raf);
    raf = 0;
    field?.destroy();
    field = null;
  }

  function recordCard(item) {
    const history = progress.read(item.source, item.drill);
    if (!history.attempts) return '';
    const first = Object.values(history.first).filter(item => item && modeKey[item.view]);
    return '<details class="tr-record"><summary>' + e(tt('viewHist')) + ' · ' + e(tt('attempted', { n: history.attempts })) + '</summary>' +
      first.map(item => '<p>' + e(tt(modeKey[item.view])) + ' · ' + e(tt(trainingResult(item))) + '</p>').join('') + '</details>';
  }

  function entryCard(item, i) {
    const history = progress.read(item.source, item.drill);
    return '<article class="tr-card"><div class="tr-card-top"><span class="tr-number" aria-hidden="true">' + String(i + 1).padStart(2, '0') + '</span>' +
      '<span class="tr-role">' + e(item.drill.role) + '</span></div><h3>' + e(titleOf(item)) + '</h3>' +
      '<div class="tr-card-meta">' + stamp(history.last) + '</div>' + recordCard(item) +
      action('start', tt(history.attempts ? 'retry' : 'start'), 'tr-link', 'play', 'data-key="' + e(item.key) + '"') + '</article>';
  }

  function showLibrary() {
    release();
    active = null;
    screen = 'library';
    collect();
    const filtered = visible();
    const roles = new Set(['QB', 'RB', 'WR', 'TE', 'OL', 'DL', 'LB', 'CB', 'S', ...entries.map(entry => byRole(entry.drill.role)), ...(getData()?.roster || []).map(player => byRole(player.position)), role].filter(Boolean));
    const totals = filtered.map(item => progress.read(item.source, item.drill).last);
    const done = totals.filter(Boolean).length;
    const sets = ['team', 'demo'].map(source => {
      const group = filtered.filter(item => item.source === source);
      return group.length ? '<section class="tr-set"><div class="tr-section-line"><h2>' + e(tt(source === 'demo' ? 'demoDrills' : 'coachDrills')) + '</h2><span>' +
        e(tt('reps', { n: group.length })) + '</span></div><div class="tr-cards">' + group.map(entryCard).join('') + '</div></section>' : '';
    }).join('');
    const team = canEdit() && onAuthor ? '<section class="tr-coach"><div class="tr-section-line"><h2>' + e(tt('editDrills')) + '</h2>' +
      action('author', tt('author'), 'tr-ghost', 'plus') + '</div>' +
      coachItems.map(item => '<div class="tr-coach-row"><span>' + e(item.drill.title) + '</span><small>' + e(tt(item.status)) + '</small>' +
        action('author', tt('edit'), 'tr-quiet', '', 'data-id="' + e(item.drill.id) + '"') + '</div>').join('') + '</section>' : '';
    root.innerHTML = '<main class="tr-page"><nav class="tr-crumb">' + action('home', tt('back'), 'tr-quiet', 'back', onBack ? '' : 'data-cloud-action="home"') + '</nav>' +
      '<header class="tr-hero"><div><span class="tr-eyebrow">PLAYBOOK STUDIO / TRAINING</span><h1 tabindex="-1">' + e(tt('title')) +
      '</h1><p>' + e(tt('subtitle')) + '</p></div>' + scoutArt() + '</header><div class="tr-filter"><label>' + e(tt('role')) +
      '<select data-tr-role><option value="">' + e(tt('allRoles')) + '</option>' + [...roles].map(value => '<option ' + (value === role ? 'selected ' : '') + 'value="' +
        e(value) + '">' + e(value) + '</option>').join('') + '</select></label><span class="tr-progress-tag">' + e(tt('completed')) + ' <b>' + done + ' / ' + totals.length +
      '</b></span>' + (filtered.length > 1 ? action('start-set', tt('startGroup', { n: filtered.length }), 'tr-primary', 'play') : '') + '</div>' +
      (sets || '<div class="tr-empty">' + icon('grid') + '<p>' + e(tt('empty')) + '</p>' + action('all', tt('allAgain'), 'tr-ghost') + '</div>') +
      '<p class="tr-note">' + e(tt(progress.isPersistent() ? 'libraryNotes' : 'storageOff')) + '</p>' + team + '</main>';
  }

  function syncField() {
    if (!field || !active) return;
    field.setState({ mode, time, selectedIds: [...selected], correctIds: answer ? feedbackTargets(active.drill, [...selected]) : [], revealed: !!answer, picking: !answer });
  }

  function updateView() {
    if (!active || !find('[data-tr-mode]')) return;
    for (const button of root.querySelectorAll('[data-tr-mode]')) {
      button.setAttribute('aria-pressed', String(button.dataset.trMode === mode));
      if (button.dataset.trMode === 'pov') button.disabled = !field?.supportsPOV;
    }
    find('[data-tr="reset"]').hidden = mode !== 'pov';
    const numbered = find('.tr-numbered');
    if (numbered) numbered.hidden = mode !== 'field';
    find('.tr-field-help').textContent = answer ? tt('reviewHelp') : tt(mode === 'pov' ? 'povHelp' : 'fieldHelp') + (!field?.supportsPOV ? ' ' + tt('fieldOnly') : '');
  }

  function chipCount() {
    if (!active || answer) return;
    const total = active.drill.targetIds.length;
    find('.tr-count').textContent = tt('counter', { n: selected.size, total });
    find('[data-tr="clear"]').disabled = !selected.size;
    find('[data-tr="submit"]').disabled = selected.size !== total;
    for (const marker of root.querySelectorAll('[data-tr="number"]')) {
      marker.setAttribute('aria-pressed', String(selected.has(marker.dataset.markerId)));
    }
  }

  function pick(id) {
    if (answer || !active || !active.play.players.some(player => player.id === id)) return;
    const notice = find('.tr-pick-notice');
    if (selected.has(id)) selected.delete(id);
    else if (selected.size < active.drill.targetIds.length) selected.add(id);
    else { notice.textContent = tt('pickLimit'); return; }
    notice.textContent = '';
    chipCount();
    syncField();
  }

  function numberPicker() {
    const camera = active.play.players.find(player => player.id === active.drill.cameraId);
    const eligible = active.play.players.filter(player => player.side !== camera.side);
    const side = tt(camera.side === 'offense' ? 'defense' : 'offense');
    return '<details class="tr-numbered" hidden><summary>' + e(tt('pickNumber')) + '</summary><div>' +
      eligible.map((player, index) => action('number', String(index+1), '', '', 'data-marker-id="' + e(player.id) +
        '" aria-pressed="false" aria-label="' + e(side + ' · ' + tt('pickMark') + ' ' + (index+1)) + '"')).join('') +
      '</div></details>';
  }

  function questionPanel() {
    const d = active.drill;
    if (!answer) return '<div class="tr-instructions"><span class="tr-eyebrow">' + e(tt('roundNote')) + '</span><h2>' + e(tt('target', { n: d.targetIds.length })) + '</h2>' +
      '<div class="tr-selection"><b class="tr-count" aria-live="polite"></b>' + action('clear', tt('clear'), 'tr-quiet', '', 'aria-label="' + e(tt('cleanup')) + '"') +
      '</div><span class="tr-pick-notice" role="status"></span>' + numberPicker() +
      (d.hint ? action('hint', tt('giveHint'), 'tr-ghost', 'hint', 'aria-expanded="false" aria-controls="tr-hint"') + '<p id="tr-hint" class="tr-hint" hidden></p>' : '') +
      action('submit', tt('submit'), 'tr-primary', 'check', 'disabled') + '</div>';
    const labelIds = ids => ids.map(id => {
      const player = active.play.players.find(marker => marker.id === id);
      const sidePlayers = active.play.players.filter(marker => marker.side === player.side);
      const number = sidePlayers.findIndex(marker => marker.id === id) + 1;
      return player.label + ' · ' + tt('pickMark') + ' ' + number;
    }).join(' / ') || tt('none');
    const targets = feedbackTargets(d, [...selected]);
    const detail = (name, list) => '<div><dt>' + e(tt(name)) + '</dt><dd>' + e(labelIds(list)) + '</dd></div>';
    return '<div class="tr-instructions"><span class="tr-eyebrow">' + e(tt('report')) + '</span><h2 tabindex="-1">' + e(tt(answer.correct ? 'right' : 'wrong')) +
      '</h2>' + stamp(answer) + '<p class="tr-explanation">' + e(d.explanation) + '</p><dl class="tr-answers">' +
      detail(d.alternativeTargetIds?.length ? 'validRead' : 'answer', targets) + detail('yourPicks', [...selected]) +
      (!answer.correct ? detail('missing', targets.filter(id => !selected.has(id))) + detail('extra', [...selected].filter(id => !targets.includes(id))) : '') +
      '</dl><p class="tr-note">' + e(tt('viewIn')) + ' · ' + e(tt(modeKey[answer.view])) + '</p>' +
      action('next', tt(index < round.length - 1 ? 'next' : 'finish'), 'tr-primary', 'arrow') + '</div>';
  }

  function startItem() {
    release();
    const item = round[index], play = trainingScene(item.drill, item.plays);
    if (!play || drillStatus(item.drill, item.plays) !== 'published') {
      showLibrary();
      const note = find('.tr-note');
      note.setAttribute('role', 'status');
      note.textContent = tt('unavailable');
      return;
    }
    active = { ...item, drill: structuredClone(item.drill), play: structuredClone(play) };
    const d = active.drill;
    screen = 'rep'; answer = null; hinted = false; selected = new Set(); usedModes = new Set();
    time = d.freezeAt;
    root.innerHTML = '<main class="tr-page tr-rep"><nav class="tr-crumb">' + action('library', tt('backLibrary'), 'tr-quiet', 'back') +
      '<span>' + e(tt('questionN', { n: index + 1, total: round.length })) + '</span></nav><header class="tr-rep-heading"><div class="tr-overline"><span class="tr-role">' +
      e(d.role) + '</span><span>' + e(tt(d.freezeAt < d.snapAt ? 'pre' : 'atSnap')) + '</span></div><h1 tabindex="-1">' + e(d.question) +
      '</h1></header><div class="tr-arena"><section class="tr-view" aria-label="' + e(tt('scene')) + '"><div class="tr-tools"><div class="tr-mode" role="group" aria-label="' +
      e(tt('view')) + '">' + action('mode', tt('read'), '', 'eye', 'data-tr-mode="pov"') + action('mode', tt('field'), '', 'grid', 'data-tr-mode="field"') +
      '</div>' + action('reset', tt('reset'), 'tr-quiet', 'repeat') + '</div><div class="tr-surface"></div><div class="tr-player-tools"></div><div class="tr-field-footer"><p class="tr-field-help"></p><div class="tr-legend" aria-label="' + e(tt('sceneLegend')) + '"><span>' + e(tt('offense')) + '</span><span>' + e(tt('defense')) + '</span></div></div></section>' +
      '<aside class="tr-aside">' + questionPanel() + '</aside></div></main>';
    field = createTrainingField({ root: find('.tr-surface'), play: active.play, cameraId: d.cameraId, losY: d.losY, direction: d.facing,
      onPick: pick, onModeChange(nextMode) {
        mode = nextMode;
        if (!answer) usedModes.add(nextMode);
        updateView();
      } });
    mode = field.supportsPOV ? preference : 'field';
    syncField();
    updateView(); chipCount(); focusTitle();
  }

  function updateTime() {
    const slider = find('[data-tr-time]');
    if (!slider) return;
    slider.value = String(time);
    find('.tr-clock').textContent = time.toFixed(1) + 's';
    find('[data-tr="replay"]').textContent = tt(raf ? 'pause' : time >= active.drill.replayUntil ? 'again' : 'replay');
  }

  function stopReplay() {
    win.cancelAnimationFrame(raf); raf = 0; updateTime();
  }

  function replay() {
    if (!answer || !active) return;
    if (raf) { stopReplay(); return; }
    const d = active.drill;
    if (time >= d.replayUntil) time = d.freezeAt;
    const begin = win.performance.now(), start = time;
    function step(now) {
      time = Math.min(d.replayUntil, start + (now - begin) / 1000);
      raf = time < d.replayUntil ? win.requestAnimationFrame(step) : 0;
      syncField(); updateTime();
    }
    raf = win.requestAnimationFrame(step); updateTime();
  }

  function submit() {
    if (!active || answer || selected.size !== active.drill.targetIds.length) return;
    const d = active.drill;
    answer = { ids: [...selected], correct: correctSelection(d, [...selected]), hinted, view: usedModes.size > 1 ? 'mixed' : ([...usedModes][0] || mode) };
    progress.record(active.source, d, answer); results[index] = answer;
    find('.tr-aside').innerHTML = questionPanel();
    find('.tr-player-tools').innerHTML = action('replay', tt('replay'), 'tr-ghost', 'play') +
      '<label class="tr-timeline"><span>' + e(tt('scrub')) + '</span><input data-tr-time type="range" min="' + Number(d.freezeAt) +
      '" max="' + Number(d.replayUntil) + '" step=".02" value="' + Number(d.freezeAt) + '"></label><output class="tr-clock"></output>';
    syncField(); updateView(); updateTime();
    find('.tr-instructions h2').focus({ preventScroll: true });
  }

  function summary() {
    release(); active = null; screen = 'summary';
    const grouped = ['okResult', 'correctHinted', 'wrongResult'];
    root.innerHTML = '<main class="tr-page"><nav class="tr-crumb">' + action('library', tt('backLibrary'), 'tr-quiet', 'back') + '</nav><header class="tr-hero"><div><span class="tr-eyebrow">PLAYBOOK STUDIO / REVIEW</span><h1 tabindex="-1">' +
      e(tt('resultTitle')) + '</h1><p>' + e(tt('resultIntro')) + '</p></div>' + icon('film') + '</header><div class="tr-totals">' +
      grouped.map(key => '<div><b>' + results.filter(answer => trainingResult(answer) === key).length + '</b><span>' + e(tt(key)) + '</span></div>').join('') + '</div><section class="tr-summary"><h2>' + e(tt('roundNote')) + '</h2>' +
      round.map((item, n) => '<article><span>' + String(n + 1).padStart(2, '0') + '</span><div><h3>' + e(titleOf(item)) + '</h3><small>' + e(tt(modeKey[results[n].view])) + '</small></div>' + stamp(results[n]) + '</article>').join('') +
      '</section><div class="tr-summary-actions">' + (results.some(answer => !answer.correct || answer.hinted) ? action('retry-misses', tt('reviewAgain'), 'tr-primary', 'repeat') : '') +
      action('library', tt('backLibrary'), 'tr-ghost', 'back') + '</div><p class="tr-note">' + e(tt(progress.isPersistent() ? 'saved' : 'storageOff')) + '</p></main>';
    focusTitle();
  }

  function begin(items) {
    if (!items.length) return;
    round = items; index = 0; results = [];
    startItem();
  }

  function click(event) {
    const button = event.target.closest('[data-tr]');
    if (!button || button.disabled) return;
    if (getScope() !== scope) { open(); return; }
    switch (button.dataset.tr) {
      case 'home':
        if (onBack) onBack();
        break;
      case 'library': showLibrary(); focusTitle(); break;
      case 'all': role = ''; showLibrary(); find('[data-tr-role]')?.focus(); break;
      case 'start': begin(entries.filter(item => item.key === button.dataset.key)); break;
      case 'start-set': begin(visible()); break;
      case 'author': if (canEdit()) onAuthor?.(button.dataset.id ? { drillId: button.dataset.id } : {}); break;
      case 'reset': field?.resetLook(); break;
      case 'number': if (mode === 'field') pick(button.dataset.markerId); break;
      case 'mode':
        preference = button.dataset.trMode; mode = preference; syncField();
        updateView(); break;
      case 'clear':
        selected.clear(); find('.tr-pick-notice').textContent = ''; chipCount(); syncField(); break;
      case 'hint': {
        const hint = find('#tr-hint');
        hinted = true; hint.hidden = !hint.hidden; hint.textContent = active.drill.hint;
        button.setAttribute('aria-expanded', String(!hint.hidden)); break;
      }
      case 'submit': submit(); break;
      case 'replay': replay(); break;
      case 'next': if (index < round.length - 1) { index++; startItem(); } else summary(); break;
      case 'retry-misses': begin(round.filter((item, n) => !results[n].correct || results[n].hinted)); break;
    }
  }

  function change(event) {
    if (event.target.matches('[data-tr-role]')) {
      role = event.target.value; showLibrary(); find('[data-tr-role]').focus();
    }
  }
  function input(event) {
    if (event.target.matches('[data-tr-time]') && answer) {
      const requested = Number(event.target.value); stopReplay(); time = requested; syncField(); updateTime();
    }
  }

  root.addEventListener('click', click);
  root.addEventListener('input', input);
  root.addEventListener('change', change);
  function open(options = {}) {
    scope = getScope(); role = byRole(options.role);
    root.hidden = false; showLibrary(); focusTitle();
  }
  function close() {
    release(); active = null; round = []; results = []; root.hidden = true; root.replaceChildren();
  }
  function refresh() {
    if (root.hidden) return;
    if (getScope() !== scope) open();
    else if (screen === 'library') showLibrary();
  }
  function destroy() {
    close();
    root.removeEventListener('click', click); root.removeEventListener('change', change); root.removeEventListener('input', input);
  }
  return { open, close, show(visible) { if (visible) { if (root.hidden || !root.firstElementChild) open(); else refresh(); } else close(); }, refresh, destroy };
}
