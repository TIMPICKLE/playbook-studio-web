import { orientDefense } from '../web/matchup-model.js';
import { fail } from './http.mjs';
import { ANALYSIS_COVERAGES, retrieveMatchupKnowledge, knowledgeEvidence, diagramFacts, diagramIntersections } from '../web/analysis-evidence.js';
export { segmentHitsZone } from '../web/analysis-evidence.js';

const PROVIDERS = {
  deepseek: { openai: 'https://api.deepseek.com/chat/completions', anthropic: 'https://api.deepseek.com/anthropic/v1/messages' },
  anthropic: { anthropic: 'https://api.anthropic.com/v1/messages' },
  openrouter: { openai: 'https://openrouter.ai/api/v1/chat/completions' },
  openai: { openai: 'https://api.openai.com/v1/chat/completions' },
};
const text = (value, max) => typeof value === 'string' ? value.trim().slice(0, max) : '';
const ref = (side, type, id) => `${side}:${type}:${id}`;

function selectedPlay(play, side, includeNotes) {
  const players = play.players.filter(p => p.side === side);
  const ids = new Set(players.map(p => p.id));
  return {
    title: text(play.title, 120), formation: text(play.formation, 100), category: text(play.category, 60),
    referenceOnly: !!play.reference,
    players: players.map(p => ({ id: ref(side, 'player', p.id), label: p.label, x: p.x, y: p.y })),
    routes: play.routes.filter(r => ids.has(r.playerId)).map(r => ({ id: ref(side, 'route', r.id), playerId: ref(side, 'player', r.playerId), kind: r.kind, optional: r.optional, points: r.points, smooth: r.smooth, ...(r.intent ? { intent: r.intent } : {}) })),
    zones: side === 'defense' ? play.zones.map(z => ({ id: ref(side, 'zone', z.id), x: z.x, y: z.y, rx: z.rx, ry: z.ry, label: z.label })) : [],
    ...(includeNotes ? { notes: text(play.notes, 3000) } : {}),
  };
}

export function buildMatchup(offense, defense, options = {}) {
  defense = orientDefense(defense, options.mirrorDefense === true);
  const off = selectedPlay(offense, 'offense', options.includeNotes);
  const def = selectedPlay(defense, 'defense', options.includeNotes);
  let intersections;
  try { intersections = diagramIntersections(offense, defense); }
  catch (error) { fail(400, error.message); }
  const evidence = [];
  for (const [side, play] of [['offense', off], ['defense', def]]) {
    for (const player of play.players) evidence.push({ id: player.id, side, type: 'player', label: `${player.label} · 站位` });
    for (const route of play.routes) {
      const owner = play.players.find(p => p.id === route.playerId);
      evidence.push({ id: route.id, side, type: 'route', label: `${owner?.label || '球员'} · ${route.optional ? '选项' : ''}${route.kind === 'block' ? '阻挡' : route.kind === 'motion' ? '移动' : route.kind === 'pass' ? '传球' : '路线'}` });
    }
    for (const zone of play.zones) evidence.push({ id: zone.id, side, type: 'zone', label: `${zone.label || '未命名区域'} · 防守区域` });
  }
  const coverage = ANALYSIS_COVERAGES.includes(options.coverage) ? options.coverage : 'unknown';
  let knowledge;
  try { knowledge = retrieveMatchupKnowledge(offense, defense, { ...options, coverage }); }
  catch (error) { fail(400, error.message); }
  evidence.push(...knowledgeEvidence(knowledge, options.locale));
  const facts = diagramFacts(offense, defense, { ...options, coverage }, intersections);
  const warnings = [];
  if (off.referenceOnly || def.referenceOnly) warnings.push('原图战术没有可用坐标，本次只使用名称和阵型等文字；未发送原始图片。');
  if (options.includeNotes && (offense.notes.length > 3000 || defense.notes.length > 3000)) warnings.push('战术笔记每套最多发送前 3000 字，可能有内容未包含。');
  if (!off.routes.length) warnings.push('进攻路线信息不足，无法比较具体路线。');
  if (!def.zones.length) warnings.push('防守战术没有标注覆盖区域，不能判断路线与区域的关系。');
  if (coverage === 'unknown') warnings.push('防守覆盖类型未确认；不要从前线阵型推断覆盖。');
  if (coverage === 'cover2') warnings.push('Cover 2 具体规则未确认；不能将普通落位与 Cover 2 Read 的原则混用。');
  if (!knowledge.length) warnings.push('当前知识库没有相关命中；只能依据图面事实进行有限推演。');
  if (options.mirrorDefense) warnings.push('防守图已左右镜像；文字笔记不会自动镜像，请确认方位。');
  warnings.push('图上重叠不代表同一时刻到达；演示时长不是实战时序。');
  return { offense: off, defense: def, intersections, evidence, coverage, mirrorDefense: options.mirrorDefense === true, knowledge, facts, warnings };
}

export function modelEndpoint(config, env = {}) {
  if (!config || typeof config !== 'object') fail(400, '请填写模型服务配置');
  const provider = text(config.provider, 30);
  const protocol = config.protocol == null || config.protocol === '' ? (provider === 'anthropic' ? 'anthropic' : 'openai') : config.protocol;
  if (!['openai', 'anthropic'].includes(protocol)) fail(400, '请选择支持的 API 格式');
  let endpoint = PROVIDERS[provider]?.[protocol];
  if (provider === 'custom') {
    let u;
    try { u = new URL(config.baseUrl); } catch { fail(400, '自定义地址须为 HTTPS API 地址'); }
    const allowed = String(env.AI_ALLOWED_HOSTS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
    const host = u.hostname.toLowerCase();
    if (u.protocol !== 'https:' || u.username || u.password || u.search || u.hash || (u.port && u.port !== '443') || !allowed.includes(host) || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal') || /^[0-9.]+$/.test(host) || host.includes(':') || host.includes('[')) fail(400, '自定义地址不在管理员允许的安全主机列表中');
    u.pathname = u.pathname.replace(/\/+$/, '');
    const suffix = protocol === 'anthropic' ? '/messages' : '/chat/completions';
    if (!u.pathname.endsWith(suffix)) u.pathname += suffix;
    endpoint = u.toString();
  }
  if (!endpoint) fail(400, '请选择支持的模型服务');
  const model = text(config.model, 160), apiKey = typeof config.apiKey === 'string' ? config.apiKey.trim() : '';
  if (!model || /[\r\n]/.test(model)) fail(400, '请输入服务商提供的模型 ID');
  if (!apiKey || apiKey.length > 512 || /[^\x21-\x7e]/.test(apiKey)) fail(400, '请输入有效的 API Key');
  return { provider, protocol, endpoint, model, apiKey };
}

export function parseModelResult(raw, evidence) {
  let content = text(raw, 60000).replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  let result;
  try { result = JSON.parse(content); } catch { fail(502, '模型未返回可识别的分析格式，请检查模型兼容性后重试'); }
  if (!result || typeof result !== 'object' || !Array.isArray(result.scenarios) || !result.scenarios.length || result.scenarios.length > 5) fail(502, '模型返回的情景不完整，请重试');
  const allowed = new Set(evidence.map(item => item.id));
  const scenarios = result.scenarios.map(item => {
    if (!item || typeof item !== 'object' || !text(item.title, 100) || !text(item.condition, 600) || !text(item.observation, 600) || !text(item.possibility, 900) || !text(item.limitations, 700)) fail(502, '模型返回的情景信息不完整，请重试');
    if (!Array.isArray(item.evidenceIds) || item.evidenceIds.length > 16 || item.evidenceIds.some(id => typeof id !== 'string' || !allowed.has(id))) fail(502, '模型引用了不存在的战术对象，请重新分析');
    return { title: text(item.title, 100), condition: text(item.condition, 600), observation: text(item.observation, 600), possibility: text(item.possibility, 900), action: text(item.action, 700), limitations: text(item.limitations, 700), evidenceIds: [...new Set(item.evidenceIds)] };
  });
  return { summary: text(result.summary, 1000), scenarios, missingInfo: Array.isArray(result.missingInfo) ? result.missingInfo.filter(v => typeof v === 'string').map(v => text(v, 300)).filter(Boolean).slice(0, 8) : [] };
}

export async function limitedResponse(response) {
  if (!response.body) fail(502, '模型服务未返回内容');
  const reader = response.body.getReader(), chunks = []; let size = 0;
  while (true) {
    const { done, value } = await reader.read(); if (done) break;
    size += value.byteLength;
    if (size > 200000) { await reader.cancel(); fail(502, '模型回复过长，请缩小分析范围'); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder().decode(bytes)); } catch { fail(502, '模型服务返回格式无效'); }
}
