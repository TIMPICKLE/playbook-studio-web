import { TRACE_SHARDS } from './data/madden-trace-index.js';
import { TEAM_TRACE_ALIASES } from './data/madden-team-trace-aliases.js';

// These are the only full-geometry imports in the runtime. Keep them dynamic:
// opening the editor, browsing cards and searching names never needs this data.
const shardImports = {
  seed: () => import('./data/madden-editable-seed.js').then(module => module.SEED_TRACES),
  batch: () => import('./data/madden-editable-batch.js').then(module => module.BATCH_TRACES),
  expanded: () => import('./data/madden-editable-80.js').then(module => module.EXPANDED_TRACES),
  oct28: () => import('./data/madden-editable-oct28.js').then(module => module.REVIEWED_OCT28_TRACES),
  continued: () => import('./data/madden-editable-continued.js').then(module => module.CONTINUED_TRACES),
  final: () => import('./data/madden-editable-final.js').then(module => module.FINAL_TRACES),
};

export class EditableTraceNotLoadedError extends Error {
  constructor(id) {
    super(`Editable Madden trace ${id} is not loaded. Await loadEditableEntries before preparing its import.`);
    this.name = 'EditableTraceNotLoadedError';
    this.catalogId = id;
  }
}

export function createEditableTraceLoader({index=TRACE_SHARDS,aliases=TEAM_TRACE_ALIASES,loadShard=shard=>shardImports[shard]()}={}) {
  const loaded = new Map(), pending = new Map();
  const canonicalId = id => typeof id === 'string' && Object.hasOwn(index,id) ? id
    : typeof id === 'string' && Object.hasOwn(aliases,id) && Object.hasOwn(index,aliases[id]) ? aliases[id] : null;
  const has = id => canonicalId(id) !== null;
  function get(id) {
    const canonical = canonicalId(id);
    if (!canonical) return null;
    if (!loaded.has(canonical)) throw new EditableTraceNotLoadedError(id);
    return loaded.get(canonical);
  }
  async function load(id) {
    const canonical = canonicalId(id);
    if (!canonical) return null;
    if (loaded.has(canonical)) return loaded.get(canonical);
    const shard = index[canonical];
    if (!pending.has(shard)) {
      // Register the promise before invoking a loader, including synchronous
      // failures. Different aliases and simultaneous imports share one fetch.
      const job = Promise.resolve().then(() => loadShard(shard)).then(traces => {
        const expected = Object.keys(index).filter(key => index[key] === shard);
        if (!traces || expected.some(key => !Object.hasOwn(traces,key) || traces[key]?.id !== key || !Array.isArray(traces[key].players) || !Array.isArray(traces[key].routes)))
          throw new Error(`Invalid Madden geometry shard: ${shard}`);
        for (const key of expected) loaded.set(key,traces[key]);
      }).finally(() => pending.delete(shard));
      pending.set(shard,job);
    }
    await pending.get(shard);
    return get(id);
  }
  const loadMany = ids => Promise.all([...new Set(ids)].map(load));
  return {has,get,load,loadMany,canonicalId};
}

export const editableTraces = createEditableTraceLoader();
export const loadEditableEntries = ids => editableTraces.loadMany(ids);
