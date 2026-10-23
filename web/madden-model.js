import { uid } from './model.js';

export const MADDEN_DRAG_TYPE = 'application/x-playbook-madden';
export function filterCatalog(catalog, { team = 'eagles', group = '', formation = '', query = '' } = {}) {
  const terms = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  return catalog.plays.filter(p => p.team === team && (!group || p.group === group) && (!formation || `${p.group} ${p.formation}` === formation) && terms.every(term => `${p.name} ${p.group} ${p.formation}`.toLowerCase().includes(term)));
}
export function makeMaddenPlay(entry) {
  return {
    id: uid(), title: entry.name, book: 'offense', formation: `${entry.group} ${entry.formation}`,
    category: 'Madden 原图', personnel: `${entry.team === 'eagles' ? 'Eagles' : 'Ravens'} · ${entry.game}`,
    notes: '', favorite: false, players: [], routes: [], zones: [], annotations: [],
    ball: { holderId: '', receiverId: '', passAt: 2, arriveAt: 3 }, createdAt: new Date().toISOString(),
    reference: { provider: 'huddle.gg', catalogId: entry.id, team: entry.team, game: entry.game, sourceUrl: entry.sourceUrl, image: entry.image },
  };
}
