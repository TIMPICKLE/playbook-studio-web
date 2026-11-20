import assert from 'node:assert/strict';
import test from 'node:test';
import { setImmediate as tick } from 'node:timers/promises';
import { Window } from 'happy-dom';
import { createFilmLesson } from '../web/coach-film-lesson.js';
import { createFilmModel } from '../web/coach-film-model.js';
import { starterWorkspace } from '../web/model.js';

function fixture(t) {
  const win = new Window({url:'https://board.example'});
  t.after(() => win.happyDOM.abort());
  const doc = win.document;
  doc.body.innerHTML = '<dialog class="coach-film"><header class="film-actions"></header><aside class="film-inspector"></aside></dialog>';
  const room = doc.querySelector('dialog');
  const play = starterWorkspace().plays[0];
  const ids = play.players.filter(p => p.label === 'H' || p.label === 'Y').map(p => p.id);
  const host = room.querySelector('header');
  let adapter, model, clock = { time: 2, focusIds: ids.slice() };
  const positions = [];
  function mount(workspaceId = 'team-a', source = play) {
    adapter?.dispose();
    model = createFilmModel(source);
    adapter = createFilmLesson({workspaceId}).mount({
      host, model, read: () => clock,
      go(time, focusIds) { positions.push({ time, focusIds }); clock = {time, focusIds}; },
    });
    if (!model.reference) click('toggle');
  }
  const control = action => room.querySelector('[data-lesson-action="' + action + '"]');
  const click = action => control(action).click();
  const step = (time,focusIds = ids) => { clock = { time, focusIds }; };
  function submit(question, answer) {
    room.querySelector('textarea[name=question]').value = question;
    room.querySelector('textarea[name=answer]').value = answer;
    room.querySelector('form').dispatchEvent(new win.Event('submit', {bubbles:true,cancelable:true}));
  }
  function add(time, question, answer = '', focusIds = ids) {
    step(time, focusIds);
    click('add'); submit(question, answer);
  }
  const status = () => room.querySelector('.film-lesson-status').textContent;
  async function settled(message) {
    if (status().includes(message)) return;
    await new Promise((resolve, reject) => {
      const observer = new win.MutationObserver(() => {
        if (!status().includes(message)) return;
        observer.disconnect(); clearTimeout(deadline); resolve();
      });
      const deadline = setTimeout(() => {
        observer.disconnect(); reject(new Error('Expected ' + message + ', saw ' + status()));
      }, 5000);
      observer.observe(room.querySelector('.film-lesson-status'), { childList: true, subtree: true, characterData: true });
    });
  }
  mount();
  t.after(() => adapter?.dispose());
  return {
    win, room, play, ids, positions, mount, click, add, submit, step, control, settled,
    command: (action, fields = {}) => adapter.execute({ kind: 'lesson_' + action, ...fields }),
    snapshot: options => adapter.snapshot(options), dispose: () => adapter.dispose(),
  };
}

test('teach up to three stops using actual times and players, hide future routes, reveal and recapture', async t => {
  const f = fixture(t);
  f.add(2, '谁的纵深更大？', 'H 比 Y 深 3 码。');
  assert.equal(f.room.querySelector('.film-lesson-question').textContent, '谁的纵深更大？');
  assert.equal(f.room.querySelector('.film-lesson-answer').textContent, '');
  assert.equal(f.room.hasAttribute('data-film-question'), true);
  assert.deepEqual(f.positions.at(-1), {time:2,focusIds:f.ids});
  f.click('reveal');
  assert.match(f.room.querySelector('.film-lesson-answer').textContent, /深 3 码/);
  assert.equal(f.room.hasAttribute('data-film-question'), false);
  f.add(.73, '何时转向？', '', f.ids.slice(0,1));
  assert.equal(f.room.hasAttribute('data-film-question'), true);
  assert.equal(f.control('reveal').textContent, '揭示走势');
  f.click('reveal');
  assert.equal(f.room.hasAttribute('data-film-question'), false);
  f.add(3, '球到谁手里？');
  assert.equal(f.control('add').disabled, true);
  f.click('previous');
  assert.deepEqual(f.positions.at(-1), {time:.73,focusIds:f.ids.slice(0,1)});
  f.click('next'); f.click('stop-0');
  assert.deepEqual(f.positions.at(-1), {time:2,focusIds:f.ids});
  f.step(1.7, []); f.click('revisit');
  assert.equal(f.positions.at(-1).time, 2);
  f.step(2.07, []); f.click('replace'); f.click('revisit');
  assert.deepEqual(f.positions.at(-1), {time:2.07,focusIds:[]});
  f.click('edit'); f.submit('新提问', '新答案');
  assert.equal(f.positions.at(-1).time, 2.07);
  f.click('toggle');
  assert.equal(f.room.hasAttribute('data-film-question'), false);
  f.step(4, f.ids);
  f.click('toggle');
  assert.deepEqual(f.positions.at(-1), { time: 2.07, focusIds: [] });
  assert.equal(f.room.hasAttribute('data-film-question'), true);
  f.click('remove');
  assert.equal(f.control('add').disabled, false);
  assert.deepEqual(f.positions.at(-1), {time:.73,focusIds:f.ids.slice(0,1)});
  f.dispose();
  assert.equal(f.room.hasAttribute('data-film-question'), false);
  assert.equal(f.room.querySelector('.film-lesson'), null);
});

test('only explicit saves persist, loads are scoped and block changed geometry or timing', async t => {
  const f = fixture(t);
  const storage = f.win.localStorage;
  f.add(2, '<img src=x onerror=alert(1)>', 'A');
  assert.equal(storage.length, 0);
  assert.equal(f.room.querySelector('.film-lesson img'), null);
  f.click('save'); await f.settled('已保存');
  assert.equal(storage.length, 1);
  const same = structuredClone(f.play);
  same.notes += ' a meeting note';
  same.players = same.players.map(player => Object.fromEntries(Object.entries(player).reverse()));
  f.mount('team-a', same);
  assert.ok(f.room.querySelector('.film-lesson-question').hidden);
  const prior = storage.getItem(storage.key(0));
  await f.command('save');
  assert.equal(storage.getItem(storage.key(0)), prior);
  const interrupted = f.command('load');
  await f.command('close');
  await assert.rejects(interrupted, { code:'LESSON_CANCELLED' });
  assert.equal(f.snapshot().open, false);
  assert.equal(f.snapshot().stops.length, 0);
  await f.command('open');
  f.click('load'); await f.settled('已加载');
  assert.equal(f.room.querySelector('.film-lesson-question').textContent, '<img src=x onerror=alert(1)>');
  assert.equal(f.room.querySelector('.film-lesson img'), null);
  assert.equal(f.room.hasAttribute('data-film-question'), true);
  f.mount('team-b', same); f.click('load'); await f.settled('还没有');
  f.mount('team-a', { ...same, id: 'another-play' }); f.click('load'); await f.settled('还没有');
  same.ball.passAt = 1.8;
  const jumpCount = f.positions.length;
  f.mount('team-a', same); f.click('load'); await f.settled('已过期');
  assert.equal(f.positions.length, jumpCount);
  same.ball.passAt = 2; same.routes[0].points[1].x += 1;
  f.mount('team-a', same); f.click('load'); await f.settled('已过期');
  assert.equal(f.positions.length, jumpCount);
  f.mount('team-a', { reference: {}, players: [], routes: [], id: 'reference-only' });
  assert.equal(f.control('toggle'), null);
});

test('bounded text and checked stop coordinates survive corrupt storage, conflicts and disposal', async t => {
  const f = fixture(t);
  const {localStorage: storage} = f.win;
  f.add(1, '   ');
  assert.match(f.room.querySelector('.film-lesson-status').textContent, /请先/);
  f.submit('q'.repeat(200), 'a'.repeat(500));
  f.click('save'); await f.settled('已保存');
  const key = storage.key(0), raw = storage.getItem(key), serialized = JSON.parse(raw);
  assert.equal(serialized.stops[0].question.length, 160);
  assert.equal(serialized.stops[0].answer.length, 320);
  serialized.stops[0].time = 7;
  storage.setItem(key, JSON.stringify(serialized));
  f.add(2, 'from this window');
  f.click('save'); await f.settled('另一窗口');
  assert.equal(JSON.parse(storage.getItem(key)).stops.length, 1);
  f.click('load'); await f.settled('无法读取');
  assert.equal(f.room.querySelector('.film-lesson-question').textContent, 'from this window');
  storage.setItem(key, raw);
  f.mount(); f.add(0, 'cancelled'); f.click('save'); f.dispose();
  await tick();
  assert.equal(storage.getItem(key), raw);
});

test('lesson commands and the UI share stops, masks, authored text, exact frames and persisted revisions', async t => {
  const f = fixture(t);
  await f.command('close');
  assert.equal((await f.command('state')).open, false);
  assert.equal((await f.command('open')).open, true);
  const first = await f.command('add', { time: 2.35, focusIds: f.ids, question: '  First  ', answer: '  H  ' });
  assert.deepEqual(first.stops, [{ time: 2.35, focusIds: f.ids, question: 'First', hasAnswer: true }]);
  first.stops[0].focusIds.pop();
  assert.deepEqual(f.snapshot().stops[0].focusIds, f.ids);
  assert.equal(f.room.hasAttribute('data-film-question'), true);
  assert.equal(f.room.querySelector('.film-lesson-question').textContent, 'First');
  assert.equal((await f.command('state', { includeAnswers: true })).stops[0].answer, 'H');
  f.click('reveal');
  assert.equal(f.snapshot().stops[0].answer, 'H');
  assert.equal((await f.command('hide')).stops[0].answer, undefined);
  await f.command('update', { answer: '' });
  assert.equal(f.snapshot().stops[0].hasAnswer, false);
  assert.equal(f.control('reveal').textContent, '揭示走势');
  await f.command('reveal');
  assert.equal(f.room.hasAttribute('data-film-question'), false);
  f.step(1.73, f.ids.slice(0, 1)); await f.command('add', { question: 'Second' });
  assert.equal(f.snapshot().selectedIndex, 1);
  await f.command('previous');
  assert.deepEqual(f.positions.at(-1), { time: 2.35, focusIds: f.ids });
  await f.command('next');
  await f.command('select', { index: 0 });
  f.step(.47, []); await f.command('replace', { focusIds: [f.ids[1]] });
  await f.command('revisit');
  assert.deepEqual(f.positions.at(-1), { time: .47, focusIds: [f.ids[1]] });
  await f.command('update', { index: 1, question: 'Edited' });
  assert.equal(f.room.querySelector('.film-lesson-question').textContent, 'Edited');
  const saved = await f.command('save');
  assert.equal(saved.dirty, false);
  const key = f.win.localStorage.key(0);
  assert.equal(JSON.parse(f.win.localStorage.getItem(key)).stops.length, 2);
  await f.command('remove', { index: 0 });
  assert.equal(f.snapshot().selectedIndex, 0);
  await f.command('close');
  await f.command('load');
  assert.equal(f.snapshot().open, true);
  assert.equal(f.snapshot().stops.length, 2);
  assert.equal(f.room.hasAttribute('data-film-question'), true);
  f.click('edit');
  assert.equal(f.snapshot().drafting, true);
  await assert.rejects(f.command('remove'), { code: 'LESSON_DRAFT' });
  await f.command('cancel');
  assert.equal(f.snapshot().drafting, false);
});

test('invalid and stale AI requests fail with typed errors and preserve transaction state', async t => {
  const f = fixture(t);
  const failure = (op, args, code) => assert.rejects(f.command(op, args), { code });
  await failure('load', {}, 'LESSON_NOT_FOUND');
  await failure('reveal', {}, 'LESSON_SELECTION');
  await failure('select', {}, 'LESSON_SELECTION');
  const clean = f.snapshot();
  for (const args of [
    { question: ' ', time: 2 }, { question: 'q'.repeat(161) }, { question: 'q', answer: 'a'.repeat(321) },
    { question: 'q', time: 6.01 }, { question: 'q', time: NaN }, { question: 'q', time: '2' },
    { question: 'q', focusIds: ['no such player'] }, { question: 'q', focusIds: [f.ids[0], f.ids[0]] },
  ]) await failure('add', args, 'LESSON_INVALID_INPUT');
  assert.deepEqual(f.snapshot(), clean);
  for (let i=0; i<3; i++) await f.command('add', { question: 'q' + i, time: i });
  await failure('add', { question: 'fourth' }, 'LESSON_FULL');
  await failure('next', {}, 'LESSON_SELECTION');
  await failure('update', {}, 'LESSON_INVALID_INPUT');
  const full = f.snapshot();
  await failure('update', { index: 0, question: 'must not commit', answer: null }, 'LESSON_INVALID_INPUT');
  await failure('remove', { index: 3 }, 'LESSON_SELECTION');
  await failure('replace', { time: -1 }, 'LESSON_INVALID_INPUT');
  await failure('dance', {}, 'LESSON_INVALID_ACTION');
  assert.deepEqual(f.snapshot(), full);
  await f.command('save');
  const storage = f.win.localStorage, key = storage.key(0), raw = storage.getItem(key);
  storage.setItem(key, 'wrong');
  await failure('save', {}, 'LESSON_CONFLICT');
  await failure('load', {}, 'LESSON_INVALID_DATA');
  assert.equal(storage.getItem(key), 'wrong');
  storage.setItem(key, raw);
  const changed = structuredClone(f.play);
  changed.routes[0].duration += .1;
  f.mount('team-a', changed);
  await failure('load', {}, 'LESSON_STALE');
  assert.equal(f.snapshot().stops.length, 0);
  f.dispose();
  await failure('add', { question: 'late' }, 'LESSON_DISPOSED');
  f.mount('team-a', { reference: {}, players: [], routes: [], id: 'reference' });
  assert.equal((await f.command('state')).available, false);
  await failure('open', {}, 'LESSON_UNAVAILABLE');
});
