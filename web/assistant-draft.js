import { proposeEdit } from './assistant-proposal.js';
import { proposalConflicts } from './assistant-conflicts.js';

// A conversation edits one working copy. Each accepted model turn becomes a step
// staged on top of the previous ones; the coach commits the whole stack as a
// single transaction, or drops it. The committed play is never touched here.
//
// Steps are replayed in order because later steps may reference objects that an
// earlier step created. Proposal IDs are derived from the play they were built
// on, so replaying on a changed play renames those objects; references are then
// rewritten and every step is re-checked against the dependencies it read.

const TYPES = ['players', 'routes', 'zones', 'annotations'];
const unique = values => [...new Set(values)];

export class StagedEditConflict extends Error {
  constructor(message = 'A staged edit no longer applies to the current play.') { super(message); this.name = 'StagedEditConflict'; }
}

function rewrite(value, ids) {
  if (!ids.size) return value;
  if (typeof value === 'string') return ids.get(value) || value;
  if (Array.isArray(value)) return value.map(item => rewrite(item, ids));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, rewrite(item, ids)]));
  return value;
}
const created = (before, after, type) => {
  const existing = new Set(before[type].map(item => item.id));
  return after[type].filter(item => !existing.has(item.id)).map(item => item.id);
};

// `steps` are {instruction, operations} plus, once staged, the `before` play and
// `proposal` they produced. A step without a proposal is new and is simply
// proposed; a staged step is rebased onto `base` and rejected if anything it
// depended on changed meanwhile.
export function stageEdit(base, steps, options = {}) {
  if (!steps.length) throw new Error('A staged edit needs at least one step.');
  const ids = new Map(), staged = [];
  let play = base;
  for (const step of steps) {
    const operations = rewrite(step.operations, ids);
    if (!step.proposal) { const proposal = proposeEdit(play, operations, options); staged.push({instruction:step.instruction, operations, before:play, proposal}); play = proposal.play; continue; }
    let proposal;
    try { proposal = proposeEdit(play, operations, options); }
    catch { throw new StagedEditConflict(); }
    const original = {play:step.proposal.play, routeIds:step.proposal.routeIds};
    if (proposalConflicts(rewrite(step.before, ids), play, operations, rewrite(original, ids))) throw new StagedEditConflict();
    for (const type of TYPES) {
      const old = created(step.before, step.proposal.play, type), fresh = created(play, proposal.play, type);
      if (old.length !== fresh.length) throw new StagedEditConflict();
      old.forEach((id, index) => { if (id !== fresh[index]) ids.set(id, fresh[index]); });
    }
    staged.push({instruction:step.instruction, operations, before:play, proposal});
    play = proposal.play;
  }
  const stepPlayers = step => unique([...step.proposal.playerIds, ...step.proposal.effects.flatMap(effect => effect.playerIds)]);
  const last = staged.at(-1).proposal;
  return {base, steps:staged, play, summary:last.summary, routeId:last.routeId,
    operations:staged.flatMap(step => step.operations), changes:staged.flatMap(step => step.proposal.changes),
    routeIds:unique(staged.flatMap(step => step.proposal.routeIds)), zoneIds:unique(staged.flatMap(step => step.proposal.zoneIds)),
    playerIds:unique(staged.flatMap(stepPlayers)),
    // One entry per conversation turn, for the thread's records.
    turns:staged.map(step => ({instruction:step.instruction, summary:step.proposal.summary, operations:step.operations,
      routeIds:step.proposal.routeIds, zoneIds:step.proposal.zoneIds, playerIds:stepPlayers(step)}))};
}
