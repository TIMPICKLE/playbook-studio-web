// Route geometry gives approximate concepts, not verified football assignments.
function features(routes, centerX, lineY, xUnitsPerYard = 1.875, yUnitsPerYard = 2) {
  const paths = routes.filter(r => r.points.length > 1).map(r => {
    const first = r.points[0], last = r.points.at(-1);
    const deepest = Math.min(...r.points.map(point => point.y));
    return { owner: r.owner, first, last, deepest, side: first.x < centerX ? 'left' : 'right',
      endSide: last.x < centerX ? 'left' : 'right', depth: (lineY - last.y) / yUnitsPerYard };
  });
  const tags = [];
  for (const path of paths) {
    const horizontal = (path.last.x - path.first.x) / xUnitsPerYard;
    const outward = path.side === 'left' ? horizontal < -3.2 : horizontal > 3.2;
    const inward = path.side === 'left' ? horizontal > 3.2 : horizontal < -3.2;
    const returnYards = (path.last.y - path.deepest) / yUnitsPerYard;
    if (returnYards >= .4 && (lineY - path.deepest) / yUnitsPerYard >= 4) tags.push('curl');
    else if (path.depth <= 3 && Math.abs(horizontal) >= 4.3) tags.push('flat');
    else if (path.depth >= 8 && Math.abs(horizontal) <= 4.3) tags.push('vertical');
    else if (path.depth >= 4 && outward) tags.push('out');
    else if (path.depth >= 4 && inward) tags.push('in');
  }
  if (new Set(paths.filter(p => p.depth >= 8 && Math.abs(p.last.x - p.first.x) / xUnitsPerYard < 8).map(p => p.owner)).size >= 4) tags.push('four verts');
  for (const side of ['left', 'right']) {
    // Cross-field routes can join the same passing window after the snap.
    const sidePaths = paths.filter(p => p.endSide === side);
    const outside = p => side === 'left' ? p.last.x < p.first.x - 2.1 * xUnitsPerYard : p.last.x > p.first.x + 2.1 * xUnitsPerYard;
    // A flood can use a vertical clear-out with the intermediate route
    // breaking outside, or a deep corner with a separate intermediate route.
    // Require three distinct routes at short, intermediate and deep levels.
    const shallow = sidePaths.filter(p => p.depth >= -2 && p.depth <= 5);
    const middle = sidePaths.filter(p => p.depth >= 7 && p.depth < 14);
    const deep = sidePaths.filter(p => p.depth >= 14);
    if (shallow.some(short => middle.some(intermediate => deep.some(long =>
      new Set([short.owner, intermediate.owner, long.owner]).size === 3 && (outside(intermediate) || outside(long)))))) tags.push('flood');
    if (sidePaths.some(short => short.depth >= 0 && short.depth <= 7.5 && Math.abs(short.last.x - short.first.x) / xUnitsPerYard <= 8.5 &&
        sidePaths.some(long => long.owner !== short.owner && long.depth >= 7.5 && outside(long)))) tags.push('smash');
  }
  const crossing = paths.filter(p => (p.first.x - centerX) * (p.last.x - centerX) < 0 && p.depth <= 9);
  if (crossing.some(p => p.side === 'left') && crossing.some(p => p.side === 'right')) tags.push('mesh');
  return [...new Set(tags)];
}

export function traceConceptTags(trace) {
  const los = trace.coordinateSystem.lineOfScrimmageY;
  const center = trace.players.find(p => p.label === 'C')?.at[0] ?? trace.coordinateSystem.width / 2;
  const routes = trace.routes.filter(r => r.kind === 'route' && !r.optional).map(r => ({
    owner: r.owner, points: r.points.map(([x, y]) => ({ x: (x - 10) / 534 * 100, y: 67 + (y - los) * .2375 }))
  }));
  return features(routes, (center - 10) / 534 * 100, 67);
}

export function boardConceptTags(board) {
  const players = board.players || [];
  const center = players.find(p => p.label === 'C' && p.side === 'offense')?.x ?? 50;
  const offense = new Set(players.filter(p => p.side === 'offense').map(p => p.id));
  const routes = (board.routes || []).filter(r => r.kind === 'route' && !r.optional && offense.has(r.playerId))
    .map(r => ({ ...r, owner: r.playerId }));
  return features(routes, center, board.geometry?.losY ?? board.losY ?? 67,
    board.geometry?.xUnitsPerYard ?? 1.875, board.geometry?.yUnitsPerYard ?? 2);
}
