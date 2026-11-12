import { getEditableEntry } from './madden-model.js';
import { MADDEN_CONCEPT_TAGS, MADDEN_NAME_TAGS } from './data/madden-search-tags.js';
import { boardConceptTags } from './madden-concepts.js';
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

const traceTags = Object.values(MADDEN_CONCEPT_TAGS);
const tagFrequency = new Map();
for (const tags of traceTags) for (const tag of new Set(tags)) tagFrequency.set(tag, (tagFrequency.get(tag) || 0) + 1);
const tagWeight = tag => Math.log((traceTags.length + 1) / ((tagFrequency.get(tag) || 0) + 1));

const asCandidate = (entry, trace) => ({
  id: entry.id, name: entry.name, team: entry.team, formation: entry.group + ' ' + entry.formation,
  editable: !!trace,
  tags: [...new Set([...(MADDEN_CONCEPT_TAGS[entry.id] || []), ...(MADDEN_NAME_TAGS[entry.id] || [])])],
  geometryTags: MADDEN_CONCEPT_TAGS[entry.id] || [], nameTags: MADDEN_NAME_TAGS[entry.id] || [],
  evidence: traceEvidence(trace) + (trace && MADDEN_CONCEPT_TAGS[entry.id]?.length ? ` Geometry-derived approximate tags: ${MADDEN_CONCEPT_TAGS[entry.id].join(', ')}.` : '') +
    (MADDEN_NAME_TAGS[entry.id]?.length ? ` Name-derived weak labels (not route confirmation): ${MADDEN_NAME_TAGS[entry.id].join(', ')}.` : ''),
});

// Catalog terms are supplied by the model's tool call, not inferred from the
// user's command. A search for "cover 3" alone will never manufacture a match.
export function searchMaddenCatalog(catalog, { concepts = [], tags = [], formation = '', team = '', editableOnly = false, personnel = '', playType = '', situation = '', similarToCurrent = false, limit = 12 } = {}, { board } = {}) {
  if (!Array.isArray(concepts) || concepts.length > 8 || !Array.isArray(tags) || tags.length > 8 || !Number.isInteger(limit) || limit < 1) return [];
  const phrases = [...new Set(concepts.filter(term => typeof term === 'string').map(searchable).filter(Boolean))];
  const requestedTags = [...new Set(tags.filter(term => typeof term === 'string').map(searchable).filter(Boolean))];
  const formationPhrase = searchable(formation);
  if (!phrases.length && !requestedTags.length && !formationPhrase && !team && !personnel && !playType && !situation && !similarToCurrent) return [];
  if (similarToCurrent && (!board || board.book === 'defense')) return [];
  const currentTags = similarToCurrent ? boardConceptTags(board) : [];

  const ranked = [];
  for (const entry of catalog.plays) {
    if (team && team !== entry.team) continue;
    if (formationPhrase && !containsPhrase(searchable(entry.group + ' ' + entry.formation), formationPhrase)) continue;
    // A filter only matches recorded metadata. Do not infer personnel, play type or
    // game situation from an unread original image or a suggestive play name.
    if (personnel && searchable(entry.personnel) !== searchable(personnel)) continue;
    if (playType && entry.playType !== playType) continue;
    if (situation && !(entry.situations || []).includes(situation)) continue;
    const name = searchable(entry.name);
    const hits = phrases.filter(phrase => containsPhrase(name, phrase));
    const conceptTags = MADDEN_CONCEPT_TAGS[entry.id] || [];
    const nameTags = MADDEN_NAME_TAGS[entry.id] || [];
    const tagHits = requestedTags.filter(tag => [...conceptTags, ...nameTags].some(value => searchable(value) === tag));
    const namedTagHits = requestedTags.filter(tag => nameTags.some(value => searchable(value) === tag));
    if ((phrases.length || requestedTags.length) && !hits.length && !tagHits.length) continue;
    const trace = getEditableEntry(entry.id);
    if (editableOnly && !trace) continue;
    // Similarity requires comparable route data. Original-only entries have no
    // geometry to compare, so they cannot be ranked as similar on route evidence.
    if (similarToCurrent && !trace) continue;
    const sameFormation = similarToCurrent && searchable(board.formation) === searchable(entry.group + ' ' + entry.formation);
    const commonTags = currentTags.filter(tag => conceptTags.includes(tag));
    if (similarToCurrent && !sameFormation && !commonTags.length) continue;
    // A common in/out route carries less evidence than a rare combination such
    // as four verts. Name-derived weak labels do not contribute to similarity.
    const score = Number(hits.includes(name)) * 8 + hits.length * 2 + tagHits.length * 3 + namedTagHits.length + Number(!!trace) + Number(sameFormation) * 4 + commonTags.reduce((sum, tag) => sum + tagWeight(tag), 0);
    ranked.push({ entry, trace, hits, score, sameFormation, sharedTags: currentTags.filter(tag => conceptTags.includes(tag)) });
  }
  ranked.sort((a, b) => b.score - a.score || a.entry.id.localeCompare(b.entry.id));

  // Include the best result per requested concept, then distinct play names.
  if (similarToCurrent) return ranked.slice(0, Math.min(limit, 12)).map(({ entry, trace, sameFormation, sharedTags }) => {
    const candidate = asCandidate(entry, trace);
    candidate.evidence += ` Similarity evidence: ${[sameFormation && 'same formation', sharedTags.length && `shared approximate tags: ${sharedTags.join(', ')}`].filter(Boolean).join('; ')}.`;
    return candidate;
  });
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
