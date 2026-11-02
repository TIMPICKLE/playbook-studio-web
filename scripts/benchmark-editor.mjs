// Reproducible CPU/DOM comparison only; this is not a browser or GPU FPS test.
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { Window } from 'happy-dom';
import { starterWorkspace, STORAGE_KEY, encodeWorkspace } from '../web/model.js';

const win = new Window({ url: 'http://localhost:3000/local.html', width: 1440, height: 900 });
const doc = win.document;
// happy-dom has no layout engine: model the first 10 thumbnails as visible.
win.IntersectionObserver = class {
  constructor(callback) { this.callback = callback; }
  observe(node) {
    if (node.hasAttribute('data-thumbnail-index') && Number(node.dataset.thumbnailIndex) < 10)
      this.callback([{ target: node, isIntersecting: true }]);
  }
  disconnect() {}
};
doc.body.innerHTML = readFileSync(new URL('../web/index.html', import.meta.url), 'utf8').split('<body>')[1].split('</body>')[0];
const data = starterWorkspace(), sample = data.plays[0];
data.plays = Array.from({ length: 200 }, (_, i) => ({ ...structuredClone(sample), id: `bench-play-${i}`, title: `Play ${i}` }));
win.localStorage.setItem(STORAGE_KEY, encodeWorkspace(data));
for (const name of ['window','document','navigator','localStorage','location','Image','Blob','requestAnimationFrame','cancelAnimationFrame']) {
  Object.defineProperty(globalThis, name, { configurable: true, value: name.endsWith('AnimationFrame') ? win[name].bind(win) : win[name] });
}
try {
  let start = performance.now();
  await import('../web/app.js');
  const initial = performance.now() - start;
  start = performance.now();
  doc.querySelector('[data-action="choose:bench-play-1"]').click();
  const choose = performance.now() - start;
  start = performance.now();
  const searchInput = doc.querySelector('#search'); searchInput.value = 'Play 1';
  searchInput.dispatchEvent(new win.Event('input', { bubbles: true }));
  const search = performance.now() - start;
  console.log(JSON.stringify({ environment: 'happy-dom; 10 simulated visible thumbnails; not browser FPS', plays: 200,
    initialMs: +initial.toFixed(1), chooseMs: +choose.toFixed(1), searchMs: +search.toFixed(1),
    searchResults: doc.querySelectorAll('.play-card').length, renderedThumbnails: doc.querySelectorAll('.play-thumb svg').length }, null, 2));
} finally { await win.happyDOM.abort(); }
