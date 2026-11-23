import { t, getLocale, setLocale } from './i18n.js';
import { createDigitalBoard } from './digital-board.js';
import { digitalFieldPalette, digitalFieldChrome } from './digital-field-palette.js';
import { pngFrameSVG, pngExportDescription } from './digital-export.js';
import { createMaddenLibrary } from './madden.js';
import { createBoardAssistant } from './board-assistant.js';
import { animateAssistantLayer } from './assistant-transition.js';
import { captureHistoryFrame, presentHistoryFrame } from './history-transition.js';
import { withDefense43 } from './defense-formation.js';
import { LEAGUE_SIZES, getPlayLeague, isFlag5Play, formationOptions, defaultFormation } from './game-formats.js';
import { competingMainRoutes, prepareWaypointMove, runEditorPlayCommand } from './editor-play-commands.js';
import { prepareEditorActions, usesLivePlayback } from './editor-actions.js';
import { selectedPlayerIds, playerSelection, togglePlayerSelection } from './editor-selection.js';
import { deviceIsTraditional } from './visual-mode.js';
import { assistantPlayers } from './assistant-edit.js';
import { stageEdit, StagedEditConflict } from './assistant-draft.js';
import { requestBoardAssistant } from './assistant-provider.js';
import { loadAssistantCatalog, resolveMaddenResults } from './assistant-search.js';
import { hasEditableTrace, getEditableEntry, loadEditableEntries, spaceMaddenLine, teamDisplayName } from './madden-model.js';
import { maddenLoadingCopy } from './locales/madden-loading.js';
import { feedback, feedbackBox } from './ui.js';
import { SharedWorkspace, cloudMode, request } from './cloud.js';
import { startGuestWorkspace } from './guest-workspace.js';
import { createRosterView } from './roster.js';
import { clearDepthPlayer } from './depth-model.js';
import { personnelAssignments, refreshRosterBindings } from './board-personnel.js';
import { createMatchupView, resolveHandoffContext } from './ai-matchup.js';
import { createDemoRequest } from './ai-demo.js';
import { BOOKS, COLORS, STORAGE_KEY, clone, uid, clamp, escapeHTML as e, starterWorkspace, prepareWorkspaceAppend, preparePlayerTranslation, animationLength, encodeWorkspace, decodeWorkspace, validatePlay, History } from './model.js';
import { fieldSVG, updateAnimation, bindGestureGeometry, previewDraft, displayColor, syncFieldHitTargets, fieldHitCandidates } from './field.js';
import { fieldCoordinates } from './field-coordinates.js';
import { createScrubPresentation } from './scrub-presentation.js';
import { createPlaybackClock } from './playback-clock.js';
import { enterContext, enterPlayers, revealPlay, enterWorkbench } from './motion.js';
import { effectsControl, initEffects, syncPageDecoration, burstAt, setEffectsMode, visualMode } from './effects.js';
import { createBoardLayout, boardSizeControls, boardHeightHandle, boardWidthHandle } from './board-layout.js';
import { initViewportLayout, captureEditorScroll } from './viewport-layout.js';
import { createWorkspacePanels,isCompactWorkspace } from './workspace-panels.js';
import { createPlayThumbnails } from './play-thumbnails.js';
import { createOnboarding } from './onboarding.js';
import { onboardingSteps, onboardingLabels } from './onboarding-steps.js';
import { patchEditorHTML } from './editor-render.js';
import { canRefreshHistoryField, EditorHistory, PersonnelHistoryConflict } from './editor-history.js';
import { workspaceNavigation, createWorkspaceSessions } from './workspace-ui.js';
import { clearModelCredential } from './model-connection.js';

// The comparison study is opt-in. The normal editor does not load its controls.
const pilot = new URLSearchParams(window.location.search).has('filmPilot') ? await import('./coach-film-pilot.js') : null;
const filmPilotVariant = pilot?.getFilmPilotVariant(window.location.search);
const $ = selector => document.querySelector(selector);
const icons = {
  film: '<rect x="2.5" y="4" width="19" height="16" rx="2.5"/><path d="M7 4v16M17 4v16M3 9h4m-4 6h4m10-6h4m-4 6h4"/>',
  plus: '<path d="M12 5v14M5 12h14"/>', search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/>', book: '<path d="M4 4h6a3 3 0 0 1 3 3v14a4 4 0 0 0-4-2H4zM20 4h-4a3 3 0 0 0-3 3M13 21a4 4 0 0 1 4-2h3V4"/>', select: '<path d="m5 3 14 10-7 1-3 7z"/>', route: '<path d="M5 20V7h14m-5-5 5 5-5 5"/>', block: '<path d="M5 20V7h14M19 2v10"/>', motion: '<path d="m4 20 3-5-3-5 3-5h13m-5-4 5 4-5 4"/>', pass: '<path stroke-dasharray="2 4" d="M4 19 19 4"/><path d="M12 4h7v7"/>', zone: '<ellipse cx="12" cy="12" rx="9" ry="7" stroke-dasharray="3 3"/>', text: '<path d="M4 5h16M12 5v15M8 20h8"/>', flip: '<path d="M12 3v18M8 8l-5 4 5 4M16 8l5 4-5 4"/>', undo: '<path d="m8 4-5 5 5 5M3 9h10a7 7 0 0 1 0 14"/>', redo: '<path d="m16 4 5 5-5 5M21 9H11a7 7 0 0 0 0 14"/>', copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V4H4v12h4"/>', export: '<path d="M12 3v12m-5-5 5 5 5-5M4 15v6h16v-6"/>', print: '<path d="M7 7V3h10v4M7 17H3V8h18v9h-4M7 14h10v7H7z"/>', star: '<path d="m12 3 2.8 5.8 6.4.9-4.6 4.5 1.1 6.3-5.7-3-5.7 3 1.1-6.3L3.2 9.7l6.4-.9z"/>', play: '<path d="m8 4 13 8-13 8z"/>', pause: '<path d="M8 4v16M16 4v16"/>', reset: '<path d="M4 8V3m0 5h5M4 8a9 9 0 1 1-1 7"/>', loop: '<path d="m17 2 4 4-4 4M3 10V6h18M7 22l-4-4 4-4M21 14v4H3"/>', trash: '<path d="M4 6h16M9 6V3h6v3M7 6l1 15h8l1-15M10 10v7M14 10v7"/>', close: '<path d="m6 6 12 12M18 6 6 18"/>', chevron: '<path d="m9 5 7 7-7 7"/>', team: '<circle cx="9" cy="7" r="3"/><path d="M3 21v-4a6 6 0 0 1 12 0v4M16 5a3 3 0 0 1 0 6M17 15a5 5 0 0 1 4 6"/>', help: '<circle cx="12" cy="12" r="9"/><path d="M9 8a3 3 0 0 1 6 0c0 3-3 2-3 5M12 17h.01"/>', check: '<path d="m5 12 4 4L19 6"/>', sun: '<circle cx="12" cy="12" r="4"/><path d="M12 1v3M12 20v3M1 12h3M20 12h3M4 4l2 2M18 18l2 2M4 20l2-2M18 6l2-2"/>', grid: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18M15 3v18"/>', save: '<path d="M5 3h13l3 3v15H3V3zM7 3v7h10V3M7 21v-7h10v7"/>', folder: '<path d="M3 6h7l2 3h9v12H3z"/>', menu: '<path d="M4 6h16M4 12h16M4 18h16"/>', ball: '<ellipse cx="12" cy="12" rx="10" ry="6" transform="rotate(-35 12 12)"/><path d="m8 15 8-6M9 11l3 3M12 8l3 3"/>', flag: '<path d="M5 21V3h14l-3 5 3 5H5"/>'
};
const icon = name => `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] || icons.route}</svg>`;
const btn = (action, name, label, cls = '', attrs = '') => `<button type="button" data-action="${action}" class="${cls}" title="${e(label)}" aria-label="${e(label)}" ${attrs}>${icon(name)}</button>`;
const recoveryMessage = t("feedback.local_data_could_not_be_read_editing_and_autosave_are_p");
// Only translate a newly created example. Never rewrite an existing workspace.
function localizedStarterWorkspace() {
  const data = starterWorkspace({ demoDepth: true });
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
let multiSelectMode = false, selectionCandidates = [], candidateSelectionAdditive = false, selectionCandidateScope = '', confirmedFieldTarget = null;
let fieldHitObserver = null;
let toastTimer = null;
const playbackClock = createPlaybackClock(window, presentPlaybackFrame);
const timelineSeek = createScrubPresentation(window, paintTimelineSeek);
const {cancel: cancelTimelineSeek, flush: presentTimelineSeek} = timelineSeek;
const history = new EditorHistory();
const editorSessions = createWorkspaceSessions();
let loadedWorkspaceId = null, assistantPanelOpen = false, localRevision=0, progressScope=null, guestRouter=null;
let firstTask = {createdPlay:false,routeAdded:false,rehearsed:false,exported:false};
let localSaveStatus = localRecovery
  ? { kind: 'error', label: t('editorExtra.recovery_required_autosave_paused') }
  : { kind: 'saved', label: t('editor.saved_locally') };
let editingField = null;
const uxCopy = (en,zh) => getLocale()==='en'?en:zh;
function readFirstTask() {
  const scope=shared?.current?.id||'local';
  if(progressScope!==scope) {
    progressScope=scope;firstTask={createdPlay:false,routeAdded:false,rehearsed:false,exported:false};
    try {const saved=JSON.parse(localStorage.getItem(`playbook-ui-progress:v1:${scope}`)||'null');for(const key of Object.keys(firstTask))firstTask[key]=saved?.[key]===true;}catch{}
  }
  return {...firstTask};
}
function markFirstTask(key) {
  readFirstTask();if(!Object.hasOwn(firstTask,key))return;firstTask[key]=true;
  try {localStorage.setItem(`playbook-ui-progress:v1:${progressScope}`,JSON.stringify(firstTask));}catch{}
}
const homeContext = () => ({recentPlay:current(),...(canEdit()?{firstTask:readFirstTask()}:{})});
function syncWorkspaceNavigation(mode) {
  let node=$('#workspace-navigation');
  if(!node){node=document.createElement('div');node.id='workspace-navigation';$('#cloud-root').after(node);}
  node.hidden=!['editor','analysis','roster'].includes(mode);
  if(!node.hidden) node.innerHTML=workspaceNavigation(mode);
  document.body.dataset.workspaceMode=mode;
}
async function navigateWorkspace(mode) {
  if(!['editor','analysis','roster'].includes(mode))return false;
  if(document.body.dataset.workspaceMode===mode)return true;
  if(rosterView.isEditing()) {toast(uxCopy('Save or cancel the player form before switching.','请先保存或取消正在编辑的球员表单。'),{type:'info'});return false;}
  if(draft&&!confirmDraft(()=>navigateWorkspace(mode)))return false;
  clearHistoryTransition();
  cancelFieldGesture();
  document.activeElement?.blur?.();
  try {
    if(cloudMode()) {
      if(shared?.dirty)await shared.sync.flush();
      if(shared?.dirty)throw Error(uxCopy('Changes have not synced. Retry or export a backup.','修改尚未同步，请重试同步或导出备份。'));
      shared?.setMode(mode);
    } else {
      analysisView?.onData?.(state.data,{id:'demo',revision:localRevision,title:state.data.team.name});
      if(guestRouter)guestRouter.open(mode,true);else window.location.hash=mode;
    }
    return document.body.dataset.workspaceMode===mode;
  }catch(error){toast(error.message,{type:'error'});return false;}
}
document.addEventListener('click',event=>{
  const button=event.target.closest('button[data-workspace-mode]');
  if(button?.closest('.workspace-nav')){event.preventDefault();navigateWorkspace(button.dataset.workspaceMode);}
});
let shared = null, digitalBoard = null, analysisView = null, demoAnalysisData = null;
let pendingNavigation = null, viewOverrides = {}, renderedPlayId = null, gestureFrame = null, pendingFieldPointer = null, previewPoint = null, rehearsal = false;
let filmRoom = null, filmLaunch = null, filmFieldDraft = null;
let importReadSequence = 0, pendingFileImport = null;
let cancelFieldGesture = () => {};
const drawingTools = ['route','block','motion','pass'];
const boardLayout = createBoardLayout({ notify: message => toast(message), hasDraft: () => !!draft,onChange:()=>boardAssistant?.refreshLayout?.() });
const panels = createWorkspacePanels();
const thumbnails = createPlayThumbnails();
const viewSettings = () => ({ ...state.data.settings, ...viewOverrides, visualMode: document.documentElement.dataset.visualMode || 'traditional' });
const canEdit = () => cloudMode() ? !!shared?.canEdit : !localRecovery;
const editBlockedMessage = () => localRecovery ? recoveryMessage : shared?.sync?.viewError ? t("feedback.the_play_view_could_not_update_reload_before_editing") : t("feedback.you_have_read_only_access_and_cannot_edit_this_shared_p");
const readActions = new Set(['madden-library','compare-source','choose','book','select-route','clear-selection','sidebar','inspector-panel','panel-field','close-panel','export','print','help','close-modal','download-svg','download-png','download-json','download-play','do-print','play','reset','loop','grid','theme','clear-filters','keep-drawing','edit-mode','rehearse-mode','local-recovery','download-original','retry-local-load','replace-local-workspace','confirm-replace-local-workspace']);
for(const action of ['coach-film','film-pilot-event','assistant-task','properties-task','multi-select','choose-hit','retry-save'])readActions.add(action);
function protectReadOnly() {
  if (canEdit()) return;
  document.querySelectorAll('[data-prop],[data-ball],#apply-formation').forEach(n => { n.disabled = true; });
  document.querySelectorAll('#app [data-action]').forEach(n => { const [action,value]=n.dataset.action.split(':'); if (!readActions.has(action) && !(action==='tool' && value==='select')) n.disabled=true; });
}
const current = () => state.data.plays.find(p => p.id === state.selectedId) || state.data.plays[0];
// Only the field renders a drag preview. Persistence, history and other pages
// always read the last committed play, even between pointermove and pointerup.
const fieldPlay = () => drag?.preview || current();
const filtered = () => state.data.plays.filter(p => p.book === book && (!filter || (filter === 'favorite' ? p.favorite : p.category === filter)) && (!formationFilter || p.formation === formationFilter) && `${p.title} ${p.formation} ${p.category} ${p.notes}`.toLowerCase().includes(query.toLowerCase()));
const selectedObject = () => !selection || selection.type === 'players' ? null : current()[{ player: 'players', route: 'routes', zone: 'zones', annotation: 'annotations' }[selection.type]]?.find(x => x.id === selection.id);
const maddenLibrary = createMaddenLibrary({ canEdit, getPlays: () => state.data.plays, notify: toast, onImport(entry, {signal} = {}) {
  if (!canEdit()) { toast(editBlockedMessage(), { type: 'warning' }); return; }
  if (draft || drag) return {ok:false,awaitingUser:true,message:maddenLoadingCopy(getLocale()).draft};
  return importMadden(entry,{signal});
} });
function maddenImportTarget(signal) {
  return {scope:assistantScope(),book,data:JSON.stringify(state.data),document,signal};
}
function maddenImportBlocked(target) {
  if (!canEdit()) return editBlockedMessage();
  if (target.signal?.aborted || document !== target.document || !$('#app') || $('#app').hidden || assistantScope() !== target.scope || book !== target.book || JSON.stringify(state.data) !== target.data)
    return maddenLoadingCopy(getLocale()).changed;
  const focused=document.activeElement;
  if ($('#app').contains(focused) && !focused.closest('.board-ai') &&
    (focused.matches('input:not([readonly]),textarea:not([readonly]),select') || focused.isContentEditable))
    return maddenLoadingCopy(getLocale()).changed;
  if (draft || drag) return maddenLoadingCopy(getLocale()).draft;
  return null;
}
async function importMadden(entry, {adoptScope = false,signal} = {}) {
  if (!canEdit()) return;
  const target=maddenImportTarget(signal);
  if (signal?.aborted) return {ok:false,message:maddenLoadingCopy(getLocale()).changed};
  try { await loadEditableEntries([entry.id]); }
  catch { return {ok:false,message:maddenLoadingCopy(getLocale()).failed}; }
  const blocked=maddenImportBlocked(target);
  if (blocked) return {ok:false,message:blocked};
  if (state.data.plays.some(p => (hasEditableTrace(entry.id) ? p.diagramSource : p.reference)?.catalogId === entry.id)) { toast(t("feedback.this_play_is_already_in_the_current_playbook"), { type: 'success' }); return; }
  if (state.data.plays.length >= 500) return { ok: false, message: t("feedback.a_playbook_can_hold_at_most_500_plays_remove_some_befor") };
  const plan = prepareEditorActions({...editorSnapshot(),catalogRows:[entry]},[{kind:'catalog_import',catalogId:entry.id}],{idFactory:uid,locale:getLocale(),now:new Date().toISOString()});
  const transaction=commitEditorPlan(plan,{adoptScope});
  const play = current();
  const checkpoint = history.past.at(-1);
  return { ok: true,transactionId:transaction?.id, canUndo: () => canEdit() && history.past.at(-1) === checkpoint,
    undo: () => { if (canEdit() && history.past.at(-1) === checkpoint) return restoreHistory('undo');return false; },
    view: () => { choose(play.id); const card = document.querySelector(`[data-action="choose:${play.id}"]`); card?.scrollIntoView?.({ block: 'nearest' }); $('#main-content')?.focus(); }
  };
}
async function convertReference({adoptScope = false} = {}) {
  const play=current(), reference=play.reference;
  if (!reference || !hasEditableTrace(reference.catalogId)) return {ok:false,message:maddenLoadingCopy(getLocale()).failed};
  const target=maddenImportTarget();
  try { await loadEditableEntries([reference.catalogId]); }
  catch { return {ok:false,message:maddenLoadingCopy(getLocale()).failed}; }
  const blocked=maddenImportBlocked(target);
  if (blocked) return {ok:false,message:blocked};
  const entry=getEditableEntry(reference.catalogId);
  return importMadden({...entry,id:reference.catalogId,team:reference.team,game:reference.game,sourceUrl:reference.sourceUrl,image:reference.image,name:play.title,personalNotes:play.notes,personalFavorite:play.favorite},{adoptScope});
}
// The agent returns proposals only. The editor owns the active play, edit rights,
// autosave and the undo checkpoint. A late response cannot modify another play.
let boardAssistant = null;
let historyTransition = null;
function clearHistoryTransition({sync = true} = {}) {
  if (!historyTransition) return;
  const active = historyTransition;
  historyTransition = null;
  if (active.frame != null) cancelAnimationFrame(active.frame);
  active.cancel();
  if (sync) digitalBoard?.sync({contentChanged:true});
}
function showHistoryTransition(svg, frame) {
  const ready = () => !svg.closest('.is-three') || digitalBoard?.backgroundReady !== false;
  const active = presentHistoryFrame(svg, current(), frame, {ready});
  if (!active) return;
  historyTransition = active;
  active.finished.then(() => {
    if (historyTransition !== active) return;
    active.unmask();
    active.mask = null;
    digitalBoard?.sync({contentChanged:true});
    if (svg.closest('.is-three')) {
      for (const node of active.layer.querySelectorAll('[data-history-player],[data-history-ball]')) node.remove();
    }
    // Keep the final vector frame until its 3D field texture has been presented.
    const started = performance.now();
    const release = () => {
      if (historyTransition !== active) return;
      if (!document.hidden && !assistantMotionReduced() && digitalBoard?.backgroundReady === false && performance.now() - started < 500) {
        active.frame = requestAnimationFrame(release);
        return;
      }
      active.layer.remove();
      historyTransition = null;
    };
    release();
  });
}
document.addEventListener('pointerdown', event => {
  if (historyTransition && event.target.closest?.('#field')) clearHistoryTransition();
}, true);
let assistantPreview = null;
// Uncommitted turns of the current assistant conversation: {scope, edit, handle}.
let stagedEdit = null;
let assistantPreviewFrame = null;
let assistantSettling = null;
// A route morph explains an edit, even in traditional mode where decoration is off.
const assistantMotionReduced = () => !!window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
function clearAssistantPreview({keepLayer = false, refresh = true, notify = true, immediate = false} = {}) {
  if (assistantSettling) {
    cancelAnimationFrame(assistantSettling.frame);
    assistantSettling.svg.remove();
    assistantSettling = null;
  }
  if (assistantPreviewFrame) cancelAnimationFrame(assistantPreviewFrame);
  assistantPreviewFrame = null;
  const previous = assistantPreview;
  assistantPreview = null;
  previous?.transition.cancel();
  previous?.restore();
  if (!keepLayer) previous?.svg.remove();
  if (previous && refresh) {
    digitalBoard?.refreshBackground();
    // A pointerdown will raycast in this same event, before the next RAF.
    if (immediate) digitalBoard?.sync();
  }
  if (previous && notify && !keepLayer) boardAssistant?.refreshPreview();
}
function settleAssistantPreview(svg) {
  if (document.hidden || (assistantMotionReduced() && digitalBoard?.backgroundReady !== false)) { svg.remove(); return; }
  const pending = {svg, frame: null, started: null};
  const initialOpacity = Number(svg.style.opacity);
  const handoffStart = performance.now();
  assistantSettling = pending;
  const step = stamp => {
    if (assistantSettling !== pending) return;
    if (!svg.isConnected) { assistantSettling = null; return; }
    if (!document.hidden && digitalBoard?.backgroundReady === false && stamp - handoffStart < 500) {
      pending.frame = requestAnimationFrame(step);
      return;
    }
    pending.started ??= stamp;
    const progress = assistantMotionReduced() || document.hidden ? 1 : Math.min(1, (stamp - pending.started) / 180);
    svg.style.opacity = String(initialOpacity * (1 - progress));
    if (progress < 1) pending.frame = requestAnimationFrame(step);
    else { svg.remove(); assistantSettling = null; }
  };
  pending.frame = requestAnimationFrame(step);
}
function prepareAssistantOverlay(svg, className) {
  svg.classList.add(className);
  svg.removeAttribute('tabindex');
  svg.removeAttribute('role');
  svg.setAttribute('aria-hidden','true');
  svg.setAttribute('focusable','false');
  for (const node of svg.querySelectorAll('[tabindex]')) node.removeAttribute('tabindex');
  for (const node of svg.querySelectorAll('.player-hit,.route-hit')) node.remove();
  Object.assign(svg.style, {position:'absolute', inset:'0', width:'100%', height:'100%', pointerEvents:'none', zIndex:'4'});
}
function showAssistantHighlights(ids) {
  document.querySelector('#field .assistant-highlights')?.remove();
  const selected = new Set(Array.isArray(ids) ? ids : []);
  if (!selected.size) return;
  const stage = document.querySelector('#field .pitch-stage');
  if (!stage) return;
  const template = document.createElement('template');
  const settings=viewSettings();
  const focusColor=settings.visualMode==='digital' ? digitalFieldPalette(settings.fieldTheme).focus : settings.fieldTheme==='light' ? '#37494a' : '#dae8e4';
  template.innerHTML = fieldSVG(current(), settings, { prefix: 'assistant-highlight' });
  const svg = template.content.firstElementChild;
  svg.querySelectorAll(':scope > rect, :scope > .yard-lines, :scope > text, [data-zone], [data-annotation], #assistant-highlight-ball').forEach(node => node.remove());
  svg.querySelectorAll('[data-player], [data-route]').forEach(node => {
    if (!selected.has(node.dataset.player || node.dataset.route)) { node.remove(); return; }
    if (node.hasAttribute('data-player')) {
      const ring = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      ring.setAttribute('r','29');
      ring.setAttribute('fill','none');
      ring.setAttribute('stroke',focusColor);
      ring.setAttribute('stroke-width','2.5');
      ring.setAttribute('stroke-dasharray','34 11.55');
      node.replaceChildren(ring);
    } else node.querySelector('.route-stroke')?.setAttribute('stroke-width','5');
  });
  prepareAssistantOverlay(svg,'assistant-highlights');
  stage.append(svg);
}
function showAssistantPreview(play, original, {reuse, refresh = true} = {}) {
  clearHistoryTransition();
  const source = document.createElement('template');
  source.innerHTML = fieldSVG(original, viewSettings(), {prefix:'assistant-before'});
  const routePaths = root => new Map([...root.querySelectorAll('[data-route]')].map(node =>
    [node.dataset.route,node.querySelector('.route-stroke')?.getAttribute('d')]));
  const oldPaths = routePaths(source.content);
  const oldBall = source.content.querySelector('#assistant-before-ball');
  const oldBallPosition = oldBall?.getAttribute('transform');
  // A rebased proposal starts at the currently displayed shape if it is still on screen.
  for (const type of ['route','player','zone','annotation']) {
    for (const shown of assistantPreview?.svg.querySelectorAll(`[data-${type}]`) || []) {
      const old = [...source.content.querySelectorAll(`[data-${type}]`)].find(node => node.dataset[type] === shown.dataset[type]);
      old?.replaceWith(shown.cloneNode(true));
    }
  }
  const shownBall = assistantPreview?.svg.querySelector('#assistant-preview-ball');
  if (oldBall && shownBall && shownBall.style.visibility !== 'hidden') oldBall.replaceWith(shownBall.cloneNode(true));
  clearAssistantPreview({refresh:false, notify:false});
  const stage = document.querySelector('#field .pitch-stage');
  if (!stage) return;
  const template = document.createElement('template');
  template.innerHTML = fieldSVG(play, viewSettings(), { prefix: 'assistant-preview' });
  const svg = template.content.firstElementChild;
  const main = stage.querySelector(':scope > .pitch-svg');
  svg.querySelectorAll(':scope > rect, :scope > .yard-lines, :scope > text').forEach(node => node.remove());
  const changed = (type, value) => {
    const prior = original[type].find(item => item.id === value.id);
    return !prior || JSON.stringify(prior) !== JSON.stringify(value);
  };
  const newPaths = routePaths(svg);
  // Moving a defender or receiver can change a linked block or pass even when
  // the stored route object is identical.
  const changedRoutes = play.routes.filter(route => changed('routes', route) || oldPaths.get(route.id) !== newPaths.get(route.id));
  const changedRouteIds = new Set(changedRoutes.map(route => route.id));
  const movingPlayerIds = new Set(changedRoutes.map(route => route.playerId));
  const changedPlayerIds = new Set(play.players.filter(player => changed('players', player)).map(player => player.id));
  const removedPlayerIds = original.players.filter(player => !play.players.some(item => item.id === player.id)).map(player => player.id);
  const maskedPlayerIds = new Set([...changedPlayerIds, ...removedPlayerIds]);
  svg.querySelectorAll('[data-route]').forEach(node => { if (!changedRouteIds.has(node.dataset.route)) node.remove(); });
  svg.querySelectorAll('[data-player]').forEach(node => { if (!changedPlayerIds.has(node.dataset.player) && !movingPlayerIds.has(node.dataset.player)) node.remove(); });
  const changedObjectIds = {route:changedRouteIds,player:maskedPlayerIds};
  for (const [type, attribute] of [['zones', 'zone'], ['annotations', 'annotation']]) {
    const ids = new Set(play[type].filter(value => changed(type, value)).map(value => value.id));
    for (const item of original[type]) if (!play[type].some(next=>next.id===item.id)) ids.add(item.id);
    changedObjectIds[attribute] = ids;
    svg.querySelectorAll(`[data-${attribute}]`).forEach(node => { if (!ids.has(node.dataset[attribute])) node.remove(); });
  }
  const previewBall = svg.querySelector('#assistant-preview-ball');
  const ballChanged = JSON.stringify(play.ball) !== JSON.stringify(original.ball) || oldBallPosition !== previewBall?.getAttribute('transform');
  if (!ballChanged && !movingPlayerIds.has(play.ball.holderId)) previewBall?.remove();
  const removedRoutes = original.routes.filter(route => !play.routes.some(item => item.id === route.id));
  if (removedRoutes.length) {
    const old = document.createElement('template');
    old.innerHTML = fieldSVG(original, viewSettings(), { prefix: 'assistant-preview-removed' });
    for (const route of removedRoutes) {
      const node = [...old.content.querySelectorAll('[data-route]')].find(item => item.dataset.route === route.id);
      if (!node) continue;
      node.dataset.removing = '';
      changedRouteIds.add(route.id);
      node.querySelectorAll('.route-hit').forEach(shape => shape.remove());
      node.querySelectorAll('path, line').forEach(shape => { shape.setAttribute('stroke', '#ff7777'); shape.setAttribute('stroke-dasharray', '8 6'); shape.removeAttribute('marker-end'); shape.removeAttribute('marker-mid'); });
      svg.append(node);
    }
  }
  prepareAssistantOverlay(svg,'assistant-preview');
  svg.style.opacity = stage.classList.contains('is-perspective') ? '.85' : '.6';
  stage.append(svg);
  const hidden = [], masked = new Set(), rehearsalOnly = [];
  const hide = node => {
    if (node && !masked.has(node)) { hidden.push([node,node.style.opacity]); masked.add(node); node.style.opacity = '0'; }
  };
  for (const [type,ids] of Object.entries(changedObjectIds)) {
    for (const node of main.querySelectorAll(`[data-${type}]`)) if (ids.has(node.dataset[type])) hide(node);
  }
  for (const node of main.querySelectorAll('.point-handle')) if (changedRouteIds.has(node.dataset.routeId)) hide(node);
  if (ballChanged) hide(main.querySelector('#pitch-ball'));
  for (const node of svg.querySelectorAll('[data-player]')) if (!changedPlayerIds.has(node.dataset.player)) rehearsalOnly.push(node);
  if (!ballChanged && previewBall?.isConnected) rehearsalOnly.push(previewBall);
  for (const node of rehearsalOnly) node.style.visibility = 'hidden';
  const mask = {playerIds:[...maskedPlayerIds],routeIds:[...changedRouteIds],zoneIds:[...changedObjectIds.zone],ball:ballChanged};
  const rehearse = () => {
    for (const node of rehearsalOnly) node.style.visibility = '';
    mask.playerIds = [...new Set([...maskedPlayerIds,...movingPlayerIds])];
    mask.ball = !!svg.querySelector('#assistant-preview-ball');
    for (const node of main.querySelectorAll('[data-player]')) if (mask.playerIds.includes(node.dataset.player)) hide(node);
    if (mask.ball) hide(main.querySelector('#pitch-ball'));
    digitalBoard?.refreshBackground();
  };
  const resetRehearsal = () => {
    updateAnimation(svg, play, 0, 'assistant-preview');
    for (const node of rehearsalOnly) node.style.visibility = 'hidden';
  };
  const restore = () => { for (const [node,opacity] of hidden) node.style.opacity = opacity; };
  const ready = () => !stage.classList.contains('is-three') || digitalBoard?.backgroundReady !== false;
  const transition = animateAssistantLayer({layer:svg,beforeSvg:source.content.firstElementChild,ready,reducedMotion:!!reuse || assistantMotionReduced()});
  assistantPreview = Object.assign(reuse || {}, { play, original, svg, restore, transition, mask, rehearse, resetRehearsal });
  if (refresh) digitalBoard?.refreshBackground();
  return assistantPreview;
}
function rehearseAssistantPreview() {
  if (!assistantPreview) return;
  assistantPreview.transition.finish();
  assistantPreview.rehearse();
  if (assistantPreviewFrame) cancelAnimationFrame(assistantPreviewFrame);
  const started = performance.now(), preview = assistantPreview;
  const step = now => {
    if (assistantPreview !== preview || !preview.svg.isConnected) return;
    const elapsed = (now - started) / 1000;
    updateAnimation(preview.svg, preview.play, Math.min(elapsed, animationLength(preview.play)), 'assistant-preview');
    if (elapsed < animationLength(preview.play)) assistantPreviewFrame = requestAnimationFrame(step);
  };
  assistantPreviewFrame = requestAnimationFrame(step);
}
document.addEventListener('playbook:effects-changed', () => {
  clearHistoryTransition();
  const svg = $('#field .pitch-stage > .pitch-svg');
  if (svg && !svg.classList.contains('reference-svg') && (svg.dataset.fieldSurface === 'enamel') !== (visualMode() === 'digital')) {
    renderField({preservePreview:true, syncDigital:false});
  }
  if (assistantMotionReduced()) assistantPreview?.transition.finish();
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { pausePlayback(); clearHistoryTransition(); assistantPreview?.transition.finish(); cancelFieldGesture(); }
  // The board's visibility listener presents its renderer after the editable SVG is current.
  else presentTimelineSeek(undefined, false);
});
window.addEventListener('blur', () => cancelFieldGesture());
window.addEventListener('pagehide', () => { closeFilmRoom(); pausePlayback(); presentTimelineSeek(); clearHistoryTransition(); cancelFieldGesture(); });
window.addEventListener('resize', () => cancelFieldGesture());
const assistantScope = () => JSON.stringify([shared?.current?.id || 'local', current().id]);
const scopeFor = selectedId => JSON.stringify([shared?.current?.id || 'local', selectedId]);
function editorSnapshot() {
  return {data:clone(state.data), selectedId:current().id, readOnly:!canEdit(), view:editorViewState()};
}
function editorViewState() {
  return {
    selection:clone(selection), tool, draft:!!draft, readOnly:!canEdit(),
    playback:{playing,time,speed,loop,mode:rehearsal?'rehearse':'edit'},
    theme:viewSettings().fieldTheme, grid:viewSettings().showGrid, names:viewSettings().showNames,
    visualMode:visualMode(), digitalAvailable:!deviceIsTraditional(),
    layout:boardLayout.getState(), filter:{query,category:filter,formation:formationFilter,book}, panel:panels.active,
    canUndo:history.past.length>0, canRedo:history.future.length>0,
  };
}
function applyPlayCommand(operation, {redraw = true, idFactory = uid} = {}) {
  const next = clone(current());
  let outcome;
  try {
    outcome = runEditorPlayCommand(next, operation, {idFactory, roster:state.data.roster, formations:state.data.formations, depthChart:state.data.depthChart});
    if (!outcome) throw Error('Unknown editor command.');
    validatePlay(next);
  } catch (error) { toast(error.message, {type:'warning'}); return null; }
  const receipt=edit(play => Object.assign(play,next), {redraw,name:commandLabel(operation),source:'manual'});
  if (!receipt) return null;
  if (operation.kind==='route_add') markFirstTask('routeAdded');
  return outcome;
}
function commandLabel(operation) {
  const labels={player_add:['Add player','添加球员'],player_update:['Edit player','调整球员'],object_remove:['Delete object','删除对象'],route_add:['Draw route','绘制路线'],route_update:['Edit route','修改路线'],zone_add:['Add coverage area','添加防守区域'],zone_update:['Edit coverage area','调整防守区域'],annotation_add:['Add annotation','添加标注'],annotation_update:['Edit annotation','修改标注'],ball_update:['Set ball movement','调整球权'],play_update:['Edit play details','修改战术信息'],play_mirror:['Mirror play','镜像战术'],formation_apply:['Replace formation','替换阵型'],opponents_set:['Change opponents','调整对方阵型'],personnel_apply:['Apply starters','应用首发'],line_space:['Adjust line spacing','调整锋线间距']};
  return uxCopy(...(labels[operation.kind]||['Edit play','修改战术']));
}
function commitEditorPlan(plan, {adoptScope = false} = {}) {
  const existing = new Set(state.data.plays.map(play=>play.id));
  for (const play of plan.data.plays) if (!existing.has(play.id) && !play.createdAt) play.createdAt = new Date().toISOString();
  if (adoptScope) boardAssistant?.adoptScope(scopeFor(plan.selectedId));
  selection = null; tool = 'select'; query = ''; filter = ''; formationFilter = '';
  const receipt=edit((_play,data) => {
    Object.assign(data,plan.data); state.selectedId = plan.selectedId;
    book = current().book;
  },{name:plan.summary,source:adoptScope?'assistant':'manual'});
  if (receipt&&plan.actions?.some(action=>action.kind==='play_create')) markFirstTask('createdPlay');
  return receipt;
}
function applyWorkspaceActions(commands) {
  try {
    const plan = prepareEditorActions(editorSnapshot(),commands,{idFactory:uid,locale:getLocale(),now:new Date().toISOString()});
    commitEditorPlan(plan);
    return plan;
  } catch(error) {toast(error.message,{type:'warning'});return null;}
}
function operationContext(operations) {
  const rosterIds = new Set(operations.flatMap(operation=>[operation.rosterId,operation.patch?.rosterId]).filter(Boolean));
  const formationIds = new Set(operations.map(operation=>operation.formationId).filter(Boolean));
  const groupIds = new Set(operations.map(operation=>operation.groupId).filter(Boolean));
  return JSON.stringify({
    roster:state.data.roster.filter(person=>groupIds.size || rosterIds.has(person.id)),
    formations:state.data.formations.filter(formation=>formationIds.has(formation.id)),
    groups:state.data.depthChart?.groups?.filter(group=>groupIds.has(group.id)) || [],
  });
}
function executeEditorLocal(actionsToRun) {
  // Validate availability before making device changes. Data edits remain in
  // the separate preview/transaction lane.
  let plannedPlay=current(), plannedDraft=!!draft;
  for (const action of actionsToRun) {
    if (!canEdit() && (action.kind==='history_action' || action.kind==='draft_action' || action.kind==='tool_set' && action.tool!=='select')) throw Error(editBlockedMessage());
    if (action.kind==='view_set' && action.visualMode==='digital' && deviceIsTraditional()) throw Error(t('controls.phones_and_ipads_use_traditional_mode_rehearsal_remains_'));
    if (action.kind==='playback_set' && plannedPlay.reference) throw Error(t('feedback.the_original_diagram_has_no_playable_route_data'));
    if (action.kind==='tool_set' && action.tool!=='select' && plannedPlay.reference) throw Error(t('feedback.this_original_diagram_supports_notes_but_has_no_editabl'));
    const changesPlayback=action.kind==='playback_set' && (action.mode || action.reset || action.time!=null || action.playing!=null);
    if (plannedDraft && (action.kind==='play_select' || action.kind==='filter_set' && action.book!=null || changesPlayback || action.kind==='tool_set' && action.tool!==tool)) throw Error(t('assistant.finishDrawing'));
    if (action.kind==='draft_action' && ['finish','cancel'].includes(action.action)) plannedDraft=false;
    if (action.kind==='play_select') plannedPlay=state.data.plays.find(play=>play.id===action.playId) || plannedPlay;
    if (action.kind==='filter_set' && action.book!=null) plannedPlay=state.data.plays.find(play=>play.book===action.book) || plannedPlay;
  }
  for (const action of actionsToRun) {
    if (action.kind === 'history_action' || action.kind === 'draft_action' || action.kind === 'tool_set' && action.tool !== 'select') {
      if (!canEdit()) throw Error(editBlockedMessage());
    }
    if (action.kind === 'selection_set') {
      selection = action.objectType === 'none' ? null : action.objectType==='players'?playerSelection(current(),action.ids):{type:action.objectType,id:action.id};
      multiSelectMode=false;selectionCandidates=[];
      refreshSelection();
    } else if (action.kind === 'tool_set') setTool(action.tool);
    else if (action.kind === 'draft_action') {
      if (action.action === 'set_mode') {
        if (!draft) throw Error(getLocale()==='en'?'There is no active drawing draft.':'当前没有正在绘制的路线。');
        draft.mode=action.mode;
        const purpose=$('#draft-mode');
        if(purpose)purpose.value=action.mode;
        continue;
      }
      if (action.action === 'finish' && (!draft || draft.points.length<2)) throw Error(t('editorExtra.click_at_least_one_route_endpoint'));
      actions[action.action === 'finish' ? 'finish-route' : action.action === 'cancel' ? 'cancel-draft' : 'undo-point']();
    } else if (action.kind === 'history_action') {
      if (!(action.action === 'undo' ? history.past : history.future).length) throw Error(getLocale()==='en'?'No history is available.':'当前没有可撤销或重做的修改。');
      restoreHistory(action.action);
    } else if (action.kind === 'playback_set') {
      if (current().reference) throw Error(t('feedback.the_original_diagram_has_no_playable_route_data'));
      if (draft && (action.mode || action.reset || action.time!=null || action.playing!=null)) throw Error(t('assistant.finishDrawing'));
      cancelTimelineSeek();
      if (action.mode || action.reset || action.time != null || action.playing != null) clearAssistantPreview();
      if (action.mode === 'edit' || action.reset) { resetAnimation(); rehearsal = action.mode === 'rehearse'; }
      if (action.mode === 'rehearse') rehearsal = true;
      setPlaybackOptions(action.speed ?? speed, action.loop ?? loop);
      if (action.time != null) { stop(); time = Math.min(action.time,animationLength(current())); rehearsal = true; }
      if (action.playing != null && playing !== action.playing) togglePlay();
      if (action.mode || action.reset) renderField();
      paintPlayback(); syncEditorChrome();
    } else if (action.kind === 'view_set') {
      if (action.visualMode === 'digital' && deviceIsTraditional()) throw Error(t('controls.phones_and_ipads_use_traditional_mode_rehearsal_remains_'));
      if (action.theme != null) viewOverrides.fieldTheme = action.theme;
      if (action.grid != null) viewOverrides.showGrid = action.grid;
      if (action.names != null) viewOverrides.showNames = action.names;
      if (action.visualMode != null) setEffectsMode(action.visualMode);
      renderField({preservePreview:true}); syncEditorChrome();
    } else if (action.kind === 'layout_set') boardLayout.setState(action);
    else if (action.kind === 'filter_set') {
      if (action.book != null) {
        resetAnimation();draft=null;selection=null;book=action.book;query='';filter='';formationFilter='';
        const first=state.data.plays.find(play=>play.book===book);
        if(first){boardAssistant?.adoptScope(scopeFor(first.id));state.selectedId=first.id;}
        panels.close({focus:false});
      }
      if (action.query != null) query = action.query;
      if (action.category != null) filter = action.category;
      if (action.formation != null) formationFilter = action.formation;
      render();
    } else if (action.kind === 'panel_set') {
      if (['field','none'].includes(action.panel)) { panels.close({focus:false}); if(action.panel==='field')$('#field')?.scrollIntoView?.({block:'nearest'}); }
      else if (panels.active !== action.panel) panels.toggle(action.panel);
      const target = action.panel === 'plays' ? $('.sidebar') : action.panel === 'properties' ? $('.inspector') : $('#field');
      target?.scrollIntoView?.({block:'nearest'});
    } else if (action.kind === 'play_select') {
      if (draft || drag) throw Error(t('assistant.finishDrawing'));
      const next = state.data.plays.find(play=>play.id===action.playId);
      if (!next) throw Error(t('assistant.boardChanged'));
      book = next.book; boardAssistant?.adoptScope(scopeFor(next.id)); choose(next.id);
    }
  }
  return {kind:'answer',scope:assistantScope(),message:getLocale()==='en'?'Editor updated.':'已更新战术板。',editorState:editorViewState(),actions:actionsToRun};
}
function editorInteractionReply(plan, checkFilmVersion) {
  const message = getLocale()==='en'?'Ready. Continue to open the requested file, export or dialog.':'已准备好，请点击继续打开文件选择、导出或对应面板。';
  return {kind:'answer',message,status:'awaiting_user',actions:plan.actions, action:{
    label:getLocale()==='en'?'Continue':'继续',
    async run() {
      if (plan.actions.some(usesLivePlayback)) checkFilmVersion();
      let awaitingUser=false, exported=false;
      for (const action of plan.actions) {
        if (action.kind === 'export_request') { actions[{'png':'download-png','svg':'download-svg','play_json':'download-play','workspace_json':'download-json'}[action.format]]();exported=true; }
        else if (action.kind === 'import_request') {actions.import();awaitingUser=true;}
        else if (action.kind === 'print_request') {
          printModal(); $('#print-scope').value=action.scope; $('#print-layout').value=action.layout; updatePrint();
          awaitingUser=true;
        } else if (action.kind === 'dialog_open') {
          const mapping = {help:'help',new_play:'new',export:'export',madden:'madden-library',source:'compare-source',recovery:'local-recovery'};
          if (action.dialog === 'coach_film') {
            if (!await enterFilmRoom(checkFilmVersion)) throw Error(t('film.openFailed'));
          }
          else if (action.dialog === 'personnel') { selection=null;refreshSelection();if(panels.active!=='properties')panels.toggle('properties');$('#personnel-group')?.focus(); }
          else if (action.dialog === 'convert_reference') {
            if (!canEdit()) throw Error(editBlockedMessage());
            const reference=current().reference;
            if (!reference || !hasEditableTrace(reference.catalogId)) throw Error(getLocale()==='en'?'This diagram has no verified editable reconstruction.':'这张原图暂无经过验证的可编辑重建。');
            const outcome=await convertReference({adoptScope:true});
            if (!outcome?.ok) throw Error(outcome?.message || t('assistant.boardChanged'));
            return {kind:'edit',scope:assistantScope(),transactionId:outcome.transactionId,message:getLocale()==='en'?'Created an editable copy.':'已创建可编辑副本。',undo:outcome.undo};
          }
          else if (action.dialog === 'source' && !current().diagramSource) {
            const reference=current().reference;
            if (!reference) throw Error(getLocale()==='en'?'This play has no source diagram.':'当前战术没有来源原图。');
            openModal(current().title,`<img class="source-comparison" src="./${e(reference.image)}" alt="${e(current().title)}">`,`<button class="button primary" data-action="close-modal">${t('modal.close')}</button>`,true);
          }
          else actions[mapping[action.dialog]]();
          awaitingUser=true;
        }
      }
      return {kind:'answer',scope:assistantScope(),status:awaitingUser?'awaiting_user':'started',message:awaitingUser
        ? (getLocale()==='en'?'The requested browser flow is open. Complete it there.':'已打开对应流程，请在其中完成文件选择、打印或操作。')
        : exported ? (getLocale()==='en'?'Started the requested export. Check your browser downloads.':'已启动导出，请查看浏览器下载。') : plan.summary};
    }
  }};
}
function mountBoardAssistant() {
  const host = $('#field');
  if (!boardAssistant) {
    let offered = new Map();
    boardAssistant = createBoardAssistant({
      host,
      getContext: () => ({scope: assistantScope(), title: current().title, readOnly: !canEdit(), serverProxy:cloudMode(),dockHost:boardLayout.getState().expanded||isCompactWorkspace()?null:$('#properties-panel')}),
      onPanelChange({open,floating}) {
        assistantPanelOpen=!!(open&&!floating);
        const workspace=$('.workspace');
        if (workspace) workspace.dataset.assistantOpen=String(assistantPanelOpen);
        const inspectorNode=$('.inspector');
        if (inspectorNode) inspectorNode.hidden=assistantPanelOpen;
        if(open&&floating&&panels.active)panels.close({focus:false});
        for(const button of document.querySelectorAll('.task-panel-tabs button'))button.setAttribute('aria-pressed',String(button.dataset.action===(assistantPanelOpen?'assistant-task':'properties-task')));
      },
      onSelectTarget(id) {
        if (!current().players.some(player=>player.id===id)) return;
        selection={type:'player',id};refreshSelection();showAssistantHighlights([id]);
      },
      async onRequest({prompt, mode, previous, onTool, onEvent, provider, protocol, baseUrl, model, apiKey, signal, locale}) {
        document.querySelector('#field .assistant-highlights')?.remove();
        const scope = assistantScope();
        const workspace = cloudMode() ? shared?.current : null;
        if (cloudMode() && !workspace) throw Error(editBlockedMessage());
        const editOptions = () => ({roster:state.data.roster,formations:state.data.formations,depthChart:state.data.depthChart,locale});
        const restage = (steps, conflict = 'assistant.boardChanged') => {
          try { return stageEdit(clone(current()), steps, editOptions()); }
          catch (error) { throw error instanceof StagedEditConflict ? Error(t(conflict)) : error; }
        };
        // A conversation keeps editing its staged working copy: the next turn
        // reads the pending result, not the committed play it is waiting on.
        const pendingEdit = stagedEdit?.scope === scope ? stagedEdit : null;
        if (!pendingEdit) { stagedEdit = null; clearAssistantPreview(); }
        else if (workspace) await shared.sync.refreshForProposal();
        const committedContent = JSON.stringify(current());
        const carried = pendingEdit && (committedContent === JSON.stringify(pendingEdit.edit.base) ? pendingEdit.edit : restage(pendingEdit.edit.steps, 'assistant.stagedConflict'));
        const play = clone(carried ? carried.play : current());
        const source = carried ? 'staged' : 'committed';
        const requestEditorSnapshot=editorSnapshot(), requestWorkspaceState=JSON.stringify(requestEditorSnapshot.data);
        if (carried) requestEditorSnapshot.view.playback.source = 'committed';
        const checkScope = () => {
          signal.throwIfAborted();
          if ($('#app').hidden || assistantScope() !== scope) throw Error(t('assistant.boardChanged'));
        };
        const checkFilmVersion = () => {
          checkScope();
          if ((stagedEdit ?? null) !== pendingEdit || JSON.stringify(current()) !== committedContent)
            throw Object.assign(Error(t('assistant.boardChanged')), {code:'FILM_BOARD_CHANGED'});
        };
        let filmBridge;
        const loadFilm = async () => {
          checkScope();
          filmBridge ??= import('./coach-film-bridge.js').then(({createFilmBridge}) => createFilmBridge({
            guard:checkFilmVersion, available:filmRoomAvailable, pilot:filmPilotVariant,
            getPlay:()=>play, source, locale,
            getRoster:()=>state.data.roster, getRoom:()=>filmRoom, open:()=>enterFilmRoom(checkFilmVersion),
            attachLesson: async room => {
              const {createFilmLesson} = await import('./coach-film-lesson.js');
              checkFilmVersion();
              if (room === filmRoom) room.attachLesson(createFilmLesson({workspaceId:shared?.current?.id || 'local'}));
            },
            regular:{
              enabled:()=>!deviceIsTraditional(), read:()=>({time,playing,speed,hidden:document.hidden}),
              apply(command) {
                if (draft || current().reference) throw Error(t('assistant.finishDrawing'));
                if (command.operation === 'seek') {
                  const slider = $('#timeline');
                  slider.value = command.time;
                  seekTimeline(slider, true);
                } else {
                  const action = command.operation === 'speed' ? {speed:command.speed} : {playing:command.operation === 'play'};
                  executeEditorLocal([{kind:'playback_set', ...action}]);
                }
              },
            },
          }));
          return filmBridge;
        };
        const result = await requestBoardAssistant({
          instruction: prompt, mode, previous, onTool, onEvent, locale, signal, model: {provider, protocol, baseUrl, model, apiKey},
          board: {...play, play: clone(play), playId: play.id, source, players: assistantPlayers(play, state.data.roster),
            selectedPlayerId: selection?.type === 'player' ? selection.id : null,
            selectedPlayerIds:selection?.type==='players'?selection.ids:selection?.type==='player'?[selection.id]:[],
            routes: play.routes},
          film:{read:async ()=>(await loadFilm()).read(), execute:async command=>(await loadFilm()).execute(command)},
          editor:requestEditorSnapshot, workspace: workspace ? {id: workspace.id, revision: workspace.revision} : undefined, request,
        });
        checkScope();
        if (result.kind === 'error') throw Object.assign(Error(result.message), {code:result.code});
        if (result.kind === 'editor') {
          if (pendingEdit && result.actions.some(usesLivePlayback)) throw Error(t('film.previewPending'));
          const snapshot = editorSnapshot();
          if (result.actions.some(action=>action.kind==='catalog_import')) {
            snapshot.catalogRows = (await loadAssistantCatalog()).plays;
            await loadEditableEntries(result.actions.filter(action=>action.kind==='catalog_import').map(action=>action.catalogId));
          }
          checkScope();
          const plan = prepareEditorActions(snapshot,result.actions,{locale});
          if (plan.lane === 'local') return executeEditorLocal(plan.actions);
          if (plan.lane === 'interaction') return editorInteractionReply(plan, checkFilmVersion);
          // Playbook transactions run on committed data, so staged edits are a commit boundary.
          if (pendingEdit) return {kind:'answer',scope,message:t('assistant.commitStagedFirst')};
          if (JSON.stringify(state.data)!==requestWorkspaceState) throw Error(t('assistant.boardChanged'));
          if (!canEdit()) throw Error(editBlockedMessage());
          if (draft || drag) throw Error(t('assistant.finishDrawing'));
          let active = true;
          const baseline = JSON.stringify(state.data);
          return {kind:'preview',message:plan.summary,summary:plan.summary,changes:plan.changes,actions:plan.actions,
            isVisible:()=>active,discard(){active=false;},
            async apply() {
              if (workspace) await shared.sync.refreshForProposal();
              checkScope();
              if (!active || JSON.stringify(state.data)!==baseline) throw Error(t('assistant.boardChanged'));
              if (!canEdit()) throw Error(editBlockedMessage());
              if (draft || drag) throw Error(t('assistant.finishDrawing'));
              const transaction=commitEditorPlan(plan,{adoptScope:true}); active=false;
              const checkpoint = history.past.at(-1), appliedScope=assistantScope();
              return {kind:'edit',scope:appliedScope,transactionId:transaction?.id,message:plan.summary,summary:plan.summary,actions:plan.actions,
                undo() {
                  if (!canEdit() || assistantScope()!==appliedScope || history.past.at(-1)!==checkpoint) return false;
                  return restoreHistory('undo');
                }};
            }};
        }
        if (result.kind === 'search') {
          const catalog = await loadAssistantCatalog();
          checkScope();
          const cards = resolveMaddenResults(catalog, result.matches);
          offered = new Map(cards.map(card => [card.id, {scope, entry: card.entry}]));
          const added = new Set(state.data.plays.map(p => p.diagramSource?.catalogId || (p.reference && !hasEditableTrace(p.reference.catalogId) ? p.reference.catalogId : null)));
          return {kind: 'search', items: cards.map(card => ({...card, title: card.name, added: added.has(card.id)}))};
        }
        if (['clarify', 'answer', 'handoff'].includes(result.kind)) {
          if (result.kind === 'handoff') return {...result, context: {...result.context, instruction: result.context?.instruction || prompt}};
          return result;
        }
        if (!canEdit()) throw Error(editBlockedMessage());
        if (draft || drag) throw Error(t('assistant.finishDrawing'));
        const operations = result.operations || [result.operation];
        // The agent worked on `play`. Record what it proposed there, then replay
        // the whole stack on the latest committed play before showing it.
        const requested = stageEdit(play, [{instruction:prompt, operations}], editOptions()).steps[0];
        const present = staged => {
          let active = true;
          const externalContext = operationContext(staged.operations);
          const shown = showAssistantPreview(staged.play, staged.base);
          const isVisible = () => assistantPreview === shown && shown.svg.isConnected;
          const guard = () => {
            checkScope();
            if (!active || operationContext(staged.operations)!==externalContext) throw Error(t('assistant.boardChanged'));
            if (!canEdit()) throw Error(editBlockedMessage());
            if (draft || drag) throw Error(t('assistant.finishDrawing'));
          };
          const handle = {kind: 'preview', stackable: true, message: staged.summary, summary: staged.summary, changes: staged.changes, turns: staged.turns,
            operations: staged.operations, routeIds: staged.routeIds, zoneIds: staged.zoneIds, playerIds: staged.playerIds,
            discard() { active = false; if (stagedEdit?.handle === handle) stagedEdit = null; clearAssistantPreview({notify:false}); },
            isVisible, rehearse: rehearseAssistantPreview,
            // Dropping the newest turn keeps the earlier ones staged.
            revert: staged.steps.length > 1 ? () => { guard(); const next = restage(staged.steps.slice(0,-1)); active = false; return present(next); } : undefined,
            selectTurns(indices) {
              guard();
              if(!Array.isArray(indices)||!indices.length||indices.some(index=>!Number.isInteger(index)||index<0||index>=staged.steps.length))throw Error(uxCopy('Choose at least one existing change group.','请至少选择一个现有修改组。'));
              const selected=new Set(indices);
              let next;
              try {next=restage(staged.steps.filter((_step,index)=>selected.has(index)));}
              catch {throw Error(uxCopy('These changes depend on an earlier group. Keep the required group and update the preview again.','所选修改依赖前面的修改组，请保留相关组后重新预览。'));}
              active=false;return present(next);
            },
            async apply() {
              const wasVisible = isVisible();
              await shown.transition.finished;
              if (workspace) await shared.sync.refreshForProposal();
              guard();
              if (!wasVisible || !isVisible() || JSON.stringify(current()) !== JSON.stringify(staged.base)) {
                const next = restage(staged.steps);
                active = false;
                return present(next);
              }
              shown.resetRehearsal();
              clearAssistantPreview({keepLayer:true,refresh:false});
              active = false; stagedEdit = null;
              selection = staged.routeId ? {type: 'route', id: staged.routeId} : null;
              tool = 'select';
              const transaction=edit(p => Object.assign(p, staged.play), {redraw:false,name:staged.summary,source:'assistant'});
              const inspectorNode = $('.inspector');
              inspectorNode.innerHTML = inspector();
              inspectorNode.dataset.context = `${selection?.type || 'play'}:${selection?.id || current().id}`;
              settleAssistantPreview(shown.svg);
              const checkpoint = history.past.at(-1);
              return {kind: 'edit',transactionId:transaction?.id, message: staged.summary, summary: staged.summary, operations: staged.operations, turns: staged.turns,
                routeIds: staged.routeIds, zoneIds: staged.zoneIds, playerIds: staged.playerIds,
                undo() {
                  if (!canEdit() || assistantScope() !== scope || history.past.at(-1) !== checkpoint) return false;
                  return restoreHistory('undo');
                }};
            }};
          stagedEdit = {scope, edit:staged, handle};
          return handle;
        };
        if (workspace) await shared.sync.refreshForProposal();
        checkScope();
        // The coach may have applied or dropped the staged turns while the model was working.
        if (pendingEdit && stagedEdit !== pendingEdit) throw Error(t('assistant.boardChanged'));
        onTool?.('build_preview');
        return present(restage([...(carried?.steps || []), requested]));
      },
      onHighlight: showAssistantHighlights,
      async onHandoff(result) {
        if(stagedEdit?.scope===assistantScope()){toast(t('assistant.commitStagedFirst'),{type:'info'});return;}
        const play = current();
        if (!cloudMode()) analysisView?.onData?.(state.data,{id:'demo',revision:localRevision,title:state.data.team.name});
        if(await navigateWorkspace('analysis'))analysisView?.selectPlay(play, resolveHandoffContext(state.data.plays, result?.context));
      },
      async onAdd(id) {
        const card = offered.get(id);
        if (!card || card.scope !== assistantScope() || !canEdit()) return false;
        if (draft || drag) throw Error(t('assistant.finishDrawing'));
        const result = await importMadden(card.entry);
        if (result?.message) throw Error(result.message);
        return result?.ok === true;
      },
    });
  } else boardAssistant.mount(host);
}

function filmRoomAvailable() {
  return !deviceIsTraditional() && filmPilotVariant !== 'events' && filmPilotVariant !== 'baseline';
}

function coachFilmEntry() {
  if (!filmRoomAvailable()) return '';
  return `<button type="button" class="button coach-film-entry" data-action="coach-film" aria-haspopup="dialog">${icon('film')}<span>${t('film.enter')}</span></button>`;
}

function closeFilmRoom() {
  filmLaunch = null;
  filmRoom?.close();
  filmRoom = null;
  filmFieldDraft = null;
}

async function enterFilmRoom(checkVersion) {
  if (filmLaunch || filmRoom || $('#app').hidden || !filmRoomAvailable()) return false;
  const launch = { scope: assistantScope() };
  filmLaunch = launch;
  const restoreScroll = captureEditorScroll({samePlay:true});
  try {
    const [{openFilmRoom}, lesson] = await Promise.all([
      import('./coach-film-room.js'),
      filmPilotVariant === 'lesson' ? import('./coach-film-lesson.js') : null,
    ]);
    if (filmLaunch !== launch || $('#app').hidden || assistantScope() !== launch.scope) return false;
    if (typeof checkVersion === 'function') checkVersion();
    // Settle the visible edit frame. Draft geometry and the undo stack stay with the editor.
    presentTimelineSeek();
    pausePlayback();
    cancelFieldGesture();
    filmFieldDraft = getFieldDraftLabel() ? editingField : null;
    filmRoom = openFilmRoom({
      play: current(), settings: viewSettings(), roster: state.data.roster, assistant: boardAssistant,
      lesson: lesson?.createFilmLesson({workspaceId:shared?.current?.id || 'local'}),
      onClose() {
        filmRoom = null;
        filmFieldDraft = null;
        if (!$('#app').hidden && assistantScope() === launch.scope) restoreScroll();
      },
    });
    return true;
  } catch (error) {
    filmFieldDraft = null;
    toast(t('film.openFailed'), { type:'error' });
    return false;
  } finally {
    if (filmLaunch === launch) filmLaunch = null;
  }
}

function syncFilmRoom() {
  filmRoom?.update(current(), {settings:viewSettings(), roster:state.data.roster});
}

function protectReference() {
  if (!current().reference) return;
  document.querySelectorAll('[data-action="mirror"],[data-action="rehearse-mode"],[data-action="play"]').forEach(n => { n.disabled = true; n.title = t("feedback.the_original_diagram_has_no_editable_or_playable_coordi"); });
}

function toast(message, { type = 'info', action = '', label = '', undo = false } = {}) {
  const node = $('#toast'), transaction=history.info(), undoable = undo && !!transaction && canEdit();
  node.dataset.type = type; node.setAttribute('role', type === 'error' ? 'alert' : 'status');
  const glyph = { success: '<path d="m7.5 12.5 3 3 6-7"/>', error: '<path d="M12 7.5v5.5M12 16.5h.01"/>', warning: '<path d="M12 8v4.5M12 16h.01"/>', info: '<path d="M12 11v5M12 8h.01"/>' }[type] || '<path d="M12 11v5M12 8h.01"/>';
  const symbol = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${glyph}</svg>`;
  node.innerHTML = `<span class="toast-icon" aria-hidden="true">${symbol}</span><span class="toast-message">${e(message)}</span>${undoable || action ? `<span class="toast-actions">${undoable ? `<button data-action="undo-transaction" data-transaction-id="${e(transaction.id)}" class="toast-undo">${t("editorExtra.undo")}</button>` : ''}${action ? `<button data-action="${e(action)}" class="toast-action">${e(label)}</button>` : ''}</span>` : ''}<button class="toast-close" data-action="dismiss-toast" aria-label="${t("editorExtra.dismiss_notification")}">${icon('close')}</button>`;
  node.classList.add('visible'); window.clearTimeout(toastTimer);
  if (type !== 'error') toastTimer = window.setTimeout(() => node.classList.remove('visible'), type === 'warning' ? 8000 : 5200);
}

function save({ replaceUnreadable = false, data = state.data } = {}) {
  if (cloudMode()) { shared?.schedule(data); return; }
  if (localRecovery && !replaceUnreadable) { toast(recoveryMessage, { type: 'error', action: 'local-recovery', label: t("editorExtra.recovery_options") }); return false; }
  let saved = false;
  try { localStorage.setItem(STORAGE_KEY, encodeWorkspace(data)); localSaveStatus = { kind: 'saved', label: t('editor.saved_locally') }; saved = true;localRevision++; }
  catch { localSaveStatus = { kind: 'error', label: t('feedback.not_saved') }; toast(t("feedback.save_failed_browser_storage_is_unavailable_or_full_expo"), { type: 'error', action: 'download-json', label: t("feedback.export_backup") }); }
  syncSaveStatus();
  return saved;
}
function fieldHasChanges(input) {
  const value = editorFieldValue(input);
  return input.type === 'checkbox' ? !!value !== input.checked : String(value ?? '') !== input.value;
}
function getFieldDraftLabel() {
  if (!editingField?.isConnected || editingField.disabled || !fieldHasChanges(editingField)) return '';
  return uxCopy('Editing · finish this field to save', '正在编辑 · 完成此输入后保存');
}
function visibleSaveStatus() {
  if (shared) return shared.visibleStatus();
  const field = getFieldDraftLabel();
  if (!field) return localSaveStatus;
  return localSaveStatus.kind === 'error'
    ? { kind: 'error', label: field + ' · ' + localSaveStatus.label }
    : { kind: 'unsaved', label: field };
}
function editorStatus({kind, label} = visibleSaveStatus()) {
  const icon = {error:'!', saved:'✓', readonly:'◉'}[kind] || '◌';
  const recovery = shared
    ? `<button type="button" data-cloud-action="sync-status">${t('cloud.syncDetails')}</button>`
    : localRecovery
      ? `<button type="button" data-action="local-recovery">${t('editorExtra.recovery_options')}</button>`
      : `<button type="button" data-action="retry-save">${uxCopy('Retry','重试')}</button><button type="button" data-action="download-json">${uxCopy('Export backup','导出备份')}</button>`;
  return `<div class="editor-status" data-state="${kind}" role="status" aria-live="polite"><span aria-hidden="true">${icon}</span><span data-save-label>${e(label)}</span>${kind==='error' ? recovery : ''}</div>`;
}
function syncSaveStatus() {
  const visible = visibleSaveStatus();
  $('#save-state')?.replaceChildren(document.createTextNode(visible.label));
  shared?.updateStatusBadge();
  const status = $('.editor-status');
  if (!status) return;
  const template = document.createElement('template');
  template.innerHTML = editorStatus(visible);
  status.dataset.state = visible.kind;
  patchEditorHTML(status, template.content.firstElementChild.innerHTML);
}
function editorFieldValue(input) {
  const key=input.dataset.prop;
  if(input.dataset.ball)return current().ball[input.dataset.ball];
  if(key?.startsWith('ball.'))return current().ball[key.slice(5)];
  const value=(selectedObject()||current())[key==='roster'?'rosterId':key];
  if(key==='color')return String(['player','route'].includes(selection?.type)?displayColor(value,viewSettings().fieldTheme==='light'):value).toLowerCase();
  return value;
}
window.addEventListener('beforeunload',event=>{
  const unsavedLocal=!cloudMode() && localSaveStatus.kind === 'error' && !localRecovery;
  const unfinished=canEdit() && (draft?.points.length>1 || rosterView.isEditing() || getFieldDraftLabel());
  if(unsavedLocal||unfinished){event.preventDefault();event.returnValue='';}
});
document.addEventListener('input',event=>{
  const input=event.target;
  if(!input.closest?.('#app')||!input.matches('[data-prop],[data-ball]')||!canEdit())return;
  editingField = input;
  syncSaveStatus();
});
function historyLabel(action) {
  const transaction=history.info(action==='redo'?history.future.at(-1):history.past.at(-1));
  return `${uxCopy(action==='redo'?'Redo':'Undo',action==='redo'?'重做':'撤销')}${transaction?.name?` · ${transaction.name}`:''}`;
}
function stop() {
  cancelTimelineSeek();
  time = playbackClock.pause() ?? time;
  playing = false;
}
function pausePlayback() {
  if (!playing) return;
  stop();
  paintPlayback();
  syncPlayback();
  updateCanvasHint();
}
function setPlaybackOptions(nextSpeed, nextLoop) {
  if (speed === nextSpeed && loop === nextLoop) return;
  time = playbackClock.configure(nextSpeed, nextLoop) ?? time;
  playing = playbackClock.running;
  speed = nextSpeed;
  loop = nextLoop;
}
function resetAnimation() { clearHistoryTransition(); stop(); time = 0; }
function paintPlayback(stamp, syncDigital = true) {
  updateAnimation($('#field svg'), current(), time);
  if (syncDigital) digitalBoard?.presentTimeline(stamp);
}
function presentPlaybackFrame(at, stamp, running) {
  time = at;
  playing = running;
  paintPlayback(stamp);
  if (playing) syncTimeline();
  else { syncPlayback(); updateCanvasHint(); }
}
function paintTimelineSeek(previousTime, stamp, syncDigital = true) {
  paintPlayback(stamp, syncDigital);
  const length = animationLength(current());
  syncTimeline(length);
  if (pausedStatus(previousTime, length) !== pausedStatus(time, length)) updateCanvasHint();
}
function seekTimeline(input, final = false) {
  const play = current();
  if (draft || play.reference) { input.value = time; return; }
  const requestedTime = Number(input.value);
  const nextTime = clamp(requestedTime, 0, animationLength(play)), modeChanged = !rehearsal || playing;
  if (nextTime !== requestedTime) input.value = nextTime;
  if (modeChanged || time !== nextTime) {
    if (playing) stop();
    if (!timelineSeek.pending) clearAssistantPreview();
    const previousTime = time;
    time = nextTime;
    rehearsal = true;
    if (modeChanged) { syncRehearsalMode(); updateCanvasHint(); syncPlayback(); }
    // Keep command reads and exports current while presenting only the last input per frame.
    timelineSeek.queue(modeChanged ? time : previousTime);
  }
  if (final) presentTimelineSeek();
}
function edit(fn, { redraw = true, name = '', source = 'manual' } = {}) {
  if (!canEdit()) { toast(editBlockedMessage(), { type: 'warning' }); return null; }
  cancelFieldGesture();
  clearAssistantPreview();
  resetAnimation(); rehearsal = false; draft = null; previewPoint = null;
  const before=clone(state);
  try {fn(current(),state.data);} catch(error) {state=before;toast(error.message,{type:'error'});return null;}
  const transaction=history.record(before,{name:name||uxCopy('Edit play','修改战术'),source,playId:state.selectedId},state.data);
  save(); if (redraw) render(); else refreshMetadata();
  return transaction;
}
function choose(id) { cancelFieldGesture(); if(id===state.selectedId){panels.close();return;} if (!confirmDraft(() => choose(id))) return; resetAnimation(); draft = null; selection = null; state.selectedId = id; panels.close({focus:false}); tool = 'select'; render(); }
function restore(next) {
  const previous = current(), field = $('#field .pitch-svg');
  const localField = field && renderedPlayId === previous.id && canRefreshHistoryField(state, next);
  const focused = field?.contains(document.activeElement) ? document.activeElement : null;
  const focusedType = focused && ['player','route','zone','annotation'].find(type => focused.hasAttribute('data-' + type));
  clearAssistantPreview();
  const frame = previous.id === next.selectedId && !assistantMotionReduced()
    ? captureHistoryFrame(field, previous, historyTransition) : null;
  clearHistoryTransition({sync:false});
  resetAnimation(); rehearsal = false; state = next; book = current().book;
  selection = null; draft = null;
  const saved = save();
  if (localField) {
    refreshGestureCommit({restoringHistory:true});
    showHistoryTransition(field, frame);
    digitalBoard?.sync({contentChanged:true});
    boardAssistant?.refresh();
    if (maddenLibrary.isOpen) maddenLibrary.refresh();
  } else render({restoringHistory:true, historyFrame:frame});
  if (focused && !focused.isConnected) {
    const board = $('#field .pitch-svg');
    const replacement = focusedType && previous.id === current().id && [...board.querySelectorAll('[data-' + focusedType + ']')]
      .find(node => node.dataset[focusedType] === focused.dataset[focusedType]);
    (replacement || board)?.focus({preventScroll:true});
  }
  return saved;
}
function restoreHistory(action) {
  if (!canEdit()) return false;
  cancelFieldGesture();
  let next;
  try { next = action === 'redo' ? history.redo(state) : history.undo(state); }
  catch (error) {
    if (!(error instanceof PersonnelHistoryConflict)) throw error;
    toast(uxCopy('Later roster or DEPTH CHART edits depend on this change. Review those edits before retrying.',
      '后续名单或 DEPTH CHART 调整依赖这次修改。请先检查这些调整，再重试。'), { type: 'warning' });
    return false;
  }
  if (!next) return false;
  boardAssistant?.adoptScope(scopeFor(next.selectedId));
  const saved = restore(next);
  const result = action === 'undo' ? uxCopy('Undone','已撤销') : uxCopy('Redone','已重做');
  if (saved !== false) toast([result, history.lastTransaction?.name].filter(Boolean).join(' · '), {type:'success'});
  if (history.lastTransaction) boardAssistant?.notifyTransaction?.(history.lastTransaction);
  return true;
}

function playCards(plays, selectedPlay) {
  return plays.length ? plays.map((play, i) => `<button data-action="choose:${e(play.id)}" class="play-card ${selectedPlay.id === play.id ? 'active' : ''}" aria-label="${t("editorExtra.open")}${e(play.title)}" aria-pressed="${selectedPlay.id === play.id}"><div class="play-thumb" data-thumbnail-index="${i}"></div><span class="play-card-info"><strong>${e(play.title)}</strong><small>${e(play.formation)} · ${e(play.category)}</small></span>${play.favorite ? '<span class="favorite-dot">★</span>' : ''}</button>`).join('') : `<div class="empty-list">${t("editorExtra.no_matching_plays_found")}<br>${t("editorExtra.try_another_search_or_clear_the_filters")}<button class="text-button" data-action="clear-filters">${t("editorExtra.clear_all_filters")}</button></div>`;
}

let renderedFieldState = '';
let renderedCardState = '';
const cardState = () => {const play=current();return JSON.stringify([play.id,play.title,play.formation,play.category,play.favorite,play.book]);};
const fieldState = () => JSON.stringify([current().reference ? [current().title,current().reference] :
  [current().players,current().routes,current().zones,current().annotations,current().ball],viewSettings(),selection,time,draft]);
const inspectorContext = () => `${selection?.type || 'play'}:${selection?.type === 'players' ? selectedPlayerIds(current(),selection).join(',') : selection?.id || current().id}`;

function render({restoringHistory = false, historyFrame = null} = {}) {
  clearHistoryTransition();
  const p = current(); if (!p) return;
  editorSessions.save(shared?.current?.id||'local',{selectedId:state.selectedId,query,filter,formationFilter});
  clearAssistantPreview();
  const previousPlay=renderedPlayId, existingIds=new Set([...document.querySelectorAll('#field [data-player]')].map(n=>n.dataset.player));
  const restoreScroll=captureEditorScroll({samePlay:previousPlay===p.id});
  const patchShell=previousPlay===p.id && !!$('#field .pitch-stage') && !!p.reference === $('.workspace')?.classList.contains('reference-play');
  document.documentElement.style.setProperty('--team-color', state.data.team.accent);
  document.title = `${p.title} · Playbook Studio`;
  const plays = filtered(), categories = [...new Set(state.data.plays.filter(p => p.book === book).map(p => p.category))];
  const formations = [...new Set(state.data.plays.filter(p => p.book === book).map(p => p.formation))];
  const settings=viewSettings();
  const chrome=!p.reference&&settings.visualMode==='digital' ? ` style="${digitalFieldChrome(settings.fieldTheme)}"` : '';
  const html = `<div class="workspace ${p.reference ? 'reference-play' : ''}" data-assistant-open="${assistantPanelOpen}">
    <button class="sidebar-scrim" data-action="close-panel" aria-label="${t("editor.close_side_panel")}" tabindex="-1"></button><aside class="sidebar" id="plays-panel" aria-label="${t("editor.play_list")}">
      <button class="panel-close compact-only" data-action="close-panel" aria-label="${t("editor.close_play_list")}">${icon('close')}</button>
      <a class="brand" href="${cloudMode() ? './index.html' : '#home'}" aria-label="Playbook Studio"><img class="brand-icon" src="./assets/brand/playbook-studio-icon.svg" width="44" height="24" alt=""><span>Playbook<span>Studio</span></span><small title="${cloudMode() ? t("editor.saved_in_the_cloud_and_shared_by_member_permissions") : t("editor.saved_in_this_browser_only_export_backups_regularly")}">${cloudMode() ? t("editor.cloud") : t("editor.local")}</small></a>
      <div class="team-switch"><span class="team-avatar" aria-hidden="true">${e([...(state.data.team.name || '').trim()][0] || '队')}</span><span><strong>${e(state.data.team.name)}</strong><small>${e(state.data.team.subtitle)}</small></span></div>
      <div class="side-label"><span>${t("editor.playbook")}</span></div>
      <nav class="book-nav" aria-label="${t("editor.playbook_type")}">${Object.keys(BOOKS).map(key => `<button ${key === 'offense' ? 'data-madden-drop="offense"' : ''} data-action="book:${key}" class="${key === book ? 'active' : ''}" aria-pressed="${key === book}">${icon(key === 'offense' ? 'route' : key === 'defense' ? 'zone' : 'flag')}<span>${t(key === 'offense' ? 'editor.offense' : key === 'defense' ? 'editor.defense' : 'editor.special_teams')}</span><em>${state.data.plays.filter(p => p.book === key).length}</em></button>`).join('')}</nav>
      <button class="madden-launch" data-action="madden-library">${icon('ball')}<span><strong>${t("editor.madden_nfl_play_library")}</strong><small>${t("editor.eagles_ravens_drag_to_add")}</small></span><b>↗</b></button>
      <div class="madden-drop-target" data-madden-drop="offense">${t("editor.drop_here_to_add_to_offense")}<small>${canEdit() ? t("editor.add_to_current_workspace_autosaved") : t("editor.read_only_cannot_add")}</small></div>
      <div class="side-divider"></div>
      <label class="search-box">${icon('search')}<input type="search" id="search" name="play-filter" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" data-lpignore="true" data-1p-ignore placeholder="${t("editor.search_plays")}" aria-label="${t("editor.search_plays_2")}" value="${e(query)}"></label>
      <div class="filters"><select aria-label="${t("editor.play_category")}" id="category-filter"><option value="">${t("editor.all_categories")}</option><option value="favorite" ${filter === 'favorite' ? 'selected' : ''}>${t("editor.favorites")}</option>${categories.map(c => `<option value="${e(c)}" ${c === filter ? 'selected' : ''}>${e(c)}</option>`).join('')}</select><select aria-label="${t("editor.formation_filter")}" id="formation-filter"><option value="">${t("editor.all_formations")}</option>${formations.map(f => `<option value="${e(f)}" ${formationFilter === f ? 'selected' : ''}>${e(f)}</option>`).join('')}</select></div>
      <div class="play-list-label"><span>${filter === 'favorite' ? t("editor.favorite_plays") : t("editor.my_plays")} <b>${plays.length}</b></span>${btn('new', 'plus', t("editor.new_play"), 'small-icon')}</div>
      <div class="play-list">${playCards(plays, p)}</div>
      <button class="new-play" data-action="new">${icon('plus')}${t("editorExtra.new_play")}</button>
      <div class="sidebar-bottom"><button data-action="import">${icon('folder')}${t("editorExtra.import_playbook")}</button><button data-action="help">${icon('help')}${t("editorExtra.guide")}<kbd>?</kbd></button><span class="local-status"><i></i><span id="save-state">${e(visibleSaveStatus().label)}</span></span></div>
    </aside>
    <main class="main" id="main-content" tabindex="-1">
      <header class="topbar"><div class="breadcrumbs">${btn('sidebar', 'menu', t("editor.toggle_play_list"), 'mobile-menu', `aria-expanded="${panels.active==='plays'}"`)}<span>${icon('book')} ${t(p.book === 'offense' ? 'editor.offense' : p.book === 'defense' ? 'editor.defense' : 'editor.special_teams')} ${t("editor.playbook")}</span><span class="crumb-slash">/</span><span>${e(p.formation)}</span></div><div class="top-actions"><button class="button subtle" data-action="madden-library" aria-label="${t("editor.open_madden_play_library")}">${icon('ball')}<span>${t("editor.madden_library")}</span></button>${effectsControl()}<button class="button subtle" data-action="print" aria-label="${t("editor.print_playbook")}">${icon('print')}<span>${t("editor.print")}</span></button><button class="button primary" data-action="export" aria-label="${t("editor.export_playbook")}">${icon('export')}<span>${t("editor.export")}</span></button></div></header>
      <div class="import-notice" data-import-notice="editor" aria-live="polite">${importNotice("editor")}</div>
      <section class="play-header"><div><div class="eyebrow"><span class="league-badge">${getPlayLeague(p)===5?uxCopy('5v5 Flag','5 人腰旗'):uxCopy(`${getPlayLeague(p)} per side`,`${getPlayLeague(p)} 人制`)}</span> <span>·</span> ${e(p.personnel)} <span>·</span> ${e(p.category)}</div><h1>${e(p.title)} ${btn('favorite', 'star', p.favorite ? t("editor.remove_favorite") : t("editor.favorite_play"), `favorite-button ${p.favorite ? 'is-favorite' : ''}`)}</h1>${editorStatus()}<p>${p.diagramSource ? t("editor.editable_reconstruction_move_players_draw_and_rehearse_") : p.reference ? t("editor.original_madden_diagram_favorite_annotate_export_and_pr") : canEdit() ? t("editor.select_a_player_to_draw_a_route_or_drag_to_adjust_posit") : t("editor.review_team_plays_and_rehearse_routes")}</p></div><div class="play-actions">${coachFilmEntry()}${p.diagramSource ? `<button class="button subtle" data-action="compare-source">${t("editorExtra.compare_source")}</button><button class="button subtle" data-action="space-madden-line">${t("editorExtra.normalize_line_spacing")}</button>` : ''}${btn('undo', 'undo', historyLabel('undo'), 'icon-button', !history.past.length ? 'disabled' : '')}${btn('redo', 'redo', historyLabel('redo'), 'icon-button', !history.future.length ? 'disabled' : '')}<span class="vertical-rule"></span>${btn('mirror', 'flip', t("editor.mirror"), 'icon-button')}${btn('duplicate', 'copy', t("editor.duplicate_play"), 'icon-button')}</div></section>
      ${!canEdit() ? `<div class="readonly-banner"><strong>${localRecovery ? t("editor.recovery_required") : shared?.sync?.viewError ? t("editor.view_recovery_required") : t("editor.read_only")}</strong><span>${localRecovery || shared?.sync?.viewError ? e(editBlockedMessage()) : t("editor.you_can_view_rehearse_export_and_print_ask_an_administr")}</span>${localRecovery ? `<button class="button subtle" data-action="local-recovery">${t("editor.recovery_options")}</button>` : ''}</div>` : ''}<div class="editor-layout"><section class="canvas-section" aria-label="${t("editor.field_and_rehearsal")}">
        <div class="canvas-heading">${boardSizeControls()}<div class="canvas-actions"><div class="selection-toolbar">${selectionControls()}</div><div class="view-tools" role="group" aria-label="${t("editor.field_display_options")}">${btn('grid', 'grid', t("editor.show_or_hide_yard_lines"), 'tool-button')}${btn('theme', 'sun', t("editor.toggle_field_brightness"), 'tool-button')}</div><details class="add-object-menu"><summary aria-label="${t("editor.add_objects")}">${icon('plus')}<span>${t("editor.add_objects")}</span></summary><div><button data-action="add-player:offense">${icon('plus')}${t("editor.add_offensive_player")}</button><button data-action="add-player:defense">${icon('plus')}${t("editor.add_defensive_player")}</button>${isFlag5Play(p) ? `<button data-action="opponents">${icon('team')}${t(p.players.some(v => v.side === (p.book === 'defense' ? 'offense' : 'defense')) ? 'editor.flag5_remove_opponents' : 'editor.flag5_add_opponents')}<small>${t('editor.flag5')}</small></button>` : `<button data-action="add-defense-43" title="${t('editor.defense43_detail')}">${icon('team')}${t(p.players.some(v => v.side === 'defense') ? 'editor.reset' : 'editor.add')} ${t('editor.defense43')}<small>${t('editor.defense43_detail')}</small></button>`}<button data-action="tool:zone">${icon('zone')}${t("editor.draw_coverage_zone")}</button><button data-action="tool:text">${icon('text')}${t("editor.add_text")}</button></div></details></div></div>
        <div id="field"${chrome} class="field-wrap tool-${tool} ${rehearsal ? 'is-rehearsal' : ''}"><div class="pitch-viewport" aria-label="${t("editor.scalable_play_board")}"><div class="pitch-stage">${patchShell ? '' : fieldSVG(p, settings, { selected: selection, time, drawing: draft })}</div></div><div class="field-tag" title="${t("editor.offense_defense_players")}">${icon('ball')} <span>${t("editor.offense")} ${p.players.filter(v => v.side === 'offense').length} · ${t("editor.defense")} ${p.players.filter(v => v.side === 'defense').length}</span></div><div id="field-context" class="field-context">${fieldContext()}</div><div class="drag-readout" hidden></div></div>
        <div class="stage-dock"><div class="editor-mode" role="group" aria-label="${t("editor.workspace_mode")}"><button data-action="edit-mode" aria-pressed="${!rehearsal}" class="${!rehearsal?'active':''}">${icon('select')}${t("editor.design_play")}</button><button data-action="rehearse-mode" aria-pressed="${rehearsal}" class="${rehearsal?'active':''}">${icon('play')}${t("editor.rehearse")}</button></div><div class="toolbar" role="toolbar" aria-label="${t("editor.drawing_tools")}"><div class="draw-tools" style="--tool-index:${['select','route','block','motion','pass','zone','text'].indexOf(tool)}"><span class="tool-indicator" aria-hidden="true"></span>${[['select', 'select', t("editor.select_move_v")], ['route', 'route', t("editor.route_r")], ['block', 'block', t("editor.block_b")], ['motion', 'motion', t("editor.pre_snap_motion_m")], ['pass', 'pass', t("editor.pass_p")], ['zone', 'zone', t("editor.coverage_zone_z")], ['text', 'text', t("editor.text_t")]].map(([a, i, l]) => `<button class="tool-button ${tool === a ? 'active' : ''}" data-action="tool:${a}" title="${e(l)}" aria-label="${e(l)}" aria-pressed="${tool === a}">${icon(i)}<span class="tool-name">${({select:t("editor.select"),route:t("editor.route"),block:t("editor.block"),motion:t("editor.motion"),pass:t("editor.pass"),zone:t("editor.zone"),text:t("editor.text")})[a]}</span><kbd>${l.split(' · ')[1]}</kbd></button>`).join('')}</div></div><div class="playback"><div class="playback-top"><div class="playback-title">${icon('play')}<span>${t("editor.rehearse")}</span><small id="playback-phase">${playbackPhase()}</small></div><div class="playback-options"><label class="speed-label">${t("editorExtra.speed")}<select id="speed" aria-label="${t("editor.playback_speed")}">${[.5, 1, 1.5, 2].map(s => `<option value="${s}" ${s === speed ? 'selected' : ''}>${s}×</option>`).join('')}</select></label>${btn('loop', 'loop', t("editor.loop"), `icon-button ${loop ? 'enabled' : ''}`, `aria-pressed="${loop}"`)}</div></div><div class="transport">${btn('play', playing ? 'pause' : 'play', playing ? t("editor.pause") : t("editor.play"), 'play-button')}${btn('reset', 'reset', t("editor.reset_animation"), 'icon-button')}<input type="range" id="timeline" aria-label="${t("editor.animation_time")}" min="0" max="${animationLength(p)}" step="0.01" value="${time}"><span id="time-label">${time.toFixed(1)} <span>/ ${animationLength(p).toFixed(1)}s</span></span></div>${filmPilotVariant === 'events' && !deviceIsTraditional() ? `<div data-film-pilot-mount>${pilot.filmPilotEventControls(p)}</div>` : ''}</div></div>
        ${boardHeightHandle}
        <div class="canvas-hint" aria-live="polite">${canvasHint()}</div>
      </section>${boardWidthHandle}<section class="inspector-panel" id="properties-panel" aria-label="${t("editor.play_properties")}"><header class="panel-heading compact-only"><strong>${t("editor.properties_and_settings")}</strong><button class="panel-close" data-action="close-panel" aria-label="${t("editor.close_properties")}">${icon('close')}</button></header><div class="task-panel-tabs" role="group" aria-label="${uxCopy('Task panel','任务面板')}"><button type="button" data-action="properties-task" aria-pressed="${!assistantPanelOpen}">${uxCopy('Properties','属性')}</button><button type="button" data-action="assistant-task" aria-pressed="${assistantPanelOpen}">AI ${uxCopy('assistant','助手')}</button></div><aside class="inspector" ${assistantPanelOpen?'hidden':''} data-context="${e(inspectorContext())}" aria-label="${t("editor.play_properties")}">${inspector()}</aside></section></div>
      <footer class="app-footer"><span>PLAYBOOK STUDIO</span><span>${t("editor.draw_the_routes_understand_the_game")}</span><button data-action="help">${t("editorExtra.shortcuts_and_help")}${icon('chevron')}</button></footer>
    </main><nav class="compact-nav" aria-label="${t("editor.workspace_panels")}"><button data-action="sidebar" aria-controls="plays-panel">${icon('book')}<span>${t("editor.playbook")}</span></button><button data-action="panel-field" aria-pressed="true">${icon('grid')}<span>${t("editor.field")}</span></button><button type="button" data-action="undo" title="${e(historyLabel('undo'))}" aria-label="${e(historyLabel('undo'))}" ${history.past.length?'':'disabled'}>${icon('undo')}<span>${uxCopy('Undo','撤销')}</span></button><button type="button" data-action="redo" title="${e(historyLabel('redo'))}" aria-label="${e(historyLabel('redo'))}" ${history.future.length?'':'disabled'}>${icon('redo')}<span>${uxCopy('Redo','重做')}</span></button><button data-action="inspector-panel" aria-controls="properties-panel">${icon('select')}<span>${t("editor.properties")}</span></button></nav></div>`;
  // A same-play update patches only changed shell nodes; managed SVG, AI and
  // material surfaces stay connected. Switching plays keeps a fresh boundary.
  if (patchShell) {
    patchEditorHTML($('#app'),html);
    if (renderedFieldState !== fieldState()) renderField({syncDigital:!restoringHistory});
  } else { $('#app').innerHTML = html; renderedFieldState = fieldState(); }
  thumbnails.mount($('.play-list'), plays);
  bindField(); syncEditorChrome(); protectReadOnly(); protectReference(); boardLayout.mount(); maddenLibrary.refresh(); mountBoardAssistant();
  if ($('#personnel-group')?.value) previewPersonnel();
  restoreScroll();
  if (restoringHistory) showHistoryTransition($('#field .pitch-svg'), historyFrame);
  else if (previousPlay && previousPlay!==p.id) revealPlay($('#field svg'));
  else if(previousPlay) enterPlayers($('#field'),new Set(p.players.filter(v=>!existingIds.has(v.id)).map(v=>v.id)));
  if(!previousPlay) {
    enterWorkbench(document.querySelector('.workspace'));
    clearUnsolicitedSearchAutofill();
    window.requestAnimationFrame?.(clearUnsolicitedSearchAutofill);
  }
  renderedPlayId=p.id;
  renderedCardState=cardState();
  if (editingField) syncSaveStatus();
  digitalBoard?.sync({contentChanged:restoringHistory});
  syncFilmRoom();
}
function selectionControls() {
  if (!canEdit() || current().reference) return '';
  const english=getLocale()==='en', count=selectedPlayerIds(current(),selection).length;
  return `<button type="button" data-action="multi-select" aria-pressed="${multiSelectMode}" title="${english?'Shift-click players, or turn on multiple selection.':'按住 Shift 点选球员，或开启多选。'}">${icon('team')}<span>${multiSelectMode ? (english?'Finish selecting':'完成多选') : (english?'Select multiple':'多选球员')}</span></button>${count>1 ? `<span class="selection-count" role="status">${english?`${count} selected`:`已选 ${count} 人`}</span>` : ''}`;
}
function fieldContext() {
  const english=getLocale()==='en';
  if(selectionCandidates.length && selectionCandidateScope!==assistantScope())selectionCandidates=[];
  if(selectionCandidates.length) return `<div class="selection-candidates" role="group" aria-label="${english?'Choose the intended object':'选择要操作的对象'}"><span>${english?'Choose a player or waypoint':'选择球员或路线节点'}</span>${selectionCandidates.map((candidate,index)=>`<button data-action="pick-candidate:${index}">${candidate.type==='player'?e(candidate.label):(english?`Waypoint ${candidate.index}`:`路线节点 ${candidate.index}`)}</button>`).join('')}<button data-action="dismiss-candidates" aria-label="${t('editorExtra.close')}">${icon('close')}</button></div>`;
  if(rehearsal) return `<span class="context-status"><i class="live-dot"></i>${t(playing?'feedback.playing':pausedStatus(time,animationLength(current())))}</span><button class="context-primary" data-action="play" aria-label="${playing?t("feedback.pause_rehearsal"):t("feedback.start_rehearsal")}">${icon(playing?'pause':'play')}${playing?t("feedback.pause"):time>=animationLength(current())?t("feedback.replay"):t("feedback.play")}</button><button data-action="reset" aria-label="${t("editorExtra.restart_rehearsal")}">${icon('reset')}</button><button data-action="edit-mode">${t("editor.back_to_design")}</button>`;
  if(draft) {
    const owner=current().players.find(p=>p.id===draft.playerId);
    const hasMain = competingMainRoutes(current(), {playerId:draft.playerId, kind:tool}).length > 0;
    const purpose = hasMain ? `<select id="draft-mode" aria-label="${t('editorExtra.new_route_purpose')}" title="${t('editorExtra.this_player_already_has_a_main_route')}"><option value="main" ${draft.mode !== 'optional' ? 'selected' : ''}>${t('editorExtra.use_as_main')}</option><option value="optional" ${draft.mode === 'optional' ? 'selected' : ''}>${t('editorExtra.add_as_optional')}</option></select>` : '';
    return `<span class="context-player">${e(owner?.label)}<small>${draft.points.length-1}${t("editorExtra.route_points")}</small></span>${purpose}<button data-action="undo-point" ${draft.points.length<2?'disabled':''}>${icon('undo')}${t("editor.undo_point")}</button><button class="context-primary" data-action="finish-route" ${draft.points.length<2?'disabled':''}>${icon('check')}${t("editor.finish")}</button><button data-action="cancel-draft" aria-label="${t("editor.cancel_route")}">${icon('close')}</button>`;
  }
  if(selection?.type==='players' && canEdit())return `<span class="context-player">${english?`${selectedPlayerIds(current(),selection).length} players selected`:`已选 ${selectedPlayerIds(current(),selection).length} 名球员`}<small>${multiSelectMode?(english?'Tap to add or remove':'点选增减球员'):(english?'Drag any selected player to move the group':'拖动任一已选球员移动整组')}</small></span>${multiSelectMode?`<button class="context-primary" data-action="multi-select">${icon('check')}${english?'Done':'完成选择'}</button>`:''}<button data-action="delete-selection">${icon('trash')}${t('editor.delete')}</button><button data-action="clear-selection" aria-label="${t('editor.clear_selection')}">${icon('close')}</button>`;
  if(multiSelectMode && canEdit())return `<span class="context-player">${english?'Tap players to add or remove':'依次点选球员，可再次点选移除'}<small>${english?`${selectedPlayerIds(current(),selection).length} selected`:`已选 ${selectedPlayerIds(current(),selection).length} 人`}</small></span><button class="context-primary" data-action="multi-select">${icon('check')}${english?'Done':'完成选择'}</button><button data-action="clear-selection" aria-label="${t('editor.clear_selection')}">${icon('close')}</button>`;
  if(selection?.type==='player' && canEdit())return `<span class="context-player">${e(selectedObject()?.label)}<small>${t("editor.selected")}</small></span><button class="context-primary" data-action="tool:route">${icon('route')}${t("editor.draw_route")}</button><button data-action="delete-selection" aria-label="${t("editor.delete_selected_player")}">${icon('trash')}</button><button data-action="clear-selection" aria-label="${t("editor.clear_selection")}">${icon('close')}</button>`;
  if(selection?.type==='route' && canEdit())return `<span>${t("editor.drag_points_to_adjust_the_route")}</span><button data-action="delete-selection">${icon('trash')}${t("editor.delete")}</button><button data-action="clear-selection" aria-label="${t("editor.clear_selection")}">${icon('close')}</button>`;
  if(['zone','annotation'].includes(selection?.type) && canEdit())return `<span>${selection.type==='zone'?t('editor.coverage_zone'):t('editor.text_annotation')}</span><button data-action="inspector-panel">${t('editor.properties')}</button><button data-action="delete-selection">${icon('trash')}${t('editor.delete')}</button><button data-action="clear-selection" aria-label="${t('editor.clear_selection')}">${icon('close')}</button>`;
  return '';
}
function canvasHint() {
  if (current().reference) return `<span><i class="hint-dot"></i>${t("editorExtra.original_huddle_gg_diagram_routes_cannot_be_d")}</span>`;
  const drawing = drawingTools.includes(tool), active = draft ? (draft.points.length > 1 ? 3 : 2) : selection?.type === 'player' ? 2 : 1;
  return `<span><i class="hint-dot"></i>${canEdit() ? hint() : t("feedback.read_only_select_a_player_or_route_to_inspect_it_or_pla")}</span><span class="shortcut-hint">${draft?t("feedback.click_to_add_points_backspace_to_undo_enter_to_finish"):selection?t("feedback.esc_to_clear_selection_delete_to_remove_undo_available"):t("feedback.v_select_r_route_space_play")}</span>${drawing && canEdit() ? `<div class="drawing-steps">${[t("feedback.select_a_player"),t("feedback.click_route_endpoints_turns"),t("feedback.finish_and_save")].map((v,i)=>`<span class="${active === i+1 ? 'current' : ''}"><b>${i+1}</b>${v}</span>`).join('')}</div>` : ''}`;
}
// Compare the editor's markup, since the live DOM also contains material
// canvases and playback controls with independently updated attributes.
const renderedHintMarkup = new WeakMap();
function syncHintRegion(node, html, animate = false) {
  if (!node) return;
  const previous = renderedHintMarkup.get(node);
  if (previous === html) return;
  patchEditorHTML(node, html);
  renderedHintMarkup.set(node, html);
  if (animate && previous !== undefined && html) enterContext(node);
}
function updateCanvasHint() {
  syncHintRegion($('.canvas-hint'), canvasHint());
  syncHintRegion($('#field-context'), fieldContext(), true);
  syncHintRegion($('.selection-toolbar'), selectionControls());
}
function pausedStatus(at, length) {
  return at >= length ? 'editor.rehearsal_complete' : at ? 'feedback.paused' : 'feedback.ready';
}
function playbackPhase(play = current(), length = animationLength(play)) {
  const { receiverId, passAt, arriveAt } = play.ball;
  return time===0?t("editor.ready"):time>=length?t("editor.rehearsal_complete"):receiverId && time>=passAt && time<arriveAt?t("editor.passing"):receiverId && time>=arriveAt?t("editor.after_catch"):t("editor.routes_in_motion");
}
function syncTimeline(length = animationLength(current())) {
  const timeline=$('#timeline');if(!timeline)return;
  if (Number(timeline.max) !== length) timeline.max = length;
  if (Number(timeline.value) !== time) timeline.value = time;
  timeline.style.setProperty('--progress',`${time/length*100}%`);
  const label=$('#time-label'), phase=$('#playback-phase'), phaseText=playbackPhase(current(), length);
  const stamp=`${time.toFixed(1)} <span>/ ${length.toFixed(1)}s</span>`;
  if(label.innerHTML!==stamp)label.innerHTML=stamp;
  if(phase.textContent!==phaseText)phase.textContent=phaseText;
}
function syncPlayback() {
  if (!$('#timeline')) return;
  syncTimeline();
  for(const button of document.querySelectorAll('[data-action="play"]')){
    const contextual=!!button.closest('.field-context'),label=contextual?(playing?t("feedback.pause_rehearsal"):t("feedback.start_rehearsal")):(playing?t("editor.pause"):t("editor.play"));
    if(button.getAttribute('aria-label')!==label){button.innerHTML=icon(playing?'pause':'play')+(contextual?(playing?t("feedback.pause"):t("feedback.play")):'');button.setAttribute('aria-label',label);button.title=label;}
  }
  $('.playback').classList.toggle('is-playing',playing);
  $('#field').classList.toggle('is-running',playing);
  if ($('#speed')) $('#speed').value=String(speed);
  for (const button of document.querySelectorAll('[data-action="loop"]')) {
    button.classList.toggle('enabled',loop);button.setAttribute('aria-pressed',String(loop));
  }
}
function syncRehearsalMode() {
  $('#field').classList.toggle('is-rehearsal',rehearsal);
  $('.toolbar')?.classList.toggle('rehearsal-toolbar',rehearsal);
  for(const action of ['edit-mode','rehearse-mode']) {const button=$(`.editor-mode [data-action="${action}"]`);if(button){const active=action==='rehearse-mode'?rehearsal:!rehearsal;button.classList.toggle('active',active);button.setAttribute('aria-pressed',active);}}
}
function syncEditorChrome() {
  const field=$('#field');if(!field)return;
  field.className=`field-wrap tool-${tool} ${rehearsal?'is-rehearsal':''} ${playing?'is-running':''}`;
  for(const button of document.querySelectorAll('[data-action^="tool:"]')) {const active=button.dataset.action===`tool:${tool}`;button.classList.toggle('active',active);button.setAttribute('aria-pressed',active);}
  $('.draw-tools')?.style.setProperty('--tool-index',['select','route','block','motion','pass','zone','text'].indexOf(tool));
  syncRehearsalMode();
  const gridButton=$('[data-action="grid"]'), gridVisible=viewSettings().showGrid!==false;
  gridButton?.classList.toggle('enabled',gridVisible);
  gridButton?.setAttribute('aria-pressed',String(gridVisible));
  $('[data-action="theme"]')?.setAttribute('aria-pressed',String(viewSettings().fieldTheme==='light'));
  if ($('#show-names')) $('#show-names').checked=!!viewSettings().showNames;
  panels.mount();
  updateCanvasHint();syncPlayback();
}
function setTool(next) {
  cancelFieldGesture();
  if (current().reference) { if (next !== 'select') toast(t("feedback.this_original_diagram_supports_notes_but_has_no_editabl"), { type: 'warning' }); return; }
  if(next===tool && draft)return;
  if(next!==tool && !confirmDraft(()=>setTool(next)))return;
  resetAnimation(); rehearsal=false; tool=next; draft=null;previewPoint=null;
  multiSelectMode=false;selectionCandidates=[];
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
  if (!play.ball.holderId) return play.ball.unconfirmedHolderId
    ? t("editor.unconfirmed_ball_carrier", { player: label(play.ball.unconfirmedHolderId) }) : t("editor.no_ball_carrier");
  return play.ball.receiverId ? `${label(play.ball.holderId)} → ${label(play.ball.receiverId)}` : `${label(play.ball.holderId)}${t("editorExtra.run")}`;
}
function personnelPicker(play) {
  if (!canEdit()) return '';
  const groups = state.data.depthChart.groups.filter(group => group.unit === play.book);
  const choices = groups.filter(group => group.slots.length);
  return `<details class="inspector-section"><summary class="inspector-heading"><span>${t('editor.chart_starters')}</span></summary>
    ${choices.length ? `<label class="form-field"><span>${t('editor.chart_group')}</span><select id="personnel-group">
      <option value="">${t('editor.chart_choose')}</option>${choices.map(group => option(group.id, group.name, '')).join('')}</select></label>
      <p class="muted small" id="personnel-preview" role="status">${t('editor.chart_hint')}</p>
      <button class="button subtle full" data-action="apply-personnel" disabled>${t('editor.chart_apply')}</button>` :
      `<p class="muted small">${t('editor.chart_empty')}</p>`}
    </details>`;
}
function chosenPersonnel() {
  const group = state.data.depthChart.groups.find(item => item.id === $('#personnel-group')?.value);
  const matches = personnelAssignments(current(), group, state.data.roster);
  return { group, matches, changes: matches.filter(({ marker, player }) => player ? marker.rosterId !== player.id || marker.name !== player.name : !!marker.rosterId) };
}
function previewPersonnel() {
  const { group, matches, changes } = chosenPersonnel();
  const preview = $('#personnel-preview');
  if (!group) preview.textContent = t('editor.chart_hint');
  else {
    const total = group.slots.filter(slot => slot.playerIds[0]).length;
    const assigned=matches.filter(({player})=>player).length,cleared=changes.filter(({player})=>!player).length;
    const labels = matches.map(({ marker, player }) => `${marker.label} · ${player?.name||t('depth.vacant')}`).join(' / ');
    preview.textContent = [t('editor.chart_match_count', { count: assigned, total }), labels,
      cleared ? t('editor.chart_clear_bindings',{count:cleared}) : '',assigned < total ? t('editor.chart_skipped') : '', matches.length && !changes.length ? t('editor.chart_current') : ''].filter(Boolean).join(' ');
  }
  $('[data-action="apply-personnel"]').disabled = !canEdit() || !changes.length;
}
function inspector() {
  const p = current(), obj = selectedObject();
  let content;
  if (p.reference) return `${hasEditableTrace(p.reference.catalogId) ? `<button class="button primary full" data-action="convert-reference">${t("editorExtra.create_editable_copy")}</button>` : ''}<div class="madden-source-box"><strong>${e(p.reference.game)} · ${e(teamDisplayName(p.reference.team))}</strong><p>${e(p.formation)}</p><p>${t("editorExtra.the_original_diagram_retains_its_routes_and_w")}</p><a href="${e(p.reference.sourceUrl)}" target="_blank" rel="noopener noreferrer">${t("editorExtra.view_source_on_huddle_gg")}</a></div>${fieldInput(t("editor.play_name"), 'title', p.title, 'text', 'maxlength="120"')}${fieldInput(t("editor.category"), 'category', p.category, 'text', 'maxlength="60"')}<div class="inspector-heading"><span>${t("editor.coach_notes")}</span></div><textarea data-prop="notes" rows="8" aria-label="${t("editor.coach_notes")}" placeholder="${t("editorExtra.situations_reads_adjustments")}" maxlength="10000">${e(p.notes)}</textarea><button class="button danger quiet full" data-action="delete-play">${icon('trash')}${t("editor.delete_play")}</button><div class="inspector-note">${icon('check')}${cloudMode() ? t("editor.uses_this_playbook_s_save_and_membership_permissions") : t("editor.autosaved_in_this_browser")}</div>`;
  if (selection?.type === 'players') {
    const english=getLocale()==='en', ids=selectedPlayerIds(p,selection), players=p.players.filter(player=>ids.includes(player.id));
    content=`<div class="inspector-heading"><span>${english?'Selected players':'已选球员'}</span><span class="tag">${ids.length}</span></div><p class="muted small">${english?'Drag a selected player to move the whole group. Routes move with their owners. One Undo restores the group.':'拖动任一已选球员移动整组；关联路线一起移动，一次撤销恢复整组。'}</p><ul class="selection-player-list">${players.map(player=>`<li>${e(player.label)}${player.name?` · ${e(player.name)}`:''}<small> · ${player.side==='offense'?t('editor.offense'):t('editor.defense')}</small></li>`).join('')}</ul><div class="selection-nudge" role="group" aria-label="${english?'Move group by one board unit':'整组移动一个画板单位'}">${[['left','←'],['up','↑'],['down','↓'],['right','→']].map(([direction,label])=>`<button class="button subtle" data-action="selection-nudge:${direction}" aria-label="${english?`Move group ${direction}`:({left:'整组左移',up:'整组上移',down:'整组下移',right:'整组右移'})[direction]}">${label}</button>`).join('')}</div><button class="button danger full" data-action="delete-selection">${icon('trash')}${english?`Delete ${ids.length} players`:`删除 ${ids.length} 名球员`}</button>`;
  } else if (selection?.type === 'player' && obj) {
    const assigned = obj.rosterId || '';
    content = `<div class="inspector-heading"><span>${t("editor.player_settings")}</span><span class="tag">${obj.side === 'offense' ? t("editor.offense") : t("editor.defense")}</span></div><div class="player-preview"><span style="background:${displayColor(obj.color, viewSettings().fieldTheme === 'light')};color:${displayColor(obj.color, viewSettings().fieldTheme === 'light') === '#eef0f3' ? '#111214' : ''}">${e(obj.label)}</span><div><strong>${e(obj.name || t("editor.unassigned"))}</strong><small>${t("editor.drag_the_marker_to_change_position")}</small></div></div>${fieldInput(t("editor.position_label"), 'label', obj.label, 'text', 'maxlength="10"')}<label class="form-field"><span>${t("editor.assign_roster_player")}</span><select data-prop="roster"><option value="">${t("editor.no_player_assigned")}</option>${state.data.roster.map(r => option(r.id, `#${r.number} ${r.name} · ${r.position}`, assigned)).join('')}</select></label>${fieldInput(t("editor.display_name"), 'name', obj.name, 'text', 'maxlength="80"')}<div class="form-row">${fieldInput(t("editor.marker_color"), 'color', displayColor(obj.color, viewSettings().fieldTheme === 'light'), 'color')}<label class="form-field"><span>${t("editor.shape")}</span><select data-prop="shape">${[['circle', t("editor.circle")], ['square', t("editor.square")], ['triangle', t("editor.triangle")]].map(([v, l]) => option(v, l, obj.shape)).join('')}</select></label></div><div class="inspector-divider"></div><div class="inspector-heading"><span>${t("editor.draw_a_route")}</span></div><div class="route-quick">${[['route', t("editor.route")], ['block', t("editor.block")], ['motion', t("editor.motion")], ['pass', t("editor.pass")]].map(([v, l]) => `<button data-action="tool:${v}" class="${tool === v ? 'active' : ''}">${icon(v)}${l}</button>`).join('')}</div><div class="route-list">${p.routes.filter(r => r.playerId === obj.id).map(r => `<button data-action="select-route:${e(r.id)}">${icon(r.kind)}<span>${r.optional ? t("editor.optional") : ''}${({ route: t("editor.route_2"), block: t("editor.block_2"), motion: t("editor.motion_2"), pass: t("editor.pass_2") })[r.kind]}</span>${icon('chevron')}</button>`).join('')}</div><button class="button danger full" data-action="delete-selection">${icon('trash')}${t("editor.remove_player")}</button>`;
  } else if (selection?.type === 'route' && obj) {
    const owner = p.players.find(v => v.id === obj.playerId);
    content = `<div class="inspector-heading"><span>${t("editor.route_settings")}</span><span class="tag">${e(owner?.label)}</span></div><p class="muted small">${t("editor.drag_the_solid_points_on_the_field_to_adjust_the_route")}</p><label class="form-field"><span>${t("editor.line_type")}</span><select data-prop="kind">${[['route', t("editor.solid_route")], ['block', t("editor.block_2")], ['motion', t("editor.zigzag_motion")], ['pass', t("editor.dashed_pass")]].map(([v, l]) => option(v, l, obj.kind)).join('')}</select></label><div class="form-row">${fieldInput(t("editor.route_color"), 'color', displayColor(obj.color, viewSettings().fieldTheme === 'light'), 'color')}<label class="form-field"><span>${t("editor.end_marker")}</span><select data-prop="endCap">${[['arrow', t("editor.arrow")], ['bar', t("editor.block_bar")], ['dot', t("editor.dot")]].map(([v, l]) => option(v, l, obj.endCap)).join('')}</select></label></div><label class="check-label"><input data-prop="smooth" type="checkbox" ${obj.smooth ? 'checked' : ''}>${t("editor.smooth_curve")}</label><label class="check-label"><input data-prop="optional" type="checkbox" ${obj.optional ? 'checked' : ''}>${t("editor.optional_route_excluded_from_main_animation")}</label><div class="inspector-divider"></div><div class="inspector-heading"><span>${t("editor.animation_timing")}</span><small>${t("editor.sec")}</small></div><div class="form-row">${fieldInput(t("editor.start_delay"), 'delay', obj.delay, 'number', 'min="0" max="10" step="0.1"')}${fieldInput(t("editor.duration"), 'duration', obj.duration, 'number', 'min="0.2" max="10" step="0.1"')}</div><p class="muted small">${t("editor.players_move_at_a_constant_speed_along_the_route_blocks")}</p><button class="button danger full" data-action="delete-selection">${icon('trash')}${t("editor.delete_route")}</button>`;
  } else if (selection?.type === 'zone' && obj) {
    content = `<div class="inspector-heading"><span>${t("editor.coverage_zone")}</span></div>${fieldInput(t("editor.zone_name"), 'label', obj.label, 'text', 'maxlength="80"')}${fieldInput(t("editor.zone_color"), 'color', obj.color, 'color')}<div class="form-row">${fieldInput(t("editor.horizontal_radius"), 'rx', obj.rx, 'number', 'min="1" max="50" step="1"')}${fieldInput(t("editor.vertical_radius"), 'ry', obj.ry, 'number', 'min="1" max="50" step="1"')}</div><p class="muted small">${t("editor.drag_the_center_to_move_the_coverage_zone")}</p><button class="button danger full" data-action="delete-selection">${icon('trash')}${t("editor.delete_zone")}</button>`;
  } else if (selection?.type === 'annotation' && obj) {
    content = `<div class="inspector-heading"><span>${t("editor.text_annotation")}</span></div>${fieldInput(t("editor.annotation_text"), 'text', obj.text, 'text', 'maxlength="200"')}<p class="muted small">${t("editor.drag_the_text_to_reposition_it")}</p><button class="button danger full" data-action="delete-selection">${icon('trash')}${t("editor.delete_annotation")}</button>`;
  } else {
    content = `<div class="inspector-heading"><span>${t("editor.play_details")}</span><span class="tag">${t(p.book === 'offense' ? 'editor.offense' : p.book === 'defense' ? 'editor.defense' : 'editor.special_teams')}</span></div>${fieldInput(t("editor.play_name"), 'title', p.title, 'text', 'maxlength="120"')}${fieldInput(t("editor.category"), 'category', p.category, 'text', 'maxlength="60"')}<label class="form-field"><span>${t("editor.formation_template")}</span><select id="apply-formation"><option value="">${e(p.formation)}</option>${formationChoices(p.book, getPlayLeague(p), '', true)}</select></label><p class="muted small" data-play-format>${e(leagueLabel(getPlayLeague(p)))}${isFlag5Play(p) ? ` · ${t('editor.flag5_hint')}` : ''}</p>${fieldInput(t("editor.personnel"), 'personnel', p.personnel, 'text', 'maxlength="80"')}${personnelPicker(p)}<div class="formation-actions"><button data-action="save-formation">${icon('save')}${t("editorExtra.save_formation")}</button><button data-action="opponents">${icon('team')} ${p.players.some(v => v.side === (p.book === 'defense' ? 'offense' : 'defense')) ? t("editorExtra.remove") : t("editorExtra.add")}${t("editorExtra.opposing_formation")}</button></div><div class="inspector-divider"></div><div class="inspector-heading"><span>${t("editor.coach_notes")}</span></div><textarea data-prop="notes" rows="5" aria-label="${t("editor.coach_notes")}" placeholder="${t("editor.reads_routes_adjustments")}" maxlength="10000">${e(p.notes)}</textarea><div class="inspector-divider"></div><details class="inspector-section ball-section" ${ballSectionOpen ? 'open' : ''}><summary class="inspector-heading"><span>${t("editor.ball_movement")}</span><small>${e(ballSummary(p))}</small></summary><label class="form-field"><span>${t("editor.ball_carrier")}</span><select data-ball="holderId">${option('', t("editor.no_ball_carrier"), p.ball.holderId)}${p.players.map(v => option(v.id, `${v.label}${v.name ? ' · ' + v.name : ''}`, p.ball.holderId)).join('')}</select></label><label class="form-field"><span>${t("editor.pass_to")}</span><select data-ball="receiverId" ${p.ball.holderId ? '' : 'disabled'}><option value="">${t("editor.no_pass_run")}</option>${p.players.filter(v => v.id !== p.ball.holderId).map(v => option(v.id, `${v.label}${v.name ? ' · ' + v.name : ''}`, p.ball.receiverId)).join('')}</select></label><div class="form-row">${fieldInput(t("editor.release_time"), 'ball.passAt', p.ball.passAt, 'number', 'min="0" max="10" step="0.1"')}${fieldInput(t("editor.arrival_time"), 'ball.arriveAt', p.ball.arriveAt, 'number', 'min="0.1" max="15" step="0.1"')}</div></details><div class="inspector-divider"></div><label class="check-label"><input id="show-names" type="checkbox" ${viewSettings().showNames ? 'checked' : ''}>${t("editor.show_player_names")}</label><button class="button danger quiet full" data-action="delete-play">${icon('trash')}${t("editor.delete_play")}</button>`;
  }
  return `${content}${selection ? `<button class="back-details" data-action="clear-selection">${t("editorExtra.back_to_play_details")}</button>` : ''}<div class="inspector-note">${icon('check')}${localRecovery || shared?.sync?.viewError ? t("editor.editing_and_autosave_are_paused_until_recovery_complete") : cloudMode() ? (canEdit() ? t("editor.all_changes_sync_to_the_shared_playbook") : t("editor.you_have_read_only_access")) : t("editor.all_changes_are_saved_in_this_browser")}</div>`;
}
function renderField({preservePreview = false, syncDigital = true} = {}) {
  clearHistoryTransition();
  const field=$('#field');if(!field)return;
  field.querySelector('.assistant-highlights')?.remove();
  const preview = preservePreview ? assistantPreview : null;
  if (assistantPreview || assistantSettling) clearAssistantPreview({refresh:false, notify:!preview});
  const play=fieldPlay();
  const settings=viewSettings();
  const chrome=!play.reference&&settings.visualMode==='digital' ? digitalFieldChrome(settings.fieldTheme) : null;
  if(field.getAttribute('style')!==chrome){
    if(chrome)field.setAttribute('style',chrome);else field.removeAttribute('style');
  }
  const template=document.createElement('template');template.innerHTML=fieldSVG(play,settings,{selected:selection,time,drawing:draft});
  const svg=field.querySelector('.pitch-svg'),next=template.content.firstElementChild;
  // Preserve the SVG root and renderer readiness while replacing editable content
  // in one synchronous transaction. Canvas and vector pieces are stage siblings.
  for(const name of svg.getAttributeNames())if(name!=='class'&&!next.hasAttribute(name))svg.removeAttribute(name);
  for(const attr of next.attributes)if(attr.name!=='class')svg.setAttribute(attr.name,attr.value);
  const readyClasses=['digital-ready','digital-fallback-ready'].filter(name=>svg.classList.contains(name));
  svg.setAttribute('class',[next.getAttribute('class'),...readyClasses].join(' '));
  svg.replaceChildren(...next.childNodes);
  if (drag) drag.paintGeometry = null;
  updateAnimation(svg,play,time);
  syncFieldHitTargets(svg,{pointerType:window.matchMedia?.('(any-pointer: coarse)').matches?'touch':'mouse'});
  if (preview) showAssistantPreview(preview.play, preview.original, {reuse:preview, refresh:false});
  if (syncDigital) digitalBoard?.sync({contentChanged:true});
  const tag=field.querySelector('.field-tag');if(tag)tag.innerHTML=`${icon('ball')}<span>${t("editor.offense")} ${current().players.filter(p=>p.side==='offense').length} · ${t("editor.defense")} ${current().players.filter(p=>p.side==='defense').length}</span>`;
  renderedFieldState = fieldState();
}
function refreshInspector(animateContext = true) {
  const inspectorNode=$('.inspector'), context=inspectorNode.dataset.context, next=inspectorContext();
  if (context === next) patchEditorHTML(inspectorNode,inspector());
  else inspectorNode.innerHTML=inspector();
  inspectorNode.dataset.context=next;
  if(animateContext && context!==next)enterContext(inspectorNode);
}
function refreshSelection() {
  refreshInspector();
  renderField();updateCanvasHint();protectReadOnly();
}
function refreshMetadata() {
  const play=current(), heading=$('.play-header h1');
  heading.firstChild.textContent=`${play.title} `;document.title=`${play.title} · Playbook Studio`;
  // Metadata changes can also change whether this play matches the active
  // search/filter. Geometry-only edits do not need to revisit the entire list.
  if (renderedCardState !== cardState()) {refreshPlayList();renderedCardState=cardState();}
  thumbnails.refresh(play);
  $('.eyebrow').innerHTML=`<span class="league-badge">${getPlayLeague(play)===5?uxCopy('5v5 Flag','5 人腰旗'):uxCopy(`${getPlayLeague(play)} per side`,`${getPlayLeague(play)} 人制`)}</span> <span>·</span> ${e(play.personnel)} <span>·</span> ${e(play.category)}`;
  for(const action of ['undo','redo'])for(const node of document.querySelectorAll(`[data-action="${action}"]`)){
    node.disabled=!(action==='undo'?history.past:history.future).length;
    node.title=historyLabel(action);node.setAttribute('aria-label',historyLabel(action));
  }
  if (renderedFieldState !== fieldState()) renderField();
  const pilotMount = filmPilotVariant === 'events' && document.querySelector('[data-film-pilot-mount]');
  if (pilotMount) patchEditorHTML(pilotMount, pilot.filmPilotEventControls(play));
  syncEditorChrome();protectReadOnly();
  syncFilmRoom();
}
function refreshGestureCommit({restoringHistory = false} = {}) {
  const restoreScroll=captureEditorScroll({samePlay:true});
  refreshInspector(!restoringHistory);
  renderField({syncDigital:!restoringHistory});
  refreshMetadata();
  restoreScroll();
}
function coordinates(event) { return fieldCoordinates($('#field .pitch-svg'),event); }
function pick(event) {
  if(Number.isFinite(event.clientX) && Number.isFinite(event.clientY) && !event.target.closest('[data-point]')) { const spatial=digitalBoard?.pick(event); if(spatial)return spatial; }
  const node = event.target.closest('[data-player],[data-route],[data-zone],[data-annotation]');
  if (!node) return null;
  for (const type of ['player', 'route', 'zone', 'annotation']) if (node.dataset[type]) return { type, id: node.dataset[type] };
  return null;
}
const boundFields = new WeakSet();
function bindField() {
  const field = $('#field');
  if (boundFields.has(field)) return;
  boundFields.add(field);
  fieldHitObserver?.disconnect();
  const syncTargets=()=>syncFieldHitTargets(field.querySelector('.pitch-svg'),{pointerType:window.matchMedia?.('(any-pointer: coarse)').matches?'touch':'mouse'});
  if(typeof window.ResizeObserver==='function') {fieldHitObserver=new window.ResizeObserver(syncTargets);fieldHitObserver.observe(field.querySelector('.pitch-stage'));}
  syncTargets();
  field.addEventListener('pointerdown', event => {
    if(event.target.closest('.field-context'))return;
    // One contact owns an edit until it finishes. A second finger belongs to
    // browser navigation/zoom and must never replace the active edit baseline.
    if (!field.isConnected || event.button !== 0 || drag || (event.pointerType === 'touch' && !event.isPrimary)) return;
    clearAssistantPreview({immediate:true});
    if (rehearsal || playing || time) { toast(t("feedback.return_to_design_mode_to_adjust_players"), { type: 'info' }); return; }
    syncFieldHitTargets(field.querySelector('.pitch-svg'),{pointerType:event.pointerType});
    const at = coordinates(event);
    let hit = pick(event), point=event.target.closest('[data-point]');
    const confirmed=confirmedFieldTarget;confirmedFieldTarget=null;
    selectionCandidates=[];
    if(canEdit() && tool==='select' && ['touch','pen'].includes(event.pointerType)) {
      const keepGroup=hit?.type==='player' && selectedPlayerIds(current(),selection).includes(hit.id) && !multiSelectMode && !event.shiftKey;
      const candidates=keepGroup?[]:fieldHitCandidates(field.querySelector('.pitch-svg'),event);
      const confirmedSelection=confirmed?.type==='point'?selection?.type==='route'&&selection.id===confirmed.routeId:selection?.type==='player'&&selection.id===confirmed?.id;
      const resolved=confirmed?.scope===assistantScope() && confirmedSelection && !multiSelectMode && !event.shiftKey
        ? candidates.find(candidate=>candidate.type===confirmed.type && candidate.id===confirmed.id && (candidate.type!=='point'||candidate.index===confirmed.index)) : null;
      if(candidates.length>1 && !resolved) {
        event.preventDefault();selectionCandidates=candidates;candidateSelectionAdditive=multiSelectMode||event.shiftKey;selectionCandidateScope=assistantScope();updateCanvasHint();
        $('#field-context [data-action^="pick-candidate:"]')?.focus({preventScroll:true});return;
      }
      if(resolved || candidates.length===1) {
        const candidate=resolved||candidates[0];
        if(candidate.type==='player')hit={type:'player',id:candidate.id};
        else {point=candidate.element;hit=null;}
      }
    }
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
    if(tool==='select' && hit?.type==='player' && (event.shiftKey || multiSelectMode)) {
      event.preventDefault();selection=togglePlayerSelection(current(),selection,hit.id,{additive:true});refreshSelection();return;
    }
    // Route handles are siblings of their route, so pick() correctly returns
    // no object for them. Resolve the handle before classifying empty turf.
    if (event.pointerType === 'touch' && tool === 'select' && !hit && !point) { selection=null;refreshSelection();return; }
    event.preventDefault();
    if (tool === 'zone' || point || hit) field.setPointerCapture?.(event.pointerId);
    const gesture = { field, base: current(), start: at, pointerId: event.pointerId, selectionBefore: selection };
    if (tool === 'zone') { drag = { ...gesture, type: 'new-zone', zoneId: uid() }; return; }
    if (point) { drag = { ...gesture, type: 'point', routeId: point.dataset.routeId, index: Number(point.dataset.point) }; return; }
    const group=selectedPlayerIds(current(),selection);
    if(hit?.type==='player' && group.length>1 && group.includes(hit.id)) {
      drag={...gesture,type:'players',ids:group,original:clone(current().players.find(player=>player.id===hit.id)),moved:false};
    } else {
      selection = hit;
      if (hit) { drag = { ...gesture, ...hit, original: clone(selectedObject()), moved: false }; }
    }
    refreshSelection();
  });
  field.addEventListener('pointermove', event => {
    if (drag && (drag.field !== field || event.pointerId !== drag.pointerId) || event.pointerType === 'touch' && !event.isPrimary) return;
    if(draft && !drag) {previewPoint=coordinates(event); if(!gestureFrame)gestureFrame=requestAnimationFrame(()=>{gestureFrame=null;previewDraft(field.querySelector('svg'),draft,previewPoint);});return;}
    if (!drag || !canEdit()) return;
    pendingFieldPointer=event;
    if(!gestureFrame) {
      gestureFrame=requestAnimationFrame(flushGesture);
      digitalBoard?.deferPendingFrame();
    }
  });
  function flushGesture(stamp) {
    if(gestureFrame)cancelAnimationFrame(gestureFrame);gestureFrame=null;
    if(!drag || !pendingFieldPointer)return;
    const at=coordinates(pendingFieldPointer);
    pendingFieldPointer=null;
    if (drag.lastPoint?.x === at.x && drag.lastPoint.y === at.y) return;
    drag.lastPoint = at;
    if(Math.hypot(at.x-drag.start.x,at.y-drag.start.y)<.2 && !drag.moved)return;
    if (drag.type === 'route') return;
    const p=drag.preview ??= clone(drag.base);
    drag.moved=true;field.classList.add('is-dragging');
    if (drag.type === 'players' || drag.type === 'player') {
      drag.translate ??= preparePlayerTranslation(p, drag.ids ?? [drag.id]);
      drag.delta = drag.translate(at.x - drag.start.x, at.y - drag.start.y);
    } else if (drag.type === 'point') {
      drag.waypoint ??= prepareWaypointMove(p, drag.routeId, drag.index);
      drag.waypoint.move(at);
    }
    else if(drag.type==='new-zone') {
      let zone=p.zones.find(v=>v.id===drag.zoneId);
      if(!zone){zone={id:drag.zoneId,x:50,y:40,rx:1,ry:1,color:COLORS.zone,label:'ZONE'};p.zones.push(zone);selection={type:'zone',id:zone.id};renderField();}
      Object.assign(zone,{x:(drag.start.x+at.x)/2,y:(drag.start.y+at.y)/2,rx:Math.max(1,Math.abs(at.x-drag.start.x)/2),ry:Math.max(1,Math.abs(at.y-drag.start.y)/2)});
    } else if (drag.type === 'zone' || drag.type === 'annotation') {
      const objects = drag.type === 'zone' ? p.zones : p.annotations;
      const object = objects.find(item => item.id === drag.id);
      object.x = clamp(drag.original.x + at.x - drag.start.x);
      object.y = clamp(drag.original.y + at.y - drag.start.y);
    }
    drag.paintGeometry ??= bindGestureGeometry(field.querySelector('.pitch-svg'), p, drag);
    const fieldChanged = drag.paintGeometry();
    // Pointerup commits and presents the final geometry through renderField.
    if (stamp !== undefined) digitalBoard?.presentFrame(stamp, fieldChanged);
    const readout=field.querySelector('.drag-readout');readout.hidden=false;readout.textContent=`${drag.original?.label||t("editorExtra.adjust_position")} · X ${at.x.toFixed(1)} / Y ${at.y.toFixed(1)}`;
  }
  function releaseDrag() {
    const completed = drag;
    drag = null;
    if (gestureFrame) cancelAnimationFrame(gestureFrame);
    gestureFrame = null;
    pendingFieldPointer = null;
    field.classList.remove('is-dragging');
    field.querySelector('.drag-readout').hidden = true;
    // lostpointercapture may fire synchronously. Ownership has already ended.
    if (field.hasPointerCapture?.(completed.pointerId)) field.releasePointerCapture(completed.pointerId);
    return completed;
  }
  const cancelDrag = event => {
    if (event && (drag?.field !== field || event.pointerId !== drag.pointerId)) return;
    confirmedFieldTarget = null;
    if (drag?.field !== field) return;
    selection = releaseDrag().selectionBefore;
    digitalBoard?.finishGesture();
    // SVG coordinates were updated directly even if the selection never changed.
    refreshSelection();
  };
  const endDrag = event => {
    if (drag?.field !== field || event.pointerId !== drag.pointerId) return;
    if (!canEdit() || drag.base !== current()) { cancelDrag(event); return; }
    pendingFieldPointer = event;
    flushGesture();
    commitGesture(releaseDrag());
    // Pick the released pointer against the committed piece positions.
    digitalBoard?.finishGesture(event);
  };
  function commitGesture(completed) {
    if (!completed.moved) return;
    const preview = completed.preview;
    const samePosition = (a, b) => Math.abs(a.x-b.x) < 1e-9 && Math.abs(a.y-b.y) < 1e-9;
    if (completed.type !== 'new-zone' && samePosition(completed.start, completed.lastPoint)) {
      refreshSelection();
      return;
    }
    let command;
    if (completed.type === 'players') {
      const { x: dx, y: dy } = completed.delta;
      if (!dx && !dy) { refreshSelection(); return; }
      command = { kind: 'players_move', playerIds: completed.ids, dx, dy };
    } else if (completed.type === 'player') {
      const player = preview.players.find(item => item.id === completed.id);
      if (samePosition(player, completed.original)) { refreshSelection(); return; }
      command = { kind: 'player_update', playerId: player.id, patch: { x: player.x, y: player.y } };
    } else if (completed.type === 'point') {
      const route = preview.routes.find(item => item.id === completed.routeId);
      const original = completed.base.routes.find(item => item.id === completed.routeId);
      if (!original.blockTargets && samePosition(route.points[completed.index], original.points[completed.index])) { refreshSelection(); return; }
      command = { kind: 'route_update', routeId: route.id, patch: { points: route.points } };
    } else if (completed.type === 'new-zone') {
      const zone = preview.zones.find(item => item.id === completed.zoneId);
      command = { kind: 'zone_add', x: zone.x, y: zone.y, rx: zone.rx, ry: zone.ry, color: zone.color, label: zone.label };
    } else if (completed.type === 'zone') {
      const zone = preview.zones.find(item => item.id === completed.id);
      if (samePosition(zone, completed.original)) { refreshSelection(); return; }
      command = { kind: 'zone_update', zoneId: zone.id, patch: { x: zone.x, y: zone.y } };
    } else if (completed.type === 'annotation') {
      const annotation = preview.annotations.find(item => item.id === completed.id);
      if (samePosition(annotation, completed.original)) { refreshSelection(); return; }
      command = { kind: 'annotation_update', annotationId: annotation.id, patch: { x: annotation.x, y: annotation.y } };
    } else return;

    const next = clone(current());
    try {
      runEditorPlayCommand(next, command, { idFactory: () => completed.zoneId, roster: state.data.roster, formations: state.data.formations, depthChart: state.data.depthChart });
      validatePlay(next);
    } catch (error) {
      selection = completed.selectionBefore;
      refreshSelection();
      toast(error.message, { type: 'warning' });
      return;
    }
    const name = completed.type === 'players'
      ? uxCopy(`Move ${completed.ids.length} players`, `移动 ${completed.ids.length} 名球员`)
      : uxCopy('Move object', '移动对象');
    history.record(state, { name, source: 'manual' });
    Object.assign(current(), next);
    save();
    refreshGestureCommit();
  }
  cancelFieldGesture = cancelDrag;
  field.addEventListener('pointerup',endDrag);
  field.addEventListener('pointercancel',cancelDrag);
  field.addEventListener('lostpointercapture',cancelDrag);
  field.addEventListener('pointerleave',()=>{if(!drag)previewDraft(field.querySelector('svg'),draft,null);});
  field.addEventListener('dblclick', event => { if (draft) { event.preventDefault(); finishRoute(); } });
  function contextMenu(event) {
    if(draft || drag || rehearsal || playing || time)return;
    const hit=pick(event);if(!hit)return;
    event.preventDefault();selectionCandidates=[];
    if(!(hit.type==='player' && selectedPlayerIds(current(),selection).includes(hit.id)))selection=hit;
    refreshSelection();$('#field-context button')?.focus({preventScroll:true});
  }
  field.addEventListener('contextmenu',contextMenu);
  field.addEventListener('keydown', event => {
    if(event.isComposing || event.keyCode===229)return;
    if(selectionCandidates.length && event.key==='Escape'){event.preventDefault();event.stopPropagation();selectionCandidates=[];updateCanvasHint();field.querySelector('.pitch-svg')?.focus({preventScroll:true});return;}
    if(event.key==='ContextMenu' || event.shiftKey&&event.key==='F10'){contextMenu(event);event.stopPropagation();return;}
    if(selection?.type==='players' && !multiSelectMode && canEdit() && !rehearsal && !event.target.closest('button') && ['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key)) {
      event.preventDefault();event.stopPropagation();nudgeSelection(({ArrowLeft:'left',ArrowRight:'right',ArrowUp:'up',ArrowDown:'down'})[event.key],event.shiftKey?5:1);return;
    }
    if (!['Enter', ' '].includes(event.key) || !event.target.dataset.player && !event.target.dataset.route && !event.target.dataset.zone && !event.target.dataset.annotation) return;
    event.preventDefault(); event.stopPropagation();
    const hit=pick(event);
    selection = hit?.type==='player'?togglePlayerSelection(current(),selection,hit.id,{additive:event.shiftKey||multiSelectMode}):hit;
    selectionCandidates=[];refreshSelection();
  });
}
function finishRoute() {
  if (!draft || draft.points.length < 2) { toast(t("editorExtra.click_at_least_one_route_endpoint"), { type: 'warning' }); return; }
  if (current().routes.length >= 100) { toast(t("editorExtra.each_play_can_have_at_most_100_routes"), { type: 'warning' }); return; }
  const hasMain = competingMainRoutes(current(), {playerId:draft.playerId, kind:tool}).length > 0;
  const route = { id: uid(), playerId: draft.playerId, points: clone(draft.points), kind: tool, color: tool === 'pass' ? COLORS.pass : current().players.find(p => p.id === draft.playerId).color, smooth: false, endCap: tool === 'block' ? 'bar' : 'arrow', delay: 0, duration: tool === 'block' ? 2 : 4, optional: hasMain && draft.mode==='optional' };
  selection={type:'route',id:route.id};tool='select';
  const {id:routeId,kind:routeKind,...properties}=route;
  applyPlayCommand({kind:'route_add',routeKind,...properties},{idFactory:()=>routeId});
  burstAt(document.querySelector('#field-context'));
  toast(hasMain&&!route.optional?t("editorExtra.new_route_set_as_main_the_old_route_remains_o"):route.optional?t("editorExtra.optional_route_saved_rehearsal_continues_to_u"):t("editorExtra.route_saved_drag_points_to_adjust_it_undo_ava"),{type:'success',undo:true});
}

function openModal(title, body, footer = '', wide = false) {
  clearHistoryTransition();
  if (drag) cancelFieldGesture();
  const root = $('#modal-root');
  // Replacing a recovery/confirmation step keeps the original opener rather
  // than retaining a disconnected button from the previous dialog.
  const previous = root.contains(document.activeElement) ? root._previous : document.activeElement;
  for (const [node, inert] of root._inert || []) node.inert = inert;
  root._inert = null;
  root.innerHTML = `<dialog class="editor-dialog modal-backdrop" aria-label="${e(title)}"><section class="modal ${wide ? 'wide' : ''}"><header><h2>${e(title)}</h2>${btn('close-modal', 'close', t("editorExtra.close"), 'icon-button')}</header><div class="modal-body">${body}${feedbackBox()}<div class="import-notice" data-import-notice="dialog" aria-live="polite">${importNotice("dialog")}</div></div>${footer ? `<footer>${footer}</footer>` : ''}</section></dialog>`;
  root._previous = previous;
  const dialog = root.querySelector('dialog');
  const native = typeof dialog.showModal === 'function';
  dialog.dataset.nativeModal = String(native);
  dialog.addEventListener('cancel', event => {
    event.preventDefault();
    if (root.querySelector('dialog') !== dialog) return;
    pendingNavigation = null; closeModal();
  });
  dialog.addEventListener('close', () => {
    // A queued close event from an old step must never close its replacement.
    if (root.querySelector('dialog') === dialog) closeModal();
  });
  const initial = root.querySelector('.modal-body input:not([readonly]):not(:disabled),.modal-body select:not(:disabled),.modal-body textarea:not(:disabled)') || root.querySelector('footer .primary:not(:disabled),header button');
  initial?.setAttribute('autofocus', '');
  document.body.classList.add('modal-open');
  if (native) dialog.showModal();
  else {
    dialog.setAttribute('open', ''); dialog.setAttribute('role', 'dialog'); dialog.setAttribute('aria-modal', 'true');
    root._inert = [...document.body.children].filter(node => node !== root).map(node => [node, node.inert]);
    for (const [node] of root._inert) node.inert = true;
  }
  initial?.focus({ preventScroll: true });
  return dialog;
}
function closeModal() {
  const root = $('#modal-root'), dialog = root.querySelector('dialog'), previous = root._previous;
  root._previous = null;
  // Detach first: close events may be synchronous in DOM implementations.
  dialog?.remove();
  if (dialog?.open && typeof dialog.close === 'function') dialog.close();
  root.replaceChildren();
  for (const [node, inert] of root._inert || []) node.inert = inert;
  root._inert = null;
  document.body.classList.remove('modal-open'); $('#print-root').innerHTML = '';
  const focusTarget = previous?.isConnected && !previous.closest('[hidden],[inert]') ? previous : $('#app:not([hidden]) #main-content');
  focusTarget?.focus?.({ preventScroll: true });
  document.dispatchEvent(new window.Event('playbook:modal-closed'));
}
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
function refreshRecoveredWorkspace() {
  closeModal();
  if (!$('#app').hidden) render();
  rosterView.refresh();
}
function retryLocalLoad() {
  if (!localRecovery) return;
  const loaded = readLocalWorkspace();
  if (loaded.recovery) {
    localRecovery = { ...loaded.recovery, raw: loaded.recovery.raw ?? localRecovery.raw };
    localRecoveryModal(); feedback(`${t("editorExtra.still_unable_to_read")}${localRecovery.error.message}`, 'error', $('.modal')); return;
  }
  cancelFieldGesture(); resetAnimation(); selection = null; draft = null;
  state = { data: loaded.workspace, selectedId: loaded.workspace.plays[0].id }; book = current().book; query = ''; filter = ''; formationFilter = '';
  history.past = []; history.future = []; localRecovery = null; localSaveStatus = { kind: 'saved', label: t('editorExtra.local_data_loaded') };
  refreshRecoveredWorkspace(); toast(t("editorExtra.local_data_recovered_you_can_continue_editing"), { type: 'success' });
}
const leagueLabel = count => t(count === 5 ? 'editor.flag5' : 'editor.players_format', { count });
const formationLabel = name => ({
  'Flag 5 Spread': t('editor.flag5_spread'), 'Flag 5 Trips': t('editor.flag5_trips'),
  'Flag 5 Bunch': t('editor.flag5_bunch'), 'Flag 5 Zone': t('editor.flag5_zone'), 'Flag 5 Man': t('editor.flag5_man'),
})[name] || name;
function formationChoices(unit, count, selected, inspector = false) {
  const builtins = formationOptions(unit, count);
  const saved = state.data.formations.filter(formation => formation.book === unit && getPlayLeague(formation) === count);
  return builtins.map(name => option((inspector ? 'builtin:' : '') + name, formationLabel(name), selected)).join('') +
    saved.map(formation => option('custom:' + formation.id, formation.name + ' · ' + t('editor.custom_formation'), selected)).join('');
}
function refreshNewFormation() {
  const unit = $('#new-book').value, count = Number($('#new-count').value), select = $('#new-formation');
  const previous = select.value;
  select.innerHTML = formationChoices(unit, count, previous);
  if (![...select.options].some(option => option.value === previous)) select.value = defaultFormation(unit, count);
  const note = $('#new-format-note');
  note.hidden = count !== 5;
  note.textContent = t('editor.flag5_hint');
}
function newModal() {
  const count = state.data.settings.league;
  openModal(t('modal.new_play'), `<p class="muted">${t('modal.choose_a_formation_and_draw_your_ideas_on_the_fiel')}</p>
    <label class="form-field"><span>${t('modal.play_name')}</span><input id="new-title" value="${t('modal.new_play')}" maxlength="120"></label>
    <div class="form-row"><label class="form-field"><span>${t('modal.playbook')}</span><select id="new-book">${Object.entries(BOOKS).map(([value]) => option(value, t(value === 'offense' ? 'editor.offense' : value === 'defense' ? 'editor.defense' : 'editor.special_teams'), book)).join('')}</select></label>
    <label class="form-field"><span>${t('modal.players_per_side')}</span><select id="new-count">${LEAGUE_SIZES.map(value => option(String(value), leagueLabel(value), String(count))).join('')}</select></label></div>
    <label class="form-field"><span>${t('modal.formation')}</span><select id="new-formation">${formationChoices(book, count, defaultFormation(book, count))}</select></label>
    <p class="muted small" id="new-format-note" ${count === 5 ? '' : 'hidden'}>${t('editor.flag5_hint')}</p>`,
    `<button class="button subtle" data-action="close-modal">${t('modal.cancel')}</button><button class="button primary" data-action="create-play">${t('modal.create_play')}</button>`);
}
function textModal(at) { openModal(t("modal.add_annotation"), `<label class="form-field"><span>${t("modal.annotation")}</span><input id="annotation-text" placeholder="${t("modal.example_read_1_shallow_cross")}" maxlength="200"></label>`, `<button class="button primary" data-action="create-text" data-x="${at.x}" data-y="${at.y}">${t("modal.place_annotation")}</button>`); }
function exportModal() {
  if (localRecovery) { localRecoveryModal(); return; }
  const pngDescription=pngExportDescription({reference:!!current().reference,digital:document.documentElement.dataset.visualMode==='digital',ready:document.documentElement.dataset.digitalBoard==='ready'});
  openModal(t("modal.export_and_backup"), `<div class="export-grid"><button data-action="download-svg">${icon('route')}<strong>${current().reference ? t("modal.original_diagram") : t("modal.vector_play_diagram")}</strong><small>${current().reference ? t("modal.svg_embeds_source_image") : t("modal.svg_flat_vector_for_presentations")}</small></button><button data-action="download-png">${icon('export')}<strong>${t("modal.high_resolution_image")}</strong><small>PNG · ${pngDescription}</small></button><button data-action="download-json">${icon('book')}<strong>${t("modal.full_playbook")}</strong><small>JSON · ${state.data.plays.length}${t("editorExtra.plays_formations_and_roster")}</small></button><button data-action="download-play">${icon('copy')}<strong>${t("modal.current_play")}</strong><small>${t("modal.json_import_to_continue_editing")}</small></button></div><p class="muted small">${cloudMode() ? t("editorExtra.team_members_automatically_read_the_same_clou") : t("editorExtra.local_preview_saves_only_in_this_browser_use_")}</p>`);
}
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
async function standaloneSVG(play, png = false) {
  presentTimelineSeek();
  if (assistantPreview || assistantSettling) clearAssistantPreview();
  if (historyTransition) clearHistoryTransition();
  const settings = viewSettings();
  if (!png) settings.visualMode = 'traditional';
  const view = { settings, time, rehearsal, selected: selection, animated: document.documentElement.dataset.effects !== 'off' };
  if (png && !play.reference) {
    let capture = null;
    const board = digitalBoard;
    if (settings.visualMode === 'digital' && board) {
      // A live clock can move on while a texture decodes. For a paused board,
      // give the existing scene a chance to finish before using its flat frame.
      if (!playing && board.backgroundReady === false) {
        const deadline = Date.now() + 1000;
        while (board === digitalBoard && board.backgroundReady === false && time === view.time && Date.now() < deadline) {
          await new Promise(resolve => setTimeout(resolve, 16));
        }
      }
      if (board === digitalBoard && time === view.time && JSON.stringify(fieldPlay()) === JSON.stringify(play) && JSON.stringify(viewSettings()) === JSON.stringify(settings)) {
        capture = board.capture();
      }
    }
    return pngFrameSVG(document, play, view, capture);
  }
  let svg = fieldSVG(play, settings, { prefix: 'export' });
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
  clearHistoryTransition();
  if (drag) cancelFieldGesture();
  clearAssistantPreview();
  if (current().reference) { toast(t("feedback.the_original_diagram_has_no_playable_route_data"), { type: 'info' }); return; }
  if(draft && !confirmDraft(togglePlay))return;
  cancelTimelineSeek();
  if(playing){pausePlayback();return;}
  if(document.hidden)return;
  time=playbackClock.start(time,{duration:animationLength(current()),speed,loop});
  rehearsal=true;playing=true;draft=null;previewPoint=null;markFirstTask('rehearsed');
  renderField();syncEditorChrome();
}

function commitSelectionChange(operation, name, {clear=false}={}) {
  if(!canEdit())return false;
  const next=clone(current()),result=runEditorPlayCommand(next,operation);
  if(!result || result.changed===false)return false;
  validatePlay(next);
  history.record(state,{name,source:'manual'});
  Object.assign(current(),next);
  if(clear){selection=null;multiSelectMode=false;selectionCandidates=[];}
  save();render();return true;
}
function nudgeSelection(direction, amount=1) {
  if(!canEdit() || draft || drag || rehearsal)return;
  const delta=({left:[-amount,0],right:[amount,0],up:[0,-amount],down:[0,amount]})[direction];
  if(!delta)return;
  const ids=selectedPlayerIds(current(),selection);
  try {commitSelectionChange({kind:'players_move',playerIds:ids,dx:delta[0],dy:delta[1]},getLocale()==='en'?`Move ${ids.length} players`:`移动 ${ids.length} 名球员`);}
  catch(error){toast(error.message,{type:'warning'});}
}
function deleteSelected() {
  if(!canEdit())return;
  cancelFieldGesture();
  if(selection?.type==='players') {
    const ids=selectedPlayerIds(current(),selection);
    try {
      const name=getLocale()==='en'?`Delete ${ids.length} players`:`删除 ${ids.length} 名球员`;
      if(commitSelectionChange({kind:'players_remove',playerIds:ids},name,{clear:true}))toast(getLocale()==='en'?`${name}. Undo is available.`:`已${name}，可撤销恢复。`,{type:'success'});
    }catch(error){toast(error.message,{type:'warning'});}
    return;
  }
  if (!selection || !selectedObject()) return;
  const selected = selection;
  const result = applyPlayCommand({kind:'object_remove',objectType:selected.type,objectId:selected.id});
  if (result) { selection=null;refreshSelection();toast(t("modal.object_deleted_undo_to_restore_it"), {type:'success'}); }
}

const actions = {
  'coach-film': enterFilmRoom,
  'multi-select':()=>{
    if(draft && !confirmDraft(()=>actions['multi-select']()))return;
    resetAnimation();rehearsal=false;tool='select';draft=null;selectionCandidates=[];multiSelectMode=!multiSelectMode;
    if(selection && !['player','players'].includes(selection.type))selection=null;
    refreshSelection();syncEditorChrome();
  },
  'dismiss-candidates':()=>{confirmedFieldTarget=null;selectionCandidates=[];updateCanvasHint();$('#field .pitch-svg')?.focus({preventScroll:true});},
  'apply-personnel': () => {
    const { group, changes } = chosenPersonnel();
    if (!changes.length) return;
    if(!applyPlayCommand({kind:'personnel_apply',groupId:group.id}))return;
    const assigned=changes.filter(({player})=>player).length,cleared=changes.length-assigned;
    toast(t(cleared?'editor.chart_applied_changes':'editor.chart_applied', { count: assigned,assigned,cleared, name: group.name }), { type: 'success',undo:true });
  },
  'local-recovery': localRecoveryModal,
  'download-original': downloadOriginal,
  'retry-local-load': retryLocalLoad,
  'replace-local-workspace': () => {
    if (!localRecovery) return;
    openModal(t("editorExtra.replace_unreadable_local_data"), `<p>${t("editorExtra.confirming_replaces_the_original_local_data_w")}</p><p><strong>${t("editorExtra.original_data_that_has_not_been_downloaded_wi")}</strong>${t("editorExtra.return_to_recovery_options_and_download_the_o")}</p>`, `<button class="button subtle" data-action="local-recovery">${t("editorExtra.keep_original")}</button><button class="button danger" data-action="confirm-replace-local-workspace">${t("editorExtra.replace_and_start_editing")}</button>`);
  },
  'confirm-replace-local-workspace': () => {
    if (!localRecovery || !save({ replaceUnreadable: true })) return;
    localRecovery = null; history.past = []; history.future = []; refreshRecoveredWorkspace();
    toast(t("editorExtra.a_new_local_playbook_was_created_from_the_exa"), { type: 'success' });
  },
  'convert-reference': async () => {
    const outcome = await convertReference();
    if (outcome?.ok) toast(t("feedback.editable_copy_created_the_original_is_retained_undo_is_"), { type: 'success',undo:true });
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
    applyPlayCommand({kind:'line_space'});
    toast(t("feedback.line_and_nearby_player_spacing_adjusted_undo_is_availab"), { type: 'success',undo:true });
  },
  'madden-library': () => { resetAnimation(); if (confirmDraft(() => {panels.close({focus:false});maddenLibrary.open();})) {panels.close({focus:false});maddenLibrary.open();} },
  'clear-filters': () => { query=''; filter=''; formationFilter=''; render(); },
  'keep-drawing': () => { pendingNavigation=null; closeModal(); },
  'discard-draft': () => { draft=null; const next=pendingNavigation; pendingNavigation=null; closeModal(); next?.(); },
  new: newModal, 'close-modal': closeModal, export: exportModal, help: helpModal, print: printModal,
  sidebar: () => panels.toggle('plays'),
  'inspector-panel': () => {boardAssistant?.close();panels.toggle('properties');},
  'properties-task': () => {boardAssistant?.close();if($('.inspector'))$('.inspector').hidden=false;},
  'assistant-task': () => boardAssistant?.open(),
  'close-panel': () => panels.close(),
  'panel-field': () => { panels.close({focus:false});$('#field')?.scrollIntoView?.({block:'nearest'}); },
  'dismiss-toast': () => $('#toast').classList.remove('visible'),
  'undo-point': () => {if(draft?.points.length>1){draft.points.pop();previewPoint=null;renderField();updateCanvasHint();}},
  'edit-mode': () => {if(!confirmDraft(()=>actions['edit-mode']()))return;resetAnimation();rehearsal=false;renderField();syncEditorChrome();},
  'rehearse-mode': () => {if(!confirmDraft(()=>actions['rehearse-mode']()))return;clearAssistantPreview();rehearsal=true;draft=null;renderField();syncEditorChrome();},
  favorite: () => applyPlayCommand({kind:'play_update',patch:{favorite:!current().favorite}}),
  undo: () => restoreHistory('undo'), redo: () => restoreHistory('redo'),
  'undo-transaction': node => { if(node.dataset.transactionId===history.info()?.id)restoreHistory('undo');else toast(uxCopy('A later edit exists. Use the main Undo control to review it.','之后已有新修改，请使用主撤销按钮确认撤销范围。'),{type:'info'}); },
  'retry-save': () => {if(cloudMode())shared?.sync?.flush();else if(save())toast(t('editor.saved_locally'),{type:'success'});},
  mirror: () => { applyPlayCommand({kind:'play_mirror'}); toast(t("modal.players_routes_zones_and_annotations_mirrored"), { type: 'success',undo:true }); },
  duplicate: () => applyWorkspaceActions([{kind:'play_duplicate',playId:current().id,title:`${current().title} · 副本`.slice(0,120)}]),
  'clear-selection': () => {if(!confirmDraft(()=>actions['clear-selection']()))return; selection=null;draft=null;tool='select';multiSelectMode=false;selectionCandidates=[];refreshSelection();syncEditorChrome();},
  grid: () => executeEditorLocal([{kind:'view_set',grid:viewSettings().showGrid===false}]),
  theme: () => executeEditorLocal([{kind:'view_set',theme:viewSettings().fieldTheme==='light'?'dark':'light'}]),
  'finish-route': finishRoute, 'cancel-draft': () => { draft=null;previewPoint=null;tool='select';renderField();syncEditorChrome(); },
  'delete-selection': deleteSelected,
  'create-play': () => {
    if (state.data.plays.length >= 500) { toast(t("modal.the_playbook_can_contain_at_most_500_plays"), { type: 'warning' }); return; }
    const title = $('#new-title').value.trim(), b = $('#new-book').value, form = $('#new-formation').value, count = Number($('#new-count').value);
    if (!title) { feedback(t("modal.enter_a_play_name_before_creating_it")); $('#new-title').focus(); return; }
    closeModal(); applyWorkspaceActions([{kind:'play_create',title,book:b,formation:form,count}]);
  },
  'create-text': node => { const value = $('#annotation-text').value.trim(); if (!value) { toast(t("modal.enter_annotation_text"), { type: 'warning' }); return; } closeModal(); const result=applyPlayCommand({kind:'annotation_add',text:value,x:Number(node.dataset.x),y:Number(node.dataset.y)}); if(result){selection={type:'annotation',id:result.createdId};tool='select';refreshSelection();} },
  'save-formation': () => openModal(t("modal.save_custom_formation"), `<p class="muted small">${t("modal.only_starting_positions_labels_and_colors_are_save")}</p><label class="form-field"><span>${t("modal.formation_name")}</span><input id="formation-name" value="${e(current().formation)} · 自定义" maxlength="100"></label>`, `<button class="button primary" data-action="confirm-formation">${t("modal.save_formation")}</button>`),
  'confirm-formation': () => { const name = $('#formation-name').value.trim(); if (!name) return; if (state.data.formations.length >= 100) { toast(t("editorExtra.at_most_100_custom_formations_can_be_saved"), { type: 'warning' }); return; } closeModal(); applyWorkspaceActions([{kind:'formation_save',name}]); toast(t("editorExtra.custom_formation_saved_and_available_for_new_"), { type: 'success' }); },
  'add-defense-43': confirmed => {
    if (current().players.filter(p => p.side !== 'defense').length + 11 > 40) { toast(t("editorExtra.adding_the_defense_would_exceed_40_player_mar"), { type: 'warning' }); return; }
    const defenders=new Set(current().players.filter(p=>p.side==='defense').map(p=>p.id)), routes=current().routes.filter(r=>defenders.has(r.playerId)).length;
    if(routes && confirmed!==true){
      actions['confirm-defense-43']=()=>{closeModal();actions['add-defense-43'](true);};
      openModal(t("editorExtra.reset_the_4_3_defense"),`<p>${t("editorExtra.reposition_defenders_as_4_linemen_3_linebacke")}<strong>${routes}${t("editorExtra.routes")}</strong>。</p><p class="muted">${t("editorExtra.offensive_players_and_routes_are_retained_you")}</p>`,`<button class="button subtle" data-action="close-modal">${t("editorExtra.keep_current_defense")}</button><button class="button primary" data-action="confirm-defense-43">${t("editorExtra.reset_defense_and_clear_routes")}</button>`);return;
    }
    const hadDefense = current().players.some(p => p.side === 'defense');
    const updated = withDefense43(current(), { reset: hadDefense });
    selection = null; tool = 'select';
    edit(p => Object.assign(p, updated));
    toast(`${hadDefense ? t("editorExtra.reset") : t("editorExtra.added")}${t("editorExtra.4_3_defense_4_linemen_3_linebackers_4_defensi")}`);
  },
  opponents: () => {
    const side = current().book === 'defense' ? 'offense' : 'defense', remove = current().players.some(v => v.side === side);
    if (remove && current().players.every(v => v.side === side)) { toast(t("editorExtra.the_formation_has_only_players_from_this_side"), { type: 'warning' }); return; }
    if (!remove && current().players.length + getPlayLeague(current()) > 40) { toast(t("editorExtra.adding_players_would_exceed_40_markers_remove"), { type: 'warning' }); return; }
    applyPlayCommand({kind:'opponents_set',enabled:!remove,count:getPlayLeague(current())});
  },
  'delete-play': () => { if (state.data.plays.length === 1) { toast(t("editorExtra.keep_at_least_one_play"), { type: 'warning' }); return; } openModal(t("modal.delete_this_play"), `<p>${t("editorExtra.delete")}${e(current().title)}${t("editorExtra.this_change_can_be_undone")}</p>`, `<button class="button subtle" data-action="close-modal">${t("modal.cancel")}</button><button class="button danger" data-action="confirm-delete">${t("modal.delete_play")}</button>`); },
  'confirm-delete': () => { const playId=current().id;closeModal();applyWorkspaceActions([{kind:'play_delete',playId}]); },
  import: () => $('#import-input').click(),
  'review-pending-import': () => {
    if (confirmDraft(reviewPendingImport)) reviewPendingImport();
  },
  'cancel-pending-import': node => {
    const dialog = node.closest('dialog');
    resetFileImport();
    (dialog?.querySelector('input:not(:disabled),textarea:not(:disabled),select:not(:disabled)') || dialog?.querySelector('button') || $('#main-content'))?.focus({ preventScroll: true });
  },
  'download-svg': async () => { const play = clone(current()); try { download(await standaloneSVG(play), `${safeName(play.title)}.svg`, 'image/svg+xml'); toast(t("feedback.svg_diagram_created"), { type: 'success' }); } catch { toast(t("feedback.could_not_load_the_source_diagram_try_again"), { type: 'error', action: 'download-svg', label: t("feedback.retry") }); } },
  'download-png': pngExport,
  'download-json': () => { if (localRecovery) { downloadOriginal(); return; } download(encodeWorkspace(state.data), `${safeName(state.data.team.name)}-playbook.json`, 'application/json');markFirstTask('exported'); toast(t("feedback.full_playbook_exported"), { type: 'success' }); },
  'download-play': () => { download(encodeWorkspace({ ...state.data, plays: [current()] }), `${safeName(current().title)}.json`, 'application/json'); toast(t("feedback.current_play_exported"), { type: 'success' }); },
  'do-print': () => { if (!$('#print-root').children.length) { toast(t("feedback.no_plays_to_print"), { type: 'warning' }); return; } window.print(); },
  play: togglePlay, reset: () => {resetAnimation();clearAssistantPreview();paintPlayback();syncPlayback();updateCanvasHint();}, loop: () => executeEditorLocal([{kind:'playback_set',loop:!loop}])
};

// Keep a partially typed property in its original input while the read-only room has focus.
document.addEventListener('pointerdown', event => {
  if (event.target.closest?.('[data-action="coach-film"]') && getFieldDraftLabel()) event.preventDefault();
});
document.addEventListener('click', event => {
  for(const menu of document.querySelectorAll('.add-object-menu[open],.account-menu[open]'))if(!menu.contains(event.target))menu.open=false;
  const node = event.target.closest('[data-action]'); if (!node || node.disabled) return;
  const [name, ...parts] = node.dataset.action.split(':'), value = parts.join(':');
  if (current().reference && ['mirror','rehearse-mode','add-player','add-defense-43','opponents','save-formation'].includes(name)) { toast(t("editorExtra.the_original_diagram_has_no_editable_player_c"), { type: 'info' }); return; }
  if(name==='dismiss-toast'){actions[name]();return;}
  if (!canEdit() && !readActions.has(name) && !(name === 'tool' && value === 'select')) { toast(editBlockedMessage(), { type: 'warning' }); return; }
  if(node.closest('.add-object-menu'))node.closest('details').open=false;
  if (name === 'film-pilot-event') {
    if (filmPilotVariant !== 'events' || deviceIsTraditional()) return;
    const at = pilot.filmPilotEventTime(current(), value);
    if (at != null) seekTimeline({value:at}, true);
    return;
  }
  if (name === 'choose') return choose(value);
  if (['book','new','import','add-player','add-defense-43','opponents','mirror'].includes(name) && !confirmDraft(() => node.click())) return;
  if (name === 'book') { executeEditorLocal([{kind:'filter_set',book:value}]); return; }
  if (name === 'tool') { setTool(value); return; }
  if (name === 'select-route') { selection = { type: 'route', id: value }; tool = 'select'; draft = null; refreshSelection(); return; }
  if(name==='selection-nudge'){nudgeSelection(value);return;}
  if(name==='pick-candidate') {
    const candidate=selectionCandidates[Number(value)];
    if(!candidate || selectionCandidateScope!==assistantScope()){selectionCandidates=[];updateCanvasHint();return;}
    selection=candidate.type==='player'?togglePlayerSelection(current(),selection,candidate.id,{additive:candidateSelectionAdditive}):{type:'route',id:candidate.routeId};
    selectionCandidates=[];refreshSelection();
    confirmedFieldTarget={scope:assistantScope(),type:candidate.type,id:candidate.id,routeId:candidate.routeId,index:candidate.index};
    const target=candidate.type==='player'?[...document.querySelectorAll('#field [data-player]')].find(node=>node.dataset.player===candidate.id):[...document.querySelectorAll('#field .point-hit')].find(node=>node.dataset.routeId===candidate.routeId && Number(node.dataset.point)===candidate.index);
    (target?.matches('[tabindex]')?target:$('#field .pitch-svg'))?.focus({preventScroll:true});return;
  }
  if (name === 'add-player') { const result=applyPlayCommand({kind:'player_add',side:value,label:value==='offense'?'WR':'DB',x:25,y:value==='offense'?75:45}); if(result){selection={type:'player',id:result.createdId};refreshSelection();} return; }
  actions[name]?.(node);
});
function refreshPlayList() {
  const p = current(), plays = filtered();
  patchEditorHTML($('.play-list'),playCards(plays,p));
  $('.play-list-label b').textContent = plays.length;
  thumbnails.mount($('.play-list'), plays);
}
let composingSearch = false;
function isAutofilledInput(input) {
  try { return !!input?.matches?.(':-webkit-autofill'); } catch { return false; }
}
function isUnsolicitedSearchAutofill(input, event = null) {
  if (!input || input.id !== 'search') return false;
  if (isAutofilledInput(input) && document.activeElement !== input) return true;
  return !!(event?.isTrusted && !event.inputType && document.activeElement !== input && !query);
}
function clearUnsolicitedSearchAutofill() {
  const input = $('#search');
  if (!input || document.activeElement === input || query) return;
  if (input.value || isAutofilledInput(input)) input.value = '';
}
function searchInput(input) { query = input.value; refreshPlayList(); }
document.addEventListener('compositionstart', event => { if (event.target.id === 'search') composingSearch = true; });
document.addEventListener('compositionend', event => { if (event.target.id === 'search') { composingSearch = false; searchInput(event.target); } });
document.addEventListener('animationstart', event => {
  if (event.animationName === 'playbook-autofill-start' && event.target?.id === 'search' && document.activeElement !== event.target && !query) {
    event.target.value = '';
  }
});
window.addEventListener('pageshow', clearUnsolicitedSearchAutofill);
document.addEventListener('input', event => {
  const input = event.target;
  if (input.id === 'search' && !composingSearch && !event.isComposing) {
    if (isUnsolicitedSearchAutofill(input, event)) { input.value = query; return; }
    searchInput(input);
  }
  if(input.id==='timeline')seekTimeline(input);
});
document.addEventListener('pointerup', event => {
  if (event.target.id === 'timeline' && Number(event.target.value) !== time) seekTimeline(event.target, true);
  else presentTimelineSeek();
});
document.addEventListener('change', event => {
  const input = event.target;
  if (input === filmFieldDraft) return;
  if (input.id === 'timeline') { seekTimeline(input, true); return; }
  if (!canEdit() && (input.dataset.prop || input.dataset.ball || input.id === 'apply-formation')) return;
  if (input.id === 'new-count' || input.id === 'new-book') refreshNewFormation();
  else if (input.id === 'category-filter') { filter = input.value; refreshPlayList(); }
  else if (input.id === 'formation-filter') { formationFilter = input.value; refreshPlayList(); }
  else if (input.id === 'personnel-group') previewPersonnel();
  else if(input.id==='draft-mode' && draft)executeEditorLocal([{kind:'draft_action',action:'set_mode',mode:input.value}]);
  else if (input.id === 'speed') executeEditorLocal([{kind:'playback_set',speed:Number(input.value)}]);
  else if (input.id === 'show-names') executeEditorLocal([{kind:'view_set',names:input.checked}]);
  else if (input.id === 'print-scope' || input.id === 'print-layout') updatePrint();
  else if (input.id === 'apply-formation' && input.value) {
    const [kind, ...rest] = input.value.split(':'), value = rest.join(':');
    const custom = kind === 'custom' ? state.data.formations.find(f => f.id === value) : null;
    const command = custom ? {kind:'formation_apply',formationId:custom.id} : {kind:'formation_apply',formation:value,count:getPlayLeague(current())};
    const preview = clone(current());
    try { runEditorPlayCommand(preview, command, {roster:state.data.roster,formations:state.data.formations,depthChart:state.data.depthChart}); validatePlay(preview); }
    catch (error) { input.value = ''; toast(error.message, {type:'warning'}); return; }
    const removedCount = key => current()[key].filter(item => !preview[key].some(retained => retained.id === item.id)).length;
    const opponents = current().players.filter(player => player.side === (current().book === 'defense' ? 'offense' : 'defense'));
    const retainedOpponents = opponents.length && opponents.every(player => preview.players.some(retained => retained.id === player.id));
    const effects = t('editor.formation_replace_effect', {routes:removedCount('routes'),zones:removedCount('zones'),annotations:removedCount('annotations'),opponents:retainedOpponents ? t('editor.formation_opponents_retained') : ''});
    const apply = () => { closeModal(); if (applyPlayCommand(command)) toast(t('editorExtra.formation_replaced_and_routes_and_annotations'), {type:'success'}); };
    if (current().routes.length || current().zones.length || current().annotations.length) {
      actions['confirm-apply-formation'] = () => { delete actions['confirm-apply-formation']; apply(); };
      input.value = '';
      openModal(t("editorExtra.replace_the_starting_formation"), `<p>${t("editorExtra.replace_the_current_play_with")}<strong>${e(custom?.name || value)}</strong>。</p><p>${effects}</p>`, `<button class="button subtle" data-action="close-modal">${t("modal.cancel")}</button><button class="button primary" data-action="confirm-apply-formation">${t("editorExtra.replace_formation_and_clear_routes")}</button>`);
    } else apply();
  } else if (input.dataset.ball) {
    applyPlayCommand({kind:'ball_update',patch:{[input.dataset.ball]:input.value}},{redraw:false});
    const receiver=$('[data-ball="receiverId"]');
    if (receiver) receiver.disabled = !current().ball.holderId;
    if (receiver) receiver.innerHTML=`<option value="">${t("editorExtra.no_pass_run")}</option>${current().players.filter(v=>v.id!==current().ball.holderId).map(v=>option(v.id,`${v.label}${v.name?' · '+v.name:''}`,current().ball.receiverId)).join('')}`;
    const summary=$('.ball-section > summary small'); if(summary)summary.textContent=ballSummary(current());
  }
  else if (input.dataset.prop) {
    const key = input.dataset.prop;
    let value = input.type === 'checkbox' ? input.checked : input.type === 'number' ? Number(input.value) : input.value;
    if (input.type === 'number') { if (!Number.isFinite(value)) return; value = clamp(value,Number(input.min),Number(input.max)); }
    const previous = selectedObject() || current();
    let command;
    if (key.startsWith('ball.')) command={kind:'ball_update',patch:{[key.slice(5)]:value}};
    else if (!selection) command={kind:'play_update',patch:{[key]:value}};
    else if (selection.type==='player') command={kind:'player_update',playerId:selection.id,patch:{[key==='roster'?'rosterId':key]:value}};
    else if (selection.type==='route') command={kind:'route_update',routeId:selection.id,patch:{[key]:value}};
    else if (selection.type==='zone') command={kind:'zone_update',zoneId:selection.id,patch:{[key]:value}};
    else if (selection.type==='annotation') command={kind:'annotation_update',annotationId:selection.id,patch:{[key]:value}};
    if (!command || !applyPlayCommand(command,{redraw:false})) {
      if (input.type==='checkbox') input.checked=!!previous[key]; else input.value=previous[key]??'';
      return;
    }
    if (selection?.type==='route' && key==='kind') $('[data-prop="endCap"]').value=selectedObject().endCap;
    if (selection?.type==='player' && (key==='roster'||key==='name')) {
      const marker=selectedObject();
      $('[data-prop="roster"]').value=marker.rosterId||'';
      $('[data-prop="name"]').value=marker.name;
      $('.player-preview strong').textContent=marker.name||t('editor.unassigned');
    }
  }
});
function importNotice(surface) {
  if (!pendingFileImport) return '';
  const name = e(pendingFileImport.name);
  const message = surface === 'dialog' ? t('editorExtra.import_ready_in_dialog') : t('editorExtra.import_ready');
  const review = surface === 'editor' ? `<button type="button" class="button subtle" data-action="review-pending-import">${t('editorExtra.review_import')}</button>` : '';
  return `<span>${name} · ${message}</span>${review}<button type="button" class="button subtle" data-action="cancel-pending-import">${t('editorExtra.cancel_import')}</button>`;
}

function refreshImportNotices() {
  for (const region of document.querySelectorAll('[data-import-notice]')) {
    patchEditorHTML(region, importNotice(region.dataset.importNotice));
  }
}

function resetFileImport() {
  importReadSequence++;
  if ($('#modal-root dialog[data-file-import]')) closeModal();
  if (pendingFileImport) {
    pendingFileImport = null;
    refreshImportNotices();
  }
}

function validateAppendCapacity(imported) {
  if (state.data.plays.length + imported.plays.length > 500) throw new Error(t('editorExtra.the_playbook_cannot_exceed_500_plays'));
  if (state.data.formations.length + imported.formations.length > 100 || state.data.roster.length + imported.roster.length > 200) {
    throw new Error(t('editorExtra.import_would_exceed_the_formation_or_roster_l'));
  }
}

function reviewPendingImport() {
  const file = pendingFileImport;
  if (!file?.isCurrent() || $('.modal') || maddenLibrary.isOpen) return;
  const imported = file.data;
  const dialog = openModal(t('editorExtra.import_playbook_2'), `<p>${t('editorExtra.the_validated_file_contains')}<strong>${imported.plays.length}${t('editorExtra.plays_2')}</strong>、${imported.formations.length}${t('editorExtra.custom_formations_and')}${imported.roster.length}${t('editorExtra.roster_members')}</p><p class="muted small">${t('editorExtra.import_appends_plays_formations_and_roster_me')}</p>`, `<button class="button subtle" data-action="close-modal">${t('modal.cancel')}</button><button class="button primary" data-action="confirm-import">${t('editorExtra.append_import')}</button>`);
  dialog.dataset.fileImport = '';
  pendingFileImport = null;
  refreshImportNotices();

  // The dialog owns the file it previews. Closing or replacing the dialog
  // releases that file and a later confirmation can only use its own contents.
  dialog.querySelector('[data-action="confirm-import"]').addEventListener('click', () => {
    if (!dialog.isConnected || !file.isCurrent()) return;
    let batch;
    try {
      validateAppendCapacity(imported);
      batch = prepareWorkspaceAppend(state.data, imported);
      if (!batch) throw new Error(t('editor.chart_import_limit'));
    } catch (error) {
      feedback(error.message, 'error', dialog);
      return;
    }
    resetFileImport();
    selection = null;
    book = batch.plays[0].book;
    query = ''; filter = ''; formationFilter = '';
    edit((play, data) => {
      data.plays.push(...batch.plays);
      data.formations.push(...batch.formations);
      data.roster.push(...batch.roster);
      data.depthChart = batch.depthChart;
      state.selectedId = batch.plays[0].id;
    }, { name: t('editorExtra.import_playbook_2') });
    toast(`${t('editorExtra.imported')}${batch.plays.length}${t('editorExtra.plays_3')}`);
  });
}

document.addEventListener('change', event => {
  if (event.target !== editingField || event.target === filmFieldDraft) return;
  editingField = null;
  syncSaveStatus();
});
$('#import-input').addEventListener('change', async event => {
  const file = event.target.files[0];
  if (!file) return;
  event.target.value = '';
  resetFileImport();
  const requestId = importReadSequence, workspaceId = shared?.current?.id || 'local';
  const isCurrent = () => requestId === importReadSequence && workspaceId === (shared?.current?.id || 'local')
    && document.body.dataset.workspaceMode === 'editor' && canEdit();
  try {
    if (file.size > 5_000_000) throw new Error(t('editorExtra.import_a_file_under_5_mb'));
    const raw = await file.text();
    if (!isCurrent()) return;
    const data = decodeWorkspace(raw);
    validateAppendCapacity(data);
    pendingFileImport = { data, name: file.name || 'playbook.json', isCurrent };
    if (filmRoom || $('.modal') || maddenLibrary.isOpen || draft || drag || playing || document.activeElement?.matches('input:not([type="file"]),select,textarea,[contenteditable="true"]')) {
      refreshImportNotices();
    } else {
      reviewPendingImport();
    }
  } catch (error) {
    if (isCurrent()) toast(`${t('editorExtra.import_failed')}${error.message}`, { type: 'error' });
  }
});
document.addEventListener('keydown', event => {
  if(filmRoom?.isOpen() || event.defaultPrevented || event.isComposing || event.keyCode===229)return;
  const modal = $('.modal');
  if (modal) {
    const native = modal.closest('dialog')?.dataset.nativeModal === 'true';
    if (event.key === 'Escape' && !native) { event.preventDefault(); pendingNavigation=null; closeModal(); }
    if (event.key === 'Enter' && event.target.matches('input') && !event.target.closest('form')) { const primary=modal.querySelector('footer .button.primary:not(:disabled)'); if(primary){event.preventDefault();primary.click();} }
    if (event.key === 'Tab' && !native) { const inputs = [...modal.querySelectorAll('button,input,select,textarea,a[href]')].filter(n => !n.disabled && !n.closest('[hidden],[inert]')); const first = inputs[0], last = inputs.at(-1); if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); } }
    return;
  }
  if (maddenLibrary.isOpen) { if (event.key === 'Escape') maddenLibrary.close(); return; }
  if (drag && event.key==='Escape') { event.preventDefault(); cancelFieldGesture(); return; }
  if ($('#app').hidden || ['INPUT', 'TEXTAREA', 'SELECT'].includes(event.target.tagName) || event.target.isContentEditable || event.target.closest('.board-ai,.workspace-nav,.task-panel-tabs,button,summary,a[href],dialog[open]')) return;
  const key = event.key.toLowerCase();
  if ((event.ctrlKey || event.metaKey) && key === 'z') { event.preventDefault(); restoreHistory(event.shiftKey?'redo':'undo'); return; }
  if ((event.ctrlKey || event.metaKey) && key === 'y') { event.preventDefault(); restoreHistory('redo'); return; }
  if (event.key === ' ') { event.preventDefault(); togglePlay(); }
  else if (event.key === 'Enter' && draft) { event.preventDefault(); finishRoute(); }
  else if (event.key === 'Escape') { cancelFieldGesture(); draft = null; selection = null; tool = 'select'; multiSelectMode=false;selectionCandidates=[];render(); }
  else if (event.key==='Backspace' && draft) {event.preventDefault();actions['undo-point']();}
  else if (event.key === 'Delete' || event.key === 'Backspace') {event.preventDefault();if(!rehearsal)deleteSelected();}
  else if (key === '?') helpModal();
  else if (canEdit() && !event.ctrlKey && !event.metaKey && ({ v: 'select', r: 'route', b: 'block', m: 'motion', p: 'pass', z: 'zone', t: 'text' })[key]) {setTool(({v:'select',r:'route',b:'block',m:'motion',p:'pass',z:'zone',t:'text'})[key]);}
});
function showEditor(show) {
  const app = $('#app');
  if(!show) { closeFilmRoom(); if (!app.hidden) cancelFieldGesture(); }
  $('.skip-link').hidden = !show;
  if (app.hidden === !show) return;
  resetFileImport();
  app.hidden = !show;
  syncPageDecoration();
  if (show) {
    syncWorkspaceNavigation('editor');
    const remembered=editorSessions.get(shared?.current?.id||'local');
    if(remembered) {
      query=typeof remembered.query==='string'?remembered.query.slice(0,200):'';
      filter=typeof remembered.filter==='string'?remembered.filter.slice(0,60):'';
      formationFilter=typeof remembered.formationFilter==='string'?remembered.formationFilter.slice(0,100):'';
      if(state.data.plays.some(play=>play.id===remembered.selectedId)){state.selectedId=remembered.selectedId;book=current().book;}
    }
    digitalBoard = createDigitalBoard({
      isGestureActive: () => !!drag || !!filmRoom,
      getState: () => ({ play: fieldPlay(), settings: viewSettings(), selected: selection, time, playing, rehearsal, draggingId: drag?.type === 'player' && drag.moved ? drag.id : null, presentationMask:assistantPreview?.mask || historyTransition?.mask, presentationSettling:!!assistantSettling || !!historyTransition }),
      notify: message => toast(message, { type: 'warning' }),
    });
    render();
  } else {
    editorSessions.save(shared?.current?.id||'local',{selectedId:state.selectedId,query,filter,formationFilter});
    boardAssistant?.close({suspend:true});
    clearAssistantPreview();
    resetAnimation();
    if (maddenLibrary.isOpen) maddenLibrary.close();
    panels.close({ focus: false });
    thumbnails.destroy();
    digitalBoard?.destroy();
    digitalBoard = null;
    app.replaceChildren();
    renderedPlayId = null;
  }
}
const rosterView = createRosterView({
  root: $('#roster-root'),
  getData: () => state.data,
  getWorkspaceId: () => shared?.current?.id || 'demo',
  canEdit,
  commit(mutate) {
    if (!canEdit()) return false;
    const data = clone(state.data);
    mutate(data);
    const rosterIds = new Set(data.roster.map(player => player.id));
    const removedPlayers = state.data.roster.filter(player => !rosterIds.has(player.id));
    for (const player of removedPlayers) clearDepthPlayer(data.depthChart, player.id);
    refreshRosterBindings(data, state.data.roster);
    if (save({ data }) === false) return false;
    history.detachRemovedPlayers(removedPlayers);
    state.data = data;
    return true;
  },
});
async function editAnalysisSuggestion(payload) {
  const workspaceId=cloudMode()?shared?.current?.id:'demo';
  const revision=cloudMode()?shared?.current?.revision:localRevision;
  if(payload.workspaceId!==workspaceId||payload.revision!==revision)throw Error(uxCopy('This report uses an earlier playbook. Analyze the current version first.','此报告基于旧版战术本，请先对当前版本重新分析。'));
  const play=state.data.plays.find(item=>item.id===payload.offensePlayId);
  if(!play||!canEdit())throw Error(editBlockedMessage());
  await navigateWorkspace('editor');
  if($('#app').hidden)throw Error(uxCopy('Return to the editor before preparing a proposal.','请先返回编辑器再准备提案。'));
  choose(play.id);
  const latestWorkspace=cloudMode()?shared?.current?.id:'demo',latestRevision=cloudMode()?shared?.current?.revision:localRevision;
  if(current().id!==play.id||latestWorkspace!==payload.workspaceId||latestRevision!==payload.revision||!canEdit())throw Error(uxCopy('The target changed. Finish the current drawing and prepare the suggestion again.','目标已变化，请先完成当前绘图，再重新准备这条建议。'));
  boardAssistant?.compose?.(payload.instruction,{send:false});
  toast(uxCopy('Suggestion is ready in the assistant. Send it to preview changes.','建议已带入助手，发送后将生成可确认的编辑提案。'),{type:'info'});
  return {ok:true};
}
initViewportLayout();
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('./sw.js').catch(() => {});

if (cloudMode()) {
  document.body.classList.add('cloud-enabled');
  const matchupView = createMatchupView({ root: $('#ai-matchup-root'), request, getCurrent: () => shared?.current, getData: () => state.data, isDirty: () => !!shared?.dirty,onEditSuggestion:editAnalysisSuggestion });
  analysisView = matchupView;
  shared = new SharedWorkspace({
    onData(data,record) {
      const changedBook=loadedWorkspaceId!==record?.id;
      if (changedBook || !canEdit()) resetFileImport();
      const sameData=JSON.stringify(state.data)===JSON.stringify(data);
      loadedWorkspaceId=record?.id;
      if(changedBook){closeFilmRoom();history.clear();boardAssistant?.close({suspend:true});}
      cancelFieldGesture(); resetAnimation(); selection = null; draft = null;
      const selectedId = data.plays.some(p => p.id === state.selectedId) ? state.selectedId : data.plays[0].id;
      state = { data, selectedId }; book = current().book;
      if(changedBook){query='';filter='';formationFilter='';}
      if(!changedBook&&!sameData){history.clear();toast(uxCopy('Team changes loaded. Earlier diagram undo history was reset to protect the new version.','已载入团队更新；旧图的撤销记录已重置，以保护新版本。'),{type:'info'});}
      if (!$('#app').hidden) render();
    },
    getFieldDraftLabel,
    onStatus: syncSaveStatus,
    onBeforeAccessLoss() {
      if (getFieldDraftLabel()) editingField.dispatchEvent(new window.Event('change', { bubbles: true }));
    },
    onAnalysisData(data, record) { matchupView.onData(data, record); },
    onPermissionLost(error) { closeFilmRoom();clearModelCredential();boardAssistant?.close({clear:true}); cancelFieldGesture(); resetAnimation(); draft = null; rosterView.refresh(); toast(error.message || t("editorExtra.access_changed_sign_in_again_or_contact_an_ad"), { type: 'error' }); },
    onModeChange:syncWorkspaceNavigation,
    getHomeContext:homeContext,
    onLogout() {closeFilmRoom();clearModelCredential();boardAssistant?.close({clear:true});history.clear();syncWorkspaceNavigation('login');},
    showEditor,
    showRoster: visible => {rosterView.show(visible);if(visible)syncWorkspaceNavigation('roster');},
    canLeaveRoster: () => !rosterView.isEditing(),
    getRosterFormText: () => rosterView.captureFormText(),
    showAnalysis(show) { matchupView.show(show);if(show)syncWorkspaceNavigation('analysis'); },
    isBusy: () => rosterView.isEditing() || !!drag || !!draft || playing || !!$('.modal') || ['INPUT','TEXTAREA','SELECT'].includes(document.activeElement?.tagName),
    openModal, closeModal, toast, download
  });
  shared.init();
} else {
  demoAnalysisData = state.data;
  const demoRecord = { id: 'demo', revision: 0, title: getLocale() === 'en' ? 'Sample matchup' : '示例战术本' };
  const demoView = createMatchupView({ root: $('#ai-matchup-root'), request: createDemoRequest(() => state.data), getCurrent: () => ({...demoRecord,revision:localRevision}), getData: () => state.data, isDirty: () => false, demo: true,onEditSuggestion:editAnalysisSuggestion });
  analysisView = demoView;
  guestRouter=startGuestWorkspace({
    showEditor,
    getHomeContext:homeContext,
    showRoster: visible => {rosterView.show(visible);if(visible)syncWorkspaceNavigation('roster');},
    showAnalysis: visible => {if(visible){demoView.onData(state.data,{...demoRecord,revision:localRevision});syncWorkspaceNavigation('analysis');}demoView.show(visible);},
    canLeave: () => !rosterView.isEditing() && !$('.modal') && (!draft || window.confirm(t('modal.switching_will_discard_the_route_points_being_draw'))),
    onLeaveEditor() { draft = null; tool = 'select'; },
    onEnter(mode) {
      syncWorkspaceNavigation(mode);
      if (localRecovery && (mode === 'editor' || mode === 'roster')) localRecoveryModal();
    },
  });
}

initEffects();

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
  if (shared?.sync?.dirty || (!cloudMode() && localSaveStatus.kind === 'error') || localRecovery || drag) {
    alert(t('editor.language_unsaved')); localeSelect.value = getLocale(); return;
  }
  if ((draft || rosterView.isEditing() || document.querySelector('.modal') || document.querySelector('#ai-matchup-root:not([hidden])') || [...document.querySelectorAll('#cloud-root input')].some(input => input.value)) && !confirm(t('editor.language_discard_draft'))) { localeSelect.value = getLocale(); return; }
  try { setLocale(next); location.reload(); }
  catch { alert(t('editor.language_storage_error')); localeSelect.value = getLocale(); }
});

// Keep onboarding outside the editor's render tree: a tour must never become
// a play mutation, lose its controls on redraw, or open a hidden mobile drawer.
const tourCopy = onboardingLabels(getLocale());
const replayTour = document.createElement('button');
replayTour.type = 'button'; replayTour.className = 'onboarding-replay';
replayTour.dataset.onboarding = 'replay';
replayTour.textContent = tourCopy.replay; replayTour.title = tourCopy.replayTitle;
replayTour.setAttribute('aria-label', tourCopy.replayTitle);
localeControl.prepend(replayTour);
function onboardingContext() {
  let id = null;
  const shown = selector => { const node=$(selector); return !!node && !node.closest('[hidden]'); };
  if (shown('#app') && $('#app .workspace')) id = 'editor';
  else if (shown('#ai-matchup-root') && $('#ai-matchup-root .ai-page')) id = 'analysis';
  else if (shown('#roster-root') && $('#roster-root .roster-page')) id = 'roster';
  else if (shown('#cloud-root .studio-home')) id = 'home';
  else if (shown('#cloud-root .cloud-empty')) id = 'empty';
  if (replayTour.hidden !== !id) replayTour.hidden = !id;
  return id ? {id,locale:getLocale(),readOnly:!canEdit(),reference:id === 'editor' && !!current().reference} : null;
}
const onboarding = createOnboarding({document,getContext:onboardingContext,getSteps:context=>onboardingSteps(context,document),isBusy:()=>
  !!(draft || drag || playing || localRecovery || panels.active || rosterView.isEditing() ||
    document.querySelector('.modal,dialog[open],.madden-panel,.ba-panel:not([hidden]),.ba-compose textarea[readonly]')),
});
replayTour.addEventListener('click', async () => {
  if (!await onboarding.start({manual:true})) toast(tourCopy.busy,{type:'info'});
});
let onboardingActive = false, preOnboardingScroll = { pageTop: 0, sidebarTop: 0 };
function capturePreOnboardingScroll() {
  if (document.body.classList.contains('driver-active')) return;
  const page = document.scrollingElement || document.documentElement;
  preOnboardingScroll = { pageTop: page?.scrollTop || 0, sidebarTop: $('.sidebar')?.scrollTop || 0 };
}
function restorePreOnboardingScroll(saved) {
  const page = document.scrollingElement || document.documentElement;
  const sidebar = $('.sidebar');
  if (page) {
    if (typeof page.scrollTo === 'function') page.scrollTo({ left: 0, top: saved.pageTop, behavior: 'instant' });
    else page.scrollTop = saved.pageTop;
  }
  if (sidebar) {
    if (typeof sidebar.scrollTo === 'function') sidebar.scrollTo({ left: 0, top: saved.sidebarTop, behavior: 'instant' });
    else sidebar.scrollTop = saved.sidebarTop;
  }
}
const onboardingScrollObserver = typeof MutationObserver === 'function' ? new MutationObserver(() => {
  const active = document.body.classList.contains('driver-active');
  if (active === onboardingActive) return;
  onboardingActive = active;
  if (!active) {
    const saved = { ...preOnboardingScroll };
    restorePreOnboardingScroll(saved);
    window.requestAnimationFrame?.(() => {
      if (!document.body.classList.contains('driver-active')) restorePreOnboardingScroll(saved);
    });
  }
}) : null;
document.addEventListener('scroll', capturePreOnboardingScroll, { capture: true, passive: true });
onboardingScrollObserver?.observe(document.body, { attributes: true, attributeFilter: ['class'] });
onboarding.sync();
window.addEventListener('pagehide',()=>{ document.removeEventListener('scroll', capturePreOnboardingScroll, true); onboardingScrollObserver?.disconnect(); onboarding.stop(); });
