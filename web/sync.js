import { clone, decodeWorkspace, encodeWorkspace } from './model.js';
const MISSING = Symbol('missing');
export function equal(a, b) {
  if (a === b) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object' || Array.isArray(a) !== Array.isArray(b)) return false;
  const ak = Object.keys(a), bk = Object.keys(b);
  return ak.length === bk.length && ak.every(k => Object.hasOwn(b, k) && equal(a[k], b[k]));
}
export function mergeWorkspaces(base, local, remote) {
  const conflicts = [];
  const merge = (b, l, r, path) => {
    if (equal(l, b)) return r;
    if (equal(r, b) || equal(l, r)) return l;
    const objects = [b, l, r].every(v => v !== MISSING && v && typeof v === 'object' && !Array.isArray(v));
    if (objects) {
      const out = {};
      for (const key of new Set([...Object.keys(b), ...Object.keys(l), ...Object.keys(r)])) {
        const value = merge(Object.hasOwn(b, key) ? b[key] : MISSING, Object.hasOwn(l, key) ? l[key] : MISSING, Object.hasOwn(r, key) ? r[key] : MISSING, `${path}.${key}`);
        if (value !== MISSING) out[key] = value;
      }
      return out;
    }
    if ([b, l, r].every(v => Array.isArray(v) && v.every(item => item && typeof item.id === 'string'))) {
      const bm = new Map(b.map(v => [v.id, v])), lm = new Map(l.map(v => [v.id, v])), rm = new Map(r.map(v => [v.id, v])), out = [];
      for (const key of new Set([...b.map(v => v.id), ...l.map(v => v.id), ...r.map(v => v.id)])) {
        const value = merge(bm.get(key) ?? MISSING, lm.get(key) ?? MISSING, rm.get(key) ?? MISSING, `${path}[${key}]`);
        if (value !== MISSING) out.push(value);
      }
      return out;
    }
    conflicts.push(path); return l;
  };
  const data = merge(base, local, remote, 'workspace');
  return { data: clone(data), conflicts };
}

const validateData = data => decodeWorkspace(encodeWorkspace(data));
function mergeDraft(base, local, remote) {
  const merged = mergeWorkspaces(base, local, remote);
  if (merged.conflicts.length) return { data: clone(local), reason: '你与其他成员修改了同一处内容。' };
  try { return { data: validateData(merged.data), reason: '' }; }
  catch (error) { return { data: clone(local), reason: `修改无法自动合并：${error.message}` }; }
}

export class CloudSync {
  constructor({ request, onData, onStatus, onConflict, onAccessLost, storage = globalThis.localStorage, userId, isBusy = () => false, delay = 900 }) {
    Object.assign(this, { request, onData, onStatus, onConflict, onAccessLost, storage, userId, isBusy, delay });
    this.current = null; this.base = null; this.pending = null; this.saving = false; this.conflict = null; this.conflictReason = ''; this.timer = null; this.generation = 0;
    this.storageError = null; this.draftSaved = false; this.viewError = null;
  }
  get canEdit() { return !this.viewError && ['owner', 'editor'].includes(this.current?.role); }
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
  load(record, { restoreDraft = true } = {}) {
    const data = validateData(record.data);
    const editable = ['owner', 'editor'].includes(record.role);
    let draft = restoreDraft && this.current?.id === record.id && this.pending ? { base: this.base, data: this.pending, conflict: this.conflictReason } : null;
    let storageError = this.storageError, draftSaved = this.draftSaved, pending = null, conflictReason = '';
    if (restoreDraft && !draft) {
      try {
        if (!this.storage) throw new Error('浏览器未提供本机存储');
        draft = JSON.parse(this.storage.getItem(this.key(record.id)) || 'null'); storageError = null;
      } catch (error) { storageError = error; }
      draftSaved = !!draft?.data;
    }
    if (draft?.data && editable) {
      const local = validateData(draft.data), merged = mergeDraft(draft.base, local, data);
      pending = merged.data; conflictReason = merged.reason || draft.conflict || '';
      if (!conflictReason && equal(pending, data)) pending = null;
    }
    clearTimeout(this.timer); this.current = { ...record, data }; this.base = clone(data); this.pending = pending;
    this.conflictReason = conflictReason; this.conflict = conflictReason ? this.current : null;
    this.storageError = storageError; this.draftSaved = draftSaved; this.viewError = null; this.generation++;
    if (draft?.data && editable) this.persist();
    if (!this.showData(this.pending || this.base)) return false;
    if (this.conflict) { this.status('本机草稿与云端冲突'); this.onConflict(this.conflict, clone(this.pending), this.conflictReason); }
    else if (this.pending) { this.status('正在恢复未同步草稿'); this.timer = setTimeout(() => this.flush(), this.delay); }
    else this.status(this.canEdit ? '云端已同步' : '只读 · 云端已同步');
    return true;
  }
  schedule(data) {
    if (this.viewError) { this.status('战术界面更新失败，请刷新后重试'); return; }
    if (!this.canEdit) { this.status('只读 · 更改无法同步'); return; }
    this.pending = clone(data); this.generation++; this.persist(); this.status('等待同步');
    clearTimeout(this.timer); if (!this.conflict && !this.saving) this.timer = setTimeout(() => this.flush(), this.delay);
  }
  async flush() {
    clearTimeout(this.timer); if (!this.current || !this.pending || this.saving || this.conflict || !this.canEdit) return;
    if (equal(this.pending, this.base)) { this.pending = null; this.persist(); this.status('云端已同步'); return; }
    if (this.storageError) this.persist();
    this.saving = true; this.status('正在同步');
    const documentId = this.current.id, revision = this.current.revision, sent = clone(this.pending), generation = this.generation; let retry = true;
    try {
      const response = await this.request(`/api/workspaces/${documentId}`, { method: 'PUT', body: { revision, data: sent } });
      if (this.current?.id !== documentId) return;
      if (!Number.isSafeInteger(response?.revision) || response.revision !== revision + 1) throw Object.assign(new Error('云端未返回有效的保存确认，请重试同步'), { code: 'invalid_response' });
      this.current.revision = response.revision; this.base = sent;
      if (this.generation === generation) this.pending = null;
      this.persist(); this.status(this.pending ? '等待同步' : '云端已同步');
    } catch (error) {
      if (this.current?.id !== documentId) return;
      if (error.code === 'invalid_response' || error.status >= 400 && error.status < 500 && error.status !== 409) retry = false;
      if (error.status === 409 && error.payload?.latest) {
        let latest;
        try { latest = { ...error.payload.latest, data: validateData(error.payload.latest.data) }; }
        catch (invalid) { retry = false; this.status(`云端战术数据无法加载：${invalid.message}`); return; }
        const merged = mergeDraft(this.base, this.pending, latest.data);
        this.current = latest; this.base = clone(latest.data); this.pending = merged.data; this.conflictReason = merged.reason;
        this.conflict = merged.reason ? latest : null; this.generation++; this.persist();
        if (!this.showData(this.pending)) return;
        if (this.conflict) { this.status('冲突待处理'); this.onConflict(latest, clone(this.pending), merged.reason); }
        else this.status('已合并其他成员的修改');
      } else if ([401, 403, 404].includes(error.status)) { this.status(error.status === 403 ? '权限已变更 · 请导出未同步内容' : '登录或访问权限已失效'); this.onAccessLost?.(error); }
      else this.status(error.status || error.code ? `尚未同步：${error.message}` : `网络离线 · ${this.draftSaved ? '本机草稿已保留' : '更改仅保留在当前页面'}`);
    } finally {
      this.saving = false;
      clearTimeout(this.timer);
      if (retry && this.pending && !this.conflict && this.canEdit) this.timer = setTimeout(() => this.flush(), 3000);
    }
  }
  async poll() {
    if (!this.current || this.current.role === 'removed' || this.dirty || this.isBusy()) return;
    const documentId = this.current.id;
    let record;
    try { record = await this.request(`/api/workspaces/${documentId}?after=${this.current.revision}`); }
    catch (error) { if ([401, 403, 404].includes(error.status)) this.onAccessLost?.(error); else this.status(error.status || error.code ? `云端更新失败：${error.message}` : '网络离线 · 等待重新连接'); return; }
    if (this.current?.id !== documentId) return;
    try {
      if (record.unchanged) {
        if (this.current.role !== record.role) {
          this.current.role = record.role;
          if (this.showData(this.base)) this.status(this.canEdit ? '云端已同步' : '只读 · 云端已同步');
        }
      } else this.load(record);
    } catch (error) { console.error('Cloud workspace update failed:', error); this.status(`战术本更新失败：${error.message}`); }
  }
  useRemote() { const record = this.conflict; if (!record) return; this.pending = null; this.conflict = null; this.conflictReason = ''; this.persist(); return this.load(record, { restoreDraft: false }); }
  dispose() { clearTimeout(this.timer); }
}
