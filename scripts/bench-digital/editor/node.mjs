// A stepped Node/happy-dom CPU comparison. A browser run also measures native frame waits and layout.
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Window } from 'happy-dom';

const [folder, sampleArg] = process.argv.slice(2);
if (!folder) throw Error('Usage: node scripts/bench-digital/editor/node.mjs <prepared-dist/baseline-or-candidate> [samplesPerRound]');
const root = resolve(folder);
const moduleURL = file => pathToFileURL(resolve(root, file)).href;
const load = async file => JSON.parse(await readFile(resolve(root, file), 'utf8'));
const win = new Window({ url: 'http://localhost:3000/local.html#editor', width: 1280, height: 900 });
const doc = win.document;
const { stepClock, mountMeter, measureEditor } = await import(moduleURL('bench-sample.js'));
const step = stepClock(win);
const meter = globalThis.__editorBench = mountMeter(win);
win.CanvasRenderingContext2D = class {};
win.console.warn = () => {};
const env = ['window', 'document', 'navigator', 'localStorage', 'location', 'history', 'Image', 'Blob', 'requestAnimationFrame', 'cancelAnimationFrame'];
for (const key of env) Object.defineProperty(globalThis, key, { configurable: true,
  value: key.endsWith('AnimationFrame') ? win[key].bind(win) : win[key] });
try {
  const [model, mode, onboard, { play }, manifest, html] = await Promise.all([
    import(moduleURL('model.js')), import(moduleURL('visual-mode.js')), import(moduleURL('onboarding.js')),
    load('bench-mesh.json'), load('snapshot.json'), readFile(resolve(root, 'index.html'), 'utf8')]);
  doc.body.innerHTML = html.split('<body>')[1].split('</body>')[0];
  const data = model.starterWorkspace();
  data.plays = [play];
  win.localStorage.setItem(model.STORAGE_KEY, model.encodeWorkspace(data));
  win.localStorage.setItem(mode.VISUAL_MODE_KEY, 'digital');
  win.localStorage.setItem(onboard.ONBOARDING_STORAGE_KEY, JSON.stringify({ dismissed: true, completed: [] }));
  await import(moduleURL('app.js'));
  doc.querySelector('[data-action="rehearse-mode"]').click();
  for (let i = 0; i < 150 && !doc.querySelector('.digital-fallback-ready'); i++) {
    step(); await new Promise(resolve => setTimeout(resolve, 20));
  }
  const result = await measureEditor({ win, meter, step, samples: Number(sampleArg || 16) });
  console.log(JSON.stringify({ manifest, environment: 'Node/happy-dom with stepped rAF', ...result }));
} finally { win.dispatchEvent(new win.Event('pagehide')); await win.happyDOM.abort(); }
