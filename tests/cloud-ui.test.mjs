import test from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { readFileSync } from 'node:fs';
import { clone, encodeWorkspace, starterWorkspace, STORAGE_KEY } from '../web/model.js';

test('cloud editor restricts readers, saves editor changes, imports legacy JSON and manages owner invitations', async t => {
  const win = new Window({ url: 'https://playbook.test/editor/index.html', width: 1440, height: 1000 });
  win.document.body.innerHTML = readFileSync(new URL('../web/index.html', import.meta.url), 'utf8').split('<body>')[1].split('</body>')[0];
  const legacy = encodeWorkspace(starterWorkspace()); win.localStorage.setItem(STORAGE_KEY, legacy);
  const record = { id: 'book', title: 'Team', role: 'viewer', revision: 1, data: starterWorkspace() }, calls = [];
  let poll;
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
    if (path.includes('?after=')) return response({ unchanged: true, revision: record.revision, role: record.role });
    return response(clone(record));
  } });
  const settle = async () => { for (let i = 0; i < 12; i++) await new Promise(resolve => setImmediate(resolve)); };
  const q = selector => win.document.querySelector(selector);
  try {
    await import(`../web/app.js?cloud-test=${Date.now()}`); await settle();
    await t.test('viewer sees shared data and exports but cannot mutate via controls, scripted events or keyboard', async () => {
      assert.equal(q('#app').hidden, false); assert.equal(q('[data-action="add-defense-43"]').disabled, true); assert.equal(q('[data-prop="title"]').disabled, true);
      assert.equal(q('[data-action="export"]').disabled, false); assert.equal(q('[data-cloud-action="members"]'), null);
      const input = q('[data-prop="title"]'); input.value = 'Unauthorized'; input.dispatchEvent(new win.Event('change', { bubbles: true }));
      win.document.body.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Delete', bubbles: true })); await settle();
      assert.equal(calls.filter(c => c.method === 'PUT').length, 0); assert.notEqual(record.data.plays[0].title, 'Unauthorized');
    });
    await t.test('viewers can resize and expand without changing shared data or issuing writes', async () => {
      const before = JSON.stringify(record.data), field = q('#field svg');
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
      assert.match(q('#cloud-status').textContent, /已同步/); assert.equal(win.localStorage.getItem(STORAGE_KEY), legacy);
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
  } finally { await win.happyDOM.abort(); for (const name of names) { if (previous[name]) Object.defineProperty(globalThis, name, previous[name]); else delete globalThis[name]; } }
});
