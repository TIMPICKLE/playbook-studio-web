import { effectsControl } from './effects.js';
import { starterWorkspace, clone, decodeWorkspace, escapeHTML as e, encodeWorkspace, STORAGE_KEY } from './model.js';
import { CloudSync } from './sync.js';
import { fieldSVG } from './field.js';
import { feedback, resetFeedback, feedbackBox, passwordField, readableError, arrowIcon } from './ui.js';
import { currentBookCard, createBookSwitcher } from './book-switcher.js';
import { reconcileHTML } from './reconcile.js';
export const CLOUD_SITE = 'https://playbook-studio-tim.kind-wolf-6204.chatgpt.site';
export const cloudMode = () => location.pathname.startsWith('/editor/') && !/\/local(?:\.html)?\/?$/.test(location.pathname);
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
  setStatus(value) { this.status = value; this.hooks.onStatus(value); const node = document.querySelector('#cloud-status'); if (node) { node.innerHTML = `<i></i><span>${e(value)}</span>`; node.dataset.state = this.statusState(); } queueMicrotask(() => this.updateBookCards()); }
  renderBar() {
    const root = document.querySelector('#cloud-root');
    if (!this.user) { this.renderLogin(); return; }
    reconcileHTML(root, `<header class="cloud-bar"><a class="cloud-brand" href="/editor/"><img src="./assets/stingers-mark.png" width="32" height="32" alt=""><span>STINGERS<small>Playbook Studio · 团队战术</small></span></a>${currentBookCard(this.books, this.current)}<div class="cloud-sync"><button id="cloud-status" class="cloud-status" data-cloud-action="sync-status" title="查看同步详情" data-state="${this.statusState()}"><i></i><span>${e(this.status)}</span></button>${this.current && this.canEdit ? '<button class="save-now" data-cloud-action="save-now">立即保存</button>' : ''}</div><nav class="cloud-bar-actions" aria-label="协作与账号"><span class="cloud-role" data-role="${this.current?.role || ''}">${roleName(this.current?.role)}</span>${this.current?.role === 'owner' ? '<button data-cloud-action="members">成员与权限</button>' : ''}${this.current ? '<button data-cloud-action="history">历史版本</button>' : ''}<details class="account-menu"><summary><span class="account-avatar">${e((this.user.name || this.user.username || 'T').slice(0,1))}</span><span>${e(this.user.name || this.user.username)}</span><span aria-hidden="true">⌄</span></summary><div class="account-menu-panel"><strong>${e(this.user.username || this.user.email)}</strong>${this.user.authMode === 'password' ? '<button data-cloud-action="password">修改登录密码</button>' : ''}<button data-cloud-action="new">新建战术本</button><button data-cloud-action="migrate">导入旧版备份</button><button class="cloud-danger" data-cloud-action="logout">${this.user.authMode === 'password' ? '退出 / 切换账号' : '切换到团队账号'}</button></div></details></nav></header>`);
    this.updateBookCards();
    if (!this.books.length) root.insertAdjacentHTML('beforeend', `<section class="cloud-empty"><div class="empty-illustration">${fieldSVG(starterWorkspace().plays[0], {}, { thumbnail: true, prefix: 'empty' })}</div><div><span class="section-kicker">从一份战术本开始</span><h1>把球队的想法，放到一起。</h1><p>新建后你将成为管理员。邀请教练编辑，或让球员以只读方式学习战术。</p><div class="empty-actions"><button class="button primary" data-cloud-action="new">新建团队战术本 ${arrowIcon}</button><button class="button subtle" data-cloud-action="migrate">导入已有 JSON</button></div><small>${this.user.authMode === 'password' ? '没有看到团队战术？请让管理员把你的账号加入对应战术本。' : '你现在使用 ChatGPT 账号。若拿到了团队账号，请切换后登录，团队战术将自动加载。'}</small>${this.user.authMode !== 'password' ? '<button class="text-button" data-cloud-action="logout">切换到团队账号 →</button>' : ''}</div></section>`);
  }
  statusState() { return /冲突|失败|失效|不可用|尚未|变更/.test(this.status) ? 'error' : /离线|等待|正在|恢复/.test(this.status) ? 'pending' : 'saved'; }
  renderLogin() {
    this.cardPicker?.destroy(); this.cardPicker = null;
    document.title = '登录 · Playbook Studio';
    const returnTo = `${location.pathname}${location.search}`;
    document.querySelector('#cloud-root').innerHTML = `<main class="login-layout"><section class="login-story"><a class="login-brand" href="/editor/"><img src="./assets/stingers-mark.png" width="38" height="38" alt=""><span>STINGERS<small>PLAYBOOK STUDIO</small></span></a><div class="login-heading"><span class="section-kicker brand-kicker"><img class="brand-bolt" src="./assets/stingers-bolt.svg" alt="" aria-hidden="true">为下一次开球，做好准备。</span><h1>同一份战术，<br>同一个计划。</h1><p>排阵型、画路线、一起演练。<br>让每位队员都知道，下一步去哪里。</p></div><div class="login-pitch">${fieldSVG(starterWorkspace().plays[0], {}, { thumbnail: true, prefix: 'login' })}<div class="pitch-caption"><span>Mesh · 浅交叉</span><span>从真实战术开始</span></div></div><div class="brand-stars" aria-hidden="true"><img src="./assets/stingers-star.svg" alt=""><img src="./assets/stingers-star.svg" alt=""><img src="./assets/stingers-star.svg" alt=""></div><div class="login-story-bottom"><span>阵型编辑 · 路线演练 · 团队协作</span><span>STINGERS / PLAYBOOK STUDIO</span></div></section><section class="login-panel"><div class="login-visual-control">${effectsControl()}</div><div class="login-form-wrap"><span class="section-kicker">欢迎回到球场</span><h2>登录战术工作台</h2><p class="login-description">使用管理员分配的账号。登录后，你的团队战术会自动加载。</p><form id="account-login" novalidate><label class="form-field"><span>账号</span><input id="login-username" name="username" autocomplete="username" placeholder="例如 coach_01" required minlength="3" maxlength="32" autocapitalize="none" spellcheck="false"></label>${passwordField('login-password', '密码', 'current-password', '账号区分权限，密码区分大小写。')}<div class="caps-warning" hidden>大写锁定已开启，请注意密码大小写。</div>${feedbackBox()}<button class="button primary login-submit" type="submit" data-cloud-action="login">登录工作台 ${arrowIcon}</button></form><p class="login-assistance">还没有账号或忘记密码？请联系球队管理员。</p><details class="legacy-signin"><summary>使用之前的 ChatGPT 账号</summary><p>已有战术和邀请仍可通过原登录方式访问。</p><a href="/signin-with-chatgpt?return_to=${encodeURIComponent(returnTo)}" target="_top">使用 ChatGPT 登录 ${arrowIcon}</a></details><button class="privacy-link" data-cloud-action="privacy">数据保存在哪里，谁可以查看？</button></div><div class="login-panel-footer">你的战术由成员权限保护，修改自动保存到云端。</div></section></main>`;
  }
  bindEvents() {
    if (this.eventsBound) return; this.eventsBound = true;
    document.addEventListener('click', event => { const n = event.target.closest('[data-cloud-action]'); if (!n || n.disabled) return; event.preventDefault(); if (n.type === 'submit') return this.performAction(n); this.performAction(n); });
    document.addEventListener('submit', event => { if (event.target.id === 'account-login') { event.preventDefault(); this.performAction(event.target.querySelector('[data-cloud-action="login"]')); } });
    document.addEventListener('playbook:modal-closed', () => { if (!this.cardPicker) return; this.cardPicker.destroy(); this.cardPicker = null; document.querySelector('[data-cloud-action="books"]')?.focus({ preventScroll:true }); });
    document.addEventListener('input', event => { if (event.target.closest('#account-login,.modal')) { event.target.removeAttribute('aria-invalid'); resetFeedback(event.target.closest('form,.modal') || document); } });
    document.addEventListener('keyup', event => { if (event.target.id === 'login-password') { const n = document.querySelector('.caps-warning'); if (n) n.hidden = !event.getModifierState?.('CapsLock'); } });
  }
  async performAction(node) {
    const passive = ['books','new','migrate','password','create-account','add-existing-account','reset-password','toggle-password','privacy','sync-status','remove-member','restore-version','copy-invite'].includes(node.dataset.cloudAction);
    const before = node.innerHTML;
    if (!passive) { if (this.actionBusy) return; this.actionBusy = true; node.disabled = true; node.setAttribute('aria-busy', 'true'); node.textContent = ({login:'正在验证账号…',members:'正在加载成员…',history:'正在读取历史…',create:'正在创建战术本…',invite:'正在生成邀请…','save-now':'正在保存…','change-password':'正在更新密码…'}[node.dataset.cloudAction] || '正在处理…'); }
    resetFeedback(document.querySelector('.modal') || document.querySelector('#account-login') || document);
    try { await this.handleAction(node); }
    catch (error) { const message = readableError(error); feedback(message, 'error', document.querySelector('.modal') || document.querySelector('#account-login') || document); this.hooks.toast(message, { type: 'error' }); }
    finally { if (!passive) { this.actionBusy = false; node.disabled = false; node.removeAttribute('aria-busy'); node.innerHTML = before; } }
  }
  async init() {
    this.hooks.showEditor(false); this.bindEvents();
    document.querySelector('#cloud-root').innerHTML = '<div class="loading-workspace" aria-busy="true"><div></div><div></div><p>正在加载你的团队战术…</p></div>';
    try {
      this.user = (await request('/api/session')).user; this.renderBar(); if (!this.user) return;
      this.sync = new CloudSync({ request, userId: this.user.id, isBusy: this.hooks.isBusy, onStatus: value => this.setStatus(value), onData: (data, record) => { try { const validated = decodeWorkspace(encodeWorkspace(data)); this.hooks.onData(validated, record); this.hooks.showEditor(true); this.renderBar(); } catch { this.setStatus('更改需要人工合并，请导出备份'); } }, onConflict: (remote, local) => this.conflictModal(remote, local), onAccessLost: error => this.accessLost(error) });
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
      document.querySelector('#cloud-root').innerHTML = `<div class="cloud-gate"><h2>暂时无法连接云端</h2><p>${e(error.message)}</p><button class="button primary" data-cloud-action="reload">重试连接</button></div>`;
    }
  }
  async refreshBooks() { this.books = (await request('/api/workspaces')).workspaces; this.renderBar(); }
  updateBookCards() {
    this.cardPicker?.update({ books:this.books.map(book => book.id === this.current?.id ? {...book, title:this.current.title, role:this.current.role} : book), currentId:this.current?.id, loadingId:this.switching || '', blocked:this.dirty || !!this.switching });
  }
  showBooks() {
    if (this.cardPicker) return;
    this.hooks.openModal('切换战术本', '<div id="book-card-picker"></div>', '<button class="button subtle" data-action="close-modal">返回编辑</button><button class="button primary" data-cloud-action="new">＋ 新建战术本</button>', true);
    document.querySelector('#book-card-picker').closest('.modal').classList.add('book-switcher-modal');
    document.querySelector('#book-card-picker').closest('.modal-backdrop').classList.add('book-picker-backdrop');
    this.cardPicker = createBookSwitcher(document.querySelector('#book-card-picker'), {
      onChoose:async id => { if (await this.switchBook(id)) this.hooks.closeModal(); },
      onError:error => this.hooks.toast(readableError(error), { type:'error' })
    });
    this.updateBookCards();
  }
  async switchBook(workspaceId) {
    if (!workspaceId || this.switching) return false;
    if (this.current?.id === workspaceId) return true;
    if (this.dirty) { this.updateBookCards(); this.hooks.toast('请等当前更改同步完成，或先处理冲突再切换。'); return false; }
    this.switching = workspaceId; this.renderBar();
    try {
      const record = await request(`/api/workspaces/${encodeURIComponent(workspaceId)}`); this.sync.load(record);
      const url = new URL(location.href); url.searchParams.set('workspace', record.id); if (!url.searchParams.has('invite')) history.replaceState(null, '', url);
      return true;
    } finally { this.switching = ''; this.renderBar(); }
  }
  schedule(data) { this.sync?.schedule(data); }
  showCreate(data = null, label = '新建云端战术本') {
    if (this.dirty) { this.hooks.toast('请先同步或处理当前更改。'); return; }
    if (this.cardPicker) this.hooks.closeModal();
    this.createData = data;
    this.hooks.openModal(label, `<label class="form-field"><span>战术本名称</span><input id="cloud-new-title" value="${e(data ? data.team.name : '我的球队战术本')}" maxlength="80"></label>${data ? '' : '<label class="form-field"><span>从旧版 JSON 备份迁移（可选）</span><input id="cloud-new-file" type="file" accept=".json,application/json"></label>'}<p class="muted small">创建后你是管理员，可以邀请编辑者和只读成员。${data ? `将上传 ${data.plays.length} 个战术；本地原文件仍保留。` : '选择文件会完整导入；不选文件则包含 8 个教学示例。'}</p>`, '<button class="button primary" data-cloud-action="create">保存到云端</button>');
  }
  async membersModal() {
    const records = await request(`/api/workspaces/${this.current.id}/members`);
    this.hooks.openModal('成员与权限', `<div class="modal-intro"><p>只对「${e(this.current.title)}」的成员生效。</p><div class="role-legend"><span><b>管理员</b> 管理与恢复</span><span><b>编辑者</b> 修改战术</span><span><b>只读</b> 查看与演练</span></div></div><div class="member-section-title"><h3>团队成员 <span>${records.members.length}</span></h3><div class="member-actions"><button class="button subtle" data-cloud-action="add-existing-account">添加已有账号</button><button class="button primary" data-cloud-action="create-account">新建成员账号</button></div></div><div class="cloud-member-list">${records.members.map(m => `<div class="cloud-member"><span class="member-avatar">${e(m.name.slice(0,1))}</span><span class="member-identity"><strong>${e(m.name)}</strong><small>${e(m.username || m.email)}</small></span>${m.role === 'owner' ? '<b class="tag">管理员</b>' : `<label class="sr-only" for="role-${e(m.id)}">${e(m.name)}的权限</label><select id="role-${e(m.id)}" data-member-id="${e(m.id)}" aria-label="${e(m.name)}的权限"><option value="editor" ${m.role === 'editor' ? 'selected' : ''}>编辑者</option><option value="viewer" ${m.role === 'viewer' ? 'selected' : ''}>只读成员</option></select><button data-cloud-action="save-role" data-id="${e(m.id)}">应用权限</button>${m.canResetPassword ? `<button data-cloud-action="reset-password" data-id="${e(m.id)}" data-name="${e(m.username)}">重置密码</button>` : ''}<button class="cloud-danger" data-cloud-action="remove-member" data-id="${e(m.id)}" data-name="${e(m.name)}">移除</button>`}</div>`).join('')}</div><details class="invite-details"><summary>通过邮箱邀请 ChatGPT 用户</summary><p class="muted small">对方需用指定邮箱登录并接受链接。邀请 7 天内有效，可以撤销。</p><div class="form-row"><label class="form-field"><span>邀请邮箱</span><input type="email" id="cloud-invite-email" placeholder="成员的 ChatGPT 邮箱" maxlength="254"></label><label class="form-field"><span>权限</span><select id="cloud-invite-role"><option value="editor">编辑者</option><option value="viewer">只读成员</option></select></label></div><button class="button subtle" data-cloud-action="invite">生成邀请链接</button><div id="cloud-invite-result"></div>${records.invites.length ? `<h3>等待加入</h3>${records.invites.map(i => `<div class="cloud-pending"><span>${e(i.email)} · ${roleName(i.role)}</span><button data-cloud-action="revoke-invite" data-id="${e(i.id)}">撤销邀请</button></div>`).join('')}` : ''}</details>`, '<button class="button subtle" data-action="close-modal">完成</button>', true);
  }
  passwordModal() {
    this.hooks.openModal('修改登录密码', `<p class="muted">修改成功后，其他设备上的此账号会退出登录。</p>${passwordField('account-current-password','当前密码')}${passwordField('account-new-password','新密码','new-password','至少 8 个字符，建议使用独立密码。')}${passwordField('account-confirm-password','再次输入新密码','new-password')}`, '<button class="button subtle" data-action="close-modal">取消</button><button class="button primary" data-cloud-action="change-password">更新密码</button>');
  }
  accountCreateModal() {
    this.hooks.openModal('新建成员账号', `<p class="muted">创建后立即加入「${e(this.current.title)}」。将账号和初始密码单独发给这位成员。</p><label class="form-field"><span>显示名称</span><input id="account-name" placeholder="例如 防守教练" maxlength="60"></label><label class="form-field"><span>登录账号</span><input id="account-username" placeholder="例如 defense_coach" maxlength="32" autocomplete="off"><small>3–32 位小写字母、数字或下划线，以字母开头。</small></label>${passwordField('account-initial-password','初始密码','new-password','至少 8 个字符；密码不会在成员列表中再次显示。')}<button class="text-button" data-cloud-action="generate-password" data-target="account-initial-password">生成随机密码</button><label class="form-field"><span>在本战术本中的权限</span><select id="account-role"><option value="editor">编辑者 · 可修改战术</option><option value="viewer">只读成员 · 可查看与演练</option></select></label>`, '<button class="button subtle" data-cloud-action="members">返回成员列表</button><button class="button primary" data-cloud-action="confirm-create-account">创建并加入</button>');
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
    if (action === 'books') return this.showBooks();
    if (action === 'reload') return location.reload();
    if (action === 'login') {
      const input = document.querySelector('#login-username'), pass = document.querySelector('#login-password');
      if (!input.value.trim() || !pass.value) { (input.value.trim() ? pass : input).setAttribute('aria-invalid','true'); (input.value.trim() ? pass : input).focus(); throw new Error('请输入管理员分配的账号和密码。'); }
      await request('/api/auth/login', { method: 'POST', body: { username: input.value.trim(), password: pass.value } }); pass.value = ''; location.reload(); return;
    }
    if (action === 'logout') { if (this.dirty) throw new Error('还有未同步更改，请先保存或下载草稿再退出。'); if (this.user.authMode === 'password') { await request('/api/auth/logout', { method: 'POST', body: {} }); location.reload(); } else location.href = '/signout-with-chatgpt?return_to=%2Feditor%2F'; return; }
    if (action === 'toggle-password') { const input = document.getElementById(node.dataset.target); input.type = input.type === 'password' ? 'text' : 'password'; node.textContent = input.type === 'password' ? '显示' : '隐藏'; node.setAttribute('aria-pressed',String(input.type === 'text')); node.setAttribute('aria-label',`${input.type === 'text' ? '隐藏' : '显示'}密码`); return; }
    if (action === 'privacy') return this.hooks.openModal('数据与权限', '<p>战术、阵型和球队名单保存在本项目的云端数据库。只有你所在战术本的成员可以读取。</p><p>编辑者可以修改，只读成员可以查看、演练、导出和打印。管理员可以调整成员权限。未同步草稿临时保存在当前浏览器，成功保存后清除。</p><p>账号密码经过加盐哈希保存，登录会话通过受保护的 Cookie 维持。本站不自动发送邀请邮件。你可以导出 JSON 保留自己的备份。</p>', '<button class="button primary" data-action="close-modal">知道了</button>');
    if (action === 'save-now') { if (!this.sync?.pending) return this.hooks.toast('所有更改已保存到云端。'); await this.sync.flush(); if (!this.sync.dirty) this.hooks.toast('已保存到团队共享战术本。'); return; }
    if (action === 'password') return this.passwordModal();
    if (action === 'change-password') { const currentPassword = document.querySelector('#account-current-password').value, newPassword = document.querySelector('#account-new-password').value; if (newPassword.length < 8) throw new Error('新密码至少需要 8 个字符。'); if (newPassword !== document.querySelector('#account-confirm-password').value) throw new Error('两次输入的新密码不一致，请重新确认。'); await request('/api/auth/password', { method: 'POST', body: { currentPassword, newPassword } }); this.hooks.closeModal(); this.hooks.toast('密码已更新，其他设备的登录已失效。'); return; }
    if (action === 'add-existing-account') return this.hooks.openModal('添加已有团队账号', `<p class="muted">对方使用原账号与原密码，加入后可在战术本列表中切换。这里设置的权限只作用于「${e(this.current.title)}」。</p><label class="form-field"><span>已有登录账号</span><input id="existing-account-username" placeholder="例如 coach_01" maxlength="32" autocomplete="off"></label><label class="form-field"><span>当前战术本权限</span><select id="existing-account-role"><option value="editor">编辑者 · 可修改</option><option value="viewer">只读成员 · 可查看</option></select></label>`, '<button class="button subtle" data-cloud-action="members">取消</button><button class="button primary" data-cloud-action="confirm-add-existing-account">加入当前战术本</button>');
    if (action === 'confirm-add-existing-account') { const username = document.querySelector('#existing-account-username').value.trim(), role = document.querySelector('#existing-account-role').value; if (!username) throw new Error('请输入对方已有的团队账号。'); await request(`/api/workspaces/${this.current.id}/members`, { method: 'POST', body: { username, role } }); await this.membersModal(); this.hooks.toast('已有账号已加入当前战术本，原密码保持有效。'); return; }
    if (action === 'create-account') return this.accountCreateModal();
    if (action === 'generate-password') { const input = document.getElementById(node.dataset.target), alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789'; input.value = [...crypto.getRandomValues(new Uint8Array(18))].map(n => alphabet[n % alphabet.length]).join(''); input.type = 'text'; this.hooks.toast('已生成随机密码，请复制后单独交付给成员。'); return; }
    if (action === 'confirm-create-account') { const username = document.querySelector('#account-username').value.trim(), name = document.querySelector('#account-name').value.trim(), password = document.querySelector('#account-initial-password').value, role = document.querySelector('#account-role').value; if (!/^[a-z][a-z0-9_]{2,31}$/.test(username)) throw new Error('请使用 3–32 位小写字母、数字或下划线填写账号。'); if (password.length < 8) throw new Error('初始密码至少需要 8 个字符。'); await request(`/api/workspaces/${this.current.id}/accounts`, { method: 'POST', body: { username, name, password, role } }); this.hooks.openModal('成员账号已创建', `<p><strong>${e(name || username)}</strong> 已加入「${e(this.current.title)}」，权限：${roleName(role)}。</p><p>登录账号：<strong>${e(username)}</strong></p><label class="form-field"><span>初始密码 · 请现在复制并单独交付</span><input readonly aria-label="新成员初始密码" value="${e(password)}"></label><p class="muted small">成员可在右上角账号菜单修改密码。密码不会在成员列表中再次显示。</p>`, '<button class="button primary" data-cloud-action="members">返回成员列表</button>'); return; }
    if (action === 'reset-password') { this.resetTarget = node.dataset.id; this.hooks.openModal('重置成员密码', `<p>为 <strong>${e(node.dataset.name)}</strong> 设置新的初始密码。该账号在其他设备上的登录会失效。</p>${passwordField('reset-member-password','新初始密码','new-password','至少 8 个字符；重置后请单独交付给成员。')}<button class="text-button" data-cloud-action="generate-password" data-target="reset-member-password">生成随机密码</button>`, '<button class="button subtle" data-cloud-action="members">取消</button><button class="button primary" data-cloud-action="confirm-reset-password">重置密码并退出旧登录</button>'); return; }
    if (action === 'confirm-reset-password') { const password = document.querySelector('#reset-member-password').value; if (password.length < 8) throw new Error('新初始密码至少需要 8 个字符。'); await request(`/api/workspaces/${this.current.id}/members/${this.resetTarget}/password`, { method: 'POST', body: { password } }); this.hooks.openModal('成员密码已重置', `<p>旧登录已失效。请现在复制新密码并单独交付给成员。</p><label class="form-field"><span>新的初始密码</span><input readonly aria-label="重置后的初始密码" value="${e(password)}"></label>`, '<button class="button primary" data-cloud-action="members">返回成员列表</button>'); return; }

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
    if (action === 'remove-member') { this.removingMember = node.dataset.id; this.hooks.openModal('移除成员', `<p>将 ${e(node.dataset.name || '该成员')} 从「${e(this.current.title)}」移除？</p><p class="muted">移除后无法继续读取或修改这份战术本；账号本身与其参与的其他战术本不受影响。</p>`, '<button class="button subtle" data-cloud-action="members">取消</button><button class="button danger" data-cloud-action="confirm-remove-member">确认移除成员</button>'); return; }
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
