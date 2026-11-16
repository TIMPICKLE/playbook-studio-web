// One assistant conversation is a thread on a single play. Its short-term memory
// is a bounded list of turn records plus what can be derived from them. A record
// is either settled (applied, discarded, failed, or a plain answer) or `pending`:
// staged in the working draft, already visible on the board the agent reads, and
// waiting for the coach to commit it. Nothing here touches the DOM or the model.

export const CONVERSATION_TURNS = 40;
export const TURN_STATUS = Object.freeze({pending:'pending', applied:'applied', undone:'undone', redone:'redone', stale:'stale', discarded:'discarded', failed:'failed', canceled:'canceled'});

// The panel owns one of these per play scope. A host-side scope adoption may
// clear the thread while a proposal is being committed; the committed turn is
// still remembered afterwards, so settling as applied re-adds a missing record.
export function createConversation(limit = CONVERSATION_TURNS) {
  let turns = [];
  const keep = () => {
    // Never evict a live draft merely because the conversation is long.
    let excess = Math.max(0, turns.filter(turn => turn.status !== TURN_STATUS.pending).length - limit);
    turns = turns.filter(turn => turn.status === TURN_STATUS.pending || excess-- <= 0);
  };
  return {
    add(record) { const turn = {...record}; turns = [...turns, turn]; keep(); return turn; },
    settle(turn, status, patch = {}) {
      const next = Object.assign(turn, patch, {status});
      if (status === TURN_STATUS.applied && !turns.includes(turn)) { turns = [...turns, next]; keep(); }
      return next;
    },
    records: () => turns.map(turn => ({...turn})),
    settleTransaction(id, status) {
      if (!id || ![TURN_STATUS.applied, TURN_STATUS.undone, TURN_STATUS.redone].includes(status)) return false;
      let changed = false;
      for (const turn of turns) if (turn.transactionId === id) { turn.status = status; changed = true; }
      return changed;
    },
    clear() { turns = []; },
  };
}

const list = value => Array.isArray(value) ? value : [];
const operationPlayers = operation => [operation?.playerId, operation?.receiverId, operation?.nearId,
  ...list(operation?.playerIds), ...list(operation?.targetIds)];

// Derives what a follow-up may lean on. Every ID is checked against the board the
// agent is about to read, so a record can never ground an object that is gone.
// `known` are players this conversation already worked with; `focus` is the
// subject of the most recent turn that had one, for instructions that omit theirs.
export function conversationContext(input) {
  const board = input?.board || {}, previous = list(input?.previous);
  const players = new Map(list(board.players).map(player => [player.id, player]));
  const routes = new Set(list(board.routes).map(route => route.id));
  const subjects = turn => [...new Set([...list(turn?.playerIds), ...list(turn?.operations).flatMap(operationPlayers)])]
    .filter(id => typeof id === 'string' && players.has(id));
  const known = new Set(previous.flatMap(subjects));
  const selectedIds = [...new Set([...list(board.selectedPlayerIds),board.selectedPlayerId])].filter(id=>players.has(id));
  const selection = selectedIds.map(id=>({id,label:players.get(id).label,side:players.get(id).side,x:players.get(id).x,...(players.get(id).name ? {name:players.get(id).name} : {})}));
  selectedIds.forEach(id=>known.add(id));
  let focus = null;
  for (let index = previous.length - 1; index >= 0 && !focus; index--) {
    const turn = previous[index], ids = subjects(turn);
    if (!ids.length) continue;
    focus = {instruction:typeof turn.instruction === 'string' ? turn.instruction.slice(0, 400) : '', status:turn.status || 'answered',
      players:ids.slice(0, 22).map(id => ({id, label:players.get(id).label, side:players.get(id).side})),
      routeIds:list(turn.routeIds).filter(id => routes.has(id)).slice(0, 22)};
  }
  if (selection.length > 1) focus = {instruction:'Current multi-selection',status:'selected',players:selection,routeIds:[],group:true};
  return {known, focus, selection, staged:previous.filter(turn => turn?.status === TURN_STATUS.pending).length};
}

// Display history can be longer than the model payload. Keep every live staged
// turn, recent exchanges and the last grounded subject, rather than losing the
// subject after a few conversational answers. This is memory compaction, not a
// limit on requests or on the number of edits a coach can stage.
export function conversationRecords(records, recent = 12) {
  if (!Array.isArray(records)) return [];
  const selected = new Set(records.slice(-recent));
  for (const turn of records) if (turn?.status === TURN_STATUS.pending) selected.add(turn);
  const subject = records.findLast(turn => list(turn?.playerIds).length || list(turn?.operations).some(operation => operationPlayers(operation).some(Boolean)));
  if (subject) selected.add(subject);
  return records.filter(turn => selected.has(turn));
}
