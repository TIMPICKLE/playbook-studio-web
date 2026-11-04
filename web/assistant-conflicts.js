const equal = (left, right) => JSON.stringify(left) === JSON.stringify(right);

// Proposals may be regenerated after unrelated edits. Objects read or changed by
// the proposal remain dependencies, including a block target's live assignment.
export function proposalConflicts(before, current, operations, proposal) {
  if (before.id !== current.id || before.book !== current.book || !equal(before.reference, current.reference)) return true;
  const players = new Set();
  const routes = new Set();
  let usesBall = false;
  for (const operation of operations) {
    for (const id of [operation.playerId, operation.nearId, operation.receiverId, ...(operation.playerIds || []), ...(operation.targetIds || [])]) if (id) players.add(id);
    if (operation.routeId) routes.add(operation.routeId);
    if (operation.kind === 'pass') { usesBall = true; players.add(before.ball.holderId); }
  }
  for (const route of proposal.play.routes) {
    if (!proposal.routeIds.includes(route.id)) continue;
    for (const id of route.blockTargets || []) if (id) players.add(id);
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
