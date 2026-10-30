import { t } from './i18n.js';
import { effectsControl } from './effects.js';
import { starterWorkspace, decodeWorkspace, escapeHTML as e, encodeWorkspace, STORAGE_KEY } from './model.js';
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
  let payload;
  try { payload = await response.json(); }
  catch (cause) {
    if (response.ok) throw Object.assign(new Error(t('cloud.invalidResponse'), { cause }), { code: 'invalid_response', status: response.status });
    payload = { error: t('cloud.cloudUnavailable') };
  }
  if (!response.ok) { const error = new Error(displayServerError(payload?.error || t('cloud.requestFailed'))); Object.assign(error, { status: response.status, payload }); throw error; }
  return payload;
}
const statusMessages = {'正在连接云端': 'cloud.statusConnecting', '战术界面更新失败，请刷新后重试': 'cloud.statusUpdatedError', '本机草稿与云端冲突': 'cloud.statusDraftConflict', '正在恢复未同步草稿': 'cloud.statusRecovering', '云端已同步': 'cloud.statusCloudSynced', '只读': 'cloud.statusReadonly', '更改无法同步': 'cloud.statusReadonlyChanges', '等待同步': 'cloud.statusWaiting', '正在同步': 'cloud.statusSyncing', '冲突待处理': 'cloud.statusConflict', '已合并其他成员的修改': 'cloud.statusMerged', '权限已变更': 'cloud.statusAccessChanged', '请导出未同步内容': 'cloud.statusExportUnsynced', '登录或访问权限已失效': 'cloud.statusSessionExpired', '网络离线': 'cloud.statusOffline', '本机草稿已保留': 'cloud.statusDraftSaved', '更改仅保留在当前页面': 'cloud.statusMemoryOnly', '等待重新连接': 'cloud.statusReconnect', '尚未同步：': 'cloud.statusUnsynced', '云端更新失败：': 'cloud.statusUpdateFailed', '战术本更新失败：': 'cloud.statusBookFailed', '云端战术数据无法加载：': 'cloud.statusDataFailed'};
function displayStatus(value) { return Object.entries(statusMessages).reduce((message, [source, key]) => message.replace(source, t(key)), String(value)); }
const serverErrorMessages = {"账号或密码不正确，请检查后重试": "cloud.error.credentials", "登录服务暂不可用，请稍后重试": "cloud.error.loginUnavailable", "请先登录": "cloud.error.loginRequired", "登录状态已失效，请重新登录": "cloud.error.loginExpired", "账号已停用": "cloud.error.accountDisabled", "密码刚刚变更，请重新登录": "cloud.error.passwordChanged", "尝试次数过多，请 15 分钟后重试，或联系管理员": "cloud.error.rateLimited", "账号须为 3–32 位小写字母、数字或下划线，并以字母开头": "cloud.error.usernameFormat", "密码须为 8–128 个字符": "cloud.error.passwordFormat", "显示名称须为 1–60 个字符": "cloud.error.nameFormat", "此账号名已使用，请更换账号名": "cloud.error.usernameTaken", "当前密码不正确": "cloud.error.currentPasswordIncorrect", "新密码不能与当前密码相同": "cloud.error.samePassword", "密码已被修改，请重新登录": "cloud.error.passwordUpdatedElsewhere", "战术本不存在或你没有访问权限": "cloud.error.accessDenied", "你只有查看权限": "cloud.error.readOnly", "仅管理员可以管理成员和历史版本": "cloud.error.ownerOnly", "云端数据库暂不可用": "cloud.error.databaseUnavailable", "云端服务暂时不可用，请稍后重试": "cloud.error.serviceUnavailable", "其他成员刚刚修改了战术本，请先合并更改": "cloud.error.versionConflict", "战术本已更新，请刷新后重新选择战术": "cloud.error.versionChanged", "邮箱格式不正确": "cloud.error.emailInvalid", "战术本名称须为 1–80 个字符": "cloud.error.titleInvalid", "内容过大，请拆分战术本或导出备份": "cloud.error.bodyTooLarge", "战术本过大，请拆分或先导出备份": "cloud.error.bookTooLarge", "战术本过大，请拆分": "cloud.error.bookTooLargeShort", "邀请已失效或已使用，请联系管理员": "cloud.error.inviteExpired", "请使用被邀请的邮箱登录": "cloud.error.inviteWrongEmail", "邀请已经使用": "cloud.error.inviteUsed", "成员不存在": "cloud.error.memberMissing", "该账号已经在此战术本中，请在列表中调整权限": "cloud.error.memberExists", "版本不存在": "cloud.error.historyMissing", "管理员身份不能被移除或降级": "cloud.error.ownerCannotRemove", "JSON 格式不正确": "cloud.error.invalidJSON", "接口不存在": "cloud.error.notFound"};
function displayServerError(message) { const key = serverErrorMessages[message]; return key ? t(key) : message; }
function formatConflictReason(reason) { if (!reason || reason === '你与其他成员修改了同一处内容。') return t('cloud.conflictSameField'); const prefix = '修改无法自动合并：'; return reason.startsWith(prefix) ? t('cloud.conflictAutoMerge') + displayServerError(reason.slice(prefix.length)) : reason; }
const roleName = role => ({ owner: t('cloud.roleOwner'), editor: t('cloud.roleEditor'), viewer: t('cloud.roleViewer') })[role] || '';
export class SharedWorkspace {
  constructor(hooks) { this.hooks = hooks; this.user = null; this.books = []; this.sync = null; this.actions = {}; this.pollTimer = null; this.status = '正在连接云端'; this.mode = 'home'; }
  get canEdit() { return !!this.sync?.canEdit; }
  get current() { return this.sync?.current; }
  get dirty() { return !!this.sync?.dirty; }
  setStatus(value) { this.status = value; this.hooks.onStatus(displayStatus(value)); const node = document.querySelector('#cloud-status'); if (node) { node.innerHTML = `<i></i><span>${e(displayStatus(value))}</span>`; node.dataset.state = this.statusState(); } queueMicrotask(() => this.updateBookCards()); }
  renderBar() {
    const root = document.querySelector('#cloud-root');
    if (!this.user) { this.renderLogin(); return; }
    if (this.mode === 'home') { this.renderHome(); return; }
    reconcileHTML(root, `<header class="cloud-bar"><a class="cloud-brand" href="/editor/"><img class="brand-icon" src="./assets/brand/playbook-studio-icon.svg" width="40" height="22" alt=""><span>Playbook Studio<small>${t('cloud.teamPlays')}</small></span></a>${currentBookCard(this.books, this.current)}<div class="cloud-sync"><button id="cloud-status" class="cloud-status" data-cloud-action="sync-status" title="${t('cloud.syncDetails')}" data-state="${this.statusState()}"><i></i><span>${e(displayStatus(this.status))}</span></button>${this.current && this.canEdit ? `<button class="save-now" data-cloud-action="save-now">${t('cloud.saveNow')}</button>` : ''}</div><nav class="cloud-bar-actions" aria-label="${t('cloud.collaborationAndAccount')}"><button data-cloud-action="home">${t('cloud.workspaceBack')}</button><span class="cloud-role" data-role="${this.current?.role || ''}">${roleName(this.current?.role)}</span>${this.current?.role === 'owner' ? `<button data-cloud-action="members">${t('cloud.membersPermissions')}</button>` : ''}${this.current ? `<button data-cloud-action="history">${t('cloud.versionHistory')}</button>` : ''}<details class="account-menu"><summary><span class="account-avatar">${e((this.user.name || this.user.username || 'T').slice(0,1))}</span><span>${e(this.user.name || this.user.username)}</span><span aria-hidden="true">⌄</span></summary><div class="account-menu-panel"><strong>${e(this.user.username || this.user.email)}</strong>${this.user.authMode === 'password' ? `<button data-cloud-action="password">${t('cloud.changePassword')}</button>` : ''}<button data-cloud-action="new">${t('cloud.newBook')}</button><button data-cloud-action="migrate">${t('cloud.importBackup')}</button><button class="cloud-danger" data-cloud-action="logout">${this.user.authMode === 'password' ? t('cloud.logoutSwitch') : t('cloud.switchTeamAccount')}</button></div></details></nav></header>`);
    this.updateBookCards();
    if (!this.books.length && this.mode === 'editor') root.insertAdjacentHTML('beforeend', `<section class="cloud-empty"><div class="empty-illustration">${fieldSVG(starterWorkspace().plays[0], {}, { thumbnail: true, prefix: 'empty' })}</div><div><span class="section-kicker">${t('cloud.startBook')}</span><h1>${t('cloud.shareIdeas')}</h1><p>${t('cloud.inviteDescription')}</p><div class="empty-actions"><button class="button primary" data-cloud-action="new">${t('cloud.newTeamBook')} ${arrowIcon}</button><button class="button subtle" data-cloud-action="migrate">${t('cloud.importExisting')}</button></div><small>${this.user.authMode === 'password' ? t('cloud.missingTeam') : t('cloud.chatgptTeam')}</small>${this.user.authMode !== 'password' ? `<button class="text-button" data-cloud-action="logout">${t('cloud.switchTeamAccount')} →</button>` : ''}</div></section>`);
  }
  renderHome() {
    const name = this.user.name || this.user.username || t('cloud.player');
    document.title = t('cloud.workspaceTitle');
    document.querySelector('#cloud-root').innerHTML = `<div class="studio-home"><header class="studio-home-header"><div class="studio-home-brand"><img class="brand-icon" src="./assets/brand/playbook-studio-icon.svg" alt="" width="48" height="26"><span>Playbook<small>Studio</small></span></div><div class="studio-home-account"><span>${t('cloud.hello')}${e(name)}</span><button data-cloud-action="logout">${this.user.authMode === 'password' ? t('cloud.signOut') : t('cloud.switchAccount')}</button></div></header><main class="studio-home-main"><div class="studio-home-intro"><h1>${t('cloud.homeTitle')}</h1><p>${t('cloud.homeDescription')}</p></div><div class="studio-home-cards"><button class="studio-choice studio-choice-editor" data-cloud-action="enter-editor"><div class="choice-art choice-art-editor">${fieldSVG(starterWorkspace().plays[0], { showGrid:false }, { thumbnail:true, prefix:'home-editor' })}</div><div class="choice-body"><h2>${t('cloud.editBook')}</h2><p>${t('cloud.editDescription')}</p><span class="choice-link">${t('cloud.enterBook')} <b aria-hidden="true">→</b></span></div></button><button class="studio-choice studio-choice-ai" data-cloud-action="enter-analysis"><div class="choice-art choice-art-ai"><div class="choice-orbit orbit-one"></div><div class="choice-orbit orbit-two"></div><div class="choice-node node-offense">O</div><div class="choice-node node-defense">D</div><div class="choice-ai-label">${t('cloud.ifThen')}</div></div><div class="choice-body"><h2>${t('cloud.aiAnalysis')}</h2><p>${t('cloud.aiDescription')}</p><span class="choice-link">${t('cloud.startAnalysis')} <b aria-hidden="true">→</b></span></div></button></div><div class="studio-home-foot"><span>${this.books.length ? t('cloud.homeBookCount', { count: this.books.length }) : t('cloud.noBooksIntro')}</span></div></main></div>`;
  }
  setMode(mode) {
    if (this.dirty) throw new Error(t('cloud.unsyncedChanges'));
    this.mode = mode;
    this.hooks.showEditor(mode === 'editor' && !!this.current);
    this.hooks.showAnalysis?.(mode === 'analysis');
    this.renderBar();
    window.scrollTo?.(0, 0);
  }
  statusState() { return /冲突|失败|失效|不可用|尚未|未保存|变更/.test(this.status) ? 'error' : /离线|等待|正在|恢复/.test(this.status) ? 'pending' : 'saved'; }
  renderLogin() {
    this.cardPicker?.destroy(); this.cardPicker = null;
    document.title = t('cloud.loginPageTitle');
    const returnTo = `${location.pathname}${location.search}`;
    document.querySelector('#cloud-root').innerHTML = `<main class="login-layout"><section class="login-story"><a class="login-brand" href="/editor/"><img class="brand-icon" src="./assets/brand/playbook-studio-icon.svg" width="48" height="26" alt=""><span>Playbook<small>Studio</small></span></a><div class="login-heading"><span class="section-kicker brand-kicker">${t('cloud.kickoffReady')}</span><h1>${t('cloud.onePlaybook')}<br>${t('cloud.onePlan')}</h1><p>${t('cloud.loginStoryOne')}<br>${t('cloud.loginStoryTwo')}</p></div><div class="login-pitch">${fieldSVG(starterWorkspace().plays[0], {}, { thumbnail: true, prefix: 'login' })}<div class="pitch-caption"><span>Mesh · 浅交叉</span><span>${t('cloud.realPlays')}</span></div></div><div class="login-story-bottom"><span>${t('cloud.loginFeatures')}</span><span>Playbook Studio</span></div></section><section class="login-panel"><div class="login-visual-control">${effectsControl()}</div><div class="login-form-wrap"><span class="section-kicker">${t('cloud.welcomeBack')}</span><h2>${t('cloud.loginHeading')}</h2><p class="login-description">${t('cloud.loginDescription')}</p><form id="account-login" novalidate><label class="form-field"><span>${t('cloud.account')}</span><input id="login-username" name="username" autocomplete="username" placeholder="${t('cloud.accountExample')}" required minlength="3" maxlength="32" autocapitalize="none" spellcheck="false"></label>${passwordField('login-password', t('cloud.password'), 'current-password', t('cloud.passwordHint'))}<div class="caps-warning" hidden>${t('cloud.capsWarning')}</div>${feedbackBox()}<button class="button primary login-submit" type="submit" data-cloud-action="login">${t('cloud.signInWorkspace')} ${arrowIcon}</button></form><p class="login-assistance">${t('cloud.loginHelp')}</p><details class="legacy-signin"><summary>${t('cloud.oldChatgpt')}</summary><p>${t('cloud.oldAccess')}</p><a href="/signin-with-chatgpt?return_to=${encodeURIComponent(returnTo)}" target="_top">${t('cloud.signInChatGPT')} ${arrowIcon}</a></details><button class="privacy-link" data-cloud-action="privacy">${t('cloud.privacyLink')}</button></div><div class="login-panel-footer">${t('cloud.cloudProtection')}</div></section></main>`;
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
    if (!passive) { if (this.actionBusy) return; this.actionBusy = true; node.disabled = true; node.setAttribute('aria-busy', 'true'); node.textContent = ({login:t('cloud.loggingIn'),members:t('cloud.loadingMembers'),history:t('cloud.loadingHistory'),create:t('cloud.creatingBook'),invite:t('cloud.creatingInvite'),'save-now':t('cloud.saving'),'change-password':t('cloud.updatingPassword')}[node.dataset.cloudAction] || t('cloud.processing')); }
    resetFeedback(document.querySelector('.modal') || document.querySelector('#account-login') || document);
    try { await this.handleAction(node); }
    catch (error) { const message = readableError(error); feedback(message, 'error', document.querySelector('.modal') || document.querySelector('#account-login') || document); this.hooks.toast(message, { type: 'error' }); }
    finally { if (!passive) { this.actionBusy = false; node.disabled = false; node.removeAttribute('aria-busy'); node.innerHTML = before; } }
  }
  async init() {
    this.hooks.showEditor(false); this.bindEvents();
    document.querySelector('#cloud-root').innerHTML = `<div class="loading-workspace" aria-busy="true"><div></div><div></div><p>${t('cloud.loadingTeam')}</p></div>`;
    try {
      this.user = (await request('/api/session')).user; this.renderBar(); if (!this.user) return;
      this.sync = new CloudSync({ request, userId: this.user.id, isBusy: this.hooks.isBusy, onStatus: value => this.setStatus(value), onData: (data, record) => { this.hooks.onData(data, record); this.hooks.onAnalysisData?.(data, record); this.hooks.showEditor(this.mode === 'editor'); this.renderBar(); }, onConflict: (remote, local, reason) => this.conflictModal(remote, local, reason), onAccessLost: error => this.accessLost(error) });
      window.addEventListener('beforeunload', event => { if (this.dirty) { event.preventDefault(); event.returnValue = ''; } });
      await this.refreshBooks();
      const invite = new URLSearchParams(location.search).get('invite');
      if (invite) {
        try { const preview = await request(`/api/invites/${encodeURIComponent(invite)}`); this.hooks.openModal(t('cloud.joinBook'), `<p>${t('cloud.inviteAcceptedText', { title: e(preview.title) })} <strong>${roleName(preview.role)}</strong>。</p>`, `<button class="button primary" data-cloud-action="accept-invite">${t('cloud.acceptInvite')}</button>`); this.inviteToken = invite; }
        catch (error) { this.hooks.toast(error.message); }
      }
      if (this.books.length) { const selected = new URLSearchParams(location.search).get('workspace'); await this.switchBook(this.books.some(b => b.id === selected) ? selected : this.books[0].id); }
      this.pollTimer = window.setInterval(() => this.sync.poll(), 6000);
      window.addEventListener('online', () => this.sync.pending ? this.sync.flush() : this.sync.poll());
    } catch (error) {
      document.querySelector('#cloud-root').innerHTML = `<div class="cloud-gate"><h2>${t('cloud.loadFailed')}</h2><p>${e(error.message)}</p><button class="button primary" data-cloud-action="reload">${t('cloud.reload')}</button></div>`;
    }
  }
  loadRecord(record) { if (!this.sync.load(record)) throw this.sync.viewError; }
  async refreshBooks() { this.books = (await request('/api/workspaces')).workspaces; this.renderBar(); }
  updateBookCards() {
    this.cardPicker?.update({ books:this.books.map(book => book.id === this.current?.id ? {...book, title:this.current.title, role:this.current.role} : book), currentId:this.current?.id, loadingId:this.switching || '', blocked:this.dirty || !!this.switching });
  }
  showBooks() {
    if (this.cardPicker) return;
    this.hooks.openModal(t('cloud.switchBook'), '<div id="book-card-picker"></div>', `<button class="button subtle" data-action="close-modal">${t('cloud.returnEdit')}</button><button class="button primary" data-cloud-action="new">＋ ${t('cloud.newBook')}</button>`, true);
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
    if (this.dirty) { this.updateBookCards(); this.hooks.toast(t('cloud.bookUnsynced')); return false; }
    this.switching = workspaceId; this.renderBar();
    try {
      const record = await request(`/api/workspaces/${encodeURIComponent(workspaceId)}`); this.loadRecord(record);
      const url = new URL(location.href); url.searchParams.set('workspace', record.id); if (!url.searchParams.has('invite')) history.replaceState(null, '', url);
      return true;
    } finally { this.switching = ''; this.renderBar(); }
  }
  schedule(data) { this.sync?.schedule(data); }
  showCreate(data = null, label = t('cloud.newCloudBook')) {
    if (this.dirty) { this.hooks.toast(t('cloud.syncBefore')); return; }
    if (this.cardPicker) this.hooks.closeModal();
    this.createData = data;
    this.hooks.openModal(label, `<label class="form-field"><span>${t('cloud.bookTitle')}</span><input id="cloud-new-title" value="${e(data ? data.team.name : t('cloud.myTeamBook'))}" maxlength="80"></label>${data ? '' : `<label class="form-field"><span>${t('cloud.migrateOptional')}</span><input id="cloud-new-file" type="file" accept=".json,application/json"></label>`}<p class="muted small">${t('cloud.newBookDescription')}${data ? `${t('cloud.uploadCount', { count: data.plays.length })}` : t('cloud.newBookNoFile')}</p>`, `<button class="button primary" data-cloud-action="create">${t('cloud.saveCloud')}</button>`);
  }
  async membersModal() {
    const records = await request(`/api/workspaces/${this.current.id}/members`);
    this.hooks.openModal(t('cloud.membersPermissions'), `<div class="modal-intro"><p>${t('cloud.bookScope', { title: e(this.current.title) })}</p><div class="role-legend"><span><b>${t('cloud.roleOwner')}</b> ${t('cloud.manageRestore')}</span><span><b>${t('cloud.roleEditor')}</b> ${t('cloud.modifyPlays')}</span><span><b>${t('cloud.readonly')}</b> ${t('cloud.viewAndPractice')}</span></div></div><div class="member-section-title"><h3>${t('cloud.members')} <span>${records.members.length}</span></h3><div class="member-actions"><button class="button subtle" data-cloud-action="add-existing-account">${t('cloud.addExisting')}</button><button class="button primary" data-cloud-action="create-account">${t('cloud.newMemberTitle')}</button></div></div><div class="cloud-member-list">${records.members.map(m => `<div class="cloud-member"><span class="member-avatar">${e(m.name.slice(0,1))}</span><span class="member-identity"><strong>${e(m.name)}</strong><small>${e(m.username || m.email)}</small></span>${m.role === 'owner' ? `<b class="tag">${t('cloud.roleOwner')}</b>` : `<label class="sr-only" for="role-${e(m.id)}">${e(m.name)}${t('cloud.permissions')}</label><select id="role-${e(m.id)}" data-member-id="${e(m.id)}" aria-label="${e(m.name)}${t('cloud.permissions')}"><option value="editor" ${m.role === 'editor' ? 'selected' : ''}>${t('cloud.roleEditor')}</option><option value="viewer" ${m.role === 'viewer' ? 'selected' : ''}>${t('cloud.roleViewer')}</option></select><button data-cloud-action="save-role" data-id="${e(m.id)}">${t('cloud.applyPermission')}</button>${m.canResetPassword ? `<button data-cloud-action="reset-password" data-id="${e(m.id)}" data-name="${e(m.username)}">${t('cloud.resetPassword')}</button>` : ''}<button class="cloud-danger" data-cloud-action="remove-member" data-id="${e(m.id)}" data-name="${e(m.name)}">${t('cloud.remove')}</button>`}</div>`).join('')}</div><details class="invite-details"><summary>${t('cloud.inviteByEmail')}</summary><p class="muted small">${t('cloud.inviteHelp')}</p><div class="form-row"><label class="form-field"><span>${t('cloud.inviteEmail')}</span><input type="email" id="cloud-invite-email" placeholder="${t('cloud.memberEmail')}" maxlength="254"></label><label class="form-field"><span>${t('cloud.permission')}</span><select id="cloud-invite-role"><option value="editor">${t('cloud.roleEditor')}</option><option value="viewer">${t('cloud.roleViewer')}</option></select></label></div><button class="button subtle" data-cloud-action="invite">${t('cloud.createInvite')}</button><div id="cloud-invite-result"></div>${records.invites.length ? `<h3>${t('cloud.pendingInvite')}</h3>${records.invites.map(i => `<div class="cloud-pending"><span>${e(i.email)} · ${roleName(i.role)}</span><button data-cloud-action="revoke-invite" data-id="${e(i.id)}">${t('cloud.revokeInvite')}</button></div>`).join('')}` : ''}</details>`, `<button class="button subtle" data-action="close-modal">${t('cloud.done')}</button>`, true);
  }
  passwordModal() {
    this.hooks.openModal(t('cloud.changePassword'), `<p class="muted">${t('cloud.passwordChangedNotice')}</p>${passwordField('account-current-password',t('cloud.currentPassword'))}${passwordField('account-new-password',t('cloud.newPassword'),'new-password',t('cloud.passwordAtLeast'))}${passwordField('account-confirm-password',t('cloud.confirmPassword'),'new-password')}`, `<button class="button subtle" data-action="close-modal">${t('cloud.cancel')}</button><button class="button primary" data-cloud-action="change-password">${t('cloud.updatePassword')}</button>`);
  }
  accountCreateModal() {
    this.hooks.openModal(t('cloud.newMember'), `<p class="muted">${t('cloud.newAccountIntro', { title: e(this.current.title) })}</p><label class="form-field"><span>${t('cloud.displayName')}</span><input id="account-name" placeholder="${t('cloud.exampleCoach')}" maxlength="60"></label><label class="form-field"><span>${t('cloud.username')}</span><input id="account-username" placeholder="${t('cloud.loginExampleDefense')}" maxlength="32" autocomplete="off"><small>${t('cloud.accountNameRule')}</small></label>${passwordField('account-initial-password',t('cloud.initialPassword'),'new-password',t('cloud.newPasswordHelp'))}<button class="text-button" data-cloud-action="generate-password" data-target="account-initial-password">${t('cloud.generatePassword')}</button><label class="form-field"><span>${t('cloud.memberRights')}</span><select id="account-role"><option value="editor">${t('cloud.editorCanEditPlays')}</option><option value="viewer">${t('cloud.viewerCanViewPlay')}</option></select></label>`, `<button class="button subtle" data-cloud-action="members">${t('cloud.returnMembers')}</button><button class="button primary" data-cloud-action="confirm-create-account">${t('cloud.createAndJoin')}</button>`);
  }
  async historyModal() {
    const records = await request(`/api/workspaces/${this.current.id}/history`);
    this.hooks.openModal(t('cloud.historyTitle'), `<p class="muted small">${t('cloud.historyDescription')}</p>${records.versions.map(v => `<div class="cloud-version"><span><strong>${t('cloud.historyRevision', { revision: e(v.revision) })}</strong><small>${e(v.actor || '')} · ${e(new Date(v.createdAt).toLocaleString())}</small></span><button data-cloud-action="download-version" data-revision="${v.revision}">${t('cloud.downloadBackup')}</button>${this.current.role === 'owner' && v.revision !== this.current.revision ? `<button data-cloud-action="restore-version" data-revision="${v.revision}">${t('cloud.historyRestore')}</button>` : ''}</div>`).join('')}`, '', true);
  }
  showSyncStatus() {
    if (this.accessError) return this.accessLost(this.accessError);
    if (this.sync?.viewError) {
      this.hooks.openModal(t('cloud.playViewFailed'), `<p>${e(this.sync.viewError.message)}</p><p>${t('cloud.reloadFirst')}</p>`, `${this.sync.pending ? `<button class="button subtle" data-cloud-action="export-conflict">${t('cloud.downloadDraftShort')}</button>` : ''}<button class="button primary" data-cloud-action="reload-cloud">${t('cloud.reloadView')}</button>`);
      return;
    }
    if (this.sync?.conflict) return this.conflictModal(this.sync.conflict, this.sync.pending);
    if (this.sync?.pending) {
      const recovery = this.sync.draftSaved ? t('cloud.loadingDraft') : t('cloud.backendSaveError');
      this.hooks.openModal(t('cloud.unsyncedChangesTitle'), `<p>${e(displayStatus(this.status))}</p><p class="muted small">${recovery}</p>`, `<button class="button subtle" data-cloud-action="export-conflict">${t('cloud.downloadDraftShort')}</button><button class="button primary" data-cloud-action="retry-sync">${t('cloud.retrySync')}</button>`);
      return;
    }
    return this.hooks.toast(displayStatus(this.status));
  }
  conflictModal(remote, local, reason = this.sync?.conflictReason) {
    this.conflictLocal = local;
    this.hooks.openModal(t('cloud.syncConflict'), `<p>${e(formatConflictReason(reason))} ${this.sync.draftSaved ? t('cloud.draftCloudSafe') : t('cloud.memoryOnlyBackup')}</p><p class="muted small">${t('cloud.conflictHelp')}</p>`, `<button class="button subtle" data-cloud-action="export-conflict">${t('cloud.downloadMyVersion')}</button><button class="button subtle" data-cloud-action="use-remote">${t('cloud.cloudVersion')}</button><button class="button primary" data-cloud-action="fork-conflict">${t('cloud.saveAsNewBook')}</button>`, true);
  }
  accessLost(error) {
    this.accessError = error;
    this.sync.current.role = error.status === 403 ? 'viewer' : 'removed';
    this.sync.dispose(); this.hooks.onPermissionLost(error); this.mode = 'home'; this.hooks.showEditor(false); this.hooks.showAnalysis?.(false); this.renderBar();
    this.hooks.openModal(t('cloud.accessChanged'), `<p>${e(error.message)}</p><p class="muted small">${this.sync.draftSaved ? t('cloud.draftRetained') : this.sync.pending ? t('cloud.backendDraftError') : t('cloud.reloadPermissions')}</p>`, `${this.sync.pending ? `<button class="button subtle" data-cloud-action="export-conflict">${t('cloud.downloadDraft')}</button>` : ''}${error.status === 403 ? `<button class="button primary" data-cloud-action="reload-cloud">${t('cloud.readonlyReload')}</button>` : `<a class="button primary" href="/editor/index.html" target="_top">${t('cloud.openBookAgain')}</a>`}`, true);
  }
  async handleAction(node) {
    const action = node.dataset.cloudAction;
    if (action === 'enter-editor') return this.setMode('editor');
    if (action === 'enter-analysis') return this.setMode('analysis');
    if (action === 'home') return this.setMode('home');
    if (action === 'books') return this.showBooks();
    if (action === 'reload') return location.reload();
    if (action === 'login') {
      const input = document.querySelector('#login-username'), pass = document.querySelector('#login-password');
      if (!input.value.trim() || !pass.value) { (input.value.trim() ? pass : input).setAttribute('aria-invalid','true'); (input.value.trim() ? pass : input).focus(); throw new Error(t('cloud.selectAccountPassword')); }
      await request('/api/auth/login', { method: 'POST', body: { username: input.value.trim(), password: pass.value } }); pass.value = ''; location.reload(); return;
    }
    if (action === 'logout') { if (this.dirty) throw new Error(t('cloud.unsyncedLogout')); if (this.user.authMode === 'password') { await request('/api/auth/logout', { method: 'POST', body: {} }); location.reload(); } else location.href = '/signout-with-chatgpt?return_to=%2Feditor%2F'; return; }
    if (action === 'toggle-password') { const input = document.getElementById(node.dataset.target); input.type = input.type === 'password' ? 'text' : 'password'; node.textContent = t(input.type === 'password' ? 'cloud.show' : 'cloud.hide'); node.setAttribute('aria-pressed',String(input.type === 'text')); node.setAttribute('aria-label', t(input.type === 'text' ? 'cloud.hidePassword' : 'cloud.showPassword')); return; }
    if (action === 'privacy') return this.hooks.openModal(t('cloud.privacyTitle'), `<p>${t('cloud.privacyStorage')}</p><p>${t('cloud.privacyPermissions')}</p><p>${t('cloud.privacySecurity')}</p>`, `<button class="button primary" data-action="close-modal">${t('cloud.close')}</button>`);
    if (action === 'save-now') { if (this.sync?.viewError) throw this.sync.viewError; if (!this.sync?.pending) return this.hooks.toast(t('cloud.savedCloud')); await this.sync.flush(); if (!this.sync.dirty) this.hooks.toast(t('cloud.savedShared')); return; }
    if (action === 'password') return this.passwordModal();
    if (action === 'change-password') { const currentPassword = document.querySelector('#account-current-password').value, newPassword = document.querySelector('#account-new-password').value; if (newPassword.length < 8) throw new Error(t('cloud.passwordTooShort')); if (newPassword !== document.querySelector('#account-confirm-password').value) throw new Error(t('cloud.passwordMismatch')); await request('/api/auth/password', { method: 'POST', body: { currentPassword, newPassword } }); this.hooks.closeModal(); this.hooks.toast(t('cloud.passwordUpdated')); return; }
    if (action === 'add-existing-account') return this.hooks.openModal(t('cloud.teamAccount'), `<p class="muted">${t('cloud.addExistingDescription', { title: e(this.current.title) })}</p><label class="form-field"><span>${t('cloud.existingAccount')}</span><input id="existing-account-username" placeholder="${t('cloud.accountExample')}" maxlength="32" autocomplete="off"></label><label class="form-field"><span>${t('cloud.currentBookRole')}</span><select id="existing-account-role"><option value="editor">${t('cloud.editorCanEdit')}</option><option value="viewer">${t('cloud.viewerCanView')}</option></select></label>`, `<button class="button subtle" data-cloud-action="members">${t('cloud.cancel')}</button><button class="button primary" data-cloud-action="confirm-add-existing-account">${t('cloud.addToBook')}</button>`);
    if (action === 'confirm-add-existing-account') { const username = document.querySelector('#existing-account-username').value.trim(), role = document.querySelector('#existing-account-role').value; if (!username) throw new Error(t('cloud.accountRequired')); await request(`/api/workspaces/${this.current.id}/members`, { method: 'POST', body: { username, role } }); await this.membersModal(); this.hooks.toast(t('cloud.existingAdded')); return; }
    if (action === 'create-account') return this.accountCreateModal();
    if (action === 'generate-password') { const input = document.getElementById(node.dataset.target), alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789'; input.value = [...crypto.getRandomValues(new Uint8Array(18))].map(n => alphabet[n % alphabet.length]).join(''); input.type = 'text'; this.hooks.toast(t('cloud.copyPassword')); return; }
    if (action === 'confirm-create-account') { const username = document.querySelector('#account-username').value.trim(), name = document.querySelector('#account-name').value.trim(), password = document.querySelector('#account-initial-password').value, role = document.querySelector('#account-role').value; if (!/^[a-z][a-z0-9_]{2,31}$/.test(username)) throw new Error(t('cloud.userNameInvalid')); if (password.length < 8) throw new Error(t('cloud.initialPasswordAtLeast')); await request(`/api/workspaces/${this.current.id}/accounts`, { method: 'POST', body: { username, name, password, role } }); this.hooks.openModal(t('cloud.createdMember'), `<p>${t('cloud.bookCreatedFor', { name: e(name || username), title: e(this.current.title), role: roleName(role) })}</p><p>${t('cloud.loginUsernameLabel')}<strong>${e(username)}</strong></p><label class="form-field"><span>${t('cloud.newMemberPasswordLabel')}</span><input readonly aria-label="${t('cloud.newMemberPasswordAria')}" value="${e(password)}"></label><p class="muted small">${t('cloud.membersAccountHint')}</p>`, `<button class="button primary" data-cloud-action="members">${t('cloud.returnMembers')}</button>`); return; }
    if (action === 'reset-password') { this.resetTarget = node.dataset.id; this.hooks.openModal(t('cloud.resetMember'), `<p>${t('cloud.passwordResetFor', { name: e(node.dataset.name) })}</p>${passwordField('reset-member-password',t('cloud.newInitialPassword'),'new-password',t('cloud.resetPasswordHelp'))}<button class="text-button" data-cloud-action="generate-password" data-target="reset-member-password">${t('cloud.generatePassword')}</button>`, `<button class="button subtle" data-cloud-action="members">${t('cloud.cancel')}</button><button class="button primary" data-cloud-action="confirm-reset-password">${t('cloud.resetAndSignOut')}</button>`); return; }
    if (action === 'confirm-reset-password') { const password = document.querySelector('#reset-member-password').value; if (password.length < 8) throw new Error(t('cloud.newInitialPasswordLength')); await request(`/api/workspaces/${this.current.id}/members/${this.resetTarget}/password`, { method: 'POST', body: { password } }); this.hooks.openModal(t('cloud.resetMemberDone'), `<p>${t('cloud.passwordResetNotice')}</p><label class="form-field"><span>${t('cloud.newInitial')}</span><input readonly aria-label="${t('cloud.resetPasswordAria')}" value="${e(password)}"></label>`, `<button class="button primary" data-cloud-action="members">${t('cloud.returnMembers')}</button>`); return; }

    if (action === 'sync-status') return this.showSyncStatus();
    if (action === 'retry-sync') { this.hooks.closeModal(); return this.sync.flush(); }
    if (action === 'reload-cloud') { const record = await request(`/api/workspaces/${this.current.id}`); this.accessError = null; this.hooks.closeModal(); this.loadRecord(record); return; }
    if (action === 'new') return this.showCreate();
    if (action === 'migrate') { const raw = localStorage.getItem(STORAGE_KEY); return this.showCreate(raw ? decodeWorkspace(raw) : null, t('cloud.switchLegacy')); }
    if (action === 'create') { const file = document.querySelector('#cloud-new-file')?.files?.[0]; if (file?.size > 5_000_000) throw new Error(t('cloud.backupTooLarge')); const data = file ? decodeWorkspace(await file.text()) : this.createData; const record = await request('/api/workspaces', { method: 'POST', body: { title: document.querySelector('#cloud-new-title').value, ...(data ? { data } : {}) } }); this.hooks.closeModal(); await this.refreshBooks(); this.loadRecord(record); this.hooks.toast(t('cloud.createSuccess')); return; }
    if (action === 'members') return this.membersModal();
    if (action === 'history') return this.historyModal();
    if (action === 'invite') { const result = await request(`/api/workspaces/${this.current.id}/invites`, { method: 'POST', body: { email: document.querySelector('#cloud-invite-email').value, role: document.querySelector('#cloud-invite-role').value } }); this.latestInvite = result.url; document.querySelector('#cloud-invite-result').innerHTML = `<label class="form-field"><span>${t('cloud.sendInvite', { email: e(result.email) })}</span><input readonly value="${e(result.url)}" aria-label="${t('cloud.inviteLink')}"></label><button class="button subtle" data-cloud-action="copy-invite">${t('cloud.copyInvite')}</button>`; return; }
    if (action === 'copy-invite') { try { await navigator.clipboard.writeText(this.latestInvite); this.hooks.toast(t('cloud.inviteCopied')); } catch { document.querySelector('[aria-label="邀请链接"]').select(); this.hooks.toast(t('cloud.copiedInviteHelp')); } return; }
    if (action === 'accept-invite') { const record = await request(`/api/invites/${this.inviteToken}/accept`, { method: 'POST', body: {} }); this.inviteToken = ''; this.hooks.closeModal(); await this.refreshBooks(); this.loadRecord(record); const u = new URL(location.href); u.searchParams.delete('invite'); u.searchParams.set('workspace', record.id); history.replaceState(null, '', u); return; }
    if (action === 'save-role') { const select = [...document.querySelectorAll('[data-member-id]')].find(n => n.dataset.memberId === node.dataset.id); await request(`/api/workspaces/${this.current.id}/members/${encodeURIComponent(node.dataset.id)}`, { method: 'PATCH', body: { role: select.value } }); this.hooks.toast(t('cloud.permissionUpdated')); return this.membersModal(); }
    if (action === 'remove-member') { this.removingMember = node.dataset.id; this.hooks.openModal(t('cloud.removeMember'), `<p>${t('cloud.memberRemoval', { name: e(node.dataset.name || '该成员'), title: e(this.current.title) })}</p><p class="muted">${t('cloud.removeMemberHelp')}</p>`, `<button class="button subtle" data-cloud-action="members">${t('cloud.cancel')}</button><button class="button danger" data-cloud-action="confirm-remove-member">${t('cloud.confirmRemove')}</button>`); return; }
    if (action === 'confirm-remove-member') { await request(`/api/workspaces/${this.current.id}/members/${encodeURIComponent(this.removingMember)}`, { method: 'DELETE' }); return this.membersModal(); }
    if (action === 'revoke-invite') { await request(`/api/workspaces/${this.current.id}/invites/${encodeURIComponent(node.dataset.id)}`, { method: 'DELETE' }); return this.membersModal(); }
    if (action === 'download-version') { const record = await request(`/api/workspaces/${this.current.id}/history/${node.dataset.revision}`); return this.hooks.download(encodeWorkspace(record.data), `playbook-version-${node.dataset.revision}.json`, 'application/json'); }
    if (action === 'restore-version') { if (this.dirty) return this.hooks.toast(t('cloud.syncFirst')); this.restoreRevision = node.dataset.revision; this.hooks.openModal(t('cloud.restoreVersion'), `<p>${t('cloud.restorePrompt', { revision: e(this.restoreRevision) })}</p>`, `<button class="button primary" data-cloud-action="confirm-restore">${t('cloud.restoreSync')}</button>`); return; }
    if (action === 'confirm-restore') { await request(`/api/workspaces/${this.current.id}/history/${this.restoreRevision}/restore`, { method: 'POST', body: { revision: this.current.revision } }); const record = await request(`/api/workspaces/${this.current.id}`); this.hooks.closeModal(); this.loadRecord(record); return; }
    if (action === 'export-conflict') return this.hooks.download(encodeWorkspace(this.sync.pending || this.conflictLocal), 'my-unsynced-playbook.json', 'application/json');
    if (action === 'use-remote') { this.hooks.closeModal(); if (this.sync.useRemote() === false) throw this.sync.viewError; return; }
    if (action === 'fork-conflict') { const record = await request('/api/workspaces', { method: 'POST', body: { title: `${this.current.title} · 我的副本`.slice(0, 80), data: this.sync.pending || this.conflictLocal } }); this.sync.pending = null; this.sync.persist(); this.hooks.closeModal(); await this.refreshBooks(); this.loadRecord(record); return; }
  }
}
