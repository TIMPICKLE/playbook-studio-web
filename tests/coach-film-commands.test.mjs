import test from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { FILM_COMMAND_SCHEMAS, getFilmCapabilities, readFilmState, runFilmCommand, validateFilmCommand } from '../web/coach-film-commands.js';
import { openFilmRoom } from '../web/coach-film-room.js';
import { createFilmLesson } from '../web/coach-film-lesson.js';
import { makePlay, starterWorkspace } from '../web/model.js';

function open(t, play, lesson = null) {
  const win = new Window();
  const room = openFilmRoom({ play, lesson, doc: win.document });
  t.after(async () => { room.close(); await win.happyDOM.abort(); });
  return {
    room, doc: win.document,
    send: (operation, params = {}) => room.perform({ operation, ...params }),
  };
}

test('the published branches select the same strict wire format in a browser or worker', async () => {
  const manifest = getFilmCapabilities();
  const operations = manifest.commands.map(schema => schema.properties.operation.const);
  assert.equal(new Set(operations).size, operations.length);
  const lesson = manifest.commands.find(schema => schema.properties.operation.const === 'lesson');
  assert.ok(lesson.oneOf.every(schema => schema.required.includes('action') && !schema.additionalProperties));
  manifest.commands[0].properties.operation.const = 'changed';
  assert.equal(FILM_COMMAND_SCHEMAS[0].properties.operation.const, 'open');
  const source = { operation: 'lesson', action: 'replace', time: 0, focusIds: ['a'] };
  const command = validateFilmCommand(source);
  source.focusIds.push('b');
  assert.deepEqual(command.focusIds, ['a']);
  const bad = [
    null, { operation: 'constructor' }, Object.create({ operation: 'play' }),
    JSON.parse('{"operation":"state","__proto__":{}}'), { operation: 'state', time: 0 },
    { operation: 'seek', time: '0' }, { operation: 'seek', time: Infinity }, { operation: 'pin', time: -1 },
    { operation: 'speed', speed: 0.75 }, { operation: 'theme', theme: 'auto' },
    { operation: 'focus', players: [] }, { operation: 'focus', players: ['H', 'H'] },
    { operation: 'focus', players: [' '] }, { operation: 'lesson', action: 'state', includeAnswers: 1 },
    { operation: 'lesson', action: 'load', answer: '' }, { operation: 'lesson', action: 'add', question: ' ' },
    { operation: 'lesson', action: 'add', question: 'Q'.repeat(161) }, { operation: 'lesson', action: 'update' },
    { operation: 'lesson', action: 'update', index: 1.5, answer: '' }, { operation: 'lesson', action: 'select', index: 3 },
    { operation: 'lesson', action: 'select' }, { operation: 'lesson', action: 'add', question: 'Q', focusIds: ['x', 'x'] },
  ];
  for (const input of bad) assert.throws(() => validateFilmCommand(input), { code: 'INVALID_COMMAND' });
  assert.deepEqual(validateFilmCommand({ operation: 'lesson', action: 'update', answer: '' }), { operation: 'lesson', action: 'update', answer: '' });
  assert.deepEqual(await runFilmCommand(null, { operation: 'capabilities' }), getFilmCapabilities());
  assert.deepEqual(readFilmState(null), { version: 1, open: false });
  assert.deepEqual(await runFilmCommand(null, { operation: 'close' }), readFilmState(null));
  await assert.rejects(runFilmCommand(null, { operation: 'play' }), { code: 'ROOM_CLOSED' });
});

test('selection is atomic and stable with duplicate labels, colliding references and a pending manual replacement', async t => {
  const play = starterWorkspace().plays[0];
  const [a, b, c] = play.players;
  a.label = b.label = 'CB';
  const { room, send, doc } = open(t, play);
  const first = await send('focus', { players: ['cb · 1', 'CB · 2'] });
  assert.deepEqual(first.focusIds, [a.id, b.id]);
  const denied = [
    [{ operation: 'focus', players: [c.id, 'CB'] }, 'PLAYER_AMBIGUOUS'],
    [{ operation: 'focus', players: [a.id, 'CB · 1'] }, 'DUPLICATE_PLAYER'],
    [{ operation: 'replaceFocus', replace: a.id, player: b.id }, 'DUPLICATE_PLAYER'],
    [{ operation: 'replaceFocus', replace: c.id, player: c.id }, 'FOCUS_NOT_SELECTED'],
    [{ operation: 'addFocus', player: c.id }, 'FOCUS_FULL'],
    [{ operation: 'focus', players: [a.id, 'unknown'] }, 'PLAYER_NOT_FOUND'],
  ];
  for (const [request, code] of denied) {
    await assert.rejects(room.perform(request), error => {
      assert.equal(error.code, code);
      if (code === 'PLAYER_AMBIGUOUS') assert.deepEqual(error.details.candidates.map(player => player.id), [a.id, b.id]);
      return true;
    });
    assert.deepEqual(room.readState(), first);
  }
  doc.querySelector('[data-film-pick="' + c.id + '"]').click();
  assert.equal(room.readState().pendingId, c.id);
  const kept = await send('cancelReplacement');
  assert.deepEqual(kept.focusIds, first.focusIds);
  assert.equal(kept.pendingId, null);
  assert.deepEqual((await send('replaceFocus', { replace: a.id, player: c.id })).focusIds, [c.id, b.id]);
  assert.deepEqual((await send('addFocus', { player: c.id })).focusIds, [c.id, b.id]);
  assert.deepEqual((await send('removeFocus', { player: c.id })).focusIds, [b.id]);
  assert.deepEqual((await send('clearFocus')).focusIds, []);
});

test('event identity survives coincident times, scrubbing preserves the reference, and published coordinates are detached', async t => {
  const play = starterWorkspace().plays[0];
  play.ball.passAt = 0;
  const { room, send } = open(t, play);
  const start = await send('event', { event: 'start' });
  const release = await send('event', { event: 'next' });
  assert.equal(release.time, start.time);
  assert.deepEqual([start.activeEvent, release.activeEvent], ['start', 'release']);
  assert.equal((await send('event', { event: 'previous' })).activeEvent, 'start');
  await assert.rejects(send('event', { event: 'previous' }), { code: 'EVENT_UNAVAILABLE' });
  await send('focus', { players: ['H', 'Y'] });
  await send('pin', { time: 1.75 });
  const observed = await send('seek', { time: 1.25 });
  const clean = structuredClone(observed);
  assert.deepEqual(JSON.parse(JSON.stringify(observed)), clean);
  assert.equal(observed.reference.time, 1.75);
  assert.equal(observed.activeEvent, null);
  assert.equal(observed.ball.phase, 'flight');
  observed.reference.focus[0].origin.y = -999;
  observed.focus[1].trail[0].y = -999;
  observed.players[0].position.x = -999;
  observed.ball.position.x = -999;
  observed.comparison.gapYards = -999;
  observed.events[0].id = 'changed';
  assert.deepEqual(room.readState(), clean);
  await assert.rejects(send('seek', { time: clean.duration + 1 }), { code: 'TIME_OUT_OF_RANGE' });
  assert.deepEqual(room.readState(), clean);
  await send('event', { event: 'end' });
  await assert.rejects(send('event', { event: 'next' }), { code: 'EVENT_UNAVAILABLE' });
  const replay = await send('play');
  assert.equal(replay.playing, true);
  assert.equal(replay.time, 0);
  assert.equal((await send('speed', { speed: 1.5 })).speed, 1.5);
  assert.equal((await send('pause')).playing, false);
  assert.equal((await send('unpin')).reference, null);
  assert.deepEqual(await send('close'), { version: 1, open: false });
});

test('stationary, uncalibrated and image-only diagrams expose their actual controls and unknown measurements', async t => {
  const play = makePlay({ count: 5 });
  const { room, send } = open(t, play);
  const staticFrame = await send('focus', { players: ['X', 'Y'] });
  assert.equal(staticFrame.calibrated, false);
  assert.equal(staticFrame.comparison.gapYards, null);
  assert.equal(staticFrame.focus[0].depthYards, null);
  assert.deepEqual(staticFrame.events, [{ id: 'start', time: 0 }]);
  assert.equal(staticFrame.available.play, false);
  for (const op of ['play', 'pin', 'pause']) await assert.rejects(send(op), { code: 'NO_MOTION' });
  await assert.rejects(send('event', { event: 'arrival' }), { code: 'EVENT_UNAVAILABLE' });
  const source = { ...play, reference: { image: 'images/example.png' } };
  room.update(source);
  const only = room.readState();
  assert.equal(only.referenceOnly, true);
  assert.deepEqual([only.players, only.events, only.ball.position], [[], [], null]);
  assert.equal(only.available.focus, false);
  await assert.rejects(send('focus', { players: ['X'] }), { code: 'REFERENCE_ONLY' });
  assert.equal((await send('theme', { theme: 'light' })).theme, 'light');
});

test('lesson receipts honor authored focus IDs, hidden answers and masked reference frames, including a teacher read', async t => {
  const play = starterWorkspace().plays[0];
  const { room, send } = open(t, play, createFilmLesson({ workspaceId: 'commands-test' }));
  const lesson = (action, fields = {}) => send('lesson', { action, ...fields });
  const h = play.players.find(player => player.label === 'H').id;
  await send('pin', { time: 2 });
  const added = await lesson('add', { time: 1, focusIds: [h], question: 'Who is deeper?', answer: 'H' });
  assert.equal(added.lesson.selectedIndex, 0);
  assert.deepEqual(added.focusIds, [h]);
  assert.equal(added.questionMasked, true);
  assert.equal(added.reference, null);
  assert.equal(added.pinnedTime, 2);
  assert.equal(Object.hasOwn(added.lesson.stops[0], 'answer'), false);
  assert.equal((await lesson('state', { includeAnswers: true })).lesson.stops[0].answer, 'H');
  assert.equal(Object.hasOwn(room.readState().lesson.stops[0], 'answer'), false);
  const revealed = await lesson('reveal', { index: 0 });
  assert.equal(revealed.reference.time, 2);
  assert.equal(revealed.lesson.stops[0].answer, 'H');
  assert.equal((await lesson('hide')).reference, null);
  await lesson('update', { answer: '' });
  assert.equal((await lesson('state', { includeAnswers: true })).lesson.stops[0].answer, '');
  const before = room.readState();
  await assert.rejects(lesson('replace', { focusIds: ['H'] }), { code: 'PLAYER_NOT_FOUND' });
  await assert.rejects(lesson('select', { index: 2 }), { code: 'LESSON_SELECTION' });
  assert.deepEqual(room.readState(), before);
});
