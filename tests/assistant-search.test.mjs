import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { searchMaddenCatalog, resolveMaddenResults } from '../web/assistant-search.js';
import { searchServerMadden } from '../server/board-assistant-catalog.mjs';
import { hasEditableTrace, makeMaddenPlay } from '../web/madden-model.js';

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
