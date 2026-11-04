import test from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { animateAssistantLayer } from '../web/assistant-transition.js';

function fixture(before, after) {
  const win = new Window({ url: 'https://playbook.test/local.html' });
  const doc = win.document;
  const svg = markup => {
    const template = doc.createElement('template');
    template.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg">' + markup + '</svg>';
    return template.content.firstElementChild;
  };
  const beforeSvg = svg(before), layer = svg(after);
  doc.body.append(beforeSvg, layer);
  const callbacks = new Map();
  const mediaListeners = new Set();
  const motionPreference = {
    matches: false,
    addEventListener(type, listener) { if (type === 'change') mediaListeners.add(listener); },
    removeEventListener(type, listener) { if (type === 'change') mediaListeners.delete(listener); },
  };
  win.matchMedia = () => motionPreference;
  const setReducedMotion = value => {
    motionPreference.matches = value;
    for (const listener of [...mediaListeners]) listener({matches:value});
  };
  let next = 0;
  win.requestAnimationFrame = callback => { callbacks.set(++next, callback); return next; };
  win.cancelAnimationFrame = id => callbacks.delete(id);
  const step = time => {
    const pending = [...callbacks.values()]; callbacks.clear();
    for (const callback of pending) callback(time);
  };
  return {win,doc,beforeSvg,layer,callbacks,step,motionPreference,mediaListeners,setReducedMotion};
}

test('GO becomes POST through intermediate geometry while preserving its origin and exact target', async () => {
  const from = 'M10,70 L10,20', to = 'M10,70 L10,40 L30,10';
  const markup = d => '<g data-route="x"><path class="route-hit" d="' + d + '"/><path class="route-stroke" d="' + d + '" marker-end="url(#arrow)"/></g>';
  const f = fixture(markup(from), markup(to));
  const original = f.beforeSvg.outerHTML;
  const animation = animateAssistantLayer(f);
  for (const path of f.layer.querySelectorAll('path')) assert.equal(path.getAttribute('d'), from);
  f.step(0); f.step(310);
  const path = f.layer.querySelector('.route-stroke'), middle = path.getAttribute('d');
  assert.notEqual(middle, from); assert.notEqual(middle, to);
  assert.match(middle, /^M10,70/);
  assert.equal(f.layer.querySelector('.route-hit').getAttribute('d'), middle);
  assert.equal(path.getAttribute('marker-end'), 'url(#arrow)');
  f.step(900);
  assert.deepEqual(await animation.finished, {cancelled:false});
  assert.equal(path.getAttribute('d'), to);
  assert.equal(f.beforeSvg.outerHTML, original);
  assert.equal(f.callbacks.size, 0);
});

test('curved paths morph without replacing their stable route groups', () => {
  const f = fixture(
    '<g data-route="x"><path class="route-stroke" d="M0,0 C0,10 5,20 10,20"/></g>',
    '<g data-route="x"><path class="route-stroke" d="M0,0 L10,10 L20,20"/></g>');
  const group = f.layer.firstElementChild;
  const animation = animateAssistantLayer(f);
  f.step(0); f.step(280);
  assert.ok(!group.querySelector('path').getAttribute('d').includes('NaN'));
  assert.equal(f.layer.firstElementChild, group);
  animation.finish();
  assert.equal(group.querySelector('path').getAttribute('d'), 'M0,0 L10,10 L20,20');
});

test('route color and width interpolate to the exact target styling', () => {
  const f = fixture('<g data-route="x"><path d="M0,0 L0,20" stroke="#fff" stroke-width="2"/></g>',
    '<g data-route="x"><path d="M0,0 L10,10" stroke="#335577" stroke-width="4"/></g>');
  const animation = animateAssistantLayer(f), path = f.layer.querySelector('path');
  assert.equal(path.getAttribute('stroke'), '#ffffff');
  assert.equal(path.getAttribute('stroke-width'), '2');
  f.step(0); f.step(310);
  assert.notEqual(path.getAttribute('stroke'), '#ffffff');
  assert.notEqual(path.getAttribute('stroke'), '#335577');
  animation.finish();
  assert.equal(path.getAttribute('stroke'), '#335577');
  assert.equal(path.getAttribute('stroke-width'), '4');
});

test('new lines draw and deleted lines fade while optional route dashes remain intact', async () => {
  const f = fixture('', '<g data-route="new"><path class="route-stroke" d="M0,0 L10,20" marker-end="url(#arrow)" pathLength="1"/></g>' +
    '<g data-route="optional"><path class="route-stroke" d="M5,0 L20,30" stroke-dasharray="9 6"/></g>' +
    '<g data-route="old" data-removing><path class="route-stroke" d="M20,0 L30,10"/></g>');
  const animation = animateAssistantLayer(f), line = f.layer.querySelector('[data-route="new"] path');
  assert.equal(line.getAttribute('stroke-dashoffset'), '1');
  assert.equal(line.hasAttribute('marker-end'), false);
  assert.equal(f.layer.querySelector('[data-route="optional"] path').getAttribute('stroke-dasharray'), '9 6');
  f.step(0); f.step(300);
  assert.ok(Number(line.getAttribute('stroke-dashoffset')) > 0 && Number(line.getAttribute('stroke-dashoffset')) < 1);
  f.step(900); await animation.finished;
  assert.equal(line.getAttribute('marker-end'), 'url(#arrow)');
  assert.equal(line.hasAttribute('stroke-dashoffset'), false);
  assert.equal(line.hasAttribute('stroke-dasharray'), false);
  assert.equal(line.getAttribute('pathLength'), '1');
  assert.equal(f.layer.querySelector('[data-removing]').getAttribute('opacity'), '0');
});

test('players, coverage regions and annotations move with the same presentation clock', () => {
  const before = '<g data-player="x" transform="translate(10 20)"/><g data-zone="z"><ellipse cx="10" cy="20" rx="5" ry="6"/><text x="10" y="20">DEEP</text></g><g data-annotation="a"><text x="2" y="3">Read</text></g>';
  const after = '<g data-player="x" transform="translate(30 40)"/><g data-zone="z"><ellipse cx="30" cy="40" rx="8" ry="9"/><text x="30" y="40">DEEP</text></g><g data-annotation="a"><text x="8" y="9">Read</text></g>';
  const f = fixture(before, after), animation = animateAssistantLayer(f);
  f.step(0); f.step(310);
  assert.notEqual(f.layer.querySelector('[data-player]').getAttribute('transform'), 'translate(30 40)');
  const x = Number(f.layer.querySelector('ellipse').getAttribute('cx'));
  assert.ok(x > 10 && x < 30);
  animation.finish();
  assert.equal(f.layer.querySelector('[data-player]').getAttribute('transform'), 'translate(30 40)');
  assert.equal(f.layer.querySelector('ellipse').getAttribute('cx'), '30');
  assert.equal(f.layer.querySelector('[data-annotation] text').getAttribute('x'), '8');
});

test('cancellation retains the visible intermediate path and clears its pending frame', async () => {
  const f = fixture('<g data-route="x"><path d="M0,0 L0,20"/></g>', '<g data-route="x"><path d="M0,0 L10,10 L20,10"/></g>');
  const animation = animateAssistantLayer(f);
  f.step(0); f.step(230);
  const visible = f.layer.querySelector('path').getAttribute('d');
  animation.cancel();
  assert.deepEqual(await animation.finished, {cancelled:true});
  assert.equal(f.callbacks.size, 0);
  assert.equal(f.mediaListeners.size, 0);
  f.step(1000);
  assert.equal(f.layer.querySelector('path').getAttribute('d'), visible);
});

test('the explicit reduced-motion option settles exact geometry without scheduling frames', async () => {
  const f = fixture('<g data-route="x"><path d="M0,0 L0,20"/></g>', '<g data-route="x"><path d="M0,0 L10,10"/></g>');
  const reduced = animateAssistantLayer({...f,reducedMotion:true});
  await reduced.finished;
  assert.equal(f.callbacks.size, 0);
  assert.equal(f.mediaListeners.size, 0);
  assert.equal(f.layer.querySelector('path').getAttribute('d'), 'M0,0 L10,10');
});

test('traditional decorative effects off keeps route-change intermediate frames', async () => {
  const f = fixture('<g data-route="x"><path d="M0,0 L0,20"/></g>', '<g data-route="x"><path d="M0,0 L10,10"/></g>');
  f.doc.documentElement.dataset.effects = 'off';
  const active = animateAssistantLayer(f);
  f.doc.dispatchEvent(new f.win.Event('playbook:effects-changed'));
  f.step(0); f.step(310);
  const middle = f.layer.querySelector('path').getAttribute('d');
  assert.notEqual(middle, 'M0,0 L0,20');
  assert.notEqual(middle, 'M0,0 L10,10');
  assert.equal(f.callbacks.size, 1);
  f.step(900);
  assert.deepEqual(await active.finished, {cancelled:false});
  assert.equal(f.callbacks.size, 0);
  assert.equal(f.mediaListeners.size, 0);
  assert.equal(f.layer.querySelector('path').getAttribute('d'), 'M0,0 L10,10');
});

test('a live system reduce preference ends the route change and removes its listener', async () => {
  const f = fixture('<g data-route="x"><path d="M0,0 L0,20"/></g>', '<g data-route="x"><path d="M0,0 L10,10"/></g>');
  const active = animateAssistantLayer(f);
  f.step(0); f.step(200);
  assert.equal(f.mediaListeners.size, 1);
  f.setReducedMotion(true);
  assert.deepEqual(await active.finished, {cancelled:false});
  assert.equal(f.callbacks.size, 0);
  assert.equal(f.mediaListeners.size, 0);
  assert.equal(f.layer.querySelector('path').getAttribute('d'), 'M0,0 L10,10');
});

test('an existing system reduce preference skips the route-change animation', async () => {
  const f = fixture('<g data-route="x"><path d="M0,0 L0,20"/></g>', '<g data-route="x"><path d="M0,0 L10,10"/></g>');
  f.setReducedMotion(true);
  const active = animateAssistantLayer(f);
  assert.deepEqual(await active.finished, {cancelled:false});
  assert.equal(f.callbacks.size, 0);
  assert.equal(f.mediaListeners.size, 0);
  assert.equal(f.layer.querySelector('path').getAttribute('d'), 'M0,0 L10,10');
});
