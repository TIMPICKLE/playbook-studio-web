import { clone, decodeWorkspace, escapeHTML as e, encodeWorkspace, STORAGE_KEY } from './model.js';
import { CloudSync } from './sync.js';
export const CLOUD_SITE = 'https://playbook-studio-tim.kind-wolf-6204.chatgpt.site';
export const cloudMode = () => location.pathname.startsWith('/editor/');
export async function request(path, options = {}) {
  const { body, ...rest } = options;
  const response = await fetch(path, { credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(15000), ...rest, headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined });
  let payload; try { payload = await response.json(); } catch { payload = { error: '云端响应暂时不可用' }; }
  if (!response.ok) { const error = new Error(payload.error || '请求失败'); Object.assign(error, { status: response.status, payload }); throw error; }
  return payload;
}
const roleName = role => ({ owner: '管理员', editor: '编辑者', viewer: '只读成员' })[role] || '';
export class SharedWorkspace {
  constructor(hooks) { this.hooks = hooks; this.user = null; this.books = []; this.sync = null; this.actions = {}; this.pollTimer = null; this.status = '正在连接云端'; }
  get canEdit() { return !!this.sync?.canEdit; }
  get current() { return this.sync?.current; }
  get dirty() { return !!this.sync?.dirty; }
  setStatus(value) { this.status = value; this.hooks.onStatus(value); const node = document.querySelector('#cloud-status'); if (node) node.textContent = value; }
  renderBar() {
    const root = document.querySelector('#cloud-root');
    if (!this.user) {
      const returnTo = `${location.pathname}${location.search}`;
      root.innerHTML = `<div class="cloud-gate"><img src="./icon.svg" alt="" width="52" height="52"><h1>共享战术工作台</h1><p>登录后使用云端战术本，与被邀请的成员共同查看和编辑。</p><a class="button primary" href="/signin-with-chatgpt?return_to=${encodeURIComponent(returnTo)}" target="_top">使用 ChatGPT 登录</a><small>管理员邀请成员加入，按编辑或只读权限协作。</small></div>`; return;
    }
    root.innerHTML = `<div class="cloud-bar"><div class="cloud-brand">☁ <strong>共享战术本</strong></div><select id="cloud-workspace" aria-label="选择共享战术本">${this.books.length ? this.books.map(b => `<option value="${e(b.id)}" ${b.id === this.current?.id ? 'selected' : ''}>${e(b.title)} · ${roleName(b.role)}</option>`).join('') : '<option value="">暂无战术本</option>'}</select><span class="cloud-role">${roleName(this.current?.role)}</span><button id="cloud-status" class="cloud-status" data-cloud-action="sync-status" title="查看同步状态">${e(this.status)}</button><div class="cloud-bar-actions"><button data-cloud-action="new">新建</button><button data-cloud-action="migrate">导入本机</button>${this.current?.role === 'owner' ? '<button data-cloud-action="members">成员权限</button>' : ''}${this.current ? '<button data-cloud-action="history">历史版本</button>' : ''}<span title="${e(this.user.email)}">${e(this.user.name)}</span><a href="/signout-with-chatgpt?return_to=%2Feditor%2Findex.html" target="_top">退出</a></div></div>`;
    if (!this.books.length) root.insertAdjacentHTML('beforeend', '<div class="cloud-empty"><h2>开始一个共享战术本</h2><p>新建战术本后，你会成为管理员；也可以把本机战术导入云端。</p><button class="button primary" data-cloud-action="new">新建云端战术本</button><button class="button subtle" data-cloud-action="migrate">导入本机战术</button><p class="muted">收到邀请的成员，请使用对应邀请链接加入。</p></div>');
  }
  async init() {
    this.hooks.showEditor(false);
    try {
      this.user = (await request('/api/session')).user; this.renderBar(); if (!this.user) return;
      this.sync = new CloudSync({ request, userId: this.user.id, isBusy: this.hooks.isBusy, onStatus: value => this.setStatus(value), onData: (data, record) => { try { const validated = decodeWorkspace(encodeWorkspace(data)); this.hooks.onData(validated, record); this.hooks.showEditor(true); this.renderBar(); } catch { this.setStatus('更改需要人工合并，请导出备份'); } }, onConflict: (remote, local) => this.conflictModal(remote, local), onAccessLost: error => this.accessLost(error) });
      document.addEventListener('click', event => { const n = event.target.closest('[data-cloud-action]'); if (n) { event.preventDefault(); this.handleAction(n).catch(error => this.hooks.toast(error.message)); } });
      document.addEventListener('change', event => { if (event.target.id === 'cloud-workspace') this.switchBook(event.target.value).catch(error => this.hooks.toast(error.message)); });
      window.addEventListener('beforeunload', event => { if (this.dirty) { event.preventDefault(); event.returnValue = ''; } });
      await this.refreshBooks();
      const invite = new URLSearchParams(location.search).get('invite');
      if (invite) {
        try { const preview = await request(`/api/invites/${encodeURIComponent(invite)}`); this.hooks.openModal('加入共享战术本', `<p>你被邀请加入「${e(preview.title)}」，权限为 <strong>${roleName(preview.role)}</strong>。</p>`, '<button class="button primary" data-cloud-action="accept-invite">接受邀请</button>'); this.inviteToken = invite; }
        catch (error) { this.hooks.toast(error.message); }
      }
      if (this.books.length) { const selected = new URLSearchParams(location.search).get('workspace'); await this.switchBook(this.books.some(b => b.id === selected) ? selected : this.books[0].id); }
      this.pollTimer = window.setInterval(() => this.sync.poll(), 6000);
      window.addEventListener('online', () => this.sync.pending ? this.sync.flush() : this.sync.poll());
    } catch (error) {
      document.querySelector('#cloud-root').innerHTML = `<div class="cloud-gate"><h2>暂时无法连接云端</h2><p>${e(error.message)}</p><button class="button primary" onclick="location.reload()">重试连接</button></div>`;
    }
  }
  async refreshBooks() { this.books = (await request('/api/workspaces')).workspaces; this.renderBar(); }
  async switchBook(workspaceId) {
    if (!workspaceId || this.current?.id === workspaceId) return;
    if (this.dirty) { this.renderBar(); this.hooks.toast('请等当前更改同步完成，或先处理冲突再切换。'); return; }
    const record = await request(`/api/workspaces/${encodeURIComponent(workspaceId)}`); this.sync.load(record);
    const url = new URL(location.href); url.searchParams.set('workspace', record.id); if (!url.searchParams.has('invite')) history.replaceState(null, '', url);
  }
  schedule(data) { this.sync?.schedule(data); }
  showCreate(data = null, label = '新建云端战术本') {
    if (this.dirty) { this.hooks.toast('请先同步或处理当前更改。'); return; }
    this.createData = data;
    this.hooks.openModal(label, `<label class="form-field"><span>战术本名称</span><input id="cloud-new-title" value="${e(data ? data.team.name : '我的球队战术本')}" maxlength="80"></label>${data ? '' : '<label class="form-field"><span>从旧版 JSON 备份迁移（可选）</span><input id="cloud-new-file" type="file" accept=".json,application/json"></label>'}<p class="muted small">创建后你是管理员，可以邀请编辑者和只读成员。${data ? `将上传 ${data.plays.length} 个战术；本地原文件仍保留。` : '选择文件会完整导入；不选文件则包含 8 个教学示例。'}</p>`, '<button class="button primary" data-cloud-action="create">保存到云端</button>');
  }
  async membersModal() {
    const records = await request(`/api/workspaces/${this.current.id}/members`);
    this.hooks.openModal('成员与权限', `<p class="muted small">管理员可邀请、调整权限与移除成员。邀请链接仅对应邮箱可用，7 天内有效。</p><div class="cloud-member-list">${records.members.map(m => `<div class="cloud-member"><span><strong>${e(m.name)}</strong><small>${e(m.email)}</small></span>${m.role === 'owner' ? '<b class="tag">管理员</b>' : `<select data-member-id="${e(m.id)}" aria-label="${e(m.name)}的权限"><option value="editor" ${m.role === 'editor' ? 'selected' : ''}>编辑者</option><option value="viewer" ${m.role === 'viewer' ? 'selected' : ''}>只读成员</option></select><button data-cloud-action="save-role" data-id="${e(m.id)}">保存</button><button class="cloud-danger" data-cloud-action="remove-member" data-id="${e(m.id)}">移除</button>`}</div>`).join('')}</div><div class="inspector-divider"></div><div class="form-row"><label class="form-field"><span>邀请邮箱</span><input type="email" id="cloud-invite-email" placeholder="成员登录 ChatGPT 的邮箱" maxlength="254"></label><label class="form-field"><span>权限</span><select id="cloud-invite-role"><option value="editor">编辑者</option><option value="viewer">只读成员</option></select></label></div><button class="button primary" data-cloud-action="invite">生成邀请链接</button><div id="cloud-invite-result"></div>${records.invites.length ? `<div class="inspector-divider"></div><div class="inspector-heading">等待加入</div>${records.invites.map(i => `<div class="cloud-pending"><span>${e(i.email)} · ${roleName(i.role)}</span><button data-cloud-action="revoke-invite" data-id="${e(i.id)}">撤销邀请</button></div>`).join('')}` : ''}`, '', true);
  }
  async historyModal() {
    const records = await request(`/api/workspaces/${this.current.id}/history`);
    this.hooks.openModal('云端历史版本', `<p class="muted small">保留最近 20 个已保存版本。恢复会生成新版本，不抹去历史。</p>${records.versions.map(v => `<div class="cloud-version"><span><strong>版本 ${v.revision}</strong><small>${e(v.actor || '')} · ${e(new Date(v.createdAt).toLocaleString())}</small></span><button data-cloud-action="download-version" data-revision="${v.revision}">下载备份</button>${this.current.role === 'owner' && v.revision !== this.current.revision ? `<button data-cloud-action="restore-version" data-revision="${v.revision}">恢复</button>` : ''}</div>`).join('')}`, '', true);
  }
  conflictModal(remote, local) {
    this.conflictLocal = local;
    this.hooks.openModal('需要处理协作冲突', `<p>你与其他成员修改了同一处内容。你的更改已留在本机草稿，云端版本不会被覆盖。</p><p class="muted small">可以下载自己的版本，再采用云端版本；或将自己的版本另存为一个独立战术本。</p>`, '<button class="button subtle" data-cloud-action="export-conflict">下载我的版本</button><button class="button subtle" data-cloud-action="use-remote">采用云端版本</button><button class="button primary" data-cloud-action="fork-conflict">另存战术本</button>', true);
  }
  accessLost(error) {
    this.accessError = error;
    this.sync.current.role = error.status === 403 ? 'viewer' : 'removed';
    this.sync.dispose(); this.hooks.onPermissionLost(error); this.hooks.showEditor(error.status === 403); this.renderBar();
    this.hooks.openModal('访问权限已变更', `<p>${e(error.message)}</p><p class="muted small">未同步草稿保留在本机，可先下载备份。</p>`, `${this.sync.pending ? '<button class="button subtle" data-cloud-action="export-conflict">下载未同步草稿</button>' : ''}${error.status === 403 ? '<button class="button primary" data-cloud-action="reload-cloud">以只读方式重新加载</button>' : '<a class="button primary" href="/editor/index.html" target="_top">重新打开战术本</a>'}`, true);
  }
  async handleAction(node) {
    const action = node.dataset.cloudAction;
    if (action === 'sync-status') { if (this.accessError) return this.accessLost(this.accessError); if (this.sync?.conflict) return this.conflictModal(this.sync.conflict, this.sync.pending); if (this.sync?.pending) { this.hooks.openModal('未同步更改', `<p>${e(this.status)}</p><p class="muted small">本机草稿已保留。连接恢复后会继续同步，也可下载备份。</p>`, '<button class="button subtle" data-cloud-action="export-conflict">下载草稿</button><button class="button primary" data-cloud-action="retry-sync">重试同步</button>'); return; } return this.hooks.toast(this.status); }
    if (action === 'retry-sync') { this.hooks.closeModal(); return this.sync.flush(); }
    if (action === 'reload-cloud') { const record = await request(`/api/workspaces/${this.current.id}`); this.accessError = null; this.hooks.closeModal(); this.sync.load(record); return; }
    if (action === 'new') return this.showCreate();
    if (action === 'migrate') { const raw = localStorage.getItem(STORAGE_KEY); return this.showCreate(raw ? decodeWorkspace(raw) : null, '导入旧版战术到云端'); }
    if (action === 'create') { const file = document.querySelector('#cloud-new-file')?.files?.[0]; if (file?.size > 5_000_000) throw new Error('备份过大，请拆分战术本。'); const data = file ? decodeWorkspace(await file.text()) : this.createData; const record = await request('/api/workspaces', { method: 'POST', body: { title: document.querySelector('#cloud-new-title').value, ...(data ? { data } : {}) } }); this.hooks.closeModal(); await this.refreshBooks(); this.sync.load(record); this.hooks.toast('云端战术本已创建，可以邀请成员加入。'); return; }
    if (action === 'members') return this.membersModal();
    if (action === 'history') return this.historyModal();
    if (action === 'invite') { const result = await request(`/api/workspaces/${this.current.id}/invites`, { method: 'POST', body: { email: document.querySelector('#cloud-invite-email').value, role: document.querySelector('#cloud-invite-role').value } }); this.latestInvite = result.url; document.querySelector('#cloud-invite-result').innerHTML = `<label class="form-field"><span>将链接发给 ${e(result.email)}，由对应账号登录加入</span><input readonly value="${e(result.url)}" aria-label="邀请链接"></label><button class="button subtle" data-cloud-action="copy-invite">复制链接</button>`; return; }
    if (action === 'copy-invite') { try { await navigator.clipboard.writeText(this.latestInvite); this.hooks.toast('邀请链接已复制。'); } catch { document.querySelector('[aria-label="邀请链接"]').select(); this.hooks.toast('请复制选中的邀请链接。'); } return; }
    if (action === 'accept-invite') { const record = await request(`/api/invites/${this.inviteToken}/accept`, { method: 'POST', body: {} }); this.inviteToken = ''; this.hooks.closeModal(); await this.refreshBooks(); this.sync.load(record); const u = new URL(location.href); u.searchParams.delete('invite'); u.searchParams.set('workspace', record.id); history.replaceState(null, '', u); return; }
    if (action === 'save-role') { const select = [...document.querySelectorAll('[data-member-id]')].find(n => n.dataset.memberId === node.dataset.id); await request(`/api/workspaces/${this.current.id}/members/${encodeURIComponent(node.dataset.id)}`, { method: 'PATCH', body: { role: select.value } }); this.hooks.toast('权限已更新。'); return this.membersModal(); }
    if (action === 'remove-member') { this.removingMember = node.dataset.id; this.hooks.openModal('移除成员', '<p>移除后，该成员不能继续访问或修改这份云端战术本。</p>', '<button class="button danger" data-cloud-action="confirm-remove-member">移除成员</button>'); return; }
    if (action === 'confirm-remove-member') { await request(`/api/workspaces/${this.current.id}/members/${encodeURIComponent(this.removingMember)}`, { method: 'DELETE' }); return this.membersModal(); }
    if (action === 'revoke-invite') { await request(`/api/workspaces/${this.current.id}/invites/${encodeURIComponent(node.dataset.id)}`, { method: 'DELETE' }); return this.membersModal(); }
    if (action === 'download-version') { const record = await request(`/api/workspaces/${this.current.id}/history/${node.dataset.revision}`); return this.hooks.download(encodeWorkspace(record.data), `playbook-version-${node.dataset.revision}.json`, 'application/json'); }
    if (action === 'restore-version') { if (this.dirty) return this.hooks.toast('请先同步当前修改。'); this.restoreRevision = node.dataset.revision; this.hooks.openModal('恢复历史版本', `<p>将这份共享战术本恢复到版本 ${this.restoreRevision}？当前版本仍保留在历史记录中。</p>`, '<button class="button primary" data-cloud-action="confirm-restore">恢复并同步</button>'); return; }
    if (action === 'confirm-restore') { await request(`/api/workspaces/${this.current.id}/history/${this.restoreRevision}/restore`, { method: 'POST', body: { revision: this.current.revision } }); const record = await request(`/api/workspaces/${this.current.id}`); this.hooks.closeModal(); this.sync.load(record); return; }
    if (action === 'export-conflict') return this.hooks.download(encodeWorkspace(this.sync.pending || this.conflictLocal), 'my-unsynced-playbook.json', 'application/json');
    if (action === 'use-remote') { this.hooks.closeModal(); this.sync.useRemote(); return; }
    if (action === 'fork-conflict') { const record = await request('/api/workspaces', { method: 'POST', body: { title: `${this.current.title} · 我的副本`.slice(0, 80), data: this.sync.pending || this.conflictLocal } }); this.sync.pending = null; this.sync.persist(); this.hooks.closeModal(); await this.refreshBooks(); this.sync.load(record); return; }
  }
}
