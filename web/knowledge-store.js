import { validateKnowledgePack, mergeKnowledgePacks } from './knowledge-base.js';

export const KNOWLEDGE_STORAGE_PREFIX = 'playbook-studio.knowledge.v1.';
export const KNOWLEDGE_STORAGE_BYTES = 2_000_000;
export const emptyKnowledgePack = () => ({ format: 'playbook-studio-knowledge', version: 1, sources: [], cards: [] });

// Storage is deliberately scoped to one device and one playbook. A successful
// write is required before the view adopts changed references.
export function createKnowledgeStore(storage) {
  if (arguments.length === 0) { try { storage = globalThis.localStorage; } catch { /* denied storage is reported on load/save */ } }
  const key = workspaceId => KNOWLEDGE_STORAGE_PREFIX + encodeURIComponent(workspaceId);
  return {
    load(workspaceId) {
      let raw;
      try { if (!storage) throw new Error(); raw = storage.getItem(key(workspaceId)); }
      catch { return { pack: emptyKnowledgePack(), error: 'analysis.storageReadError' }; }
      if (!raw) return { pack: emptyKnowledgePack(), error: '' };
      try { return { pack: validateKnowledgePack(JSON.parse(raw)), error: '' }; }
      catch { return { pack: emptyKnowledgePack(), error: 'analysis.storageCorrupt' }; }
    },
    save(workspaceId, pack) {
      const normalized = pack.cards.length ? validateKnowledgePack(pack) : emptyKnowledgePack();
      const raw = JSON.stringify(normalized);
      if (new TextEncoder().encode(raw).byteLength > KNOWLEDGE_STORAGE_BYTES) throw new Error('analysis.storageError');
      try { storage.setItem(key(workspaceId), raw); }
      catch { throw new Error('analysis.storageError'); }
      return normalized;
    },
    merge(current, imported) { return mergeKnowledgePacks([current, imported]); },
  };
}
