import { uid, validatePlay } from './model.js';

const YARDS_X = 100 / 53.333333;
const YARDS_Y = 2;
const field = n => Math.max(0, Math.min(100, n));
const point = (x, y) => ({ x: field(x), y: field(y) });
const position = p => ({ x: p.x, y: p.y });
const finite = n => Number.isFinite(n);
const fail = reason => { throw new Error(reason); };
const actorFor = (play, id) => play.players.find(p => p.id === id) || fail('Player not found on this play.');
const active = (play, id, kind) => play.routes.find(r => r.playerId === id && r.kind === kind && !r.optional);
const primary = (play, id) => play.routes.find(r => r.playerId === id && ['route', 'block'].includes(r.kind) && !r.optional);
function translateRouteTo(route, anchor) {
  const dx = anchor.x - route.points[0].x, dy = anchor.y - route.points[0].y;
  const translated = route.points.map(p => ({x: p.x + dx, y: p.y + dy}));
  if (translated.some(p => p.x < 0 || p.x > 100 || p.y < 0 || p.y > 100)) fail('Moving the route would put a waypoint outside the field.');
  route.points = translated;
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
function baseRoute(actor, old, kind, points, motion) {
  return { id: old?.id || uid(), playerId: actor.id, kind, points, color: old?.color || actor.color,
    delay: Math.max(old?.delay || 0, motion ? motion.delay + motion.duration : 0),
    duration: old?.duration || 4, endCap: kind === 'block' ? 'bar' : 'arrow', smooth: false, optional: false };
}
function routePoints(actor, op, start) {
  if (Array.isArray(op.points)) {
    if (!op.points.length || op.points.length > 32 || op.points.some(p => !finite(p.x) || !finite(p.y) || p.x < 0 || p.x > 100 || p.y < 0 || p.y > 100)) fail('Invalid route waypoints.');
    return [start, ...op.points.map(position)];
  }
  const known = ['slant','out','in','dig','curl','comeback','hitch','post','corner','go','fade','seam','flat','wheel','drag','screen'];
  if (!known.includes(op.concept) || !finite(op.depthYards) || op.depthYards <= 0 || op.depthYards > 40 || (op.breakTo && !['inside','outside'].includes(op.breakTo))) fail('Invalid route concept or depth.');
  const inside = start.x < 50 ? 1 : -1;
  const side = op.breakTo === 'outside' ? -inside : inside;
  const depth = field(67 - op.depthYards * YARDS_Y);
  const breakPoint = point(start.x, depth);
  const end = (dx, dy) => point(start.x + dx * YARDS_X, depth + dy * YARDS_Y);
  switch (op.concept) {
    case 'go': case 'seam': return [start, breakPoint];
    case 'fade': return [start, end(-inside * 4, 0)];
    case 'slant': return [start, point(start.x, field(67 - 3 * YARDS_Y)), end(inside * 6, 0)];
    case 'out': case 'corner': return [start, breakPoint, end(-inside * 8, op.concept === 'corner' ? -5 : 0)];
    case 'in': case 'dig': case 'drag': return [start, breakPoint, end(inside * 8, 0)];
    case 'post': return [start, breakPoint, end(inside * 8, -7)];
    case 'curl': case 'hitch': case 'comeback': return [start, breakPoint, end(op.concept === 'comeback' ? -inside * 3 : 0, 2)];
    case 'flat': return [start, end(-inside * 8, 0)];
    case 'wheel': return [start, end(-inside * 6, 0), end(-inside * 6, -8)];
    case 'screen': return [start, point(start.x + side * 4 * YARDS_X, start.y + 2 * YARDS_Y)];
  }
}
function run(play, op) {
  if (!op || typeof op !== 'object') fail('Invalid operation.');
  if (op.kind === 'block' && Array.isArray(op.playerIds)) {
    if (op.routeId) fail('A group block cannot target one route ID.');
    if (!op.playerIds.length || op.playerIds.length > 11 || new Set(op.playerIds).size !== op.playerIds.length || !['zone','gap','pass_pro'].includes(op.scheme) || !['left','right'].includes(op.direction)) fail('Invalid blocking scheme.');
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
          const route = baseRoute(p, old, 'block', [start, setback, contact(setback, target)], motion);
          route.blockTargets = [null, target.id];
          upsert(play, route, old);
        } else run(play, { kind: 'block', playerId:id, targetIds:[target.id] });
      } else {
        const old = primary(play, id), motion = active(play, id, 'motion');
        const start = motion ? position(motion.points.at(-1)) : position(p);
        const forward = op.scheme === 'pass_pro' ? 1 : -1;
        const lateral = op.scheme === 'gap' ? -dir : op.scheme === 'pass_pro' ? 0 : dir;
        const route = baseRoute(p, old, 'block', [start, point(start.x + lateral * 2 * YARDS_X, start.y + forward * 2 * YARDS_Y)], motion);
        upsert(play, route, old);
      }
    }
    return;
  }
  const actor = op.kind === 'zone' && !op.playerId ? null : actorFor(play, op.playerId || op.nearId || op.receiverId);
  if (op.kind === 'route' || op.kind === 'block') {
    const motion = active(play, actor.id, 'motion'), old = selectedRoute(play, op);
    const start = motion ? position(motion.points.at(-1)) : position(actor);
    let points, targets;
    if (op.kind === 'route') points = routePoints(actor, op, start);
    else {
      const ids = op.targetIds;
      if (!Array.isArray(ids) || !ids.length || ids.length > 6 || new Set(ids).size !== ids.length) fail('Invalid block targets.');
      targets = ids.map(id => actorFor(play, id));
      if (targets.some(p => p.side === actor.side)) fail('Block targets must be opponents.');
      points = [start];
      for (const target of targets) points.push(contact(points.at(-1), target));
    }
    const route = baseRoute(actor, old, op.kind, points, motion);
    if (targets) { route.blockTargets = targets.map(p => p.id); if (targets.length > 1) route.stagedBlock = true; }
    upsert(play, route, old);
    return route.id;
  }
  if (op.kind === 'motion') {
    if (!['jet','orbit','across','shift'].includes(op.type) || !['left','right'].includes(op.toward)) fail('Invalid motion.');
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
    const route = baseRoute(actor, old, 'motion', points); route.delay = 0; route.duration = op.type === 'shift' ? 1 : 2;
    upsert(play, route, old);
    const next = primary(play, actor.id);
    if (next) {
      translateRouteTo(next, points.at(-1));
      const previousMotionEnd = old ? old.delay + old.duration : 0;
      next.delay = Math.max(0, next.delay - previousMotionEnd) + route.delay + route.duration;
    }
    return route.id;
  }
  if (op.kind === 'move_player') {
    let dx = op.dxYards, dy = op.dyYards;
    if (op.alignment) {
      if (!['wide','slot','tight','off'].includes(op.alignment)) fail('Invalid alignment.');
      const target = {wide: actor.x < 50 ? 12 : 88, slot: actor.x < 50 ? 27 : 73, tight: actor.x < 50 ? 35 : 65, off: actor.x}[op.alignment];
      dx = (target - actor.x) / YARDS_X; dy = op.alignment === 'off' ? -2 : 0;
    }
    if (!finite(dx) || !finite(dy) || Math.abs(dx) > 53.333333 || Math.abs(dy) > 30) fail('Invalid movement.');
    const old = position(actor); actor.x = field(actor.x + dx * YARDS_X); actor.y = field(actor.y - dy * YARDS_Y);
    for (const r of play.routes.filter(r => r.playerId === actor.id)) r.points = r.points.map(p => point(p.x + actor.x - old.x, p.y + actor.y - old.y));
    return;
  }
  if (op.kind === 'timing') {
    const r = selectedRoute(play, op, ['route', 'block', 'motion']); if (!r) fail('No active route.');
    if (!finite(op.delay) || op.delay < 0 || op.delay > 10 || !finite(op.duration) || op.duration < .2 || op.duration > 10) fail('Invalid timing.');
    r.delay = op.delay; r.duration = op.duration; return r.id;
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
  if (op.kind === 'annotate') { if (typeof op.text !== 'string' || !op.text.trim() || op.text.length > 200) fail('Invalid annotation.'); play.annotations.push({id:uid(),x:field(actor.x + 3),y:field(actor.y - 3),text:op.text.trim()}); return; }
  if (op.kind === 'pass') {
    if (!finite(op.throwAt) || !finite(op.arriveAt) || op.throwAt < 0 || op.throwAt > 10 || op.arriveAt <= op.throwAt || op.arriveAt > 15) fail('Invalid pass timing.');
    const holder = actorFor(play, play.ball.holderId); play.ball.receiverId = actor.id; play.ball.passAt = op.throwAt; play.ball.arriveAt = op.arriveAt;
    const old = op.routeId ? selectedRoute(play, {...op, playerId:holder.id}, ['pass']) : active(play, holder.id, 'pass');
    const route = baseRoute(holder, old, 'pass', [position(holder),position(actor)]);
    route.delay = op.throwAt; route.duration = Math.min(10, op.arriveAt-op.throwAt); upsert(play,route,old); return route.id;
  }
  if (op.kind === 'zone') {
    const presets = {deep_third:[16,12,'DEEP ⅓'],deep_half:[24,12,'DEEP ½'],flat:[12,8,'FLAT'],hook_curl:[12,10,'HOOK CURL'],curl_flat:[14,10,'CURL FLAT'],middle_hole:[12,10,'MIDDLE HOLE']};
    if (!presets[op.preset] || !['left','middle','right'].includes(op.side)) fail('Invalid zone.');
    const [rx,ry,label] = presets[op.preset], deep = op.preset.startsWith('deep');
    const center = {x:op.side === 'left' ? 20 : op.side === 'right' ? 80 : 50,y:deep ? 28 : 49};
    play.zones.push({id:uid(),...center,rx,ry,label,color:'#88bfff'});
    if (op.playerId) return run(play,{kind:'route',playerId:actor.id,points:[center]});
    return;
  }
  fail('Unsupported operation.');
}
export function buildOperations(play, operations, {dryRun = false} = {}) {
  if (!Array.isArray(operations) || !operations.length || operations.length > 20) fail('Expected 1–20 operations.');
  const copy = structuredClone(play), changed = new Set(); let routeId;
  for (const op of operations) {
    const before = new Map(copy.routes.map(route => [route.id, JSON.stringify(route)]));
    routeId = run(copy,op) || routeId;
    for (const route of copy.routes) if (before.get(route.id) !== JSON.stringify(route)) changed.add(route.id);
  }
  return {play:dryRun ? copy : validatePlay(copy),routeId,routeIds:[...changed],summary:operations.map(op => `${op.kind} · ${op.playerId || op.nearId || (op.playerIds || []).join(', ') || op.receiverId || ''}`).join('；')};
}
