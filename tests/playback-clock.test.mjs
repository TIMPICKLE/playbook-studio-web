import test from 'node:test';
import assert from 'node:assert/strict';
import { editor, actorId } from './helpers/coach-film-editor.mjs';
import { starterWorkspace } from '../web/model.js';

function controlledDisplay(t, win) {
  const frames = new Map();
  let wall = 0, ticket = 0;
  t.mock.method(win.performance, 'now', () => wall);
  t.mock.method(win, 'requestAnimationFrame', draw => { frames.set(++ticket, draw); return ticket; });
  t.mock.method(win, 'cancelAnimationFrame', id => frames.delete(id));
  return {
    at(ms) { wall = ms; },
    tick(ms) {
      wall = ms;
      const callbacks = [...frames.values()];
      frames.clear();
      for (const draw of callbacks) draw(ms);
    },
    queued() { return [...frames.values()]; },
  };
}

async function transport(t, pilot) {
  const seed = starterWorkspace(), h = actorId(seed.plays[0], 'H');
  const f = await editor(t, {pilot, seed});
  const film = pilot === 'film';
  if (film) await f.openFilm();
  else f.action('rehearse-mode');
  const range = () => f.node(film ? 'input[data-film-time]' : '#timeline');
  const time = () => Number(film ? f.node('[data-film-clock]').dataset.seconds : range().value);
  const seek = value => {
    range().value = String(value);
    f.emit(range(), 'input'); f.emit(range(), 'change');
  };
  return {
    ...f, display:controlledDisplay(t, f.win), time, seek,
    speed: rate => f.change(film ? '[data-film-speed]' : '#speed', rate),
    toggle: () => f.click(film ? '[data-film-action="play"]' : '[data-action="play"]'),
    running: () => film ? f.node('[data-film-action="play"]').dataset.state === 'pause' : f.node('.playback').classList.contains('is-playing'),
    position: () => f.node(film ? '[data-film-player="'+h+'"]' : '#field [data-player="'+h+'"]').getAttribute('transform'),
    release() {
      if (film) f.click('[data-film-event="release"]');
      else if (pilot === 'events') f.action('film-pilot-event:release');
      else seek(2);
    },
    hidden(value) {
      Object.defineProperty(f.doc, 'hidden', {configurable:true, value});
      f.doc.dispatchEvent(new f.win.Event('visibilitychange'));
    },
  };
}

for (const pilot of ['baseline','events','film']) {
  test(pilot + ' reaches the same Mesh release frame after two wall seconds, including a one-Hz display', async t => {
    const s = await transport(t, pilot);
    s.release();
    const releasePosition = s.position();
    s.seek(0);
    assert.notEqual(s.position(), releasePosition);
    let origin = 0;
    for (const hz of [60, 1]) {
      s.seek(0);
      s.display.at(origin);
      s.toggle();
      for (let i = 1; i <= 2 * hz; i++) s.display.tick(origin + 1000 * i / hz);
      assert.equal(s.time(), 2);
      assert.equal(s.position(), releasePosition, 'the played route matches the deliberately selected release');
      s.toggle();
      origin += 2000;
    }
  });

  test(pilot + ' settles speed, pause, event seeks and backgrounding at the instant of the action', async t => {
    const s = await transport(t, pilot), d = s.display;
    s.toggle();
    d.tick(1000);
    assert.equal(s.time(), 1, 'the first callback may arrive a second after Play');
    d.at(1250); s.speed(2);
    assert.equal(s.time(), 1.25);
    d.tick(2000); assert.equal(s.time(), 2.75);
    d.tick(3000); assert.equal(s.time(), 4.75);
    d.at(3250); s.toggle();
    assert.equal(s.time(), 5.25, 'pause samples the previous 0.25 s at double speed');
    d.tick(10000); assert.equal(s.time(), 5.25);
    s.toggle();
    const stale = d.queued();
    d.at(10120); s.release();
    assert.equal(s.time(), 2); assert.equal(s.running(), false);
    s.toggle();
    d.at(10200);
    for (const deliveredAfterSeek of stale) deliveredAfterSeek(10200);
    assert.equal(s.time(), 2, 'a cancelled run cannot draw an older frame over a fresh seek');
    d.at(10370); s.hidden(true);
    d.tick(43000); s.hidden(false);
    assert.equal(s.time(), 2.5);
    assert.equal(s.running(), false);
    s.toggle();
    d.tick(44000); assert.equal(s.time(), 4.5);
    d.tick(45000); assert.equal(s.time(), 6);
    assert.equal(s.running(), false);
  });
}

test('disabling an active editor loop keeps its current lap and stopping does not gain another frame', async t => {
  const s = await transport(t, 'baseline'), d = s.display;
  s.seek(4);
  s.action('loop'); s.toggle();
  d.tick(13500); assert.equal(s.time(), 5.5);
  d.at(13750); s.action('loop');
  assert.equal(s.time(), 5.75);
  d.tick(14000); assert.equal(s.time(), 6);
  assert.equal(s.running(), false);
  s.toggle();
  d.tick(14500); assert.equal(s.time(), .5, 'play from the end restarts the complete play');
  d.at(14750); s.win.dispatchEvent(new s.win.Event('pagehide'));
  d.tick(20000);
  assert.equal(s.time(), .75);
  assert.equal(s.running(), false);
});

test('pinning between film frames freezes the exact same instant on the clock, field and reference', async t => {
  const s = await transport(t, 'film'), d = s.display;
  s.toggle(); d.tick(1000);
  d.at(1250); s.click('[data-film-action="pin"]');
  assert.equal(s.time(), 1.25);
  assert.equal(s.node('.film-pitch').dataset.filmTime, '1.25');
  assert.match(s.node('[data-film-reference]').textContent, /1\.25/);
  assert.equal(s.running(), false);
  s.toggle();
  const discarded = d.queued();
  s.closeFilm();
  d.at(2500); await s.openFilm();
  for (const stale of discarded) stale(2500);
  assert.equal(s.time(), 0);
  assert.equal(s.running(), false);
});
