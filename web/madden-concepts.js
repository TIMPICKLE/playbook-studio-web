// Route geometry gives approximate concepts, not verified football assignments.
function features(routes, centerX, lineY) {
  const paths = routes.filter(r => r.points.length > 1).map(r => {
    const first = r.points[0], last = r.points.at(-1);
    const deepest = Math.min(...r.points.map(point => point.y));
    return { first, last, deepest, side: first.x < centerX ? 'left' : 'right', depth: lineY - last.y };
  });
  const tags = [];
  for (const path of paths) {
    const horizontal = path.last.x - path.first.x;
    const outward = path.side === 'left' ? horizontal < -6 : horizontal > 6;
    const inward = path.side === 'left' ? horizontal > 6 : horizontal < -6;
    if (path.last.y - path.deepest >= 5) tags.push('curl');
    else if (path.depth <= 6 && Math.abs(horizontal) >= 8) tags.push('flat');
    else if (path.depth >= 16 && Math.abs(horizontal) <= 8) tags.push('vertical');
    else if (path.depth >= 8 && outward) tags.push('out');
    else if (path.depth >= 8 && inward) tags.push('in');
  }
  if (paths.filter(p => p.depth >= 16 && Math.abs(p.last.x - p.first.x) < 12).length >= 4) tags.push('four verts');
  for (const side of ['left', 'right']) {
    const sidePaths = paths.filter(p => p.side === side);
    const outside = p => side === 'left' ? p.last.x < p.first.x - 4 : p.last.x > p.first.x + 4;
    // A flood can use a vertical clear-out with the intermediate route
    // breaking outside, or a deep corner with a separate intermediate route.
    // Require three distinct routes at short, intermediate and deep levels.
    const shallow = sidePaths.filter(p => p.depth >= -4 && p.depth <= 8);
    const middle = sidePaths.filter(p => p.depth >= 10 && p.depth < 25);
    const deep = sidePaths.filter(p => p.depth >= 25);
    if (shallow.length && middle.length && deep.length &&
      (middle.some(outside) || deep.some(outside)) && shallow.some(outside)) tags.push('flood');
    if (sidePaths.some(p => p.depth >= 0 && p.depth <= 8 && Math.abs(p.last.x - p.first.x) <= 12) &&
        sidePaths.some(p => p.depth >= 15 && outside(p))) tags.push('smash');
  }
  const crossing = paths.filter(p => (p.first.x - centerX) * (p.last.x - centerX) < 0 && p.depth <= 18);
  if (crossing.some(p => p.side === 'left') && crossing.some(p => p.side === 'right')) tags.push('mesh');
  return [...new Set(tags)];
}

export function traceConceptTags(trace) {
  const los = trace.coordinateSystem.lineOfScrimmageY;
  const center = trace.players.find(p => p.label === 'C')?.at[0] ?? trace.coordinateSystem.width / 2;
  const routes = trace.routes.filter(r => r.kind === 'route' && !r.optional).map(r => ({
    points: r.points.map(([x, y]) => ({ x: (x - 10) / 534 * 100, y: 67 + (y - los) * .2375 }))
  }));
  return features(routes, (center - 10) / 534 * 100, 67);
}

export function boardConceptTags(board) {
  const players = board.players || [];
  const center = players.find(p => p.label === 'C' && p.side === 'offense')?.x ?? 50;
  const offense = new Set(players.filter(p => p.side === 'offense').map(p => p.id));
  const routes = (board.routes || []).filter(r => r.kind === 'route' && !r.optional && offense.has(r.playerId));
  return features(routes, center, board.geometry?.losY ?? board.losY ?? 67);
}
