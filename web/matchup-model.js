// Presentation-only orientation; it never mutates or saves the original play.
export function orientDefense(play, mirror = false) {
  if (!play || !mirror || play.reference) return play;
  return {
    ...play,
    players: play.players.map(p => ({ ...p, x: 100 - p.x })),
    routes: play.routes.map(r => ({ ...r, points: r.points.map(p => ({ ...p, x: 100 - p.x })) })),
    zones: play.zones.map(z => ({ ...z, x: 100 - z.x })),
    annotations: play.annotations.map(a => ({ ...a, x: 100 - a.x })),
  };
}
