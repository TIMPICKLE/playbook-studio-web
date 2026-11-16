// Model preferences are shared by the two AI workspaces. Credentials never
// enter persistent storage, exports or the playbook's shared document.
import { MODEL_PROVIDER_PRESETS } from './model-protocol.js';
const STORAGE = 'playbook-studio:model-connection:v1';
const listeners = new Set();
let current;
let storageOwner;
const fields = ['provider', 'protocol', 'model', 'baseUrl'];
function storage() { try { return globalThis.localStorage; } catch { return null; } }
function checked(value) {
  if (!value || !Object.hasOwn(MODEL_PROVIDER_PRESETS,value.provider)) return null;
  const preset=MODEL_PROVIDER_PRESETS[value.provider], next={provider:value.provider};
  next.protocol=preset.protocols.includes(value.protocol)?value.protocol:preset.defaultProtocol;
  next.model=typeof value.model==='string'?value.model.replace(/[\r\n]/g,'').slice(0,160):preset.defaultModel;
  next.baseUrl=typeof value.baseUrl==='string'?value.baseUrl.trim().slice(0,400):'';
  if (typeof value.apiKey==='string') next.apiKey=value.apiKey.trim().slice(0,512);
  return next;
}

export function getModelConnection() {
  const owner=storage();
  if (owner!==storageOwner) {storageOwner=owner;current=undefined;}
  if (current === undefined) {
    try {
      const saved = JSON.parse(owner?.getItem(STORAGE) || 'null');
      current = checked(saved);
      if (current) delete current.apiKey;
    } catch { current = null; }
  }
  return current ? {...current} : null;
}

export function setModelConnection(config) {
  const values = {...getModelConnection()};
  for (const key of [...fields, 'apiKey']) if (typeof config?.[key] === 'string') values[key] = config[key];
  const next=checked(values);
  if (!next) return getModelConnection();
  if (JSON.stringify(current) === JSON.stringify(next)) return getModelConnection();
  current = next;
  try { globalThis.localStorage?.setItem(STORAGE, JSON.stringify(Object.fromEntries(fields.map(key => [key, next[key] || ''])))); } catch { /* The current session remains usable when storage is unavailable. */ }
  for (const listener of listeners) listener({...next});
  return {...next};
}

export function subscribeModelConnection(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function clearModelCredential() {
  if (current) setModelConnection({apiKey:''});
}
