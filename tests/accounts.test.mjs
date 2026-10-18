import test from 'node:test';
import assert from 'node:assert/strict';
import { database } from './helpers/db.mjs';
import { handleApi } from '../server/api.mjs';
const secret = 'test-only-setup-secret-32-characters';
const pass = 'Test-only-password-42';
async function api(db, path, { method = 'GET', body, cookie, setup, platform, origin = 'https://playbook.test' } = {}) {
  const response = await handleApi(new Request('https://playbook.test/api' + path, { method, headers: { Origin: origin, ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}), ...(setup ? { 'X-Playbook-Setup-Key': setup } : {}) }, body: body ? JSON.stringify(body) : undefined }), { DB: db, PLAYBOOK_SETUP_KEY: secret }, platform);
  return { status: response.status, body: await response.json(), cookie: response.headers.get('set-cookie')?.split(';')[0], headers: response.headers };
}
async function setup(db) {
  const result = await api(db, '/auth/bootstrap', { method: 'POST', setup: secret, body: { accounts: [{ username: 'tim_admin', name: 'Head Coach', password: pass, role: 'owner' }, { username: 'coach_01', name: 'Assistant', password: pass + '-coach', role: 'editor' }, { username: 'player_01', name: 'Player', password: pass + '-player', role: 'viewer' }] } });
  assert.equal(result.status, 201); return result.body;
}
const login = (db, name = 'tim_admin', password = pass) => api(db, '/auth/login', { method: 'POST', body: { username: name, password } });
test('initial accounts provision atomically once, share the same book and never store plaintext passwords or sessions', async t => {
  const db = database(t);
  assert.equal((await api(db, '/auth/bootstrap', { method: 'POST', body: {}, setup: 'wrong' })).status, 404);
  const data = await setup(db), auth = await login(db);
  assert.equal(auth.status, 200); assert.match(auth.headers.get('set-cookie'), /__Host-playbook_session=.*HttpOnly; SameSite=Lax; Max-Age=604800; Secure/);
  const stored = db.sql.prepare('SELECT * FROM accounts WHERE username=?').get('tim_admin'); assert.notEqual(stored.password_hash, pass); assert.equal(stored.password_hash.length, 64);
  const session = db.sql.prepare('SELECT * FROM account_sessions').get(); assert.ok(!auth.cookie.includes(session.token_hash));
  assert.equal((await api(db, '/session', { cookie: auth.cookie })).body.user.username, 'tim_admin');
  assert.equal((await api(db, '/workspaces', { cookie: auth.cookie })).body.workspaces[0].id, data.workspaceId);
  assert.equal((await api(db, '/auth/bootstrap', { method: 'POST', setup: secret, body: {} })).status, 409);
  const editor = await login(db, 'coach_01', pass + '-coach'), viewer = await login(db, 'player_01', pass + '-player');
  assert.equal((await api(db, `/workspaces/${data.workspaceId}`, { cookie: editor.cookie })).body.role, 'editor');
  const read = (await api(db, `/workspaces/${data.workspaceId}`, { cookie: viewer.cookie })).body;
  assert.equal(read.role, 'viewer'); assert.equal((await api(db, `/workspaces/${data.workspaceId}`, { cookie: viewer.cookie, method: 'PUT', body: { revision: 1, data: read.data } })).status, 403);
});
test('incorrect passwords, forged cookies, expired sessions and cross-origin login are rejected; attempts are rate-limited', async t => {
  const db = database(t); await setup(db);
  assert.equal((await api(db, '/auth/login', { method: 'POST', origin: 'https://other.test', body: { username: 'tim_admin', password: pass } })).status, 403);
  assert.equal((await api(db, '/session', { cookie: '__Host-playbook_session=' + 'a'.repeat(64) })).body.user, null);
  for (let i = 0; i < 8; i++) assert.equal((await login(db, 'tim_admin', 'wrong')).status, 401);
  assert.equal((await login(db)).status, 429);
  db.sql.exec('DELETE FROM auth_throttles'); const auth = await login(db); db.sql.exec('UPDATE account_sessions SET expires_at=0');
  assert.equal((await api(db, '/workspaces', { cookie: auth.cookie })).status, 401);
});
test('members can change their own password; prior sessions and passwords stop working and logout revokes access', async t => {
  const db = database(t); await setup(db); const a = await login(db), b = await login(db);
  assert.equal((await api(db, '/auth/password', { method: 'POST', cookie: a.cookie, body: { currentPassword: 'wrong', newPassword: 'Changed-private-password-12' } })).status, 400);
  const changed = await api(db, '/auth/password', { method: 'POST', cookie: a.cookie, body: { currentPassword: pass, newPassword: 'Changed-private-password-12' } });
  assert.equal(changed.status, 200); assert.equal((await api(db, '/session', { cookie: b.cookie })).body.user, null);
  assert.equal((await login(db)).status, 401); assert.equal((await login(db, 'tim_admin', 'Changed-private-password-12')).status, 200);
  assert.equal((await api(db, '/session', { cookie: changed.cookie })).body.user.username, 'tim_admin');
  await api(db, '/auth/logout', { method: 'POST', cookie: changed.cookie, body: {} });
  assert.equal((await api(db, '/session', { cookie: changed.cookie })).body.user, null);
});
test('only owners can create accounts; password resets are limited to accounts they created and revoke old sessions', async t => {
  const db = database(t), book = await setup(db), admin = await login(db), editor = await login(db, 'coach_01', pass + '-coach');
  const path = `/workspaces/${book.workspaceId}`;
  assert.equal((await api(db, path + '/accounts', { cookie: editor.cookie, method: 'POST', body: { username: 'new_coach', password: pass, role: 'editor' } })).status, 403);
  const created = await api(db, path + '/accounts', { cookie: admin.cookie, method: 'POST', body: { username: 'new_coach', password: pass, role: 'viewer' } }); assert.equal(created.status, 201);
  assert.equal((await api(db, path + '/accounts', { cookie: admin.cookie, method: 'POST', body: { username: 'new_coach', password: pass, role: 'owner' } })).status, 400);
  const before = await login(db, 'new_coach', pass);
  assert.equal((await api(db, path + `/members/${created.body.id}/password`, { cookie: admin.cookie, method: 'POST', body: { password: 'Reset-only-this-account-72' } })).status, 200);
  assert.equal((await api(db, '/session', { cookie: before.cookie })).body.user, null); assert.equal((await login(db, 'new_coach', pass)).status, 401);
  assert.equal((await login(db, 'new_coach', 'Reset-only-this-account-72')).status, 200);
  const otherOwner = { userId: 'other-admin', email: 'other@example.com', displayName: 'Other Coach' };
  await api(db, '/workspaces', { platform: otherOwner, method: 'POST', body: { title: 'Other book' } });
  db.sql.prepare('INSERT INTO members(workspace_id,user_id,role,joined_at) VALUES(?,?,?,?)').run(book.workspaceId, otherOwner.userId, 'owner', Date.now());
  assert.equal((await api(db, path + `/members/${created.body.id}/password`, { platform: otherOwner, method: 'POST', body: { password: 'Forbidden-reset-attempt-12' } })).status, 403);
});
test('initial accounts reuse existing owner data instead of replacing previously saved plays', async t => {
  const db = database(t), platform = { userId: 'owner', email: 'owner@example.com', displayName: 'Owner' };
  const created = await api(db, '/workspaces', { platform, method: 'POST', body: { title: 'Existing book' } });
  created.body.data.plays[0].title = 'Keep this diagram';
  await api(db, `/workspaces/${created.body.id}`, { platform, method: 'PUT', body: { revision: 1, data: created.body.data } });
  const result = await api(db, '/auth/bootstrap', { method: 'POST', setup: secret, body: { ownerEmail: platform.email, accounts: [{ username: 'tim_admin', name: 'Coach', password: pass, role: 'owner' }] } });
  assert.equal(result.body.workspaceId, created.body.id);
  const auth = await login(db), read = await api(db, `/workspaces/${created.body.id}`, { cookie: auth.cookie });
  assert.equal(read.body.data.plays[0].title, 'Keep this diagram'); assert.equal(read.body.revision, 2);
});
