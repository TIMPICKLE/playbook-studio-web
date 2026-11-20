import test from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { openFilmRoom } from '../web/coach-film-room.js';
import { createFilmLesson } from '../web/coach-film-lesson.js';
import { starterWorkspace } from '../web/model.js';

function session(options = {}) {
  const win = new Window(), doc = win.document;
  const original = doc.createElement('button');
  doc.body.append(original);
  original.focus();
  const play = options.play || starterWorkspace().plays[0];
  const room = openFilmRoom({doc, play, ...options});
  const q = selector => doc.querySelector('#coach-film-room ' + selector);
  const click = selector => q(selector).click();
  const key = value => q('.film-title').dispatchEvent(new win.KeyboardEvent('keydown', {key:value, bubbles:true}));
  const at = () => Number(q('[data-film-clock]').dataset.seconds);
  const actor = name => play.players.find(player => player.label === name).id;
  const pick = name => click(`[data-film-pick="${actor(name)}"]`);
  const range = q('input[data-film-time]');
  const seek = time => {
    range.value = time;
    range.dispatchEvent(new win.Event('input'));
    range.dispatchEvent(new win.Event('change'));
  };
  return {win,doc,original,play,room,q,click,key,at,actor,pick,range,seek,
    async close() {room.close(); await win.happyDOM.abort();}
  };
}

test('a pinned reference is scoped to one play revision and survives scrubbing, theme changes and unrelated roster edits', async () => {
  const s = session();
  try {
    s.click('[data-film-event=release]'); s.pick('H'); s.pick('Y');
    s.click('[data-film-action=pin]'); s.seek(1);
    assert.match(s.q('[data-film-reference]').textContent, /2\.0.*3\.0/);
    assert.match(s.q('[data-film-comparison]').textContent, /H.*Y.*1\.0/);
    s.click('[data-film-action=theme]');
    s.room.update(s.play, {roster:[{id:'unbound', name:'New roster member'}]});
    assert.equal(s.at(), 1);
    assert.equal(s.q('[data-film-action=pin]').getAttribute('aria-pressed'), 'true');

    s.play.routes.find(route => route.playerId === s.actor('H')).points[1].y = 45;
    s.room.update(s.play);
    assert.equal(s.at(), 1);
    assert.equal(s.q('[data-film-action=pin]').getAttribute('aria-pressed'), 'false');
    assert.equal(s.q('[data-film-reference]').hidden, true);
    assert.equal(s.q('[data-film-update]').hidden, false);
    assert.equal(s.doc.querySelectorAll('.film-roster [aria-pressed=true]').length, 2);
    assert.doesNotMatch(s.q('[data-film-comparison]').textContent, /1\.0/);
  } finally { await s.close(); }
});

test('an explicitly selected event follows its new source time; an arbitrary scrub stays at its own time', async () => {
  const s = session();
  try {
    s.click('[data-film-event=release]');
    s.play.ball.passAt = 1.75;
    s.room.update(s.play);
    assert.equal(s.at(), 1.75);
    assert.equal(s.q('[data-film-event=release]').getAttribute('aria-current'), 'step');
    s.seek(1.75);
    s.play.ball.passAt = 1.25;
    s.room.update(s.play);
    assert.equal(s.at(), 1.75);
    assert.equal(s.q('[data-film-phase]').dataset.phase, 'flight');
  } finally { await s.close(); }
});

test('event labels, freeze clock, reference and discrete screen-reader updates preserve the authored time', async () => {
  const play = starterWorkspace().plays[0];
  play.ball.passAt = 2.35;
  const s = session({play});
  try {
    assert.equal(s.q('[data-film-event=release] time').textContent, '2.35s');
    s.click('[data-film-event=release]');
    assert.equal(s.q('[data-film-clock]').textContent, '2.35 / 6.0 s');
    s.pick('H'); s.pick('Y');
    const announcement = s.q('[data-film-announcement]');
    assert.match(announcement.textContent, /2\.35.*H.*Y.*3\.0/);
    s.click('[data-film-action=pin]');
    assert.match(s.q('[data-film-reference]').textContent, /2\.35/);
    s.seek(1.25);
    assert.match(announcement.textContent, /1\.25.*H.*Y/);
    const last = announcement.textContent;
    s.click('[data-film-action=play]');
    assert.equal(s.q('[data-film-clock]').textContent, '1.3 / 6.0 s');
    assert.equal(announcement.textContent, last, 'continuous playback should not speak each frame');
  } finally { await s.close(); }
});

test('distinct events at the same timestamp are individually reachable, and native close restores the original control', async () => {
  const play = starterWorkspace().plays[0];
  play.ball.passAt = 0;
  const s = session({play});
  try {
    assert.equal(s.q('[data-film-event=start]').getAttribute('aria-current'), 'step');
    s.key(']');
    assert.equal(s.at(), 0);
    assert.equal(s.q('[data-film-event=release]').getAttribute('aria-current'), 'step');
    s.key('[');
    assert.equal(s.q('[data-film-event=start]').getAttribute('aria-current'), 'step');
    s.doc.querySelector('dialog').close();
    assert.equal(s.room.isOpen(), false);
    assert.equal(s.doc.activeElement, s.original);
  } finally { await s.close(); }
});

test('one animation slot owns playback and coalesces scrub bursts; the final input and backgrounding settle', async () => {
  const s = session();
  try {
    const scheduled = new Map();
    let ticket = 0;
    s.win.requestAnimationFrame = callback => { scheduled.set(++ticket, callback); return ticket; };
    s.win.cancelAnimationFrame = id => scheduled.delete(id);
    const advance = stamp => {
      assert.equal(scheduled.size, 1);
      const [[id, callback]] = scheduled;
      scheduled.delete(id);
      callback(stamp);
    };
    s.click('[data-film-action=play]');
    advance(100); advance(2100);
    assert.equal(s.at(), 2);
    for (const time of [.25, 4, 2.5]) {
      s.range.value = time;
      s.range.dispatchEvent(new s.win.Event('input'));
    }
    assert.equal(scheduled.size, 0, 'the first input cancels playback and can settle before the next rAF');
    s.range.dispatchEvent(new s.win.Event('change'));
    assert.equal(scheduled.size, 0);
    assert.equal(s.at(), 2.5);
    assert.equal(s.q('[data-film-phase]').dataset.phase, 'flight');
    s.click('[data-film-action=play]');
    Object.defineProperty(s.doc, 'hidden', {configurable:true, value:true});
    s.doc.dispatchEvent(new s.win.Event('visibilitychange'));
    assert.equal(scheduled.size, 0);
    assert.equal(s.at(), 2.5);
  } finally { await s.close(); }
});

test('a delayed display tick cannot postpone the first scrub, the pending deadline, or pointer release', async () => {
  const s = session(), frames = new Map(), timers = new Map();
  const {win, range} = s, pitch = s.q('.film-pitch');
  const now = Object.getOwnPropertyDescriptor(win.performance, 'now');
  const originalTimer = win.setTimeout, originalClear = win.clearTimeout;
  let stamp = 1000, sequence = 0;
  Object.defineProperty(win.performance, 'now', {configurable:true, value:() => stamp});
  win.requestAnimationFrame = fn => { frames.set(++sequence, fn); return sequence; };
  win.cancelAnimationFrame = id => frames.delete(id);
  win.setTimeout = (fn, delay) => { timers.set(++sequence, {fn, delay}); return sequence; };
  win.clearTimeout = id => timers.delete(id);
  const input = time => { range.value = String(time); range.dispatchEvent(new win.Event('input')); };
  try {
    input(.75); input(2.5);
    assert.equal(pitch.dataset.filmTime, '0');
    await Promise.resolve();
    assert.equal(pitch.dataset.filmTime, '2.5');
    assert.equal(timers.size + frames.size, 0);

    stamp++;
    for (let i = 0; i <= 18; i++) { input(1 + i / 100); await Promise.resolve(); }
    assert.equal(pitch.dataset.filmTime, '2.5');
    assert.equal(frames.size, 1); assert.equal(timers.size, 1);
    const [lateFrame] = frames.values(), [deadline] = timers.values();
    assert.ok(deadline.delay > 0 && deadline.delay <= 34);
    stamp += deadline.delay;
    deadline.fn();
    assert.equal(pitch.dataset.filmTime, '1.18');
    assert.equal(timers.size + frames.size, 0);

    stamp++;
    input(.4);
    lateFrame(stamp);
    assert.equal(pitch.dataset.filmTime, '1.18');
    range.value = '.35'; range.dispatchEvent(new win.Event('pointerup'));
    assert.equal(pitch.dataset.filmTime, '0.35');
    assert.equal(timers.size + frames.size, 0);

    Object.defineProperty(s.doc, 'hidden', {configurable:true, value:true});
    s.doc.dispatchEvent(new win.Event('visibilitychange'));
    input(2); await Promise.resolve();
    assert.equal(pitch.dataset.filmTime, '0.35');
    delete s.doc.hidden;
    s.doc.dispatchEvent(new win.Event('visibilitychange'));
    assert.equal(pitch.dataset.filmTime, '2');

    stamp++;
    input(1); s.room.close();
    assert.equal(timers.size + frames.size, 0, 'closing cancels a pending presentation');
  } finally {
    if (now) Object.defineProperty(win.performance, 'now', now); else delete win.performance.now;
    win.setTimeout = originalTimer; win.clearTimeout = originalClear;
    await s.close();
  }
});

test('public actions and manual changes observe the same frozen frame, comparison and controls', async () => {
  const s = session();
  const perform = (operation, params = {}) => s.room.perform({operation, ...params});
  try {
    await perform('event', {event:'release'});
    const atRelease = await perform('focus', {players:['H','Y']});
    const expected = [s.actor('H'), s.actor('Y')];
    assert.deepEqual(atRelease.focusIds, expected);
    assert.equal(atRelease.time, s.at());
    assert.equal(atRelease.ball.phase, s.q('[data-film-phase]').dataset.phase);
    assert.equal(atRelease.comparison.gapYards, 3);
    assert.match(s.q('[data-film-comparison]').textContent, /3\.0/);
    assert.deepEqual(await perform('pin'), await perform('pin'));

    s.seek(1);
    const atOne = s.room.readState();
    assert.equal(atOne.comparison.gapYards, 1);
    assert.equal(atOne.reference.comparison.gapYards, 3);
    atOne.focusIds.pop();
    assert.deepEqual(s.room.readState().focusIds, expected);
    s.pick('X');
    assert.equal(s.q('.film-replace').hidden, false);
    const kept = await perform('cancelReplacement');
    assert.deepEqual(kept.focusIds, expected);
    assert.equal(s.q('.film-replace').hidden, true);
    await perform('replaceFocus', {player:'X', replace:'H'});
    assert.equal(s.q('[data-film-pick="' + s.actor('X') + '"]').getAttribute('aria-pressed'), 'true');
    await perform('speed', {speed:.5});
    assert.equal(s.q('[data-film-speed]').value, '0.5');
    await perform('theme', {theme:'light'});
    assert.equal(s.q('.film-field').dataset.theme, 'light');
    assert.equal((await perform('play')).playing, true);
    assert.equal((await perform('play')).playing, true);
    assert.equal(s.q('[data-film-action=play]').dataset.state, 'pause');
    await perform('pause');
    assert.equal(s.q('[data-film-action=play]').dataset.state, 'play');
    await perform('close');
    assert.deepEqual(s.room.readState(), {version:1, open:false});
  } finally { await s.close(); }
});

test('an explicit lesson attachment reuses the open room and delegates the actual saved, masked and revealed stops', async () => {
  const s = session();
  const lesson = (action, params = {}) => s.room.perform({operation:'lesson', action, ...params});
  try {
    assert.equal(s.q('.film-lesson'), null);
    assert.equal(s.room.attachLesson(createFilmLesson({workspaceId:'test'})), true);
    assert.equal(s.room.attachLesson(createFilmLesson({workspaceId:'test'})), true);
    assert.equal(s.q('.film-actions').querySelectorAll('[data-lesson-action=toggle]').length, 1);
    await lesson('open');
    await lesson('add', {time:2, focusIds:[s.actor('H'),s.actor('Y')], question:'Who is deeper?', answer:'H'});
    assert.equal(s.at(), 2);
    assert.equal(s.q('.film-lesson-question').textContent, 'Who is deeper?');
    assert.equal(s.q('.film-lesson-answer').textContent, '');
    assert.equal(s.room.readState().lesson.revealed, false);
    await lesson('reveal');
    assert.equal(s.q('.film-lesson-answer').textContent, 'H');
    assert.equal(s.room.readState().lesson.revealed, true);
    await lesson('save');
    assert.equal(s.win.localStorage.length, 1);
    s.room.update({...s.play, title:'Renamed'});
    assert.equal(s.q('.film-actions').querySelectorAll('[data-lesson-action=toggle]').length, 1);
    assert.equal(s.room.readState().lesson.open, false);
    await lesson('open');
    await lesson('load');
    assert.equal(s.q('.film-lesson-question').textContent, 'Who is deeper?');
    s.room.close();
    assert.equal(s.doc.querySelector('[data-lesson-action=toggle]'), null);
  } finally { await s.close(); }
});
