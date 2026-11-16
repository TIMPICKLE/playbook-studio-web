import { routeCenterX } from './assistant-operations.js';
import { routeBreak } from './assistant-schema.js';
import { getPlayLeague, isFlag5Play } from './game-formats.js';

const equal = (left, right) => JSON.stringify(left) === JSON.stringify(right);

// Proposals may be regenerated after unrelated edits. Objects read or changed by
// the proposal remain dependencies, including a block target's live assignment.
export function proposalConflicts(before, current, operations, proposal) {
  if (before.id !== current.id || before.book !== current.book || !equal(before.reference, current.reference)) return true;
  // Even an untouched opponent can have a different assignment when the play's
  // format changes. Formation replacement intentionally preserves those IDs.
  if (getPlayLeague(before) !== getPlayLeague(current) || isFlag5Play(before) !== isFlag5Play(current)) return true;
  const players = new Set();
  const routes = new Set();
  let usesBall = false;
  for (const operation of operations) {
    if (['play_mirror','formation_apply','opponents_set','line_space','personnel_apply'].includes(operation.kind) && !equal(before,current)) return true;
    if (operation.kind === 'play_update') for (const key of Object.keys(operation.patch)) if (!equal(before[key],current[key])) return true;
    if (operation.kind === 'ball_update') usesBall = true;
    for (const [field,type] of [['zoneId','zones'],['annotationId','annotations']]) {
      if (operation[field] && !operation[field].startsWith('$') && !equal(before[type].find(item => item.id === operation[field]),current[type].find(item => item.id === operation[field]))) return true;
    }
    if (operation.kind === 'object_remove' && !operation.objectId.startsWith('$')) {
      const type={player:'players',route:'routes',zone:'zones',annotation:'annotations'}[operation.objectType];
      if (!equal(before[type].find(item => item.id === operation.objectId),current[type].find(item => item.id === operation.objectId))) return true;
      if (operation.objectType === 'player') {
        players.add(operation.objectId);
        const dependent = play => play.routes.filter(route => route.blockTargets?.includes(operation.objectId));
        if (!equal(dependent(before),dependent(current))) return true;
        if ([before.ball.holderId,before.ball.receiverId,current.ball.holderId,current.ball.receiverId].includes(operation.objectId)) usesBall = true;
      }
      if (operation.objectType === 'route') routes.add(operation.objectId);
    }
    if (operation.kind === 'defense_formation') {
      const defense = play => play.players.filter(player => player.side === 'defense');
      if (!equal(defense(before), defense(current))) return true;
      if (current.players.filter(player => player.side !== 'defense').length + 11 > 40) return true;
      if (operation.mode === 'reset') {
        const ids = new Set(defense(before).map(player => player.id));
        const affectedRoutes = play => play.routes.filter(route => ids.has(route.playerId) || route.blockTargets?.some(id => ids.has(id)));
        if (!equal(affectedRoutes(before), affectedRoutes(current))) return true;
        if ([before.ball.holderId, before.ball.receiverId, current.ball.holderId, current.ball.receiverId].some(id => ids.has(id))) usesBall = true;
      }
    }
    for (const id of [operation.playerId, operation.nearId, operation.receiverId, ...(operation.playerIds || []), ...(operation.targetIds || [])]) if (id && !id.startsWith('$')) players.add(id);
    if (operation.routeId && !operation.routeId.startsWith('$')) routes.add(operation.routeId);
    if (operation.kind === 'route' && operation.concept && routeBreak(operation) !== 'straight' &&
        routeCenterX(before.players) !== routeCenterX(current.players)) return true;
    if (operation.kind === 'pass') { usesBall = true; players.add(before.ball.holderId); }
  }
  for (const route of proposal.play.routes) {
    if (!proposal.routeIds.includes(route.id)) continue;
    for (const id of route.blockTargets || []) if (id && before.players.some(player => player.id === id)) players.add(id);
  }
  for (const id of players) {
    const original = before.players.find(player => player.id === id);
    const latest = current.players.find(player => player.id === id);
    if (!original || !latest || !equal(original, latest)) return true;
    if (!equal(before.routes.filter(route => route.playerId === id), current.routes.filter(route => route.playerId === id))) return true;
  }
  for (const id of routes) {
    if (!equal(before.routes.find(route => route.id === id), current.routes.find(route => route.id === id))) return true;
  }
  return usesBall && !equal(before.ball, current.ball);
}
