import { uid, validatePlay } from './model.js';
import { parseBoardOperations, routeBreak } from './assistant-schema.js';

const YARDS_X = 100 / 53.333333;
const YARDS_Y = 2;
const SCRIMMAGE_Y = 67;
const BREAK_TOLERANCE = .01;
const field = n => Math.max(0, Math.min(100, n));
const point = (x, y) => ({ x: field(x), y: field(y) });
const position = p => ({ x: p.x, y: p.y });
const fail = reason => { throw new Error(reason); };
const actorFor = (play, id) => play.players.find(p => p.id === id) || fail('Player not found on this play.');
const active = (play, id, kind) => play.routes.find(r => r.playerId === id && r.kind === kind && !r.optional);
const primary = (play, id) => play.routes.find(r => r.playerId === id && ['route', 'block'].includes(r.kind) && !r.optional);

export function routeCenterX(players) {
  const centers = players.filter(player => player.side === 'offense' && /^(c|center)$/i.test(player.label.trim()));
  return centers.length === 1 ? centers[0].x : 50;
}
export const routeDepthYards = y => (SCRIMMAGE_Y - y) / YARDS_Y;
export function measuredRouteBreak(originX, endX, centerX) {
  const dx = endX - originX, centerOffset = centerX - originX;
  if (Math.abs(dx) < BREAK_TOLERANCE) return 'straight';
  if (Math.abs(centerOffset) < BREAK_TOLERANCE) return dx < 0 ? 'left' : 'right';
  return dx * centerOffset > 0 ? 'inside' : 'outside';
}
function translateRouteTo(route, anchor) {
  const dx = anchor.x - route.points[0].x, dy = anchor.y - route.points[0].y;
  const translated = route.points.map(p => ({x: p.x + dx, y: p.y + dy}));
  if (translated.some(p => p.x < 0 || p.x > 100 || p.y < 0 || p.y > 100)) fail('Moving the route would put a waypoint outside the field.');
  route.points = translated;
  if (Math.abs(dx) > .01 || Math.abs(dy) > .01) delete route.intent;
}
function selectedRoute(play, op, kinds = ['route', 'block']) {
  if (!op.routeId) return primary(play, op.playerId);
  const route = play.routes.find(item => item.id === op.routeId);
  if (!route || route.playerId !== op.playerId || !kinds.includes(route.kind)) fail('The selected route does not belong to this player.');
  return route;
}
function upsert(play, route, old) {
  if (!old && play.routes.length >= 100) fail('Route limit reached.');
  if (old) play.routes[play.routes.indexOf(old)] = route;
  else play.routes.push(route);
}
function contact(from, target) {
  const dx = (from.x - target.x) * 9.64, dy = (from.y - target.y) * 7.6;
  const d = Math.hypot(dx, dy), ratio = d ? Math.min(28 / d, .5) : 0;
  return point(target.x + (from.x - target.x) * ratio, target.y + (from.y - target.y) * ratio);
}
function baseRoute(actor, old, kind, points, motion, makeId) {
  return { id: old?.id || makeId(), playerId: actor.id, kind, points, color: old?.color || actor.color,
    delay: Math.max(old?.delay || 0, motion ? motion.delay + motion.duration : 0),
    duration: old?.duration || 4, endCap: kind === 'block' ? 'bar' : 'arrow', smooth: false, optional: false };
}
function routePoints(centerX, op, start) {
  if (Array.isArray(op.points)) {
    return [start, ...op.points.map(position)];
  }
  const centerOffset = centerX - start.x;
  if (op.breakTo && Math.abs(centerOffset) < BREAK_TOLERANCE)
    fail('The route starts on the center line. Use waypoints to specify a left or right break.');
  const inside = centerOffset > 0 ? 1 : -1;
  const side = routeBreak(op) === 'outside' ? -inside : inside;
  const requestedDepth = SCRIMMAGE_Y - op.depthYards * YARDS_Y;
  const depth = field(requestedDepth);
  const breakPoint = { x: start.x, y: requestedDepth };
  const end = (dx, dy) => ({ x: start.x + dx * YARDS_X, y: depth + dy * YARDS_Y });
  switch (op.concept) {
    case 'go': case 'seam': return [start, breakPoint];
    case 'fade': return [start, end(side * 4, 0)];
    case 'slant': return [start, { x: start.x, y: SCRIMMAGE_Y - 3 * YARDS_Y }, end(side * 6, 0)];
    case 'out': case 'corner': return [start, breakPoint, end(side * 8, op.concept === 'corner' ? -5 : 0)];
    case 'in': case 'dig': case 'drag': return [start, breakPoint, end(side * 8, 0)];
    case 'post': return [start, breakPoint, end(side * 8, -7)];
    case 'curl': case 'hitch': case 'comeback': return [start, breakPoint, end(op.concept === 'comeback' ? side * 3 : 0, 2)];
    case 'flat': return [start, end(side * 8, 0)];
    case 'wheel': return [start, end(side * 6, 0), end(side * 6, -8)];
    case 'screen': return [start, { x: start.x + side * 4 * YARDS_X, y: start.y + 2 * YARDS_Y }];
  }
}
function run(play, op, makeId) {
  if (op.kind === 'block' && Array.isArray(op.playerIds)) {
    if (new Set(op.playerIds).size !== op.playerIds.length) fail('Invalid blocking scheme.');
    const assigned = new Set();
    for (const id of op.playerIds) {
      const p = actorFor(play, id), dir = op.direction === 'left' ? -1 : 1;
      const defenders = play.players.filter(d => d.side !== p.side && !assigned.has(d.id));
      // The assignment uses the diagram geometry as a transparent approximation.
      // Zone favors the play side, gap favors the near inside gap, and pass
      // protection favors the defender directly across the line of scrimmage.
      const score = d => {
        const dx = d.x - p.x, dy = Math.abs(d.y - p.y);
        if (op.scheme === 'zone') return Math.hypot(dx - dir * 6, dy) + (dir * dx < 0 ? 12 : 0);
        if (op.scheme === 'gap') return Math.hypot(dx + dir * 3, dy) + (dir * dx > 0 ? 8 : 0);
        return Math.abs(dx) * 2 + dy;
      };
      defenders.sort((a, b) => score(a) - score(b));
      const target = defenders[0];
      if (target) {
        assigned.add(target.id);
        if (op.scheme === 'pass_pro') {
          const old = primary(play, id), motion = active(play, id, 'motion');
          const start = motion ? position(motion.points.at(-1)) : position(p);
          const setback = point(start.x, start.y + 2 * YARDS_Y);
          const route = baseRoute(p, old, 'block', [start, setback, contact(setback, target)], motion, makeId);
          route.blockTargets = [null, target.id];
          upsert(play, route, old);
        } else run(play, { kind: 'block', playerId:id, targetIds:[target.id] }, makeId);
      } else {
        const old = primary(play, id), motion = active(play, id, 'motion');
        const start = motion ? position(motion.points.at(-1)) : position(p);
        const forward = op.scheme === 'pass_pro' ? 1 : -1;
        const lateral = op.scheme === 'gap' ? -dir : op.scheme === 'pass_pro' ? 0 : dir;
        const route = baseRoute(p, old, 'block', [start, point(start.x + lateral * 2 * YARDS_X, start.y + forward * 2 * YARDS_Y)], motion, makeId);
        upsert(play, route, old);
      }
    }
    return;
  }
  const actor = op.kind === 'zone' && !op.playerId ? null : actorFor(play, op.playerId || op.nearId || op.receiverId);
  if (op.kind === 'route' || op.kind === 'block') {
    const motion = active(play, actor.id, 'motion'), old = selectedRoute(play, op);
    const start = motion ? position(motion.points.at(-1)) : position(actor);
    let points, targets, clippedAtBoundary = false;
    if (op.kind === 'route') {
      const requested = routePoints(routeCenterX(play.players), op, start);
      clippedAtBoundary = requested.some(({x, y}) => x < 0 || x > 100 || y < 0 || y > 100);
      points = requested.map(({x, y}) => point(x, y));
    }
    else {
      const ids = op.targetIds;
      if (new Set(ids).size !== ids.length) fail('Invalid block targets.');
      targets = ids.map(id => actorFor(play, id));
      if (targets.some(p => p.side === actor.side)) fail('Block targets must be opponents.');
      points = [start];
      for (const target of targets) points.push(contact(points.at(-1), target));
    }
    const route = baseRoute(actor, old, op.kind, points, motion, makeId);
    if (op.kind === 'route' && !op.points) route.intent = { concept: op.concept, depthYards: op.depthYards, ...(op.breakTo ? { breakTo: op.breakTo } : {}) };
    if (targets) { route.blockTargets = targets.map(p => p.id); if (targets.length > 1) route.stagedBlock = true; }
    upsert(play, route, old);
    return { routeId: route.id, clippedAtBoundary };
  }
  if (op.kind === 'motion') {
    const old = op.routeId ? selectedRoute(play, op, ['motion']) : active(play, actor.id, 'motion');
    const dir = op.toward === 'left' ? -1 : 1;
    const targetX = field(actor.x + dir * (op.type === 'shift' ? 5 : 15) * YARDS_X);
    const start = position(actor);
    // Jet moves laterally, orbit arcs behind the formation, across crosses at
    // the player's current depth, and a shift is a short alignment change.
    const points = op.type === 'orbit'
      ? [start, point(actor.x + dir * 4 * YARDS_X, actor.y + 4 * YARDS_Y), point(targetX, actor.y + 2 * YARDS_Y)]
      : op.type === 'jet'
        ? [start, point(actor.x + dir * 3 * YARDS_X, actor.y + 2 * YARDS_Y), point(targetX, actor.y + 2 * YARDS_Y)]
        : [start, point(targetX, actor.y)];
    const route = baseRoute(actor, old, 'motion', points, undefined, makeId); route.delay = 0; route.duration = op.type === 'shift' ? 1 : 2;
    upsert(play, route, old);
    const next = primary(play, actor.id);
    if (next) {
      translateRouteTo(next, points.at(-1));
      const previousMotionEnd = old ? old.delay + old.duration : 0;
      next.delay = Math.max(0, next.delay - previousMotionEnd) + route.delay + route.duration;
    }
    return { routeId: route.id };
  }
  if (op.kind === 'move_player') {
    let dx = op.dxYards ?? 0, dy = op.dyYards ?? 0;
    if (op.alignment) {
      const target = {wide: actor.x < 50 ? 12 : 88, slot: actor.x < 50 ? 27 : 73, tight: actor.x < 50 ? 35 : 65, off: actor.x}[op.alignment];
      dx = (target - actor.x) / YARDS_X; dy = op.alignment === 'off' ? -2 : 0;
    }
    const old = position(actor); actor.x = field(actor.x + dx * YARDS_X); actor.y = field(actor.y - dy * YARDS_Y);
    for (const r of play.routes.filter(r => r.playerId === actor.id)) {
      r.points = r.points.map(p => point(p.x + actor.x - old.x, p.y + actor.y - old.y));
      delete r.intent;
    }
    return;
  }
  if (op.kind === 'timing') {
    const r = selectedRoute(play, op, ['route', 'block', 'motion']); if (!r) fail('No active route.');
    r.delay = op.delay; r.duration = op.duration; return { routeId: r.id };
  }
  if (op.kind === 'remove_route') {
    const r = selectedRoute(play, op, ['route', 'block', 'motion']);
    if (!r) fail('No active route.');
    play.routes.splice(play.routes.indexOf(r), 1);
    if (r.kind === 'motion') {
      const motionEnd = r.points.at(-1);
      for (const route of play.routes.filter(item => item.playerId === actor.id && item.kind !== 'motion')) {
        if (Math.hypot(route.points[0].x - motionEnd.x, route.points[0].y - motionEnd.y) > .01) continue;
        translateRouteTo(route, actor);
        route.delay = Math.max(0, route.delay - r.delay - r.duration);
      }
    }
    return;
  }
  if (op.kind === 'annotate') { play.annotations.push({id:makeId(),x:field(actor.x + 3),y:field(actor.y - 3),text:op.text}); return; }
  if (op.kind === 'pass') {
    if (op.arriveAt <= op.throwAt) fail('Invalid pass timing.');
    const holder = actorFor(play, play.ball.holderId); play.ball.receiverId = actor.id; play.ball.passAt = op.throwAt; play.ball.arriveAt = op.arriveAt;
    const old = op.routeId ? selectedRoute(play, {...op, playerId:holder.id}, ['pass']) : active(play, holder.id, 'pass');
    const route = baseRoute(holder, old, 'pass', [position(holder),position(actor)], undefined, makeId);
    route.delay = op.throwAt; route.duration = Math.min(10, op.arriveAt-op.throwAt); upsert(play,route,old); return { routeId: route.id };
  }
  if (op.kind === 'zone') {
    const presets = {deep_third:[16,12,'DEEP ⅓'],deep_half:[24,12,'DEEP ½'],flat:[12,8,'FLAT'],hook_curl:[12,10,'HOOK CURL'],curl_flat:[14,10,'CURL FLAT'],middle_hole:[12,10,'MIDDLE HOLE']};
    const [rx,ry,label] = presets[op.preset], deep = op.preset.startsWith('deep');
    const center = {x:op.side === 'left' ? 20 : op.side === 'right' ? 80 : 50,y:deep ? 28 : 49};
    play.zones.push({id:makeId(),...center,rx,ry,label,color:'#88bfff'});
    if (op.playerId) return run(play,{kind:'route',playerId:actor.id,points:[center]}, makeId);
    return;
  }
  fail('Unsupported operation.');
}
export function buildOperations(play, operations, { idFactory = uid } = {}) {
  operations = parseBoardOperations(operations);
  const copy = structuredClone(play), changed = new Set(), operationChanges = []; let routeId;
  for (const op of operations) {
    const before = Object.fromEntries(['players', 'routes', 'zones', 'annotations'].map(type =>
      [type, new Map(copy[type].map(item => [item.id, JSON.stringify(item)]))]));
    const outcome = run(copy,op,idFactory);
    routeId = outcome?.routeId || routeId;
    const step = { centerX: routeCenterX(copy.players), clippedAtBoundary: outcome?.clippedAtBoundary ?? false };
    for (const type of ['players', 'routes', 'zones', 'annotations']) {
      step[type] = structuredClone(copy[type].filter(item => before[type].get(item.id) !== JSON.stringify(item)));
      step['removed' + type[0].toUpperCase() + type.slice(1)] = [...before[type].keys()].filter(id => !copy[type].some(item => item.id === id));
    }
    for (const route of step.routes) changed.add(route.id);
    for (const id of step.removedRoutes) changed.add(id);
    step.previousPlayers = step.players.map(player => JSON.parse(before.players.get(player.id)));
    operationChanges.push(step);
  }
  return {play:validatePlay(copy),routeId,routeIds:[...changed],operationChanges};
}
