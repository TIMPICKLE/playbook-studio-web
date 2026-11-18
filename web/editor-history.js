import { History, clone, decodeWorkspace, encodeWorkspace, uid } from './model.js';
import { refreshRosterBindings } from './board-personnel.js';
import { equal, mergeWorkspaces } from './workspace-merge.js';

function personnel(data) {
  return { roster: data.roster, depthChart: data.depthChart, team: data.team, league: data.settings.league };
}

export class PersonnelHistoryConflict extends Error {}

// Diagram snapshots own their plays and formations. A command that also edits
// personnel (e.g. a JSON import) owns only its changes in that shared domain.
export class EditorHistory extends History {
  constructor(limit = 50) {
    super(limit);
    this.entries = new WeakMap();
    this.lastTransaction = null;
  }
  record(state, details = {}, afterData = state.data) {
    const before = personnel(state.data);
    const after = personnel(afterData);
    const base = afterData !== state.data && !equal(before, after) ? clone(after) : null;
    super.record(state);
    const transaction = { id: uid(), name: '', playId: state.selectedId, ...details };
    this.entries.set(this.past.at(-1), { transaction, base });
    this.lastTransaction = { ...transaction, status: 'applied' };
    return transaction;
  }
  info(snapshot = this.past.at(-1)) { return this.entries.get(snapshot)?.transaction ?? null; }
  undo(state) { return this.restoreEntry(state, this.past, this.future, 'undone'); }
  redo(state) { return this.restoreEntry(state, this.future, this.past, 'redone'); }

  restoreEntry(state, from, to, status) {
    const target = from.at(-1);
    if (!target) return null;
    const entry = this.entries.get(target);
    const live = personnel(state.data);
    let restored;
    if (entry.base) {
      const { data, conflicts } = mergeWorkspaces(entry.base, personnel(target.data), live);
      if (conflicts.length) throw new PersonnelHistoryConflict();
      restored = data;
      // Independent edits can combine into an invalid lineup: a later group
      // might use a player that undoing the import would remove.
      if (!equal(live, entry.base)) {
        try { decodeWorkspace(encodeWorkspace(withPersonnel(target.data, restored))); }
        catch (cause) { throw new PersonnelHistoryConflict('Invalid combined workspace', { cause }); }
      }
    } else {
      restored = clone(live);
    }

    // Only move the stacks after the whole transaction is known to be valid.
    const previousRoster = target.data.roster;
    target.data = withPersonnel(target.data, restored);
    refreshRosterBindings(target.data, previousRoster);
    to.push(clone(state));
    // Redo reverses what this undo actually changed. A roster member already
    // deleted independently must stay deleted on the return trip.
    const base = entry.base && !equal(restored, live) ? clone(restored) : null;
    this.entries.set(to.at(-1), { transaction: entry.transaction, base });
    this.lastTransaction = { ...entry.transaction, status };
    return from.pop();
  }

  detachRemovedPlayers(removedPlayers) {
    if (!removedPlayers.length) return;
    for (const snapshot of [...this.past, ...this.future]) {
      refreshRosterBindings(snapshot.data, removedPlayers, []);
    }
  }

  clear() { this.past = []; this.future = []; this.lastTransaction = null; }
}

function withPersonnel(data, { roster, depthChart, team, league }) {
  return { ...data, roster, depthChart, team, settings: { ...data.settings, league } };
}
