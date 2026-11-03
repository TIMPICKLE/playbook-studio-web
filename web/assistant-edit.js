import { buildOperations } from './assistant-operations.js';
import { editMessages } from './locales/assistant-edit.js';

const norm = value => String(value ?? '').normalize('NFKC').trim().toLowerCase();
const positionGroups = new Map([
  ['lb', ['ilb', 'olb', 'mlb', 'slb', 'wlb', 'm', 'w', 'mike', 'will', 'sam']],
  ['dt', ['ldt', 'rdt']],
  ['wr', ['x', 'y', 'z', 'h']],
  ['de', ['le', 're']],
  ['ol', ['lt', 'lg', 'c', 'rg', 'rt', 'center', 'guard', 'tackle']],
  ['dl', ['dt', 'ldt', 'rdt', 'de', 'le', 're', 'nt']],
  ['db', ['cb', 'lcb', 'rcb', 'fs', 'ss', 's', 'safety', 'nickel']],
  ['s', ['fs', 'ss', 'safety']],
  ['rb', ['hb', 'fb', 'tb', 'halfback', 'fullback', 'tailback']],
  ['te', ['tight end']],
  ['edge', ['de', 'le', 're', 'olb', 'edge']]
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
  const aliases = { '安全卫': 's', '进攻锋线': 'ol', '防守锋线': 'dl', '线卫': 'lb', '角卫': 'cb', '跑卫': 'rb', '外接手': 'wr', '近端锋': 'te' };
  role = aliases[role] || role;
  const positions = norm([player.position, player.label].filter(Boolean).join('/')).split(/[/,\s]+/);
  return positions.some(position => position === role || positionGroups.get(role)?.includes(position));
}
function nameMatches(value, query) {
  const tokens = norm(value).match(/[\p{L}\p{N}]+/gu) || [];
  const requested = norm(query).match(/[\p{L}\p{N}]+/gu) || [];
  return requested.length > 0 && requested.every(token => tokens.includes(token));
}
const normalizedNumber = value => norm(value).replace(/^#\s*/, '').replace(/\s*号$/, '').trim();

// The agent decides which references to look up. This tool searches only markers
// on the selected play; a roster member without a marker cannot be a route target.
export function resolveBoardPlayer(players, selector) {
  const empty = status => ({ status, candidates: [] });
  if (!selector || typeof selector !== 'object' || Array.isArray(selector)) return empty('invalid');
  const fields = ['role', 'name', 'number', 'side', 'relativeToId', 'relation', 'selectMany', 'receiverNumber', 'fieldSide'];
  if (Object.entries(selector).some(([key, value]) => !fields.includes(key) ||
    (key === 'selectMany' ? typeof value !== 'boolean' :
      key === 'receiverNumber' ? !Number.isInteger(value) || value < 1 || value > 3 :
        typeof value !== 'string' || !value.trim()))) return empty('invalid');
  const { role, name, number, side, relativeToId, relation, selectMany, receiverNumber, fieldSide } = selector;
  if (!role && !name && !number && !side && !relation) return empty('invalid');
  if (side && !['offense', 'defense'].includes(side)) return empty('invalid');
  const formationRelation = ['strong_side', 'weak_side', 'receiver_number'].includes(relation);
  if (!formationRelation && Boolean(relativeToId) !== Boolean(relation)) return empty('invalid');
  if (fieldSide && !['left', 'right'].includes(fieldSide)) return empty('invalid');
  if (relation === 'receiver_number' && (!receiverNumber || !fieldSide)) return empty('invalid');
  let candidates = players.filter(player =>
    (!role || roleMatches(player, norm(role))) &&
    (!name || nameMatches(player.name, name)) &&
    (!number || normalizedNumber(player.number) === normalizedNumber(number)) &&
    (!side || player.side === side)
  );
  if (formationRelation) {
    const centers = players.filter(player => player.side === 'offense' && roleMatches(player, 'c'));
    if (centers.length !== 1) return empty('invalid');
    const center = centers[0].x;
    const eligible = players.filter(player => player.side === 'offense' &&
      (roleMatches(player, 'wr') || roleMatches(player, 'te')) && player.x !== center);
    const left = eligible.filter(player => player.x < center);
    const right = eligible.filter(player => player.x > center);
    if (relation === 'receiver_number') {
      const ranked = [...(fieldSide === 'left' ? left : right)].sort((a, b) => Math.abs(b.x - center) - Math.abs(a.x - center));
      const receiver = ranked[receiverNumber - 1];
      if (!receiver) return empty('missing');
      if ((ranked[receiverNumber - 2] && Math.abs(ranked[receiverNumber - 2].x - receiver.x) < .01) ||
          (ranked[receiverNumber] && Math.abs(ranked[receiverNumber].x - receiver.x) < .01)) return empty('ambiguous');
      candidates = candidates.filter(player => player.id === receiver.id);
    } else {
      if (left.length === right.length) return empty('ambiguous');
      const strongIsLeft = left.length > right.length;
      const targetLeft = relation === 'strong_side' ? strongIsLeft : !strongIsLeft;
      candidates = candidates.filter(player => targetLeft ? player.x < center : player.x > center);
    }
  } else if (relation) {
    const anchor = players.find(player => player.id === relativeToId);
    if (!anchor || !['in_front', 'nearest', 'left_of', 'right_of', 'outside_of', 'inside_of', 'over'].includes(relation)) return empty('invalid');
    candidates = candidates.filter(player => player.id !== anchor.id);
    if (relation === 'in_front') candidates = candidates.filter(player =>
      anchor.side === 'offense' ? player.y < anchor.y : player.y > anchor.y);
    if (relation === 'left_of') candidates = candidates.filter(player => player.x < anchor.x);
    if (relation === 'right_of') candidates = candidates.filter(player => player.x > anchor.x);
    if (relation === 'outside_of' || relation === 'inside_of') {
      const centers = players.filter(player => player.side === 'offense' && roleMatches(player, 'c'));
      if (centers.length !== 1) return empty('invalid');
      const center = centers[0].x;
      const anchorDistance = Math.abs(anchor.x - center);
      candidates = candidates.filter(player => (player.x - center) * (anchor.x - center) > 0 &&
        (relation === 'outside_of' ? Math.abs(player.x - center) > anchorDistance : Math.abs(player.x - center) < anchorDistance));
    }
    if (relation === 'over') {
      candidates = candidates.filter(player => player.side !== anchor.side);
      const minimum = Math.min(...candidates.map(player => Math.abs(player.x - anchor.x)));
      candidates = candidates.filter(player => Math.abs(Math.abs(player.x - anchor.x) - minimum) < .01);
    }
    if (relation === 'in_front' || relation === 'nearest' || relation === 'over') {
      const distance = player => Math.hypot((player.x - anchor.x) * 9.64, (player.y - anchor.y) * 7.6);
      const nearest = Math.min(...candidates.map(distance));
      candidates = candidates.filter(player => Math.abs(distance(player) - nearest) < .01);
    }
  }
  if (!candidates.length) return empty('missing');
  return { status: candidates.length === 1 || (selectMany && !name && !number) ? 'found' : 'ambiguous', candidates };
}

// Build changes on a copy and validate only after the entire group succeeds.
export function buildAssistantEdit(play, roster, operation, locale = 'zh-CN') {
  if (play.reference) reject(locale, 'reference');
  const ops = Array.isArray(operation) ? operation : [operation];
  const result = buildOperations(play, ops);
  const players = assistantPlayers(play, roster);
  const displayId = id => display(players.find(player => player.id === id) || {label: id});
  result.summary = ops.map(op => op.kind === 'block' && Array.isArray(op.targetIds)
    ? message(locale, 'block', {actor: displayId(op.playerId), targets: op.targetIds.map(displayId).join(' → ')})
    : op.kind === 'route' ? message(locale, 'route', {actor: displayId(op.playerId), count: op.points?.length || 1})
      : `${op.kind} · ${(op.playerIds || [op.playerId || op.nearId || op.receiverId]).filter(Boolean).map(displayId).join(', ')}`).join('；');
  return result;
}
