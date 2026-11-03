import { uid, validatePlay } from './model.js';
import { editMessages } from './locales/assistant-edit.js';

const norm = value => String(value ?? '').normalize('NFKC').trim().toLowerCase();
const positionGroups = new Map([
  ['lb', ['ilb', 'olb', 'mlb', 'slb', 'wlb', 'm', 'w', 's', 'mike', 'will', 'sam']],
  ['dt', ['ldt', 'rdt']],
  ['wr', ['x', 'y', 'z', 'h']],
  ['de', ['le', 're']]
]);

function message(locale, key, values = {}) {
  const template = editMessages[locale === 'en' ? 'en' : 'zh-CN'][key];
  return template.replace(/\{(\w+)\}/g, (_, field) => values[field] ?? '');
}
function reject(locale, key, values) { throw new Error(message(locale, key, values)); }

export function assistantPlayers(play, roster = []) {
  const byId = new Map(roster.map(person => [person.id, person]));
  return play.players.map(({ id, label, name, side, x, y, rosterId }) => {
    const person = byId.get(rosterId);
    return { id, label, name: person?.name || name || '', number: person?.number || '', position: person?.position || label, side, x, y };
  });
}

const display = player => [player.label, player.name, player.number && '#' + player.number].filter(Boolean).join(' ');
function roleMatches(player, role) {
  if (norm(player.label) === role) return true;
  const positions = norm(player.position || player.label).split(/[/,\s]+/);
  return positions.some(position => position === role || positionGroups.get(role)?.includes(position));
}

// The agent decides which references to look up. This tool searches only markers
// on the selected play; a roster member without a marker cannot be a route target.
export function resolveBoardPlayer(players, selector) {
  const empty = status => ({ status, candidates: [] });
  if (!selector || typeof selector !== 'object' || Array.isArray(selector)) return empty('invalid');
  const fields = ['role', 'name', 'number', 'side', 'relativeToId', 'relation'];
  if (Object.entries(selector).some(([key, value]) => !fields.includes(key) || typeof value !== 'string' || !value.trim())) return empty('invalid');
  const { role, name, number, side, relativeToId, relation } = selector;
  if (!role && !name && !number && !side && !relation) return empty('invalid');
  if (side && !['offense', 'defense'].includes(side)) return empty('invalid');
  if (Boolean(relativeToId) !== Boolean(relation)) return empty('invalid');
  let candidates = players.filter(player =>
    (!role || roleMatches(player, norm(role))) &&
    (!name || norm(player.name) === norm(name)) &&
    (!number || norm(player.number) === norm(number)) &&
    (!side || player.side === side)
  );
  if (relation) {
    const anchor = players.find(player => player.id === relativeToId);
    if (!anchor || !['in_front', 'nearest', 'left_of', 'right_of'].includes(relation)) return empty('invalid');
    candidates = candidates.filter(player => player.id !== anchor.id);
    if (relation === 'in_front') candidates = candidates.filter(player =>
      anchor.side === 'offense' ? player.y < anchor.y : player.y > anchor.y);
    if (relation === 'left_of') candidates = candidates.filter(player => player.x < anchor.x);
    if (relation === 'right_of') candidates = candidates.filter(player => player.x > anchor.x);
    if (relation === 'in_front' || relation === 'nearest') {
      const distance = player => Math.hypot((player.x - anchor.x) * 9.64, (player.y - anchor.y) * 7.6);
      const nearest = Math.min(...candidates.map(distance));
      candidates = candidates.filter(player => Math.abs(distance(player) - nearest) < .01);
    }
  }
  if (!candidates.length) return empty('missing');
  return { status: candidates.length === 1 ? 'found' : 'ambiguous', candidates };
}

const coordinate = value => Number.isFinite(value) && value >= 0 && value <= 100;
const location = player => ({ x: player.x, y: player.y });

function contactPoint(from, defender) {
  // Leave room for both markers so the assignment remains visible at contact.
  const dx = (from.x - defender.x) * 9.64, dy = (from.y - defender.y) * 7.6;
  const distance = Math.hypot(dx, dy);
  const offset = distance ? Math.min(28 / distance, 0.5) : 0;
  return { x: defender.x + (from.x - defender.x) * offset, y: defender.y + (from.y - defender.y) * offset };
}

export function buildAssistantEdit(play, roster, operation, locale = 'zh-CN') {
  if (play.reference) reject(locale, 'reference');
  if (!['block', 'route'].includes(operation?.kind)) reject(locale, 'operation');
  const players = assistantPlayers(play, roster);
  const actor = players.find(p => p.id === operation.playerId);
  if (!actor) reject(locale, 'missing', { ref: operation.playerId });
  const owned = play.routes.filter(r => r.playerId === actor.id && !r.optional && r.kind !== 'pass');
  if (owned.some(r => r.kind === 'motion')) reject(locale, 'motion');
  const blocking = operation.kind === 'block';
  const points = [location(actor)];
  let summary;
  if (blocking) {
    const ids = operation.targetIds;
    if (!Array.isArray(ids) || !ids.length || ids.length > 6 || new Set(ids).size !== ids.length) reject(locale, 'targets');
    const targets = ids.map(id => players.find(player => player.id === id && player.side !== actor.side));
    if (targets.some(p => !p)) reject(locale, 'targets');
    for (const target of targets) points.push(contactPoint(points.at(-1), target));
    summary = message(locale, 'block', { actor: display(actor), targets: targets.map(display).join(' → ') });
  } else {
    const waypoints = operation.points;
    if (!Array.isArray(waypoints) || !waypoints.length || waypoints.length > 32 ||
      !waypoints.every(p => p && coordinate(p.x) && coordinate(p.y))) reject(locale, 'points');
    points.push(...waypoints.map(location));
    summary = message(locale, 'route', { actor: display(actor), count: waypoints.length });
  }
  const old = owned.find(r => r.kind === 'route') || owned[0];
  if (!old && play.routes.length >= 100) reject(locale, 'limit');
  const route = {
    id: old?.id || uid(), playerId: actor.id, kind: operation.kind, points,
    color: old?.color || play.players.find(p => p.id === actor.id).color,
    delay: old?.delay || 0, duration: old?.duration || (blocking ? Math.min(10, (points.length - 1) * 2) : 4),
    endCap: blocking ? 'bar' : 'arrow', smooth: false, optional: false,
    ...(blocking && points.length > 2 ? { stagedBlock: true } : {})
  };
  const routes = play.routes.map(existing => {
    if (existing === old) return route;
    return owned.includes(existing) ? { ...existing, optional: true } : existing;
  });
  if (!old) routes.push(route);
  return { play: validatePlay({ ...play, routes }), routeId: route.id, summary };
}
