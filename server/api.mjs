import { decodeWorkspace, starterWorkspace } from '../web/model.js';
export const MAX_BODY = 950_000;
const ROLES = ['editor', 'viewer'];
const normalizeEmail = value => typeof value === 'string' ? value.trim().toLowerCase() : '';
class ApiError extends Error { constructor(status, message) { super(message); this.status = status; } }
const fail = (status, message) => { throw new ApiError(status, message); };
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store, private', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' } });
const validId = value => /^[A-Za-z0-9_-]{1,100}$/.test(value);
const revision = value => Number.isSafeInteger(value) && value > 0 ? value : fail(400, '版本号不正确');
const role = value => ROLES.includes(value) ? value : fail(400, '仅支持编辑者或只读成员');
const id = () => crypto.randomUUID();
const timestamp = () => Date.now();
async function readJson(request) {
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) fail(415, '请使用 JSON 请求');
  if (Number(request.headers.get('content-length')) > MAX_BODY) fail(413, '战术本过大，请拆分或先导出备份');
  const reader = request.body?.getReader(); if (!reader) fail(400, '请求为空');
  const chunks = []; let size = 0;
  while (true) { const { value, done } = await reader.read(); if (done) break; size += value.byteLength; if (size > MAX_BODY) { await reader.cancel(); fail(413, '战术本过大，请拆分或先导出备份'); } chunks.push(value); }
  const bytes = new Uint8Array(size); let offset = 0; for (const c of chunks) { bytes.set(c, offset); offset += c.byteLength; }
  let body; try { body = JSON.parse(new TextDecoder().decode(bytes)); } catch { fail(400, 'JSON 格式不正确'); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) fail(400, '请求内容须为 JSON 对象');
  return body;
}
function checkedData(value) { try { return decodeWorkspace(JSON.stringify({ format: 'playbook-studio', version: 1, data: value })); } catch (error) { fail(400, `战术本校验失败：${error.message}`); } }
function title(value) { if (typeof value !== 'string' || !value.trim() || value.length > 80) fail(400, '战术本名称须为 1–80 个字符'); return value.trim(); }
function email(value) { const v = normalizeEmail(value); if (v.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) fail(400, '邮箱格式不正确'); return v; }
async function hash(value) { return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))].map(v => v.toString(16).padStart(2, '0')).join(''); }
function token() { return btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
async function access(db, workspaceId, userId, needed = 'read') {
  const row = await db.prepare('SELECT w.*,m.role FROM workspaces w JOIN members m ON m.workspace_id=w.id WHERE w.id=? AND m.user_id=?').bind(workspaceId, userId).first();
  if (!row) fail(404, '战术本不存在或你没有访问权限');
  if (needed === 'write' && !['owner', 'editor'].includes(row.role)) fail(403, '你只有查看权限');
  if (needed === 'owner' && row.role !== 'owner') fail(403, '仅管理员可以管理成员和历史版本');
  return row;
}
const document = row => ({ id: row.id, title: row.title, role: row.role, revision: row.revision, updatedAt: row.updated_at, updatedBy: row.updated_by, data: JSON.parse(row.data_json) });
async function event(db, workspaceId, actor, action, detail = '') { return db.prepare('INSERT INTO audit_events(id,workspace_id,actor_id,action,detail,created_at) VALUES(?,?,?,?,?,?)').bind(id(), workspaceId, actor, action, detail, timestamp()).run(); }
async function writeWorkspace(db, workspaceId, user, data, expected, action = 'saved', ownerOnly = false) {
  const record = await access(db, workspaceId, user.userId, ownerOnly ? 'owner' : 'write');
  const encoded = JSON.stringify(checkedData(data)); if (new TextEncoder().encode(encoded).length > MAX_BODY - 1000) fail(413, '战术本过大，请拆分或先导出备份');
  const requestId = id(), now = timestamp(), next = revision(expected) + 1;
  const allowed = ownerOnly ? "m.role='owner'" : "m.role IN ('owner','editor')";
  const result = await db.batch([
    db.prepare(`UPDATE workspaces SET data_json=?,revision=revision+1,updated_at=?,updated_by=?,last_write_id=? WHERE id=? AND revision=? AND EXISTS(SELECT 1 FROM members m WHERE m.workspace_id=workspaces.id AND m.user_id=? AND ${allowed})`).bind(encoded, now, user.userId, requestId, workspaceId, expected, user.userId),
    db.prepare('INSERT INTO snapshots(workspace_id,revision,data_json,created_at,actor_id) SELECT id,revision,data_json,updated_at,updated_by FROM workspaces WHERE id=? AND last_write_id=?').bind(workspaceId, requestId),
    db.prepare('DELETE FROM snapshots WHERE workspace_id=? AND revision<? AND EXISTS(SELECT 1 FROM workspaces WHERE id=? AND last_write_id=?)').bind(workspaceId, next - 19, workspaceId, requestId),
    db.prepare('INSERT INTO audit_events(id,workspace_id,actor_id,action,detail,created_at) SELECT ?,id,?,?,?,? FROM workspaces WHERE id=? AND last_write_id=?').bind(id(), user.userId, action, `revision:${next}`, now, workspaceId, requestId),
  ]);
  if (!result[0].meta?.changes) { const latest = await access(db, workspaceId, user.userId, ownerOnly ? 'owner' : 'write'); return json({ error: '其他成员刚刚修改了战术本，请先合并更改', code: 'revision_conflict', latest: document(latest) }, 409); }
  return json({ id: workspaceId, revision: next, updatedAt: now, role: record.role });
}
// Identity comes from the server-only ChatGPT helper, never from request JSON.
export async function handleApi(request, env, user) {
  try {
    const path = new URL(request.url).pathname.split('/').filter(Boolean).slice(1);
    if (path[0] === 'health' && request.method === 'GET') { if (!env.DB) return json({ ready: false }, 503); await env.DB.prepare('SELECT id FROM workspaces LIMIT 1').first(); return json({ ready: true, storage: 'cloud', version: '2.0.0' }); }
    if (path[0] === 'session' && request.method === 'GET') return json({ user: user ? { id: user.userId, email: user.email, name: user.displayName } : null });
    if (!user?.userId || !user.email) fail(401, '请先登录');
    if (!env.DB) fail(503, '云端数据库暂不可用');
    if (!['GET', 'HEAD'].includes(request.method) && request.headers.get('origin') !== new URL(request.url).origin) fail(403, '请求来源不正确');
    const db = env.DB, now = timestamp();
    await db.prepare('INSERT INTO users(id,email,name,created_at) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET email=excluded.email,name=excluded.name').bind(user.userId, normalizeEmail(user.email), user.displayName || user.email, now).run();
    if (path[0] === 'workspaces' && path.length === 1) {
      if (request.method === 'GET') { const rows = await db.prepare('SELECT w.id,w.title,w.revision,w.updated_at AS updatedAt,m.role FROM workspaces w JOIN members m ON m.workspace_id=w.id WHERE m.user_id=? ORDER BY w.updated_at DESC').bind(user.userId).all(); return json({ workspaces: rows.results }); }
      if (request.method === 'POST') {
        const body = await readJson(request), data = body.data ? checkedData(body.data) : starterWorkspace(), name = title(body.title), workspaceId = id();
        const count = await db.prepare('SELECT COUNT(*) AS n FROM workspaces WHERE owner_id=?').bind(user.userId).first(); if (count.n >= 50) fail(409, '每个账号最多创建 50 个战术本');
        const encoded = JSON.stringify(data); if (new TextEncoder().encode(encoded).length > MAX_BODY - 1000) fail(413, '战术本过大，请拆分');
        await db.batch([
          db.prepare('INSERT INTO workspaces(id,title,owner_id,data_json,revision,updated_at,updated_by,last_write_id) VALUES(?,?,?,?,1,?,?,?)').bind(workspaceId, name, user.userId, encoded, now, user.userId, id()),
          db.prepare('INSERT INTO members(workspace_id,user_id,role,joined_at) VALUES(?,?,?,?)').bind(workspaceId, user.userId, 'owner', now),
          db.prepare('INSERT INTO snapshots(workspace_id,revision,data_json,created_at,actor_id) VALUES(?,1,?,?,?)').bind(workspaceId, encoded, now, user.userId),
          db.prepare('INSERT INTO audit_events(id,workspace_id,actor_id,action,detail,created_at) VALUES(?,?,?,?,?,?)').bind(id(), workspaceId, user.userId, 'created', name, now),
        ]);
        return json(document(await access(db, workspaceId, user.userId)), 201);
      }
    }
    if (path[0] === 'invites' && path[1]) {
      if (!/^[A-Za-z0-9_-]{43}$/.test(path[1])) fail(404, '邀请不存在');
      const invite = await db.prepare('SELECT i.*,w.title FROM invites i JOIN workspaces w ON w.id=i.workspace_id WHERE i.token_hash=?').bind(await hash(path[1])).first();
      if (!invite || invite.status !== 'pending' || invite.expires_at <= now) fail(410, '邀请已失效或已使用，请联系管理员');
      if (normalizeEmail(user.email) !== invite.email) fail(403, '请使用被邀请的邮箱登录');
      if (path.length === 2 && request.method === 'GET') return json({ title: invite.title, role: invite.role, expiresAt: invite.expires_at });
      if (path[2] === 'accept' && request.method === 'POST') {
        const result = await db.batch([
          db.prepare("UPDATE invites SET status='accepted',accepted_by=? WHERE id=? AND status='pending' AND expires_at>?").bind(user.userId, invite.id, now),
          db.prepare("INSERT INTO members(workspace_id,user_id,role,joined_at) SELECT workspace_id,?,role,? FROM invites WHERE id=? AND status='accepted' AND accepted_by=? ON CONFLICT(workspace_id,user_id) DO NOTHING").bind(user.userId, now, invite.id, user.userId),
        ]);
        if (!result[0].meta?.changes) fail(409, '邀请已经使用'); await event(db, invite.workspace_id, user.userId, 'joined', invite.role); return json(document(await access(db, invite.workspace_id, user.userId)));
      }
    }
    if (path[0] !== 'workspaces' || !validId(path[1] || '')) fail(404, '接口不存在');
    const workspaceId = path[1];
    if (path.length === 2) {
      if (request.method === 'GET') { const record = await access(db, workspaceId, user.userId); const after = Number(new URL(request.url).searchParams.get('after')); return json(after === record.revision ? { unchanged: true, revision: record.revision, role: record.role } : document(record)); }
      if (request.method === 'PUT') { const body = await readJson(request); return await writeWorkspace(db, workspaceId, user, body.data, body.revision); }
    }
    if (path[2] === 'members') {
      await access(db, workspaceId, user.userId, 'owner');
      if (path.length === 3 && request.method === 'GET') { const members = await db.prepare('SELECT m.user_id AS id,u.email,u.name,m.role FROM members m JOIN users u ON u.id=m.user_id WHERE m.workspace_id=? ORDER BY m.joined_at').bind(workspaceId).all(); const invites = await db.prepare("SELECT id,email,role,expires_at AS expiresAt FROM invites WHERE workspace_id=? AND status='pending' AND expires_at>? ORDER BY created_at DESC").bind(workspaceId, now).all(); return json({ members: members.results, invites: invites.results }); }
      const target = await db.prepare('SELECT role FROM members WHERE workspace_id=? AND user_id=?').bind(workspaceId, path[3] || '').first(); if (!target) fail(404, '成员不存在'); if (target.role === 'owner') fail(400, '管理员身份不能被移除或降级');
      if (request.method === 'PATCH') { const body = await readJson(request); await db.prepare("UPDATE members SET role=? WHERE workspace_id=? AND user_id=? AND role<>'owner'").bind(role(body.role), workspaceId, path[3]).run(); await event(db, workspaceId, user.userId, 'role_changed', `${path[3]}:${body.role}`); return json({ success: true }); }
      if (request.method === 'DELETE') { await db.prepare("DELETE FROM members WHERE workspace_id=? AND user_id=? AND role<>'owner'").bind(workspaceId, path[3]).run(); await event(db, workspaceId, user.userId, 'removed', path[3]); return json({ success: true }); }
    }
    if (path[2] === 'invites') {
      await access(db, workspaceId, user.userId, 'owner');
      if (path.length === 3 && request.method === 'POST') {
        const body = await readJson(request), recipient = email(body.email), assigned = role(body.role); const existing = await db.prepare('SELECT m.user_id FROM members m JOIN users u ON u.id=m.user_id WHERE m.workspace_id=? AND u.email=?').bind(workspaceId, recipient).first(); if (existing) fail(409, '该成员已经加入，请直接调整其权限');
        const secret = token(), inviteId = id(), expires = now + 7 * 24 * 60 * 60 * 1000;
        await db.batch([db.prepare("UPDATE invites SET status='revoked' WHERE workspace_id=? AND email=? AND status='pending'").bind(workspaceId, recipient), db.prepare('INSERT INTO invites(id,workspace_id,token_hash,email,role,created_by,created_at,expires_at,status) VALUES(?,?,?,?,?,?,?,?,?)').bind(inviteId, workspaceId, await hash(secret), recipient, assigned, user.userId, now, expires, 'pending')]);
        await event(db, workspaceId, user.userId, 'invited', `${recipient}:${assigned}`); return json({ id: inviteId, email: recipient, role: assigned, expiresAt: expires, url: new URL(`/editor/index.html?invite=${secret}`, request.url).href }, 201);
      }
      if (path.length === 4 && request.method === 'DELETE') { await db.prepare("UPDATE invites SET status='revoked' WHERE id=? AND workspace_id=? AND status='pending'").bind(path[3], workspaceId).run(); return json({ success: true }); }
    }
    if (path[2] === 'history') {
      await access(db, workspaceId, user.userId);
      if (request.method === 'GET' && path.length === 3) { const rows = await db.prepare('SELECT s.revision,s.created_at AS createdAt,u.name AS actor FROM snapshots s LEFT JOIN users u ON u.id=s.actor_id WHERE s.workspace_id=? ORDER BY s.revision DESC LIMIT 20').bind(workspaceId).all(); return json({ versions: rows.results }); }
      const record = await db.prepare('SELECT data_json FROM snapshots WHERE workspace_id=? AND revision=?').bind(workspaceId, revision(Number(path[3]))).first(); if (!record) fail(404, '版本不存在');
      if (request.method === 'GET' && path.length === 4) return json({ data: JSON.parse(record.data_json) });
      if (request.method === 'POST' && path[4] === 'restore') { const body = await readJson(request); return await writeWorkspace(db, workspaceId, user, JSON.parse(record.data_json), body.revision, 'restored', true); }
    }
    fail(404, '接口不存在');
  } catch (error) { if (error instanceof ApiError) return json({ error: error.message }, error.status); console.error('Playbook cloud API error:', error?.message); return json({ error: '云端服务暂时不可用，请稍后重试' }, 500); }
}
