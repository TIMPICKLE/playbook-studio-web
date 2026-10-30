import { t, getLocale, setLocale } from './i18n.js';
import { createDigitalBoard } from './digital-board.js';
import { composeDigitalExport, pngExportDescription } from './digital-export.js';
import { createMaddenLibrary } from './madden.js';
import { makeMaddenPlay, hasEditableTrace, getEditableEntry, spaceMaddenLine } from './madden-model.js';
import { feedback, feedbackBox } from './ui.js';
import { SharedWorkspace, cloudMode, CLOUD_SITE, request } from './cloud.js';
import { createMatchupView } from './ai-matchup.js';
import { BOOKS, COLORS, FORMATIONS, STORAGE_KEY, clone, uid, clamp, escapeHTML as e, starterWorkspace, makePlay, formationPlayers, mirrorPlay, movePlayer, animatedPlayer, animationLength, encodeWorkspace, decodeWorkspace, History } from './model.js';
import { fieldSVG, updateAnimation, updateGeometry, previewDraft, displayColor } from './field.js';
import { fieldCoordinates } from './field-coordinates.js';
import { enterContext, enterPlayers, revealPlay, enterWorkbench } from './motion.js';
import { effectsControl, initEffects, burstAt } from './effects.js';
import { createBoardLayout, boardSizeControls, boardHeightHandle, boardWidthHandle } from './board-layout.js';
import { initViewportLayout, captureEditorScroll } from './viewport-layout.js';
import { createWorkspacePanels } from './workspace-panels.js';

const $ = selector => document.querySelector(selector);
const icons = {
  plus: '<path d="M12 5v14M5 12h14"/>', search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/>', book: '<path d="M4 4h6a3 3 0 0 1 3 3v14a4 4 0 0 0-4-2H4zM20 4h-4a3 3 0 0 0-3 3M13 21a4 4 0 0 1 4-2h3V4"/>', select: '<path d="m5 3 14 10-7 1-3 7z"/>', route: '<path d="M5 20V7h14m-5-5 5 5-5 5"/>', block: '<path d="M5 20V7h14M19 2v10"/>', motion: '<path d="m4 20 3-5-3-5 3-5h13m-5-4 5 4-5 4"/>', pass: '<path stroke-dasharray="2 4" d="M4 19 19 4"/><path d="M12 4h7v7"/>', zone: '<ellipse cx="12" cy="12" rx="9" ry="7" stroke-dasharray="3 3"/>', text: '<path d="M4 5h16M12 5v15M8 20h8"/>', flip: '<path d="M12 3v18M8 8l-5 4 5 4M16 8l5 4-5 4"/>', undo: '<path d="m8 4-5 5 5 5M3 9h10a7 7 0 0 1 0 14"/>', redo: '<path d="m16 4 5 5-5 5M21 9H11a7 7 0 0 0 0 14"/>', copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V4H4v12h4"/>', export: '<path d="M12 3v12m-5-5 5 5 5-5M4 15v6h16v-6"/>', print: '<path d="M7 7V3h10v4M7 17H3V8h18v9h-4M7 14h10v7H7z"/>', star: '<path d="m12 3 2.8 5.8 6.4.9-4.6 4.5 1.1 6.3-5.7-3-5.7 3 1.1-6.3L3.2 9.7l6.4-.9z"/>', play: '<path d="m8 4 13 8-13 8z"/>', pause: '<path d="M8 4v16M16 4v16"/>', reset: '<path d="M4 8V3m0 5h5M4 8a9 9 0 1 1-1 7"/>', loop: '<path d="m17 2 4 4-4 4M3 10V6h18M7 22l-4-4 4-4M21 14v4H3"/>', trash: '<path d="M4 6h16M9 6V3h6v3M7 6l1 15h8l1-15M10 10v7M14 10v7"/>', close: '<path d="m6 6 12 12M18 6 6 18"/>', chevron: '<path d="m9 5 7 7-7 7"/>', team: '<circle cx="9" cy="7" r="3"/><path d="M3 21v-4a6 6 0 0 1 12 0v4M16 5a3 3 0 0 1 0 6M17 15a5 5 0 0 1 4 6"/>', help: '<circle cx="12" cy="12" r="9"/><path d="M9 8a3 3 0 0 1 6 0c0 3-3 2-3 5M12 17h.01"/>', check: '<path d="m5 12 4 4L19 6"/>', sun: '<circle cx="12" cy="12" r="4"/><path d="M12 1v3M12 20v3M1 12h3M20 12h3M4 4l2 2M18 18l2 2M4 20l2-2M18 6l2-2"/>', grid: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18M15 3v18"/>', save: '<path d="M5 3h13l3 3v15H3V3zM7 3v7h10V3M7 21v-7h10v7"/>', folder: '<path d="M3 6h7l2 3h9v12H3z"/>', menu: '<path d="M4 6h16M4 12h16M4 18h16"/>', ball: '<ellipse cx="12" cy="12" rx="10" ry="6" transform="rotate(-35 12 12)"/><path d="m8 15 8-6M9 11l3 3M12 8l3 3"/>', flag: '<path d="M5 21V3h14l-3 5 3 5H5"/>'
};
const icon = name => `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] || icons.route}</svg>`;
const btn = (action, name, label, cls = '', attrs = '') => `<button type="button" data-action="${action}" class="${cls}" title="${e(label)}" aria-label="${e(label)}" ${attrs}>${icon(name)}</button>`;
const recoveryMessage = t("feedback.local_data_could_not_be_read_editing_and_autosave_are_p");
// Only translate a newly created example. Never rewrite an existing workspace.
function localizedStarterWorkspace() {
  const data = starterWorkspace();
  if (getLocale() !== 'en') return data;
  data.team.name = t('editor.demo_team'); data.team.subtitle = t('editor.demo_season');
  const titles = ['editor.demo_mesh','editor.demo_verticals','editor.demo_flood','editor.demo_slants','editor.demo_inside_zone','editor.demo_cover3','editor.demo_blitz','editor.demo_field_goal'];
  const categories = ['editor.demo_pass','editor.demo_pass','editor.demo_pass','editor.demo_pass','editor.demo_run','editor.demo_zone','editor.demo_blitz_category','editor.demo_fg_category'];
  data.plays.forEach((play, i) => { play.title = t(titles[i]); play.category = t(categories[i]); });
  for (const [i, key] of [[0,'editor.demo_mesh_notes'],[1,'editor.demo_verticals_notes'],[2,'editor.demo_flood_notes'],[5,'editor.demo_cover3_notes']]) data.plays[i].notes = t(key);
  return data;
}
function readLocalWorkspace() {
  let raw = null;
  try { raw = localStorage.getItem(STORAGE_KEY); return { workspace: raw ? decodeWorkspace(raw) : localizedStarterWorkspace(), recovery: null }; }
  catch (error) { return { workspace: starterWorkspace(), recovery: { raw, error } }; }
}
let { workspace, recovery: localRecovery } = cloudMode() ? { workspace: starterWorkspace(), recovery: null } : readLocalWorkspace();
let state = { data: workspace, selectedId: workspace.plays[0].id };
let book = workspace.plays[0].book, query = '', filter = '', formationFilter = '', tool = 'select', selection = null, draft = null, drag = null, playing = false, time = 0, speed = 1, loop = false;
let saveState = localRecovery ? t("editorExtra.recovery_required_autosave_paused") : t('editor.saved_locally'), frame = null, lastFrame = null, toastTimer = null;
const history = new History();
let shared = null, digitalBoard = null;
let pendingNavigation = null, viewOverrides = {}, renderedPlayId = null, gestureFrame = null, pendingPoint = null, previewPoint = null, rehearsal = false;
const drawingTools = ['route','block','motion','pass'];
const boardLayout = createBoardLayout({ notify: message => toast(message), hasDraft: () => !!draft });
const panels = createWorkspacePanels();
const viewSettings = () => ({ ...state.data.settings, ...viewOverrides });
const canEdit = () => cloudMode() ? !!shared?.canEdit : !localRecovery;
const editBlockedMessage = () => localRecovery ? recoveryMessage : shared?.sync?.viewError ? t("feedback.the_play_view_could_not_update_reload_before_editing") : t("feedback.you_have_read_only_access_and_cannot_edit_this_shared_p");
const readActions = new Set(['madden-library','compare-source','choose','book','select-route','clear-selection','sidebar','inspector-panel','panel-field','close-panel','export','print','help','close-modal','download-svg','download-png','download-json','download-play','do-print','play','reset','loop','grid','theme','clear-filters','keep-drawing','edit-mode','rehearse-mode','local-recovery','download-original','retry-local-load','replace-local-workspace','confirm-replace-local-workspace']);
function protectReadOnly() {
  if (canEdit()) return;
  document.querySelectorAll('[data-prop],[data-ball],#apply-formation').forEach(n => { n.disabled = true; });
  document.querySelectorAll('#app [data-action]').forEach(n => { const [action,value]=n.dataset.action.split(':'); if (!readActions.has(action) && !(action==='tool' && value==='select')) n.disabled=true; });
}
const current = () => state.data.plays.find(p => p.id === state.selectedId) || state.data.plays[0];
const filtered = () => state.data.plays.filter(p => p.book === book && (!filter || (filter === 'favorite' ? p.favorite : p.category === filter)) && (!formationFilter || p.formation === formationFilter) && `${p.title} ${p.formation} ${p.category} ${p.notes}`.toLowerCase().includes(query.toLowerCase()));
const selectedObject = () => !selection ? null : current()[{ player: 'players', route: 'routes', zone: 'zones', annotation: 'annotations' }[selection.type]]?.find(x => x.id === selection.id);
const maddenLibrary = createMaddenLibrary({ canEdit, getPlays: () => state.data.plays, notify: toast, onImport(entry) {
  if (!canEdit()) { toast(editBlockedMessage(), { type: 'warning' }); return; }
  if (!confirmDraft(() => importMadden(entry))) return;
  return importMadden(entry);
} });
function importMadden(entry) {
  if (!canEdit()) return;
  if (state.data.plays.some(p => (hasEditableTrace(entry.id) ? p.diagramSource : p.reference)?.catalogId === entry.id)) { toast(t("feedback.this_play_is_already_in_the_current_playbook"), { type: 'success' }); return; }
  if (state.data.plays.length >= 500) return { ok: false, message: t("feedback.a_playbook_can_hold_at_most_500_plays_remove_some_befor") };
  const play = makeMaddenPlay(entry);
  book = 'offense'; filter = ''; formationFilter = ''; query = ''; selection = null; tool = 'select';
  edit((p, data) => { data.plays.push(play); state.selectedId = play.id; });
  const checkpoint = history.past.at(-1);
  return { ok: true, canUndo: () => canEdit() && history.past.at(-1) === checkpoint,
    undo: () => { if (canEdit() && history.past.at(-1) === checkpoint) restore(history.undo(state)); },
    view: () => { choose(play.id); const card = document.querySelector(`[data-action="choose:${play.id}"]`); card?.scrollIntoView?.({ block: 'nearest' }); $('#main-content')?.focus(); }
  };
}
function protectReference() {
  if (!current().reference) return;
  document.querySelectorAll('[data-action="mirror"],[data-action="rehearse-mode"],[data-action="play"]').forEach(n => { n.disabled = true; n.title = t("feedback.the_original_diagram_has_no_editable_or_playable_coordi"); });
}

function toast(message, { type = 'info', action = '', label = '' } = {}) {
  const node = $('#toast'), undoable = /可撤销|撤销恢复|Undo|undo/.test(message) && history.past.length && canEdit();
  node.dataset.type = type; node.setAttribute('role', type === 'error' ? 'alert' : 'status');
  const glyph = { success: '<path d="m7.5 12.5 3 3 6-7"/>', error: '<path d="M12 7.5v5.5M12 16.5h.01"/>', warning: '<path d="M12 8v4.5M12 16h.01"/>', info: '<path d="M12 11v5M12 8h.01"/>' }[type] || '<path d="M12 11v5M12 8h.01"/>';
  const symbol = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${glyph}</svg>`;
  node.innerHTML = `<span class="toast-icon" aria-hidden="true">${symbol}</span><span class="toast-message">${e(message)}</span>${undoable || action ? `<span class="toast-actions">${undoable ? `<button data-action="undo" class="toast-undo">${t("editorExtra.undo")}</button>` : ''}${action ? `<button data-action="${e(action)}" class="toast-action">${e(label)}</button>` : ''}</span>` : ''}<button class="toast-close" data-action="dismiss-toast" aria-label="${t("editorExtra.dismiss_notification")}">${icon('close')}</button>`;
  node.classList.add('visible'); window.clearTimeout(toastTimer);
  if (type !== 'error') toastTimer = window.setTimeout(() => node.classList.remove('visible'), type === 'warning' ? 8000 : 5200);
}

function save({ replaceUnreadable = false } = {}) {
  if (cloudMode()) { shared?.schedule(state.data); return; }
  if (localRecovery && !replaceUnreadable) { toast(recoveryMessage, { type: 'error', action: 'local-recovery', label: t("editorExtra.recovery_options") }); return false; }
  let saved = false;
  try { localStorage.setItem(STORAGE_KEY, encodeWorkspace(state.data)); saveState = t('editor.saved_locally'); saved = true; }
  catch { saveState = t("feedback.not_saved"); toast(t("feedback.save_failed_browser_storage_is_unavailable_or_full_expo"), { type: 'error', action: 'download-json', label: t("feedback.export_backup") }); }
  $('#save-state')?.replaceChildren(document.createTextNode(saveState));
  return saved;
}
function stop() { playing = false; if (frame) cancelAnimationFrame(frame); frame = null; lastFrame = null; }
function resetAnimation() { stop(); time = 0; }
function edit(fn, { redraw = true } = {}) {
  if (!canEdit()) { toast(editBlockedMessage(), { type: 'warning' }); return; }
  resetAnimation(); rehearsal = false; draft = null; previewPoint = null; history.record(state); fn(current(), state.data); save(); if (redraw) render(); else refreshMetadata();
}
function choose(id) { if(id===state.selectedId){panels.close();return;} if (!confirmDraft(() => choose(id))) return; resetAnimation(); draft = null; selection = null; state.selectedId = id; panels.close({focus:false}); tool = 'select'; render(); }
function restore(next) { if (!next || !canEdit()) return; resetAnimation(); rehearsal=false; state = next; book = current().book; selection = null; draft = null; save(); render(); $('#toast').classList.remove('visible'); }

function render() {
  const p = current(); if (!p) return;
  const previousPlay=renderedPlayId, existingIds=new Set([...document.querySelectorAll('#field [data-player]')].map(n=>n.dataset.player));
  const restoreScroll=captureEditorScroll({samePlay:previousPlay===p.id});
  const retainedStage=previousPlay===p.id ? $('#field .pitch-stage') : null;
  if (!cloudMode()) document.title = `${p.title} · 本地预览`;
  document.documentElement.style.setProperty('--team-color', state.data.team.accent);
  document.title = `${p.title} · Playbook Studio`;
  const plays = filtered(), categories = [...new Set(state.data.plays.filter(p => p.book === book).map(p => p.category))];
  const formations = [...new Set(state.data.plays.filter(p => p.book === book).map(p => p.formation))];
  $('#app').innerHTML = `<div class="workspace ${p.reference ? 'reference-play' : ''}">
    <button class="sidebar-scrim" data-action="close-panel" aria-label="${t("editor.close_side_panel")}" tabindex="-1"></button><aside class="sidebar" id="plays-panel" aria-label="${t("editor.play_list")}">
      <button class="panel-close compact-only" data-action="close-panel" aria-label="${t("editor.close_play_list")}">${icon('close')}</button>
      <a class="brand" href="./index.html" aria-label="Playbook Studio"><img class="brand-icon" src="./assets/brand/playbook-studio-icon.svg" width="44" height="24" alt=""><span>Playbook<span>Studio</span></span><small title="${cloudMode() ? t("editor.saved_in_the_cloud_and_shared_by_member_permissions") : t("editor.saved_in_this_browser_only_export_backups_regularly")}">${cloudMode() ? t("editor.cloud") : t("editor.local")}</small></a>
      <button class="team-switch" data-action="team"><span class="team-avatar" aria-hidden="true">${e([...(state.data.team.name || '').trim()][0] || '队')}</span><span><strong>${e(state.data.team.name)}</strong><small>${e(state.data.team.subtitle)}</small></span>${icon('chevron')}</button>
      <div class="side-label"><span>${t("editor.playbook")}</span></div>
      <nav class="book-nav" aria-label="${t("editor.playbook_type")}">${Object.entries(BOOKS).map(([key, name]) => `<button ${key === 'offense' ? 'data-madden-drop="offense"' : ''} data-action="book:${key}" class="${key === book ? 'active' : ''}" aria-pressed="${key === book}">${icon(key === 'offense' ? 'route' : key === 'defense' ? 'zone' : 'flag')}<span>${t(key === 'offense' ? 'editor.offense' : key === 'defense' ? 'editor.defense' : 'editor.special_teams')}</span><em>${state.data.plays.filter(p => p.book === key).length}</em></button>`).join('')}</nav>
      <button class="madden-launch" data-action="madden-library">${icon('ball')}<span><strong>${t("editor.madden_nfl_play_library")}</strong><small>${t("editor.eagles_ravens_drag_to_add")}</small></span><b>↗</b></button>
      <div class="madden-drop-target" data-madden-drop="offense">${t("editor.drop_here_to_add_to_offense")}<small>${canEdit() ? t("editor.add_to_current_workspace_autosaved") : t("editor.read_only_cannot_add")}</small></div>
      <div class="side-divider"></div>
      <label class="search-box">${icon('search')}<input type="search" id="search" placeholder="${t("editor.search_plays")}" aria-label="${t("editor.search_plays_2")}" value="${e(query)}"></label>
      <div class="filters"><select aria-label="${t("editor.play_category")}" id="category-filter"><option value="">${t("editor.all_categories")}</option><option value="favorite" ${filter === 'favorite' ? 'selected' : ''}>${t("editor.favorites")}</option>${categories.map(c => `<option value="${e(c)}" ${c === filter ? 'selected' : ''}>${e(c)}</option>`).join('')}</select><select aria-label="${t("editor.formation_filter")}" id="formation-filter"><option value="">${t("editor.all_formations")}</option>${formations.map(f => `<option value="${e(f)}" ${formationFilter === f ? 'selected' : ''}>${e(f)}</option>`).join('')}</select></div>
      <div class="play-list-label"><span>${filter === 'favorite' ? t("editor.favorite_plays") : t("editor.my_plays")} <b>${plays.length}</b></span>${btn('new', 'plus', t("editor.new_play"), 'small-icon')}</div>
      <div class="play-list">${plays.length ? plays.map((v, i) => `<button data-action="choose:${e(v.id)}" class="play-card ${p.id === v.id ? 'active' : ''}" aria-label="${t("editorExtra.open")}${e(v.title)}" aria-pressed="${p.id === v.id}"><div class="play-thumb">${fieldSVG(v, { showGrid: false }, { thumbnail: true, prefix: `thumb-${i}` })}</div><span class="play-card-info"><strong>${e(v.title)}</strong><small>${e(v.formation)} · ${e(v.category)}</small></span>${v.favorite ? '<span class="favorite-dot">★</span>' : ''}</button>`).join('') : `<div class="empty-list">${t("editorExtra.no_matching_plays_found")}<br>${t("editorExtra.try_another_search_or_clear_the_filters")}<button class="text-button" data-action="clear-filters">${t("editorExtra.clear_all_filters")}</button></div>`}</div>
      <button class="new-play" data-action="new">${icon('plus')}${t("editorExtra.new_play")}</button>
      <div class="sidebar-bottom"><button data-action="team">${icon('team')}${t("editorExtra.team_and_roster")}</button><button data-action="import">${icon('folder')}${t("editorExtra.import_playbook")}</button><button data-action="help">${icon('help')}${t("editorExtra.guide")}<kbd>?</kbd></button><span class="local-status"><i></i><span id="save-state">${e(saveState)}</span></span></div>
    </aside>
    <main class="main" id="main-content" tabindex="-1">
      <header class="topbar"><div class="breadcrumbs">${btn('sidebar', 'menu', t("editor.toggle_play_list"), 'mobile-menu', `aria-expanded="${panels.active==='plays'}"`)}<span>${icon('book')} ${t(p.book === 'offense' ? 'editor.offense' : p.book === 'defense' ? 'editor.defense' : 'editor.special_teams')} ${t("editor.playbook")}</span><span class="crumb-slash">/</span><span>${e(p.formation)}</span></div><div class="top-actions"><button class="button subtle" data-action="madden-library" aria-label="${t("editor.open_madden_play_library")}">${icon('ball')}<span>${t("editor.madden_library")}</span></button>${effectsControl()}<button class="button subtle" data-action="print" aria-label="${t("editor.print_playbook")}">${icon('print')}<span>${t("editor.print")}</span></button><button class="button primary" data-action="export" aria-label="${t("editor.export_playbook")}">${icon('export')}<span>${t("editor.export")}</span></button></div></header>
      <section class="play-header"><div><div class="eyebrow">${e(p.personnel)} <span>·</span> ${e(p.category)}</div><h1>${e(p.title)} ${btn('favorite', 'star', p.favorite ? t("editor.remove_favorite") : t("editor.favorite_play"), `favorite-button ${p.favorite ? 'is-favorite' : ''}`)}</h1><p>${p.diagramSource ? t("editor.editable_reconstruction_move_players_draw_and_rehearse_") : p.reference ? t("editor.original_madden_diagram_favorite_annotate_export_and_pr") : canEdit() ? t("editor.select_a_player_to_draw_a_route_or_drag_to_adjust_posit") : t("editor.review_team_plays_and_rehearse_routes")}</p></div><div class="play-actions">${p.diagramSource ? `<button class="button subtle" data-action="compare-source">${t("editorExtra.compare_source")}</button><button class="button subtle" data-action="space-madden-line">${t("editorExtra.normalize_line_spacing")}</button>` : ''}${btn('undo', 'undo', t("editor.undo_ctrl_z"), 'icon-button', !history.past.length ? 'disabled' : '')}${btn('redo', 'redo', t("editor.redo_ctrl_shift_z"), 'icon-button', !history.future.length ? 'disabled' : '')}<span class="vertical-rule"></span>${btn('mirror', 'flip', t("editor.mirror"), 'icon-button')}${btn('duplicate', 'copy', t("editor.duplicate_play"), 'icon-button')}</div></section>
      ${!canEdit() ? `<div class="readonly-banner"><strong>${localRecovery ? t("editor.recovery_required") : shared?.sync?.viewError ? t("editor.view_recovery_required") : t("editor.read_only")}</strong><span>${localRecovery || shared?.sync?.viewError ? e(editBlockedMessage()) : t("editor.you_can_view_rehearse_export_and_print_ask_an_administr")}</span>${localRecovery ? `<button class="button subtle" data-action="local-recovery">${t("editor.recovery_options")}</button>` : ''}</div>` : ''}<div class="editor-layout"><section class="canvas-section" aria-label="${t("editor.field_and_rehearsal")}">
        <div class="canvas-heading">${boardSizeControls()}<div class="canvas-actions"><div class="view-tools" role="group" aria-label="${t("editor.field_display_options")}">${btn('grid', 'grid', t("editor.show_or_hide_yard_lines"), 'tool-button')}${btn('theme', 'sun', t("editor.toggle_field_brightness"), 'tool-button')}</div><details class="add-object-menu"><summary aria-label="${t("editor.add_objects")}">${icon('plus')}<span>${t("editor.add_objects")}</span></summary><div><button data-action="add-player:offense">${icon('plus')}${t("editor.add_offensive_player")}</button><button data-action="add-player:defense">${icon('plus')}${t("editor.add_defensive_player")}</button><button data-action="add-defense-43" title="${t('editor.defense43_detail')}">${icon('team')}${t(p.players.some(v => v.side === 'defense') ? 'editor.reset' : 'editor.add')} ${t('editor.defense43')}<small>${t('editor.defense43_detail')}</small></button><button data-action="tool:zone">${icon('zone')}${t("editor.draw_coverage_zone")}</button><button data-action="tool:text">${icon('text')}${t("editor.add_text")}</button></div></details></div></div>
        <div id="field" class="field-wrap tool-${tool} ${rehearsal ? 'is-rehearsal' : ''}"><div class="pitch-viewport" aria-label="${t("editor.scalable_play_board")}"><div class="pitch-stage">${fieldSVG(p, viewSettings(), { selected: selection, time, drawing: draft })}</div></div><div class="field-tag" title="${t("editor.offense_defense_players")}">${icon('ball')} <span>${t("editor.offense")} ${p.players.filter(v => v.side === 'offense').length} · ${t("editor.defense")} ${p.players.filter(v => v.side === 'defense').length}</span></div><div id="field-context" class="field-context">${fieldContext()}</div><div class="drag-readout" hidden></div></div>
        <div class="stage-dock"><div class="editor-mode" role="group" aria-label="${t("editor.workspace_mode")}"><button data-action="edit-mode" aria-pressed="${!rehearsal}" class="${!rehearsal?'active':''}">${icon('select')}${t("editor.design_play")}</button><button data-action="rehearse-mode" aria-pressed="${rehearsal}" class="${rehearsal?'active':''}">${icon('play')}${t("editor.rehearse")}</button></div><div class="toolbar" role="toolbar" aria-label="${t("editor.drawing_tools")}"><div class="draw-tools" style="--tool-index:${['select','route','block','motion','pass','zone','text'].indexOf(tool)}"><span class="tool-indicator" aria-hidden="true"></span>${[['select', 'select', t("editor.select_move_v")], ['route', 'route', t("editor.route_r")], ['block', 'block', t("editor.block_b")], ['motion', 'motion', t("editor.pre_snap_motion_m")], ['pass', 'pass', t("editor.pass_p")], ['zone', 'zone', t("editor.coverage_zone_z")], ['text', 'text', t("editor.text_t")]].map(([a, i, l]) => `<button class="tool-button ${tool === a ? 'active' : ''}" data-action="tool:${a}" title="${e(l)}" aria-label="${e(l)}" aria-pressed="${tool === a}">${icon(i)}<span class="tool-name">${({select:t("editor.select"),route:t("editor.route"),block:t("editor.block"),motion:t("editor.motion"),pass:t("editor.pass"),zone:t("editor.zone"),text:t("editor.text")})[a]}</span><kbd>${l.split(' · ')[1]}</kbd></button>`).join('')}</div></div><div class="playback"><div class="playback-top"><div class="playback-title">${icon('play')}<span>${t("editor.rehearse")}</span><small id="playback-phase">${playbackPhase()}</small></div><div class="playback-options"><label class="speed-label">${t("editorExtra.speed")}<select id="speed" aria-label="${t("editor.playback_speed")}">${[.5, 1, 1.5, 2].map(s => `<option value="${s}" ${s === speed ? 'selected' : ''}>${s}×</option>`).join('')}</select></label>${btn('loop', 'loop', t("editor.loop"), `icon-button ${loop ? 'enabled' : ''}`, `aria-pressed="${loop}"`)}</div></div><div class="transport">${btn('play', playing ? 'pause' : 'play', playing ? t("editor.pause") : t("editor.play"), 'play-button')}${btn('reset', 'reset', t("editor.reset_animation"), 'icon-button')}<input type="range" id="timeline" aria-label="${t("editor.animation_time")}" min="0" max="${animationLength(p)}" step="0.01" value="${time}"><span id="time-label">${time.toFixed(1)} <span>/ ${animationLength(p).toFixed(1)}s</span></span></div></div></div>
        ${boardHeightHandle}
        <div class="canvas-hint" aria-live="polite">${canvasHint()}</div>
      </section>${boardWidthHandle}<section class="inspector-panel" id="properties-panel" aria-label="${t("editor.play_properties")}"><header class="panel-heading compact-only"><strong>${t("editor.properties_and_settings")}</strong><button class="panel-close" data-action="close-panel" aria-label="${t("editor.close_properties")}">${icon('close')}</button></header><aside class="inspector" aria-label="${t("editor.play_properties")}">${inspector()}</aside></section></div>
      <footer class="app-footer"><span>PLAYBOOK STUDIO</span><span>${t("editor.draw_the_routes_understand_the_game")}</span><button data-action="help">${t("editorExtra.shortcuts_and_help")}${icon('chevron')}</button></footer>
    </main><nav class="compact-nav" aria-label="${t("editor.workspace_panels")}"><button data-action="sidebar" aria-controls="plays-panel">${icon('book')}<span>${t("editor.playbook")}</span></button><button data-action="panel-field" aria-pressed="true">${icon('grid')}<span>${t("editor.field")}</span></button><button data-action="inspector-panel" aria-controls="properties-panel">${icon('select')}<span>${t("editor.properties")}</span></button></nav></div>`;
  // Keep the live renderer and its SVG root through edits to the same play.
  // Reconnecting them synchronously avoids a blank canvas between UI commits.
  if(retainedStage){$('#field .pitch-stage').replaceWith(retainedStage);renderField();}
  bindField(); syncEditorChrome(); protectReadOnly(); protectReference(); boardLayout.mount(); maddenLibrary.refresh();
  restoreScroll();
  if (previousPlay && previousPlay!==p.id) revealPlay($('#field svg'));
  else if(previousPlay) enterPlayers($('#field'),new Set(p.players.filter(v=>!existingIds.has(v.id)).map(v=>v.id)));
  if(!previousPlay) enterWorkbench(document.querySelector('.workspace'));
  renderedPlayId=p.id;
  digitalBoard?.sync();
}
function fieldContext() {
  if(rehearsal) return `<span class="context-status"><i class="live-dot"></i>${playing?t("feedback.playing"):time>=animationLength(current())?t("editor.rehearsal_complete"):time?t("feedback.paused"):t("feedback.ready")}</span><button class="context-primary" data-action="play" aria-label="${playing?t("feedback.pause_rehearsal"):t("feedback.start_rehearsal")}">${icon(playing?'pause':'play')}${playing?t("feedback.pause"):time>=animationLength(current())?t("feedback.replay"):t("feedback.play")}</button><button data-action="reset" aria-label="${t("editorExtra.restart_rehearsal")}">${icon('reset')}</button><button data-action="edit-mode">${t("editor.back_to_design")}</button>`;
  if(draft) {
    const owner=current().players.find(p=>p.id===draft.playerId);
    return `<span class="context-player">${e(owner?.label)}<small>${draft.points.length-1}${t("editorExtra.route_points")}</small></span><button data-action="undo-point" ${draft.points.length<2?'disabled':''}>${icon('undo')}${t("editor.undo_point")}</button><button class="context-primary" data-action="finish-route" ${draft.points.length<2?'disabled':''}>${icon('check')}${t("editor.finish")}</button><button data-action="cancel-draft" aria-label="${t("editor.cancel_route")}">${icon('close')}</button>`;
  }
  if(selection?.type==='player' && canEdit())return `<span class="context-player">${e(selectedObject()?.label)}<small>${t("editor.selected")}</small></span><button class="context-primary" data-action="tool:route">${icon('route')}${t("editor.draw_route")}</button><button data-action="delete-selection" aria-label="${t("editor.delete_selected_player")}">${icon('trash')}</button><button data-action="clear-selection" aria-label="${t("editor.clear_selection")}">${icon('close')}</button>`;
  if(selection?.type==='route' && canEdit())return `<span>${t("editor.drag_points_to_adjust_the_route")}</span><button data-action="delete-selection">${icon('trash')}${t("editor.delete")}</button><button data-action="clear-selection" aria-label="${t("editor.clear_selection")}">${icon('close')}</button>`;
  return '';
}
function canvasHint() {
  if (current().reference) return `<span><i class="hint-dot"></i>${t("editorExtra.original_huddle_gg_diagram_routes_cannot_be_d")}</span>`;
  const drawing = drawingTools.includes(tool), active = draft ? (draft.points.length > 1 ? 3 : 2) : selection?.type === 'player' ? 2 : 1;
  const hasMain=draft && ['route','motion'].includes(tool) && current().routes.some(r=>r.playerId===draft.playerId&&!r.optional&&['route','motion'].includes(r.kind));
  return `<span><i class="hint-dot"></i>${canEdit() ? hint() : t("feedback.read_only_select_a_player_or_route_to_inspect_it_or_pla")}</span><span class="shortcut-hint">${draft?t("feedback.click_to_add_points_backspace_to_undo_enter_to_finish"):selection?t("feedback.esc_to_clear_selection_delete_to_remove_undo_available"):t("feedback.v_select_r_route_space_play")}</span>${hasMain?`<label class="draft-behavior">${t("editorExtra.this_player_already_has_a_main_route")}<select id="draft-mode" aria-label="${t("editorExtra.new_route_purpose")}"><option value="main" ${draft.mode!=='optional'?'selected':''}>${t("editorExtra.make_the_new_route_the_main_route_and_keep_th")}</option><option value="optional" ${draft.mode==='optional'?'selected':''}>${t("editorExtra.add_as_an_option_rehearsal_keeps_the_existing")}</option></select></label>`:''}${drawing && canEdit() ? `<div class="drawing-steps">${[t("feedback.select_a_player"),t("feedback.click_route_endpoints_turns"),t("feedback.finish_and_save")].map((v,i)=>`<span class="${active === i+1 ? 'current' : ''}"><b>${i+1}</b>${v}</span>`).join('')}</div>` : ''}`;
}
function updateCanvasHint() {
  const n=$('.canvas-hint');if(n)n.innerHTML=canvasHint();
  const context=$('#field-context'), html=fieldContext();
  if(context && context.innerHTML!==html) {context.innerHTML=html; if(html)enterContext(context);}
}
function playbackPhase() {
  return time===0?t("editor.ready"):time>=animationLength(current())?t("editor.rehearsal_complete"):current().ball.receiverId && time>=current().ball.passAt && time<current().ball.arriveAt?t("editor.passing"):time>=current().ball.arriveAt && current().ball.receiverId?t("editor.after_catch"):t("editor.routes_in_motion");
}
function syncPlayback() {
  const timeline=$('#timeline');if(!timeline)return;
  timeline.value=time; timeline.style.setProperty('--progress',`${time/animationLength(current())*100}%`);
  const stamp=`${time.toFixed(1)} <span>/ ${animationLength(current()).toFixed(1)}s</span>`;
  if($('#time-label').innerHTML!==stamp)$('#time-label').innerHTML=stamp;
  if($('#playback-phase').textContent!==playbackPhase())$('#playback-phase').textContent=playbackPhase();
  for(const button of document.querySelectorAll('[data-action="play"]')){
    const contextual=!!button.closest('.field-context'),label=contextual?(playing?t("feedback.pause_rehearsal"):t("feedback.start_rehearsal")):(playing?t("editor.pause"):t("editor.play"));
    if(button.getAttribute('aria-label')!==label){button.innerHTML=icon(playing?'pause':'play')+(contextual?(playing?t("feedback.pause"):t("feedback.play")):'');button.setAttribute('aria-label',label);button.title=label;}
  }
  $('.playback').classList.toggle('is-playing',playing);
  $('#field').classList.toggle('is-running',playing);
}
function syncEditorChrome() {
  const field=$('#field');if(!field)return;
  field.className=`field-wrap tool-${tool} ${rehearsal?'is-rehearsal':''} ${playing?'is-running':''}`;
  for(const button of document.querySelectorAll('[data-action^="tool:"]')) {const active=button.dataset.action===`tool:${tool}`;button.classList.toggle('active',active);button.setAttribute('aria-pressed',active);}
  $('.draw-tools')?.style.setProperty('--tool-index',['select','route','block','motion','pass','zone','text'].indexOf(tool));
  $('.toolbar')?.classList.toggle('rehearsal-toolbar',rehearsal);
  const gridButton=$('[data-action="grid"]'), gridVisible=viewSettings().showGrid!==false;
  gridButton?.classList.toggle('enabled',gridVisible);
  gridButton?.setAttribute('aria-pressed',String(gridVisible));
  $('[data-action="theme"]')?.setAttribute('aria-pressed',String(viewSettings().fieldTheme==='light'));
  for(const action of ['edit-mode','rehearse-mode']) {const button=$(`.editor-mode [data-action="${action}"]`);if(button){const active=action==='rehearse-mode'?rehearsal:!rehearsal;button.classList.toggle('active',active);button.setAttribute('aria-pressed',active);}}
  panels.mount();
  updateCanvasHint();syncPlayback();
}
function setTool(next) {
  if (current().reference) { if (next !== 'select') toast(t("feedback.this_original_diagram_supports_notes_but_has_no_editabl"), { type: 'warning' }); return; }
  if(next===tool && draft)return;
  if(next!==tool && !confirmDraft(()=>setTool(next)))return;
  resetAnimation(); rehearsal=false; tool=next; draft=null;previewPoint=null;
  if(drawingTools.includes(next)) {
    const player=selection?.type==='player'?selectedObject():current().players.find(p=>p.id===selectedObject()?.playerId);
    if(player) {selection={type:'player',id:player.id};draft={playerId:player.id,points:[{x:player.x,y:player.y}]};}
  }
  renderField();syncEditorChrome();protectReadOnly();
}
function confirmDraft(next) {
  if (!draft) return true;
  pendingNavigation = next;
  openModal(t("modal.this_route_is_unfinished"), `<p>${t("modal.switching_will_discard_the_route_points_being_draw")}</p><p class="muted small">${t("modal.completed_and_saved_routes_are_unaffected")}</p>`, `<button class="button subtle" data-action="keep-drawing">${t("modal.continue_drawing")}</button><button class="button danger" data-action="discard-draft">${t("modal.discard_draft_and_continue")}</button>`);
  return false;
}
function hint() {
  if (rehearsal || playing || time > 0) return t("editor.press_space_to_play_or_pause_scrub_the_timeline_to_insp");
  if (draft) return t("feedback.move_to_preview_the_next_segment_click_to_add_points_th");
  return { select: t("editor.drag_players_into_position_select_a_route_to_edit_its_p"), route: t("feedback.select_a_player_then_click_the_field_to_draw_enter_to_f"), block: t("feedback.select_a_player_and_click_a_blocking_endpoint_enter_to_"), motion: t("feedback.select_a_player_and_draw_pre_snap_motion"), pass: t("feedback.select_the_ball_carrier_and_draw_a_dashed_pass"), zone: t("feedback.drag_on_the_field_to_draw_a_coverage_zone"), text: t("feedback.click_the_field_to_place_an_annotation") }[tool];
}
const fieldInput = (label, key, value, type = 'text', attrs = '') => `<label class="form-field"><span>${label}</span><input data-prop="${key}" type="${type}" value="${e(value)}" ${attrs}></label>`;
const option = (value, label, selected) => `<option value="${e(value)}" ${value === selected ? 'selected' : ''}>${e(label)}</option>`;
let ballSectionOpen = false;
document.addEventListener('toggle', event => { if (event.target.matches?.('.ball-section')) ballSectionOpen = event.target.open; }, { capture: true });
function ballSummary(play) {
  const label = id => play.players.find(v => v.id === id)?.label || '—';
  return play.ball.receiverId ? `${label(play.ball.holderId)} → ${label(play.ball.receiverId)}` : `${label(play.ball.holderId)}${t("editorExtra.run")}`;
}
function inspector() {
  const p = current(), obj = selectedObject();
  let content;
  if (p.reference) return `${hasEditableTrace(p.reference.catalogId) ? `<button class="button primary full" data-action="convert-reference">${t("editorExtra.create_editable_copy")}</button>` : ''}<div class="madden-source-box"><strong>${e(p.reference.game)} · ${p.reference.team === 'eagles' ? 'Eagles' : 'Ravens'}</strong><p>${e(p.formation)}</p><p>${t("editorExtra.the_original_diagram_retains_its_routes_and_w")}</p><a href="${e(p.reference.sourceUrl)}" target="_blank" rel="noopener noreferrer">${t("editorExtra.view_source_on_huddle_gg")}</a></div>${fieldInput(t("editor.play_name"), 'title', p.title, 'text', 'maxlength="120"')}${fieldInput(t("editor.category"), 'category', p.category, 'text', 'maxlength="60"')}<div class="inspector-heading"><span>${t("editor.coach_notes")}</span></div><textarea data-prop="notes" rows="8" aria-label="${t("editor.coach_notes")}" placeholder="${t("editorExtra.situations_reads_adjustments")}" maxlength="10000">${e(p.notes)}</textarea><button class="button danger quiet full" data-action="delete-play">${icon('trash')}${t("editor.delete_play")}</button><div class="inspector-note">${icon('check')}${cloudMode() ? t("editor.uses_this_playbook_s_save_and_membership_permissions") : t("editor.autosaved_in_this_browser")}</div>`;
  if (selection?.type === 'player' && obj) {
    const assigned = state.data.roster.find(r => r.name === obj.name)?.id || '';
    content = `<div class="inspector-heading"><span>${t("editor.player_settings")}</span><span class="tag">${obj.side === 'offense' ? t("editor.offense") : t("editor.defense")}</span></div><div class="player-preview"><span style="background:${displayColor(obj.color, viewSettings().fieldTheme === 'light')};color:${displayColor(obj.color, viewSettings().fieldTheme === 'light') === '#eef0f3' ? '#111214' : ''}">${e(obj.label)}</span><div><strong>${e(obj.name || t("editor.unassigned"))}</strong><small>${t("editor.drag_the_marker_to_change_position")}</small></div></div>${fieldInput(t("editor.position_label"), 'label', obj.label, 'text', 'maxlength="10"')}<label class="form-field"><span>${t("editor.assign_roster_player")}</span><select data-prop="roster"><option value="">${t("editor.no_player_assigned")}</option>${state.data.roster.map(r => option(r.id, `#${r.number} ${r.name} · ${r.position}`, assigned)).join('')}</select></label>${fieldInput(t("editor.display_name"), 'name', obj.name, 'text', 'maxlength="80"')}<div class="form-row">${fieldInput(t("editor.marker_color"), 'color', displayColor(obj.color, viewSettings().fieldTheme === 'light'), 'color')}<label class="form-field"><span>${t("editor.shape")}</span><select data-prop="shape">${[['circle', t("editor.circle")], ['square', t("editor.square")], ['triangle', t("editor.triangle")]].map(([v, l]) => option(v, l, obj.shape)).join('')}</select></label></div><div class="inspector-divider"></div><div class="inspector-heading"><span>${t("editor.draw_a_route")}</span></div><div class="route-quick">${[['route', t("editor.route")], ['block', t("editor.block")], ['motion', t("editor.motion")], ['pass', t("editor.pass")]].map(([v, l]) => `<button data-action="tool:${v}" class="${tool === v ? 'active' : ''}">${icon(v)}${l}</button>`).join('')}</div><div class="route-list">${p.routes.filter(r => r.playerId === obj.id).map(r => `<button data-action="select-route:${e(r.id)}">${icon(r.kind)}<span>${r.optional ? t("editor.optional") : ''}${({ route: t("editor.route_2"), block: t("editor.block_2"), motion: t("editor.motion_2"), pass: t("editor.pass_2") })[r.kind]}</span>${icon('chevron')}</button>`).join('')}</div><button class="button danger full" data-action="delete-selection">${icon('trash')}${t("editor.remove_player")}</button>`;
  } else if (selection?.type === 'route' && obj) {
    const owner = p.players.find(v => v.id === obj.playerId);
    content = `<div class="inspector-heading"><span>${t("editor.route_settings")}</span><span class="tag">${e(owner?.label)}</span></div><p class="muted small">${t("editor.drag_the_solid_points_on_the_field_to_adjust_the_route")}</p><label class="form-field"><span>${t("editor.line_type")}</span><select data-prop="kind">${[['route', t("editor.solid_route")], ['block', t("editor.block_2")], ['motion', t("editor.zigzag_motion")], ['pass', t("editor.dashed_pass")]].map(([v, l]) => option(v, l, obj.kind)).join('')}</select></label><div class="form-row">${fieldInput(t("editor.route_color"), 'color', displayColor(obj.color, viewSettings().fieldTheme === 'light'), 'color')}<label class="form-field"><span>${t("editor.end_marker")}</span><select data-prop="endCap">${[['arrow', t("editor.arrow")], ['bar', t("editor.block_bar")], ['dot', t("editor.dot")]].map(([v, l]) => option(v, l, obj.endCap)).join('')}</select></label></div><label class="check-label"><input data-prop="smooth" type="checkbox" ${obj.smooth ? 'checked' : ''}>${t("editor.smooth_curve")}</label><label class="check-label"><input data-prop="optional" type="checkbox" ${obj.optional ? 'checked' : ''}>${t("editor.optional_route_excluded_from_main_animation")}</label><div class="inspector-divider"></div><div class="inspector-heading"><span>${t("editor.animation_timing")}</span><small>${t("editor.sec")}</small></div><div class="form-row">${fieldInput(t("editor.start_delay"), 'delay', obj.delay, 'number', 'min="0" max="10" step="0.1"')}${fieldInput(t("editor.duration"), 'duration', obj.duration, 'number', 'min="0.2" max="10" step="0.1"')}</div><p class="muted small">${t("editor.players_move_at_a_constant_speed_along_the_route_blocks")}</p><button class="button danger full" data-action="delete-selection">${icon('trash')}${t("editor.delete_route")}</button>`;
  } else if (selection?.type === 'zone' && obj) {
    content = `<div class="inspector-heading"><span>${t("editor.coverage_zone")}</span></div>${fieldInput(t("editor.zone_name"), 'label', obj.label, 'text', 'maxlength="80"')}${fieldInput(t("editor.zone_color"), 'color', obj.color, 'color')}<div class="form-row">${fieldInput(t("editor.horizontal_radius"), 'rx', obj.rx, 'number', 'min="1" max="50" step="1"')}${fieldInput(t("editor.vertical_radius"), 'ry', obj.ry, 'number', 'min="1" max="50" step="1"')}</div><p class="muted small">${t("editor.drag_the_center_to_move_the_coverage_zone")}</p><button class="button danger full" data-action="delete-selection">${icon('trash')}${t("editor.delete_zone")}</button>`;
  } else if (selection?.type === 'annotation' && obj) {
    content = `<div class="inspector-heading"><span>${t("editor.text_annotation")}</span></div>${fieldInput(t("editor.annotation_text"), 'text', obj.text, 'text', 'maxlength="200"')}<p class="muted small">${t("editor.drag_the_text_to_reposition_it")}</p><button class="button danger full" data-action="delete-selection">${icon('trash')}${t("editor.delete_annotation")}</button>`;
  } else {
    content = `<div class="inspector-heading"><span>${t("editor.play_details")}</span><span class="tag">${t(p.book === 'offense' ? 'editor.offense' : p.book === 'defense' ? 'editor.defense' : 'editor.special_teams')}</span></div>${fieldInput(t("editor.play_name"), 'title', p.title, 'text', 'maxlength="120"')}${fieldInput(t("editor.category"), 'category', p.category, 'text', 'maxlength="60"')}<label class="form-field"><span>${t("editor.formation_template")}</span><select id="apply-formation"><option value="">${e(p.formation)}</option>${FORMATIONS.map(f => `<option value="builtin:${e(f)}">${e(f)}</option>`).join('')}${state.data.formations.filter(f => f.book === p.book).map(f => `<option value="custom:${e(f.id)}">${e(f.name)} · 自定义</option>`).join('')}</select></label>${fieldInput(t("editor.personnel"), 'personnel', p.personnel, 'text', 'maxlength="80"')}<div class="formation-actions"><button data-action="save-formation">${icon('save')}${t("editorExtra.save_formation")}</button><button data-action="opponents">${icon('team')} ${p.players.some(v => v.side === (p.book === 'defense' ? 'offense' : 'defense')) ? t("editorExtra.remove") : t("editorExtra.add")}${t("editorExtra.opposing_formation")}</button></div><div class="inspector-divider"></div><div class="inspector-heading"><span>${t("editor.coach_notes")}</span></div><textarea data-prop="notes" rows="5" aria-label="${t("editor.coach_notes")}" placeholder="${t("editor.reads_routes_adjustments")}" maxlength="10000">${e(p.notes)}</textarea><div class="inspector-divider"></div><details class="inspector-section ball-section" ${ballSectionOpen ? 'open' : ''}><summary class="inspector-heading"><span>${t("editor.ball_movement")}</span><small>${e(ballSummary(p))}</small></summary><label class="form-field"><span>${t("editor.ball_carrier")}</span><select data-ball="holderId">${p.players.map(v => option(v.id, `${v.label}${v.name ? ' · ' + v.name : ''}`, p.ball.holderId)).join('')}</select></label><label class="form-field"><span>${t("editor.pass_to")}</span><select data-ball="receiverId"><option value="">${t("editor.no_pass_run")}</option>${p.players.filter(v => v.id !== p.ball.holderId).map(v => option(v.id, `${v.label}${v.name ? ' · ' + v.name : ''}`, p.ball.receiverId)).join('')}</select></label><div class="form-row">${fieldInput(t("editor.release_time"), 'ball.passAt', p.ball.passAt, 'number', 'min="0" max="10" step="0.1"')}${fieldInput(t("editor.arrival_time"), 'ball.arriveAt', p.ball.arriveAt, 'number', 'min="0.1" max="15" step="0.1"')}</div></details><div class="inspector-divider"></div><label class="check-label"><input id="show-names" type="checkbox" ${viewSettings().showNames ? 'checked' : ''}>${t("editor.show_player_names")}</label><button class="button danger quiet full" data-action="delete-play">${icon('trash')}${t("editor.delete_play")}</button>`;
  }
  return `${content}${selection ? `<button class="back-details" data-action="clear-selection">${t("editorExtra.back_to_play_details")}</button>` : ''}<div class="inspector-note">${icon('check')}${localRecovery || shared?.sync?.viewError ? t("editor.editing_and_autosave_are_paused_until_recovery_complete") : cloudMode() ? (canEdit() ? t("editor.all_changes_sync_to_the_shared_playbook") : t("editor.you_have_read_only_access")) : t("editor.all_changes_are_saved_in_this_browser")}</div>`;
}
function renderField() {
  const field=$('#field');if(!field)return;
  const template=document.createElement('template');template.innerHTML=fieldSVG(current(),viewSettings(),{selected:selection,time,drawing:draft});
  const svg=field.querySelector('.pitch-svg'),next=template.content.firstElementChild;
  // Preserve the SVG root and renderer readiness while replacing editable content
  // in one synchronous transaction. Canvas and vector pieces are stage siblings.
  for(const name of svg.getAttributeNames())if(name!=='class'&&!next.hasAttribute(name))svg.removeAttribute(name);
  for(const attr of next.attributes)if(attr.name!=='class')svg.setAttribute(attr.name,attr.value);
  const readyClasses=['digital-ready','digital-fallback-ready'].filter(name=>svg.classList.contains(name));
  svg.setAttribute('class',[next.getAttribute('class'),...readyClasses].join(' '));
  svg.replaceChildren(...next.childNodes);
  updateAnimation(svg,current(),time);
  digitalBoard?.sync({contentChanged:true});
  const tag=field.querySelector('.field-tag');if(tag)tag.innerHTML=`${icon('ball')}<span>${t("editor.offense")} ${current().players.filter(p=>p.side==='offense').length} · ${t("editor.defense")} ${current().players.filter(p=>p.side==='defense').length}</span>`;
}
function refreshSelection() {
  const inspectorNode=$('.inspector'), context=inspectorNode.dataset.context, next=`${selection?.type||'play'}:${selection?.id||current().id}`;
  inspectorNode.innerHTML=inspector();inspectorNode.dataset.context=next;
  if(context!==next)enterContext(inspectorNode);
  renderField();updateCanvasHint();protectReadOnly();
}
function refreshMetadata() {
  const play=current(), heading=$('.play-header h1');
  heading.firstChild.textContent=`${play.title} `;document.title=`${play.title} · Playbook Studio`;
  for(const card of document.querySelectorAll('.play-card'))if(card.dataset.action===`choose:${play.id}`){
    card.querySelector('strong').textContent=play.title;card.querySelector('small').textContent=`${play.formation} · ${play.category}`;
    card.setAttribute('aria-label',`${t("editorExtra.open")}${play.title}`);
  }
  $('.eyebrow').innerHTML=`${e(play.personnel)} <span>·</span> ${e(play.category)}`;
  $('[data-action="undo"]').disabled=!history.past.length;$('[data-action="redo"]').disabled=!history.future.length;
  renderField();syncEditorChrome();protectReadOnly();
}
function coordinates(event) { return fieldCoordinates($('#field .pitch-svg'),event); }
function pick(event) {
  if(!event.target.closest('[data-point]')) { const spatial=digitalBoard?.pick(event); if(spatial)return spatial; }
  const node = event.target.closest('[data-player],[data-route],[data-zone],[data-annotation]');
  if (!node) return null;
  for (const type of ['player', 'route', 'zone', 'annotation']) if (node.dataset[type]) return { type, id: node.dataset[type] };
  return null;
}
function bindField() {
  const field = $('#field');
  field.addEventListener('pointerdown', event => {
    if(event.target.closest('.field-context'))return;
    if (event.button !== 0) return;
    if (rehearsal || playing || time) { toast(t("feedback.return_to_design_mode_to_adjust_players"), { type: 'info' }); return; }
    const at = coordinates(event), hit = pick(event);
    if (!canEdit()) { selection = hit; refreshSelection(); return; }
    if (tool === 'text') { textModal(at); return; }
    if (drawingTools.includes(tool)) {
      if (hit?.type === 'player' && (!draft || draft.playerId !== hit.id)) {
        const begin=()=>{selection=hit;const p=selectedObject();draft={playerId:p.id,points:[{x:p.x,y:p.y}]};previewPoint=null;refreshSelection();};
        if(draft?.points.length>1){confirmDraft(()=>{draft=null;begin();});return;}
        begin();return;
      }
      if (!draft) {
        const p = selection?.type === 'player' ? selectedObject() : current().players.find(v => v.id === selectedObject()?.playerId);
        if (!p) { toast(t("feedback.select_a_player_before_drawing_a_route"), { type: 'warning' }); return; }
        draft = { playerId: p.id, points: [{ x: p.x, y: p.y }] };
      }
      if (draft.points.length < 200 && (!draft.points.at(-1) || Math.hypot(at.x - draft.points.at(-1).x, at.y - draft.points.at(-1).y) > .3)) draft.points.push(at);
      previewPoint=null;renderField(); updateCanvasHint(); return;
    }
    // Empty turf remains a scroll/pan surface on touch devices in selection mode.
    if (event.pointerType === 'touch' && tool === 'select' && !hit) { selection=null;refreshSelection();return; }
    event.preventDefault(); field.setPointerCapture?.(event.pointerId);
    if (tool === 'zone') { drag = { type: 'new-zone', start: at, before: clone(state), zoneId: uid() }; return; }
    const point = event.target.closest('[data-point]');
    if (point) { drag = { type: 'point', routeId: point.dataset.routeId, index: Number(point.dataset.point), start: at, before: clone(state) }; return; }
    selection = hit;
    if (hit) { drag = { ...hit, start: at, before: clone(state), original: clone(selectedObject()), moved: false }; }
    refreshSelection();
  });
  field.addEventListener('pointermove', event => {
    if(draft && !drag) {previewPoint=coordinates(event); if(!gestureFrame)gestureFrame=requestAnimationFrame(()=>{gestureFrame=null;previewDraft(field.querySelector('svg'),draft,previewPoint);});return;}
    if (!drag || !canEdit()) return;
    pendingPoint=coordinates(event);
    if(!gestureFrame)gestureFrame=requestAnimationFrame(flushGesture);
  });
  function flushGesture() {
    if(gestureFrame)cancelAnimationFrame(gestureFrame);gestureFrame=null;
    if(!drag || !pendingPoint)return;
    const at=pendingPoint,p=current();pendingPoint=null;
    if(Math.hypot(at.x-drag.start.x,at.y-drag.start.y)<.2 && !drag.moved)return;
    drag.moved=true;field.classList.add('is-dragging');
    if(drag.type==='player') {
      const initial=drag.before.data.plays.find(p=>p.id===state.selectedId), original=drag.original;
      const player=p.players.find(v=>v.id===drag.id);player.x=original.x;player.y=original.y;
      for(const route of p.routes)if(route.playerId===drag.id)route.points=clone(initial.routes.find(r=>r.id===route.id).points);
      movePlayer(p,drag.id,original.x+at.x-drag.start.x,original.y+at.y-drag.start.y);
    } else if(drag.type==='point') p.routes.find(r=>r.id===drag.routeId).points[drag.index]=at;
    else if(drag.type==='new-zone') {
      let zone=p.zones.find(v=>v.id===drag.zoneId);
      if(!zone){zone={id:drag.zoneId,x:50,y:40,rx:1,ry:1,color:COLORS.zone,label:'ZONE'};p.zones.push(zone);selection={type:'zone',id:zone.id};renderField();}
      Object.assign(zone,{x:(drag.start.x+at.x)/2,y:(drag.start.y+at.y)/2,rx:Math.max(1,Math.abs(at.x-drag.start.x)/2),ry:Math.max(1,Math.abs(at.y-drag.start.y)/2)});
    } else if(['zone','annotation'].includes(drag.type)) {const obj=selectedObject();obj.x=clamp(drag.original.x+at.x-drag.start.x);obj.y=clamp(drag.original.y+at.y-drag.start.y);}
    updateGeometry(field.querySelector('svg'),p);
    digitalBoard?.refreshBackground();
    const readout=field.querySelector('.drag-readout');readout.hidden=false;readout.textContent=`${drag.original?.label||t("editorExtra.adjust_position")} · X ${at.x.toFixed(1)} / Y ${at.y.toFixed(1)}`;
  }
  const endDrag = event => {
    if (!drag) return;
    // Flush the last pointer sample even if release happens before the next frame.
    flushGesture(); const before=drag.before,moved=drag.moved;
    if(field.hasPointerCapture?.(event.pointerId))field.releasePointerCapture(event.pointerId);
    drag=null;field.classList.remove('is-dragging');field.querySelector('.drag-readout').hidden=true;
    if(moved){history.record(before);save();render();}
  };
  field.addEventListener('pointerup',endDrag);
  field.addEventListener('pointercancel',()=>{if(gestureFrame)cancelAnimationFrame(gestureFrame);gestureFrame=null;pendingPoint=null;if(drag){state=drag.before;drag=null;render();}});
  field.addEventListener('pointerleave',()=>{if(!drag)previewDraft(field.querySelector('svg'),draft,null);});
  field.addEventListener('dblclick', event => { if (draft) { event.preventDefault(); finishRoute(); } });
  field.addEventListener('keydown', event => {
    if (!['Enter', ' '].includes(event.key) || !event.target.dataset.player && !event.target.dataset.route && !event.target.dataset.zone) return;
    event.preventDefault(); event.stopPropagation(); selection = pick(event); refreshSelection();
  });
}
function finishRoute() {
  if (!draft || draft.points.length < 2) { toast(t("editorExtra.click_at_least_one_route_endpoint"), { type: 'warning' }); return; }
  if (current().routes.length >= 100) { toast(t("editorExtra.each_play_can_have_at_most_100_routes"), { type: 'warning' }); return; }
  const alreadyMoving = current().routes.some(r => r.playerId === draft.playerId && !r.optional && ['route', 'motion'].includes(r.kind));
  const route = { id: uid(), playerId: draft.playerId, points: clone(draft.points), kind: tool, color: tool === 'pass' ? COLORS.pass : current().players.find(p => p.id === draft.playerId).color, smooth: false, endCap: tool === 'block' ? 'bar' : 'arrow', delay: 0, duration: tool === 'block' ? 2 : 4, optional: alreadyMoving && draft.mode==='optional' && ['route', 'motion'].includes(tool) };
  selection={type:'route',id:route.id};tool='select';
  edit(p=>{if(!route.optional&&['route','motion'].includes(route.kind))p.routes.filter(r=>r.playerId===route.playerId&&!r.optional&&['route','motion'].includes(r.kind)).forEach(r=>{r.optional=true;});p.routes.push(route);});
  burstAt(document.querySelector('#field-context'));
  toast(alreadyMoving&&!route.optional?t("editorExtra.new_route_set_as_main_the_old_route_remains_o"):route.optional?t("editorExtra.optional_route_saved_rehearsal_continues_to_u"):t("editorExtra.route_saved_drag_points_to_adjust_it_undo_ava"));
}

function openModal(title, body, footer = '', wide = false) {
  const previous = document.activeElement;
  $('#modal-root').innerHTML = `<div class="modal-backdrop"><section class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true" aria-label="${e(title)}"><header><h2>${e(title)}</h2>${btn('close-modal', 'close', t("editorExtra.close"), 'icon-button')}</header><div class="modal-body">${body}${feedbackBox()}</div>${footer ? `<footer>${footer}</footer>` : ''}</section></div>`;
  $('#modal-root')._previous = previous;
  $('#app').inert = true; document.body.classList.add('modal-open');
  ($('#modal-root').querySelector('.modal-body input:not([readonly]),.modal-body select,.modal-body textarea') || $('#modal-root').querySelector('footer .primary,header button'))?.focus();
}
function closeModal() { $('#app').inert = false; document.body.classList.remove('modal-open'); $('#modal-root').innerHTML = ''; $('#print-root').innerHTML = ''; $('#modal-root')._previous?.focus?.(); document.dispatchEvent(new window.Event('playbook:modal-closed')); }
function localRecoveryModal() {
  if (!localRecovery) return;
  openModal(t("editorExtra.recover_local_playbook"), `<p>${t("editorExtra.the_saved_playbook_could_not_be_read_the_exam")}</p><p class="muted">${localRecovery.raw !== null ? t("editorExtra.download_the_original_file_to_preserve_any_re") : t("editorExtra.the_browser_cannot_currently_read_the_saved_d")}</p><p class="muted small">${t("editorExtra.reason")}${e(localRecovery.error.message)}</p>`, `<button class="button subtle" data-action="download-original" ${localRecovery.raw === null ? 'disabled' : ''}>${t("editorExtra.download_original")}</button><button class="button primary" data-action="retry-local-load">${t("editorExtra.retry_loading")}</button><button class="button subtle" data-action="replace-local-workspace">${t("editorExtra.start_again_from_example")}</button>`);
}
function downloadOriginal() {
  if (!localRecovery) return;
  if (localRecovery.raw === null) { toast(t("editorExtra.the_original_is_unavailable_restore_browser_s"), { type: 'error', action: 'local-recovery', label: t("editorExtra.recovery_options") }); return; }
  download(localRecovery.raw, 'playbook-original-recovery.json', 'application/json');
  toast(t("editorExtra.original_data_exported_unchanged_editing_and_"), { action: 'local-recovery', label: t("editorExtra.recovery_options") });
}
function retryLocalLoad() {
  if (!localRecovery) return;
  const loaded = readLocalWorkspace();
  if (loaded.recovery) {
    localRecovery = { ...loaded.recovery, raw: loaded.recovery.raw ?? localRecovery.raw };
    localRecoveryModal(); feedback(`${t("editorExtra.still_unable_to_read")}${localRecovery.error.message}`, 'error', $('.modal')); return;
  }
  resetAnimation(); selection = null; draft = null; drag = null;
  state = { data: loaded.workspace, selectedId: loaded.workspace.plays[0].id }; book = current().book; query = ''; filter = ''; formationFilter = '';
  history.past = []; history.future = []; localRecovery = null; saveState = t("editorExtra.local_data_loaded");
  closeModal(); render(); toast(t("editorExtra.local_data_recovered_you_can_continue_editing"), { type: 'success' });
}
function newModal() {
  openModal(t("modal.new_play"), `<p class="muted">${t("modal.choose_a_formation_and_draw_your_ideas_on_the_fiel")}</p><label class="form-field"><span>${t("modal.play_name")}</span><input id="new-title" value="${t("modal.new_play")}" maxlength="120"></label><div class="form-row"><label class="form-field"><span>${t("modal.playbook")}</span><select id="new-book">${Object.entries(BOOKS).map(([v]) => option(v, t(v === 'offense' ? 'editor.offense' : v === 'defense' ? 'editor.defense' : 'editor.special_teams'), book)).join('')}</select></label><label class="form-field"><span>${t("modal.players_per_side")}</span><select id="new-count">${[6, 7, 8, 9, 11, 12].map(v => option(String(v), `${v} ${getLocale() === 'en' ? 'players' : '人'}`, String(state.data.settings.league))).join('')}</select></label></div><label class="form-field"><span>${t("modal.formation")}</span><select id="new-formation">${FORMATIONS.map(v => option(v, v, book === 'defense' ? '4–3' : book === 'special' ? 'Field Goal' : 'Gun Trips')).join('')}${state.data.formations.map(f => option(`custom:${f.id}`, `${f.name} · 自定义`, '')).join('')}</select></label>`, `<button class="button subtle" data-action="close-modal">${t("modal.cancel")}</button><button class="button primary" data-action="create-play">${t("modal.create_play")}</button>`);
}
function textModal(at) { openModal(t("modal.add_annotation"), `<label class="form-field"><span>${t("modal.annotation")}</span><input id="annotation-text" placeholder="${t("modal.example_read_1_shallow_cross")}" maxlength="200"></label>`, `<button class="button primary" data-action="create-text" data-x="${at.x}" data-y="${at.y}">${t("modal.place_annotation")}</button>`); }
function exportModal() {
  if (localRecovery) { localRecoveryModal(); return; }
  const pngDescription=pngExportDescription({reference:!!current().reference,digital:document.documentElement.dataset.visualMode==='digital',ready:document.documentElement.dataset.digitalBoard==='ready'});
  openModal(t("modal.export_and_backup"), `<div class="export-grid"><button data-action="download-svg">${icon('route')}<strong>${current().reference ? t("modal.original_diagram") : t("modal.vector_play_diagram")}</strong><small>${current().reference ? t("modal.svg_embeds_source_image") : t("modal.svg_flat_vector_for_presentations")}</small></button><button data-action="download-png">${icon('export')}<strong>${t("modal.high_resolution_image")}</strong><small>PNG · ${pngDescription}</small></button><button data-action="download-json">${icon('book')}<strong>${t("modal.full_playbook")}</strong><small>JSON · ${state.data.plays.length}${t("editorExtra.plays_formations_and_roster")}</small></button><button data-action="download-play">${icon('copy')}<strong>${t("modal.current_play")}</strong><small>${t("modal.json_import_to_continue_editing")}</small></button></div><p class="muted small">${cloudMode() ? t("editorExtra.team_members_automatically_read_the_same_clou") : t("editorExtra.local_preview_saves_only_in_this_browser_use_")}</p>`);
}
function teamModal() {
  openModal(t("modal.team_and_roster"), `<div class="form-row"><label class="form-field"><span>${t("modal.team_name")}</span><input id="team-name" value="${e(state.data.team.name)}" maxlength="80"></label><label class="form-field"><span>${t("modal.season_subtitle")}</span><input id="team-subtitle" value="${e(state.data.team.subtitle)}" maxlength="80"></label></div><div class="form-row"><label class="form-field"><span>${t("modal.team_color")}</span><input id="team-accent" type="color" value="${state.data.team.accent}"></label><label class="form-field"><span>${t("modal.default_players")}</span><select id="team-league">${[6, 7, 8, 9, 11, 12].map(v => option(String(v), `${v} ${getLocale() === 'en' ? 'players' : '人制'}`, String(state.data.settings.league))).join('')}</select></label></div><div class="inspector-divider"></div><div class="inspector-heading"><span>${t("modal.roster")}</span><small>${t("modal.select_a_player_on_the_field_to_assign")}</small></div><div class="roster-labels"><span>${t("modal.number")}</span><span>${t("modal.name")}</span><span>${t("modal.position")}</span><span></span></div><div id="roster-rows">${state.data.roster.map(rosterRow).join('')}</div><button class="text-button" data-action="roster-add">${t("modal.add_player")}</button>`, `<button class="button subtle" data-action="close-modal">${t("modal.cancel")}</button><button class="button primary" data-action="save-team">${t("modal.save_team")}</button>`, true);
}
function rosterRow(r) { return `<div class="roster-row" data-roster-id="${e(r.id)}"><input data-roster-field="number" aria-label="${t("modal.jersey_number")}" value="${e(r.number)}" maxlength="5"><input data-roster-field="name" aria-label="${t("modal.player_name")}" value="${e(r.name)}" maxlength="80"><input data-roster-field="position" aria-label="${t("modal.player_position")}" value="${e(r.position)}" maxlength="15">${btn('roster-remove', 'close', t("modal.remove_row"), 'small-icon')}</div>`; }
function helpModal() {
  openModal(t("editorExtra.bring_plays_to_life"), `<div class="help-intro"><img src="./assets/brand/playbook-studio-icon.svg" width="56" height="30" alt=""><div><strong>Playbook Studio</strong><p>${t("editorExtra.explain_formations_and_routes_in_one_diagram")}</p></div></div><ol class="help-steps"><li><b>${t("editorExtra.choose_a_formation")}</b>${t("editorExtra.apply_a_template_on_the_right_or_drag_players")}</li><li><b>${t("editorExtra.draw_routes")}</b>${t("editorExtra.select_a_player_choose_route_in_the_floating_")}</li><li><b>${t("editorExtra.adjust_timing")}</b>${t("editorExtra.select_a_route_to_adjust_delay_and_duration_s")}</li><li><b>${t("editorExtra.play_and_share")}</b>${t("editorExtra.press_space_to_play_and_scrub_the_timeline_ex")}</li></ol><div class="keyboard-grid">${[['V', t("editorExtra.select_move")], ['R', t("editorExtra.route")], ['B', t("editorExtra.block")], ['M', t("editorExtra.pre_snap_motion")], ['P', t("editorExtra.pass")], ['Z', t("editorExtra.coverage_zone")], ['T', t("editorExtra.text")], ['Space', t("editorExtra.play_pause")], ['Enter', t("editorExtra.finish_route")], ['Esc', t("editorExtra.cancel_close")], ['Ctrl / ⌘ Z', t("feedback.undo")], ['Delete', t("editorExtra.delete_selection")]].map(([k, l]) => `<span><kbd>${k}</kbd>${l}</span>`).join('')}</div><div class="help-about"><strong>${t("editorExtra.about_data_and_implementation")}</strong><p>${t("editorExtra.cloud_playbooks_are_shared_according_to_membe")}</p><p>${t("editorExtra.this_independently_implemented_tool_is_inspir")}</p><a href="https://github.com/TIMPICKLE/playbook-studio-web" target="_blank" rel="noopener">${t("editorExtra.code_and_public_feature_research")}</a></div>`, `<button class="button primary" data-action="close-modal">${t("editorExtra.start_designing")}</button>`, true);
}

function printModal() {
  openModal(t("modal.print_playbook"), `<div class="form-row"><label class="form-field"><span>${t("modal.scope")}</span><select id="print-scope"><option value="current">${t("modal.current_play")}</option><option value="filtered">${t("editorExtra.current_filter")}${filtered().length}${t("editorExtra.plays")}</option><option value="all">${t("editorExtra.all_plays")}${state.data.plays.length}${t("editorExtra.plays")}</option></select></label><label class="form-field"><span>${t("modal.print_layout")}</span><select id="print-layout"><option value="playbook">${t("modal.playbook_2_per_page")}</option><option value="wristband">${t("modal.wristband_9_per_page")}</option><option value="callsheet">${t("modal.call_sheet_play_list")}</option></select></label></div><div id="print-preview" class="print-preview"></div><p class="muted small">${t("modal.use_a4_paper_and_disable_headers_and_footers_you_c")}</p>`, `<button class="button subtle" data-action="close-modal">${t("modal.close")}</button><button class="button primary" data-action="do-print">${t("modal.open_print_dialog")}</button>`, true);
  updatePrint();
}
function updatePrint() {
  const scope = $('#print-scope').value, layout = $('#print-layout').value;
  const plays = scope === 'current' ? [current()] : scope === 'all' ? state.data.plays : filtered();
  const count = layout === 'wristband' ? 9 : layout === 'callsheet' ? 24 : 2;
  let html = '';
  for (let offset = 0; offset < plays.length; offset += count) {
    const group = plays.slice(offset, offset + count);
    const header = `<div class="print-heading"><strong>${e(state.data.team.name)}</strong><span>${layout === 'wristband' ? 'WRISTBAND' : layout === 'callsheet' ? 'CALL SHEET' : 'PLAYBOOK'} · ${e(state.data.team.subtitle)}</span></div>`;
    html += `<article class="print-page ${layout}">${header}${layout === 'callsheet' ? `<table><thead><tr><th>#</th><th>${t("editorExtra.play")}</th><th>${t("modal.formation")}</th><th>${t("editorExtra.category")}</th><th>${t("editorExtra.personnel")}</th></tr></thead><tbody>${group.map((p, i) => `<tr><td>${offset + i + 1}</td><td>${e(p.title)}</td><td>${e(p.formation)}</td><td>${e(p.category)}</td><td>${e(p.personnel)}</td></tr>`).join('')}</tbody></table>` : `<div class="print-cards">${group.map((p, i) => `<section class="print-card"><h3><b>${String(offset + i + 1).padStart(2, '0')}</b> ${e(p.title)}</h3>${fieldSVG(p, { ...state.data.settings, showNames: false }, { print: true, prefix: `print-${offset + i}` })}${layout === 'playbook' ? `<div class="print-meta">${e(p.formation)} · ${e(p.category)} · ${e(p.personnel)}</div><p class="print-notes">${e(p.notes)}</p>` : ''}</section>`).join('')}</div>`}<div class="print-foot">Playbook Studio <span>${Math.floor(offset / count) + 1}</span></div></article>`;
  }
  $('#print-root').innerHTML = html;
  $('#print-preview').innerHTML = html || `<p>${t("editorExtra.no_plays_in_the_current_filter_to_print")}</p>`;
  if (html) $('#print-preview').querySelectorAll('[id]').forEach(n => n.id = `preview-${n.id}`);
  // Prefix SVG reference IDs in the preview to avoid duplicate marker bindings.
  $('#print-preview').innerHTML = $('#print-preview').innerHTML.replace(/url\(#print-/g, 'url(#preview-print-');
}
function download(content, filename, mime) {
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const link = document.createElement('a'); link.href = url; link.download = filename; document.body.append(link); link.click(); link.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 10000);
}
const safeName = name => name.replace(/[\\/:*?"<>|]/g, '-').slice(0, 100) || 'play';
async function standaloneSVG(play, digital = false) {
  const capture = digital && !play.reference ? digitalBoard?.capture() : null;
  let svg = fieldSVG(play, viewSettings(), { prefix: 'export', time: capture?.time || 0 });
  if (capture) {
    const template=document.createElement('template');template.innerHTML=svg;const root=template.content.firstElementChild;
    updateAnimation(root,play,capture.time,'export');
    svg=composeDigitalExport(root,capture).outerHTML;
  }
  if (play.reference) {
    const response = await fetch(new URL(`./${play.reference.image}`, import.meta.url));
    if (!response.ok) throw new Error(t("feedback.could_not_load_the_source_diagram_try_again"));
    const blob = await response.blob();
    const dataUrl = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(blob); });
    svg = svg.replace(`href="./${play.reference.image}"`, `href="${dataUrl}"`);
  }
  return svg;
}
async function pngExport() {
  const play = clone(current());
  let svg;
  try { svg = await standaloneSVG(play, true); } catch { toast(t("feedback.image_generation_failed_switch_to_traditional_mode_and_"), { type: 'error', action: 'download-png', label: t("feedback.retry") }); return; }
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  const img = new Image();
  img.onload = () => {
    try {
      const canvas = document.createElement('canvas'); canvas.width = 2000; canvas.height = play.reference ? 1120 : 1600; const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Canvas unavailable'); ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      canvas.toBlob(blob => { if (blob) { const u = URL.createObjectURL(blob), a = document.createElement('a'); a.href = u; a.download = `${safeName(play.title)}.png`; document.body.append(a); a.click(); a.remove(); window.setTimeout(() => URL.revokeObjectURL(u), 10000); toast(t("feedback.png_created"), { type: 'success' }); } else toast(t("feedback.png_generation_failed_try_exporting_svg"), { type: 'error' }); }, 'image/png');
    } catch { toast(t("feedback.this_browser_cannot_create_png_try_exporting_svg"), { type: 'error' }); }
    URL.revokeObjectURL(url);
  };
  img.onerror = () => { URL.revokeObjectURL(url); toast(t("feedback.image_generation_failed_try_exporting_svg"), { type: 'error' }); }; img.src = url;
}
function togglePlay() {
  if (current().reference) { toast(t("feedback.the_original_diagram_has_no_playable_route_data"), { type: 'info' }); return; }
  if(draft && !confirmDraft(togglePlay))return;
  if(playing){stop();syncPlayback();updateCanvasHint();return;}
  if(time>=animationLength(current()))time=0;
  rehearsal=true;playing=true;draft=null;previewPoint=null;
  renderField();syncEditorChrome();
  const tick=stamp=>{
    if(!playing)return;
    if(lastFrame!==null)time+=Math.min((stamp-lastFrame)/1000,.1)*speed;
    lastFrame=stamp;
    if(time>=animationLength(current())) {
      if(loop)time%=animationLength(current());
      else{time=animationLength(current());stop();updateAnimation($('#field svg'),current(),time);syncPlayback();updateCanvasHint();return;}
    }
    updateAnimation($('#field svg'),current(),time);syncPlayback();
    frame=requestAnimationFrame(tick);
  };
  frame=requestAnimationFrame(tick);
}

function deleteSelected() {
  if (!selection || !selectedObject()) return;
  const s = selection;
  if (s.type === 'player' && current().players.length <= 1) { toast(t("modal.keep_at_least_one_player"), { type: 'warning' }); return; }
  selection = null;
  edit(p => {
    const key = { player: 'players', route: 'routes', zone: 'zones', annotation: 'annotations' }[s.type]; p[key] = p[key].filter(x => x.id !== s.id);
    if (s.type === 'player') { p.routes = p.routes.filter(r => r.playerId !== s.id); if (p.ball.holderId === s.id) p.ball.holderId = p.players[0].id; if (p.ball.receiverId === s.id) p.ball.receiverId = ''; }
  }); toast(t("modal.object_deleted_undo_to_restore_it"), { type: 'success' });
}
const actions = {
  'local-recovery': localRecoveryModal,
  'download-original': downloadOriginal,
  'retry-local-load': retryLocalLoad,
  'replace-local-workspace': () => {
    if (!localRecovery) return;
    openModal(t("editorExtra.replace_unreadable_local_data"), `<p>${t("editorExtra.confirming_replaces_the_original_local_data_w")}</p><p><strong>${t("editorExtra.original_data_that_has_not_been_downloaded_wi")}</strong>${t("editorExtra.return_to_recovery_options_and_download_the_o")}</p>`, `<button class="button subtle" data-action="local-recovery">${t("editorExtra.keep_original")}</button><button class="button danger" data-action="confirm-replace-local-workspace">${t("editorExtra.replace_and_start_editing")}</button>`);
  },
  'confirm-replace-local-workspace': () => {
    if (!localRecovery || !save({ replaceUnreadable: true })) return;
    localRecovery = null; history.past = []; history.future = []; closeModal(); render();
    toast(t("editorExtra.a_new_local_playbook_was_created_from_the_exa"), { type: 'success' });
  },
  'convert-reference': () => {
    const entry = getEditableEntry(current().reference?.catalogId);
    if (!entry) return;
    const outcome = importMadden({ ...entry, name: current().title, personalNotes: current().notes, personalFavorite: current().favorite });
    if (outcome?.ok) toast(t("feedback.editable_copy_created_the_original_is_retained_undo_is_"), { type: 'success' });
    else if (outcome?.message) toast(outcome.message, { type: 'warning' });
  },
  'compare-source': () => {
    const source = current().diagramSource; if (!source) return;
    openModal(t("editorExtra.compare_source_2") + current().title, `<img class="source-comparison" src="./${e(source.image)}" alt="${e(current().title)}${t("editorExtra.source_diagram")}"><p class="muted small">${t("editorExtra.positions_and_visible_routes_were_reconstruct")}</p><a href="${e(source.sourceUrl)}" target="_blank" rel="noopener noreferrer">${t("editorExtra.view_huddle_gg_source")}</a>`, `<button class="button primary" data-action="close-modal">${t("editorExtra.back_to_editor")}</button>`, true);
  },
  'space-madden-line': () => {
    if (!canEdit() || !current().diagramSource) return;
    if (!confirmDraft(() => actions['space-madden-line']())) return;
    const updated = clone(current()), result = spaceMaddenLine(updated);
    if (!result.changed) {
      toast(result.reason === 'already-spaced' ? t("feedback.line_spacing_is_already_sufficient") : t("feedback.the_line_cannot_be_safely_adjusted_automatically_please"), { type: 'warning' });
      return;
    }
    edit(p => Object.assign(p, updated));
    toast(t("feedback.line_and_nearby_player_spacing_adjusted_undo_is_availab"), { type: 'success' });
  },
  'madden-library': () => { resetAnimation(); if (confirmDraft(() => {panels.close({focus:false});maddenLibrary.open();})) {panels.close({focus:false});maddenLibrary.open();} },
  'clear-filters': () => { query=''; filter=''; formationFilter=''; render(); },
  'keep-drawing': () => { pendingNavigation=null; closeModal(); },
  'discard-draft': () => { draft=null; const next=pendingNavigation; pendingNavigation=null; closeModal(); next?.(); },
  new: newModal, 'close-modal': closeModal, export: exportModal, team: teamModal, help: helpModal, print: printModal,
  sidebar: () => panels.toggle('plays'),
  'inspector-panel': () => panels.toggle('properties'),
  'close-panel': () => panels.close(),
  'panel-field': () => { panels.close({focus:false});$('#field')?.scrollIntoView?.({block:'nearest'}); },
  'dismiss-toast': () => $('#toast').classList.remove('visible'),
  'undo-point': () => {if(draft?.points.length>1){draft.points.pop();previewPoint=null;renderField();updateCanvasHint();}},
  'edit-mode': () => {if(!confirmDraft(()=>actions['edit-mode']()))return;resetAnimation();rehearsal=false;renderField();syncEditorChrome();},
  'rehearse-mode': () => {if(!confirmDraft(()=>actions['rehearse-mode']()))return;rehearsal=true;draft=null;renderField();syncEditorChrome();},
  favorite: () => edit(p => { p.favorite = !p.favorite; }),
  undo: () => restore(history.undo(state)), redo: () => restore(history.redo(state)),
  mirror: () => { const mirrored = mirrorPlay(current()); edit(p => Object.assign(p, mirrored)); toast(t("modal.players_routes_zones_and_annotations_mirrored"), { type: 'success' }); },
  duplicate: () => { if (state.data.plays.length >= 500) { toast(t("modal.the_playbook_can_contain_at_most_500_plays"), { type: 'warning' }); return; } const copy = clone(current()); copy.id = uid(); copy.title = `${copy.title} · 副本`.slice(0, 120); copy.createdAt = new Date().toISOString(); selection = null; edit((p, d) => { d.plays.push(copy); state.selectedId = copy.id; }); },
  'clear-selection': () => {if(!confirmDraft(()=>actions['clear-selection']()))return; selection=null;draft=null;tool='select';refreshSelection();syncEditorChrome();},
  grid: () => { viewOverrides.showGrid = viewSettings().showGrid === false; renderField(); syncEditorChrome(); },
  theme: () => { viewOverrides.fieldTheme = viewSettings().fieldTheme === 'light' ? 'dark' : 'light'; renderField(); syncEditorChrome(); },
  'finish-route': finishRoute, 'cancel-draft': () => { draft=null;previewPoint=null;tool='select';renderField();syncEditorChrome(); },
  'delete-selection': deleteSelected,
  'create-play': () => {
    if (state.data.plays.length >= 500) { toast(t("modal.the_playbook_can_contain_at_most_500_plays"), { type: 'warning' }); return; }
    const title = $('#new-title').value.trim(), b = $('#new-book').value, form = $('#new-formation').value, count = Number($('#new-count').value);
    if (!title) { feedback(t("modal.enter_a_play_name_before_creating_it")); $('#new-title').focus(); return; }
    const custom = form.startsWith('custom:') ? state.data.formations.find(f => f.id === form.slice(7)) : null;
    const p = makePlay({ title, formation: custom?.name || form, book: b, count });
    if (getLocale() === 'en') { p.category = t(b === 'defense' ? 'editor.demo_zone' : 'editor.demo_pass'); if (count !== 11) p.personnel = `${count} players`; }
    if (custom) { p.players = clone(custom.players); p.ball.holderId = p.players.find(v => v.label === 'QB')?.id || p.players[0].id; }
    closeModal(); selection = null; book = b; query = ''; filter = ''; formationFilter = ''; edit((_, d) => { d.plays.push(p); state.selectedId = p.id; d.settings.league = count; });
  },
  'create-text': node => { const value = $('#annotation-text').value.trim(); if (!value) { toast(t("modal.enter_annotation_text"), { type: 'warning' }); return; } const a = { id: uid(), text: value, x: Number(node.dataset.x), y: Number(node.dataset.y) }; closeModal(); selection = { type: 'annotation', id: a.id }; tool = 'select'; edit(p => p.annotations.push(a)); },
  'save-formation': () => openModal(t("modal.save_custom_formation"), `<p class="muted small">${t("modal.only_starting_positions_labels_and_colors_are_save")}</p><label class="form-field"><span>${t("modal.formation_name")}</span><input id="formation-name" value="${e(current().formation)} · 自定义" maxlength="100"></label>`, `<button class="button primary" data-action="confirm-formation">${t("modal.save_formation")}</button>`),
  'confirm-formation': () => { const name = $('#formation-name').value.trim(); if (!name) return; if (state.data.formations.length >= 100) { toast(t("editorExtra.at_most_100_custom_formations_can_be_saved"), { type: 'warning' }); return; } const f = { id: uid(), name, book: current().book, players: clone(current().players) }; closeModal(); edit((p, d) => { d.formations.push(f); p.formation = name; }); toast(t("editorExtra.custom_formation_saved_and_available_for_new_"), { type: 'success' }); },
  'add-defense-43': confirmed => {
    if (current().players.filter(p => p.side !== 'defense').length + 11 > 40) { toast(t("editorExtra.adding_the_defense_would_exceed_40_player_mar"), { type: 'warning' }); return; }
    const defenders=new Set(current().players.filter(p=>p.side==='defense').map(p=>p.id)), routes=current().routes.filter(r=>defenders.has(r.playerId)).length;
    if(routes && confirmed!==true){
      actions['confirm-defense-43']=()=>{closeModal();actions['add-defense-43'](true);};
      openModal(t("editorExtra.reset_the_4_3_defense"),`<p>${t("editorExtra.reposition_defenders_as_4_linemen_3_linebacke")}<strong>${routes}${t("editorExtra.routes")}</strong>。</p><p class="muted">${t("editorExtra.offensive_players_and_routes_are_retained_you")}</p>`,`<button class="button subtle" data-action="close-modal">${t("editorExtra.keep_current_defense")}</button><button class="button primary" data-action="confirm-defense-43">${t("editorExtra.reset_defense_and_clear_routes")}</button>`);return;
    }
    const hadDefense = current().players.some(p => p.side === 'defense');
    selection = null; tool = 'select';
    edit(p => {
      const oldDefense = new Set(p.players.filter(v => v.side === 'defense').map(v => v.id));
      p.players = [...p.players.filter(v => !oldDefense.has(v.id)), ...formationPlayers('4–3', 11, 'defense')];
      p.routes = p.routes.filter(r => !oldDefense.has(r.playerId));
      if (oldDefense.has(p.ball.holderId)) p.ball.holderId = p.players.find(v => v.label === 'QB' && v.side === 'offense')?.id || p.players[0].id;
      if (oldDefense.has(p.ball.receiverId)) p.ball.receiverId = '';
    });
    toast(`${hadDefense ? t("editorExtra.reset") : t("editorExtra.added")}${t("editorExtra.4_3_defense_4_linemen_3_linebackers_4_defensi")}`);
  },
  opponents: () => {
    const side = current().book === 'defense' ? 'offense' : 'defense', remove = current().players.some(v => v.side === side);
    if (remove && current().players.every(v => v.side === side)) { toast(t("editorExtra.the_formation_has_only_players_from_this_side"), { type: 'warning' }); return; }
    if (!remove && current().players.length + state.data.settings.league > 40) { toast(t("editorExtra.adding_players_would_exceed_40_markers_remove"), { type: 'warning' }); return; }
    edit(p => { if (remove) { const ids = new Set(p.players.filter(v => v.side === side).map(v => v.id)); p.players = p.players.filter(v => !ids.has(v.id)); p.routes = p.routes.filter(r => !ids.has(r.playerId)); if (ids.has(p.ball.holderId)) p.ball.holderId = p.players[0].id; if (ids.has(p.ball.receiverId)) p.ball.receiverId = ''; } else p.players.push(...formationPlayers(side === 'offense' ? 'Gun Doubles' : '4–3', state.data.settings.league, side)); });
  },
  'delete-play': () => { if (state.data.plays.length === 1) { toast(t("editorExtra.keep_at_least_one_play"), { type: 'warning' }); return; } openModal(t("modal.delete_this_play"), `<p>${t("editorExtra.delete")}${e(current().title)}${t("editorExtra.this_change_can_be_undone")}</p>`, `<button class="button subtle" data-action="close-modal">${t("modal.cancel")}</button><button class="button danger" data-action="confirm-delete">${t("modal.delete_play")}</button>`); },
  'confirm-delete': () => { const id = current().id; closeModal(); selection = null; edit((p, d) => { d.plays = d.plays.filter(p => p.id !== id); state.selectedId = d.plays.find(p => p.book === book)?.id || d.plays[0].id; book = current().book; }); },
  'roster-add': () => { if ($('#roster-rows').children.length >= 200) { toast(t("editorExtra.the_roster_can_contain_at_most_200_players"), { type: 'warning' }); return; } $('#roster-rows').insertAdjacentHTML('beforeend', rosterRow({ id: uid(), name: '', number: '', position: '' })); },
  'roster-remove': node => node.closest('.roster-row').remove(),
  'save-team': () => { const team = { name: $('#team-name').value.trim() || 'MY TEAM', subtitle: $('#team-subtitle').value, accent: $('#team-accent').value }; const league = Number($('#team-league').value); const roster = [...$('#roster-rows').children].map(row => ({ id: row.dataset.rosterId, ...Object.fromEntries([...row.querySelectorAll('input')].map(n => [n.dataset.rosterField, n.value.trim()])) })).filter(r => r.name); closeModal(); edit((p, d) => { d.team = team; d.roster = roster; d.settings.league = league; }); toast(t("modal.team_and_roster_saved"), { type: 'success' }); },
  import: () => $('#import-input').click(),
  'download-svg': async () => { const play = clone(current()); try { download(await standaloneSVG(play), `${safeName(play.title)}.svg`, 'image/svg+xml'); toast(t("feedback.svg_diagram_created"), { type: 'success' }); } catch { toast(t("feedback.could_not_load_the_source_diagram_try_again"), { type: 'error', action: 'download-svg', label: t("feedback.retry") }); } },
  'download-png': pngExport,
  'download-json': () => { if (localRecovery) { downloadOriginal(); return; } download(encodeWorkspace(state.data), `${safeName(state.data.team.name)}-playbook.json`, 'application/json'); toast(t("feedback.full_playbook_exported"), { type: 'success' }); },
  'download-play': () => { download(encodeWorkspace({ ...state.data, plays: [current()] }), `${safeName(current().title)}.json`, 'application/json'); toast(t("feedback.current_play_exported"), { type: 'success' }); },
  'do-print': () => { if (!$('#print-root').children.length) { toast(t("feedback.no_plays_to_print"), { type: 'warning' }); return; } window.print(); },
  play: togglePlay, reset: () => {resetAnimation();updateAnimation($('#field svg'),current(),0);syncPlayback();updateCanvasHint();}, loop: node => {loop=!loop;node.classList.toggle('enabled',loop);node.setAttribute('aria-pressed',loop);}
};

document.addEventListener('click', event => {
  for(const menu of document.querySelectorAll('.add-object-menu[open],.account-menu[open]'))if(!menu.contains(event.target))menu.open=false;
  const node = event.target.closest('[data-action]'); if (!node || node.disabled) return;
  const [name, ...parts] = node.dataset.action.split(':'), value = parts.join(':');
  if (current().reference && ['mirror','rehearse-mode','add-player','add-defense-43','opponents','save-formation'].includes(name)) { toast(t("editorExtra.the_original_diagram_has_no_editable_player_c"), { type: 'info' }); return; }
  if(name==='dismiss-toast'){actions[name]();return;}
  if (!canEdit() && !readActions.has(name) && !(name === 'tool' && value === 'select')) { toast(editBlockedMessage(), { type: 'warning' }); return; }
  if(node.closest('.add-object-menu'))node.closest('details').open=false;
  if (name === 'choose') return choose(value);
  if (['book','new','import','add-player','add-defense-43','opponents','mirror'].includes(name) && !confirmDraft(() => node.click())) return;
  if (name === 'book') { resetAnimation(); draft = null; selection = null; book = value; filter = ''; formationFilter = ''; query = ''; panels.close({focus:false}); const p = filtered()[0]; if (p) state.selectedId = p.id; render(); return; }
  if (name === 'tool') { setTool(value); return; }
  if (name === 'select-route') { selection = { type: 'route', id: value }; tool = 'select'; draft = null; refreshSelection(); return; }
  if (name === 'add-player') { if (current().players.length >= 40) { toast(t("editorExtra.each_play_can_have_at_most_40_player_markers"), { type: 'warning' }); return; } const p = { id: uid(), label: value === 'offense' ? 'WR' : 'DB', x: 25, y: value === 'offense' ? 75 : 45, name: '', side: value, color: COLORS[value], shape: value === 'offense' ? 'circle' : 'square' }; selection = { type: 'player', id: p.id }; edit(play => play.players.push(p)); return; }
  actions[name]?.(node);
});
function refreshPlayList() {
  const p = current(), plays = filtered();
  $('.play-list').innerHTML = plays.length ? plays.map((v, i) => `<button data-action="choose:${e(v.id)}" class="play-card ${p.id === v.id ? 'active' : ''}" aria-label="${t("editorExtra.open")}${e(v.title)}" aria-pressed="${p.id === v.id}"><div class="play-thumb">${fieldSVG(v, { showGrid: false }, { thumbnail: true, prefix: `thumb-${i}` })}</div><span class="play-card-info"><strong>${e(v.title)}</strong><small>${e(v.formation)} · ${e(v.category)}</small></span>${v.favorite ? '<span class="favorite-dot">★</span>' : ''}</button>`).join('') : `<div class="empty-list">${t("editorExtra.no_matching_plays_found")}<br>${t("editorExtra.try_another_search_or_clear_the_filters")}<button class="text-button" data-action="clear-filters">${t("editorExtra.clear_all_filters")}</button></div>`;
  $('.play-list-label b').textContent = plays.length;
}
let composingSearch = false;
function searchInput(input) { query = input.value; refreshPlayList(); }
document.addEventListener('compositionstart', event => { if (event.target.id === 'search') composingSearch = true; });
document.addEventListener('compositionend', event => { if (event.target.id === 'search') { composingSearch = false; searchInput(event.target); } });
document.addEventListener('input', event => {
  const input = event.target;
  if (input.id === 'search' && !composingSearch && !event.isComposing) searchInput(input);
  if(input.id==='timeline'){stop();rehearsal=true;time=Number(input.value);updateAnimation($('#field svg'),current(),time);syncEditorChrome();}
});
document.addEventListener('change', event => {
  const input = event.target;
  if (!canEdit() && (input.dataset.prop || input.dataset.ball || input.id === 'apply-formation')) return;
  if (input.id === 'category-filter') { filter = input.value; render(); }
  else if (input.id === 'formation-filter') { formationFilter = input.value; render(); }
  else if(input.id==='draft-mode' && draft)draft.mode=input.value;
  else if (input.id === 'speed') speed = Number(input.value);
  else if (input.id === 'show-names') { viewOverrides.showNames = input.checked; render(); }
  else if (input.id === 'print-scope' || input.id === 'print-layout') updatePrint();
  else if (input.id === 'apply-formation' && input.value) {
    const [kind, ...rest] = input.value.split(':'), value = rest.join(':');
    const custom = kind === 'custom' ? state.data.formations.find(f => f.id === value) : null;
    const players = custom ? clone(custom.players) : formationPlayers(value, state.data.settings.league, current().book === 'defense' ? 'defense' : 'offense');
    const apply = () => { closeModal(); edit(p => { p.players = players; p.formation = custom?.name || value; p.routes = []; p.zones = []; p.annotations = []; p.ball.holderId = players.find(v => v.label === 'QB')?.id || players[0].id; p.ball.receiverId = ''; }); toast(t("editorExtra.formation_replaced_and_routes_and_annotations"), { type: 'success' }); };
    if (current().routes.length || current().zones.length || current().annotations.length) {
      actions['confirm-apply-formation'] = () => { delete actions['confirm-apply-formation']; apply(); };
      input.value = '';
      openModal(t("editorExtra.replace_the_starting_formation"), `<p>${t("editorExtra.replace_the_current_play_with")}<strong>${e(custom?.name || value)}</strong>。</p><p>${t("editorExtra.this_will_clear")}${current().routes.length}${t("editorExtra.routes")}、${current().zones.length}${t("editorExtra.zones_and")}${current().annotations.length}${t("editorExtra.annotations_the_roster_and_other_plays_are_un")}</p>`, `<button class="button subtle" data-action="close-modal">取消</button><button class="button primary" data-action="confirm-apply-formation">${t("editorExtra.replace_formation_and_clear_routes")}</button>`);
    } else apply();
  } else if (input.dataset.ball) {
    edit(p => { p.ball[input.dataset.ball] = input.value; if (p.ball.holderId === p.ball.receiverId) p.ball.receiverId = ''; }, {redraw:false});
    const receiver=$('[data-ball="receiverId"]'); if(receiver)receiver.innerHTML=`<option value="">${t("editorExtra.no_pass_run")}</option>${current().players.filter(v=>v.id!==current().ball.holderId).map(v=>option(v.id,`${v.label}${v.name?' · '+v.name:''}`,current().ball.receiverId)).join('')}`;
    const summary=$('.ball-section > summary small'); if(summary)summary.textContent=ballSummary(current());
  }
  else if (input.dataset.prop) {
    const key = input.dataset.prop;
    let value = input.type === 'checkbox' ? input.checked : input.type === 'number' ? Number(input.value) : input.value;
    if (input.type === 'number') { if (!Number.isFinite(value)) return; value = clamp(value, Number(input.min), Number(input.max)); }
    if (key.startsWith('ball.')) {
      const name = key.slice(5), ball = { ...current().ball, [name]: value };
      if (ball.arriveAt <= ball.passAt) { toast('到达时间必须晚于出手时间。', { type: 'info' }); input.value = current().ball[name]; return; }
      edit(p => { p.ball[name] = value; }, {redraw:false});
    } else {
      const selected = !!selection, s = selection;
      edit((p, d) => { const obj = selected ? p[{ player: 'players', route: 'routes', zone: 'zones', annotation: 'annotations' }[s.type]].find(v => v.id === s.id) : p; if (!obj) return; if (key === 'roster') obj.name = d.roster.find(r => r.id === value)?.name || ''; else { obj[key] = value; if (key === 'kind' && value === 'block') obj.endCap = 'bar'; if (s?.type === 'route' && ((key === 'optional' && value === false) || key === 'kind') && !obj.optional && ['route', 'motion'].includes(obj.kind)) p.routes.filter(r => r.id !== obj.id && r.playerId === obj.playerId && ['route', 'motion'].includes(r.kind)).forEach(r => { r.optional = true; }); } }, {redraw:false});
      if(key==='roster' && $('[data-prop="name"]'))$('[data-prop="name"]').value=selectedObject().name;
      if(key==='kind' && $('[data-prop="endCap"]'))$('[data-prop="endCap"]').value=selectedObject().endCap;
    }
  }
});
$('#import-input').addEventListener('change', async event => {
  const file = event.target.files[0]; if (!file) return;
  try {
    if (file.size > 5_000_000) throw new Error(t("editorExtra.import_a_file_under_5_mb"));
    const imported = decodeWorkspace(await file.text());
    if (state.data.plays.length + imported.plays.length > 500) throw new Error(t("editorExtra.the_playbook_cannot_exceed_500_plays"));
    openModal(t("editorExtra.import_playbook_2"), `<p>${t("editorExtra.the_validated_file_contains")}<strong>${imported.plays.length}${t("editorExtra.plays_2")}</strong>、${imported.formations.length}${t("editorExtra.custom_formations_and")}${imported.roster.length}${t("editorExtra.roster_members")}</p><p class="muted small">${t("editorExtra.import_appends_plays_formations_and_roster_me")}</p>`, `<button class="button subtle" data-action="close-modal">取消</button><button class="button primary" data-action="confirm-import">${t("editorExtra.append_import")}</button>`);
    actions['confirm-import'] = () => {
      if (state.data.formations.length + imported.formations.length > 100 || state.data.roster.length + imported.roster.length > 200) { toast(t("editorExtra.import_would_exceed_the_formation_or_roster_l"), { type: 'info' }); return; }
      const plays = imported.plays.map(p => ({ ...p, id: uid() })), forms = imported.formations.map(f => ({ ...f, id: uid() })), roster = imported.roster.map(r => ({ ...r, id: uid() }));
      closeModal(); selection = null; book = plays[0].book; query = ''; filter = ''; formationFilter = ''; edit((p, d) => { d.plays.push(...plays); d.formations.push(...forms); d.roster.push(...roster); state.selectedId = plays[0].id; }); toast(`${t("editorExtra.imported")}${plays.length}${t("editorExtra.plays_3")}`); delete actions['confirm-import'];
    };
  } catch (error) { toast(`${t("editorExtra.import_failed")}${error.message}`, { type: 'error' }); }
  event.target.value = '';
});
document.addEventListener('keydown', event => {
  if (maddenLibrary.isOpen) { if (event.key === 'Escape') maddenLibrary.close(); return; }
  const modal = $('.modal');
  if (modal) {
    if (event.key === 'Escape') { pendingNavigation=null; closeModal(); }
    if (event.key === 'Enter' && event.target.matches('input') && !event.target.closest('form')) { const primary=modal.querySelector('footer .button.primary:not(:disabled)'); if(primary){event.preventDefault();primary.click();} }
    if (event.key === 'Tab') { const inputs = [...modal.querySelectorAll('button,input,select,textarea,a[href]')].filter(n => !n.disabled); const first = inputs[0], last = inputs.at(-1); if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); } }
    return;
  }
  if (['INPUT', 'TEXTAREA', 'SELECT'].includes(event.target.tagName) || event.target.isContentEditable) return;
  const key = event.key.toLowerCase();
  if ((event.ctrlKey || event.metaKey) && key === 'z') { event.preventDefault(); restore(event.shiftKey ? history.redo(state) : history.undo(state)); return; }
  if ((event.ctrlKey || event.metaKey) && key === 'y') { event.preventDefault(); restore(history.redo(state)); return; }
  if (event.key === ' ') { event.preventDefault(); togglePlay(); }
  else if (event.key === 'Enter' && draft) { event.preventDefault(); finishRoute(); }
  else if (event.key === 'Escape') { draft = null; selection = null; tool = 'select'; render(); }
  else if (event.key==='Backspace' && draft) {event.preventDefault();actions['undo-point']();}
  else if (event.key === 'Delete' || event.key === 'Backspace') {event.preventDefault();if(!rehearsal)deleteSelected();}
  else if (key === '?') helpModal();
  else if (canEdit() && !event.ctrlKey && !event.metaKey && ({ v: 'select', r: 'route', b: 'block', m: 'motion', p: 'pass', z: 'zone', t: 'text' })[key]) {setTool(({v:'select',r:'route',b:'block',m:'motion',p:'pass',z:'zone',t:'text'})[key]);}
});
initViewportLayout();
digitalBoard = createDigitalBoard({getState:()=>({play:current(),settings:viewSettings(),selected:selection,time,playing,rehearsal,draggingId:drag?.type==='player'&&drag.moved?drag.id:null}),notify:message=>toast(message,{type:'warning'})});
initEffects();
render();
if (localRecovery) { toast(recoveryMessage, { type: 'error', action: 'local-recovery', label: t("editorExtra.recovery_options") }); localRecoveryModal(); }
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('./sw.js').catch(() => {});

if (cloudMode()) {
  document.body.classList.add('cloud-enabled');
  const matchupView = createMatchupView({ root: $('#ai-matchup-root'), request, getCurrent: () => shared?.current, getData: () => state.data, isDirty: () => !!shared?.dirty });
  shared = new SharedWorkspace({
    onData(data) {
      resetAnimation(); selection = null; draft = null; drag = null;
      const selectedId = data.plays.some(p => p.id === state.selectedId) ? state.selectedId : data.plays[0].id;
      state = { data, selectedId }; book = current().book; query = ''; filter = ''; formationFilter = '';
      history.past = []; history.future = []; render();
    },
    onStatus(value) { saveState = value; $('#save-state')?.replaceChildren(document.createTextNode(value)); },
    onAnalysisData(data, record) { matchupView.onData(data, record); },
    onPermissionLost(error) { resetAnimation(); draft = null; drag = null; render(); toast(error.message || t("editorExtra.access_changed_sign_in_again_or_contact_an_ad"), { type: 'error' }); },
    showEditor(show) { if (!show) maddenLibrary.close(); $('#app').hidden = !show; $('.skip-link').hidden = !show; },
    showAnalysis(show) { matchupView.show(show); },
    isBusy: () => !!drag || !!draft || playing || !!$('.modal') || ['INPUT','TEXTAREA','SELECT'].includes(document.activeElement?.tagName),
    openModal, closeModal, toast, download
  });
  shared.init();
} else if (location.hostname !== 'localhost') {
  $('#cloud-root').innerHTML = `<div class="cloud-local-entry"><span>${t("editor.local_offline_preview_changes_stay_in_this_browser")}</span><a class="button primary" href="${CLOUD_SITE}/editor/index.html" target="_top">${t("editor.open_cloud_app")}</a></div>`;
}

// This control is independent of the editor so it also works on sign-in and home.
const localeControl = document.createElement('div');
localeControl.className = 'locale-control';
localeControl.innerHTML = `<label for="locale-select">${t('editor.language')}</label><select id="locale-select" aria-label="${t('editor.language')}"><option value="zh-CN">简体中文</option><option value="en">English</option></select>`;
document.body.append(localeControl);
const localeSelect = localeControl.querySelector('select');
localeSelect.value = getLocale();
document.documentElement.lang = getLocale();
localeSelect.addEventListener('change', () => {
  const next = localeSelect.value;
  if (next === getLocale()) return;
  if (shared?.sync?.dirty || saveState === t("feedback.not_saved") || localRecovery || drag) {
    alert(t('editor.language_unsaved')); localeSelect.value = getLocale(); return;
  }
  if ((draft || document.querySelector('.modal') || document.querySelector('#ai-matchup-root:not([hidden])') || [...document.querySelectorAll('#cloud-root input')].some(input => input.value)) && !confirm(t('editor.language_discard_draft'))) { localeSelect.value = getLocale(); return; }
  try { setLocale(next); location.reload(); }
  catch { alert(t('editor.language_storage_error')); localeSelect.value = getLocale(); }
});
