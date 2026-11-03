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
    if (!op.playerIds.length || op.playerIds.length > 11 || new Set(op.playerIds).size !== op.playerIds.length || !['zone','gap','pass_pro'].includes(op.scheme) || !['left','right'].includes(op.direction)) fail('Invalid blocking scheme.');
    const assigned = new Set();
    for (const id of op.playerIds) {
      const p = actorFor(play, id), dir = op.direction === 'left' ? -1 : 1;
      const defenders = play.players.filter(d => d.side !== p.side && !assigned.has(d.id)).sort((a,b) =>
        Math.hypot(a.x-(p.x + dir * 3),a.y-p.y)-Math.hypot(b.x-(p.x + dir * 3),b.y-p.y));
      const target = defenders.find(d => dir * (d.x - p.x) >= -3) || defenders[0];
      if (target) {
        assigned.add(target.id);
        run(play, { kind: 'block', playerId:id, targetIds:[target.id] });
      } else {
        const old = primary(play, id), motion = active(play, id, 'motion');
        const start = motion ? position(motion.points.at(-1)) : position(p);
        const forward = op.scheme === 'pass_pro' ? 1 : -1;
        const route = baseRoute(p, old, 'block', [start, point(start.x + dir * 2 * YARDS_X, start.y + forward * 2 * YARDS_Y)], motion);
        upsert(play, route, old);
      }
    }
    return;
  }
  const actor = op.kind === 'zone' && !op.playerId ? null : actorFor(play, op.playerId || op.nearId || op.receiverId);
  if (op.kind === 'route' || op.kind === 'block') {
    const motion = active(play, actor.id, 'motion'), old = primary(play, actor.id);
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
    const old = active(play, actor.id, 'motion'), dir = op.toward === 'left' ? -1 : 1;
    const width = op.type === 'shift' ? 5 : 15;
    const points = [position(actor), point(actor.x + dir * width * YARDS_X, actor.y + (op.type === 'orbit' ? 5 : 0))];
    const route = baseRoute(actor, old, 'motion', points); route.delay = 0; route.duration = op.type === 'shift' ? 1 : 2;
    upsert(play, route, old);
    const next = primary(play, actor.id);
    if (next) { next.points[0] = position(points.at(-1)); next.delay = Math.max(next.delay, route.delay + route.duration); }
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
    const r = primary(play, actor.id); if (!r) fail('No active route.');
    if (!finite(op.delay) || op.delay < 0 || op.delay > 10 || !finite(op.duration) || op.duration < .2 || op.duration > 10) fail('Invalid timing.');
    r.delay = op.delay; r.duration = op.duration; return r.id;
  }
  if (op.kind === 'remove_route') { const r = primary(play, actor.id); if (!r) fail('No active route.'); play.routes.splice(play.routes.indexOf(r), 1); return; }
  if (op.kind === 'annotate') { if (typeof op.text !== 'string' || !op.text.trim() || op.text.length > 200) fail('Invalid annotation.'); play.annotations.push({id:uid(),x:field(actor.x + 3),y:field(actor.y - 3),text:op.text.trim()}); return; }
  if (op.kind === 'pass') {
    if (!finite(op.throwAt) || !finite(op.arriveAt) || op.throwAt < 0 || op.throwAt > 10 || op.arriveAt <= op.throwAt || op.arriveAt > 15) fail('Invalid pass timing.');
    const holder = actorFor(play, play.ball.holderId); play.ball.receiverId = actor.id; play.ball.passAt = op.throwAt; play.ball.arriveAt = op.arriveAt;
    const old = active(play, holder.id, 'pass'), route = baseRoute(holder, old, 'pass', [position(holder),position(actor)]);
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
export function buildOperations(play, operations) {
  if (!Array.isArray(operations) || !operations.length || operations.length > 20) fail('Expected 1–20 operations.');
  const copy = structuredClone(play); let routeId;
  for (const op of operations) routeId = run(copy,op) || routeId;
  return {play:validatePlay(copy),routeId,summary:operations.map(op => `${op.kind} · ${op.playerId || op.nearId || (op.playerIds || []).join(', ') || op.receiverId || ''}`).join('；')};
}
