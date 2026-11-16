import { clone, validatePlay } from './model.js';
import { movePlayerGroup, removePlayerGroup } from './player-group.js';

// Selection is device-local UI state. It never becomes part of a shared play.
export function selectedPlayerIds(play, selection) {
  const values = selection?.type === 'players' ? selection.ids : selection?.type === 'player' ? [selection.id] : [];
  const available = new Set(play?.players?.map(player => player.id));
  return [...new Set(Array.isArray(values) ? values : [])].filter(id => available.has(id));
}

export function playerSelection(play, ids) {
  const valid = selectedPlayerIds(play, { type: 'players', ids });
  return valid.length > 1 ? { type: 'players', ids: valid } : valid.length ? { type: 'player', id: valid[0] } : null;
}

export function togglePlayerSelection(play, selection, id, { additive = false } = {}) {
  if (!play?.players?.some(player => player.id === id)) return playerSelection(play, selectedPlayerIds(play, selection));
  if (!additive) return { type: 'player', id };
  const ids = selectedPlayerIds(play, selection);
  return playerSelection(play, ids.includes(id) ? ids.filter(value => value !== id) : [...ids, id]);
}

/** Build one immutable group-move result. The host records one history entry. */
export function moveSelectedPlayers(play, ids, dx, dy) {
  const next=clone(play),result=movePlayerGroup(next,ids,dx,dy);
  if(result.changed)validatePlay(next);
  return {play:result.changed?next:play,...result};
}

/** Build one group deletion using the same reference cleanup as single delete. */
export function removeSelectedPlayers(play, ids) {
  const next=clone(play),result=removePlayerGroup(next,ids);
  if(result.changed)validatePlay(next);
  return {play:result.changed?next:play,...result};
}
