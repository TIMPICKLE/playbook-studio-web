import test from 'node:test';
import assert from 'node:assert/strict';
import { starterWorkspace } from '../web/model.js';
import { authorizedKnowledgePack, diagramFacts, diagramIntersections, retrieveMatchupKnowledge } from '../web/analysis-evidence.js';
import { buildMatchup } from '../server/matchup.mjs';
import { runMatchupAgent } from '../server/matchup-agent.mjs';
import { createDemoRequest } from '../web/ai-demo.js';

const pack = () => ({ format: 'playbook-studio-knowledge', version: 1,
  sources: [{ id: 'team:install:2026', title: 'Team Zeta install', kind: 'publisher', documentName: 'install.pdf', revision: 'v1' }],
  cards: [{ id: 'zeta-hook', sourceId: 'team:install:2026', title: 'Zeta sideline check', content: 'Zeta receiver reads are conditional on the installed flat defender response.', tags: ['zeta'], coverages: ['cover3_spot'], appliesWhen: ['Zeta install is confirmed'], exceptions: ['The defense may check out of the call'], page: 3, regionId: 'page3:region1', bbox: [0.1, 0.1, 0.5, 0.8], figures: [{ id: 'zeta:figure1', caption: 'Zeta installed check', page: 3, regionId: 'page3:figure1', imageRef: 'figures/zeta.png' }] }] });
const fixture = () => { const data = starterWorkspace(); return { data, off: data.plays.find(p => p.book === 'offense'), def: data.plays.find(p => p.book === 'defense') }; };
const completion = message => new Response(JSON.stringify({ choices: [{ message }] }), { headers: { 'Content-Type': 'application/json' } });
const call = (name, args, id) => ({ content: null, tool_calls: [{ id, type: 'function', function: { name, arguments: JSON.stringify(args) } }] });
const report = id => ({ summary: 'Conditional study', scenarios: [1, 2].map(n => ({ title: `Read ${n}`, condition: 'If the flat defender widens', observation: 'Watch the flat defender', possibility: 'An inside window may develop', action: 'Confirm the team check', limitations: 'Timing and help are unknown', evidenceIds: [id] })), missingInfo: [] });

test('imported knowledge retains explicit page/figure provenance without claiming publisher trust or vision', () => {
  const { off, def } = fixture();
  const matchup = buildMatchup(off, def, { coverage: 'cover3_spot', knowledgeQuery: 'zeta sideline check', knowledgePack: pack(), locale: 'en' });
  const card = matchup.knowledge.find(item => item.sourceId === 'team:install:2026');
  assert.ok(card);
  const evidence = matchup.evidence.find(item => item.id === card.evidenceId);
  assert.equal(evidence.sourceKind, 'team');
  assert.equal(evidence.page, 3);
  assert.equal(evidence.regionId, 'page3:region1');
  assert.deepEqual(evidence.bbox, [0.1, 0.1, 0.5, 0.8]);
  assert.equal(evidence.figures[0].id, 'zeta:figure1');
  assert.equal(evidence.visualContentSent, false);
  assert.doesNotMatch(JSON.stringify(matchup), /data:image/);
});

test('per-request knowledge allowance is independent of a larger local library', () => {
  const tooMany = pack();
  tooMany.cards = Array.from({ length: 7 }, (_, index) => ({ ...tooMany.cards[0], id: `card${index}` }));
  assert.throws(() => authorizedKnowledgePack(tooMany), /6/);
  const tooLarge = pack();
  tooLarge.padding = 'x'.repeat(33000);
  assert.throws(() => authorizedKnowledgePack(tooLarge), /32 KB/);
  assert.equal(authorizedKnowledgePack(null), null);
});

test('diagram facts count drawn lines without classifying them as protection assignments', () => {
  const { off, def } = fixture();
  const facts = diagramFacts(off, def, { coverage: 'cover2', locale: 'en' }, diagramIntersections(off, def));
  assert.equal(facts.counts.receivingRoutes, off.routes.filter(route => route.kind === 'route').length);
  assert.equal(facts.counts.offensivePlayers, off.players.filter(player => player.side === 'offense').length);
  assert.equal(facts.counts.protectors, undefined);
  assert.match(facts.unknowns.join(' '), /variant is unconfirmed/);
  assert.match(facts.unknowns.join(' '), /Protection assignments/);
});

test('unknown coverage remains limited even with retrieved principles and apparently complete model JSON', async t => {
  const { off, def } = fixture(), matchup = buildMatchup(off, def, { coverage: 'unknown' });
  assert.ok(matchup.knowledge.length > 0);
  const prior = globalThis.fetch; t.after(() => { globalThis.fetch = prior; });
  let requests = 0;
  globalThis.fetch = async () => ++requests === 1 ? completion(call('get_matchup_context', {}, 'ctx')) : completion({ content: JSON.stringify(report(matchup.offense.routes[0].id)) });
  const result = await runMatchupAgent(matchup, { model: { provider: 'deepseek', model: 'test', apiKey: 'fake-test' } }, {}, new AbortController().signal);
  assert.equal(result.status, 'limited');
  assert.equal(result.grounding.entailmentVerified, false);
  assert.equal(result.grounding.citationIdsVerified, true);
  assert.equal(result.facts.coverage, 'unknown');
});

test('generic coaching cards alone do not mark a confirmed-coverage report complete', async t => {
  const { off, def } = fixture(), matchup = buildMatchup(off, def, { coverage: 'cover3_spot' });
  matchup.knowledge = matchup.knowledge.filter(card => !card.coverages.length);
  assert.ok(matchup.knowledge.length);
  const prior = globalThis.fetch; t.after(() => { globalThis.fetch = prior; });
  let requests = 0;
  globalThis.fetch = async () => ++requests === 1 ? completion(call('get_matchup_context', {}, 'ctx')) : completion({ content: JSON.stringify(report(matchup.offense.routes[0].id)) });
  const result = await runMatchupAgent(matchup, { model: { provider: 'deepseek', model: 'test', apiKey: 'fake-test' } }, {}, new AbortController().signal);
  assert.equal(result.status, 'limited');
});

test('knowledge tool searches only the already authorized retrieved fragments', async t => {
  const { off, def } = fixture(), matchup = buildMatchup(off, def, { coverage: 'cover3_spot', knowledgeQuery: 'zeta', knowledgePack: pack() });
  const prior = globalThis.fetch; t.after(() => { globalThis.fetch = prior; });
  const requests = [];
  globalThis.fetch = async (_url, options) => {
    const body = JSON.parse(options.body); requests.push(body);
    if (requests.length === 1) return completion(call('get_matchup_context', {}, 'ctx'));
    if (requests.length === 2) return completion(call('search_knowledge', { query: 'zeta' }, 'knowledge'));
    return completion({ content: JSON.stringify(report(matchup.offense.routes[0].id)) });
  };
  const result = await runMatchupAgent(matchup, { model: { provider: 'deepseek', model: 'test', apiKey: 'fake-test' } }, {}, new AbortController().signal);
  const tool = JSON.parse(requests[2].messages.find(message => message.tool_call_id === 'knowledge').content);
  assert.ok(tool.matches.length);
  assert.ok(tool.matches.every(card => matchup.knowledge.some(item => item.evidenceId === card.evidenceId)));
  assert.match(tool.scope, /不是完整本地知识库/);
  assert.ok(result.execution.toolsUsed.includes('search_knowledge'));
});

test('browser and cloud use identical knowledge IDs and geometry; browser retains checked citations', async () => {
  const { data, off, def } = fixture();
  const body = { offensePlayId: off.id, defensePlayId: def.id, locale: 'en', coverage: 'cover3_spot', knowledgeQuery: 'zeta', knowledgePack: pack(), model: { provider: 'openrouter', model: 'test', apiKey: 'fake-test' } };
  let supplied;
  const request = createDemoRequest(() => data, async (_url, options) => {
    supplied = JSON.parse(JSON.parse(options.body).messages[1].content);
    return completion({ content: JSON.stringify(report(supplied.knowledge[0].evidenceId)) });
  });
  const result = await request('', { body });
  const cloud = buildMatchup(off, def, body);
  assert.deepEqual(result.knowledge.map(card => card.evidenceId), cloud.knowledge.map(card => card.evidenceId));
  assert.deepEqual(supplied.intersections, cloud.intersections);
  assert.deepEqual(result.facts.counts, cloud.facts.counts);
  assert.deepEqual(result.scenarios[0].evidenceIds, [supplied.knowledge[0].evidenceId]);
  assert.equal(result.status, 'limited');
  const invalid = createDemoRequest(() => data, async () => completion({ content: JSON.stringify(report('knowledge:invented')) }));
  await assert.rejects(invalid('', { body }), /outside this analysis/);
});

test('confirmed Cover 2 Read is accepted consistently and does not retrieve spot-only Cover 3 rules', () => {
  const { off, def } = fixture();
  const knowledge = retrieveMatchupKnowledge(off, def, { coverage: 'cover2_read', knowledgeQuery: 'Smash Fade Flat Cover 2 Read' });
  assert.ok(knowledge.length);
  assert.ok(knowledge.every(card => !card.coverages.length || card.coverages.includes('cover2_read')));
  assert.ok(knowledge.some(card => /Read/i.test(card.title)));
});
