import { t, getLocale } from './i18n.js';
import { maddenLoadingCopy } from './locales/madden-loading.js';
import { maddenWorkflowCopy } from './locales/madden-workflow.js';
import { loadMaddenCatalog } from './madden-catalog.js';
import { reconcileHTML } from './reconcile.js';
import { escapeHTML as e } from './model.js';
import { filterCatalog, MADDEN_DRAG_TYPE, hasEditableTrace, retainedReason, teamDisplayName } from './madden-model.js';

const TEAM_CODES = {
  eagles: 'PHI',
  ravens: 'BAL',
  '49ers': 'SF',
  bengals: 'CIN',
  bills: 'BUF',
  chiefs: 'KC',
  cowboys: 'DAL',
  dolphins: 'MIA',
  lions: 'DET',
  packers: 'GB',
  rams: 'LAR',
  seahawks: 'SEA',
  texans: 'HOU',
};

const SEARCH_ICON = '<svg class="madden-input-icon" viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="7" cy="7" r="4.5"/><path d="M10.5 10.5 14 14"/></svg>';

export function createMaddenLibrary({ canEdit, getPlays, onImport }) {
  let root, catalog, loading, opened = false, failure = '', team = 'eagles', group = '', formation = '', query = '', page = 1, preview = null, returnFocus;
  let result = null, editableOnly = true, listPanelTop = 0, listScrollTop = 0;
  let scope = 'team', teamQuery = '';
  let importing = null, importSession = 0;
  const pageSize = 30;
  const compact = () => window.innerWidth <= 1180 || window.matchMedia?.('(any-pointer: coarse)').matches;
  const focusable = () => [...root.querySelectorAll('button,input,select,a[href],[tabindex]')]
    .filter(node => !node.disabled && node.tabIndex >= 0 && !node.closest('[hidden],[inert]') && (!preview || node.closest('.madden-detail,.madden-result-bar')));
  const imported = () => new Set(getPlays().map(p => p.diagramSource?.catalogId || (p.reference && !hasEditableTrace(p.reference.catalogId) ? p.reference.catalogId : null)).filter(Boolean));
  const entry = id => catalog?.plays.find(p => p.id === id);
  const options = (values, selected) => values.map(v => `<option value="${e(v)}" ${v === selected ? 'selected' : ''}>${e(v)}</option>`).join('');
  const scopedTeam = () => scope === 'all' ? '' : team;
  function syncTeamRailFade() {
    const rail = root?.querySelector('.madden-team-rail');
    const tabs = rail?.querySelector('.madden-team-tabs');
    if (!rail || !tabs) return;
    const atStart = tabs.scrollLeft <= 2;
    const atEnd = tabs.scrollLeft + tabs.clientWidth >= tabs.scrollWidth - 2;
    rail.classList.toggle('has-fade-left', !atStart);
    rail.classList.toggle('has-fade-right', !atEnd);
  }
  function resetListPosition() {
    listPanelTop = 0; listScrollTop = 0;
    for (const node of root?.querySelectorAll('.madden-panel,.madden-results') || []) node.scrollTop = 0;
  }
  function rememberListPosition() {
    if (!root || preview) return;
    listPanelTop = root.querySelector('.madden-panel')?.scrollTop ?? listPanelTop;
    listScrollTop = root.querySelector('.madden-results')?.scrollTop ?? listScrollTop;
  }
  function renderTeamResults() {
    if (!root || !catalog) return;
    const words = teamQuery.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
    let count = 0;
    for (const button of root.querySelectorAll('[data-madden="team"]')) {
      const record = catalog.teams.find(item => item.id === button.dataset.id);
      const text = `${record.id} ${record.code || TEAM_CODES[record.id] || ''} ${record.name} ${record.city || ''}`.toLocaleLowerCase();
      button.hidden = !words.every(word => text.includes(word));
      if (!button.hidden) count++;
    }
    const empty = root.querySelector('.madden-team-empty');
    if (empty) empty.hidden = count > 0;
    syncTeamRailFade();
  }
  function syncViewport() {
    if (!root || !opened) return;
    root.classList.toggle('madden-short', (window.visualViewport?.height || window.innerHeight) < 540);
    const panel = root.querySelector('.madden-panel');
    panel?.setAttribute('aria-modal', String(compact()));
    if (preview && panel) panel.scrollTop = 0;
    syncTeamRailFade();
  }
  function attach() {
    root = document.querySelector('#madden-root');
    window.addEventListener('resize', syncViewport);
    window.visualViewport?.addEventListener('resize', syncViewport);
    root.addEventListener('click', event => {
      const b = event.target.closest('[data-madden]'); if (!b || b.disabled) return;
      const action = b.dataset.madden, id = b.dataset.id;
      if (action === 'close') close();
      if (action === 'undo-result' && result?.canUndo?.()) { result.undo(); result = { message: (t("extra.importUndoneThePlayCountHasBeen")), type: 'info' }; render(); root.querySelector('.madden-result-message')?.focus(); }
      if (action === 'view-result' && result?.view) { const view = result.view; close(); view(); }
      if (action === 'retry') { loading = null; load(); }
      if (action === 'team') { team = id; scope = 'team'; group = ''; formation = ''; page = 1; preview = null; resetListPosition(); render(); }
      if (action === 'scope') { scope = b.dataset.scope === 'all' ? 'all' : 'team'; group = ''; formation = ''; page = 1; resetListPosition(); render(); }
      if (action === 'clear-teams') { teamQuery = ''; render(); root.querySelector('#madden-team-search')?.focus(); }
      if (action === 'preview') { rememberListPosition(); preview = id; render(); root.querySelector('[data-madden="back"]')?.focus({ preventScroll: true }); }
      if ((action === 'preview-prev' || action === 'preview-next') && id) { preview = id; render(); root.querySelector(`[data-madden="${action}"]:not(:disabled)`)?.focus({ preventScroll: true }) || root.querySelector('[data-madden="back"]')?.focus({ preventScroll: true }); }
      if (action === 'back') backToList();
      if (action === 'add') add(id);
      if (action === 'retry-add' && result?.retryId) add(result.retryId);
      if (action === 'clear') { group = ''; formation = ''; query = ''; page = 1; resetListPosition(); render(); }
      if (action === 'prev' || action === 'next') { page += action === 'next' ? 1 : -1; render(); root.querySelector('.madden-results')?.scrollTo?.(0, 0); root.querySelector(`[data-madden="${action}"]:not(:disabled)`)?.focus(); if (!root.contains(document.activeElement) || document.activeElement.disabled) root.querySelector('.madden-pagination button:not(:disabled)')?.focus(); }
    });
    root.addEventListener('wheel', event => {
      const tabs = event.target.closest?.('.madden-team-tabs');
      if (!tabs || tabs.scrollWidth <= tabs.clientWidth) return;
      if (Math.abs(event.deltaY) > Math.abs(event.deltaX)) {
        tabs.scrollLeft += event.deltaY;
        event.preventDefault();
        syncTeamRailFade();
      }
    }, { passive: false });
    root.addEventListener('scroll', event => {
      if (event.target.classList?.contains('madden-team-tabs')) syncTeamRailFade();
    }, true);
    root.addEventListener('input', event => {
      if (event.target.id === 'madden-team-search') { teamQuery = event.target.value; renderTeamResults(); return; }
      if (event.target.id !== 'madden-search') return;
      query = event.target.value; page = 1; resetListPosition(); renderResults();
    });
    root.addEventListener('change', event => {
      if (event.target.id === 'madden-editable-only') { editableOnly = event.target.checked; page = 1; resetListPosition(); render(); return; }
      if (event.target.id === 'madden-group') { group = event.target.value; formation = ''; }
      else if (event.target.id === 'madden-formation') formation = event.target.value;
      else return;
      page = 1; resetListPosition(); render();
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
      if (event.key === 'Tab' && (compact() || preview)) {
        const controls = focusable(), first = controls[0], last = controls.at(-1);
        if (!controls.length) { event.preventDefault(); return; }
        if (event.shiftKey && (document.activeElement === first || !controls.includes(document.activeElement))) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && (document.activeElement === last || !controls.includes(document.activeElement))) { event.preventDefault(); first.focus(); }
      }
      if (preview && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
        const btn = root.querySelector(`[data-madden="${event.key === 'ArrowLeft' ? 'preview-prev' : 'preview-next'}"]:not(:disabled)`);
        if (btn) { event.preventDefault(); btn.click(); }
      }
      if (event.key === 'Escape') { if (preview) backToList(); else close(); }
    });
  }
  function backToList() {
    const prior = preview; preview = null; render();
    const panel = root.querySelector('.madden-panel');
    if (panel) panel.scrollTop = listPanelTop;
    const results = root.querySelector('.madden-results');
    if (results) results.scrollTop = listScrollTop;
    root.querySelector(`[data-madden="preview"][data-id="${prior}"]`)?.focus({ preventScroll: true });
  }
  function clearDrag() { document.body.classList.remove('madden-dragging'); document.querySelectorAll('.madden-drop-hover').forEach(n => n.classList.remove('madden-drop-hover')); }
  async function add(id) {
    if (importing) return;
    const play = entry(id);
    if (!play || !canEdit() || imported().has(id)) {
      result = { type: 'warning', message: !play ? (t("extra.thisPlayIsNotInTheCurrent")) : !canEdit() ? (t("extra.youHaveReadOnlyAccessAndCannot")) : (t("extra.thisPlayIsAlreadyInYourPlaybook")) };
    } else {
      const job = { id, session: importSession, controller: new AbortController() };
      importing = job;
      result = { type: 'info', message: maddenLoadingCopy(getLocale()).loading };
      render();
      try {
        const outcome = await onImport({ ...play, teamName: catalog.teams.find(t => t.id === play.team)?.name }, { signal: job.controller.signal });
        if (importing !== job || job.session !== importSession || !opened) return;
        result = outcome?.ok ? { ...outcome, type: 'success', message: `${t("extra.added")} ${play.name}${hasEditableTrace(play.id) ? (" · " + t("extra.editable")) : (" · " + t("extra.imageOnly"))}` } : { type: outcome?.awaitingUser ? 'info' : 'error', retryId: outcome?.awaitingUser ? null : id, message: outcome?.message || (t("extra.couldNotAddPlayPleaseTryAgain")) };
      } catch {
        if (importing !== job || job.session !== importSession || !opened) return;
        result = { type: 'error', retryId: id, message: maddenLoadingCopy(getLocale()).failed };
      } finally {
        if (importing === job) importing = null;
      }
      if (job.session !== importSession || !opened) return;
    }
    render();
    const card = root.querySelector(`[data-madden-card="${id}"]`);
    if (result.type === 'success') { card?.classList.add('just-added'); setTimeout(() => card?.classList.remove('just-added'), 650); }
    if (root.contains(document.activeElement)) root.querySelector('.madden-result-message')?.focus({ preventScroll: true });
  }
  async function load() {
    failure = ''; render();
    if (!loading) loading = loadMaddenCatalog().then(data => { catalog = data; if (!catalog.teams.some(t => t.id === team)) team = catalog.teams[0].id; }).catch(() => { failure = (t("extra.couldNotLoadTheCatalogPleaseTry")); loading = null; }).finally(render);
    await loading;
  }
  function renderResults() {
    const results = root?.querySelector('.madden-results'); if (!results || !catalog) return;
    const copy = maddenWorkflowCopy(getLocale());
    const matches = filterCatalog(catalog, { team: scopedTeam(), group, formation, query, editableOnly }), added = imported();
    const totalPages = Math.max(1, Math.ceil(matches.length / pageSize)); page = Math.max(1, Math.min(page, totalPages));
    root.querySelector('#madden-count').textContent = t(editableOnly ? 'extra.editablePlayCount' : 'extra.playCount', { count: matches.length });
    reconcileHTML(results, matches.length ? `<div class="madden-cards">${matches.slice((page - 1) * pageSize, page * pageSize).map(p => {
      const isAdded = added.has(p.id);
      const isEditable = hasEditableTrace(p.id);
      const teamPrefix = scope === 'all' ? `${e(teamDisplayName(p.team, catalog.teams.find(item => item.id === p.team)?.name))} · ` : '';
      return `<article class="madden-card ${isAdded ? 'is-imported' : ''}" data-madden-card="${e(p.id)}" draggable="${!importing && canEdit() && !isAdded}"><button class="madden-art" data-madden="preview" data-id="${e(p.id)}" aria-label="${t("extra.preview")}${e(p.name)}"><img src="./${e(p.image)}" alt="${e(p.name)} · ${e(p.group)} ${e(p.formation)} ${t("extra.playDiagram")}" loading="lazy" draggable="false"><span class="madden-card-badge ${isEditable ? 'is-editable' : 'is-original'}">${isEditable ? `✦ ${e(copy.editableBadge)}` : e(copy.originalBadge)}</span><span class="madden-art-hint">${e(copy.enlargeShort)}</span></button><div class="madden-card-body"><small title="${teamPrefix}${e(p.group)} / ${e(p.formation)}">${teamPrefix}${e(p.group)} / ${e(p.formation)}</small><h3 title="${e(p.name)}">${e(p.name)}</h3><div class="madden-card-foot"><span class="madden-card-grip ${isAdded ? 'is-added' : ''}" aria-hidden="true" title="${isAdded ? t("extra.alreadyInPlaybook") : t("extra.dragToPlaybook")}">${isAdded ? '✓' : '⠿'}</span><button data-madden="add" data-id="${e(p.id)}" aria-label="${t("extra.add")}${e(p.name)}" ${importing || !canEdit() || isAdded ? 'disabled' : ''}>${isAdded ? `✓ ${e(copy.addedShort)}` : `+ ${e(copy.addShort)}`}</button></div></div></article>`;
    }).join('')}</div><nav class="madden-pagination" aria-label="${t("extra.playPagination")}"><button data-madden="prev" ${page === 1 ? 'disabled' : ''}>← ${t("extra.previous")}</button><span>${page} / ${totalPages}</span><button data-madden="next" ${page === totalPages ? 'disabled' : ''}>${t("extra.next")} →</button></nav>` : ("<div class=\"madden-empty\"><strong>" + t("extra.noMatchingPlays") + "</strong><p>" + t("extra.tryAnEnglishPlayNameSuchAs") + "</p><button data-madden=\"clear\">" + t("extra.clearFilters") + "</button></div>"));
  }
  function render() {
    if (!root || !opened) return;
    const scrollTop = root.querySelector('.madden-results')?.scrollTop ?? listScrollTop;
    const panelTop = root.querySelector('.madden-panel')?.scrollTop ?? listPanelTop;
    const copy = maddenWorkflowCopy(getLocale());
    const selectedTeam = catalog?.teams.find(t => t.id === team);
    const allTeamPlays = catalog?.plays.filter(p => !scopedTeam() || p.team === scopedTeam()) || [];
    const teamEditableCount = allTeamPlays.filter(p => hasEditableTrace(p.id)).length;
    const groups = [...new Set(allTeamPlays.map(p => p.group))];
    const formations = [...new Set(allTeamPlays.filter(p => !group || p.group === group).map(p => `${p.group} ${p.formation}`))];
    root.hidden = false;
    reconcileHTML(root, `<section class="madden-panel" role="dialog" aria-modal="${compact()}" aria-label="Madden NFL ${t("extra.playLibrary")}"><header class="madden-header"><button class="madden-close" data-madden="close" aria-label="${t("extra.closeMaddenPlayLibrary")}">✕</button><div class="madden-title-group"><h2>Madden ${t("extra.playLibrary")}<span class="madden-offense-tag">${t("extra.offense")}</span></h2><small>${e(selectedTeam?.game || 'Madden 27')}</small></div>${catalog ? `<div class="madden-header-tools"><div class="madden-search-scope" role="group" aria-label="${e(copy.scope)}"><button type="button" data-madden="scope" data-id="scope-team" data-scope="team" aria-pressed="${scope === 'team'}" title="${e(copy.currentTeam)} · ${e(selectedTeam?.name || '')}">${e(copy.currentTeam)}</button><button type="button" data-madden="scope" data-id="scope-all" data-scope="all" aria-pressed="${scope === 'all'}">${e(copy.allTeams)}</button></div><div class="madden-team-picker"><label for="madden-team-search" class="sr-only">${e(copy.teamSearch)}</label>${SEARCH_ICON}<input id="madden-team-search" type="search" value="${e(teamQuery)}" placeholder="${e(copy.teamSearchShort)}" aria-label="${e(copy.teamSearch)}" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" data-lpignore="true" data-1p-ignore name="madden-team-filter"></div></div>` : ''}</header>${catalog ? `<div class="madden-team-rail"><div class="madden-team-tabs" role="group" aria-label="${t("extra.chooseTeam")}">${catalog.teams.map(({ id, code, name, city, playCount }) => `<button type="button" class="madden-team ${id === team && scope === 'team' ? 'active' : ''}" data-madden="team" data-id="${e(id)}" aria-pressed="${id === team && scope === 'team'}" title="${e(name)}${city ? ' · ' + e(city) : ''}"><span class="madden-team-code ${e(id)}" data-team="${e(id)}">${e(code || TEAM_CODES[id] || name.slice(0, 3).toUpperCase())}</span><span class="madden-team-label"><strong>${e(name)}</strong><small class="sr-only">${e(city || '')}</small></span><em>${e(String(playCount ?? '—'))}</em></button>`).join('')}</div><div class="madden-team-empty" hidden>${e(copy.noTeams)} <button type="button" data-madden="clear-teams">${e(copy.clearTeamSearch)}</button></div></div><div class="madden-filterbar"><div class="madden-search-wrap">${SEARCH_ICON}<input id="madden-search" type="search" value="${e(query)}" aria-label="${t("extra.searchMaddenPlays")}" placeholder="${t("extra.searchPlaysOrFormationsInsideZoneMesh")}" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" data-lpignore="true" data-1p-ignore name="madden-play-filter"></div><select id="madden-group" aria-label="${t("extra.maddenFormationGroup")}"><option value="">${t("extra.allFormationGroups")}</option>${options(groups, group)}</select><select id="madden-formation" aria-label="${t("extra.maddenFormation")}"><option value="">${t("extra.allFormations")}</option>${options(formations, formation)}</select><label class="madden-editable-filter"><input id="madden-editable-only" type="checkbox" ${editableOnly ? 'checked' : ''}><span class="madden-editable-text">${e(copy.editableToggle)}</span><em class="madden-editable-count">${teamEditableCount}</em></label></div><div class="madden-result-heading"><div class="madden-status-left"><strong id="madden-count" role="status"></strong><span class="madden-status-dot" aria-hidden="true">·</span><span class="madden-active-scope">${e(copy.searching)} · ${scope === 'all' ? `${e(copy.allTeams)} (${catalog.teams.length})` : e(selectedTeam?.name || '')}</span></div><span class="madden-drag-hint">${canEdit() ? e(copy.dragShort) : (t("extra.readOnlyBrowseAndPreview"))}</span></div><div class="madden-results"></div><footer class="madden-footer"><span>${editableOnly ? (t("extra.editableReconstructions")) : t('extra.recordedEditableCount', { count: teamEditableCount })} · ${scope === 'all' ? `${catalog.teams.length} ${e(copy.teams)}` : e(selectedTeam.game)} · ${catalog.fetchedAt.slice(0, 10)}</span><a href="${e(scope === 'all' ? 'https://huddle.gg/playbooks/' : selectedTeam.sourceUrl)}" target="_blank" rel="noopener noreferrer">${scope === 'all' ? e(copy.source) : t("extra.sourceHuddleGg")}</a></footer>` : `<div class="madden-empty" role="status">${failure ? `${e(failure)}<button data-madden="retry">${t("extra.tryAgain")}</button>` : (t("extra.loadingTeamPlaybooks"))}</div>`}<div class="madden-detail-slot"></div><div class="madden-result-bar" hidden></div></section>`);
    renderTeamResults();
    renderResults();
    if (!preview) { const panel = root.querySelector('.madden-panel'); if (panel) panel.scrollTop = panelTop; }
    const results = root.querySelector('.madden-results'); if (results) results.scrollTop = scrollTop;
    if (!preview) root.querySelector('.madden-detail-slot').replaceChildren();
    if (preview && entry(preview)) {
      const p = entry(preview), added = imported().has(p.id), isEditable = hasEditableTrace(p.id);
      const matches = filterCatalog(catalog, { team: scopedTeam(), group, formation, query, editableOnly });
      const idx = matches.findIndex(item => item.id === p.id);
      const prevPlay = idx > 0 ? matches[idx - 1] : null;
      const nextPlay = idx >= 0 && idx < matches.length - 1 ? matches[idx + 1] : null;
      reconcileHTML(root.querySelector('.madden-detail-slot'), `<div class="madden-detail"><div class="madden-detail-bar"><button type="button" data-madden="back" class="madden-back">← ${t("extra.backToPlayLibrary")}</button><div class="madden-detail-nav">${matches.length > 1 ? `<button type="button" class="madden-detail-step" data-madden="preview-prev" data-id="${e(prevPlay?.id || '')}" aria-label="${e(copy.prevPlay)}" ${prevPlay ? '' : 'disabled'}>‹</button><span class="madden-detail-pos">${idx >= 0 ? `${idx + 1} / ${matches.length}` : ''}</span><button type="button" class="madden-detail-step" data-madden="preview-next" data-id="${e(nextPlay?.id || '')}" aria-label="${e(copy.nextPlay)}" ${nextPlay ? '' : 'disabled'}>›</button>` : ''}<button type="button" class="madden-close" data-madden="close" aria-label="${t("extra.closeMaddenPlayLibrary")}">✕</button></div></div><div class="madden-detail-meta"><div class="madden-detail-kicker"><small>${e(p.game)} · ${e(teamDisplayName(p.team, catalog.teams.find(t => t.id === p.team)?.name))}</small><span class="madden-card-badge ${isEditable ? 'is-editable' : 'is-original'}">${isEditable ? `✦ ${e(copy.editableBadge)}` : e(copy.originalBadge)}</span></div><h2>${e(p.name)}</h2><p class="madden-detail-formation">${e(p.group)} / ${e(p.formation)}</p></div><div class="madden-detail-stage"><img src="./${e(p.image)}" alt="${e(p.name)} ${t("extra.originalPlayDiagram")}"></div><p class="madden-reference-note">${isEditable ? (t("extra.playerPositionsAndVisibleRoutesWereReconstructed")) : `${t("extra.originalImage")}${e(t('extra.reason.' + retainedReason(p.id)))}。${t("extra.youCanAddAnnotateExportAndPrint")}`}</p><button class="button primary madden-detail-cta" data-madden="add" data-id="${e(p.id)}" ${importing || !canEdit() || added ? 'disabled' : ''}>${added ? ("✓ " + t("extra.alreadyInThisPlaybook")) : isEditable ? ("+ " + t("extra.addEditablePlay")) : ("+ " + t("extra.addOriginalImage2"))}</button><a href="${e(p.sourceUrl)}" target="_blank" rel="noopener noreferrer">${t("extra.viewOriginalOnHuddleGg")}</a></div>`);
    }
    const bar = root.querySelector('.madden-result-bar');
    bar.hidden = !result;
    if (result) reconcileHTML(bar, `<span class="madden-result-message" tabindex="-1" role="${result.type === 'error' ? 'alert' : 'status'}">${e(result.message)}</span>${result.retryId ? `<button type="button" data-madden="retry-add">${e(copy.retryAdd)}</button>` : ''}${result.canUndo?.() ? ("<button data-madden=\"undo-result\">" + t("extra.undo") + "</button>") : ''}${result.view ? ("<button data-madden=\"view-result\">" + t("extra.view") + "</button>") : ''}`);
    if (result) bar.dataset.type = result.type;
    // The preview covers the list on every screen size. Hidden list controls
    // must not remain keyboard or screen-reader destinations behind that view.
    for (const child of root.querySelector('.madden-panel')?.children || []) {
      if (!child.matches('.madden-detail-slot,.madden-result-bar')) child.toggleAttribute('inert', !!preview);
    }
    root.querySelector('.madden-panel')?.setAttribute('aria-busy', String(!!importing));
    root.querySelectorAll('[data-madden="add"]').forEach(button => { button.disabled = !!importing || !canEdit() || imported().has(button.dataset.id); });
    root.querySelectorAll('[data-madden-card]').forEach(card => { card.draggable = !importing && canEdit() && !imported().has(card.dataset.maddenCard); });
    syncViewport();
  }
  async function open() { if (!root) attach(); importing?.controller.abort(); importSession++; importing = null; opened = true; result = null; returnFocus = document.activeElement; document.body.classList.add('madden-open'); render(); root.querySelector('[data-madden="close"]')?.focus(); if (!catalog) await load(); }
  function close() { rememberListPosition(); importing?.controller.abort(); importSession++; importing = null; opened = false; preview = null; if (root) { root.hidden = true; root.innerHTML = ''; } document.body.classList.remove('madden-open'); clearDrag(); if (returnFocus?.isConnected && !returnFocus.closest('[inert]')) returnFocus.focus(); else document.querySelector('.topbar [data-action="madden-library"]')?.focus(); }
  return { open, close, refresh: render, get isOpen() { return opened; } };
}
