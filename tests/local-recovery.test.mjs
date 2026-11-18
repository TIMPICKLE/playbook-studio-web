import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Window } from 'happy-dom';
import { STORAGE_KEY, starterWorkspace, encodeWorkspace, decodeWorkspace } from '../web/model.js';

let fixtureId = 0;
async function editor(t, raw, { readFails = false, path = '/local.html' } = {}) {
  const win = new Window({ url: new URL(path, 'http://localhost:3000').href, width: 1440, height: 1000 });
  win.document.body.innerHTML = readFileSync(new URL('../web/index.html', import.meta.url), 'utf8').split('<body>')[1].split('</body>')[0];
  win.localStorage.setItem(STORAGE_KEY, raw);
  win.localStorage.setItem('playbook-studio:onboarding:v1',JSON.stringify({dismissed:true,completed:[]}));
  const failure = { read: readFails, write: false };
  const storage = {
    getItem(key) { if (key === STORAGE_KEY && failure.read) throw new Error('Storage access denied'); return win.localStorage.getItem(key); },
    setItem(key, value) { if (key === STORAGE_KEY && failure.write) throw new Error('QuotaExceededError'); win.localStorage.setItem(key, value); },
    removeItem(key) { win.localStorage.removeItem(key); },
  };
  const names = ['window', 'document', 'navigator', 'localStorage', 'location', 'history', 'Image', 'Blob', 'requestAnimationFrame', 'cancelAnimationFrame'];
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
  assert.equal(f.query('.editor-status').dataset.state, 'saved');
  assert.equal(f.query('.editor-status [data-action="retry-save"]'), null);
  const leaving = new f.win.Event('beforeunload', { cancelable: true });
  f.win.dispatchEvent(leaving);
  assert.equal(leaving.defaultPrevented, false);
  assert.match(f.query('h1').textContent, /Existing local play/);
  assert.equal(f.query('[data-action="favorite"]').disabled, false);
  assert.equal(f.saved(), raw);
});

test('recovering a local playbook while viewing its roster refreshes the roster in place', async t => {
  const original = starterWorkspace();
  original.roster[0].name = 'Recovered captain';
  const raw = encodeWorkspace(original), f = await editor(t, raw, { readFails: true, path: '/#roster' });
  assert.equal(f.query('#roster-root').hidden, false);
  f.query('[data-roster-tab="directory"]').click();
  assert.equal(f.query('[data-roster="add"]').hidden, true);
  f.failure.read = false;
  f.click('retry-local-load');
  assert.equal(f.query('.modal'), null);
  assert.match(f.query('.roster-results tbody').textContent, /Recovered captain/);
  assert.equal(f.query('[data-roster="add"]').hidden, false);
  assert.equal(f.query('#app').hidden, true);
  assert.equal(f.query('#field'), null);
  assert.equal(f.saved(), raw);
});

test('a delayed local import cannot interrupt another module after leaving the editor', async t => {
  const raw=encodeWorkspace(starterWorkspace()),f=await editor(t,raw);
  const imported=starterWorkspace();imported.plays[0].title='Delayed import';
  const incoming=encodeWorkspace(imported);let finish;
  const input=f.query('#import-input');
  Object.defineProperty(input,'files',{configurable:true,value:[{size:incoming.length,text:()=>new Promise(resolve=>{finish=resolve;})}]});
  input.dispatchEvent(new f.win.Event('change',{bubbles:true}));
  assert.equal(typeof finish,'function');
  f.query('.workspace-nav [data-workspace-mode="roster"]').click();
  assert.equal(f.query('#roster-root').hidden,false);
  finish(incoming);for(let i=0;i<4;i++)await new Promise(resolve=>setImmediate(resolve));
  assert.ok(!f.query('.modal'),'a completed read cannot open an import dialog over another module');
  assert.equal(f.saved(),raw,'a late import never writes data');
});

test('returning to the editor cannot reactivate a file read started before leaving', async t => {
  const raw=encodeWorkspace(starterWorkspace()),f=await editor(t,raw);let finish;
  const input=f.query('#import-input');
  Object.defineProperty(input,'files',{configurable:true,value:[{size:raw.length,text:()=>new Promise(resolve=>{finish=resolve;})}]});
  input.dispatchEvent(new f.win.Event('change',{bubbles:true}));
  f.query('.workspace-nav [data-workspace-mode="roster"]').click();
  f.query('.workspace-nav [data-workspace-mode="editor"]').click();
  assert.equal(f.query('#app').hidden,false);
  finish(raw);for(let i=0;i<4;i++)await new Promise(resolve=>setImmediate(resolve));
  assert.ok(!f.query('.modal'),'the old read remains cancelled after returning');
  assert.equal(f.saved(),raw);
});

test('an earlier slow file cannot replace a newer import confirmation', async t => {
  const initial=starterWorkspace(),raw=encodeWorkspace(initial),f=await editor(t,raw);let finish;
  const first=starterWorkspace();first.plays=first.plays.slice(0,1);
  const second=starterWorkspace();second.plays=second.plays.slice(0,2);
  const input=f.query('#import-input'),start=file=>{Object.defineProperty(input,'files',{configurable:true,value:[file]});input.dispatchEvent(new f.win.Event('change',{bubbles:true}));};
  start({size:raw.length,text:()=>new Promise(resolve=>{finish=resolve;})});
  start({size:raw.length,text:async()=>encodeWorkspace(second)});
  for(let i=0;i<4;i++)await new Promise(resolve=>setImmediate(resolve));
  assert.ok(f.query('[data-action="confirm-import"]'),'the newer file has a confirmation');
  finish(encodeWorkspace(first));for(let i=0;i<4;i++)await new Promise(resolve=>setImmediate(resolve));
  f.click('confirm-import');
  assert.equal(decodeWorkspace(f.saved()).plays.length,initial.plays.length+2,'only the latest selected file is appended');
});

async function importDuringNewPlay(f, raw) {
  const input = f.query('#import-input');
  let deliver;
  const file = { name: 'shared-drills.json', size: raw.length, text: () => new Promise(resolve => { deliver = resolve; }) };
  Object.defineProperty(input, 'files', { configurable: true, value: [file] });
  f.click('import');
  input.dispatchEvent(new f.win.Event('change', { bubbles: true }));
  f.click('new');
  const title = f.query('#new-title');
  title.focus();
  title.value = 'My unfinished drill';
  title.dispatchEvent(new f.win.Event('input', { bubbles: true }));
  deliver(raw);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.query('#new-title'), title);
  assert.equal(f.win.document.activeElement, title);
  assert.equal(title.value, 'My unfinished drill');
  assert.equal(f.query('[data-action="confirm-import"]'), null);
  assert.match(f.query('dialog [data-import-notice]').textContent, /shared-drills.json/);
  return title;
}

test('a completed read waits for the open form to finish, then imports exactly once on explicit review and confirmation', async t => {
  const original = starterWorkspace(), raw = encodeWorkspace(original), f = await editor(t, raw);
  await importDuringNewPlay(f, raw);
  assert.equal(f.saved(), raw);
  f.click('create-play');
  assert.equal(f.query('dialog'), null);
  assert.ok(decodeWorkspace(f.saved()).plays.some(play => play.title === 'My unfinished drill'));
  f.click('review-pending-import');
  const confirm = f.query('[data-action="confirm-import"]');
  assert.ok(confirm);
  confirm.click(); confirm.click();
  const saved = decodeWorkspace(f.saved());
  assert.equal(saved.plays.length, original.plays.length * 2 + 1);
  assert.equal(saved.plays.filter(play => play.title === 'My unfinished drill').length, 1);
  assert.equal(f.query('[data-action="review-pending-import"]'), null);
});

test('the active form can dismiss a pending import without losing its fields or changing the playbook', async t => {
  const raw = encodeWorkspace(starterWorkspace()), f = await editor(t, raw);
  const title = await importDuringNewPlay(f, raw);
  f.query('dialog [data-action="cancel-pending-import"]').click();
  assert.equal(f.query('#new-title'), title);
  assert.equal(title.value, 'My unfinished drill');
  assert.equal(f.query('[data-action="review-pending-import"]'), null);
  assert.equal(f.saved(), raw);
  f.click('create-play');
  assert.equal(decodeWorkspace(f.saved()).plays.length, starterWorkspace().plays.length + 1);
  assert.equal(f.query('dialog'), null);
});

test('leaving an editor drops a staged file even after returning to the same workspace', async t => {
  const raw = encodeWorkspace(starterWorkspace()), f = await editor(t, raw);
  await importDuringNewPlay(f, raw);
  f.click('close-modal');
  assert.ok(f.query('[data-action="review-pending-import"]'));
  f.query('.workspace-nav [data-workspace-mode="roster"]').click();
  f.query('.workspace-nav [data-workspace-mode="editor"]').click();
  assert.equal(f.query('[data-action="review-pending-import"]'), null);
  assert.equal(f.saved(), raw);
});

test('JSON import undo and redo preserve independent directory edits across module navigation', async t => {
  const seed = starterWorkspace();
  const f = await editor(t, encodeWorkspace(seed));
  const incoming = starterWorkspace();
  incoming.plays = incoming.plays.slice(0, 1);
  incoming.roster = [{ ...seed.roster[0], id: 'incoming-qb', name: 'Imported QB' }];
  const group = incoming.depthChart.groups[0];
  group.name = 'Visiting unit';
  group.slots[0].playerIds = ['incoming-qb'];
  incoming.depthChart.groups = [group];
  const raw = encodeWorkspace(incoming);
  const input = f.query('#import-input');
  Object.defineProperty(input, 'files', { configurable: true, value: [{ size: raw.length, text: async () => raw }] });
  input.dispatchEvent(new f.win.Event('change', { bubbles: true }));
  await new Promise(resolve => setImmediate(resolve));
  f.click('confirm-import');
  const imported = decodeWorkspace(f.saved());
  assert.equal(imported.plays.length, seed.plays.length + 1);
  assert.equal(imported.roster.length, seed.roster.length + 1);
  const importedGroup = imported.depthChart.groups.find(item => item.name === group.name);
  assert.deepEqual(importedGroup.slots[0].playerIds, [imported.roster.at(-1).id]);

  f.query('.workspace-nav [data-workspace-mode="roster"]').click();
  f.query('[data-roster-tab="directory"]').click();
  f.query(`[data-roster="edit"][data-id="${seed.roster[0].id}"]`).click();
  const name = f.query('.roster-dialog [name="name"]');
  name.value = 'New captain';
  name.dispatchEvent(new f.win.Event('input', { bubbles: true }));
  f.query('.roster-dialog [type="submit"]').click();
  f.query('.workspace-nav [data-workspace-mode="editor"]').click();
  const expectedAfterRedo = decodeWorkspace(f.saved());
  for (let cycle = 0; cycle < 2; cycle++) {
    f.click('undo');
    const restored = decodeWorkspace(f.saved());
    assert.equal(restored.roster[0].name, 'New captain');
    assert.deepEqual(restored.roster.map(player => player.id), seed.roster.map(player => player.id));
    assert.deepEqual(restored.plays.map(play => play.id), seed.plays.map(play => play.id));
    assert.deepEqual(restored.formations.map(form => form.id), seed.formations.map(form => form.id));
    assert.deepEqual(restored.depthChart, seed.depthChart);
    f.click('redo');
    assert.deepEqual(decodeWorkspace(f.saved()), expectedAfterRedo);
  }
});
