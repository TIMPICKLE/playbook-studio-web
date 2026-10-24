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
function makeTracedPlay(entry, trace) {
  const convert = ([x, y]) => ({ x: Number(((x - 10) / 534 * 100).toFixed(3)), y: Number((67 + (y - 174) * .2375).toFixed(3)) });
  const players = trace.players.map(p => ({ id: uid(), label: p.label, name: '', ...convert(p.at), side: 'offense', color: '#ffdc42', shape: p.label === 'C' ? 'square' : 'circle' }));
  const routes = trace.routes.map(r => ({ id: uid(), playerId: players.find(p => p.label === r.owner).id, points: r.points.map(convert), kind: r.kind, color: INKS[r.ink], smooth: false, endCap: r.ink === 'white' ? 'bar' : 'arrow', delay: 0, duration: 3, optional: r.optional }));
  return {
    id: uid(), title: entry.name, book: 'offense', formation: `${trace.group} ${trace.formation}`,
    category: 'Madden 可编辑', personnel: `${trace.team === 'eagles' ? 'Eagles' : 'Ravens'} · ${trace.game}`,
    notes: [entry.personalNotes || '', '根据原图识别并校核的站位和可见路线，可拖动球员、编辑节点、镜像与演练。', '位置标签按图中站位分配。图外路线长度、接球目标和时序无法从静态图确认；默认不自动传球，路线时长为可调整的演示值。阻挡线用于图示，不模拟防守对抗。', ...trace.reviewNotes].filter(Boolean).join('\n').slice(0, 10000),
    favorite: !!entry.personalFavorite, players, routes, zones: [], annotations: [],
    ball: { holderId: players.find(p => p.label === 'QB').id, receiverId: '', passAt: 2, arriveAt: 3 },
    createdAt: new Date().toISOString(),
    diagramSource: { provider: 'huddle.gg', catalogId: trace.id, team: trace.team, game: trace.game, sourceUrl: trace.sourceUrl, image: trace.image, traceVersion: trace.traceVersion },
  };
}
