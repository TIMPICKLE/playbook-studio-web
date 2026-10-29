import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Window } from 'happy-dom';
import { STORAGE_KEY, starterWorkspace, encodeWorkspace, decodeWorkspace } from '../web/model.js';

let fixtureId = 0;
async function editor(t, raw, { readFails = false } = {}) {
  const win = new Window({ url: 'http://localhost:3000/', width: 1440, height: 1000 });
  win.document.body.innerHTML = readFileSync(new URL('../web/index.html', import.meta.url), 'utf8').split('<body>')[1].split('</body>')[0];
  win.localStorage.setItem(STORAGE_KEY, raw);
  const failure = { read: readFails, write: false };
  const storage = {
    getItem(key) { if (key === STORAGE_KEY && failure.read) throw new Error('Storage access denied'); return win.localStorage.getItem(key); },
    setItem(key, value) { if (key === STORAGE_KEY && failure.write) throw new Error('QuotaExceededError'); win.localStorage.setItem(key, value); },
    removeItem(key) { win.localStorage.removeItem(key); },
  };
  const names = ['window', 'document', 'navigator', 'localStorage', 'location', 'Image', 'Blob', 'requestAnimationFrame', 'cancelAnimationFrame'];
  const previous = Object.fromEntries(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  for (const name of names) Object.defineProperty(globalThis, name, {
    configurable: true,
    value: name === 'localStorage' ? storage : ['requestAnimationFrame', 'cancelAnimationFrame'].includes(name) ? win[name].bind(win) : win[name],
  });
  const downloads = [];
  t.mock.method(URL, 'createObjectURL', blob => { downloads.push(blob); return 'blob:local-recovery-test'; });
  t.mock.method(URL, 'revokeObjectURL', () => {});
  win.document.addEventListener('click', event => { if (event.target.closest('a[download]')) event.preventDefault(); });
  t.after(async () => {
    await win.happyDOM.abort();
    for (const name of names) { if (previous[name]) Object.defineProperty(globalThis, name, previous[name]); else delete globalThis[name]; }
  });
  await import(`../web/app.js?local-recovery=${++fixtureId}`);
  const query = selector => win.document.querySelector(selector);
  const click = action => { const node = query(`[data-action="${action}"]`); assert.ok(node, action); node.click(); };
  return { win, failure, downloads, query, click, saved: () => win.localStorage.getItem(STORAGE_KEY) };
}

test('unreadable local data stays intact, exports verbatim and resumes editing only after a valid reload', async t => {
  const original = starterWorkspace(); original.plays[0].title = 'Recoverable original'; original.plays[0].players[0].x = 101;
  const raw = encodeWorkspace(original);
  const f = await editor(t, raw);
  assert.match(f.query('.modal').textContent, /恢复本地战术本/);
  assert.match(f.query('#save-state').textContent, /存档待恢复/);
  assert.match(f.query('.readonly-banner').textContent, /存档待恢复/);
  assert.doesNotMatch(f.query('.readonly-banner').textContent, /联系管理员/);
  assert.match(f.query('.inspector-note').textContent, /自动保存已暂停/);
  assert.equal(f.query('[data-action="favorite"]').disabled, true);
  const title = f.query('[data-prop="title"]');
  title.value = 'An edit must not replace the original';
  title.dispatchEvent(new f.win.Event('change', { bubbles: true }));
  assert.equal(f.saved(), raw);
  f.click('download-original');
  assert.equal(await f.downloads[0].text(), raw);
  assert.equal(f.saved(), raw);
  f.click('retry-local-load');
  assert.match(f.query('.form-feedback').textContent, /仍无法读取/);
  assert.equal(f.query('[data-action="favorite"]').disabled, true);
  f.click('close-modal'); f.click('export');
  assert.match(f.query('.modal').textContent, /下载原始存档/);

  original.plays[0].players[0].x = 40;
  f.win.localStorage.setItem(STORAGE_KEY, encodeWorkspace(original));
  f.click('retry-local-load');
  assert.equal(f.query('.modal'), null);
  assert.match(f.query('h1').textContent, /Recoverable original/);
  assert.equal(f.query('[data-action="favorite"]').disabled, false);
  f.click('favorite');
  assert.equal(decodeWorkspace(f.saved()).plays[0].favorite, false);
  assert.equal(decodeWorkspace(f.saved()).plays[0].title, 'Recoverable original');
});

test('replacing an unreadable local file requires confirmation and a successful write', async t => {
  const raw = '{"partiallyRecoverable":';
  const f = await editor(t, raw);
  f.click('replace-local-workspace');
  assert.equal(f.saved(), raw);
  assert.match(f.query('.modal').textContent, /尚未下载的原始内容将被覆盖/);
  f.click('local-recovery');
  assert.equal(f.saved(), raw);
  f.click('replace-local-workspace');
  f.failure.write = true; f.click('confirm-replace-local-workspace');
  assert.equal(f.saved(), raw);
  assert.ok(f.query('[data-action="confirm-replace-local-workspace"]'));
  assert.equal(f.query('[data-action="favorite"]').disabled, true);
  f.failure.write = false; f.click('confirm-replace-local-workspace');
  assert.equal(f.query('.modal'), null);
  assert.equal(f.query('[data-action="favorite"]').disabled, false);
  assert.equal(decodeWorkspace(f.saved()).plays[0].title, 'Mesh · 浅交叉');
});

test('temporary storage read denial cannot replace the original with examples', async t => {
  const original = starterWorkspace(); original.plays[0].title = 'Existing local play';
  const raw = encodeWorkspace(original), f = await editor(t, raw, { readFails: true });
  assert.equal(f.query('[data-action="download-original"]').disabled, true);
  assert.equal(f.query('[data-action="favorite"]').disabled, true);
  assert.equal(f.saved(), raw);
  f.click('retry-local-load');
  assert.equal(f.saved(), raw);
  f.failure.read = false; f.click('retry-local-load');
  assert.match(f.query('h1').textContent, /Existing local play/);
  assert.equal(f.query('[data-action="favorite"]').disabled, false);
  assert.equal(f.saved(), raw);
});
