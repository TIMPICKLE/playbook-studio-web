// A play marker represents a role. Only the roster link and its display name
// change when a coach applies starters from a depth chart.
export function personnelMatches(play, group, roster) {
  if (!group || group.unit !== play.book || play.reference) return [];
  // Special-teams plays normally use offensive markers for the home unit.
  // A coach can also start one from an all-defensive formation such as 4–3.
  const defenseOnly = play.book === 'special' && play.players.every(marker => marker.side === 'defense');
  const side = play.book === 'defense' || defenseOnly ? 'defense' : 'offense';
  const markers = play.players.filter(marker => marker.side === side);
  const normalized = label => label.trim().toUpperCase();
  const byId = new Map(roster.map(player => [player.id, player]));
  const matches = new Map();
  for (const slot of group.slots) {
    const player = byId.get(slot.playerIds[0]);
    if (!player) continue;
    const candidates = markers.filter(marker => normalized(marker.label) === normalized(slot.label));
    if (candidates.length === 1) matches.set(candidates[0].id, { marker: candidates[0], player });
  }
  // An unmatched teammate keeps their assignment. Remove conflicting moves
  // until every remaining replacement can be made together (including swaps).
  let previousSize;
  do {
    previousSize = matches.size;
    for (const [id, { player }] of matches) {
      if (markers.some(other => other.id !== id && other.rosterId === player.id && !matches.has(other.id))) {
        matches.delete(id);
      }
    }
  } while (matches.size !== previousSize);
  return [...matches.values()];
}

export function linkRosterPlayer(marker, player) {
  marker.name = player?.name || '';
  if (player) marker.rosterId = player.id;
  else delete marker.rosterId;
}

export function refreshRosterBindings(workspace, previousRoster) {
  const current = new Map(workspace.roster.map(player => [player.id, player]));
  const changed = new Set(previousRoster.filter(player => player.name !== current.get(player.id)?.name).map(player => player.id));
  if (!changed.size) return;
  for (const diagram of [...workspace.plays, ...workspace.formations]) {
    for (const marker of diagram.players) {
      if (!changed.has(marker.rosterId)) continue;
      const player = current.get(marker.rosterId);
      if (player) marker.name = player.name;
      else delete marker.rosterId; // Keep the historical display name on the play.
    }
  }
}
