import { t, getLocale } from './i18n.js';
import { escapeHTML as e } from './model.js';
import { fieldSVG } from './field.js';
import { orientDefense } from './matchup-model.js';

const ref = (side, type, id) => `${side}:${type}:${id}`;
// Known server errors are localized; never rewrite user-authored context.
export function localizedAnalysisError(error) {
  const message = typeof error?.message === 'string' ? error.message : '';
  if (getLocale() === 'zh-CN' || !/[\u3400-\u9fff]/.test(message)) return message || t('extra.api.fallback');
  const key = 'extra.api.' + message;
  const translated = t(key);
  return translated === key ? t('extra.api.fallback') : translated;
}

const coverageLabels = { unknown: (t("extra.unconfirmed")), cover3_spot: ("Cover 3 · " + t("extra.zoneCoverage")), cover3_match: 'Cover 3 · Match', cover2: 'Cover 2', man: (t("extra.manCoverage")) };
const toolLabels = { get_matchup_context: (t("extra.readPlaysAndDiagramFacts")), inspect_player: (t("extra.inspectPlayerPositionsAndRoutes")), inspect_route_coverage: (t("extra.inspectRoutesAndDefensiveZones")), read_coverage_rule: (t("extra.readCoverageRules")) };
const modelDefaults = { deepseek: 'deepseek-flash', anthropic: 'claude-sonnet-4-6', openrouter: '', openai: '', custom: '' };
// Overlay colors communicate side and stay legible on the light field. They
// only affect this rendering; saved play and route colors are never changed.
const overlayColors = { offense: '#2b2f36', defense: '#c16f56' };
const option = (value, label, current) => `<option value="${e(value)}" ${value === current ? 'selected' : ''}>${e(label)}</option>`;

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

export function createMatchupView({ root, request, getCurrent, getData, isDirty }) {
  let active = false, result = null, activeScenario = 0, controller = null, generation = 0;
  const state = { offense: '', defense: '', perspective: '', coverage: 'unknown', mode: 'real_football', context: '', mirrorDefense: false, includeNotes: false, provider: 'deepseek', protocol: 'openai', model: modelDefaults.deepseek, apiKey: '', baseUrl: '' };
  let lastWorkspace = '', lastRevision = 0;
  const currentPlay = (book, id) => getData()?.plays.find(p => p.book === book && p.id === id);
  const plays = book => (getData()?.plays || []).filter(p => p.book === book);
  const selected = () => ({ offense: currentPlay('offense', state.offense), defense: currentPlay('defense', state.defense) });
  function syncSelection() {
    const off = plays('offense'), def = plays('defense');
    if (!off.some(p => p.id === state.offense)) state.offense = off[0]?.id || '';
    if (!def.some(p => p.id === state.defense)) state.defense = def[0]?.id || '';
    const p = selected(), choices = [...(p.offense?.players || []).filter(v => v.side === 'offense').map(v => `offense:${v.id}`), ...(p.defense?.players || []).filter(v => v.side === 'defense').map(v => `defense:${v.id}`)];
    if (state.perspective && !choices.includes(state.perspective)) state.perspective = '';
  }
  function clearResult() {
    result = null; activeScenario = 0; generation++; controller?.abort(); controller = null;
    const results = active && root.querySelector('#ai-results');
    if (results) { results.innerHTML = resultHTML(); paintEvidence(); }
    resetBusy();
  }
  function resetBusy() {
    const button = root.querySelector('[data-ai-action="analyze"]'), cancel = root.querySelector('[data-ai-action="cancel"]');
    if (button) { button.disabled = !selected().offense || !selected().defense; button.innerHTML = (t("extra.analyzeMatchup2") + " <span>✳</span>"); }
    if (cancel) cancel.hidden = true;
  }
  function show(showing) {
    active = showing; root.hidden = !showing;
    if (!showing) { if (controller) { generation++; controller.abort(); controller = null; } return; }
    render();
  }
  function onData(_data, record) {
    if (lastWorkspace !== record.id || lastRevision !== record.revision) {
      if (lastWorkspace) clearResult();
      lastWorkspace = record.id; lastRevision = record.revision;
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
    syncSelection();
    const { offense, defense } = selected();
    const sideOptions = [['offense', offense], ['defense', defense]].flatMap(([side, play]) => (play?.players || []).filter(p => p.side === side).map(p => option(`${side}:${p.id}`, `${side === 'offense' ? (t("extra.offense")) : (t("extra.defense"))} · ${p.label}${p.name ? ' · ' + p.name : ''}`, state.perspective))).join('');
    const board = offense && defense ? fieldSVG(composeMatchup(offense, defense, state.mirrorDefense), { showGrid: true, fieldTheme: 'light' }, { prefix: 'matchup', thumbnail: false }).replace('role="application" aria-label="战术绘图区" tabindex="0"', 'role="img" aria-label="攻防战术叠图"').replaceAll('role="button"', '').replaceAll('tabindex="0"', '').replaceAll('aria-pressed="false"', '') : '';
    const referenceNotice = offense?.reference || defense?.reference ? ("<p class=\"ai-inline-note\">" + t("extra.onePlayIsImageOnlyAndHas") + "</p>") : '';
    root.innerHTML = `<main class="ai-page"><header class="ai-page-header"><div><span class="ai-kicker">${t("extra.playerScenarioAnalysis")}</span><h1>${t("extra.exploreThePossibilities")}</h1><p>${t("extra.chooseAnOffensiveAndDefensivePlayTo")}</p></div><button class="ai-link-button" data-cloud-action="home">← ${t("extra.backToWorkspace")}</button></header><div class="ai-layout"><section class="ai-panel ai-setup"><div class="ai-section-heading"><span class="ai-step">01</span><div><h2>${t("extra.chooseMatchup")}</h2><p>${t("extra.chooseFromTheSamePlaybook")}</p></div></div><div class="ai-book"><div><small>${t("extra.currentPlaybook")}</small><strong>${e(record.title)}</strong></div><button type="button" data-cloud-action="books">${t("extra.switch")}</button></div><label class="ai-field"><span>${t("extra.offensivePlay")}</span><select data-ai-field="offense" ${plays('offense').length ? '' : 'disabled'}>${plays('offense').length ? plays('offense').map(p => option(p.id, p.title, state.offense)).join('') : ("<option>" + t("extra.noOffensivePlays") + "</option>")}</select></label><label class="ai-field"><span>${t("extra.defensivePlay")}</span><select data-ai-field="defense" ${plays('defense').length ? '' : 'disabled'}>${plays('defense').length ? plays('defense').map(p => option(p.id, p.title, state.defense)).join('') : ("<option>" + t("extra.noDefensivePlays") + "</option>")}</select></label><label class="ai-check"><input type="checkbox" data-ai-field="mirrorDefense" ${state.mirrorDefense ? 'checked' : ''}><span>${t("extra.mirrorDefenseHorizontallyDoesNotChangeThe")}</span></label>${!offense || !defense ? ("<p class=\"ai-inline-note\">" + t("extra.firstAddOffensiveAndDefensivePlaysTo") + "</p>") : ''}<label class="ai-field"><span>${t("extra.perspective")} <small>${t("extra.optional")}</small></span><select data-ai-field="perspective"><option value="">${t("extra.overallPerspective")}</option>${sideOptions}</select></label><div class="ai-two-fields"><label class="ai-field"><span>${t("extra.defensiveCoverage")} <small>${t("extra.optional")}</small></span><select data-ai-field="coverage">${Object.entries(coverageLabels).map(([v,l]) => option(v,l,state.coverage)).join('')}</select></label><label class="ai-field"><span>${t("extra.analysisContext")}</span><select data-ai-field="mode">${option('real_football',(t("extra.realFootball")),state.mode)}${option('madden',("Madden " + t("extra.diagram")),state.mode)}</select></label></div><label class="ai-field"><span>${t("extra.additionalGameContext")} <small>${t("extra.optional")}</small></span><textarea data-ai-field="context" maxlength="800" rows="3" placeholder="${t("extra.exampleThirdAnd6ConfirmedCoverageResponsibilities")}">${e(state.context)}</textarea></label><div class="ai-section-divider"></div><div class="ai-section-heading"><span class="ai-step">02</span><div><h2>${t("extra.connectModel")}</h2><p>${t("extra.useYourOwnProviderAndCredits")}</p></div></div><label class="ai-field"><span>${t("extra.modelProvider")}</span><select data-ai-field="provider">${option('deepseek','DeepSeek',state.provider)}${option('anthropic','Anthropic / Claude',state.provider)}${option('openrouter','OpenRouter',state.provider)}${option('openai','OpenAI',state.provider)}${option('custom',(t("extra.otherCompatibleServiceAdministratorConfigurationRequired")),state.provider)}</select></label>${['deepseek','custom'].includes(state.provider) ? `<label class="ai-field"><span>API ${t("extra.format")}</span><select data-ai-field="protocol">${option('openai',("OpenAI " + t("extra.format")),state.protocol)}${option('anthropic',("Anthropic " + t("extra.format")),state.protocol)}</select></label>` : ''}${state.provider === 'custom' ? `<label class="ai-field"><span>API Base URL</span><input data-ai-field="baseUrl" type="url" maxlength="400" placeholder="https://api.example.com/v1" value="${e(state.baseUrl)}"><small>${t("extra.anAdministratorMustAllowTheServiceHost")}</small></label>` : ''}<label class="ai-field"><span>${t("extra.modelNameId")}</span><input data-ai-field="model" type="text" maxlength="160" autocomplete="off" placeholder="${t("extra.forExampleDeepseekFlashOrAProvider")}" value="${e(state.model)}"></label><label class="ai-field"><span>API Key</span><input data-ai-field="apiKey" type="password" maxlength="512" autocomplete="off" placeholder="${t("extra.enterYourApiKey")}"><small>${t("extra.keptOnlyOnThisPageReEnter")}</small></label><label class="ai-check"><input type="checkbox" data-ai-field="includeNotes" ${state.includeNotes ? 'checked' : ''}><span>${t("extra.alsoSendTheSelectedCoachingNotesUp")}</span></label><button class="ai-submit" type="button" data-ai-action="analyze" ${offense && defense ? '' : 'disabled'}>${t("extra.analyzeMatchup2")} <span>✳</span></button><button class="ai-cancel" type="button" data-ai-action="cancel" hidden>${t("extra.stopAnalysis")}</button><p class="ai-submit-hint">${t("extra.chooseAModelThatSupportsToolCalls")}</p><div class="ai-error" role="alert" hidden></div></section><section class="ai-board-card" aria-label="${t("extra.matchupOverlay")}"><div class="ai-board-heading"><div><h2>${t("extra.matchupOverlay")}</h2></div><div class="ai-board-legend"><span><i class="ai-dot offense"></i>${t("extra.offense")}</span><span><i class="ai-dot defense"></i>${t("extra.defense")}</span></div></div><div class="ai-board">${board || ("<div class=\"ai-board-placeholder\">" + t("extra.chooseOffensiveAndDefensivePlaysToView") + "</div>")}</div>${referenceNotice}<p class="ai-board-caption">${t("extra.diagramOverlayActualAssignmentsAndTimingDepend")}</p></section><section id="ai-results" aria-label="${t("extra.matchupAnalysis")}">${resultHTML()}</section></div></main>`;
    const key = root.querySelector('[data-ai-field="apiKey"]'); if (key) key.value = state.apiKey;
    paintEvidence();
  }
  function resultHTML() {
    if (!result) return `<div class="ai-results-empty"><span class="ai-results-symbol">✳</span><div><h2>${t("extra.startWithAQuestion")}</h2><p>${t("extra.connectAModelAndAnalyzeToSee")}</p></div></div>`;
    const scenario = result.scenarios[activeScenario];
    const ids = scenario.evidenceIds || [];
    const evidence = ids.map(id => result.evidence.find(item => item.id === id)).filter(Boolean);
    return `<div class="ai-result-card"><div class="ai-result-title"><div><span class="ai-kicker">03 / ANALYSIS</span><h2>${t("extra.possibleScenarios")}</h2></div><span class="ai-result-badge">${result.status === 'limited' ? (t("extra.limitedInformation")) : (t("extra.basedOnSelectedPlays"))}</span></div>${result.summary ? `<p class="ai-result-summary">${e(result.summary)}</p>` : ''}<div class="ai-scenario-tabs" role="group" aria-label="${t("extra.chooseScenario")}">${result.scenarios.map((s,i) => `<button type="button" data-ai-scenario="${i}" aria-pressed="${i === activeScenario}"><span>${String(i+1).padStart(2,'0')}</span>${e(s.title)}</button>`).join('')}</div><article class="ai-scenario"><span class="ai-scenario-kicker">${t("extra.scenario")} ${String(activeScenario+1).padStart(2,'0')}</span><h3>${e(scenario.title)}</h3><div class="ai-scenario-grid"><div><small>${t("extra.condition")}</small><p>${e(scenario.condition)}</p></div><div><small>${t("extra.whatToWatch")}</small><p>${e(scenario.observation)}</p></div><div><small>${t("extra.possibility")}</small><p>${e(scenario.possibility)}</p></div>${scenario.action ? `<div><small>${t("extra.consider")}</small><p>${e(scenario.action)}</p></div>` : ''}</div>${scenario.limitations ? `<div class="ai-limit"><b>${t("extra.limitations")}</b> ${e(scenario.limitations)}</div>` : ''}<div class="ai-evidence"><small>${t("extra.evidence")}</small>${evidence.length ? evidence.map(v => /^https:\/\/blogs\.usafootball\.com\/blog\/\d+\/[a-z0-9-]+$/i.test(v.source || '') ? `<a href="${e(v.source)}" target="_blank" rel="noopener noreferrer">${e(v.label)} ↗</a>` : `<span>${e(v.label)}</span>`).join('') : ("<span>" + t("extra.thisScenarioDoesNotCiteASpecific") + "</span>")}</div></article>${result.execution ? `<details class="ai-execution"><summary>${t("extra.viewAnalysisSteps")}</summary><p>${t('extra.usedModelRequests', { count: Number(result.execution.modelCalls) || 0 })}</p>${result.execution.usage ? `<p>${t("extra.totalInput")}${Number(result.execution.usage.inputTokens) || 0} / ${t("extra.output")}${Number(result.execution.usage.outputTokens) || 0} tokens。</p>` : ''}<ul>${(result.execution.toolsUsed || []).map(name => `<li>${e(toolLabels[name] || (t("extra.analyzeMatchup")))}</li>`).join('')}</ul></details>` : ''}${result.missingInfo?.length ? `<div class="ai-missing"><strong>${t("extra.stillToConfirm")}</strong><ul>${result.missingInfo.map(v=>`<li>${e(v)}</li>`).join('')}</ul></div>` : ''}<div class="ai-warnings">${result.warnings.map(v=>`<p>${e(v)}</p>`).join('')}</div><p class="ai-disclaimer">AI ${t("extra.offersConditionalScenariosNotGameFactsFollow")}</p></div>`;
  }
  function paintEvidence() {
    const ids = new Set(result?.scenarios[activeScenario]?.evidenceIds || []);
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
      state.protocol = state.provider === 'anthropic' ? 'anthropic' : 'openai';
      state.apiKey = '';
    }
    if (['offense','defense','perspective','coverage','mode','context','mirrorDefense','includeNotes','provider','protocol','model','baseUrl','apiKey'].includes(field)) clearResult();
    if (['offense','defense','provider','protocol','mirrorDefense'].includes(field)) render();
  }
  async function analyze() {
    const showError = message => { const error = root.querySelector('.ai-error'); if (error) { error.textContent = message; error.hidden = false; } };
    if (!state.model.trim() || !state.apiKey.trim()) return showError((t("extra.enterAModelIdAndApiKey")));
    if (state.provider === 'custom' && !state.baseUrl.trim()) return showError((t("extra.enterTheCustomServiceUrl")));
    if (isDirty()) return showError((t("extra.saveUnsyncedPlaybookChangesBeforeAnalyzing")));
    const record = getCurrent(); if (!record) return showError((t("extra.selectAPlaybookFirst")));
    const perspectiveParts = state.perspective ? state.perspective.split(/:(.*)/s) : [];
    const body = { locale: getLocale(), offensePlayId: state.offense, defensePlayId: state.defense, revision: record.revision, coverage: state.coverage, mode: state.mode, context: state.context, mirrorDefense: state.mirrorDefense, includeNotes: state.includeNotes, perspective: state.perspective ? { side: perspectiveParts[0], playerId: perspectiveParts[1] } : null, model: { provider: state.provider, protocol: state.protocol, model: state.model.trim(), apiKey: state.apiKey, baseUrl: state.baseUrl.trim() } };
    clearResult(); const run = generation; controller = new AbortController();
    const runController = controller;
    const timeout = setTimeout(() => runController.abort(), 95000), button = root.querySelector('[data-ai-action="analyze"]');
    const cancel = root.querySelector('[data-ai-action="cancel"]'), error = root.querySelector('.ai-error');
    button.disabled = true; button.textContent = (t("extra.analyzingPleaseWait")); if (cancel) cancel.hidden = false; if (error) error.hidden = true;
    try {
      const response = await request(`/api/workspaces/${encodeURIComponent(record.id)}/matchup-analysis`, { method: 'POST', body, signal: runController.signal });
      if (!active || generation !== run) return;
      result = response; activeScenario = 0;
      const results = root.querySelector('#ai-results'); if (results) results.innerHTML = resultHTML(); paintEvidence();
    } catch (err) {
      if (active && generation === run) showError(err?.name === 'AbortError' || err?.name === 'TimeoutError' ? (t("extra.analysisWasCanceledOrTimedOutThe")) : localizedAnalysisError(err));
    } finally {
      clearTimeout(timeout);
      if (generation === run) { controller = null; resetBusy(); }
    }
  }
  root.addEventListener('input', event => { const node = event.target.closest('[data-ai-field]'); if (node && (node.tagName === 'INPUT' && node.type !== 'checkbox' || node.tagName === 'TEXTAREA')) setField(node); });
  root.addEventListener('change', event => { const node = event.target.closest('[data-ai-field]'); if (node && (node.tagName === 'SELECT' || node.type === 'checkbox')) setField(node); });
  root.addEventListener('click', event => {
    const scenario = event.target.closest('[data-ai-scenario]');
    if (scenario && result) { activeScenario = Number(scenario.dataset.aiScenario); root.querySelector('#ai-results').innerHTML = resultHTML(); paintEvidence(); return; }
    if (event.target.closest('[data-ai-action="cancel"]') && controller) {
      generation++; controller.abort(); controller = null; resetBusy();
      const error = root.querySelector('.ai-error'); if (error) { error.textContent = (t("extra.analysisCanceledTheProviderMayStillCharge")); error.hidden = false; }
      return;
    }
    if (event.target.closest('[data-ai-action="analyze"]')) analyze();
  });
  return { show, onData };
}
