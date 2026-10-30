import { t } from './i18n.js';
import { reconcileHTML } from './reconcile.js';
import { escapeHTML as e } from './model.js';
import { filterCatalog, MADDEN_DRAG_TYPE, hasEditableTrace, editableTraceCount, retainedReason } from './madden-model.js';

export function createMaddenLibrary({ canEdit, getPlays, onImport, notify }) {
  let root, catalog, loading, opened = false, failure = '', team = 'eagles', group = '', formation = '', query = '', page = 1, preview = null, returnFocus;
  let result = null, editableOnly = true;
  const pageSize = 30;
  const imported = () => new Set(getPlays().map(p => p.diagramSource?.catalogId || (p.reference && !hasEditableTrace(p.reference.catalogId) ? p.reference.catalogId : null)).filter(Boolean));
  const entry = id => catalog?.plays.find(p => p.id === id);
  const options = (values, selected) => values.map(v => `<option value="${e(v)}" ${v === selected ? 'selected' : ''}>${e(v)}</option>`).join('');
  function attach() {
    root = document.querySelector('#madden-root');
    root.addEventListener('click', event => {
      const b = event.target.closest('[data-madden]'); if (!b || b.disabled) return;
      const action = b.dataset.madden, id = b.dataset.id;
      if (action === 'close') close();
      if (action === 'undo-result' && result?.canUndo?.()) { result.undo(); result = { message: (t("extra.importUndoneThePlayCountHasBeen")), type: 'info' }; render(); root.querySelector('.madden-result-message')?.focus(); }
      if (action === 'view-result' && result?.view) { const view = result.view; close(); view(); }
      if (action === 'retry') { loading = null; load(); }
      if (action === 'team') { team = id; group = ''; formation = ''; page = 1; preview = null; render(); }
      if (action === 'preview') { preview = id; render(); root.querySelector('[data-madden="back"]')?.focus(); }
      if (action === 'back') { const prior = preview; preview = null; render(); root.querySelector(`[data-madden="preview"][data-id="${prior}"]`)?.focus(); }
      if (action === 'add') add(id);
      if (action === 'clear') { group = ''; formation = ''; query = ''; page = 1; render(); }
      if (action === 'prev' || action === 'next') { page += action === 'next' ? 1 : -1; render(); root.querySelector('.madden-results')?.scrollTo?.(0, 0); root.querySelector(`[data-madden="${action}"]:not(:disabled)`)?.focus(); if (!root.contains(document.activeElement) || document.activeElement.disabled) root.querySelector('.madden-pagination button:not(:disabled)')?.focus(); }
    });
    root.addEventListener('input', event => {
      if (event.target.id !== 'madden-search') return;
      query = event.target.value; page = 1; renderResults();
    });
    root.addEventListener('change', event => {
      if (event.target.id === 'madden-editable-only') { editableOnly = event.target.checked; page = 1; render(); return; }
      if (event.target.id === 'madden-group') { group = event.target.value; formation = ''; }
      else if (event.target.id === 'madden-formation') formation = event.target.value;
      else return;
      page = 1; render();
    });
    root.addEventListener('dragstart', event => {
      const card = event.target.closest('[data-madden-card]');
      if (!card || !canEdit() || imported().has(card.dataset.maddenCard)) { event.preventDefault(); return; }
      event.dataTransfer.setData(MADDEN_DRAG_TYPE, card.dataset.maddenCard);
      event.dataTransfer.effectAllowed = 'copy';
      document.body.classList.add('madden-dragging');
    });
    document.addEventListener('dragend', clearDrag);
    document.addEventListener('dragover', event => {
      if (!event.dataTransfer?.types.includes(MADDEN_DRAG_TYPE)) return;
      const target = event.target.closest('[data-madden-drop]');
      document.querySelectorAll('.madden-drop-hover').forEach(n => n.classList.toggle('madden-drop-hover', n === target));
      if (target && canEdit()) { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; target.classList.add('madden-drop-hover'); }
    });
    document.addEventListener('drop', event => {
      if (!event.dataTransfer?.types.includes(MADDEN_DRAG_TYPE)) return;
      event.preventDefault();
      const target = event.target.closest('[data-madden-drop]'), id = event.dataTransfer.getData(MADDEN_DRAG_TYPE);
      clearDrag(); if (target) add(id);
    });
    root.addEventListener('keydown', event => {
      // Keep editor shortcuts from operating on the play behind the library.
      event.stopPropagation();
      if (event.key === 'Escape') { if (preview) { const prior = preview; preview = null; render(); root.querySelector(`[data-madden="preview"][data-id="${prior}"]`)?.focus(); } else close(); }
    });
  }
  function clearDrag() { document.body.classList.remove('madden-dragging'); document.querySelectorAll('.madden-drop-hover').forEach(n => n.classList.remove('madden-drop-hover')); }
  function add(id) {
    const play = entry(id);
    if (!play || !canEdit() || imported().has(id)) {
      result = { type: 'warning', message: !play ? (t("extra.thisPlayIsNotInTheCurrent")) : !canEdit() ? (t("extra.youHaveReadOnlyAccessAndCannot")) : (t("extra.thisPlayIsAlreadyInYourPlaybook")) };
    } else {
      const outcome = onImport(play);
      result = outcome?.ok ? { ...outcome, type: 'success', message: `${t("extra.added")} ${play.name}${hasEditableTrace(play.id) ? (" · " + t("extra.editable")) : (" · " + t("extra.imageOnly"))}` } : { type: 'error', message: outcome?.message || (t("extra.couldNotAddPlayPleaseTryAgain")) };
    }
    render();
    const card = root.querySelector(`[data-madden-card="${id}"]`);
    if (result.type === 'success') { card?.classList.add('just-added'); setTimeout(() => card?.classList.remove('just-added'), 650); }
    root.querySelector('.madden-result-message')?.focus({ preventScroll: true });
  }
  async function load() {
    failure = ''; render();
    if (!loading) loading = fetch(new URL('./data/huddle-catalog.json', import.meta.url)).then(r => { if (!r.ok) throw new Error('load'); return r.json(); }).then(data => { if (data.schemaVersion !== 1 || !data.plays?.length || data.teams?.length !== 2) throw new Error('invalid'); catalog = data; }).catch(() => { failure = (t("extra.couldNotLoadTheCatalogPleaseTry")); loading = null; }).finally(render);
    await loading;
  }
  function renderResults() {
    const results = root?.querySelector('.madden-results'); if (!results || !catalog) return;
    const matches = filterCatalog(catalog, { team, group, formation, query, editableOnly }), added = imported();
    const totalPages = Math.max(1, Math.ceil(matches.length / pageSize)); page = Math.max(1, Math.min(page, totalPages));
    root.querySelector('#madden-count').textContent = t(editableOnly ? 'extra.editablePlayCount' : 'extra.playCount', { count: matches.length });
    reconcileHTML(results, matches.length ? `<div class="madden-cards">${matches.slice((page - 1) * pageSize, page * pageSize).map(p => `<article class="madden-card ${added.has(p.id) ? 'is-imported' : ''}" data-madden-card="${e(p.id)}" draggable="${canEdit() && !added.has(p.id)}"><button class="madden-art" data-madden="preview" data-id="${e(p.id)}" aria-label="${t("extra.preview")}${e(p.name)}"><img src="./${e(p.image)}" alt="${e(p.name)} · ${e(p.group)} ${e(p.formation)} ${t("extra.playDiagram")}" loading="lazy" draggable="false"><span class="madden-art-hint">${t("extra.clickToEnlarge")}</span></button><div class="madden-card-body"><small>${hasEditableTrace(p.id) ? ("✦ " + t("extra.editable") + " · ") : (t("extra.originalImage2") + " · ")}${e(p.group)} / ${e(p.formation)}</small><h3>${e(p.name)}</h3><div class="madden-card-foot"><span>${added.has(p.id) ? ("✓ " + t("extra.alreadyInPlaybook")) : ("⠿ " + t("extra.dragToPlaybook"))}</span><button data-madden="add" data-id="${e(p.id)}" aria-label="${t("extra.add")}${e(p.name)}" ${!canEdit() || added.has(p.id) ? 'disabled' : ''}>${added.has(p.id) ? (t("extra.added")) : hasEditableTrace(p.id) ? ("＋ " + t("extra.addEditablePlay2")) : ("＋ " + t("extra.addOriginalImage"))}</button></div></div></article>`).join('')}</div><nav class="madden-pagination" aria-label="${t("extra.playPagination")}"><button data-madden="prev" ${page === 1 ? 'disabled' : ''}>← ${t("extra.previous")}</button><span>${page} / ${totalPages}</span><button data-madden="next" ${page === totalPages ? 'disabled' : ''}>${t("extra.next")} →</button></nav>` : ("<div class=\"madden-empty\"><strong>" + t("extra.noMatchingPlays") + "</strong><p>" + t("extra.tryAnEnglishPlayNameSuchAs") + "</p><button data-madden=\"clear\">" + t("extra.clearFilters") + "</button></div>"));
  }
  function render() {
    if (!root || !opened) return;
    const scrollTop = root.querySelector('.madden-results')?.scrollTop || 0;
    const selectedTeam = catalog?.teams.find(t => t.id === team);
    const allTeamPlays = catalog?.plays.filter(p => p.team === team) || [];
    const groups = [...new Set(allTeamPlays.map(p => p.group))];
    const formations = [...new Set(allTeamPlays.filter(p => !group || p.group === group).map(p => `${p.group} ${p.formation}`))];
    root.hidden = false;
    reconcileHTML(root, `<section class="madden-panel" aria-label="Madden NFL ${t("extra.playLibrary")}"><header class="madden-header"><div><small>PLAYBOOK COLLECTION / ${e(selectedTeam?.game || 'MADDEN NFL')}</small><h2>Madden ${t("extra.playLibrary")} <span>${t("extra.offense")}</span></h2></div><button class="madden-close" data-madden="close" aria-label="${t("extra.closeMaddenPlayLibrary")}">✕</button></header><div class="madden-team-tabs" role="group" aria-label="${t("extra.chooseTeam")}">${[['eagles','PHI','Eagles','Philadelphia'],['ravens','BAL','Ravens','Baltimore']].map(([id,code,name,city]) => `<button class="madden-team ${id === team ? 'active' : ''}" data-madden="team" data-id="${id}" aria-pressed="${id === team}"><span class="madden-team-code ${id}">${code}</span><span><strong>${name}</strong><small>${city}</small></span><em>${catalog?.teams.find(t => t.id === id)?.playCount ?? '—'}</em></button>`).join('')}</div>${catalog ? `<div class="madden-filterbar"><input id="madden-search" type="search" value="${e(query)}" aria-label="${t("extra.searchMaddenPlays")}" placeholder="${t("extra.searchPlaysOrFormationsInsideZoneMesh")}"><div><select id="madden-group" aria-label="${t("extra.maddenFormationGroup")}"><option value="">${t("extra.allFormationGroups")}</option>${options(groups, group)}</select><select id="madden-formation" aria-label="${t("extra.maddenFormation")}"><option value="">${t("extra.allFormations")}</option>${options(formations, formation)}</select></div></div><label class="madden-editable-filter"><input id="madden-editable-only" type="checkbox" ${editableOnly ? 'checked' : ''}>${t("extra.editableFilterCount", { count: editableTraceCount })}</label><div class="madden-result-heading"><strong id="madden-count"></strong><span>${canEdit() ? (t("extra.dragToTheOffensePlaybookOrSelect")) : (t("extra.readOnlyBrowseAndPreview"))}</span></div><div class="madden-results"></div><footer class="madden-footer"><span>${editableOnly ? (t("extra.editableReconstructions")) : t('extra.recordedEditableCount', { count: editableTraceCount })} · ${e(selectedTeam.game)} · ${catalog.fetchedAt.slice(0,10)}</span><a href="${e(selectedTeam.sourceUrl)}" target="_blank" rel="noopener noreferrer">${t("extra.sourceHuddleGg")}</a></footer>` : `<div class="madden-empty" role="status">${failure ? `${e(failure)}<button data-madden="retry">${t("extra.tryAgain")}</button>` : (t("extra.loadingTeamPlaybooks"))}</div>`}<div class="madden-detail-slot"></div><div class="madden-result-bar" hidden></div></section>`);
    renderResults();
    const results = root.querySelector('.madden-results'); if (results) results.scrollTop = scrollTop;
    if (!preview) root.querySelector('.madden-detail-slot').replaceChildren();
    if (preview && entry(preview)) {
      const p = entry(preview), added = imported().has(p.id);
      reconcileHTML(root.querySelector('.madden-detail-slot'), `<div class="madden-detail"><button data-madden="back" class="madden-back">← ${t("extra.backToPlayLibrary")}</button><small>${e(p.game)} · ${e(p.team === 'eagles' ? 'Eagles' : 'Ravens')}</small><h2>${e(p.name)}</h2><p>${e(p.group)} / ${e(p.formation)}</p><img src="./${e(p.image)}" alt="${e(p.name)} ${t("extra.originalPlayDiagram")}"><p class="madden-reference-note">${hasEditableTrace(p.id) ? (t("extra.playerPositionsAndVisibleRoutesWereReconstructed")) : `${t("extra.originalImage")}${e(t('extra.reason.' + retainedReason(p.id)))}。${t("extra.youCanAddAnnotateExportAndPrint")}`}</p><button class="button primary" data-madden="add" data-id="${e(p.id)}" ${!canEdit() || added ? 'disabled' : ''}>${added ? ("✓ " + t("extra.alreadyInThisPlaybook")) : hasEditableTrace(p.id) ? ("＋ " + t("extra.addEditablePlay")) : ("＋ " + t("extra.addOriginalImage2"))}</button><a href="${e(p.sourceUrl)}" target="_blank" rel="noopener noreferrer">${t("extra.viewOriginalOnHuddleGg")}</a></div>`);
    }
    const bar = root.querySelector('.madden-result-bar');
    bar.hidden = !result;
    if (result) reconcileHTML(bar, `<span class="madden-result-message" tabindex="-1" role="${result.type === 'error' ? 'alert' : 'status'}">${e(result.message)}</span>${result.canUndo?.() ? ("<button data-madden=\"undo-result\">" + t("extra.undo") + "</button>") : ''}${result.view ? ("<button data-madden=\"view-result\">" + t("extra.view") + "</button>") : ''}`);
    if (result) bar.dataset.type = result.type;
  }
  async function open() { if (!root) attach(); opened = true; result = null; returnFocus = document.activeElement; document.body.classList.add('madden-open'); render(); root.querySelector('[data-madden="close"]')?.focus(); if (!catalog) await load(); }
  function close() { opened = false; preview = null; if (root) { root.hidden = true; root.innerHTML = ''; } document.body.classList.remove('madden-open'); clearDrag(); if (returnFocus?.isConnected && !returnFocus.closest('[inert]')) returnFocus.focus(); else document.querySelector('.topbar [data-action="madden-library"]')?.focus(); }
  return { open, close, refresh: render, get isOpen() { return opened; } };
}
