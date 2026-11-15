import { clone, formationPlayers, uid, validatePlay } from './model.js';

/** Add a complete 4–3 front without changing the offensive play or choosing coverage. */
export function withDefense43(play, { reset = false, idFactory = uid } = {}) {
  if (play.reference) throw new Error('A reference diagram has no editable player coordinates.');
  const next = clone(play);
  const oldDefense = new Set(next.players.filter(player => player.side === 'defense').map(player => player.id));
  if (oldDefense.size && !reset) throw new Error('This play already has defenders. Explicitly request a reset to replace them.');
  const retained = next.players.filter(player => !oldDefense.has(player.id));
  if (retained.length + 11 > 40) throw new Error('Adding a full 11-player 4-3 defense would exceed 40 player markers.');

  const defenders = formationPlayers('4–3', 11, 'defense').map(player => ({ ...player, id: idFactory() }));
  next.players = [...retained, ...defenders];
  if (oldDefense.size) {
    next.routes = next.routes.filter(route => !oldDefense.has(route.playerId)).map(route => {
      if (!route.blockTargets?.some(target => oldDefense.has(target))) return route;
      // Each target belongs to one waypoint. Keep null placeholders in that order.
      return { ...route, blockTargets: route.blockTargets.map(target => oldDefense.has(target) ? null : target) };
    });
    if (oldDefense.has(next.ball.holderId)) next.ball.holderId = retained.find(player => player.side === 'offense' && player.label === 'QB')?.id || next.players[0].id;
    if (oldDefense.has(next.ball.receiverId)) next.ball.receiverId = '';
  }
  validatePlay(next);
  return next;
}
