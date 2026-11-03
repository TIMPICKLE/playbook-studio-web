import test from 'node:test';
import assert from 'node:assert/strict';
import { animatedPlayer, decodeWorkspace, encodeWorkspace, prepareWorkspaceAppend, starterWorkspace } from '../web/model.js';
import { mergeWorkspaces } from '../web/sync.js';
import { correctSelection, drillStatus, feedbackTargets, normalizeDrill, publishDrill, trainingScene } from '../web/training-model.js';
import { trainingDemo } from '../web/training-demo.js';

const roundtrip = data => decodeWorkspace(encodeWorkspace(data));

test('two editable demo looks open identically at the snap but disclose different outcomes', () => {
  const { plays, drills } = trainingDemo();
  const [rush, drop] = plays;
  assert.equal(rush.players.length, 22);
  assert.deepEqual(rush.players, drop.players);
  assert.deepEqual(roundtrip({ ...starterWorkspace(), plays, drills }).drills, drills);
  for (const drill of drills) {
    const scene = trainingScene(drill, plays);
    assert.equal(drillStatus(drill, plays), 'published');
    const will = scene.players.find(p => p.id === 'will');
    assert.deepEqual(animatedPlayer(scene, will, drill.snapAt), { x: will.x, y: will.y });
    assert.equal(correctSelection(drill, ['mike', 'will']), true);
    assert.equal(correctSelection(drill, ['mike', 'nickel']), false);
    assert.equal(correctSelection(drill, ['mike']), false);
    assert.equal(correctSelection(drill, ['mike', 'will', 'nickel']), false);
  }
  const position = play => animatedPlayer(play, play.players.find(p => p.id === 'will'), 1.8);
  assert.ok(position(rush).y > 67);
  assert.ok(position(drop).y < 62);
  const translated = trainingDemo('en');
  assert.deepEqual(translated.drills.map(d => d.id), drills.map(d => d.id));
  assert.notEqual(translated.drills[0].explanation, drills[0].explanation);
});

test('pairing single-side plays namespaces defender IDs without destroying the offensive ball and route timing', () => {
  const { plays } = starterWorkspace();
  const attack = plays.find(p => p.book === 'offense'), defense = plays.find(p => p.book === 'defense');
  defense.players[0].id = attack.players[0].id;
  const original = structuredClone(plays);
  const drill = normalizeDrill({ id: 'test', playId: attack.id, defensePlayId: defense.id, mirrorDefense: true,
    cameraId: attack.players.find(p => p.label === 'QB').id, targetIds: ['d:' + defense.players[0].id],
    title: 'Inside', role: 'QB', question: 'Who?', explanation: 'Track the front.' });
  const scene = trainingScene(drill, plays);
  assert.equal(new Set(scene.players.map(p => p.id)).size, 22);
  assert.equal(scene.players.find(p => p.id === drill.targetIds[0]).x, 100 - defense.players[0].x);
  assert.deepEqual(scene.ball, attack.ball);
  assert.equal(drillStatus(publishDrill(drill, plays), plays), 'published');
  assert.throws(() => publishDrill({ ...drill, targetIds: [attack.players[0].id] }, plays));
  assert.throws(() => publishDrill({ ...drill, targetIds: [] }, plays));
  assert.deepEqual(plays, original);
});

test('geometry, timing, missing targets and answer edits require re-publication, unrelated notes do not', () => {
  const { plays, drills: [first] } = trainingDemo();
  plays[0].notes += ' unrelated';
  assert.equal(drillStatus(first, plays), 'published');
  const original = structuredClone(first);
  assert.equal(drillStatus({ ...first, question: 'Changed read' }, plays), 'needsReview');
  plays[0].routes[0].duration += 0.2;
  assert.equal(drillStatus(first, plays), 'needsReview');
  const republished = publishDrill(first, plays);
  assert.equal(republished.revision, 2);
  assert.equal(drillStatus(republished, plays), 'published');
  plays[0].players = plays[0].players.filter(p => p.id !== first.cameraId);
  assert.equal(drillStatus(republished, plays), 'needsReview');
  assert.equal(drillStatus(first, []), 'needsReview');
  assert.equal(trainingScene(first, [{ ...plays[0], reference: {} }]), null);
  assert.deepEqual(first, original);
});

test('backups append new drill & source IDs without changing marker links, and legacy books default to no drills', () => {
  const target = starterWorkspace(), imported = { ...starterWorkspace(), ...trainingDemo() };
  delete target.drills;
  assert.deepEqual(roundtrip(target).drills, []);
  const batch = prepareWorkspaceAppend(target, imported);
  assert.equal(batch.drills.length, 2);
  assert.notEqual(batch.drills[0].id, imported.drills[0].id);
  assert.notEqual(batch.drills[0].playId, imported.plays[0].id);
  assert.equal(batch.drills[0].playId, batch.plays[0].id);
  assert.deepEqual(batch.drills[0].targetIds, imported.drills[0].targetIds);
  assert.equal(drillStatus(batch.drills[0], batch.plays), 'published');
});

test('concurrent drill additions merge by ID; conflicting edits to the same answer require a decision', () => {
  const { plays, drills } = trainingDemo(), base = { ...starterWorkspace(), plays, drills: [] };
  const separate = mergeWorkspaces(base, { ...base, drills: [drills[0]] }, { ...base, drills: [drills[1]] });
  assert.deepEqual(separate.conflicts, []);
  assert.deepEqual(roundtrip(separate.data).drills, drills);
  const record = { ...base, drills: [drills[0]] };
  const edited = target => ({ ...base, drills: [{ ...drills[0], targetIds: [target] }] });
  assert.ok(mergeWorkspaces(record, edited('will'), edited('mike')).conflicts.length);
});

test('alternative reads are graded as complete sets and feedback picks the nearest coherent answer', () => {
  const { drills: [original], plays } = trainingDemo();
  const draft = { ...original, alternativeTargetIds: [['ss', 'fs'], ['lcb', 'rcb']] };
  const published = publishDrill(draft, plays);
  assert.equal(correctSelection(published, ['fs', 'ss']), true);
  assert.equal(correctSelection(published, ['will', 'fs']), false);
  assert.deepEqual(feedbackTargets(published, ['will', 'fs']), original.targetIds);
  assert.deepEqual(feedbackTargets(published, ['mike', 'fs','ss']), ['ss', 'fs']);
  assert.deepEqual(feedbackTargets(published, []), original.targetIds);
  assert.equal(drillStatus({ ...published, alternativeTargetIds: [] }, plays), 'needsReview');
  assert.equal(drillStatus({ ...published, alternativeTargetIds: [['fs', 'ss'], ['rcb', 'lcb']] }, plays), 'published');
  assert.deepEqual(roundtrip({ ...starterWorkspace(), plays, drills: [published] }).drills[0], published);
  for (const alternatives of [[[]], [['fs']], [['qb','fs']], [['fs','absent']], [['mike','will']], [['ss','fs'],['fs','ss']]]) {
    const partial = normalizeDrill({ ...draft, status: 'draft', alternativeTargetIds: alternatives });
    assert.deepEqual(partial.alternativeTargetIds, alternatives);
    assert.throws(() => publishDrill(partial, plays));
  }
  assert.throws(() => normalizeDrill({ ...draft, alternativeTargetIds: Array(6).fill([]) }));
  assert.throws(() => normalizeDrill({ ...draft, alternativeTargetIds: [['mike','mike']] }));
});
