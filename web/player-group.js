import { defaultBallHolder, preparePlayerTranslation, setBallHolder } from './model.js';

// Shared domain mutations. Both manual gestures and AI commands execute these
// against a caller-owned draft, then validate and commit the complete group.
function groupIds(play, ids) {
  if (play.reference) throw new Error('A reference diagram has no editable player coordinates.');
  if (!Array.isArray(ids) || ids.some(id => typeof id !== 'string')) throw new Error('Choose existing players before editing a group.');
  const unique=[...new Set(ids)],available=new Set(play.players.map(player=>player.id));
  if(unique.some(id=>!available.has(id)))throw new Error('A selected player is no longer on this play. Select the group again.');
  return unique;
}

export function movePlayerGroup(play, ids, dx, dy) {
  const selected=groupIds(play,ids);
  if(!Number.isFinite(dx)||!Number.isFinite(dy))throw new Error('Group movement must use finite coordinates.');
  if(!selected.length)return {ids:selected,delta:{x:0,y:0},changed:false};
  const delta = preparePlayerTranslation(play, selected)(dx, dy);
  return {ids:selected,delta,changed:!!(delta.x||delta.y)};
}

export function removePlayerGroup(play, ids) {
  const selected=groupIds(play,ids),chosen=new Set(selected);
  if(!selected.length)return {ids:selected,changed:false};
  const retained=play.players.filter(player=>!chosen.has(player.id));
  if(!retained.length)throw new Error('A play must retain at least one player.');
  play.players=retained;
  play.routes=play.routes.filter(route=>!chosen.has(route.playerId)).map(route=>route.blockTargets?{...route,blockTargets:route.blockTargets.map(target=>chosen.has(target)?null:target)}:route);
  if(chosen.has(play.ball.holderId))setBallHolder(play,defaultBallHolder(retained));
  if(chosen.has(play.ball.unconfirmedHolderId))delete play.ball.unconfirmedHolderId;
  if(chosen.has(play.ball.receiverId))play.ball.receiverId='';
  return {ids:selected,changed:true};
}
