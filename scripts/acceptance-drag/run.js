import { sampleDrag } from './sample.js';
import * as model from './model.js';

// Keep fixture state in this page. Running the benchmark never changes the user's saved playbook.
const values = new Map();
Object.defineProperty(window, 'localStorage', { configurable: true, value: {
  getItem: key => values.get(key) ?? null,
  setItem: (key, value) => values.set(key, String(value)),
  removeItem: key => values.delete(key),
} });
localStorage.setItem(model.STORAGE_KEY, await (await fetch('./fixture.json')).text());
localStorage.setItem('playbook-studio:onboarding:v1', JSON.stringify({ dismissed: true, completed: [] }));
await import('./app.js');

const panel = document.createElement('section');
panel.style = 'position:fixed;right:0;bottom:0;background:white;color:black;z-index:2147483647;max-width:32rem;max-height:12rem;overflow:auto';
const button = document.createElement('button');
button.textContent = 'Run 11v11 drag benchmark';
const result = document.createElement('output');
result.id = 'drag-benchmark-result';
panel.append(button, result);
document.body.append(panel);
button.onclick = async () => {
  button.disabled = true;
  const rows = [];
  const rounds = new URLSearchParams(location.search).get('rounds') === '1' ? 1 : 3;
  try {
    await document.fonts.ready;
    for (let run = 0; run < rounds; run++) {
      for (const group of [false, true]) {
        result.textContent = 'Measuring ' + (rows.length + 1) + '/' + (2 * rounds) + ' ' + JSON.stringify(rows);
        rows.push(await sampleDrag(window, model, group));
      }
    }
    result.textContent = JSON.stringify({ visible: document.visibilityState, viewport: [innerWidth, innerHeight], rows });
  } catch (error) { result.textContent = 'FAILED ' + error.message + ' ' + JSON.stringify(rows); }
};
