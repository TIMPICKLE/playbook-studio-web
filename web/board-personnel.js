// A play marker represents a role. Only the roster link and its display name
// change when a coach applies starters from a depth chart.
function assignmentPlan(play, group, roster, includeVacancies) {
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
    if (group.slots.filter(other => normalized(other.label) === normalized(slot.label)).length !== 1) continue;
    const player = byId.get(slot.playerIds[0]);
    const vacant = !slot.playerIds.length || slot.playerIds[0] === null;
    if (!player && (!includeVacancies || !vacant)) continue;
    const candidates = markers.filter(marker => normalized(marker.label) === normalized(slot.label));
    if (candidates.length === 1 && (player || candidates[0].rosterId)) matches.set(candidates[0].id, { marker: candidates[0], player: player || null });
  }
  // An unmatched teammate keeps their assignment. Remove conflicting moves
  // until every remaining replacement can be made together (including swaps).
  let previousSize;
  do {
    previousSize = matches.size;
    for (const [id, { player }] of matches) {
      if (!player) continue;
      if (markers.some(other => other.id !== id && other.rosterId === player.id && !matches.has(other.id))) {
        matches.delete(id);
      }
    }
  } while (matches.size !== previousSize);
  return [...matches.values()];
}

// The legacy matcher reports occupied starters only. Full application also
// releases explicitly vacant, uniquely mapped roles in the same transaction.
export const personnelMatches = (play, group, roster) => assignmentPlan(play, group, roster, false);
export const personnelAssignments = (play, group, roster) => assignmentPlan(play, group, roster, true);

export function linkRosterPlayer(marker, player) {
  marker.name = player?.name || '';
  if (player) marker.rosterId = player.id;
  else delete marker.rosterId;
}

export function refreshRosterBindings(workspace, previousRoster, roster = workspace.roster) {
  const current = new Map(roster.map(player => [player.id, player]));
  const changed = new Map(previousRoster.filter(player => player.name !== current.get(player.id)?.name)
    .map(player => [player.id, player.name]));
  if (!changed.size) return;
  for (const diagram of [...workspace.plays, ...workspace.formations]) {
    for (const marker of diagram.players) {
      if (!changed.has(marker.rosterId)) continue;
      const player = current.get(marker.rosterId);
      marker.name = player?.name ?? changed.get(marker.rosterId);
      if (!player) delete marker.rosterId; // Keep the last display name even on a historical diagram.
    }
  }
}
