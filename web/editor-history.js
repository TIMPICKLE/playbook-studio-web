import { History, clone, uid } from './model.js';
import { refreshRosterBindings } from './board-personnel.js';

// Keep the existing snapshot API while attaching transaction identity outside
// the document. UI and AI observe the same undo/redo receipt.
export class EditorHistory extends History {
  constructor(limit = 50) { super(limit); this.metadata = new WeakMap(); this.lastTransaction = null; }
  record(state, details = {}) {
    super.record(state);
    const transaction = {id:uid(), name:'', playId:state.selectedId, ...details};
    this.metadata.set(this.past.at(-1), transaction);
    this.lastTransaction = {...transaction, status:'applied'};
    return transaction;
  }
  info(snapshot = this.past.at(-1)) { return snapshot ? this.metadata.get(snapshot) : null; }
  undo(state) {
    const transaction = this.info();
    const next = super.undo(state);
    if (next && transaction) {
      this.metadata.set(this.future.at(-1), transaction);
      this.lastTransaction = {...transaction, status:'undone'};
    }
    return next;
  }
  redo(state) {
    const transaction = this.info(this.future.at(-1));
    const next = super.redo(state);
    if (next && transaction) {
      this.metadata.set(this.past.at(-1), transaction);
      this.lastTransaction = {...transaction, status:'redone'};
    }
    return next;
  }
  // Roster/DEPTH CHART and team settings are a separate domain. Carry their
  // latest state through diagram snapshots, including historical markers and formations.
  // Simply retaining the old whole-workspace snapshots would resurrect names,
  // deleted players and depth assignments on the next route undo.
  rebasePersonnel(data) {
    for (const snapshot of [...this.past, ...this.future]) {
      const previousRoster = snapshot.data.roster;
      snapshot.data.roster = clone(data.roster);
      snapshot.data.depthChart = clone(data.depthChart);
      snapshot.data.team = clone(data.team);
      snapshot.data.settings.league = data.settings.league;
      refreshRosterBindings(snapshot.data, previousRoster);
    }
  }
  clear() { this.past = []; this.future = []; this.lastTransaction = null; }
}
