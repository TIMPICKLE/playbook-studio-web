import test from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { readFileSync } from 'node:fs';

test('static preview opens a default matchup and keeps the API key in memory only', async () => {
  const win = new Window({ url: 'https://timpickle.github.io/playbook-studio-web/local.html', width: 390, height: 844 });
  win.document.body.innerHTML = readFileSync(new URL('../web/index.html', import.meta.url), 'utf8').split('<body>')[1].split('</body>')[0];
  win.setInterval = () => 1;
  win.scrollTo = () => {};
  const names = ['window','document','navigator','localStorage','location','history','Image','Blob','requestAnimationFrame','cancelAnimationFrame','fetch'];
  const previous = Object.fromEntries(names.map(n => [n, Object.getOwnPropertyDescriptor(globalThis, n)]));
  for (const n of names.filter(n => n !== 'fetch')) Object.defineProperty(globalThis, n, { configurable: true, value: ['requestAnimationFrame','cancelAnimationFrame'].includes(n) ? win[n].bind(win) : win[n] });
  let call;
  Object.defineProperty(globalThis, 'fetch', { configurable: true, value: async (url, options) => {
    call = { url, options };
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ summary: 'Mock analysis', scenarios: [{title:'Mock',condition:'if',observation:'watch',possibility:'possible'}] }) } }] }));
  }});
  const q = s => win.document.querySelector(s);
  const settle = async () => { for (let i = 0; i < 12; i++) await new Promise(resolve => setImmediate(resolve)); };
  try {
    await import(`../web/app.js?demo-ui=${Date.now()}`); await settle();
    assert.ok(q('[data-demo-action="open"]'));
    q('[data-demo-action="open"]').click();
    assert.equal(q('#app').hidden, true);
    assert.equal(q('#ai-matchup-root').hidden, false);
    assert.ok(q('.ai-board svg'));
    assert.ok(q('[data-ai-field="offense"]').value);
    assert.ok(q('[data-ai-field="defense"]').value);
    q('[data-ai-action="analyze"]').click();
    assert.match(q('.ai-error').textContent, /API Key/);
    assert.equal(call, undefined);
    const key = q('[data-ai-field="apiKey"]'); key.value = 'fake-private-key'; key.dispatchEvent(new win.Event('input', { bubbles: true }));
    q('[data-ai-action="analyze"]').click(); await settle();
    assert.equal(call.url, 'https://openrouter.ai/api/v1/chat/completions');
    assert.equal(call.options.headers.Authorization, 'Bearer fake-private-key');
    assert.match(q('.ai-scenario').textContent, /Mock/);
    assert.doesNotMatch(JSON.stringify(win.localStorage), /fake-private-key/);
    q('[data-cloud-action="home"]').click();
    assert.equal(q('#ai-matchup-root').hidden, true);
    q('[data-demo-action="open"]').click();
    assert.equal(q('[data-ai-field="apiKey"]').value, '');
    assert.equal(q('.ai-scenario'), null);
  } finally {
    await win.happyDOM.abort();
    for (const n of names) { if (previous[n]) Object.defineProperty(globalThis, n, previous[n]); else delete globalThis[n]; }
  }
});
