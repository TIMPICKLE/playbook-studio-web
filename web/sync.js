import { clone, decodeWorkspace, encodeWorkspace } from './model.js';
import { equal, mergeWorkspaces } from './workspace-merge.js';
export { equal, mergeWorkspaces } from './workspace-merge.js';

const validateData = data => decodeWorkspace(encodeWorkspace(data));
function mergeDraft(base, local, remote) {
  const merged = mergeWorkspaces(base, local, remote);
  if (merged.conflicts.length) return { data: clone(local), reason: '你与其他成员修改了同一处内容。' };
  try { return { data: validateData(merged.data), reason: '' }; }
  catch (error) { return { data: clone(local), reason: `修改无法自动合并：${error.message}` }; }
}

const editableRole = role => role === 'owner' || role === 'editor';
const accessDenied = error => [401, 403, 404].includes(error.status);
const readOnlyError = () => Object.assign(new Error('你只有查看权限'), { status: 403 });

function checkRemoteRecord(record, documentId) {
  if (!Number.isSafeInteger(record?.revision) || record.revision < 1 || (!record.unchanged && record.id !== documentId)) throw new Error('无效的云端版本');
  if (!editableRole(record.role) && record.role !== 'viewer') throw new Error('无效的云端权限');
}

export class CloudSync {
  constructor({ request, onData, onStatus, onConflict, onBeforeAccessLoss, onAccessLost, storage = globalThis.localStorage, userId, isBusy = () => false, delay = 900 }) {
    Object.assign(this, { request, onData, onStatus, onConflict, onBeforeAccessLoss, onAccessLost, storage, userId, isBusy, delay });
    this.current = null; this.base = null; this.pending = null; this.saving = false; this.conflict = null; this.conflictReason = ''; this.timer = null; this.generation = 0;
    this.storageError = null; this.draftSaved = false; this.viewError = null;
    this.savePromise = null; this.refreshPromise = null; this.pollPromise = null; this.recordEpoch = 0; this.deferredRemote = null;
  }
  get canEdit() { return !this.viewError && editableRole(this.current?.role); }
  get dirty() { return !!this.pending || this.saving || !!this.conflict; }
  key(workspaceId = this.current.id) { return `playbook-cloud-draft:v1:${this.userId}:${workspaceId}`; }
  status(message) {
    const warning = this.storageError ? (this.pending ? '本机草稿未保存，请导出备份' : '本机草稿存储不可用') : '';
    this.onStatus(warning ? `${message} · ${warning}` : message);
  }
  persist() {
    try {
      if (!this.storage) throw new Error('浏览器未提供本机存储');
      if (this.pending) this.storage.setItem(this.key(), JSON.stringify({ revision: this.current.revision, base: this.base, data: this.pending, conflict: this.conflictReason || null }));
      else this.storage.removeItem(this.key());
      this.storageError = null; this.draftSaved = !!this.pending; return true;
    } catch (error) { this.storageError = error; this.draftSaved = false; return false; }
  }
  showData(data) {
    this.viewError = null;
    try { this.onData(clone(data), this.current); return true; }
    catch (error) {
      this.viewError = error;
      console.error('Cloud workspace view update failed:', error);
      this.status('战术界面更新失败，请刷新后重试'); return false;
    }
  }
  restrictAccess(role) {
    if (!this.current || this.current.role === role) return;
    try {
      if (this.canEdit) this.onBeforeAccessLoss?.();
    } catch (error) {
      console.error('Could not capture the active field before access changed:', error);
    } finally {
      clearTimeout(this.timer);
      this.deferredRemote = null;
      this.current.role = role;
      this.recordEpoch++;
    }
  }
  accessLost(error) {
    this.restrictAccess(error.status === 403 ? 'viewer' : 'removed');
    this.status(error.status === 403 ? '权限已变更 · 请导出未同步内容' : '登录或访问权限已失效');
    this.onAccessLost?.(error);
  }
  load(record, { restoreDraft = true, afterConflict = false } = {}) {
    const sameBook = this.current?.id === record.id;
    if (sameBook && record.revision < (this.deferredRemote?.revision ?? this.current.revision)) return true;
    const data = validateData(record.data);
    const editable = editableRole(record.role);
    if (sameBook && !editable) this.restrictAccess(record.role);
    let draft = restoreDraft && this.current?.id === record.id && this.pending ? { base: this.base, data: this.pending, conflict: this.conflictReason } : null;
    let storageError = this.storageError, draftSaved = this.draftSaved, pending = null, conflictReason = '';
    if (restoreDraft && !draft) {
      try {
        if (!this.storage) throw new Error('浏览器未提供本机存储');
        draft = JSON.parse(this.storage.getItem(this.key(record.id)) || 'null'); storageError = null;
      } catch (error) { storageError = error; }
      draftSaved = !!draft?.data;
    }
    if (draft?.data) {
      const local = validateData(draft.data), merged = mergeDraft(validateData(draft.base), local, data);
      pending = merged.data; conflictReason = merged.reason || draft.conflict || '';
      if (!conflictReason && equal(pending, data)) pending = null;
    }
    clearTimeout(this.timer); this.deferredRemote = null; this.current = { ...record, data }; this.base = clone(data); this.pending = pending;
    this.conflictReason = conflictReason; this.conflict = conflictReason ? this.current : null;
    this.storageError = storageError; this.draftSaved = draftSaved; this.viewError = null; this.generation++; this.recordEpoch++;
    if (draft?.data) this.persist();
    if (!this.showData(editable && this.pending ? this.pending : this.base)) return false;
    if (!editable && this.pending) this.status('权限已变更 · 请导出未同步内容');
    else if (this.conflict) { this.status('本机草稿与云端冲突'); this.onConflict(this.conflict, clone(this.pending), this.conflictReason); }
    else if (this.pending) { this.status(afterConflict ? '已合并其他成员的修改' : '正在恢复未同步草稿'); this.timer = setTimeout(() => this.flush(), this.delay); }
    else this.status(this.canEdit ? '云端已同步' : '只读 · 云端已同步');
    return true;
  }
  schedule(data) {
    if (this.viewError) { this.status('战术界面更新失败，请刷新后重试'); return; }
    if (!this.canEdit) { this.status('只读 · 更改无法同步'); return; }
    this.pending = clone(data); this.generation++; this.persist(); this.status('等待同步');
    clearTimeout(this.timer); if (!this.conflict && !this.saving && !this.refreshPromise) this.timer = setTimeout(() => this.flush(), this.delay);
  }
  flush() {
    if (this.refreshPromise) return this.refreshPromise.catch(() => {}).then(() => this.flush());
    if (this.savePromise) return this.savePromise;
    const task = this.flushPending();
    this.savePromise = task.finally(() => { this.savePromise = null; });
    return this.savePromise;
  }
  async flushPending() {
    clearTimeout(this.timer); if (!this.current || !this.pending || this.saving || this.conflict || !this.canEdit) return;
    if (this.deferredRemote) {
      if (this.isBusy()) {
        this.timer = setTimeout(() => this.flush(), this.delay);
        return;
      }
      if (!this.load(this.deferredRemote, { afterConflict: true }) || this.conflict || !this.pending) return;
      clearTimeout(this.timer);
    }
    if (equal(this.pending, this.base)) { this.pending = null; this.persist(); this.status('云端已同步'); return; }
    if (this.storageError) this.persist();
    this.saving = true; this.status('正在同步');
    const documentId = this.current.id, revision = this.current.revision, sent = clone(this.pending), generation = this.generation, recordEpoch = this.recordEpoch; let retry = true;
    try {
      const response = await this.request(`/api/workspaces/${documentId}`, { method: 'PUT', body: { revision, data: sent } });
      if (this.current?.id !== documentId || this.recordEpoch !== recordEpoch) return;
      if (!Number.isSafeInteger(response?.revision) || response.revision !== revision + 1) throw Object.assign(new Error('云端未返回有效的保存确认，请重试同步'), { code: 'invalid_response' });
      this.saving = false;
      this.current.revision = response.revision; this.current.data = clone(sent); this.base = sent; this.recordEpoch++;
      if (this.generation === generation) this.pending = null;
      this.persist(); this.status(this.pending ? '等待同步' : '云端已同步');
    } catch (error) {
      if (this.current?.id !== documentId || this.recordEpoch !== recordEpoch) return;
      this.saving = false;
      if (error.code === 'invalid_response' || error.status >= 400 && error.status < 500 && error.status !== 409) retry = false;
      if (error.status === 409 && error.payload?.latest) {
        const latest = error.payload.latest;
        try {
          checkRemoteRecord(latest, documentId);
          if (latest.unchanged || latest.revision <= revision) throw new Error('无效的云端版本');
          if (latest.role === 'viewer') { this.accessLost(readOnlyError()); return; }
          if (this.isBusy()) {
            this.deferredRemote = { ...latest, data: validateData(latest.data) };
            this.recordEpoch++;
            this.status('等待同步');
          } else this.load(latest, { afterConflict: true });
        } catch (invalid) { retry = false; this.status(`云端战术数据无法加载：${invalid.message}`); }
      } else if (accessDenied(error)) this.accessLost(error);
      else this.status(error.status || error.code ? `尚未同步：${error.message}` : `网络离线 · ${this.draftSaved ? '本机草稿已保留' : '更改仅保留在当前页面'}`);
    } finally {
      this.saving = false;
      clearTimeout(this.timer);
      if (retry && this.pending && !this.conflict && this.canEdit) this.timer = setTimeout(() => this.flush(), 3000);
    }
  }
  refreshForProposal() {
    if (this.refreshPromise) return this.refreshPromise;
    const task = this.readLatestForProposal();
    this.refreshPromise = task.finally(() => {
      this.refreshPromise = null;
      clearTimeout(this.timer);
      if (this.pending && !this.conflict && this.canEdit) this.timer = setTimeout(() => this.flush(), this.delay);
    });
    return this.refreshPromise;
  }
  async readLatestForProposal() {
    const documentId = this.current?.id;
    if (!documentId) throw new Error('战术本尚未加载');
    if (this.savePromise) await this.savePromise;
    if (this.current?.id !== documentId) throw new Error('已切换战术本');
    clearTimeout(this.timer);
    const recordEpoch = this.recordEpoch;
    let record;
    try { record = await this.request(`/api/workspaces/${documentId}`); }
    catch (error) { if (this.recordEpoch === recordEpoch && accessDenied(error)) this.accessLost(error); throw error; }
    if (this.current?.id !== documentId || this.recordEpoch !== recordEpoch) throw new Error('战术本已更新，请重试');
    checkRemoteRecord(record, documentId);
    if (record.revision < this.current.revision) return this.current;
    if (!editableRole(record.role)) {
      const error = readOnlyError();
      this.accessLost(error);
      throw error;
    }
    if (record.revision !== this.current.revision || record.role !== this.current.role) this.load(record);
    else this.recordEpoch++;
    if (this.conflict) throw new Error(this.conflictReason);
    if (this.viewError) throw this.viewError;
    return this.current;
  }
  poll() {
    if (this.pollPromise) return this.pollPromise;
    if (!this.current || this.current.role === 'removed' || this.dirty || this.isBusy() || this.refreshPromise) return;
    const read = this.readPoll(this.current.id, this.current.revision, this.recordEpoch);
    this.pollPromise = read.finally(() => { this.pollPromise = null; });
    return this.pollPromise;
  }
  async readPoll(documentId, revision, recordEpoch) {
    let record;
    try { record = await this.request(`/api/workspaces/${documentId}?after=${revision}`); }
    catch (error) {
      if (this.recordEpoch !== recordEpoch || this.refreshPromise) return;
      if (accessDenied(error)) this.accessLost(error);
      else if (!this.dirty && !this.isBusy()) this.status(error.status || error.code ? `云端更新失败：${error.message}` : '网络离线 · 等待重新连接');
      return;
    }
    if (this.recordEpoch !== recordEpoch || this.refreshPromise) return;
    try {
      checkRemoteRecord(record, documentId);
      if (record.revision < this.current.revision) return;
      if (record.unchanged && record.revision !== revision) throw new Error('无效的云端版本');
      // Recheck at delivery: composing, dragging, or saving may have started during the GET.
      if (this.dirty || this.isBusy()) {
        if (editableRole(this.current.role) && record.role === 'viewer') this.accessLost(readOnlyError());
        return;
      }
      if (!record.unchanged) this.load(record);
      else if (record.role !== this.current.role || this.viewError) this.load({ ...this.current, role: record.role });
      else this.status(this.canEdit ? '云端已同步' : '只读 · 云端已同步');
    } catch (error) { console.error('Cloud workspace update failed:', error); this.status(`战术本更新失败：${error.message}`); }
  }
  useRemote() {
    if (this.current?.role === 'removed') return;
    const record = this.current?.role === 'viewer' && this.pending ? this.current : this.conflict;
    if (!record) return;
    this.pending = null; this.conflict = null; this.conflictReason = ''; this.persist();
    return this.load(record, { restoreDraft: false });
  }
  dispose() { clearTimeout(this.timer); }
}
