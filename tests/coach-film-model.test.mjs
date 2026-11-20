import test from 'node:test';
import assert from 'node:assert/strict';
import { addRoute, animatedBall, animatedPlayer, createAnimationSampler, makePlay, starterWorkspace } from '../web/model.js';
import { createFilmModel, getFilmTimeline, selectFilmFocus } from '../web/coach-film-model.js';

const idsFor = (play, ...labels) => labels.map(label => play.players.find(player => player.label === label).id);
const eventIds = model => model.events.map(event => event.id);

test('Mesh exercise uses the actual release, arrival and model clock', () => {
  const play = starterWorkspace().plays[0];
  const model = createFilmModel(play);
  const [h, y, qb] = idsFor(play, 'H', 'Y', 'QB');
  assert.deepEqual(model.events, [
    { id: 'start', time: 0 }, { id: 'release', time: 2 }, { id: 'arrival', time: 3 }, { id: 'end', time: 6 },
  ]);
  assert.equal(model.duration, 6);
  assert.deepEqual(getFilmTimeline(play), { duration: 6, canPass: true, hasMotion: true, events: model.events });
  const expected = [
    [0, 'held', qb, y, 1.5],
    [1, 'held', qb, h, 1],
    [1.5, 'held', qb, h, 3],
    [2, 'release', qb, h, 3],
    [2.5, 'flight', null, h, 3],
    [3, 'arrival', y, h, 3],
    [3.1, 'received', y, h, 3],
  ];
  for (const [time, phase, holderId, deeperId, gapYards] of expected) {
    const frame = model.frameAt(time, [h, y]);
    assert.equal(frame.time, time);
    assert.equal(frame.phase, phase);
    assert.equal(frame.holderId, holderId);
    assert.equal(frame.comparison.deeperId, deeperId);
    assert.equal(frame.comparison.gapYards, gapYards);
    assert.deepEqual(frame.ball, animatedBall(play, time));
    for (const player of play.players) assert.deepEqual(frame.positions.get(player.id), animatedPlayer(play, player, time));
  }
  const atRelease = model.frameAt(2, [h, y]);
  assert.deepEqual(atRelease.focus.map(player => player.depthYards), [7.5, 4.5]);
  assert.equal(atRelease.ball, atRelease.positions.get(qb));
  assert.equal(model.frameAt(2, [y, h]).comparison.deeperId, h);
  assert.equal(model.frameAt(-20).time, 0);
  assert.equal(model.frameAt(100).time, model.duration);
});

test('repeated and reverse seeks retain the same short traces, geometry, phase and readings', () => {
  const play = starterWorkspace().plays[0];
  addRoute(play, 'QB', [[65, 56], [42, 38]], 'pass', { smooth: true });
  const model = createFilmModel(play);
  const ids = idsFor(play, 'H', 'Y');
  const reference = model.frameAt(2.5, ids);
  for (const time of [6, .1, 3, 2, 4]) model.frameAt(time, ids);
  const reverse = model.frameAt(2.5, ids);
  assert.deepEqual(reverse, reference);
  assert.deepEqual(reverse.ball, animatedBall(play, 2.5));
  for (const actor of reverse.focus) {
    assert.deepEqual(actor.origin, model.frameAt(0).positions.get(actor.id));
    assert.deepEqual(actor.position, actor.trail.at(-1));
    const length = actor.trail.slice(1).reduce((total, point, i) =>
      total + Math.hypot(point.x - actor.trail[i].x, point.y - actor.trail[i].y), 0);
    assert.ok(length > 0 && length < 4.000001);
  }
  assert.equal(model.frameAt(2.5, [ids[0]]).positions, model.frameAt(2.5, ids).positions);
});

test('a running play, a layout with optional paths only, and a timed pass without player motion are distinguished', () => {
  const insideZone = starterWorkspace().plays.find(play => play.title.startsWith('Inside Zone'));
  const run = createFilmModel(insideZone);
  const [rb] = idsFor(insideZone, 'RB');
  assert.ok(run.hasMotion);
  assert.deepEqual(eventIds(run), ['start', 'end']);
  const frame = run.frameAt(2.5);
  assert.equal(frame.holderId, rb);
  assert.equal(frame.phase, 'held');
  assert.deepEqual(frame.ball, frame.positions.get(rb));

  const play = makePlay();
  addRoute(play, 'X', [[70, 47]], 'route', { optional: true });
  const formation = createFilmModel(play);
  assert.equal(formation.hasMotion, false);
  assert.equal(formation.duration, 0);
  assert.deepEqual(eventIds(formation), ['start']);
  assert.ok(formation.frameAt(3, idsFor(play, 'H', 'Y')).comparison);
  play.ball.receiverId = idsFor(play, 'Y')[0];
  play.ball.passAt = 0;
  const pass = createFilmModel(play);
  assert.ok(pass.hasMotion);
  assert.deepEqual(pass.events.slice(0, 2), [{ id: 'start', time: 0 }, { id: 'release', time: 0 }]);
  assert.equal(pass.frameAt(0).phase, 'release');
});

test('invalid timing or missing participants cannot generate an event or place a phantom ball', () => {
  const mesh = starterWorkspace().plays[0];
  for (const ball of [
    { ...mesh.ball, receiverId: 'deleted' }, { ...mesh.ball, passAt: -1 }, { ...mesh.ball, passAt: 3, arriveAt: 3 },
    { ...mesh.ball, arriveAt: null }, { ...mesh.ball, passAt: '2' }, { ...mesh.ball, receiverId: mesh.ball.holderId },
  ]) {
    const model = createFilmModel({ ...mesh, ball });
    assert.deepEqual(eventIds(model), ['start', 'end']);
    assert.equal(model.frameAt(2.5).phase, 'held');
    assert.ok(Number.isFinite(model.duration));
  }
  for (const ball of [null, { ...mesh.ball, holderId: 'deleted' }]) {
    const model = createFilmModel({ ...mesh, ball });
    assert.deepEqual(eventIds(model), ['start', 'end']);
    const frame = model.frameAt(2.5);
    assert.equal(frame.phase, 'none');
    assert.equal(frame.ball, null);
    assert.equal(frame.holderId, null);
  }
  const image = createFilmModel({ reference: { catalogId: 'image-only' }, players: [], routes: [] });
  assert.ok(image.reference);
  assert.equal(image.calibrated, false);
  assert.equal(image.hasMotion, false);
  assert.deepEqual(image.events, []);
  assert.equal(image.frameAt(0).positions.size, 0);
});

test('depth comparisons ignore lateral distance, preserve relative ordering on schematic grids and use display precision for ties', () => {
  const play = makePlay({ count: 5 });
  const [x, y] = idsFor(play, 'X', 'Y');
  const relative = createFilmModel(play);
  assert.equal(relative.calibrated, false);
  const frame = relative.frameAt(0, [x, y]);
  assert.deepEqual(frame.comparison, { deeperId: x, shallowerId: y, gapYards: null });
  assert.deepEqual(frame.focus.map(actor => actor.depthYards), [null, null]);
  const legacyFlag = { ...play };
  delete legacyFlag.league;
  assert.equal(createFilmModel(legacyFlag).calibrated, false);
  const eleven = makePlay();
  delete eleven.league;
  const [a, b] = eleven.players;
  a.x = 0; b.x = 100; a.y = 67; b.y = 67.016;
  const level = createFilmModel(eleven);
  assert.equal(level.calibrated, true);
  assert.deepEqual(level.frameAt(0, [a.id, b.id]).comparison, { deeperId: null, shallowerId: null, gapYards: 0 });
});

test('focus is unambiguous for duplicate positions and supports deselect and explicit replacement', () => {
  const play = makePlay({ formation: '4–3', book: 'defense' });
  const corners = play.players.filter(player => player.label === 'CB');
  const [first, second] = corners.map(player => player.id);
  const next = play.players.find(player => player.label === 'FS').id;
  const model = createFilmModel(play);
  assert.deepEqual(model.players.filter(player => player.label === 'CB').map(player => player.displayLabel), ['CB · 1', 'CB · 2']);
  assert.equal(model.frameAt(0, ['deleted', first, first, second, next]).focus.length, 2);
  assert.equal(model.frameAt(0, [first]).comparison, null);
  assert.deepEqual(selectFilmFocus([], first), { ids: [first], needsReplacement: false });
  assert.deepEqual(selectFilmFocus([first], second), { ids: [first, second], needsReplacement: false });
  const both = [first, second];
  assert.deepEqual(selectFilmFocus(both, next), { ids: both, needsReplacement: true });
  assert.deepEqual(selectFilmFocus(both, next, first), { ids: [next, second], needsReplacement: false });
  assert.deepEqual(selectFilmFocus(both, second), { ids: [first], needsReplacement: false });
  corners[1].rosterId = 'member';
  const linked = createFilmModel(play, { roster: [{ id: 'member', name: 'Sam', number: '0' }] });
  assert.equal(linked.players.find(player => player.id === second).displayLabel, 'CB · #0 · Sam');
});

test('a lecture is isolated from source changes; a new lecture samples the latest revision', () => {
  const play = starterWorkspace().plays[0];
  const saved = structuredClone(play);
  const ids = idsFor(play, 'H', 'Y');
  const previous = createFilmModel(play);
  const expected = previous.frameAt(2, ids);
  assert.deepEqual(play, saved);
  play.ball.passAt = 2.3;
  const route = play.routes.find(route => route.playerId === ids[0]);
  route.points.slice(1).forEach(point => { point.y = 42; });
  const updated = createFilmModel(play);
  assert.deepEqual(previous.frameAt(2, ids), expected);
  assert.equal(updated.events.find(event => event.id === 'release').time, 2.3);
  assert.notEqual(updated.frameAt(2, ids).comparison.gapYards, expected.comparison.gapYards);
});

test('immutable sampling is numerically identical for long smooth routes, staged live blocks, motion and drawn ball paths', () => {
  const play = makePlay({count:11});
  const [c, h, y, qb] = idsFor(play, 'C', 'H', 'Y', 'QB');
  const defender = {...play.players[0], id:'defender', label:'DT', side:'defense', x:45, y:57};
  play.players.push(defender);
  const longRoute = Array.from({length:179}, (_, i) => [15 + i / 3, 65 - i / 4 + Math.sin(i / 7)]);
  addRoute(play, 'H', longRoute, 'route', {smooth:true});
  addRoute(play, 'DT', [[44, 62], [39, 65]], 'route', {smooth:true});
  addRoute(play, 'C', [[45, 57], [42, 52]], 'block', {stagedBlock:true, blockTargets:[defender.id, h]});
  addRoute(play, 'Y', [[67, 70], [60, 72]], 'motion', {duration:.75});
  addRoute(play, 'Y', [[54, 64], [40, 50]], 'route', {delay:.75});
  play.routes.at(-1).points[0] = {x:60, y:72};
  addRoute(play, 'QB', [[61, 66], [60, 52], [39, 46]], 'pass', {smooth:true});
  play.ball = {holderId:qb,receiverId:y,passAt:1.28,arriveAt:2.41};
  const sampler = createAnimationSampler(play);
  // Include backwards seeks after both actors and flight geometry were sampled.
  for (const t of [0, .13, .73, .75, 1.28, 1.55, 2.41, 5, 3, .91, 2.16, 1.4]) {
    for (const id of [c,h,y,defender.id]) {
      const actor = play.players.find(p => p.id === id);
      assert.deepEqual(sampler.playerAt(actor, t), animatedPlayer(play, actor, t));
    }
    assert.deepEqual(sampler.ballAt(t), animatedBall(play, t));
  }
});
