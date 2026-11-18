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
