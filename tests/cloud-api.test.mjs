import test from 'node:test';
import assert from 'node:assert/strict';
import { database } from './helpers/db.mjs';
import { handleApi, MAX_BODY } from '../server/api.mjs';
import { clone } from '../web/model.js';

const owner = { userId: 'owner', email: 'coach@example.com', displayName: 'Coach' };
const editor = { userId: 'editor', email: 'EDITOR@example.com', displayName: 'Assistant' };
const viewer = { userId: 'viewer', email: 'viewer@example.com', displayName: 'Player' };
const outsider = { userId: 'outsider', email: 'outsider@example.com', displayName: 'Other' };
async function call(db, path, user = owner, method = 'GET', body, headers = {}) {
  const response = await handleApi(new Request(`https://playbook.test/api${path}`, { method,
    headers: { Origin: 'https://playbook.test', ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  }), { DB: db }, user);
  return { status: response.status, body: await response.json(), headers: response.headers };
}
async function create(db) { const result = await call(db, '/workspaces', owner, 'POST', { title: 'Team A' }); assert.equal(result.status, 201); return result.body; }
async function join(db, workspace, user, role) {
  const invitation = await call(db, `/workspaces/${workspace.id}/invites`, owner, 'POST', { email: user.email, role });
  assert.equal(invitation.status, 201); const token = new URL(invitation.body.url).searchParams.get('invite');
  const accepted = await call(db, `/invites/${token}/accept`, user, 'POST', {}); assert.equal(accepted.status, 200);
  return { token, invitation: invitation.body, record: accepted.body };
}

test('unauthenticated and unrelated visitors cannot discover or read a private workspace', async t => {
  const db = database(t), record = await create(db);
  assert.equal((await call(db, '/session', null)).body.user, null);
  assert.equal((await call(db, '/workspaces', null)).status, 401);
  assert.equal((await call(db, `/workspaces/${record.id}`, null)).status, 401);
  assert.deepEqual((await call(db, '/workspaces', outsider)).body.workspaces, []);
  assert.equal((await call(db, `/workspaces/${record.id}`, outsider)).status, 404);
  assert.equal((await call(db, `/workspaces/${record.id}`, outsider, 'PUT', { revision: 1, data: record.data, userId: owner.userId, role: 'owner' })).status, 404);
  assert.match((await call(db, `/workspaces/${record.id}`)).headers.get('cache-control'), /no-store/);
});

test('shared writes, viewer read-only access, owner management and removal are enforced by SQL', async t => {
  const db = database(t), record = await create(db);
  await join(db, record, editor, 'editor'); await join(db, record, viewer, 'viewer');
  const changed = clone(record.data); changed.plays[0].title = 'Shared Mesh';
  assert.equal((await call(db, `/workspaces/${record.id}`, editor, 'PUT', { revision: 1, data: changed })).status, 200);
  const read = await call(db, `/workspaces/${record.id}`, viewer);
  assert.equal(read.body.data.plays[0].title, 'Shared Mesh'); assert.equal(read.body.revision, 2);
  assert.equal((await call(db, `/workspaces/${record.id}`, viewer, 'PUT', { revision: 2, data: changed })).status, 403);
  assert.equal((await call(db, `/workspaces/${record.id}/members`, editor)).status, 403);
  assert.equal((await call(db, `/workspaces/${record.id}/invites`, editor, 'POST', { email: outsider.email, role: 'owner' })).status, 403);
  assert.equal((await call(db, `/workspaces/${record.id}/members/owner`, owner, 'DELETE')).status, 400);
  assert.equal((await call(db, `/workspaces/${record.id}/members/owner`, owner, 'PATCH', { role: 'viewer' })).status, 400);
  assert.equal((await call(db, `/workspaces/${record.id}/members/editor`, owner, 'PATCH', { role: 'viewer' })).status, 200);
  assert.equal((await call(db, `/workspaces/${record.id}?after=2`, editor)).body.role, 'viewer');
  assert.equal((await call(db, `/workspaces/${record.id}`, editor, 'PUT', { revision: 2, data: changed })).status, 403);
  assert.equal((await call(db, `/workspaces/${record.id}/members/viewer`, owner, 'DELETE')).status, 200);
  assert.equal((await call(db, `/workspaces/${record.id}`, viewer)).status, 404);
});

test('email-bound invitations expire, revoke, and accept only once; database stores only token hashes', async t => {
  const db = database(t), record = await create(db);
  const invited = await call(db, `/workspaces/${record.id}/invites`, owner, 'POST', { email: ' EDITOR@example.com ', role: 'editor' });
  const token = new URL(invited.body.url).searchParams.get('invite');
  const stored = db.sql.prepare('SELECT * FROM invites WHERE id=?').get(invited.body.id);
  assert.equal(stored.email, 'editor@example.com'); assert.equal(stored.token_hash.length, 64); assert.notEqual(stored.token_hash, token);
  assert.equal((await call(db, `/invites/${token}`, outsider)).status, 403);
  assert.equal((await call(db, `/invites/${token}/accept`, outsider, 'POST', {})).status, 403);
  assert.equal((await call(db, `/invites/${token}/accept`, editor, 'POST', {})).body.role, 'editor');
  assert.equal((await call(db, `/invites/${token}/accept`, editor, 'POST', {})).status, 410);
  const second = await call(db, `/workspaces/${record.id}/invites`, owner, 'POST', { email: viewer.email, role: 'viewer' });
  const secondToken = new URL(second.body.url).searchParams.get('invite');
  db.sql.prepare('UPDATE invites SET expires_at=0 WHERE id=?').run(second.body.id);
  assert.equal((await call(db, `/invites/${secondToken}`, viewer)).status, 410);
  const third = await call(db, `/workspaces/${record.id}/invites`, owner, 'POST', { email: viewer.email, role: 'viewer' });
  await call(db, `/workspaces/${record.id}/invites/${third.body.id}`, owner, 'DELETE');
  assert.equal((await call(db, `/invites/${new URL(third.body.url).searchParams.get('invite')}`, viewer)).status, 410);
  const fourth = await call(db, `/workspaces/${record.id}/invites`, owner, 'POST', { email: viewer.email, role: 'viewer' });
  await call(db, `/workspaces/${record.id}/invites`, owner, 'POST', { email: viewer.email, role: 'editor' });
  assert.equal((await call(db, `/invites/${new URL(fourth.body.url).searchParams.get('invite')}`, viewer)).status, 410);
});

test('compare-and-swap rejects stale saves without overwriting data or creating phantom snapshots', async t => {
  const db = database(t), record = await create(db); await join(db, record, editor, 'editor');
  const a = clone(record.data), b = clone(record.data); a.plays[0].title = 'Winner'; b.plays[0].title = 'Stale';
  assert.equal((await call(db, `/workspaces/${record.id}`, owner, 'PUT', { revision: 1, data: a })).body.revision, 2);
  const conflict = await call(db, `/workspaces/${record.id}`, editor, 'PUT', { revision: 1, data: b });
  assert.equal(conflict.status, 409); assert.equal(conflict.body.latest.data.plays[0].title, 'Winner');
  assert.equal(db.sql.prepare('SELECT COUNT(*) AS n FROM snapshots').get().n, 2);
  assert.equal(db.sql.prepare("SELECT COUNT(*) AS n FROM audit_events WHERE action='saved'").get().n, 1);
});

test('revoking write access between initial authorization and update still prevents the write', async t => {
  const db = database(t), record = await create(db); await join(db, record, editor, 'editor');
  const changed = clone(record.data); changed.plays[0].title = 'Blocked';
  db.beforeBatch = () => db.sql.prepare("UPDATE members SET role='viewer' WHERE user_id='editor'").run();
  assert.equal((await call(db, `/workspaces/${record.id}`, editor, 'PUT', { revision: 1, data: changed })).status, 403);
  const current = (await call(db, `/workspaces/${record.id}`)).body;
  assert.equal(current.revision, 1); assert.equal(current.data.plays[0].title, record.data.plays[0].title);
  assert.equal(db.sql.prepare('SELECT COUNT(*) AS n FROM snapshots').get().n, 1);
});

test('history keeps 20 versions; only the owner can restore, with a new revision and CAS protection', async t => {
  const db = database(t), record = await create(db); await join(db, record, editor, 'editor');
  for (let n = 1; n <= 22; n++) { const data = clone(record.data); data.plays[0].title = `Revision ${n + 1}`; assert.equal((await call(db, `/workspaces/${record.id}`, editor, 'PUT', { revision: n, data })).status, 200); }
  const history = (await call(db, `/workspaces/${record.id}/history`, editor)).body.versions;
  assert.equal(history.length, 20); assert.equal(history[0].revision, 23); assert.equal(history.at(-1).revision, 4);
  assert.equal((await call(db, `/workspaces/${record.id}/history/1`)).status, 404);
  assert.equal((await call(db, `/workspaces/${record.id}/history/4/restore`, editor, 'POST', { revision: 23 })).status, 403);
  assert.equal((await call(db, `/workspaces/${record.id}/history/4/restore`, owner, 'POST', { revision: 22 })).status, 409);
  assert.equal((await call(db, `/workspaces/${record.id}/history/4/restore`, owner, 'POST', { revision: 23 })).body.revision, 24);
  assert.equal((await call(db, `/workspaces/${record.id}`)).body.data.plays[0].title, 'Revision 4');
  assert.equal((await call(db, `/workspaces/${record.id}/history`)).body.versions.length, 20);
});

test('CSRF, invalid roles, malformed JSON, body limits and unsupported backups fail before mutation', async t => {
  const db = database(t), record = await create(db);
  assert.equal((await call(db, '/workspaces', owner, 'POST', { title: 'Bad' }, { Origin: 'https://other.test' })).status, 403);
  assert.equal((await call(db, '/workspaces', owner, 'POST', null)).status, 400);
  assert.equal((await call(db, '/workspaces', owner, 'POST', { title: 'Bad', data: { plays: [] } })).status, 400);
  assert.equal((await call(db, '/workspaces', owner, 'POST', { title: 'x'.repeat(MAX_BODY) })).status, 413);
  assert.equal((await call(db, '/workspaces', owner, 'POST', { title: 'Bad' }, { 'Content-Type': 'text/plain' })).status, 415);
  assert.equal((await call(db, `/workspaces/${record.id}/invites`, owner, 'POST', { email: editor.email, role: 'owner' })).status, 400);
  assert.equal((await call(db, `/workspaces/${record.id}`, owner, 'PUT', { revision: 0, data: record.data })).status, 400);
  assert.equal((await call(db, '/workspaces')).body.workspaces.length, 1);
});
