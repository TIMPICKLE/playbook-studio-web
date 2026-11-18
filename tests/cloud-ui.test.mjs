import test from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { readFileSync } from 'node:fs';
import { clone, encodeWorkspace, starterWorkspace, STORAGE_KEY } from '../web/model.js';
import { makeMaddenPlay, loadEditableEntries } from '../web/madden-model.js';
import { EDITABLE_TRACES } from '../web/data/madden-editable.js';
import { SharedWorkspace } from '../web/cloud.js';
await loadEditableEntries([Object.values(EDITABLE_TRACES)[0].id]);

test('cloud editor restricts readers, saves editor changes, imports legacy JSON and manages owner invitations', async t => {
  const win = new Window({ url: 'https://playbook.test/editor/index.html', width: 1440, height: 1000 });
  win.document.body.innerHTML = readFileSync(new URL('../web/index.html', import.meta.url), 'utf8').split('<body>')[1].split('</body>')[0];
  const legacy = encodeWorkspace(starterWorkspace()); win.localStorage.setItem(STORAGE_KEY, legacy);
  const record = { id: 'book', title: 'Team', role: 'viewer', revision: 1, data: starterWorkspace() }, calls = [];
  record.data.plays[0] = makeMaddenPlay(Object.values(EDITABLE_TRACES)[0]);
  let poll, nextPoll;
  win.setInterval = callback => { poll = callback; return 1; };
  const names = ['window', 'document', 'navigator', 'localStorage', 'location', 'history', 'Image', 'Blob', 'requestAnimationFrame', 'cancelAnimationFrame', 'fetch'];
  const previous = Object.fromEntries(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  for (const name of names.filter(n => n !== 'fetch')) Object.defineProperty(globalThis, name, { configurable: true, value: ['requestAnimationFrame', 'cancelAnimationFrame'].includes(name) ? win[name].bind(win) : win[name] });
  const response = body => new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });
  Object.defineProperty(globalThis, 'fetch', { configurable: true, value: async (path, options = {}) => {
    const body = options.body ? JSON.parse(options.body) : undefined; calls.push({ path, method: options.method || 'GET', body });
    if (path === '/api/session') return response({ user: { id: 'me', name: 'Coach', email: 'coach@example.com' } });
    if (path === '/api/workspaces' && !options.method) return response({ workspaces: [{ id: record.id, title: record.title, role: record.role }] });
    if (path === '/api/workspaces' && options.method === 'POST') return response({ ...record, id: 'new-book', role: 'owner', revision: 1, data: body.data || starterWorkspace() });
    if (path.endsWith('/members')) return response({ members: [{ id: 'me', name: 'Coach', email: 'coach@example.com', role: 'owner' }], invites: [] });
    if (path.endsWith('/invites')) return response({ email: body.email, url: 'https://playbook.test/editor/index.html?invite=test' });
    if (options.method === 'PUT') { record.data = clone(body.data); record.revision++; return response({ revision: record.revision }); }
    if (path.includes('?after=') && nextPoll) {
      const delayed = nextPoll; nextPoll = null;
      return delayed;
    }
    if (path.includes('?after=')) return response({ unchanged: true, revision: record.revision, role: record.role });
    return response(clone(record));
  } });
  const settle = async () => { for (let i = 0; i < 12; i++) await new Promise(resolve => setImmediate(resolve)); };
  const q = selector => win.document.querySelector(selector);
  try {
    await import(`../web/app.js?cloud-test=${Date.now()}`); await settle();
    assert.ok(q('[data-cloud-action="enter-editor"]')); assert.ok(q('[data-cloud-action="enter-analysis"]'));
    assert.equal(q('#app').hidden, true);
    await t.test('a viewer can browse the cloud roster but cannot change it', async () => {
      q('[data-cloud-action="enter-roster"]').click(); await settle();
      const root = q('#roster-root');
      assert.equal(root.hidden, false);
      assert.equal(q('#app').hidden, true);
      root.querySelector('[data-roster-tab="directory"]').click();
      assert.match(root.querySelector('.roster-results tbody').textContent, new RegExp(record.data.roster[0].name));
      assert.equal(root.querySelector('.roster-readonly').hidden, false);
      assert.equal(root.querySelector('[data-roster="edit"]'), null);
      const add = root.querySelector('[data-roster="add"]');
      assert.equal(add.hidden, true);
      add.click(); // A scripted activation must also respect the role.
      assert.equal(root.querySelector('dialog[open]'), null);
      assert.equal(calls.some(call => call.method === 'PUT'), false);
      root.querySelector('[data-cloud-action="home"]').click(); await settle();
      assert.equal(root.hidden, true);
    });
    q('[data-cloud-action="enter-editor"]').click(); await settle();
    await t.test('viewer sees shared data and exports but cannot mutate via controls, scripted events or keyboard', async () => {
      assert.equal(q('#app').hidden, false); assert.equal(q('[data-action="add-defense-43"]').disabled, true); assert.equal(q('[data-prop="title"]').disabled, true);
      assert.equal(q('[data-action="export"]').disabled, false); assert.equal(q('[data-cloud-action="members"]'), null);
      const space = q('[data-action="space-madden-line"]'); assert.equal(space.disabled, true);
      space.disabled = false; space.click(); // A scripted click must not bypass viewer permissions.
      const input = q('[data-prop="title"]'); input.value = 'Unauthorized'; input.dispatchEvent(new win.Event('change', { bubbles: true }));
      win.document.body.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Delete', bubbles: true })); await settle();
      assert.equal(calls.filter(c => c.method === 'PUT').length, 0); assert.notEqual(record.data.plays[0].title, 'Unauthorized');
    });
    await t.test('viewers can resize and expand without changing shared data or issuing writes', async () => {
      const before = JSON.stringify(record.data), field = q('#field svg');
      assert.equal(q('[data-board-action="zoom-in"]').disabled,false);
      q('[data-board-action="zoom-in"]').click();assert.equal(q('#board-zoom-value').textContent,'125%');
      q('[data-board-action="fit"]').click();assert.equal(q('#board-zoom-value').textContent,'100%');
      assert.equal(q('[data-board-action="expand"]').disabled, false);
      q('[data-board-action="expand"]').click(); assert.equal(q('.workspace').classList.contains('board-expanded'), true);
      q('#board-height').value = '780'; q('#board-height').dispatchEvent(new win.Event('input', { bubbles: true })); q('#board-height').dispatchEvent(new win.Event('change', { bubbles: true }));
      await settle(); assert.equal(q('#field svg'), field); assert.equal(JSON.stringify(record.data), before); assert.equal(calls.filter(c => c.method === 'PUT').length, 0);
      assert.equal(win.localStorage.getItem(STORAGE_KEY), legacy); assert.equal(JSON.parse(win.localStorage.getItem('playbook-studio-board-layout-v1')).expandedHeight, 780);
      q('[data-board-action="reset"]').click();
    });
    await t.test('a server role change enables editing and one save reaches the shared API, preserving legacy local data', async () => {
      record.role = 'editor'; await poll(); await settle();
      assert.equal(q('[data-prop="title"]').disabled, false);
      const input = q('[data-prop="title"]'); input.value = 'Cloud Mesh'; input.dispatchEvent(new win.Event('change', { bubbles: true }));
      await new Promise(resolve => setTimeout(resolve, 1000)); await settle();
      assert.equal(record.data.plays[0].title, 'Cloud Mesh'); assert.equal(calls.filter(c => c.method === 'PUT').length, 1);
      assert.equal(q('.editor-status').dataset.state, 'saved');
      assert.equal(q('#cloud-status').dataset.state, 'saved');
      assert.equal(q('.editor-status [data-save-label]').textContent, q('#cloud-status').textContent);
      assert.match(q('#cloud-status').textContent, /已同步/); assert.equal(win.localStorage.getItem(STORAGE_KEY), legacy);
    });
    await t.test('an in-flight poll cannot mark unfinished input as saved', async () => {
      q(':focus')?.blur();
      const deferred = Promise.withResolvers();
      nextPoll = deferred.promise;
      const fetching = poll(); await settle();
      assert.equal(nextPoll, null);
      const title = q('[data-prop="title"]');
      title.focus(); title.value = 'Unfinished title';
      title.dispatchEvent(new win.Event('input', { bubbles:true }));
      const writes = calls.filter(call => call.method === 'PUT').length;
      const remote = clone(record);
      remote.revision++;
      remote.data.plays[1].title = 'Peer edit';
      deferred.resolve(response(remote)); await fetching; await settle();
      assert.equal(q('[data-prop="title"]').value, 'Unfinished title');
      for (const selector of ['.editor-status', '#cloud-status']) assert.equal(q(selector).dataset.state, 'unsaved');
      assert.equal(q('#save-state').textContent, q('#cloud-status').textContent);
      assert.equal(calls.filter(call => call.method === 'PUT').length, writes);
      title.value = record.data.plays[0].title;
      title.dispatchEvent(new win.Event('input', {bubbles:true}));
      assert.equal(q('#cloud-status').dataset.state, 'saved');
      title.blur();
    });
    await t.test('a roster edit saves to the selected cloud playbook and never overwrites a local demo', async () => {
      q('[data-cloud-action="home"]').click(); await settle();
      q('[data-cloud-action="enter-roster"]').click(); await settle();
      const root = q('#roster-root'), original = clone(record.data), player = original.roster[0];
      root.querySelector('[data-roster-tab="directory"]').click();
      root.querySelector(`[data-roster="edit"][data-id="${player.id}"]`).click();
      root.querySelector('.roster-page > .roster-dialog input[name="name"]').value = 'Cloud player';
      root.querySelector('.roster-page > .roster-dialog [type="submit"]').click();
      q('[data-cloud-action="save-now"]').click(); await settle();
      const writes = calls.filter(call => call.method === 'PUT');
      assert.equal(writes.length, 2);
      assert.equal(writes.at(-1).path, '/api/workspaces/book');
      assert.equal(record.data.roster.find(item => item.id === player.id).name, 'Cloud player');
      assert.deepEqual(record.data.plays, original.plays);
      assert.equal(win.localStorage.getItem(STORAGE_KEY), legacy);
      root.querySelector('[data-cloud-action="home"]').click(); await settle();
      q('[data-cloud-action="enter-editor"]').click(); await settle();
    });
    await t.test('revocation preserves unsent roster form text for copying or downloading without a remote write', async t => {
      q('[data-cloud-action="home"]').click(); await settle();
      q('[data-cloud-action="enter-roster"]').click(); await settle();
      q('[data-roster-tab="directory"]').click();
      q(':focus')?.blur();
      const wait = Promise.withResolvers();
      nextPoll = wait.promise;
      const fetching = poll(); await settle();
      q('[data-roster="edit"]').click();
      const original = record.data.roster[0].name;
      const field = q('.roster-dialog [name="name"]');
      field.value = '新名字 <Coach>'; field.dispatchEvent(new win.Event('input', { bubbles: true }));
      const writes = calls.filter(call => call.method === 'PUT').length;
      record.role = 'viewer';
      wait.resolve(response({ unchanged: true, revision: record.revision, role: record.role }));
      await fetching; await settle();
      const text = q('[data-access-form-draft]').value;
      assert.match(text, /新名字 <Coach>/);
      assert.ok(q('[data-access-form-draft]').readOnly);
      assert.equal(q('[data-cloud-action="export-conflict"]'), null, 'unsubmitted forms stay separate from workspace writes');
      const beforeUnload = new win.Event('beforeunload', { cancelable: true });
      win.dispatchEvent(beforeUnload);
      assert.ok(beforeUnload.defaultPrevented);
      let downloaded;
      t.mock.method(URL, 'createObjectURL', blob => { downloaded = blob; return 'blob:form-recovery'; });
      win.document.addEventListener('click', function intercept(event) {
        if (event.target.closest('a[download]')) { event.preventDefault(); win.document.removeEventListener('click', intercept); }
      });
      q('[data-cloud-action="export-form-draft"]').click(); await settle();
      assert.equal(await downloaded.text(), text);
      q('[data-action="close-modal"]').click();
      q('[data-cloud-action="enter-roster"]').click(); await settle();
      assert.equal(q('[data-access-form-draft]').value, text, 'closing the notice leaves recovery available');
      q('[data-cloud-action="reload-cloud"]').click(); await settle();
      q('[data-cloud-action="enter-roster"]').click(); await settle();
      assert.equal(q('[data-roster="edit"]'), null);
      const afterReload = new win.Event('beforeunload', { cancelable: true });
      win.dispatchEvent(afterReload);
      assert.equal(afterReload.defaultPrevented, false);
      assert.equal(record.data.roster[0].name, original);
      assert.equal(calls.filter(call => call.method === 'PUT').length, writes);
      record.role = 'editor'; q(':focus')?.blur(); await poll(); await settle();
      q('[data-cloud-action="home"]').click(); await settle();
      q('[data-cloud-action="enter-editor"]').click(); await settle();
    });
    await t.test('creating from a JSON file uploads the complete validated backup and exposes owner member tools', async () => {
      q('[data-cloud-action="new"]').click(); const incoming = starterWorkspace(); incoming.plays[0].title = 'Migrated';
      const input = q('#cloud-new-file'), raw = encodeWorkspace(incoming); assert.ok(input);
      Object.defineProperty(input, 'files', { configurable: true, value: [{ size: raw.length, text: async () => raw }] });
      q('[data-cloud-action="create"]').click(); await settle();
      const created = calls.find(c => c.path === '/api/workspaces' && c.method === 'POST'); assert.equal(created.body.data.plays[0].title, 'Migrated'); assert.equal(created.body.data.plays.length, 8);
      assert.ok(q('[data-cloud-action="members"]')); q('[data-cloud-action="members"]').click(); await settle();
      q('#cloud-invite-email').value = 'assistant@example.com'; q('#cloud-invite-role').value = 'viewer'; q('[data-cloud-action="invite"]').click(); await settle();
      const invite = calls.find(c => c.path.endsWith('/invites')); assert.equal(invite.body.role, 'viewer'); assert.equal(invite.body.email, 'assistant@example.com'); assert.ok(q('[aria-label="邀请链接"]'));
    });
    await t.test('permission loss captures the active title for export before disabling writes', async () => {
      q('[data-action="close-modal"]')?.click();
      if (q('#app').hidden) q('[data-cloud-action="enter-editor"]').click();
      q(':focus')?.blur();
      const deferred = Promise.withResolvers();
      nextPoll = deferred.promise;
      const fetching = poll(); await settle();
      assert.equal(nextPoll, null);
      const title = q('[data-prop="title"]');
      title.focus(); title.value = 'Only in the editor';
      title.dispatchEvent(new win.Event('input', {bubbles:true}));
      const writes = calls.filter(call => call.method === 'PUT').length;
      deferred.resolve(response({unchanged:true, revision:1, role:'viewer'}));
      await fetching; await settle();
      const draft = JSON.parse(win.localStorage.getItem('playbook-cloud-draft:v1:me:new-book'));
      assert.equal(draft.data.plays[0].title, 'Only in the editor');
      assert.ok(q('[data-cloud-action="export-conflict"]'));
      assert.equal(calls.filter(call => call.method === 'PUT').length, writes);
    });
  } finally { await win.happyDOM.abort(); for (const name of names) { if (previous[name]) Object.defineProperty(globalThis, name, previous[name]); else delete globalThis[name]; } }
});

test('sync details distinguish in-memory edits, persisted drafts and render failures', async () => {
  const dialogs = [], shared = new SharedWorkspace({ openModal: (...args) => dialogs.push(args), toast: () => assert.fail('Expected an actionable dialog') });
  shared.sync = { pending: starterWorkspace(), draftSaved: false, viewError: null, conflict: null };
  shared.status = '网络离线 · 更改仅保留在当前页面';
  await shared.handleAction({ dataset: { cloudAction: 'sync-status' } });
  assert.match(dialogs.at(-1)[1], /更改仅保留在当前页面，请先下载备份/); assert.doesNotMatch(dialogs.at(-1)[1], /草稿已保留/);
  shared.sync.draftSaved = true;
  await shared.handleAction({ dataset: { cloudAction: 'sync-status' } }); assert.match(dialogs.at(-1)[1], /本机草稿已保留/);
  shared.sync.viewError = new Error('Failed <renderer>');
  await shared.handleAction({ dataset: { cloudAction: 'sync-status' } });
  assert.equal(dialogs.at(-1)[0], '战术界面更新失败'); assert.match(dialogs.at(-1)[1], /Failed &lt;renderer&gt;/);
  assert.match(dialogs.at(-1)[2], /reload-cloud/); assert.match(dialogs.at(-1)[2], /export-conflict/);
  await assert.rejects(shared.handleAction({ dataset: { cloudAction: 'save-now' } }), error => error === shared.sync.viewError);
});

test('a workspace rendering hook failure is surfaced during startup instead of reporting a merge or successful load', async t => {
  const win = new Window({ url: 'https://playbook.test/editor/index.html' });
  win.document.body.innerHTML = '<div id="cloud-root"></div>';
  const names = ['window', 'document', 'localStorage', 'location', 'history'];
  const previous = Object.fromEntries(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  for (const name of names) Object.defineProperty(globalThis, name, { configurable: true, value: win[name] });
  const failure = new Error('Editor render failed'), statuses = [], logged = t.mock.method(console, 'error', () => {});
  const record = { id: 'book', title: 'Team', role: 'editor', revision: 1, data: starterWorkspace() };
  t.mock.method(globalThis, 'fetch', async path => Response.json(path === '/api/session' ? { user: { id: 'coach' } } : path === '/api/workspaces' ? { workspaces: [record] } : record));
  const shared = new SharedWorkspace({ showEditor: () => {}, onStatus: value => statuses.push(value), onData: () => { throw failure; } });
  shared.renderBar = () => {};
  try {
    await shared.init();
    assert.equal(shared.sync.viewError, failure); assert.equal(logged.mock.calls.at(-1).arguments[1], failure);
    assert.match(win.document.querySelector('.cloud-gate').textContent, /无法加载团队战术.*Editor render failed/);
    assert.match(statuses.at(-1), /界面更新失败/); assert.doesNotMatch(statuses.at(-1), /已同步|网络离线|人工合并/);
    assert.equal(shared.pollTimer, null);
  } finally {
    shared.sync?.dispose(); await win.happyDOM.abort();
    for (const name of names) { if (previous[name]) Object.defineProperty(globalThis, name, previous[name]); else delete globalThis[name]; }
  }
});
