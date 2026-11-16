import { t, getLocale } from './i18n.js';
import { escapeHTML as e } from './model.js';
import { fieldSVG } from './field.js';
import { orientDefense, matchupInputKey } from './matchup-model.js';
import { parseKnowledgeText, retrieveKnowledge, validateKnowledgePack, safeSourceUrl } from './knowledge-base.js';
import { createKnowledgeStore, emptyKnowledgePack } from './knowledge-store.js';
import { knowledgePanelHTML, knowledgeCardHTML, localBriefHTML } from './knowledge-panel.js';
import { matchupKnowledgeQuery } from './analysis-evidence.js';
import { isFlag5Play } from './game-formats.js';
import { MODEL_PROVIDER_PRESETS, PROTOCOL_OPTIONS } from './model-protocol.js';
import { getModelConnection, setModelConnection, subscribeModelConnection } from './model-connection.js';

const ref = (side, type, id) => `${side}:${type}:${id}`;
export function resolveHandoffContext(plays, context = {}) {
  const instruction = typeof context.instruction === 'string' ? context.instruction : '';
  const defense = plays.filter(play => play.book === 'defense');
  const explicit = defense.find(play => play.id === context.defensePlayId);
  const normalized = instruction.normalize('NFKC').toLowerCase();
  const matches = defense.filter(play => play.title?.trim() && normalized.includes(play.title.normalize('NFKC').trim().toLowerCase()));
  return {...context, instruction, defensePlayId: explicit?.id || (matches.length === 1 ? matches[0].id : undefined)};
}
// Known server errors are localized; never rewrite user-authored context.
export function localizedAnalysisError(error) {
  const message = typeof error?.message === 'string' ? error.message : '';
  if (/^追问(?:与当前战术或报告版本不一致|的情景已不可用)/.test(message)) return t('analysis.followupStale');
  if (getLocale() === 'zh-CN' || !/[\u3400-\u9fff]/.test(message)) return message || t('extra.api.fallback');
  const key = 'extra.api.' + message;
  const translated = t(key);
  return translated === key ? t('extra.api.fallback') : translated;
}

const coverageLabels = () => ({ unknown: t('extra.unconfirmed'), cover3_spot: 'Cover 3 · ' + t('extra.zoneCoverage'), cover3_match: 'Cover 3 · Match', cover2: t('analysis.cover2Variant'), cover2_read: t('analysis.cover2Read'), man: t('extra.manCoverage') });
const toolLabels = () => ({ get_matchup_context: t('extra.readPlaysAndDiagramFacts'), inspect_player: t('extra.inspectPlayerPositionsAndRoutes'), inspect_route_coverage: t('extra.inspectRoutesAndDefensiveZones'), read_coverage_rule: t('extra.readCoverageRules'), search_knowledge: t('analysis.searchTool') });
const modelDefaults = Object.fromEntries(Object.entries(MODEL_PROVIDER_PRESETS).map(([provider,preset])=>[provider,preset.defaultModel]));
// Overlay colors communicate side and stay legible on the light field. They
// only affect this rendering; saved play and route colors are never changed.
const overlayColors = { offense: '#2b2f36', defense: '#c16f56' };
const option = (value, label, current) => `<option value="${e(value)}" ${value === current ? 'selected' : ''}>${e(label)}</option>`;

function modelConnectionFields(state, demo) {
  const preset = MODEL_PROVIDER_PRESETS[state.provider];
  const providers = Object.entries(MODEL_PROVIDER_PRESETS).map(([id,config])=>option(id,id === 'custom' ? t('extra.compatibleModelService') : config.label,state.provider)).join('');
  const protocols = preset.protocols.map(value=>option(value,PROTOCOL_OPTIONS[value],state.protocol)).join('');
  return `<label class="ai-field"><span>${t('extra.modelProvider')}</span><select data-ai-field="provider">${providers}</select></label>
    <label class="ai-field"><span>API ${t('extra.format')}</span><select data-ai-field="protocol">${protocols}</select></label>
    ${state.provider === 'custom' ? `<label class="ai-field"><span>API Base URL</span><input data-ai-field="baseUrl" type="url" maxlength="400" placeholder="https://api.example.com/v1" value="${e(state.baseUrl)}"><small>${t(demo ? 'extra.browserDirectServiceHint' : 'extra.cloudCompatibleServiceHint')}</small></label>` : ''}`;
}

export function composeMatchup(offense, defense, mirrorDefense = false) {
  defense = orientDefense(defense, mirrorDefense);
  const players = [], routes = [], zones = [];
  for (const [side, play] of [['offense', offense], ['defense', defense]]) {
    if (!play || play.reference) continue;
    const chosen = play.players.filter(p => p.side === side), ids = new Set(chosen.map(p => p.id));
    players.push(...chosen.map(p => ({ ...p, color: overlayColors[side], id: ref(side, 'player', p.id), name: '' })));
    routes.push(...play.routes.filter(r => ids.has(r.playerId)).map(r => ({ ...r, color: overlayColors[side], id: ref(side, 'route', r.id), playerId: ref(side, 'player', r.playerId) })));
    if (side === 'defense') zones.push(...play.zones.map(z => ({ ...z, id: ref(side, 'zone', z.id) })));
  }
  const holderId = offense?.ball?.holderId ? ref('offense', 'player', offense.ball.holderId) : '';
  return { title: '对局叠图', players, routes, zones, annotations: [], ball: { holderId, receiverId: '', passAt: 2, arriveAt: 3 } };
}

export function createMatchupView({ root, request, getCurrent, getData, isDirty, demo = false, onEditSuggestion }) {
  let active = false, result = null, activeScenario = 0, controller = null, generation = 0;
  const state = { offense: '', defense: '', perspective: '', coverage: 'unknown', mode: 'real_football', context: '', mirrorDefense: false, includeNotes: false, provider: 'deepseek', protocol: 'openai', model: modelDefaults.deepseek, apiKey: '', baseUrl: '', knowledgeQuery: '' };
  let reportSnapshot = null, followupQuestion = '', discussion = [], showingReportSnapshot = false, handingOff = false, runError = '', lastRunWasFollowup = false;
  const sessions = new Map();
  const connectionFields = ['provider','protocol','model','baseUrl','apiKey'];
  const knowledgeStore = createKnowledgeStore();
  let knowledgePack = emptyKnowledgePack(), knowledgeWorkspace = '', knowledgeError = '', knowledgeNotice = '', importGeneration = 0, importing = false;
  if (demo) { state.provider = 'openrouter'; state.model = 'openai/gpt-4o-mini'; }
  Object.assign(state, getModelConnection() || {});
  const unsubscribeConnection = subscribeModelConnection(connection => {
    if (!connection) return;
    const focused = root.ownerDocument.activeElement;
    const editing = focused?.dataset?.aiField;
    const changed = connectionFields.some(field => state[field] !== connection[field]);
    Object.assign(state, connection);
    if (changed && active) {
      clearResult(); render();
      if (editing) root.querySelector(`[data-ai-field="${editing}"]`)?.focus();
    }
  });
  let lastWorkspace = '', lastRevision = 0;
  const currentPlay = (book, id) => getData()?.plays.find(p => p.book === book && p.id === id);
  const plays = book => (getData()?.plays || []).filter(p => p.book === book);
  const selected = () => ({ offense: currentPlay('offense', state.offense), defense: currentPlay('defense', state.defense) });
  const analysisOptions = () => Object.fromEntries(['perspective','coverage','mode','context','mirrorDefense','includeNotes','knowledgeQuery'].map(key => [key,state[key]]));
  function inputKey() { return JSON.stringify({ revision:getCurrent()?.revision, input:matchupInputKey({ workspaceId:getCurrent()?.id, ...selected(), options:analysisOptions(), knowledge:knowledgePack }) }); }
  const staleReport = () => !!result && reportSnapshot?.key !== inputKey();
  const canPrepareSuggestion = () => demo || getCurrent()?.role !== 'viewer';
  function syncSession() {
    const id = getCurrent()?.id || '';
    if (lastWorkspace === id) return;
    if (lastWorkspace) sessions.set(lastWorkspace, { fields:Object.fromEntries(Object.entries(state).filter(([key]) => !connectionFields.includes(key))), result, reportSnapshot, activeScenario, followupQuestion, discussion });
    const saved = sessions.get(id);
    Object.assign(state, saved?.fields || { offense:'', defense:'', perspective:'', coverage:'unknown', mode:'real_football', context:'', mirrorDefense:false, includeNotes:false, knowledgeQuery:'' });
    result=saved?.result || null; reportSnapshot=saved?.reportSnapshot || null; activeScenario=saved?.activeScenario || 0;
    followupQuestion=saved?.followupQuestion || ''; discussion=saved?.discussion || []; showingReportSnapshot=false;runError='';
    lastWorkspace=id;
  }
  function syncKnowledge() {
    const workspace = getCurrent()?.id || '';
    if (workspace === knowledgeWorkspace) return;
    importGeneration++; importing = false; knowledgeWorkspace = workspace; knowledgeNotice = '';
    const loaded = knowledgeStore.load(workspace);
    knowledgePack = loaded.pack; knowledgeError = loaded.error ? t(loaded.error) : '';
  }
  function retrievedKnowledge() {
    const { offense, defense } = selected();
    const query = matchupKnowledgeQuery(offense || {}, defense || {}, { context: state.context, knowledgeQuery: state.knowledgeQuery });
    return retrieveKnowledge({ query, coverage: state.coverage, packs: knowledgePack.cards.length ? [knowledgePack] : [], limit: 6, locale: getLocale(), includeBuiltin: !isFlag5Play(offense) && !isFlag5Play(defense) });
  }
  function requestKnowledgePack() {
    const cards = retrievedKnowledge().filter(card => card.source?.kind === 'team').map(({ source, evidenceId, matchReasons, applicability, score, ...card }) => card);
    if (!cards.length) return undefined;
    const ids = new Set(cards.map(card => card.sourceId));
    return validateKnowledgePack({ format: 'playbook-studio-knowledge', version: 1, sources: knowledgePack.sources.filter(source => ids.has(source.id)), cards });
  }
  function refreshLocalSections() {
    if (!active) return;
    const focused = root.ownerDocument.activeElement;
    const restoreSearch = focused?.dataset?.aiField === 'knowledgeQuery';
    const selection = restoreSearch ? focused.selectionStart : 0;
    const section = root.querySelector('.ai-knowledge');
    if (section) section.innerHTML = knowledgePanelHTML({ cards: retrievedKnowledge(), pack: knowledgePack, query: state.knowledgeQuery, error: knowledgeError, notice: knowledgeNotice, importing });
    if (restoreSearch) { const search = root.querySelector('[data-ai-field="knowledgeQuery"]'); search?.focus(); try { search?.setSelectionRange(selection, selection); } catch { /* search inputs may not expose a selection */ } }
    const brief = root.querySelector('[data-local-brief]');
    if (brief) { const { offense, defense } = selected(); brief.innerHTML = localBriefHTML(offense, defense, state.coverage, coverageLabels()[state.coverage]); }
    const results = root.querySelector('#ai-results');
    if (results && result) { results.innerHTML=resultHTML(); paintEvidence(); }
  }
  async function importKnowledgeFile(file) {
    if (!file || !getCurrent()?.id) return;
    const workspaceId = getCurrent().id, token = ++importGeneration;
    clearResult(); importing = true; knowledgeError = ''; knowledgeNotice = ''; refreshLocalSections();
    try {
      if (file.size > 1_000_000) throw new Error(t('analysis.fileTooLarge'));
      if (!/\.(json|md|markdown|txt)$/i.test(file.name || '')) throw new Error(t('analysis.unsupportedFile'));
      const raw = await file.text();
      if (!active || token !== importGeneration || getCurrent()?.id !== workspaceId) return;
      const imported = parseKnowledgeText(raw, { name: file.name });
      const merged = knowledgeStore.merge(knowledgePack, imported);
      knowledgePack = knowledgeStore.save(workspaceId, merged);
      // Another analysis can start while the file is being read. Invalidate
      // that newer run only after persistence succeeds and knowledge changes.
      clearResult();
      knowledgeNotice = t('analysis.imported', { count: imported.cards.length });
    } catch (error) {
      if (!active || token !== importGeneration || getCurrent()?.id !== workspaceId) return;
      knowledgeError = error.message === 'analysis.storageError' ? t(error.message) : t('analysis.importError', { message: getLocale() === 'en' && /[\u3400-\u9fff]/.test(error.message) ? t('analysis.invalidPack') : error.message });
    } finally {
      if (token === importGeneration && getCurrent()?.id === workspaceId) { importing = false; refreshLocalSections(); }
    }
  }
  function deleteKnowledgeSource(sourceId) {
    importGeneration++; importing = false; clearResult(); knowledgeNotice = ''; knowledgeError = '';
    const next = { ...knowledgePack, sources: knowledgePack.sources.filter(source => source.id !== sourceId), cards: knowledgePack.cards.filter(card => card.sourceId !== sourceId) };
    try { knowledgePack = knowledgeStore.save(getCurrent().id, next); knowledgeNotice = t('analysis.deleted'); }
    catch { knowledgeError = t('analysis.storageError'); }
    refreshLocalSections();
  }
  function exportKnowledge() {
    if (!knowledgePack.cards.length) return;
    const file = new Blob([JSON.stringify(knowledgePack, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(file), link = root.ownerDocument.createElement('a');
    link.href = url; link.download = 'playbook-knowledge.json'; link.click(); URL.revokeObjectURL(url);
  }
  function syncSelection() {
    const off = plays('offense'), def = plays('defense');
    if (!off.some(p => p.id === state.offense)) state.offense = off[0]?.id || '';
    if (!def.some(p => p.id === state.defense)) state.defense = def[0]?.id || '';
    const p = selected(), choices = [...(p.offense?.players || []).filter(v => v.side === 'offense').map(v => `offense:${v.id}`), ...(p.defense?.players || []).filter(v => v.side === 'defense').map(v => `defense:${v.id}`)];
    if (state.perspective && !choices.includes(state.perspective)) state.perspective = '';
  }
  function clearResult() {
    // Invalidation cancels the in-flight run, never erases a completed report.
    generation++; controller?.abort(); controller = null; showingReportSnapshot = false;runError='';
    const results = active && root.querySelector('#ai-results');
    if (results) { results.setAttribute('aria-busy','false');results.innerHTML = resultHTML(); paintEvidence(); }
    resetBusy();
  }
  function resetBusy() {
    const button = root.querySelector('[data-ai-action="analyze"]'), cancel = root.querySelector('[data-ai-action="cancel"]');
    if (button) { button.disabled = !selected().offense || !selected().defense; button.innerHTML = (t("extra.analyzeMatchup2") + " <span>✳</span>"); }
    if (cancel) cancel.hidden = true;
    let viewReport=root.querySelector('[data-ai-action="view-report"]');
    if (result && button && !viewReport) {
      viewReport=root.ownerDocument.createElement('button');viewReport.type='button';viewReport.dataset.aiAction='view-report';viewReport.className='ai-view-report';
      (cancel || button).after(viewReport);
    }
    if (viewReport) {viewReport.hidden=!result;viewReport.textContent=t(staleReport()?'analysis.viewPreviousReport':'analysis.viewReport');}
  }
  function show(showing) {
    active = showing; root.hidden = !showing;
    if (!showing) { importGeneration++; importing = false; if (controller) { generation++; controller.abort(); controller = null; } return; }
    render();
  }
  function onData(_data, record) {
    if (lastWorkspace !== record.id || lastRevision !== record.revision) {
      if (lastWorkspace) clearResult();
      if (lastWorkspace !== record.id) { importGeneration++; importing = false; }
      syncSession(); lastRevision = record.revision;
      if (active) render();
    }
  }
  function render() {
    if (!active) return;
    const record = getCurrent();
    if (!record) {
      root.innerHTML = `<main class="ai-empty"><span class="ai-kicker">${t("extra.playerScenarioAnalysis")}</span><h1>${t("extra.startWithAPlaybook")}</h1><p>${t("extra.createOrJoinATeamPlaybookTo")}</p><button class="button primary" data-cloud-action="enter-editor">${t("extra.createPlaybook")} →</button></main>`;
      return;
    }
    syncSession(); syncSelection();
    syncKnowledge();
    const { offense, defense } = selected();
    const displayed = showingReportSnapshot && reportSnapshot ? reportSnapshot : { offense, defense };
    const sideOptions = [['offense', offense], ['defense', defense]].flatMap(([side, play]) => (play?.players || []).filter(p => p.side === side).map(p => option(`${side}:${p.id}`, `${side === 'offense' ? (t("extra.offense")) : (t("extra.defense"))} · ${p.label}${p.name ? ' · ' + p.name : ''}`, state.perspective))).join('');
    const board = displayed.offense && displayed.defense ? fieldSVG(composeMatchup(displayed.offense, displayed.defense, showingReportSnapshot ? reportSnapshot.options.mirrorDefense : state.mirrorDefense), { showGrid: true, fieldTheme: 'light' }, { prefix: 'matchup', thumbnail: false }).replace('role="application" aria-label="战术绘图区" tabindex="0"', 'role="img" aria-label="攻防战术叠图"').replaceAll('role="button"', '').replaceAll('tabindex="0"', '').replaceAll('aria-pressed="false"', '') : '';
    const referenceNotice = offense?.reference || defense?.reference ? ("<p class=\"ai-inline-note\">" + t("extra.onePlayIsImageOnlyAndHas") + "</p>") : '';
    root.innerHTML = `<main class="ai-page"><header class="ai-page-header"><div><span class="ai-kicker">${t("analysis.eyebrow")}</span><h1>${t("analysis.title")}</h1><p>${t("analysis.intro")}</p></div><button class="ai-link-button" data-cloud-action="home">← ${t("extra.backToWorkspace")}</button></header><div class="ai-layout"><section class="ai-panel ai-setup"><div class="ai-section-heading"><span class="ai-step">01</span><div><h2>${t("extra.chooseMatchup")}</h2><p>${t("extra.chooseFromTheSamePlaybook")}</p></div></div><div class="ai-book"><div><small>${t("extra.currentPlaybook")}</small><strong>${e(record.title)}</strong></div><button type="button" data-cloud-action="books">${t("extra.switch")}</button></div><label class="ai-field"><span>${t("extra.offensivePlay")}</span><select data-ai-field="offense" ${plays('offense').length ? '' : 'disabled'}>${plays('offense').length ? plays('offense').map(p => option(p.id, p.title, state.offense)).join('') : ("<option>" + t("extra.noOffensivePlays") + "</option>")}</select></label><label class="ai-field"><span>${t("extra.defensivePlay")}</span><select data-ai-field="defense" ${plays('defense').length ? '' : 'disabled'}>${plays('defense').length ? plays('defense').map(p => option(p.id, p.title, state.defense)).join('') : ("<option>" + t("extra.noDefensivePlays") + "</option>")}</select></label><label class="ai-check"><input type="checkbox" data-ai-field="mirrorDefense" ${state.mirrorDefense ? 'checked' : ''}><span>${t("extra.mirrorDefenseHorizontallyDoesNotChangeThe")}</span></label>${!offense || !defense ? ("<p class=\"ai-inline-note\">" + t("extra.firstAddOffensiveAndDefensivePlaysTo") + "</p>") : ''}<label class="ai-field"><span>${t("extra.perspective")} <small>${t("extra.optional")}</small></span><select data-ai-field="perspective"><option value="">${t("extra.overallPerspective")}</option>${sideOptions}</select></label><div class="ai-two-fields"><label class="ai-field"><span>${t("extra.defensiveCoverage")} <small>${t("extra.optional")}</small></span><select data-ai-field="coverage">${Object.entries(coverageLabels()).map(([v,l]) => option(v,l,state.coverage)).join('')}</select></label><label class="ai-field"><span>${t("extra.analysisContext")}</span><select data-ai-field="mode">${option('real_football',(t("extra.realFootball")),state.mode)}${option('madden',("Madden " + t("extra.diagram")),state.mode)}</select></label></div><label class="ai-field"><span>${t("extra.additionalGameContext")} <small>${t("extra.optional")}</small></span><textarea data-ai-field="context" maxlength="800" rows="3" placeholder="${t("extra.exampleThirdAnd6ConfirmedCoverageResponsibilities")}">${e(state.context)}</textarea></label><div class="ai-section-divider"></div><div class="ai-section-heading"><span class="ai-step">02</span><div><h2>${t("extra.connectModel")}</h2><p>${t("extra.useYourOwnProviderAndCredits")}</p></div></div>${modelConnectionFields(state,demo)}<label class="ai-field"><span>${t("extra.modelNameId")}</span><input data-ai-field="model" type="text" maxlength="160" autocomplete="off" placeholder="${t("extra.forExampleDeepseekFlashOrAProvider")}" value="${e(state.model)}"></label><label class="ai-field"><span>API Key</span><input data-ai-field="apiKey" type="password" maxlength="512" autocomplete="off" placeholder="${t("extra.enterYourApiKey")}"><small>${t("extra.keptOnlyOnThisPageReEnter")}</small></label><label class="ai-check"><input type="checkbox" data-ai-field="includeNotes" ${state.includeNotes ? 'checked' : ''}><span>${t("extra.alsoSendTheSelectedCoachingNotesUp")}</span></label><button class="ai-submit" type="button" data-ai-action="analyze" ${offense && defense ? '' : 'disabled'}>${t("extra.analyzeMatchup2")} <span>✳</span></button><button class="ai-cancel" type="button" data-ai-action="cancel" hidden>${t("extra.stopAnalysis")}</button><p class="ai-submit-hint">${t("extra.chooseAModelThatSupportsToolCalls")}</p><div class="ai-error" role="alert" hidden></div></section><section class="ai-board-card" aria-label="${t("extra.matchupOverlay")}"><div class="ai-board-heading"><div><h2>${t("extra.matchupOverlay")}</h2></div><div class="ai-board-legend"><span><i class="ai-dot offense"></i>${t("extra.offense")}</span><span><i class="ai-dot defense"></i>${t("extra.defense")}</span></div></div><div data-local-brief>${localBriefHTML(offense, defense, state.coverage, coverageLabels()[state.coverage])}</div><div class="ai-board">${board || ("<div class=\"ai-board-placeholder\">" + t("extra.chooseOffensiveAndDefensivePlaysToView") + "</div>")}</div>${referenceNotice}<p class="ai-board-caption">${t("extra.diagramOverlayActualAssignmentsAndTimingDepend")}</p></section><section class="ai-knowledge" aria-label="${t('analysis.knowledge')}">${knowledgePanelHTML({ cards: retrievedKnowledge(), pack: knowledgePack, query: state.knowledgeQuery, error: knowledgeError, notice: knowledgeNotice, importing })}</section><section id="ai-results" aria-label="${t("extra.matchupAnalysis")}">${resultHTML()}</section></div></main>`;
    for (const field of ['offense', 'defense', 'coverage']) {
      const control = root.querySelector(`[data-ai-field="${field}"]`);
      if (control) control.value = state[field];
    }
    if (demo) {
      root.querySelector('[data-cloud-action="books"]')?.remove();
      root.querySelector('.ai-submit-hint').textContent = t('extra.demoRequestHint');
      root.querySelector('.ai-page-header p').textContent = t('extra.demoIntro');
    }
    const key = root.querySelector('[data-ai-field="apiKey"]'); if (key) key.value = state.apiKey;
    const boardHeading = root.querySelector('.ai-board-heading h2');
    if (showingReportSnapshot && boardHeading) boardHeading.textContent = t('analysis.reportBoard');
    if (showingReportSnapshot) {
      const brief=root.querySelector('[data-local-brief]');
      if (brief) brief.innerHTML=localBriefHTML(displayed.offense, displayed.defense, reportSnapshot.options.coverage, coverageLabels()[reportSnapshot.options.coverage]);
    }
    if (controller) {
      const button=root.querySelector('[data-ai-action="analyze"]'); if(button){button.disabled=true;button.textContent=t('extra.analyzingPleaseWait');}
      const cancel=root.querySelector('[data-ai-action="cancel"]'); if(cancel)cancel.hidden=false;
    } else resetBusy();
    paintEvidence();
  }
  function resultHTML() {
    const waiting = controller ? `<div class="ai-run-status ai-model-waiting" role="status"><span class="ai-waiting-indicator" aria-hidden="true"></span><span>${t('analysis.waiting')}<small>${t('analysis.retainingReport')}</small></span></div>` : '';
    const error = runError ? `<div class="ai-run-error" role="alert"><p>${e(runError)}</p><button type="button" data-ai-action="retry-analysis" ${controller || lastRunWasFollowup && staleReport() ? 'disabled' : ''}>${t('analysis.retry')}</button></div>` : '';
    if (!result) return `${error}${waiting || `<div class="ai-results-empty"><span class="ai-results-symbol" aria-hidden="true">↗</span><div><span class="ai-kicker">03 / SCENARIOS</span><h2>${t('analysis.prepare')}</h2><p>${t('analysis.prepareHint')}</p><small>${t('analysis.noModelYet')}</small></div></div>`}`;
    const scenario = result.scenarios[activeScenario];
    const ids = scenario.evidenceIds || [];
    const evidence = ids.map(id => result.evidence.find(item => item.id === id)).filter(Boolean);
    return `${error}${waiting}<div class="ai-result-card">${reportStatusHTML()}<div class="ai-result-title"><div><span class="ai-kicker">03 / SCENARIOS</span><h2>${t("extra.possibleScenarios")}</h2></div><span class="ai-result-badge">${result.status === 'limited' ? (t("extra.limitedInformation")) : (t("extra.basedOnSelectedPlays"))}</span></div>${result.summary ? `<p class="ai-result-summary">${e(result.summary)}</p>` : ''}<div class="ai-scenario-tabs" role="group" aria-label="${t("extra.chooseScenario")}">${result.scenarios.map((s,i) => `<button type="button" data-ai-scenario="${i}" aria-pressed="${i === activeScenario}"><span>${String(i+1).padStart(2,'0')}</span>${e(s.title)}</button>`).join('')}</div><article class="ai-scenario"><span class="ai-scenario-kicker">${t("extra.scenario")} ${String(activeScenario+1).padStart(2,'0')}</span><h3>${e(scenario.title)}</h3><div class="ai-scenario-grid"><div><small>${t("extra.condition")}</small><p>${e(scenario.condition)}</p></div><div><small>${t("extra.whatToWatch")}</small><p>${e(scenario.observation)}</p></div><div><small>${t("extra.possibility")}</small><p>${e(scenario.possibility)}</p></div>${scenario.action ? `<div><small>${t("extra.consider")}</small><p>${e(scenario.action)}</p></div>` : ''}</div>${scenario.limitations ? `<div class="ai-limit"><b>${t("extra.limitations")}</b> ${e(scenario.limitations)}</div>` : ''}<div class="ai-evidence"><small>${t("extra.evidence")}</small>${evidence.length ? evidence.map(evidenceHTML).join('') : ("<span>" + t("extra.thisScenarioDoesNotCiteASpecific") + "</span>")}</div>${scenario.action && onEditSuggestion ? `<div class="ai-suggestion-actions"><span>${t(canPrepareSuggestion() ? 'analysis.proposalHint' : 'analysis.proposalReadOnly')}</span><button type="button" data-ai-action="edit-suggestion" ${!canPrepareSuggestion() || staleReport() || controller || handingOff ? 'disabled' : ''}>${t('analysis.editSuggestion')}</button></div>` : ''}</article>${followupHTML()}${result.execution ? `<details class="ai-execution"><summary>${t("extra.viewAnalysisSteps")}</summary><p>${t('extra.usedModelRequests', { count: Number(result.execution.modelCalls) || 0 })}</p>${result.execution.usage ? `<p>${t("extra.totalInput")}${Number(result.execution.usage.inputTokens) || 0} / ${t("extra.output")}${Number(result.execution.usage.outputTokens) || 0} tokens。</p>` : ''}<ul>${(result.execution.toolsUsed || []).map(name => `<li>${e(toolLabels()[name] || (t("extra.analyzeMatchup")))}</li>`).join('')}</ul></details>` : ''}${result.missingInfo?.length ? `<div class="ai-missing"><strong>${t("extra.stillToConfirm")}</strong><ul>${result.missingInfo.map(v=>`<li>${e(v)}</li>`).join('')}</ul></div>` : ''}<div class="ai-warnings">${(result.warnings || []).map(v=>`<p>${e(v)}</p>`).join('')}</div><p class="ai-disclaimer">AI ${t("extra.offersConditionalScenariosNotGameFactsFollow")}</p></div>`;
  }
  function reportStatusHTML() {
    const stale = staleReport();
    return `<div class="ai-report-context ${stale ? 'is-stale' : ''}" role="status"><strong>${t(stale ? 'analysis.staleReport' : 'analysis.currentReport')}</strong><span>${e(reportSnapshot?.offense?.title)} × ${e(reportSnapshot?.defense?.title)} · ${t('analysis.reportRevision', { revision:reportSnapshot?.revision ?? '—' })}</span>${stale ? `<p>${t('analysis.staleHint')}</p><button type="button" data-ai-action="report-board">${t(showingReportSnapshot ? 'analysis.currentBoard' : 'analysis.reportBoard')}</button>` : ''}</div>`;
  }
  function followupHTML() {
    return `<section class="ai-discussion" aria-label="${t('analysis.discussion')}">${discussion.length ? `<details class="ai-discussion-history"><summary>${t('analysis.discussionHistory', { count:discussion.length })}</summary><ol>${discussion.map(turn => `<li><strong>${e(turn.question)}</strong><p>${e(turn.summary)}</p></li>`).join('')}</ol></details>` : ''}<label class="ai-field"><span>${t('analysis.followup')}</span><textarea data-ai-followup rows="3" maxlength="1200" placeholder="${t('analysis.followupPlaceholder')}" ${controller ? 'disabled' : ''}>${e(followupQuestion)}</textarea></label><button type="button" class="ai-followup-submit" data-ai-action="followup" ${staleReport() || controller ? 'disabled' : ''}>${t('analysis.sendFollowup')}</button><small>${t(staleReport() ? 'analysis.followupStale' : 'analysis.followupScope')}</small></section>`;
  }
  function evidenceHTML(item) {
    if (item.type === 'knowledge' || item.id?.startsWith('knowledge:')) return `<button type="button" data-knowledge-evidence="${e(item.id)}">${e(item.label)} ↗</button>`;
    const url = safeSourceUrl(typeof item.source === 'string' ? item.source : item.source?.url || '');
    if (url) return `<a href="${e(url)}" target="_blank" rel="noopener noreferrer">${e(item.label)} ↗</a>`;
    return `<button type="button" data-ai-focus="${e(item.id)}">${e(item.label)}</button>`;
  }
  function showKnowledgeEvidence(id) {
    const card = (result?.knowledge || []).find(item => item.evidenceId === id || `knowledge:${item.id}` === id) || retrievedKnowledge().find(item => item.evidenceId === id);
    if (!card) return;
    root.querySelector('.ai-source-inspector')?.remove();
    const inspector = root.ownerDocument.createElement('aside');
    inspector.className = 'ai-source-inspector'; inspector.setAttribute('aria-label', t('analysis.sourceDetails'));
    inspector.innerHTML = `<div class="ai-inspector-heading"><strong>${t('analysis.sourceDetails')}</strong><button type="button" data-knowledge-action="close">${t('analysis.close')} ×</button></div>${knowledgeCardHTML(card, { expanded: true })}<p>${t('analysis.evidenceMeaning')}</p>`;
    root.querySelector('#ai-results')?.append(inspector);
    inspector.querySelector('[data-knowledge-action="close"]')?.focus();
  }
  function paintEvidence(focusId) {
    const ids = new Set(staleReport() && !showingReportSnapshot ? [] : focusId ? [focusId] : result?.scenarios[activeScenario]?.evidenceIds || []);
    const hasBoardEvidence = [...ids].some(id => id.startsWith('offense:') || id.startsWith('defense:'));
    root.querySelectorAll('.ai-board [data-player],.ai-board [data-route],.ai-board [data-zone]').forEach(node => {
      const id = node.dataset.player || node.dataset.route || node.dataset.zone;
      node.classList.toggle('ai-evidence-active', ids.has(id));
      node.classList.toggle('ai-evidence-dim', hasBoardEvidence && !ids.has(id));
    });
  }
  function setField(node) {
    const field = node.dataset.aiField;
    if (!field || !Object.hasOwn(state, field)) return;
    state[field] = node.type === 'checkbox' ? node.checked : node.value;
    if (field === 'provider') {
      state.model = modelDefaults[state.provider] || '';
      state.protocol = MODEL_PROVIDER_PRESETS[state.provider].defaultProtocol;
      state.apiKey = ''; state.baseUrl = '';
    }
    if (field === 'protocol' && !MODEL_PROVIDER_PRESETS[state.provider].protocols.includes(state.protocol)) state.protocol = MODEL_PROVIDER_PRESETS[state.provider].defaultProtocol;
    if (['offense','defense','perspective','coverage','mode','context','mirrorDefense','includeNotes','provider','protocol','model','baseUrl','apiKey','knowledgeQuery'].includes(field)) clearResult();
    if (connectionFields.includes(field)) setModelConnection(Object.fromEntries(connectionFields.map(key => [key,state[key]])));
    if (['offense','defense','provider','protocol','mirrorDefense'].includes(field)) render();
    else if (['coverage','context','knowledgeQuery'].includes(field)) refreshLocalSections();
  }
  async function analyze({ followup = false } = {}) {
    if (controller) return;
    lastRunWasFollowup=followup;
    const showError = message => {
      runError=message;
      const error = root.querySelector('.ai-error'); if (error) { error.textContent = message; error.hidden = false; }
      const results=root.querySelector('#ai-results');if(results)results.innerHTML=resultHTML();
    };
    if (!state.model.trim() || !state.apiKey.trim()) return showError((t("extra.enterAModelIdAndApiKey")));
    if (state.provider === 'custom' && !state.baseUrl.trim()) return showError((t("extra.enterTheCustomServiceUrl")));
    if (isDirty()) return showError((t("extra.saveUnsyncedPlaybookChangesBeforeAnalyzing")));
    const record = getCurrent(); if (!record) return showError((t("extra.selectAPlaybookFirst")));
    if (followup && (!result || staleReport())) return showError(t('analysis.followupStale'));
    if (followup && !followupQuestion.trim()) { root.querySelector('[data-ai-followup]')?.focus(); return showError(t('analysis.followupRequired')); }
    const perspectiveParts = state.perspective ? state.perspective.split(/:(.*)/s) : [];
    const body = { locale: getLocale(), offensePlayId: state.offense, defensePlayId: state.defense, revision: record.revision, coverage: state.coverage, mode: state.mode, context: state.context, knowledgeQuery: state.knowledgeQuery, mirrorDefense: state.mirrorDefense, includeNotes: state.includeNotes, perspective: state.perspective ? { side: perspectiveParts[0], playerId: perspectiveParts[1] } : null, model: { provider: state.provider, protocol: state.protocol, model: state.model.trim(), apiKey: state.apiKey, baseUrl: state.baseUrl.trim() } };
    const question=followup ? followupQuestion.trim() : '';
    if (followup) {
      // Keep the requested scenario explicit and fit beside a 32 KB reference
      // pack. The full report remains in this view; the model receives the
      // focused previous answer, not an ever-growing serialized transcript.
      const source=result.scenarios[activeScenario];
      const focused=Object.fromEntries(['title','condition','observation','possibility','action','limitations'].map(field=>[field,String(source[field] || '').slice(0,300)]));
      focused.evidenceIds=(source.evidenceIds || []).slice(0,16);
      body.followup={ question, scenarioIndex:0, sourceScenarioIndex:activeScenario,
        offensePlayId:state.offense, defensePlayId:state.defense, revision:record.revision,
        previousReport:{summary:String(result.summary || '').slice(0,600),scenarios:[focused]} };
    }
    try { const pack = requestKnowledgePack(); if (pack) body.knowledgePack = pack; }
    catch (error) { return showError(t('analysis.importError', { message: error.message })); }
    clearResult(); const run = generation;
    const runSnapshot={key:inputKey(),workspaceId:record.id,revision:record.revision,offense:JSON.parse(JSON.stringify(selected().offense)),defense:JSON.parse(JSON.stringify(selected().defense)),options:analysisOptions()};
    controller = new AbortController();
    const runController = controller;
    const timeout = setTimeout(() => runController.abort(), 95000), button = root.querySelector('[data-ai-action="analyze"]');
    const cancel = root.querySelector('[data-ai-action="cancel"]'), error = root.querySelector('.ai-error');
    button.disabled = true; button.textContent = (t("extra.analyzingPleaseWait")); if (cancel) cancel.hidden = false; if (error) error.hidden = true;
    const waiting = root.querySelector('#ai-results');
    if (waiting) { waiting.setAttribute('aria-busy','true'); waiting.innerHTML=resultHTML(); }
    try {
      const response = await request(`/api/workspaces/${encodeURIComponent(record.id)}/matchup-analysis`, { method: 'POST', body, signal: runController.signal });
      if (!active || generation !== run) return;
      result = response; reportSnapshot=runSnapshot; activeScenario = 0; showingReportSnapshot=false;
      if (question) { discussion=[...discussion,{question,summary:response.summary || response.scenarios?.[0]?.possibility || ''}]; followupQuestion=''; }
      else discussion=[];
      const results = root.querySelector('#ai-results'); if (results) results.innerHTML = resultHTML(); paintEvidence();
    } catch (err) {
      if (active && generation === run) showError(err?.name === 'AbortError' || err?.name === 'TimeoutError' ? (t("extra.analysisWasCanceledOrTimedOutThe")) : localizedAnalysisError(err));
    } finally {
      clearTimeout(timeout);
      if (generation === run) { controller = null; resetBusy(); const results = root.querySelector('#ai-results'); if (results) { results.setAttribute('aria-busy','false');results.innerHTML = resultHTML();paintEvidence(); } }
    }
  }
  async function editSuggestion() {
    if (!onEditSuggestion || !canPrepareSuggestion() || !result || !reportSnapshot || staleReport() || controller || handingOff) return;
    const scenario=result.scenarios[activeScenario]; if (!scenario?.action) return;
    handingOff=true;
    const button=root.querySelector('[data-ai-action="edit-suggestion"]'); if(button)button.disabled=true;
    try {
      await onEditSuggestion({workspaceId:reportSnapshot.workspaceId,revision:reportSnapshot.revision,
        offensePlayId:reportSnapshot.offense.id,defensePlayId:reportSnapshot.defense.id,
        scenario:JSON.parse(JSON.stringify(scenario)),instruction:scenario.action});
    } catch(error) {
      const alert=root.querySelector('.ai-error'); if(alert){alert.textContent=localizedAnalysisError(error);alert.hidden=false;}
    } finally {handingOff=false;if(button?.isConnected)button.disabled=false;}
  }
  root.addEventListener('input', event => {
    if(event.target.matches('[data-ai-followup]')) {followupQuestion=event.target.value;return;}
    const node = event.target.closest('[data-ai-field]'); if (node && (node.tagName === 'INPUT' && node.type !== 'checkbox' || node.tagName === 'TEXTAREA')) setField(node);
  });
  root.addEventListener('change', event => { if (event.target.matches('[data-knowledge-import]')) { importKnowledgeFile(event.target.files?.[0]); return; } const node = event.target.closest('[data-ai-field]'); if (node && (node.tagName === 'SELECT' || node.type === 'checkbox')) setField(node); });
  root.addEventListener('click', event => {
    const removed = event.target.closest('[data-knowledge-delete]'); if (removed) { deleteKnowledgeSource(removed.dataset.knowledgeDelete); return; }
    const reference = event.target.closest('[data-knowledge-evidence]'); if (reference) { showKnowledgeEvidence(reference.dataset.knowledgeEvidence); return; }
    const focused = event.target.closest('[data-ai-focus]'); if (focused) { paintEvidence(focused.dataset.aiFocus); return; }
    const knowledgeAction = event.target.closest('[data-knowledge-action]');
    if (knowledgeAction) { if (knowledgeAction.dataset.knowledgeAction === 'export') exportKnowledge(); else root.querySelector('.ai-source-inspector')?.remove(); return; }
    const scenario = event.target.closest('[data-ai-scenario]');
    if (scenario && result) { activeScenario = Number(scenario.dataset.aiScenario); root.querySelector('#ai-results').innerHTML = resultHTML(); paintEvidence(); return; }
    if (event.target.closest('[data-ai-action="cancel"]') && controller) {
      generation++; controller.abort(); controller = null; resetBusy();
      const results = root.querySelector('#ai-results'); if (results) {results.setAttribute('aria-busy','false');results.innerHTML = resultHTML();}
      runError=t('extra.analysisCanceledTheProviderMayStillCharge');
      const error = root.querySelector('.ai-error'); if (error) { error.textContent = runError; error.hidden = false; }
      if(results)results.innerHTML=resultHTML();
      return;
    }
    if(event.target.closest('[data-ai-action="followup"]')){analyze({followup:true});return;}
    if(event.target.closest('[data-ai-action="retry-analysis"]')){analyze({followup:lastRunWasFollowup});return;}
    if(event.target.closest('[data-ai-action="edit-suggestion"]')){editSuggestion();return;}
    if(event.target.closest('[data-ai-action="report-board"]')){showingReportSnapshot=!showingReportSnapshot;render();return;}
    if(event.target.closest('[data-ai-action="view-report"]')){
      const results=root.querySelector('#ai-results');if(results){results.tabIndex=-1;results.focus({preventScroll:true});results.scrollIntoView?.({block:'start',behavior:'instant'});}return;
    }
    if (event.target.closest('[data-ai-action="analyze"]')) analyze();
  });
  function selectPlay(play, context = {}) {
    if (!play || !['offense', 'defense'].includes(play.book)) return;
    syncSession();
    state[play.book] = play.id;
    if (typeof context.instruction === 'string') state.context = context.instruction.slice(0, 2000);
    if (['unknown', 'cover3_spot', 'cover3_match', 'cover2', 'cover2_read', 'man'].includes(context.coverage)) state.coverage = context.coverage;
    if (typeof context.defensePlayId === 'string' && currentPlay('defense', context.defensePlayId)) state.defense = context.defensePlayId;
    clearResult();
    if (active) render();
  }
  return { show, onData, selectPlay, importKnowledgeFile, destroy(){clearResult();unsubscribeConnection();root.replaceChildren();} };
}
