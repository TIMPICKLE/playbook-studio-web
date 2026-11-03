import { getEditableEntry } from './madden-model.js';
export { loadMaddenCatalog as loadAssistantCatalog } from './madden-catalog.js';

const words = value => String(value || '').toLowerCase().match(/[a-z0-9]+/g) || [];

// Compare catalog spellings such as CURL FLAT / CURL FLATS and VERTICALS.
// Coverage interpretation is handled by the agent before it calls this tool.
function searchable(value) {
  return words(value).map(word => word.length > 3 && !word.endsWith('ss') ? word.replace(/s$/, '') : word).join(' ');
}
function containsPhrase(text, phrase) {
  return (' ' + text + ' ').includes(' ' + phrase + ' ');
}

// Endpoints are source pixels. Provide just the diagram evidence a coach could check.
function traceEvidence(trace) {
  if (!trace) return 'Original image only; metadata: catalog name and formation.';
  const routes = trace.routes.filter(route => route.kind === 'route' && !route.optional);
  const endpoints = routes.map(route => `${route.owner} ${route.points[0].join(',')}→${route.points.at(-1).join(',')}`);
  return `Editable trace: primary route start→finish (source px; right +x, downfield −y, LOS y=${trace.coordinateSystem.lineOfScrimmageY}): ${endpoints.join('; ')}.`;
}

const asCandidate = (entry, trace) => ({
  id: entry.id, name: entry.name, team: entry.team, formation: entry.group + ' ' + entry.formation,
  editable: !!trace, evidence: traceEvidence(trace),
});

// Catalog terms are supplied by the model's tool call, not inferred from the
// user's command. A search for "cover 3" alone will never manufacture a match.
export function searchMaddenCatalog(catalog, { concepts = [], formation = '', team = '', editableOnly = false, limit = 12 } = {}) {
  if (!Array.isArray(concepts) || concepts.length > 8 || !Number.isInteger(limit) || limit < 1) return [];
  const phrases = [...new Set(concepts.filter(term => typeof term === 'string').map(searchable).filter(Boolean))];
  const formationPhrase = searchable(formation);
  if (!phrases.length && !formationPhrase && !team) return [];

  const ranked = [];
  for (const entry of catalog.plays) {
    if (team && team !== entry.team) continue;
    if (formationPhrase && !containsPhrase(searchable(entry.group + ' ' + entry.formation), formationPhrase)) continue;
    const name = searchable(entry.name);
    const hits = phrases.filter(phrase => containsPhrase(name, phrase));
    if (phrases.length && !hits.length) continue;
    const trace = getEditableEntry(entry.id);
    if (editableOnly && !trace) continue;
    const score = Number(hits.includes(name)) * 8 + hits.length * 2 + Number(!!trace);
    ranked.push({ entry, trace, hits, score });
  }
  ranked.sort((a, b) => b.score - a.score || a.entry.id.localeCompare(b.entry.id));

  // Include the best result per requested concept, then distinct play names.
  const representatives = phrases.map(phrase => ranked.find(row => row.hits.includes(phrase))).filter(Boolean);
  const uniqueNames = new Map();
  for (const row of ranked) if (!uniqueNames.has(row.entry.name)) uniqueNames.set(row.entry.name, row);
  return [...new Set([...representatives, ...uniqueNames.values(), ...ranked])]
    .slice(0, Math.min(limit, 12))
    .map(({ entry, trace }) => asCandidate(entry, trace));
}

// The harness only permits IDs returned by actual search calls. Use the local
// catalog for everything imported or displayed, including image paths.
export function resolveMaddenResults(catalog, matches) {
  const plays = new Map(catalog.plays.map(entry => [entry.id, entry]));
  const cards = [];
  for (const match of Array.isArray(matches) ? matches : []) {
    const entry = plays.get(match?.id);
    const reason = typeof match?.reason === 'string' ? match.reason.trim().slice(0, 450) : '';
    if (!entry || !reason) continue;
    cards.push({ ...asCandidate(entry, getEditableEntry(entry.id)), image: entry.image, reason, entry });
    plays.delete(entry.id);
    if (cards.length === 5) break;
  }
  return cards;
}
