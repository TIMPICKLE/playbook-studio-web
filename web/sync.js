import { clone } from './model.js';
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

export class CloudSync {
  constructor({ request, onData, onStatus, onConflict, onAccessLost, storage = globalThis.localStorage, userId, isBusy = () => false, delay = 900 }) {
    Object.assign(this, { request, onData, onStatus, onConflict, onAccessLost, storage, userId, isBusy, delay });
    this.current = null; this.base = null; this.pending = null; this.saving = false; this.conflict = null; this.timer = null; this.generation = 0;
  }
  get canEdit() { return ['owner', 'editor'].includes(this.current?.role); }
  get dirty() { return !!this.pending || this.saving || !!this.conflict; }
  key() { return `playbook-cloud-draft:v1:${this.userId}:${this.current.id}`; }
  persist() { try { if (this.pending) this.storage?.setItem(this.key(), JSON.stringify({ revision: this.current.revision, base: this.base, data: this.pending })); else this.storage?.removeItem(this.key()); } catch { this.onStatus('本机草稿存储不可用，请导出备份'); } }
  load(record) {
    clearTimeout(this.timer); this.current = { ...record }; this.base = clone(record.data); this.pending = null; this.conflict = null; this.generation++;
    let draft; try { draft = JSON.parse(this.storage?.getItem(this.key()) || 'null'); } catch {}
    if (draft?.data && this.canEdit) {
      const merged = mergeWorkspaces(draft.base, draft.data, record.data);
      this.pending = merged.data; this.persist(); this.onData(clone(merged.data), this.current);
      if (merged.conflicts.length) { this.conflict = record; this.onStatus('本机草稿与云端冲突'); this.onConflict(record, clone(this.pending)); return; }
      if (!equal(this.pending, this.base)) { this.onStatus('正在恢复未同步草稿'); this.timer = setTimeout(() => this.flush(), this.delay); return; }
      this.pending = null; this.persist();
    }
    this.onData(clone(this.base), this.current); this.onStatus(this.canEdit ? '云端已同步' : '只读 · 云端已同步');
  }
  schedule(data) {
    if (!this.canEdit) { this.onStatus('只读 · 更改无法同步'); return; }
    this.pending = clone(data); this.generation++; this.persist(); this.onStatus('等待同步');
    clearTimeout(this.timer); if (!this.conflict && !this.saving) this.timer = setTimeout(() => this.flush(), this.delay);
  }
  async flush() {
    clearTimeout(this.timer); if (!this.current || !this.pending || this.saving || this.conflict || !this.canEdit) return;
    if (equal(this.pending, this.base)) { this.pending = null; this.persist(); this.onStatus('云端已同步'); return; }
    this.saving = true; this.onStatus('正在同步');
    const documentId = this.current.id, sent = clone(this.pending), generation = this.generation; let retry = true;
    try {
      const response = await this.request(`/api/workspaces/${documentId}`, { method: 'PUT', body: { revision: this.current.revision, data: sent } });
      if (this.current?.id !== documentId) return;
      this.current.revision = response.revision; this.base = sent;
      if (this.generation === generation) this.pending = null;
      this.persist(); this.onStatus(this.pending ? '等待同步' : '云端已同步');
    } catch (error) {
      if (this.current?.id !== documentId) return;
      if (error.status && error.status >= 400 && error.status < 500 && error.status !== 409) retry = false;
      if (error.status === 409 && error.payload?.latest) {
        const latest = error.payload.latest, merged = mergeWorkspaces(this.base, this.pending, latest.data);
        this.current = { ...latest }; this.base = clone(latest.data); this.pending = merged.data; this.generation++; this.persist(); this.onData(clone(this.pending), this.current);
        if (merged.conflicts.length) { this.conflict = latest; this.onStatus('冲突待处理'); this.onConflict(latest, clone(this.pending)); }
        else this.onStatus('已合并其他成员的修改');
      } else if ([401, 403, 404].includes(error.status)) { this.onStatus(error.status === 403 ? '权限已变更 · 请导出未同步内容' : '登录或访问权限已失效'); this.onAccessLost?.(error); }
      else this.onStatus(error.status ? `尚未同步：${error.message}` : '网络离线 · 本机草稿已保留');
    } finally {
      this.saving = false;
      clearTimeout(this.timer);
      if (retry && this.pending && !this.conflict && this.canEdit) this.timer = setTimeout(() => this.flush(), 3000);
    }
  }
  async poll() {
    if (!this.current || this.current.role === 'removed' || this.dirty || this.isBusy()) return;
    const documentId = this.current.id;
    try {
      const record = await this.request(`/api/workspaces/${documentId}?after=${this.current.revision}`);
      if (this.current?.id !== documentId) return;
      if (record.unchanged) { if (this.current.role !== record.role) { this.current.role = record.role; this.onData(clone(this.base), this.current); this.onStatus(this.canEdit ? '云端已同步' : '只读 · 云端已同步'); } }
      else this.load(record);
    } catch (error) { if ([401, 403, 404].includes(error.status)) this.onAccessLost?.(error); else this.onStatus('网络离线 · 等待重新连接'); }
  }
  useRemote() { const record = this.conflict; if (!record) return; this.pending = null; this.persist(); this.conflict = null; this.load(record); }
  dispose() { clearTimeout(this.timer); }
}
