import test from 'node:test';
import assert from 'node:assert/strict';
import { CloudSync, mergeWorkspaces } from '../web/sync.js';
import { clone, decodeWorkspace, encodeWorkspace, starterWorkspace } from '../web/model.js';
const storage = () => { const entries = new Map(); return { getItem: key => entries.get(key), setItem: (key, value) => entries.set(key, value), removeItem: key => entries.delete(key) }; };
function harness(t, request, localStorage = storage(), initial = starterWorkspace()) {
  const events = { data: [], statuses: [], conflicts: [], access: [] };
  const sync = new CloudSync({ request, storage: localStorage, userId: 'coach', delay: 60000, onData: (data, record) => events.data.push({ data, record: clone(record) }), onStatus: value => events.statuses.push(value), onConflict: (...args) => events.conflicts.push(args), onAccessLost: error => events.access.push(error) });
  t.after(() => sync.dispose());
  const data = initial; sync.load({ id: 'book', title: 'Team', role: 'editor', revision: 1, data });
  return { sync, events, data, storage: localStorage };
}
test('three-way merging combines separate plays and object additions but reports competing edits and delete/edit conflicts', () => {
  const base = starterWorkspace(), local = clone(base), remote = clone(base);
  local.plays[0].title = 'My edit'; remote.plays[1].title = 'Their edit';
  local.plays[0].annotations.push({ id: 'new-local', text: 'Local' }); remote.plays[0].annotations.push({ id: 'new-remote', text: 'Remote' });
  let merged = mergeWorkspaces(base, local, remote); assert.deepEqual(merged.conflicts, []);
  assert.equal(merged.data.plays[0].title, 'My edit'); assert.equal(merged.data.plays[1].title, 'Their edit'); assert.equal(merged.data.plays[0].annotations.length, base.plays[0].annotations.length + 2);
  remote.plays[0].title = 'Competing edit'; merged = mergeWorkspaces(base, local, remote); assert.ok(merged.conflicts.some(p => p.endsWith('.title')));
  remote.plays.shift(); assert.ok(mergeWorkspaces(base, local, remote).conflicts.length);
});
test('successful cloud saves advance the revision and remove the local draft', async t => {
  const { sync, data, storage, events } = harness(t, async (path, options) => { assert.equal(options.body.revision, 1); assert.equal(path, '/api/workspaces/book'); return { revision: 2 }; });
  data.plays[0].title = 'Saved'; sync.schedule(data); assert.ok(storage.getItem(sync.key())); await sync.flush();
  assert.equal(sync.current.revision, 2); assert.equal(sync.dirty, false); assert.equal(storage.getItem(sync.key()), undefined); assert.equal(events.statuses.at(-1), '云端已同步');
});
test('edits made during an in-flight request remain pending and save against the newly returned revision', async t => {
  let finish, count = 0;
  const { sync, data } = harness(t, async (path, options) => { count++; if (count === 1) return new Promise(resolve => { finish = resolve; }); assert.equal(options.body.revision, 2); assert.equal(options.body.data.plays[0].title, 'Second'); return { revision: 3 }; });
  data.plays[0].title = 'First'; sync.schedule(data); const save = sync.flush();
  data.plays[0].title = 'Second'; sync.schedule(data); finish({ revision: 2 }); await save;
  assert.equal(sync.pending.plays[0].title, 'Second'); assert.equal(sync.base.plays[0].title, 'First');
  await sync.flush(); assert.equal(sync.dirty, false); assert.equal(sync.current.revision, 3);
});
test('stale saves merge disjoint cloud changes then retry; conflicting changes stay recoverable until resolution', async t => {
  let remote, first = true;
  const { sync, data, events } = harness(t, async () => { if (first) { first = false; throw Object.assign(new Error('Conflict'), { status: 409, payload: { latest: remote } }); } return { revision: 3 }; });
  const other = clone(data); other.plays[1].title = 'Other'; remote = { ...sync.current, revision: 2, data: other };
  data.plays[0].title = 'Mine'; sync.schedule(data); await sync.flush();
  assert.equal(sync.pending.plays[0].title, 'Mine'); assert.equal(sync.pending.plays[1].title, 'Other'); assert.equal(events.conflicts.length, 0);
  await sync.flush(); assert.equal(sync.current.revision, 3); assert.equal(sync.dirty, false);
  const b = clone(sync.base), l = clone(b); l.plays[0].title = 'New mine'; b.plays[0].title = 'New theirs';
  sync.request = async () => { throw Object.assign(new Error('Conflict'), { status: 409, payload: { latest: { ...sync.current, revision: 4, data: b } } }); };
  sync.schedule(l); await sync.flush(); assert.equal(events.conflicts.length, 1); assert.ok(sync.dirty); assert.equal(sync.pending.plays[0].title, 'New mine');
  sync.useRemote(); assert.equal(sync.dirty, false); assert.equal(sync.base.plays[0].title, 'New theirs');
});
test('offline drafts survive a reload and merge with independent later cloud changes', async t => {
  const { sync, data, storage: saved } = harness(t, async () => { throw new TypeError('Offline'); });
  data.plays[0].title = 'Offline work'; sync.schedule(data); await sync.flush(); assert.ok(sync.dirty);
  const other = clone(sync.base); other.plays[1].title = 'While offline';
  const fresh = harness(t, async () => ({ revision: 3 }), saved, other).sync;
  fresh.load({ ...fresh.current, revision: 2, data: other });
  assert.equal(fresh.pending.plays[0].title, 'Offline work'); assert.equal(fresh.pending.plays[1].title, 'While offline');
  await fresh.flush(); assert.equal(fresh.dirty, false);
});
test('role changes update an idle viewer; denied writes keep a draft and stop retries', async t => {
  const { sync, data, events } = harness(t, async () => ({ unchanged: true, revision: 1, role: 'viewer' }));
  await sync.poll(); assert.equal(sync.canEdit, false); assert.equal(events.data.at(-1).record.role, 'viewer');
  sync.schedule(data); assert.equal(sync.pending, null);
  sync.current.role = 'editor'; data.plays[0].title = 'Not allowed'; sync.schedule(data);
  sync.request = async () => { throw Object.assign(new Error('Permission changed'), { status: 403 }); };
  await sync.flush(); assert.equal(events.access.length, 1); assert.ok(sync.pending); assert.equal(sync.saving, false); assert.equal(sync.timer?._destroyed, true);
});

test('invalid save acknowledgements retain the revision and draft until a valid retry succeeds', async t => {
  for (const response of [null, {}, { revision: '2' }, { revision: 1 }, { revision: 3 }]) {
    await t.test(JSON.stringify(response), async t => {
      const { sync, data, storage, events } = harness(t, async () => response);
      data.plays[0].title = 'Keep this edit'; sync.schedule(data); await sync.flush();
      assert.equal(sync.current.revision, 1); assert.ok(sync.pending); assert.ok(storage.getItem(sync.key()));
      assert.notEqual(sync.base.plays[0].title, 'Keep this edit'); assert.match(events.statuses.at(-1), /未返回有效的保存确认/);
      assert.equal(sync.timer?._destroyed, true);
      sync.request = async () => ({ revision: 2 }); await sync.flush();
      assert.equal(sync.current.revision, 2); assert.equal(sync.dirty, false); assert.equal(storage.getItem(sync.key()), undefined);
      assert.equal(events.statuses.at(-1), '云端已同步');
    });
  }
});

test('failed draft writes remain visible while offline and recover only after storage succeeds', async t => {
  const saved = storage(); let failWrites = true;
  const localStorage = { ...saved, setItem(key, value) { if (failWrites) throw new DOMException('Quota exceeded', 'QuotaExceededError'); saved.setItem(key, value); } };
  const { sync, data, events } = harness(t, async () => { throw new TypeError('Failed to fetch'); }, localStorage);
  data.plays[0].title = 'Only in memory'; sync.schedule(data);
  assert.equal(sync.draftSaved, false); assert.match(events.statuses.at(-1), /本机草稿未保存/);
  await sync.flush();
  assert.equal(saved.getItem(sync.key()), undefined); assert.ok(sync.pending);
  assert.match(events.statuses.at(-1), /更改仅保留在当前页面/); assert.match(events.statuses.at(-1), /本机草稿未保存/);
  assert.doesNotMatch(events.statuses.at(-1), /草稿已保留/);
  sync.load(sync.current); assert.equal(sync.pending.plays[0].title, 'Only in memory');
  failWrites = false; await sync.flush();
  assert.equal(sync.draftSaved, true); assert.ok(saved.getItem(sync.key())); assert.equal(sync.storageError, null);
  assert.equal(events.statuses.at(-1), '网络离线 · 本机草稿已保留');
  sync.request = async () => ({ revision: 2 }); await sync.flush();
  assert.equal(sync.dirty, false); assert.equal(saved.getItem(sync.key()), undefined); assert.equal(events.statuses.at(-1), '云端已同步');
});

test('missing browser storage is explicitly unavailable rather than a successful no-op', async t => {
  const { sync, data, events } = harness(t, async () => { throw new TypeError('Offline'); }, null);
  data.plays[0].title = 'No storage'; sync.schedule(data); await sync.flush();
  assert.ok(sync.storageError); assert.equal(sync.draftSaved, false);
  assert.match(events.statuses.at(-1), /本机草稿未保存/); assert.doesNotMatch(events.statuses.at(-1), /草稿已保留/);
});

test('render failures keep the original error and never become synchronized or offline status', async t => {
  const logged = t.mock.method(console, 'error', () => {});
  const { sync, events } = harness(t, async () => ({ ...sync.current, revision: 2 }));
  const failure = new Error('Renderer failed');
  sync.onData = () => { throw failure; };
  assert.equal(sync.load(sync.current), false); assert.equal(sync.viewError, failure);
  assert.equal(sync.canEdit, false);
  assert.equal(logged.mock.calls.at(-1).arguments[1], failure);
  assert.match(events.statuses.at(-1), /界面更新失败/); assert.doesNotMatch(events.statuses.at(-1), /已同步|网络离线|合并/);
  await sync.poll(); assert.equal(sync.viewError, failure); assert.match(events.statuses.at(-1), /界面更新失败/);
  sync.onData = () => {}; await sync.poll();
  assert.equal(sync.viewError, null); assert.equal(sync.canEdit, true); assert.equal(events.statuses.at(-1), '云端已同步');
});

test('business-invalid merges preserve the valid local draft and require explicit conflict resolution after reload', async t => {
  let latest, writes = 0;
  const { sync, data, storage: saved, events } = harness(t, async () => { writes++; throw Object.assign(new Error('Conflict'), { status: 409, payload: { latest } }); });
  const local = clone(data), remote = clone(data), target = data.plays[0].players.find(p => !data.plays[0].routes.some(r => r.playerId === p.id));
  local.plays[0].players.find(p => p.id === target.id).x += 1;
  remote.plays[0].routes.push({ id: 'remote-route', playerId: target.id, points: [{ x: target.x, y: target.y }, { x: target.x, y: target.y - 5 }], kind: 'route', color: '#ffffff', smooth: false, endCap: 'arrow', delay: 0, duration: 1, optional: false });
  assert.doesNotThrow(() => decodeWorkspace(encodeWorkspace(local)));
  assert.doesNotThrow(() => decodeWorkspace(encodeWorkspace(remote)));
  assert.deepEqual(mergeWorkspaces(data, local, remote).conflicts, []);
  latest = { ...sync.current, revision: 2, data: remote }; sync.schedule(local); await sync.flush();
  assert.deepEqual(sync.pending, local); assert.equal(sync.conflict, sync.current); assert.equal(events.conflicts.length, 1);
  assert.match(sync.conflictReason, /路线起点与球员位置不一致/); assert.equal(sync.timer?._destroyed, true);
  assert.doesNotThrow(() => decodeWorkspace(encodeWorkspace(events.data.at(-1).data)));
  await sync.flush(); assert.equal(writes, 1);
  const reloaded = harness(t, async () => { throw new Error('A conflict must not autosave'); }, saved, remote).sync;
  reloaded.load(latest); assert.ok(reloaded.conflict); assert.deepEqual(reloaded.pending, local); assert.match(reloaded.conflictReason, /路线起点/);
  reloaded.useRemote(); assert.equal(reloaded.dirty, false); assert.deepEqual(reloaded.base, remote); assert.equal(saved.getItem(reloaded.key()), undefined);
});

test('invalid cloud data is rejected before replacing the active record', t => {
  const { sync } = harness(t, async () => {}), previous = sync.current;
  const invalid = clone(sync.base); invalid.plays[0].routes[0].points[0].x += 1;
  assert.throws(() => sync.load({ ...previous, id: 'invalid-book', data: invalid }), /路线起点/);
  assert.equal(sync.current, previous);
});

test('a malformed draft in another workspace cannot retarget edits from the current workspace', async t => {
  const writes = [], { sync, data, storage: saved } = harness(t, async (path, options) => { writes.push({ path, options }); return { revision: 2 }; });
  const original = sync.current, other = starterWorkspace(), invalid = clone(other);
  invalid.plays[0].players[0].x = 101;
  saved.setItem(sync.key('other-book'), JSON.stringify({ revision: 1, base: other, data: invalid }));
  assert.throws(() => sync.load({ id: 'other-book', role: 'editor', revision: 1, data: other }), /横坐标/);
  assert.equal(sync.current, original); assert.deepEqual(sync.base, data); assert.equal(sync.canEdit, true);
  data.plays[0].title = 'Edit the original book'; sync.schedule(data); await sync.flush();
  assert.equal(writes.length, 1); assert.equal(writes[0].path, '/api/workspaces/book');
  assert.equal(writes[0].options.body.data.plays[0].title, 'Edit the original book');
});

test('adopting the remote version cannot reread a rejected draft when storage cleanup fails', async t => {
  const saved = storage(), localStorage = { ...saved, removeItem() { throw new Error('Storage blocked'); } };
  let latest;
  const { sync, data, events } = harness(t, async () => { throw Object.assign(new Error('Conflict'), { status: 409, payload: { latest } }); }, localStorage);
  const remote = clone(data); remote.plays[0].title = 'Use remote'; latest = { ...sync.current, revision: 2, data: remote };
  data.plays[0].title = 'Rejected local'; sync.schedule(data); await sync.flush(); assert.ok(sync.conflict); assert.ok(saved.getItem(sync.key()));
  assert.equal(sync.useRemote(), true);
  assert.equal(sync.pending, null); assert.equal(sync.conflict, null); assert.equal(sync.dirty, false);
  assert.equal(events.data.at(-1).data.plays[0].title, 'Use remote'); assert.deepEqual(sync.base, remote);
  assert.ok(sync.storageError); assert.match(events.statuses.at(-1), /本机草稿存储不可用/);
});
