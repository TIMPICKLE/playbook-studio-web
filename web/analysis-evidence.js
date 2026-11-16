import { retrieveKnowledge, validateKnowledgePack } from './knowledge-base.js';
import { sampledRoute } from './model.js';
import { getPlayLeague, isFlag5Play } from './game-formats.js';

export const ANALYSIS_KNOWLEDGE_BYTES = 32000;
export const ANALYSIS_KNOWLEDGE_CARDS = 6;
export const ANALYSIS_COVERAGES = ['unknown', 'cover3_spot', 'cover3_match', 'cover2', 'cover2_read', 'man'];
const bytes = value => new TextEncoder().encode(typeof value === 'string' ? value : JSON.stringify(value)).byteLength;
const phrase = value => typeof value === 'string' ? value.trim().slice(0, 800) : '';

// A five-marker fragment is not sufficient evidence of a flag ruleset. The
// play-level league or a named flag template supplies that explicit context.
export function matchupGameFormat(offense, defense) {
  const describe = play => ({ playersPerSide: getPlayLeague(play), ruleset: isFlag5Play(play) ? 'flag5' : 'unspecified' });
  const off = describe(offense), def = describe(defense);
  return { offense: off, defense: def, flag5: [off, def].some(side => side.ruleset === 'flag5'),
    mixed: !!offense && !!defense && (off.playersPerSide !== def.playersPerSide || off.ruleset !== def.ruleset) };
}

export function matchupFormatNotes(offense, defense, locale = 'zh-CN') {
  const format = matchupGameFormat(offense, defense), en = locale === 'en';
  return [
    ...(format.flag5 ? [en
      ? '5v5 flag: the center can receive after snapping. Do not default to contact blocking, tackling or kicking. Confirm the competition rules for rushing, QB runs and field dimensions; distances use the existing diagram grid.'
      : '5人腰旗：中锋开球后可接球，不默认使用接触式阻挡、擒抱或踢球。冲传、QB跑球和场地尺寸须按所属赛事核对；距离沿用当前示意网格。', en
      ? 'Built-in tackle-football knowledge has not been adapted to 5v5 flag and is excluded here. Imported team material still requires a rules and applicability check.'
      : '内置擒抱式战术知识尚未针对5人腰旗适配，本次不使用；导入的球队资料仍须核对规则与适用条件。'] : []),
    ...(format.mixed ? [en
      ? 'The selected offense and defense use different player counts or format contexts. Compare diagram objects only; do not treat this as a matchup under the same competition rules.'
      : '所选进攻与防守的人数或模式不一致；只能比较图示对象，不能视为同一赛事规则下的实战对局。'] : []),
  ];
}

// Imports are user-provided material even if their JSON claims to be published
// or reviewed. The curated corpus is loaded independently by the retriever.
export function authorizedKnowledgePack(raw) {
  if (raw == null) return null;
  if (bytes(raw) > ANALYSIS_KNOWLEDGE_BYTES) throw new Error('本次知识片段超出 32 KB，请减少选中的资料');
  const pack = validateKnowledgePack(raw);
  if (pack.cards.length > ANALYSIS_KNOWLEDGE_CARDS) throw new Error('每次最多发送 6 条知识片段');
  return { ...pack, sources: pack.sources.map(source => ({ ...source, kind: 'team' })) };
}

export function matchupKnowledgeQuery(offense, defense, options = {}) {
  // Names are retrieval hints, never a declaration of the routes actually drawn.
  const routeIntents = (offense?.routes || []).filter(route => route.kind === 'route').map(route => route.intent?.concept).filter(Boolean);
  return [offense?.title, offense?.formation, offense?.category, defense?.title, defense?.formation, ...routeIntents, phrase(options.context), phrase(options.knowledgeQuery)].filter(Boolean).join(' ').slice(0, 2200);
}

export function segmentHitsZone(a, b, zone) {
  const x = (a.x - zone.x) / zone.rx, y = (a.y - zone.y) / zone.ry;
  const dx = (b.x - a.x) / zone.rx, dy = (b.y - a.y) / zone.ry;
  const c = x * x + y * y - 1;
  if (c <= 0) return true;
  const aa = dx * dx + dy * dy;
  if (!aa) return false;
  const bb = 2 * (x * dx + y * dy), disc = bb * bb - 4 * aa * c;
  if (disc < 0) return false;
  const root = Math.sqrt(disc), t1 = (-bb - root) / (2 * aa), t2 = (-bb + root) / (2 * aa);
  return t1 >= 0 && t1 <= 1 || t2 >= 0 && t2 <= 1;
}

export function diagramIntersections(offense, defense) {
  const owners = new Set(offense.players.filter(player => player.side === 'offense').map(player => player.id));
  const routes = offense.routes.filter(route => route.kind === 'route' && owners.has(route.playerId));
  const work = routes.reduce((sum, route) => sum + route.points.length * (route.smooth ? 16 : 1), 0) * defense.zones.length;
  if (work > 500000) throw new Error('所选战术的路线和区域过于复杂，请简化后再分析');
  const intersections = [];
  for (const route of routes) {
    const points = sampledRoute(route);
    for (const zone of defense.zones) if (points.slice(1).some((point, index) => segmentHitsZone(points[index], point, zone))) {
      intersections.push({ routeId: `offense:route:${route.id}`, zoneId: `defense:zone:${zone.id}` });
    }
  }
  return intersections;
}

export function retrieveMatchupKnowledge(offense, defense, options = {}) {
  const pack = authorizedKnowledgePack(options.knowledgePack);
  return retrieveKnowledge({ query: matchupKnowledgeQuery(offense, defense, options), coverage: options.coverage || 'unknown', packs: pack ? [pack] : [], limit: ANALYSIS_KNOWLEDGE_CARDS, locale: options.locale || 'zh-CN',
    includeBuiltin: !matchupGameFormat(offense, defense).flag5 });
}

export function knowledgeEvidence(cards, locale = 'zh-CN') {
  return cards.map(card => ({
    id: card.evidenceId, side: 'context', type: 'knowledge',
    label: `${locale === 'en' ? 'Coaching principle' : '战术原则'} · ${card.title}`,
    source: card.source?.url || '', sourceId: card.sourceId,
    sourceTitle: card.source?.title || '', sourceKind: card.source?.kind || 'team',
    sourceRevision: card.source?.revision || card.source?.contentHash || '',
    page: card.page || null, regionId: card.regionId || '',
    parentId: card.parentId || '', bbox: card.bbox || null,
    figures: card.figures || [], content: card.content,
    appliesWhen: card.appliesWhen || [], exceptions: card.exceptions || [],
    readKey: card.readKey || '', coachingCue: card.coachingCue || '',
    applicability: card.applicability || 'conditional',
    matchReasons: card.matchReasons || [],
    visualContentSent: false,
  }));
}

export function diagramFacts(offense, defense, options = {}, intersections = []) {
  const en = options.locale === 'en';
  const offPlayers = (offense.players || []).filter(player => player.side === 'offense');
  const defPlayers = (defense.players || []).filter(player => player.side === 'defense');
  const offIds = new Set(offPlayers.map(player => player.id));
  const offRoutes = (offense.routes || []).filter(route => offIds.has(route.playerId));
  const coverage = ANALYSIS_COVERAGES.includes(options.coverage) ? options.coverage : 'unknown';
  const gameFormat = matchupGameFormat(offense, defense);
  return {
    kind: 'static_diagram', coverage, gameFormat,
    counts: {
      offensivePlayers: offPlayers.length, defensivePlayers: defPlayers.length,
      receivingRoutes: offRoutes.filter(route => route.kind === 'route').length,
      blockingLines: offRoutes.filter(route => route.kind === 'block').length,
      motionLines: offRoutes.filter(route => route.kind === 'motion').length,
      defensiveZones: (defense.zones || []).length, intersections: intersections.length,
    },
    assumptions: [
      en ? 'Coverage is the selected coaching assumption, not identified from the diagram.' : '覆盖类型采用用户所选的战术假设，并非从站位自动识别。',
      en ? 'Play names and route labels guide retrieval; they do not establish assignments.' : '战术名称与路线标签仅帮助检索，不证明实际防守责任。',
    ],
    unknowns: [
      ...(coverage === 'unknown' ? [en ? 'Defensive coverage and checks are unconfirmed.' : '防守覆盖及调整规则尚未确认。'] : []),
      ...(coverage === 'cover2' ? [en ? 'The Cover 2 variant is unconfirmed; spot-drop and Read rules differ.' : 'Cover 2 具体变体未确认；普通落位与 Read 的规则不同。'] : []),
      en ? 'Protection assignments, defensive handoffs and real execution timing are not established by static lines.' : '静态线条不能确认保护分配、防守交接及实战时序。',
      ...matchupFormatNotes(offense, defense, options.locale),
      ...(gameFormat.flag5 && offRoutes.some(route => route.kind === 'block') ? [en
        ? 'Blocking lines are drawn on this flag diagram. They are not a legal blocking assignment under standard non-contact flag rules.'
        : '这张腰旗图上含有阻挡线；它们不代表标准非接触式腰旗规则允许的阻挡任务。'] : []),
    ],
  };
}
