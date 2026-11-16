// One assistant conversation is a thread on a single play. Its short-term memory
// is a bounded list of turn records plus what can be derived from them. A record
// is either settled (applied, discarded, failed, or a plain answer) or `pending`:
// staged in the working draft, already visible on the board the agent reads, and
// waiting for the coach to commit it. Nothing here touches the DOM or the model.

export const CONVERSATION_TURNS = 5;
export const TURN_STATUS = Object.freeze({pending:'pending', applied:'applied', discarded:'discarded', failed:'failed'});

// The panel owns one of these per play scope. A host-side scope adoption may
// clear the thread while a proposal is being committed; the committed turn is
// still remembered afterwards, so settling as applied re-adds a missing record.
export function createConversation(limit = CONVERSATION_TURNS) {
  let turns = [];
  const keep = () => { turns = turns.slice(-limit); };
  return {
    add(record) { const turn = {...record}; turns = [...turns, turn]; keep(); return turn; },
    settle(turn, status, patch = {}) {
      const next = Object.assign(turn, patch, {status});
      if (status === TURN_STATUS.applied && !turns.includes(turn)) { turns = [...turns, next]; keep(); }
      return next;
    },
    records: () => turns.map(turn => ({...turn})),
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
  if (players.has(board.selectedPlayerId)) known.add(board.selectedPlayerId);
  let focus = null;
  for (let index = previous.length - 1; index >= 0 && !focus; index--) {
    const turn = previous[index], ids = subjects(turn);
    if (!ids.length) continue;
    focus = {instruction:typeof turn.instruction === 'string' ? turn.instruction.slice(0, 400) : '', status:turn.status || 'answered',
      players:ids.slice(0, 22).map(id => ({id, label:players.get(id).label, side:players.get(id).side})),
      routeIds:list(turn.routeIds).filter(id => routes.has(id)).slice(0, 22)};
  }
  return {known, focus, staged:previous.filter(turn => turn?.status === TURN_STATUS.pending).length};
}
