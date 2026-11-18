// Deterministic write counts and correctness only. The DOM emulator has no browser/GPU frame timings.
import { readFile } from 'node:fs/promises';
import { Window } from 'happy-dom';
import { sampleDrag } from './sample.js';

const version = process.argv[2];
if (!['base', 'candidate'].includes(version)) throw Error('Run prepare.mjs first, then dom.mjs base or dom.mjs candidate.');
const root = new URL('../../public/editor/acceptance-drag/' + version + '/', import.meta.url);
const model = await import(new URL('model.js', root));
const win = new Window({ url: 'http://localhost/local.html#editor', width: 1440, height: 900 });
const html = await readFile(new URL('index.html', root), 'utf8');
win.document.body.innerHTML = html.split('<body>')[1].split('</body>')[0];
win.localStorage.setItem(model.STORAGE_KEY, await readFile(new URL('fixture.json', root), 'utf8'));
win.localStorage.setItem('playbook-studio:onboarding:v1', JSON.stringify({ dismissed: true, completed: [] }));
for (const name of ['window', 'document', 'navigator', 'localStorage', 'location', 'history', 'Image', 'Blob', 'requestAnimationFrame', 'cancelAnimationFrame']) {
  const value = name.endsWith('AnimationFrame') ? (...args) => win[name](...args) : win[name];
  Object.defineProperty(globalThis, name, { configurable: true, value });
}
try {
  await import(new URL('app.js', root));
  const rows = [];
  for (const group of [false, true]) {
    const { frameIntervalMs, flushMs, ...structural } = await sampleDrag(win, model, group);
    rows.push(structural);
  }
  console.log(JSON.stringify({ version, environment: 'happy-dom', fixture: { players: 22, routes: 10, zones: 1, annotations: 1 }, rows }));
} finally {
  win.dispatchEvent(new win.Event('pagehide'));
  await win.happyDOM.abort();
}
