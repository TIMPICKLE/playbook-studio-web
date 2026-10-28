import { escapeHTML as e } from './model.js';
import { fieldSVG } from './field.js';
import { orientDefense } from './matchup-model.js';

const ref = (side, type, id) => `${side}:${type}:${id}`;
const coverageLabels = { unknown: '未确认', cover3_spot: 'Cover 3 · 区域落位', cover3_match: 'Cover 3 · Match', cover2: 'Cover 2', man: '盯人' };
const toolLabels = { get_matchup_context: '读取攻防战术和图形事实', inspect_player: '查看球员站位与路线', inspect_route_coverage: '检查路线与防守区域', read_coverage_rule: '查看覆盖规则' };
const modelDefaults = { deepseek: 'deepseek-flash', anthropic: 'claude-sonnet-4-6', openrouter: '', openai: '', custom: '' };
const option = (value, label, current) => `<option value="${e(value)}" ${value === current ? 'selected' : ''}>${e(label)}</option>`;

export function composeMatchup(offense, defense, mirrorDefense = false) {
  defense = orientDefense(defense, mirrorDefense);
  const players = [], routes = [], zones = [];
  for (const [side, play] of [['offense', offense], ['defense', defense]]) {
    if (!play || play.reference) continue;
    const chosen = play.players.filter(p => p.side === side), ids = new Set(chosen.map(p => p.id));
    players.push(...chosen.map(p => ({ ...p, id: ref(side, 'player', p.id), name: '' })));
    routes.push(...play.routes.filter(r => ids.has(r.playerId)).map(r => ({ ...r, id: ref(side, 'route', r.id), playerId: ref(side, 'player', r.playerId) })));
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
    if (button) { button.disabled = !selected().offense || !selected().defense; button.innerHTML = '分析这组对局 <span>✳</span>'; }
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
      root.innerHTML = `<main class="ai-empty"><span class="ai-kicker">MATCHUP LAB</span><h1>从一份战术本开始</h1><p>先创建或加入团队战术本，就能选择进攻和防守战术。</p><button class="button primary" data-cloud-action="enter-editor">创建战术本 →</button></main>`;
      return;
    }
    syncSelection();
    const { offense, defense } = selected();
    const sideOptions = [['offense', offense], ['defense', defense]].flatMap(([side, play]) => (play?.players || []).filter(p => p.side === side).map(p => option(`${side}:${p.id}`, `${side === 'offense' ? '进攻' : '防守'} · ${p.label}${p.name ? ' · ' + p.name : ''}`, state.perspective))).join('');
    const board = offense && defense ? fieldSVG(composeMatchup(offense, defense, state.mirrorDefense), { showGrid: true, fieldTheme: 'light' }, { prefix: 'matchup', thumbnail: false }).replace('role="application" aria-label="战术绘图区" tabindex="0"', 'role="img" aria-label="攻防战术叠图"').replaceAll('role="button"', '').replaceAll('tabindex="0"', '').replaceAll('aria-pressed="false"', '') : '';
    const referenceNotice = offense?.reference || defense?.reference ? '<p class="ai-inline-note">其中一套是原图战术，没有可叠加坐标；仅使用文字信息，图片不会发送。</p>' : '';
    root.innerHTML = `<main class="ai-page"><header class="ai-page-header"><div><span class="ai-kicker">MATCHUP LAB / 球员情景观察</span><h1>看见每一种可能。</h1><p>选择一攻一守，理解比赛中值得关注的变化。</p></div><button class="ai-link-button" data-cloud-action="home">← 返回工作台</button></header><div class="ai-layout"><section class="ai-panel ai-setup"><div class="ai-section-heading"><span class="ai-step">01</span><div><h2>选择对局</h2><p>从同一本战术本中选择</p></div></div><div class="ai-book"><div><small>当前战术本</small><strong>${e(record.title)}</strong></div><button type="button" data-cloud-action="books">切换</button></div><label class="ai-field"><span>进攻战术</span><select data-ai-field="offense" ${plays('offense').length ? '' : 'disabled'}>${plays('offense').length ? plays('offense').map(p => option(p.id, p.title, state.offense)).join('') : '<option>暂无进攻战术</option>'}</select></label><label class="ai-field"><span>防守战术</span><select data-ai-field="defense" ${plays('defense').length ? '' : 'disabled'}>${plays('defense').length ? plays('defense').map(p => option(p.id, p.title, state.defense)).join('') : '<option>暂无防守战术</option>'}</select></label><label class="ai-check"><input type="checkbox" data-ai-field="mirrorDefense" ${state.mirrorDefense ? 'checked' : ''}><span>左右镜像防守图（不修改原战术）</span></label>${!offense || !defense ? '<p class="ai-inline-note">请先在编辑区为当前战术本准备进攻和防守战术。</p>' : ''}<label class="ai-field"><span>观察视角 <small>可选</small></span><select data-ai-field="perspective"><option value="">整体视角</option>${sideOptions}</select></label><div class="ai-two-fields"><label class="ai-field"><span>防守覆盖 <small>可选</small></span><select data-ai-field="coverage">${Object.entries(coverageLabels).map(([v,l]) => option(v,l,state.coverage)).join('')}</select></label><label class="ai-field"><span>分析语境</span><select data-ai-field="mode">${option('real_football','真实橄榄球',state.mode)}${option('madden','Madden 图示',state.mode)}</select></label></div><label class="ai-field"><span>补充比赛情况 <small>可选</small></span><textarea data-ai-field="context" maxlength="800" rows="3" placeholder="例如：第三档还需 6 码；我们已确认的防守责任…">${e(state.context)}</textarea></label><div class="ai-section-divider"></div><div class="ai-section-heading"><span class="ai-step">02</span><div><h2>连接模型</h2><p>使用你自己的服务与额度</p></div></div><label class="ai-field"><span>模型服务商</span><select data-ai-field="provider">${option('deepseek','DeepSeek',state.provider)}${option('anthropic','Anthropic / Claude',state.provider)}${option('openrouter','OpenRouter',state.provider)}${option('openai','OpenAI',state.provider)}${option('custom','其他兼容服务（需管理员配置）',state.provider)}</select></label>${['deepseek','custom'].includes(state.provider) ? `<label class="ai-field"><span>API 格式</span><select data-ai-field="protocol">${option('openai','OpenAI 格式',state.protocol)}${option('anthropic','Anthropic 格式',state.protocol)}</select></label>` : ''}${state.provider === 'custom' ? `<label class="ai-field"><span>API Base URL</span><input data-ai-field="baseUrl" type="url" maxlength="400" placeholder="https://你的服务地址/v1" value="${e(state.baseUrl)}"><small>服务主机需由管理员加入允许列表。</small></label>` : ''}<label class="ai-field"><span>模型名称 / ID</span><input data-ai-field="model" type="text" maxlength="160" autocomplete="off" placeholder="例如 deepseek-flash 或服务商的模型 ID" value="${e(state.model)}"></label><label class="ai-field"><span>API Key</span><input data-ai-field="apiKey" type="password" maxlength="512" autocomplete="off" placeholder="输入你的 API Key"><small>仅保留在当前页面；刷新或退出后需要重新填写。</small></label><label class="ai-check"><input type="checkbox" data-ai-field="includeNotes" ${state.includeNotes ? 'checked' : ''}><span>同时发送所选战术的教练笔记（每套最多 3000 字）</span></label><button class="ai-submit" type="button" data-ai-action="analyze" ${offense && defense ? '' : 'disabled'}>分析这组对局 <span>✳</span></button><button class="ai-cancel" type="button" data-ai-action="cancel" hidden>停止分析</button><p class="ai-submit-hint">请选择支持工具调用的模型 · 不发送名单和原始图片</p><div class="ai-error" role="alert" hidden></div></section><section class="ai-main"><div class="ai-board-card"><div class="ai-board-heading"><div><span class="ai-kicker">THE MATCHUP</span><h2>攻防叠图</h2></div><div class="ai-board-legend"><span><i class="ai-dot offense"></i>进攻</span><span><i class="ai-dot defense"></i>防守</span></div></div><div class="ai-board">${board || '<div class="ai-board-placeholder">选择进攻和防守战术后查看叠图</div>'}</div>${referenceNotice}<p class="ai-board-caption">纸面叠图 · 实际责任和时间以球队战术为准</p></div><div id="ai-results">${resultHTML()}</div></section></div></main>`;
    const key = root.querySelector('[data-ai-field="apiKey"]'); if (key) key.value = state.apiKey;
    paintEvidence();
  }
  function resultHTML() {
    if (!result) return `<div class="ai-results-empty"><span class="ai-results-symbol">✳</span><div><h2>从一个问题开始</h2><p>连接模型并分析后，这里会显示不同情景、观察重点和不确定的信息。</p></div></div>`;
    const scenario = result.scenarios[activeScenario];
    const ids = scenario.evidenceIds || [];
    const evidence = ids.map(id => result.evidence.find(item => item.id === id)).filter(Boolean);
    return `<div class="ai-result-card"><div class="ai-result-title"><div><span class="ai-kicker">03 / ANALYSIS</span><h2>可能出现的情景</h2></div><span class="ai-result-badge">${result.status === 'limited' ? '信息有限' : '基于所选战术'}</span></div>${result.summary ? `<p class="ai-result-summary">${e(result.summary)}</p>` : ''}<div class="ai-scenario-tabs" role="group" aria-label="选择情景">${result.scenarios.map((s,i) => `<button type="button" data-ai-scenario="${i}" aria-pressed="${i === activeScenario}"><span>${String(i+1).padStart(2,'0')}</span>${e(s.title)}</button>`).join('')}</div><article class="ai-scenario"><span class="ai-scenario-kicker">情景 ${String(activeScenario+1).padStart(2,'0')}</span><h3>${e(scenario.title)}</h3><div class="ai-scenario-grid"><div><small>如果发生</small><p>${e(scenario.condition)}</p></div><div><small>关注什么</small><p>${e(scenario.observation)}</p></div><div><small>可能出现</small><p>${e(scenario.possibility)}</p></div>${scenario.action ? `<div><small>可以考虑</small><p>${e(scenario.action)}</p></div>` : ''}</div>${scenario.limitations ? `<div class="ai-limit"><b>需要留意</b> ${e(scenario.limitations)}</div>` : ''}<div class="ai-evidence"><small>分析依据</small>${evidence.length ? evidence.map(v => /^https:\/\/blogs\.usafootball\.com\/blog\/\d+\/[a-z0-9-]+$/i.test(v.source || '') ? `<a href="${e(v.source)}" target="_blank" rel="noopener noreferrer">${e(v.label)} ↗</a>` : `<span>${e(v.label)}</span>`).join('') : '<span>该情景没有引用具体图形对象</span>'}</div></article>${result.execution ? `<details class="ai-execution"><summary>查看本次分析步骤</summary><p>本次使用 ${Number(result.execution.modelCalls) || 0} 次模型请求，服务商按实际用量计费。</p>${result.execution.usage ? `<p>本次共使用输入 ${Number(result.execution.usage.inputTokens) || 0} / 输出 ${Number(result.execution.usage.outputTokens) || 0} tokens。</p>` : ''}<ul>${(result.execution.toolsUsed || []).map(name => `<li>${e(toolLabels[name] || '分析对局')}</li>`).join('')}</ul></details>` : ''}${result.missingInfo?.length ? `<div class="ai-missing"><strong>还需要确认</strong><ul>${result.missingInfo.map(v=>`<li>${e(v)}</li>`).join('')}</ul></div>` : ''}<div class="ai-warnings">${result.warnings.map(v=>`<p>${e(v)}</p>`).join('')}</div><p class="ai-disclaimer">AI 给出的是条件情景，不代表比赛事实。实际执行以球队规则和教练要求为准。</p></div>`;
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
    if (!state.model.trim() || !state.apiKey.trim()) return showError('请填写模型 ID 和 API Key。');
    if (state.provider === 'custom' && !state.baseUrl.trim()) return showError('请填写自定义服务地址。');
    if (isDirty()) return showError('战术本还有未同步的更改，请先保存后再分析。');
    const record = getCurrent(); if (!record) return showError('请先选择战术本。');
    const perspectiveParts = state.perspective ? state.perspective.split(/:(.*)/s) : [];
    const body = { offensePlayId: state.offense, defensePlayId: state.defense, revision: record.revision, coverage: state.coverage, mode: state.mode, context: state.context, mirrorDefense: state.mirrorDefense, includeNotes: state.includeNotes, perspective: state.perspective ? { side: perspectiveParts[0], playerId: perspectiveParts[1] } : null, model: { provider: state.provider, protocol: state.protocol, model: state.model.trim(), apiKey: state.apiKey, baseUrl: state.baseUrl.trim() } };
    clearResult(); const run = generation; controller = new AbortController();
    const runController = controller;
    const timeout = setTimeout(() => runController.abort(), 95000), button = root.querySelector('[data-ai-action="analyze"]');
    const cancel = root.querySelector('[data-ai-action="cancel"]'), error = root.querySelector('.ai-error');
    button.disabled = true; button.textContent = '正在分析，请稍候…'; if (cancel) cancel.hidden = false; if (error) error.hidden = true;
    try {
      const response = await request(`/api/workspaces/${encodeURIComponent(record.id)}/matchup-analysis`, { method: 'POST', body, signal: runController.signal });
      if (!active || generation !== run) return;
      result = response; activeScenario = 0;
      const results = root.querySelector('#ai-results'); if (results) results.innerHTML = resultHTML(); paintEvidence();
    } catch (err) {
      if (active && generation === run) showError(err?.name === 'AbortError' || err?.name === 'TimeoutError' ? '分析已取消或超时；已发起的请求可能仍由服务商计费。' : (err?.message || '分析失败，请检查模型配置后重试。'));
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
      const error = root.querySelector('.ai-error'); if (error) { error.textContent = '已取消分析；已发起的请求可能仍由服务商计费。'; error.hidden = false; }
      return;
    }
    if (event.target.closest('[data-ai-action="analyze"]')) analyze();
  });
  return { show, onData };
}
