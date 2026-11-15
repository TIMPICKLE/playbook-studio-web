import test from 'node:test';
import assert from 'node:assert/strict';
import { z } from '../web/vendor/assistant-zod.js';
import { clone, makePlay, starterWorkspace, validatePlay } from '../web/model.js';
import { EDITABLE_TRACES } from '../web/data/madden-editable.js';
import { makeMaddenPlay } from '../web/madden-model.js';
import { EDITOR_PLAY_COMMANDS, EditorPlayOperationSchema, runEditorPlayCommand, describeEditorPlayCommand } from '../web/editor-play-commands.js';

const ids = prefix => { let index = 0; return () => `${prefix}-${++index}`; };
function execute(play, op, options = {}) {
  const draft = clone(play);
  const result = runEditorPlayCommand(draft, op, { idFactory: ids('created'), ...options });
  validatePlay(draft);
  return { play: draft, result };
}
const mesh = () => starterWorkspace().plays[0];
const route = (id, player, kind, points, fields = {}) => ({ id, playerId: player.id, kind, points, color: player.color, smooth: false, endCap: 'arrow', delay: 0, duration: 2, optional: false, ...fields });
function motionFixture() {
  const play = makePlay();
  const player = play.players.find(player => player.label === 'Y');
  const motion = route('motion', player, 'motion', [{ x: player.x, y: player.y }, { x: 62, y: 68 }]);
  const follow = route('follow', player, 'route', [{ x: 62, y: 68 }, { x: 62, y: 40 }], { delay: 2 });
  play.routes.push(motion, follow); validatePlay(play);
  return { play, player, motion, follow };
}

test('the shared registry exposes strict, bounded operations and only additions accept aliases', () => {
  assert.equal(new Set(EDITOR_PLAY_COMMANDS.map(item => item.id)).size, 16);
  assert.ok(EDITOR_PLAY_COMMANDS.every(item => item.undoable && item.description));
  assert.ok(EDITOR_PLAY_COMMANDS.find(item => item.id === 'formation_apply').destructive);
  assert.doesNotThrow(() => z.toJSONSchema(EditorPlayOperationSchema, { io: 'input', target: 'draft-7' }));
  const valid = [
    { kind: 'player_add', side: 'defense', as: 'sam' },
    { kind: 'route_add', playerId: 'x', routeKind: 'motion', points: [{ x: 10, y: 20 }, { x: 20, y: 20 }], as: 'm' },
    { kind: 'zone_add', x: 0, y: 100, rx: 1, ry: 50, as: 'zone' },
    { kind: 'annotation_add', x: 50, y: 50, text: 'Read #1', as: 'note' },
    { kind: 'formation_apply', formation: 'Gun Trips', count: 12 },
    { kind: 'formation_apply', formationId: 'custom' },
  ];
  for (const op of valid) assert.ok(EditorPlayOperationSchema.safeParse(op).success, op.kind);
  const invalid = [
    { kind: 'player_add', side: 'other' }, { kind: 'player_add', side: 'offense', label: '12345678901' },
    { kind: 'player_update', playerId: 'x', patch: {} }, { kind: 'player_update', playerId: 'x', patch: { x: 101 } },
    { kind: 'play_mirror', as: 'mirror' }, { kind: 'play_update', patch: { book: 'defense' } },
    { kind: 'formation_apply', formation: 'Gun Trips', formationId: 'custom' },
    { kind: 'route_update', routeId: 'r', patch: { duration: .1 } },
    { kind: 'route_update', routeId: 'r', patch: { points: Array(201).fill({ x: 1, y: 1 }) } },
    { kind: 'zone_add', x: 0, y: 0, rx: 0, ry: 2 },
    { kind: 'annotation_update', annotationId: 'a', patch: { text: 'a'.repeat(201) } },
    { kind: 'ball_update', patch: { passAt: 11 } },
  ];
  for (const op of invalid) assert.equal(EditorPlayOperationSchema.safeParse(op).success, false, JSON.stringify(op));
  assert.equal(describeEditorPlayCommand({ kind: 'player_add' }, 'en'), 'Add player');
  assert.equal(describeEditorPlayCommand({ kind: 'play_mirror' }), '镜像战术');
  assert.equal(runEditorPlayCommand(mesh(), { kind: 'unknown' }), null);
});

test('player creation returns a deterministic ID and edits translate all attached routes', () => {
  const original = mesh();
  const before = clone(original);
  const added = execute(original, { kind: 'player_add', side: 'defense', label: 'Sam', x: 64, y: 45, color: '#123456', shape: 'triangle' });
  assert.equal(added.result.createdId, 'created-1');
  assert.deepEqual(added.play.players.at(-1), { id: 'created-1', side: 'defense', label: 'Sam', name: '', x: 64, y: 45, color: '#123456', shape: 'triangle' });
  assert.deepEqual(original, before);
  const x = original.players.find(player => player.label === 'X');
  const oldRoute = original.routes.find(route => route.playerId === x.id);
  const moved = execute(original, { kind: 'player_update', playerId: x.id, patch: { x: x.x + 5, y: x.y - 2, label: 'WR' } }).play;
  assert.equal(moved.players.find(player => player.id === x.id).label, 'WR');
  assert.deepEqual(moved.routes.find(route => route.id === oldRoute.id).points, oldRoute.points.map(point => ({ x: point.x + 5, y: point.y - 2 })));
});

test('roster binding uses existing names, supports unlinking and prevents double assignments', () => {
  const play = makePlay(), player = play.players[0];
  const roster = [{ id: 'roster-1', name: 'Avery' }];
  const bound = execute(play, { kind: 'player_update', playerId: player.id, patch: { rosterId: 'roster-1' } }, { roster }).play;
  assert.equal(bound.players[0].name, 'Avery'); assert.equal(bound.players[0].rosterId, 'roster-1');
  const unchangedName = execute(bound, { kind: 'player_update', playerId: player.id, patch: { name: 'Avery' } }, { roster }).play;
  assert.equal(unchangedName.players[0].rosterId, 'roster-1');
  const renamed = execute(bound, { kind: 'player_update', playerId: player.id, patch: { name: 'Coach label' } }, { roster }).play;
  assert.equal(renamed.players[0].rosterId, undefined);
  assert.equal(execute(bound, { kind: 'player_update', playerId: player.id, patch: { rosterId: '' } }, { roster }).play.players[0].name, '');
  assert.throws(() => execute(bound, { kind: 'player_add', side: 'offense', rosterId: 'roster-1' }, { roster }), /already assigned/);
  assert.throws(() => execute(play, { kind: 'player_update', playerId: player.id, patch: { rosterId: 'missing' } }, { roster }), /Roster player not found/);
});

test('removing a player cleans its routes, ball references and per-waypoint blocking targets', () => {
  const play = mesh(), removed = play.players.find(player => player.label === 'Y');
  const block = play.routes.find(route => route.kind === 'block');
  block.blockTargets = [removed.id]; play.ball.holderId = removed.id; play.ball.receiverId = removed.id;
  const result = execute(play, { kind: 'object_remove', objectType: 'player', objectId: removed.id }).play;
  assert.ok(!result.players.some(player => player.id === removed.id));
  assert.ok(!result.routes.some(route => route.playerId === removed.id));
  assert.deepEqual(result.routes.find(route => route.id === block.id).blockTargets, [null]);
  assert.equal(result.ball.holderId, result.players.find(player => player.label === 'QB').id);
  assert.equal(result.ball.receiverId, '');
  const lone = makePlay({ count: 1 });
  assert.throws(() => execute(lone, { kind: 'object_remove', objectType: 'player', objectId: lone.players[0].id }), /retain at least one/);
});

test('route additions use complete paths and replace a main movement with its optional alternative', () => {
  const play = mesh(), x = play.players.find(player => player.label === 'X');
  const prior = play.routes.find(route => route.playerId === x.id);
  const added = execute(play, { kind: 'route_add', playerId: x.id, routeKind: 'route', points: [{ x: x.x, y: x.y }, { x: 30, y: 40 }], duration: 3, smooth: true });
  assert.equal(added.result.createdId, 'created-1');
  assert.equal(added.play.routes.find(route => route.id === prior.id).optional, true);
  assert.equal(added.play.routes.at(-1).smooth, true);
  const option = execute(play, { kind: 'route_add', playerId: x.id, routeKind: 'route', points: [{ x: x.x, y: x.y }, { x: 30, y: 40 }], optional: true }).play;
  assert.equal(option.routes.find(route => route.id === prior.id).optional, false);
  const block = play.routes.find(route => route.kind === 'block');
  block.blockTargets = [x.id]; block.stagedBlock = true;
  const updated = execute(play, { kind: 'route_update', routeId: block.id, patch: { points: clone(block.points), color: '#aabbcc' } }).play.routes.find(route => route.id === block.id);
  assert.equal(updated.blockTargets, undefined); assert.equal(updated.stagedBlock, undefined); assert.equal(updated.color, '#aabbcc');
});

test('updating and deleting motion keeps following routes anchored and adjusts timing', () => {
  const { play, player } = motionFixture();
  const updated = execute(play, { kind: 'route_update', routeId: 'motion', patch: { points: [{ x: player.x, y: player.y }, { x: 65, y: 66 }], duration: 3 } }).play;
  assert.deepEqual(updated.routes.find(route => route.id === 'follow').points, [{ x: 65, y: 66 }, { x: 65, y: 38 }]);
  assert.equal(updated.routes.find(route => route.id === 'follow').delay, 3);
  const removed = execute(play, { kind: 'object_remove', objectType: 'route', objectId: 'motion' }).play;
  assert.deepEqual(removed.routes[0].points[0], { x: player.x, y: player.y });
  assert.equal(removed.routes[0].delay, 0);
  const optional = execute(play, { kind: 'route_update', routeId: 'motion', patch: { optional: true } }).play;
  assert.deepEqual(optional.routes.find(route => route.id === 'follow').points[0], { x: player.x, y: player.y });
  const unsafe = motionFixture();
  unsafe.player.x = 95; unsafe.motion.points[0].x = 95; unsafe.follow.points[1].x = 90;
  const before = clone(unsafe.play);
  assert.throws(() => execute(unsafe.play, { kind: 'object_remove', objectType: 'route', objectId: 'motion' }), /outside the field/);
  assert.deepEqual(unsafe.play, before);
});

test('custom zones, annotations, ball settings and details preserve unrelated geometry', () => {
  const original = mesh();
  let play = execute(original, { kind: 'zone_add', x: 25, y: 35, rx: 15, ry: 12, label: 'HOOK' }).play;
  play = execute(play, { kind: 'zone_update', zoneId: 'created-1', patch: { x: 28, color: '#112233' } }).play;
  assert.equal(play.zones[0].x, 28);
  play = execute(play, { kind: 'annotation_add', x: 20, y: 25, text: 'Read safety' }).play;
  play = execute(play, { kind: 'annotation_update', annotationId: 'created-1', patch: { text: 'Read CB', y: 30 } }).play;
  assert.equal(play.annotations[0].text, 'Read CB');
  const qb = play.players.find(player => player.label === 'QB');
  play = execute(play, { kind: 'ball_update', patch: { holderId: qb.id, receiverId: qb.id, passAt: 1, arriveAt: 2 } }).play;
  assert.equal(play.ball.receiverId, '');
  play = execute(play, { kind: 'play_update', patch: { title: 'My mesh', notes: 'Check leverage.', favorite: false } }).play;
  assert.equal(play.title, 'My mesh'); assert.equal(play.notes, 'Check leverage.');
  assert.deepEqual(play.players, original.players); assert.deepEqual(play.routes, original.routes);
  assert.throws(() => execute(play, { kind: 'ball_update', patch: { passAt: 3, arriveAt: 2 } }), /arrival must follow/);
  play = execute(play, { kind: 'object_remove', objectType: 'zone', objectId: 'created-1' }).play;
  play = execute(play, { kind: 'object_remove', objectType: 'annotation', objectId: 'created-1' }).play;
  assert.equal(play.zones.length, 0); assert.equal(play.annotations.length, 0);
});

test('mirroring is reversible and built-in or saved formations replace the complete board deterministically', () => {
  const original = mesh();
  const mirrored = execute(original, { kind: 'play_mirror' }).play;
  assert.deepEqual(execute(mirrored, { kind: 'play_mirror' }).play, original);
  const builtin = execute(original, { kind: 'formation_apply', formation: 'Gun Doubles', count: 6 }).play;
  assert.equal(builtin.players.length, 6); assert.equal(builtin.formation, 'Gun Doubles');
  assert.deepEqual(builtin.routes, []); assert.deepEqual(builtin.zones, []); assert.deepEqual(builtin.annotations, []);
  assert.equal(builtin.players[0].id, 'created-1'); assert.equal(builtin.ball.receiverId, '');
  const saved = [{ id: 'saved', name: 'Team Spread', book: 'offense', players: clone(original.players) }];
  const custom = execute(original, { kind: 'formation_apply', formationId: 'saved' }, { formations: saved }).play;
  assert.equal(custom.formation, 'Team Spread'); assert.equal(custom.players[0].id, 'created-1');
  assert.deepEqual(saved[0].players, original.players);
  assert.throws(() => execute(original, { kind: 'formation_apply', formationId: 'missing' }), /Saved formation not found/);
});

test('opponent state is idempotent and removal retains the home players and their routes', () => {
  const original = mesh();
  const enabled = execute(original, { kind: 'opponents_set', enabled: true, count: 12 }).play;
  assert.equal(enabled.players.length, 23);
  assert.deepEqual(execute(enabled, { kind: 'opponents_set', enabled: true }).play, enabled);
  assert.deepEqual(execute(enabled, { kind: 'opponents_set', enabled: false }).play, original);
  const allOpponents = makePlay({ formation: '4–3', book: 'offense' });
  assert.throws(() => execute(allOpponents, { kind: 'opponents_set', enabled: false }), /retain at least one/);
});

test('depth-chart starters and Madden line spacing reuse their existing domain behavior', () => {
  const workspace = starterWorkspace({ demoDepth: true });
  const original = workspace.plays[0];
  const assigned = execute(original, { kind: 'personnel_apply', groupId: 'spread' }, workspace).play;
  assert.ok(assigned.players.find(player => player.label === 'QB').rosterId);
  assert.deepEqual(assigned.routes, original.routes);
  assert.throws(() => execute(original, { kind: 'personnel_apply', groupId: 'missing' }, workspace), /Depth-chart group not found/);
  assert.throws(() => execute(original, { kind: 'line_space' }), /cannot be safely spaced/);
  const entry = Object.values(EDITABLE_TRACES)[0], legacy = makeMaddenPlay(entry);
  const convert = ([x, y]) => ({ x: Number(((x - 10) / 534 * 100).toFixed(3)), y: Number((67 + (y - 174) * .2375).toFixed(3)) });
  for (const raw of entry.players) Object.assign(legacy.players.find(player => player.label === raw.label), convert(raw.at));
  entry.routes.forEach((raw, index) => { legacy.routes[index].points = raw.points.map(convert); });
  const spaced = execute(legacy, { kind: 'line_space' }).play;
  assert.notDeepEqual(spaced.players.map(player => player.x), legacy.players.map(player => player.x));
  assert.deepEqual(execute(spaced, { kind: 'line_space' }).play, spaced);
});

test('limits and reference restrictions fail without changing the caller-owned play', () => {
  const play = mesh();
  while (play.players.length < 40) play.players.push({ ...play.players[0], id: `p-${play.players.length}` });
  const before = clone(play);
  assert.throws(() => execute(play, { kind: 'player_add', side: 'defense' }), /limit reached/);
  assert.deepEqual(play, before);
  const reference = { ...mesh(), reference: {} };
  assert.throws(() => runEditorPlayCommand(reference, { kind: 'play_mirror' }), /reference diagram/);
  assert.deepEqual(runEditorPlayCommand(reference, { kind: 'play_update', patch: { notes: 'Keep original.' } }), { handled: true });
  assert.equal(reference.notes, 'Keep original.');
});

