export const uid = () => globalThis.crypto?.randomUUID?.() || `id-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
export const fail = message => { throw new Error(message); };
export const text = (v, max, name) => typeof v === 'string' && v.length <= max ? v : fail(`${name}格式不正确`);
export const array = (v, max, name) => Array.isArray(v) && v.length <= max ? v : fail(`${name}数量或格式不正确`);
export const id = v => text(v, 100, 'ID');
export const choice = (v, choices, name) => choices.includes(v) ? v : fail(`${name}无效`);
export function unique(items, name) {
  if (new Set(items.map(x => x.id)).size !== items.length) fail(`${name}包含重复 ID`);
  return items;
}
