import test from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { animatedBall, decodeWorkspace, encodeWorkspace, starterWorkspace, validatePlay } from '../web/model.js';
import { runEditorPlayCommand } from '../web/editor-play-commands.js';
import { boardAssistantInput } from '../web/assistant-provider.js';
import { createFilmModel } from '../web/coach-film-model.js';
import { createFilmLesson } from '../web/coach-film-lesson.js';
import { openFilmRoom } from '../web/coach-film-room.js';
import { editor } from './helpers/coach-film-editor.mjs';

test('old starter defenses retain the legacy candidate without announcing it; explicit returns and passes survive import', () => {
  const book = starterWorkspace();
  book.plays = book.plays.filter(play => play.book === 'defense');
  for (const play of book.plays) {
    assert.equal(play.ball.holderId, '');
    const [first, second] = play.players;
    play.ball.holderId = first.id; // exactly as the old editor serialized its seed
    const restored = validatePlay(play);
    assert.equal(restored.ball.holderId, '');
    assert.equal(restored.ball.unconfirmedHolderId, first.id);
    assert.deepEqual(validatePlay(restored), restored);
    assert.equal(boardAssistantInput({instruction:'Read the play', board:play}).board.ball.holderId, '');
    for (const time of [0, 2, 6]) {
      const frame = createFilmModel(play).frameAt(time);
      assert.equal(frame.phase, 'none');
      assert.equal(frame.ball, null);
      assert.equal(animatedBall(restored, time), null);
    }
    runEditorPlayCommand(restored, {kind:'ball_update', patch:{holderId:first.id}});
    assert.equal(validatePlay(restored).ball.holderId, first.id);
    assert.equal(createFilmModel(restored).frameAt(6).holderId, first.id);
    assert.equal(restored.ball.unconfirmedHolderId, undefined);
    runEditorPlayCommand(restored, {kind:'ball_update', patch:{receiverId:second.id}});
    assert.equal(createFilmModel(validatePlay(restored)).frameAt(3).holderId, second.id);
    runEditorPlayCommand(restored, {kind:'ball_update', patch:{holderId:''}});
    assert.equal(restored.ball.receiverId, '');
    assert.throws(() => runEditorPlayCommand(restored, {kind:'ball_update', patch:{receiverId:second.id}}), /carrier/);

    const customReturn = structuredClone(play);
    customReturn.routes[0].points.at(-1).y += 1;
    assert.equal(validatePlay(customReturn).ball.holderId, first.id, 'authored defensive diagram');
    assert.equal(validatePlay({...play,ball:{...play.ball,holderId:second.id}}).ball.holderId, second.id);
    assert.equal(validatePlay({...play,ball:{...play.ball,receiverId:second.id}}).ball.holderId, first.id);
  }
  for (const play of decodeWorkspace(encodeWorkspace(book)).plays) {
    assert.equal(play.ball.holderId, '');
    assert.equal(play.ball.unconfirmedHolderId, play.players[0].id);
  }
  const offense = starterWorkspace().plays[0];
  offense.players.push({...book.plays[0].players[1]});
  offense.ball.receiverId = offense.players.at(-1).id;
  const caught = createFilmModel(validatePlay(offense)).frameAt(offense.ball.arriveAt);
  assert.equal(caught.phase, 'arrival');
  assert.equal(caught.holderId, offense.players.at(-1).id);
  const defense = validatePlay(book.plays[0]);
  runEditorPlayCommand(defense, {kind:'opponents_set',enabled:true});
  runEditorPlayCommand(defense, {kind:'formation_apply',formation:'3–4'});
  assert.ok(defense.players.some(player => player.label === 'QB'));
  assert.equal(defense.ball.holderId, '', 'changing the defensive front preserves unassigned possession');
  assert.equal(defense.ball.unconfirmedHolderId, undefined);
});

test('the editor and film room let the coach confirm and clear defensive possession from a legacy play', async t => {
  const seed = starterWorkspace();
  seed.plays = seed.plays.filter(play => play.book === 'defense');
  for (const play of seed.plays) play.ball.holderId = play.players[0].id;
  const f = await editor(t, {seed});
  const holder = '[data-ball="holderId"]', receiver = '[data-ball="receiverId"]';
  assert.equal(f.node(holder).value, '');
  assert.equal(f.node(receiver).disabled, true);
  assert.match(f.node('.ball-section summary small').textContent, /DE/);
  assert.equal(f.q('#field #pitch-ball'), null);
  const first = seed.plays[0].players[0].id;
  await f.openFilm();
  for (const event of ['start', 'end']) {
    f.click('[data-film-event="' + event + '"]');
    assert.equal(f.node('[data-film-phase]').dataset.phase, 'none');
    assert.equal(f.node('[data-film-ball]').getAttribute('display'), 'none');
  }
  f.closeFilm();
  f.change(holder, first);
  assert.equal(f.node(receiver).disabled, false);
  assert.ok(f.q('#field #pitch-ball'));
  assert.equal(decodeWorkspace(f.raw()).plays[0].ball.holderId, first);
  await f.openFilm();
  assert.equal(f.node('[data-film-phase]').dataset.phase, 'held');
  assert.match(f.node('[data-film-phase]').textContent, /DE/);
  f.closeFilm();
  f.change(holder, '');
  assert.equal(decodeWorkspace(f.raw()).plays[0].ball.holderId, '');
  assert.equal(f.node(receiver).disabled, true);
  assert.equal(f.q('#field #pitch-ball'), null);
});

function teachingRoom(t) {
  const win = new Window({url:'https://board.example'});
  const doc = win.document;
  const opener = doc.createElement('button');
  doc.body.append(opener);
  opener.focus();
  const play = starterWorkspace().plays[0];
  const room = openFilmRoom({play, doc, lesson:createFilmLesson({workspaceId:'ux-test'})});
  t.after(async () => { room.close(); await win.happyDOM.abort(); });
  const node = selector => { const item = doc.querySelector(selector); assert.ok(item, selector); return item; };
  const button = action => node('[data-lesson-action="' + action + '"]');
  const key = (el, key, options={}) => {
    const event = new win.KeyboardEvent('keydown', {key,bubbles:true,cancelable:true,...options});
    el.dispatchEvent(event);
    return event.defaultPrevented;
  };
  const ask = (action, fields={}) => room.perform({operation:'lesson',action,...fields});
  return {room, doc, win, opener, play, node, button, key, ask};
}

test('Escape unwinds replacement and lesson layers and restores their originating controls', async t => {
  const f = teachingRoom(t);
  const pick = label => f.node('.film-player[aria-label="' + label + '"]');
  for (const name of ['H', 'Y', 'X']) pick(name).click();
  assert.equal(f.node('.film-replace').hidden, false);
  assert.equal(f.key(f.doc.activeElement, 'Escape'), true);
  assert.equal(f.room.isOpen(), true);
  assert.equal(f.node('.film-replace').hidden, true);
  assert.equal(f.doc.activeElement, pick('X'));
  assert.deepEqual([...f.doc.querySelectorAll('.film-player[aria-pressed=true]')].map(n=>n.getAttribute('aria-label')).sort(), ['H','Y']);
  await f.ask('add', {time:2,question:'Keep this stop'});
  for (const [entry, focus] of [['edit','textarea[name=question]'],['add','[data-lesson-action=keep]']]) {
    f.button(entry).click();
    f.node('textarea[name=question]').value = 'Unfiled draft';
    f.node(focus).focus();
    assert.equal(f.key(f.doc.activeElement, 'Escape'), true);
    assert.equal(f.room.readState().lesson.drafting, false);
    assert.equal(f.room.readState().lesson.open, true);
    assert.deepEqual(f.room.readState().lesson.stops.map(s=>s.question), ['Keep this stop']);
    assert.equal(f.doc.activeElement, f.button(entry));
  }
  const cancel = new f.win.Event('cancel',{cancelable:true});
  f.node('#coach-film-room').dispatchEvent(cancel);
  assert.ok(cancel.defaultPrevented);
  assert.equal(f.room.isOpen(), true);
  assert.equal(f.room.readState().lesson.open, false);
  assert.equal(f.doc.activeElement, f.button('toggle'));
  f.key(f.doc.activeElement,'Escape');
  assert.equal(f.room.isOpen(), false);
  assert.equal(f.doc.activeElement, f.opener);
});

test('stop navigation works from the playing field and transport, respects typing and composition, and advertises its keys', async t => {
  const f = teachingRoom(t);
  await f.ask('add',{time:2,question:'Release'});
  await f.ask('add',{time:3,question:'Catch'});
  await f.ask('select',{index:0});
  assert.equal(f.button('previous').getAttribute('aria-keyshortcuts'), 'Alt+ArrowUp');
  assert.equal(f.button('next').getAttribute('aria-keyshortcuts'), 'Alt+ArrowDown');
  const actor = f.node('[data-film-player]');
  actor.focus();
  assert.equal(f.key(actor, 'ArrowDown',{altKey:true}), true);
  assert.equal(f.room.readState().time, 3);
  const timeline = f.node('[data-film-time]');
  assert.equal(f.key(timeline, 'ArrowUp',{altKey:true}), true);
  assert.equal(f.room.readState().time, 2);
  f.button('edit').click();
  const input = f.node('textarea[name=question]');
  input.value = 'Typing';
  assert.equal(f.key(input,'ArrowDown',{altKey:true}), false);
  assert.equal(f.key(input,'Escape',{isComposing:true}), false);
  assert.equal(input.value, 'Typing');
  assert.equal(f.room.readState().lesson.drafting, true);
  assert.equal(f.room.readState().time, 2);
  f.key(input,'Escape');
  f.key(f.doc.activeElement,'Escape');
  assert.equal(f.key(actor, 'ArrowDown',{altKey:true}), false);
});

test('frozen Mesh readings show individual hundredths and the rounded true gap in both themes', async t => {
  const f = teachingRoom(t);
  await f.room.perform({operation:'focus',players:['H','Y']});
  const check = async (time, gap) => {
    await f.room.perform({operation:'seek',time});
    const state = f.room.readState();
    assert.equal(state.comparison.gapYards, gap);
    assert.match(f.node('[data-film-comparison]').textContent, new RegExp(gap.toFixed(1)));
    for (const actor of state.focus) {
      const row = f.node('[data-film-depth="' + actor.id + '"] span');
      assert.equal(Number.parseFloat(row.textContent), Number(actor.depthYards.toFixed(2)));
      assert.match(row.textContent, /\d+\.\d{2}\s/);
    }
  };
  for (const theme of ['light','dark']) {
    await f.room.perform({operation:'theme', theme});
    await check(1,1);
    await check(2,3);
  }
});
