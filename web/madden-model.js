import { EDITABLE_TRACES } from './data/madden-editable.js';
import { RETAINED_REASONS } from './data/madden-trace-status.js';
import { uid } from './model.js';

export const editableTraceCount = Object.keys(EDITABLE_TRACES).length;
export const retainedReason = id => RETAINED_REASONS[id] || '尚未确认可编辑路线';
export const hasEditableTrace = id => Object.hasOwn(EDITABLE_TRACES, id);
export const getEditableEntry = id => hasEditableTrace(id) ? EDITABLE_TRACES[id] : null;
export const MADDEN_DRAG_TYPE = 'application/x-playbook-madden';
export function filterCatalog(catalog, { team = 'eagles', group = '', formation = '', query = '', editableOnly = false } = {}) {
  const terms = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  return catalog.plays.filter(p => p.team === team && (!editableOnly || hasEditableTrace(p.id)) && (!group || p.group === group) && (!formation || `${p.group} ${p.formation}` === formation) && terms.every(term => `${p.name} ${p.group} ${p.formation}`.toLowerCase().includes(term)));
}
export function makeMaddenPlay(entry) {
  const trace = getEditableEntry(entry.id);
  if (trace) return makeTracedPlay(entry, trace);
  return {
    id: uid(), title: entry.name, book: 'offense', formation: `${entry.group} ${entry.formation}`,
    category: 'Madden 原图', personnel: `${entry.team === 'eagles' ? 'Eagles' : 'Ravens'} · ${entry.game}`,
    notes: '', favorite: false, players: [], routes: [], zones: [], annotations: [],
    ball: { holderId: '', receiverId: '', passAt: 2, arriveAt: 3 }, createdAt: new Date().toISOString(),
    reference: { provider: 'huddle.gg', catalogId: entry.id, team: entry.team, game: entry.game, sourceUrl: entry.sourceUrl, image: entry.image },
  };
}

const INKS = { yellow: '#e3df79', red: '#ef4866', blue: '#69a1ff', white: '#dddddd' };

// Madden's small original markers are packed more tightly than the editor's
// larger pieces. Widen the five linemen without silently replacing a saved
// formation. A nearby eligible player only moves when the wider line would
// otherwise overlap it. Returns a reason without changing an unsafe layout.
export function spaceMaddenLine(play) {
  if (!play.diagramSource) return { changed: false, reason: 'not-madden' };
  const names = ['LT', 'LG', 'C', 'RG', 'RT'];
  const linemen = names.map(label => play.players.filter(p => p.side === 'offense' && p.label === label));
  if (linemen.some(matches => matches.length !== 1)) return { changed: false, reason: 'missing-line' };
  const line = linemen.map(matches => matches[0]);
  const lineIds = new Set(line.map(p => p.id));
  const center = linemen[2][0];
  // Screen dimensions of the field are 964 × 760; the flat player radius is 17.
  // A two-pixel margin avoids touching while leaving intentionally stacked
  // players in different rows where there is sufficient vertical separation.
  const nearby = play.players.filter(p => p.side === 'offense' && (lineIds.has(p.id) || Math.abs(p.y - center.y) < 36 / 7.6));
  nearby.sort((a, b) => a.x - b.x || (a.id === center.id ? -1 : b.id === center.id ? 1 : 0));
  const middle = nearby.indexOf(center), positions = new Map([[center.id, center.x]]);
  function requiredGap(a, b) {
    const vertical = Math.abs(a.y - b.y) * 7.6;
    const overlapGap = vertical < 36 ? Math.sqrt(36 ** 2 - vertical ** 2) / 9.64 : 0;
    return lineIds.has(a.id) && lineIds.has(b.id) ? Math.max(5, overlapGap) : overlapGap;
  }
  // Sweep away from C and keep each player's prior x unless space is needed.
  for (let i = middle - 1; i >= 0; i--) {
    let x = nearby[i].x;
    for (let j = i + 1; j <= middle; j++) x = Math.min(x, positions.get(nearby[j].id) - requiredGap(nearby[i], nearby[j]));
    positions.set(nearby[i].id, x);
  }
  for (let i = middle + 1; i < nearby.length; i++) {
    let x = nearby[i].x;
    for (let j = middle; j < i; j++) x = Math.max(x, positions.get(nearby[j].id) + requiredGap(nearby[i], nearby[j]));
    positions.set(nearby[i].id, x);
  }
  if ([...positions.values()].some(x => x < 0 || x > 100)) return { changed: false, reason: 'no-room' };
  let changed = false;
  for (const p of nearby) {
    const x = positions.get(p.id), dx = x - p.x;
    if (Math.abs(dx) < 1e-8) continue;
    changed = true; p.x = x;
    for (const r of play.routes.filter(route => route.playerId === p.id)) {
      // Translate an entire route where possible. If its far end already
      // touches the field edge, keep that end and only move the attached start.
      if (r.points.every(point => point.x + dx >= 0 && point.x + dx <= 100)) r.points.forEach(point => { point.x += dx; });
      else r.points[0].x = x;
    }
  }
  return { changed, reason: changed ? 'spaced' : 'already-spaced' };
}
function makeTracedPlay(entry, trace) {
  const convert = ([x, y]) => ({ x: Number(((x - 10) / 534 * 100).toFixed(3)), y: Number((67 + (y - 174) * .2375).toFixed(3)) });
  const players = trace.players.map(p => ({ id: uid(), label: p.label, name: '', ...convert(p.at), side: 'offense', color: '#ffdc42', shape: p.label === 'C' ? 'square' : 'circle' }));
  const routes = trace.routes.map(r => ({ id: uid(), playerId: players.find(p => p.label === r.owner).id, points: r.points.map(convert), kind: r.kind, color: r.ink === 'white' && r.kind === 'motion' ? '#b8eff5' : INKS[r.ink], smooth: false, endCap: r.kind === 'block' && r.ink === 'white' ? 'bar' : 'arrow', delay: 0, duration: 3, optional: r.optional }));
  const play = {
    id: uid(), title: entry.name, book: 'offense', formation: `${trace.group} ${trace.formation}`,
    category: 'Madden 可编辑', personnel: `${trace.team === 'eagles' ? 'Eagles' : 'Ravens'} · ${trace.game}`,
    notes: [entry.personalNotes || '', '根据原图识别并校核的站位和可见路线，可拖动球员、编辑节点、镜像与演练。为防遮挡，锋线及附近球员的水平间距已适度整理。', '位置标签按图中站位分配。图外路线长度、接球目标和时序无法从静态图确认；默认不自动传球，路线时长为可调整的演示值。阻挡线用于图示，不模拟防守对抗。', ...trace.reviewNotes].filter(Boolean).join('\n').slice(0, 10000),
    favorite: !!entry.personalFavorite, players, routes, zones: [], annotations: [],
    ball: { holderId: players.find(p => p.label === 'QB').id, receiverId: '', passAt: 2, arriveAt: 3 },
    createdAt: new Date().toISOString(),
    diagramSource: { provider: 'huddle.gg', catalogId: trace.id, team: trace.team, game: trace.game, sourceUrl: trace.sourceUrl, image: trace.image, traceVersion: trace.traceVersion },
  };
  spaceMaddenLine(play);
  return play;
}
