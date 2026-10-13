import test from 'node:test';
import assert from 'node:assert/strict';
import { CloudSync, mergeWorkspaces } from '../web/sync.js';
import { clone, starterWorkspace } from '../web/model.js';
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
