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
    const depths = sidePaths.map(p => p.depth);
    const outside = p => side === 'left' ? p.last.x < p.first.x - 4 : p.last.x > p.first.x + 4;
    if (depths.some(d => d <= 6) && depths.some(d => d >= 10 && d < 25) && sidePaths.some(p => p.depth >= 25 && outside(p))) tags.push('flood');
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
  const center = board.players?.find(p => p.label === 'C')?.x ?? 50;
  return features((board.routes || []).filter(r => r.kind === 'route' && !r.optional), center, board.losY ?? 67);
}
