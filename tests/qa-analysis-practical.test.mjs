import test from 'node:test';
import assert from 'node:assert/strict';
import { starterWorkspace } from '../web/model.js';
import { buildMatchup } from '../server/matchup.mjs';
import { parseKnowledgeText, retrieveKnowledge } from '../web/knowledge-base.js';

const matchup = (name, coverage, extra = {}) => {
  const data = starterWorkspace();
  const offense = data.plays.find(play => play.book === 'offense' && play.title.includes(name));
  const defense = data.plays.find(play => play.book === 'defense');
  return buildMatchup(offense, defense, { coverage, context: '第三档 6 码，请说明关键阅读点和防守反制。', ...extra });
};

test('a real Mesh vs man study recalls the actual concept and its help/timing conditions', () => {
  const result = matchup('Mesh', 'man');
  for (const expected of ['mesh.man', 'mesh.traffic']) {
    const card = result.knowledge.find(item => item.id === expected);
    assert.ok(card, `${expected} should be available for the selected Mesh study`);
    assert.ok(card.appliesWhen.length && card.exceptions.length && card.readKey);
  }
  assert.ok(result.knowledge.every(card => !card.coverages.length || card.coverages.includes('man')));
});

test('an Inside Zone run does not receive unrelated passing concepts just for a generic read question', () => {
  const result = matchup('Inside Zone', 'cover3_spot');
  const unrelated = new Set(['cover3.hook_flat', 'hank.progression', 'spacing.cover3', 'fourstrong.flood', 'mesh.traffic', 'fourstrong.assignments']);
  assert.ok(result.knowledge.every(card => !unrelated.has(card.id)), `Unexpected passing concepts: ${result.knowledge.map(card => card.id).join(', ')}`);
  assert.equal(result.facts.counts.blockingLines, 5);
  assert.equal(result.facts.counts.protectors, undefined);
});

test('Four Verticals vs man exposes the corpus gap instead of filling it with Mesh or four-strong', () => {
  const result = matchup('Four Verticals', 'man');
  assert.ok(result.knowledge.every(card => !['mesh.man', 'mesh.traffic', 'fourstrong.assignments', 'fourstrong.flood'].includes(card.id)));
  assert.ok(result.facts.counts.receivingRoutes > 0);
  if (!result.knowledge.length) assert.match(result.warnings.join(' '), /没有相关命中/);
});

test('Flood keeps its conditional overload example but does not receive Mesh filler', () => {
  const result = matchup('Flood', 'cover3_spot');
  assert.ok(result.knowledge.some(card => ['fourstrong.flood', 'fourstrong.assignments'].includes(card.id)));
  assert.ok(result.knowledge.every(card => card.id !== 'mesh.traffic'));
});

test('a named team installation is retrievable while its imported authorship stays explicit', () => {
  const pack = parseKnowledgeText('# Red zone trips\n\nFalconcheck signals the installed red zone trips read. The QB must read the apex before a flat throw.', { name: 'install.md' });
  const result = matchup('Flood', 'cover3_match', { knowledgePack: pack, knowledgeQuery: 'Falconcheck red zone trips' });
  const card = result.knowledge.find(item => item.sourceId === pack.sources[0].id);
  assert.ok(card);
  assert.equal(card.source.kind, 'team');
  assert.match(card.content, /Falconcheck/);
  const evidence = result.evidence.find(item => item.id === card.evidenceId);
  assert.equal(evidence.visualContentSent, false);
  assert.equal(evidence.sourceKind, 'team');
});

test('coverage caveats survive concept precision filtering', () => {
  const unknown = retrieveKnowledge({ query: 'Smash Cover 2 Read corner', coverage: 'unknown' });
  const read = unknown.find(card => card.id === 'cover2.read');
  assert.ok(read);
  assert.equal(read.applicability, 'conditional');
  const broad = retrieveKnowledge({ query: 'Smash corner', coverage: 'cover2' });
  assert.ok(broad.some(card => card.id === 'cover2.variant'));
  const match = matchup('Four Verticals', 'cover3_match');
  assert.ok(match.knowledge.some(card => card.id === 'cover3.match'));
});
