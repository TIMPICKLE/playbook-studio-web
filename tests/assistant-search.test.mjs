import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { searchMaddenCatalog, resolveMaddenResults } from '../web/assistant-search.js';
import { searchServerMadden } from '../server/board-assistant-catalog.mjs';
import { editableTraceCount, hasEditableTrace, makeMaddenPlay } from '../web/madden-model.js';

const catalog = JSON.parse(readFileSync(new URL('../web/data/huddle-catalog.json', import.meta.url)));
const byId = new Map(catalog.plays.map(entry => [entry.id, entry]));

test('search tools retrieve real concept and diagram evidence from the shipped catalog', () => {
  const args = { concepts: ['flood', 'sail', 'curl flat', 'vertical'] };
  const choices = searchMaddenCatalog(catalog, args);
  assert.deepEqual(searchServerMadden(args), choices);
  assert.ok(choices.length > 3 && choices.length <= 12);
  for (const pattern of [/FLOOD/, /SAIL/, /CURL FLAT/, /VERTICAL/]) assert.ok(choices.some(p => pattern.test(p.name)));
  for (const choice of choices) {
    assert.equal(choice.name, byId.get(choice.id).name);
    assert.equal(choice.editable, hasEditableTrace(choice.id));
    assert.match(choice.evidence, choice.editable ? /route start→finish/ : /metadata/);
  }
  assert.deepEqual(searchMaddenCatalog(catalog, { concepts: ['cover 3'] }), []);
});

test('search intersects explicit team, formation and editable filters with catalog concept phrases', () => {
  const choices = searchMaddenCatalog(catalog, { concepts: ['mesh'], team: 'eagles', formation: 'Gun Bunch', editableOnly: true });
  assert.ok(choices.length);
  for (const p of choices) {
    assert.equal(p.team, 'eagles');
    assert.match(p.name, /MESH/);
    assert.match(p.formation, /Gun Bunch/);
    assert.equal(p.editable, true);
  }
  assert.deepEqual(searchMaddenCatalog(catalog, {}), []);
  assert.deepEqual(searchMaddenCatalog(catalog, { concepts: ['unfindableuniquestring'] }), []);
});

test('recommendation cards import canonical plays and never use model-proposed names or image URLs', () => {
  const chosen = searchMaddenCatalog(catalog, { concepts: ['mesh'], editableOnly: true })[0];
  const card = { id: chosen.id, reason: 'Compare the shallow crossing concept.', name: 'invented play', image: 'invalid' };
  const results = resolveMaddenResults(catalog, [
    { id: 'fake', reason: 'a' }, null, { id: chosen.id, reason: ' ' }, card, card,
  ]);
  assert.equal(results.length, 1);
  assert.equal(results[0].name, byId.get(chosen.id).name);
  assert.equal(results[0].reason, card.reason);
  assert.equal(results[0].image, byId.get(chosen.id).image);
  const imported = makeMaddenPlay(results[0].entry);
  assert.equal(imported.diagramSource.catalogId, chosen.id);
  assert.ok(imported.routes.length);
});

test('geometry tags come only from editable traces and remain separate from image metadata', async () => {
  const { MADDEN_CONCEPT_TAGS } = await import('../web/data/madden-search-tags.js');
  const { traceConceptTags } = await import('../web/madden-concepts.js');
  const { getEditableEntry } = await import('../web/madden-model.js');
  assert.equal(Object.keys(MADDEN_CONCEPT_TAGS).length, editableTraceCount);
  const tagged = Object.entries(MADDEN_CONCEPT_TAGS).find(([, tags]) => tags.includes('flood'));
  assert.deepEqual(MADDEN_CONCEPT_TAGS[tagged[0]], traceConceptTags(getEditableEntry(tagged[0])));
  const choices = searchMaddenCatalog(catalog, { tags: ['flood'] });
  assert.ok(choices.length);
  assert.ok(choices.every(p => p.editable && p.tags.includes('flood') && p.evidence.includes('approximate')));
  const image = catalog.plays.find(p => !hasEditableTrace(p.id));
  assert.equal(MADDEN_CONCEPT_TAGS[image.id], undefined);
});

test('a flood with a vertical clear-out and outside intermediate route receives an approximate tag', async () => {
  const { traceConceptTags } = await import('../web/madden-concepts.js');
  const { getEditableEntry } = await import('../web/madden-model.js');
  const trace = getEditableEntry('eagles-ce5ad6b2e9a857ad496e');
  assert.equal(trace.name, 'FLOOD');
  assert.ok(traceConceptTags(trace).includes('flood'));
  const matches = searchMaddenCatalog(catalog, { tags: ['flood'] });
  assert.ok(matches.some(play => play.id === trace.id));
});

test('similar searches use current formation and geometry with server parity', () => {
  const selected = catalog.plays.find(p => hasEditableTrace(p.id));
  const board = { book: 'offense', formation: selected.group + ' ' + selected.formation, players: [], routes: [] };
  const options = { board };
  const candidates = searchMaddenCatalog(catalog, { similarToCurrent: true }, options);
  assert.ok(candidates.length);
  assert.equal(candidates[0].formation, board.formation);
  assert.ok(candidates.every(p => p.editable));
  assert.deepEqual(searchServerMadden({ similarToCurrent: true }, options), candidates);
  assert.deepEqual(searchMaddenCatalog(catalog, { similarToCurrent: true }, { board: { ...board, book: 'defense' } }), []);
});

test('metadata filters require recorded evidence and do not invent image attributes', () => {
  for (const filter of [{ personnel: '11' }, { playType: 'pass' }, { situation: 'red_zone' }]) {
    assert.deepEqual(searchMaddenCatalog(catalog, filter), []);
  }
  const recorded = { plays: [{ ...catalog.plays[0], personnel: '11', playType: 'pass', situations: ['red_zone'] }] };
  assert.equal(searchMaddenCatalog(recorded, { personnel: '11', playType: 'pass', situation: 'red_zone' }).length, 1);
});

test('similar search requires shared formation or route evidence', () => {
  const unrelated = { book: 'offense', formation: 'Unrecognized custom formation', players: [], routes: [] };
  assert.deepEqual(searchMaddenCatalog(catalog, { similarToCurrent: true }, { board: unrelated }), []);
  const entry = catalog.plays.find(play => hasEditableTrace(play.id));
  const sameFormation = { ...unrelated, formation: entry.group + ' ' + entry.formation };
  const choices = searchMaddenCatalog(catalog, { similarToCurrent: true }, { board: sameFormation });
  assert.ok(choices.length);
  assert.ok(choices.every(choice => choice.formation === sameFormation.formation && choice.evidence.includes('same formation')));
});

test('similarity features do not treat an opponent route as an offensive concept', async () => {
  const { boardConceptTags } = await import('../web/madden-concepts.js');
  const board = { players: [
    { id: 'c', label: 'C', side: 'offense', x: 50, y: 67 },
    { id: 'x', label: 'X', side: 'offense', x: 20, y: 67 },
    { id: 'db', label: 'CB', side: 'defense', x: 80, y: 67 },
  ], routes: [
    { playerId: 'x', kind: 'route', points: [{ x: 20, y: 67 }, { x: 20, y: 40 }] },
    { playerId: 'db', kind: 'route', points: [{ x: 80, y: 67 }, { x: 60, y: 50 }] },
  ] };
  assert.deepEqual(boardConceptTags(board), ['vertical']);
});
