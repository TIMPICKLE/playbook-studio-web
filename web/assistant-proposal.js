import { buildOperations, measuredRouteBreak, routeDepthYards } from './assistant-operations.js';
import { validatePlay } from './model.js';
import { parseBoardOperations } from './assistant-schema.js';

const round = value => Math.round(value * 100) / 100;
const labels = {
  en: { route: 'route', block: 'block', motion: 'motion', move_player: 'move', pass: 'pass', zone: 'zone', timing: 'timing', remove_route: 'remove route', annotate: 'note', inside: 'inside', outside: 'outside', left: 'left', right: 'right', straight: 'straight', yards: 'yd', breakDepth: 'break depth', endDepth: 'end depth', at: 'at', duration: 'duration', delay: 'delay', to: 'to' },
  'zh-CN': { route: '路线', block: '阻挡', motion: '预动', move_player: '移动站位', pass: '传球', zone: '区域', timing: '时序', remove_route: '移除路线', annotate: '标注', inside: '向内', outside: '向外', left: '向左', right: '向右', straight: '直线', yards: '码', breakDepth: '折点深度', endDepth: '终点深度', at: '位置', duration: '时长', delay: '延迟', to: '至' },
};
const boundaryText = {
  en: { depth: (requested, actual) => `Field boundary adjusted the requested ${requested} yd depth to ${actual} yd`, points: 'Waypoints adjusted to the field boundary' },
  'zh-CN': { depth: (requested, actual) => `受球场边界限制，请求 ${requested} 码，实际 ${actual} 码`, points: '部分落点已调整至球场边界' },
};

function difference(before, after, type) {
  const originals = new Map(before[type].map(item => [item.id, JSON.stringify(item)]));
  return after[type].filter(item => originals.get(item.id) !== JSON.stringify(item)).map(item => item.id);
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().filter(key => value[key] !== undefined).map(key => [key, canonical(value[key])]));
  return value;
}

function proposalIds(play, operations) {
  const seed = JSON.stringify(canonical({ play, operations }));
  let hash = 14695981039346656037n;
  for (const character of seed) hash = BigInt.asUintN(64, (hash ^ BigInt(character.codePointAt(0))) * 1099511628211n);
  const prefix = 'proposal-' + hash.toString(36) + '-';
  const used = new Set(['players', 'routes', 'zones', 'annotations'].flatMap(type => play[type].map(item => item.id)));
  let next = 0;
  return () => {
    let id;
    do { id = prefix + next++; } while (used.has(id));
    used.add(id);
    return id;
  };
}

function routeEffect(route, centerX) {
  const first = route.points[0], pivot = route.points[1], last = route.points.at(-1);
  // A generated wheel initially breaks laterally and then runs vertically.
  const origin = route.intent || route.points.length === 2 ? first : pivot;
  const breakTo = measuredRouteBreak(origin.x, last.x, centerX);
  return { id: route.id, playerId: route.playerId, kind: route.kind,
    breakDepthYards: round(routeDepthYards(pivot.y)), endDepthYards: round(routeDepthYards(last.y)), breakTo,
    start: { ...first }, end: { ...last }, points: route.points.map(point => ({ ...point })), delay: route.delay, duration: route.duration,
    targetIds: (route.blockTargets || []).filter(Boolean) };
}

// Both Agent preview tools and the editor build a fully validated proposal here.
// The input play is never mutated and the caller retains ownership of persistence.
export function proposeEdit(play, operations, { roster = [], locale = 'zh-CN' } = {}) {
  if (play.reference) throw new Error(locale === 'en' ? 'An original diagram has no editable geometry.' : '原图战术没有可编辑坐标。');
  play = validatePlay(play);
  operations = parseBoardOperations(operations);
  const result = buildOperations(play, operations, { idFactory: proposalIds(play, operations) });
  const language = locale === 'en' ? 'en' : 'zh-CN';
  const lang = labels[language], boundary = boundaryText[language];
  const people = new Map(roster.map(person => [person.id, person]));
  const display = id => {
    const player = play.players.find(item => item.id === id) || result.play.players.find(item => item.id === id);
    const person = people.get(player?.rosterId);
    return player ? [player.label, person?.name || player.name, person?.number && '#' + person.number].filter(Boolean).join(' ') : id;
  };
  const effects = result.operationChanges.map((step, index) => {
    const operation = operations[index];
    const routes = step.routes.map(route => routeEffect(route, step.centerX));
    const playerIds = [...new Set([operation.playerId, operation.nearId, operation.receiverId, ...(operation.playerIds || []), ...step.players.map(player => player.id)].filter(Boolean))];
    const targetIds = routes.flatMap(route => route.targetIds);
    const effect = { index, kind: operation.kind, playerIds, playerLabels: playerIds.map(display),
      routeIds: [...step.routes.map(route => route.id), ...step.removedRoutes],
      zoneIds: step.zones.map(zone => zone.id), annotationIds: step.annotations.map(item => item.id),
      routes, targetIds, targetLabels: targetIds.map(display) };
    const descriptions = [effect.playerLabels.join(', '), lang[operation.kind]].filter(Boolean);
    if (operation.kind === 'route') {
      const route = routes[0];
      effect.concept = operation.concept;
      const depthPoint = operation.concept === 'slant' ? route.end : route.points[1];
      const actualDepth = routeDepthYards(depthPoint.y);
      effect.depthYards = round(actualDepth);
      effect.endDepthYards = route.endDepthYards;
      effect.breakTo = route.breakTo;
      descriptions.push(operation.concept || '');
      if (route.points.length > 2) descriptions.push(`${lang.breakDepth} ${route.breakDepthYards} ${lang.yards}`);
      descriptions.push(lang[route.breakTo], `${lang.endDepth} ${route.endDepthYards} ${lang.yards}`);
      if (operation.depthYards != null) {
        effect.requestedDepthYards = operation.depthYards;
        effect.depthLimited = operation.concept !== 'screen' && Math.abs(actualDepth - operation.depthYards) > 1e-6;
        effect.clippedAtBoundary = step.clippedAtBoundary || effect.depthLimited;
        if (effect.depthLimited) descriptions.push(boundary.depth(operation.depthYards, effect.depthYards));
        else if (effect.clippedAtBoundary) descriptions.push(boundary.points);
      }
    } else if (operation.kind === 'block') {
      effect.scheme = operation.scheme;
      descriptions.push(operation.scheme || '', operation.direction ? lang[operation.direction] : '', effect.targetLabels.join(' → '));
    } else if (operation.kind === 'motion') {
      const route = routes.find(item => item.kind === 'motion');
      descriptions.push(operation.type, lang[operation.toward], `${round((route.end.x - route.start.x) / 1.875)} ${lang.yards}`, `${lang.duration} ${route.duration}s`);
    } else if (operation.kind === 'move_player') {
      const player = step.players[0], previous = step.previousPlayers[0];
      effect.dxYards = round((player.x - previous.x) / 1.875);
      effect.dyYards = round((previous.y - player.y) / 2);
      effect.forwardYards = effect.dyYards;
      effect.start = { x: previous.x, y: previous.y };
      effect.end = { x: player.x, y: player.y };
      descriptions.push(`x ${effect.dxYards} ${lang.yards}`, `y ${effect.dyYards} ${lang.yards}`);
    } else if (operation.kind === 'timing') {
      descriptions.push(`${lang.delay} ${routes[0].delay}s`, `${lang.duration} ${routes[0].duration}s`);
    } else if (operation.kind === 'pass') {
      descriptions.unshift(display(result.play.ball.holderId));
      descriptions.push(`${operation.throwAt}s → ${operation.arriveAt}s`);
    } else if (operation.kind === 'zone') {
      effect.zones = step.zones.map(zone => ({ id: zone.id, x: zone.x, y: zone.y, rx: zone.rx, ry: zone.ry }));
      descriptions.push(operation.preset, lang[operation.side] || operation.side);
    } else if (operation.kind === 'annotate') descriptions.push(operation.text);
    effect.text = descriptions.filter(Boolean).join(' · ');
    return effect;
  });
  const removed = Object.fromEntries(['routes', 'zones', 'annotations'].map(type => [type, play[type].filter(item => !result.play[type].some(next => next.id === item.id)).map(item => item.id)]));
  const changes = effects.map(effect => effect.text);
  return { play: result.play, routeId: result.routeId, routeIds: result.routeIds,
    playerIds: difference(play, result.play, 'players'), zoneIds: difference(play, result.play, 'zones'), annotationIds: difference(play, result.play, 'annotations'),
    removed, effects, changes, summary: changes.join('\n') };
}
