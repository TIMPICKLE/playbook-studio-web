import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Window } from 'happy-dom';
import { pngFrameSVG } from '../web/digital-export.js';
import { starterWorkspace, STORAGE_KEY, encodeWorkspace, passFlightRoute } from '../web/model.js';
import { fieldSVG, updateAnimation, routePath } from '../web/field.js';

function passingPlay() {
  const play = starterWorkspace().plays[0];
  const qb = play.players.find(player => player.id === play.ball.holderId);
  const wr = play.players.find(player => player.id === play.ball.receiverId);
  play.routes.push({ id: 'pass', kind: 'pass', playerId: qb.id, points: [{x:qb.x,y:qb.y},{x:wr.x,y:wr.y}],
    delay: 2, duration: 1, color: '#eeeeee', endCap: 'arrow', smooth: false, optional: false });
  return play;
}

for (const mode of ['traditional', 'digital']) {
  test(`${mode} flat PNG reproduces a paused throw with active route endpoints and the frame's ball`, async t => {
    const win = new Window(), doc = win.document, play = passingPlay();
    t.after(() => win.happyDOM.abort());
    const view = { time: 2.5, settings: { visualMode: mode }, animated: true, rehearsal: true };
    doc.body.innerHTML = fieldSVG(play, view.settings, { time: view.time });
    const onScreen = doc.querySelector('svg');
    updateAnimation(onScreen, play, view.time);
    const ball = onScreen.querySelector('#pitch-ball').getAttribute('transform');
    const positions = [...onScreen.querySelectorAll('[data-player]')].map(item => item.getAttribute('transform'));
    doc.body.innerHTML = pngFrameSVG(doc, play, view);
    const svg = doc.querySelector('svg');
    assert.equal(svg.querySelector('#export-ball').getAttribute('transform'), ball);
    assert.equal(svg.querySelector('[data-route="pass"] .route-stroke').getAttribute('d'), routePath(passFlightRoute(play)));
    assert.deepEqual([...svg.querySelectorAll('[data-player]')].map(item => item.getAttribute('transform')), positions);
    assert.equal(svg.querySelectorAll('.route-stroke').length, play.routes.length);
    assert.equal(svg.querySelectorAll('.digital-decoration').length, Number(mode === 'digital'));
    assert.equal(svg.hasAttribute('data-field-surface'), mode === 'digital');
    if (mode === 'digital') {
      assert.notEqual(svg.querySelector('#export-ball path').getAttribute('transform'), 'rotate(-35)');
      assert.equal(svg.querySelector('.digital-decoration').nextElementSibling.id, 'export-players');
    }
  });
}

test('reduced-motion digital PNG preserves the static catch cue without leaving a flight trail on rewind', async t => {
  const win = new Window(), doc = win.document, play = passingPlay();
  t.after(() => win.happyDOM.abort());
  const view = { settings: { visualMode: 'digital' }, animated: false, rehearsal: true };
  const frame = time => pngFrameSVG(doc, play, { ...view, time });
  const first = frame(3.1);
  doc.body.innerHTML = first;
  assert.ok(doc.querySelector('[data-ball-cue="catch"]'));
  assert.equal(doc.querySelector('[data-ball-trail]').style.display, 'none');
  assert.equal(doc.querySelectorAll('[data-route-progress][opacity="0"]').length, play.routes.length);
  doc.body.innerHTML = frame(2.1);
  assert.ok(doc.querySelector('[data-ball-cue="release"]'));
  assert.equal(doc.querySelector('#export-ball path').getAttribute('transform'), 'rotate(-35)');
  assert.equal(first, frame(3.1));
});

test('the editor PNG action exports the paused clock on a traditional-only phone', async t => {
  const win = new Window({ url: 'http://localhost:3000/local.html#editor', width: 390, height: 844 });
  const doc = win.document, data = starterWorkspace();
  Object.defineProperty(win.navigator, 'userAgent', { configurable: true, value: 'Mozilla/5.0 (iPhone)' });
  win.localStorage.setItem(STORAGE_KEY, encodeWorkspace(data));
  win.localStorage.setItem('playbook-visual-mode','digital');
  win.localStorage.setItem('playbook-studio:onboarding:v1',JSON.stringify({dismissed:true,completed:[]}));
  doc.body.innerHTML = readFileSync(new URL('../web/index.html', import.meta.url),'utf8').split('<body>')[1].split('</body>')[0];
  const env = ['window','document','navigator','localStorage','location','history','Image','requestAnimationFrame','cancelAnimationFrame'];
  const previous = Object.fromEntries(env.map(key => [key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  for (const key of env) Object.defineProperty(globalThis, key, { configurable: true,
    value: ['requestAnimationFrame','cancelAnimationFrame'].includes(key) ? win[key].bind(win) : win[key] });
  // Stop after standalone SVG assembly, immediately before the platform PNG encoder.
  const create = URL.createObjectURL, files = [];
  URL.createObjectURL = blob => { files.push(blob); return 'blob:editor-png'; };
  t.after(async () => {
    URL.createObjectURL = create;
    win.dispatchEvent(new win.Event('pagehide')); await win.happyDOM.abort();
    for (const key of env) { if (previous[key]) Object.defineProperty(globalThis,key,previous[key]); else delete globalThis[key]; }
  });
  await import('../web/app.js?paused-png');
  const action = name => doc.querySelector(`[data-action="${name}"]`).click();
  action('rehearse-mode');
  const slider = doc.querySelector('#timeline'); slider.value = '2.5';
  slider.dispatchEvent(new win.Event('input', {bubbles:true}));
  const shown = doc.querySelector('#pitch-ball').getAttribute('transform');
  action('export'); action('download-png');
  await new Promise(resolve => setImmediate(resolve));
  const blob = files.find(file => file.type === 'image/svg+xml'); assert.ok(blob);
  const output = doc.createElement('template'); output.innerHTML = await blob.text();
  const svg = output.content.firstElementChild;
  assert.equal(svg.querySelector('#export-ball').getAttribute('transform'), shown);
  assert.equal(svg.hasAttribute('data-field-surface'), false);
  assert.equal(svg.querySelector('.digital-decoration'), null);
});

test('a lost WebGL drawing buffer during capture keeps the paused model frame available', async t => {
  const { createDigitalBoard } = await import('../web/digital-board.js');
  const win = new Window(), doc = win.document, play = passingPlay();
  const settings = { visualMode: 'digital' }, time = 2.5;
  win.CanvasRenderingContext2D = class {};
  doc.documentElement.dataset.visualMode = 'digital';
  doc.documentElement.dataset.effects = 'off';
  doc.body.innerHTML = `<div id="field"><div class="pitch-stage">${fieldSVG(play, settings)}</div></div>`;
  const board = createDigitalBoard({ doc, getState: () => ({ play, settings, time, playing: false, rehearsal: true }),
    makeEngine: async () => ({ fullScene: true, status: 'ready', backgroundReady: true,
      mount(svg) { svg.classList.add('digital-ready'); }, draw() {}, destroy() {},
      capture() { throw new Error('Drawing buffer lost'); },
    }) });
  t.after(async () => { board.destroy(); await win.happyDOM.abort(); });
  await board.sync();
  const capture = board.capture();
  assert.equal(capture.fullScene, false); assert.equal(capture.time, time);
  const svg = pngFrameSVG(doc, play, { settings, time, animated:false, rehearsal:true }, capture);
  assert.match(svg, /id="export-ball"/); assert.doesNotMatch(svg, /data-digital-scene/);
});
