import { fail, json, readJson } from './http.mjs';
import { starterWorkspace } from '../web/model.js';

const ITERATIONS = 100_000, SESSION_SECONDS = 7 * 86400, WINDOW = 15 * 60 * 1000;
const bytes = value => new TextEncoder().encode(value);
const hex = value => [...new Uint8Array(value)].map(n => n.toString(16).padStart(2, '0')).join('');
const random = () => hex(crypto.getRandomValues(new Uint8Array(32)));
export const digest = async value => hex(await crypto.subtle.digest('SHA-256', bytes(value)));
export function same(a, b) { if (typeof a !== 'string' || typeof b !== 'string') return false; let delta = a.length ^ b.length; for (let i = 0; i < Math.max(a.length, b.length); i++) delta |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0); return delta === 0; }
function username(value) { const v = typeof value === 'string' ? value.trim().toLowerCase() : ''; if (!/^[a-z][a-z0-9_]{2,31}$/.test(v)) fail(400, '账号须为 3–32 位小写字母、数字或下划线，并以字母开头'); return v; }
function password(value) { if (typeof value !== 'string' || value.length < 8 || value.length > 128) fail(400, '密码须为 8–128 个字符'); return value; }
export async function passwordHash(value, salt = random().slice(0, 32)) {
  const key = await crypto.subtle.importKey('raw', bytes(value), 'PBKDF2', false, ['deriveBits']);
  return { salt, hash: hex(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: bytes(salt), iterations: ITERATIONS }, key, 256)) };
}
const cookieName = request => new URL(request.url).protocol === 'https:' ? '__Host-playbook_session' : 'playbook_session_dev';
function cookieValue(request) { return request.headers.get('cookie')?.split(';').map(c => c.trim()).find(c => c.startsWith(`${cookieName(request)}=`))?.split('=')[1]; }
function cookie(request, value, age = SESSION_SECONDS) { return `${cookieName(request)}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${age}${new URL(request.url).protocol === 'https:' ? '; Secure' : ''}`; }
const identity = row => ({ userId: row.user_id, email: row.email, displayName: row.name, username: row.username, authMode: 'password' });
export async function resolveIdentity(request, env, platformUser) {
  const platform = platformUser ? { ...platformUser, authMode: 'chatgpt' } : null;
  const token = cookieValue(request);
  if (!token) return platform;
  if (!env.DB || !/^[a-f0-9]{64}$/.test(token)) return platform;
  const row = await env.DB.prepare('SELECT a.user_id,a.username,u.email,u.name FROM account_sessions s JOIN accounts a ON a.user_id=s.user_id JOIN users u ON u.id=a.user_id WHERE s.token_hash=? AND s.expires_at>? AND a.disabled=0 AND s.password_version=a.password_version').bind(await digest(token), Date.now()).first();
  return row ? identity(row) : platform;
}
async function throttle(db, key, max) {
  const now = Date.now(), row = await db.prepare('INSERT INTO auth_throttles(key,started_at,attempts) VALUES(?,?,1) ON CONFLICT(key) DO UPDATE SET attempts=CASE WHEN started_at<? THEN 1 ELSE attempts+1 END,started_at=CASE WHEN started_at<? THEN excluded.started_at ELSE started_at END RETURNING attempts').bind(await digest(key), now, now - WINDOW, now - WINDOW).first();
  if (row.attempts > max) fail(429, '尝试次数过多，请 15 分钟后重试，或联系管理员');
}
async function startSession(request, db, userId, expectedVersion) {
  const account = await db.prepare('SELECT password_version FROM accounts WHERE user_id=? AND disabled=0').bind(userId).first();
  if (!account) fail(401, '账号已停用');
  if (account.password_version !== expectedVersion) fail(401, '密码刚刚变更，请重新登录');
  const token = random(), now = Date.now();
  const result = await db.batch([
    db.prepare('DELETE FROM account_sessions WHERE expires_at<?').bind(now),
    db.prepare('INSERT INTO account_sessions(token_hash,user_id,password_version,created_at,expires_at) SELECT ?,user_id,password_version,?,? FROM accounts WHERE user_id=? AND password_version=? AND disabled=0').bind(await digest(token), now, now + SESSION_SECONDS * 1000, userId, expectedVersion),
  ]);
  if (!result[1].meta?.changes) fail(401, '密码刚刚变更，请重新登录');
  return cookie(request, token);
}
export async function createAccountStatements(db, input, creator, workspaceId, role) {
  const name = username(input.username), pass = password(input.password), display = String(input.name || name).trim();
  if (!display || display.length > 60) fail(400, '显示名称须为 1–60 个字符');
  if (!['owner', 'editor', 'viewer'].includes(role)) fail(400, '成员权限不正确');
  if (await db.prepare('SELECT user_id FROM accounts WHERE username=?').bind(name).first()) fail(409, '此账号名已使用，请更换账号名');
  const userId = `acct_${crypto.randomUUID()}`, encoded = await passwordHash(pass), now = Date.now();
  return { userId, username: name, statements: [
    db.prepare('INSERT INTO users(id,email,name,created_at) VALUES(?,?,?,?)').bind(userId, `${name}@accounts.playbook.invalid`, display, now),
    db.prepare('INSERT INTO accounts(user_id,username,password_hash,salt,password_version,disabled,created_by,created_at) VALUES(?,?,?,?,1,0,?,?)').bind(userId, name, encoded.hash, encoded.salt, creator || userId, now),
    db.prepare('INSERT INTO members(workspace_id,user_id,role,joined_at) VALUES(?,?,?,?)').bind(workspaceId, userId, role, now),
  ] };
}
export async function resetAccount(db, actor, targetId, newPassword) {
  const target = await db.prepare('SELECT created_by FROM accounts WHERE user_id=?').bind(targetId).first();
  if (!target || target.created_by !== actor.userId || targetId === actor.userId) fail(403, '只能重置由你创建的成员账号；自己的密码请在账号设置中修改');
  const encoded = await passwordHash(password(newPassword));
  await db.batch([
    db.prepare('UPDATE accounts SET password_hash=?,salt=?,password_version=password_version+1 WHERE user_id=? AND created_by=?').bind(encoded.hash, encoded.salt, targetId, actor.userId),
    db.prepare('DELETE FROM account_sessions WHERE user_id=?').bind(targetId),
  ]);
}
async function bootstrap(request, env) {
  const provided = request.headers.get('x-playbook-setup-key');
  if (!env.PLAYBOOK_SETUP_KEY || !provided || !same(await digest(provided), await digest(env.PLAYBOOK_SETUP_KEY))) fail(404, '接口不存在');
  const db = env.DB;
  if (await db.prepare("SELECT key FROM app_setup WHERE key='team-accounts-v3'").first()) fail(409, '初始账号已创建，不会重复创建或重置密码');
  const body = await readJson(request, 20000), inputs = body.accounts;
  if (!Array.isArray(inputs) || inputs.length < 1 || inputs.length > 10 || inputs[0].role !== 'owner' || inputs.slice(1).some(a => !['editor', 'viewer'].includes(a.role))) fail(400, '初始账号配置不正确');
  if (new Set(inputs.map(a => username(a.username))).size !== inputs.length) fail(400, '账号名不能重复');
  // Reuse the Site owner's existing book when available; preserve all existing diagrams.
  const existing = body.ownerEmail ? await db.prepare('SELECT w.* FROM workspaces w JOIN users u ON u.id=w.owner_id WHERE lower(u.email)=? ORDER BY w.updated_at DESC LIMIT 1').bind(String(body.ownerEmail).trim().toLowerCase()).first() : null;
  const workspaceId = existing?.id || crypto.randomUUID(), now = Date.now(), statements = [], accounts = [];
  let creator;
  for (const input of inputs) { const account = await createAccountStatements(db, input, creator, workspaceId, input.role); creator ||= account.userId; accounts.push({ id: account.userId, username: account.username, role: input.role }); statements.push(account.statements); }
  const all = [db.prepare('INSERT INTO app_setup(key,value,created_at) VALUES(?,?,?)').bind('team-accounts-v3', workspaceId, now)];
  // Users must exist before foreign keys are inserted. Workspace precedes memberships.
  all.push(...statements.map(s => s[0]));
  if (!existing) {
    const data = JSON.stringify(starterWorkspace());
    all.push(db.prepare('INSERT INTO workspaces(id,title,owner_id,data_json,revision,updated_at,updated_by,last_write_id) VALUES(?,?,?,?,1,?,?,?)').bind(workspaceId, 'TIM · 团队共享战术本', creator, data, now, creator, crypto.randomUUID()));
    all.push(db.prepare('INSERT INTO snapshots(workspace_id,revision,data_json,created_at,actor_id) VALUES(?,1,?,?,?)').bind(workspaceId, data, now, creator));
  }
  for (const s of statements) all.push(s[1], s[2]);
  all.push(db.prepare('INSERT INTO audit_events(id,workspace_id,actor_id,action,detail,created_at) VALUES(?,?,?,?,?,?)').bind(crypto.randomUUID(), workspaceId, creator, 'accounts_provisioned', String(accounts.length), now));
  await db.batch(all);
  return json({ workspaceId, title: existing?.title || 'TIM · 团队共享战术本', accounts }, 201);
}
export async function handleAuth(request, env, user) {
  const action = new URL(request.url).pathname.split('/')[3], db = env.DB;
  if (!db) fail(503, '登录服务暂不可用，请稍后重试');
  if (request.method !== 'POST') fail(405, '请求方法不支持');
  if (action === 'bootstrap') return bootstrap(request, env);
  if (action === 'logout') {
    const token = cookieValue(request); if (token) await db.prepare('DELETE FROM account_sessions WHERE token_hash=?').bind(await digest(token)).run();
    return json({ success: true }, 200, { 'Set-Cookie': cookie(request, '', 0) });
  }
  if (action === 'login') {
    const body = await readJson(request, 4096), name = username(body.username);
    if (typeof body.password !== 'string' || body.password.length > 128) fail(400, '请输入账号和密码');
    const ip = request.headers.get('cf-connecting-ip'); if (ip) await throttle(db, `ip:${ip}`, 45);
    await throttle(db, `account:${name}`, 8);
    const account = await db.prepare('SELECT a.*,u.email,u.name FROM accounts a JOIN users u ON u.id=a.user_id WHERE a.username=?').bind(name).first();
    const encoded = await passwordHash(body.password, account?.salt || 'invalid-user-fixed-time-salt-0000');
    if (!account || account.disabled || !same(encoded.hash, account.password_hash)) fail(401, '账号或密码不正确，请检查后重试');
    await db.prepare('DELETE FROM auth_throttles WHERE key=?').bind(await digest(`account:${name}`)).run();
    return json({ user: { id: account.user_id, name: account.name, username: account.username, authMode: 'password' } }, 200, { 'Set-Cookie': await startSession(request, db, account.user_id, account.password_version) });
  }
  if (action === 'password') {
    if (user?.authMode !== 'password') fail(401, '请使用团队账号登录后修改密码');
    const body = await readJson(request, 4096), account = await db.prepare('SELECT * FROM accounts WHERE user_id=?').bind(user.userId).first();
    await throttle(db, `password:${user.userId}`, 8);
    const old = await passwordHash(String(body.currentPassword || '').slice(0, 128), account.salt);
    if (!same(old.hash, account.password_hash)) fail(400, '当前密码不正确');
    if (body.newPassword === body.currentPassword) fail(400, '新密码不能与当前密码相同');
    const encoded = await passwordHash(password(body.newPassword));
    const result = await db.batch([
      db.prepare('UPDATE accounts SET password_hash=?,salt=?,password_version=password_version+1 WHERE user_id=? AND password_version=?').bind(encoded.hash, encoded.salt, user.userId, account.password_version),
    ]);
    if (!result[0].meta?.changes) fail(409, '密码已被修改，请重新登录');
    await db.prepare('DELETE FROM account_sessions WHERE user_id=?').bind(user.userId).run();
    return json({ success: true }, 200, { 'Set-Cookie': await startSession(request, db, user.userId, account.password_version + 1) });
  }
  fail(404, '接口不存在');
}
