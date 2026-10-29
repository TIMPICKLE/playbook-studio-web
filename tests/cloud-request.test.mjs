import test from 'node:test';
import assert from 'node:assert/strict';
import { request } from '../web/cloud.js';
import { CloudSync } from '../web/sync.js';
import { clone, starterWorkspace } from '../web/model.js';

test('a successful HTTP response with malformed JSON is an explicit protocol error', async t => {
  t.mock.method(globalThis, 'fetch', async () => new Response('<html>Gateway failure</html>', { status: 200 }));
  await assert.rejects(request('/api/workspaces/book'), error => {
    assert.equal(error.code, 'invalid_response'); assert.equal(error.status, 200); assert.ok(error.cause instanceof SyntaxError);
    return true;
  });
});

test('non-JSON HTTP failures retain their status and normal JSON responses are unchanged', async t => {
  let response = () => new Response('Service unavailable', { status: 503 });
  t.mock.method(globalThis, 'fetch', async () => response());
  await assert.rejects(request('/api/workspaces/book'), error => error.status === 503 && /云端响应暂时不可用/.test(error.message));
  response = () => Response.json({ revision: 2 }); assert.deepEqual(await request('/api/workspaces/book'), { revision: 2 });
});

test('malformed HTTP success cannot erase an unsynchronized draft', async t => {
  let response = () => new Response('<html>Not saved</html>', { status: 200 });
  t.mock.method(globalThis, 'fetch', async () => response());
  const entries = new Map(), statuses = [], data = starterWorkspace();
  const storage = { getItem: key => entries.get(key), setItem: (key, value) => entries.set(key, value), removeItem: key => entries.delete(key) };
  const sync = new CloudSync({ request, storage, userId: 'coach', delay: 60000, onData: () => {}, onStatus: value => statuses.push(value), onConflict: () => {} });
  t.after(() => sync.dispose());
  sync.load({ id: 'book', role: 'editor', revision: 1, data });
  const changed = clone(data); changed.plays[0].title = 'Must survive'; sync.schedule(changed); await sync.flush();
  assert.equal(sync.current.revision, 1); assert.equal(sync.pending.plays[0].title, 'Must survive'); assert.ok(entries.has(sync.key()));
  assert.equal(sync.dirty, true); assert.match(statuses.at(-1), /云端响应格式不正确/); assert.doesNotMatch(statuses.at(-1), /已同步/);
  response = () => Response.json({ revision: 2 }); await sync.flush();
  assert.equal(sync.dirty, false); assert.equal(sync.current.revision, 2); assert.equal(entries.has(sync.key()), false);
});
