// This module is shared by the room, assistant tools and the external bridge.
// Its schemas and validators deliberately have no DOM or assistant-runtime dependency.
const version = 1;
const playerRef = { type: 'string', minLength: 1, pattern: '\\S', description: 'Exact player ID, unique position label, or unique display label from state.players.' };
const playerId = { type: 'string', minLength: 1, pattern: '\\S', description: 'Player ID from state.players.' };
const seconds = { type: 'number', minimum: 0, description: 'Seconds, inclusive of 0 and the play’s duration.' };
const index = { type: 'integer', minimum: 0, maximum: 2, description: 'Zero-based lesson stop index. Omit to operate on the selected stop.' };
const question = { type: 'string', minLength: 1, maxLength: 160, pattern: '\\S' };
const answer = { type: 'string', maxLength: 320 };
const focusIds = { type: 'array', items: playerId, maxItems: 2, uniqueItems: true };

function branch(operation, description, fields = {}, required = []) {
  return {
    type: 'object', description, properties: { operation: { type: 'string', const: operation }, ...fields },
    required: ['operation', ...required], additionalProperties: false,
  };
}

const lessonActions = [
  ['state', 'Read this lesson. Explicitly request includeAnswers to review authored teacher answers.', { includeAnswers: { type: 'boolean' } }],
  ['open', 'Show the lesson panel.'],
  ['close', 'Hide the lesson panel.'],
  ['add', 'Capture a question at the current or specified frame and focus. Up to three stops.', { question, answer, time: seconds, focusIds }, ['question']],
  ['update', 'Change the question, the answer, or both for a stop. An empty answer clears it.', { index, question, answer }],
  ['replace', 'Replace a stop’s time and focus with the current or supplied frame and focus, preserving its question and answer.', { index, time: seconds, focusIds }],
  ['remove', 'Remove a stop.', { index }],
  ['select', 'Select a stop and restore its frame and focus.', { index }, ['index']],
  ['previous', 'Visit the previous stop.'],
  ['next', 'Visit the next stop.'],
  ['revisit', 'Restore a stop’s frame and focus.', { index }],
  ['reveal', 'Reveal the answer and planned routes for a stop.', { index }],
  ['hide', 'Hide the answer for a stop and ask the question again.', { index }],
  ['cancel', 'Cancel an open stop-editing form.'],
  ['save', 'Save this revision’s lesson on this device.'],
  ['load', 'Load the saved lesson for this play and revision on this device.'],
];

const lessonBranches = lessonActions.map(([action, description, fields, required = []]) => {
  const schema = branch('lesson', description, { action: { type: 'string', const: action }, ...fields }, ['action', ...required]);
  if (action === 'update') schema.anyOf = [{ required: ['question'] }, { required: ['answer'] }];
  return schema;
});

const commands = [
  branch('open', 'Open coach film for the current play, or read the already open room.'),
  branch('close', 'Return to the editor.'),
  branch('state', 'Read the visible frame, players, events, comparison, reference and lesson.'),
  branch('capabilities', 'Describe every film command and its arguments.'),
  branch('seek', 'Pause on an exact time in seconds.', { time: seconds }, ['time']),
  branch('event', 'Pause on an authored event or step to its neighbour.', {
    event: { type: 'string', enum: ['start', 'release', 'arrival', 'end', 'previous', 'next'] },
  }, ['event']),
  branch('play', 'Play or resume. At the end, replay from the start.'),
  branch('pause', 'Pause at the presented time.'),
  branch('speed', 'Set the playback rate.', { speed: { type: 'number', enum: [0.5, 1, 1.5, 2] } }, ['speed']),
  branch('theme', 'Set the room’s presentation theme.', { theme: { type: 'string', enum: ['dark', 'light'] } }, ['theme']),
  branch('focus', 'Set the complete focus selection atomically.', {
    players: { type: 'array', items: playerRef, minItems: 1, maxItems: 2, uniqueItems: true },
  }, ['players']),
  branch('addFocus', 'Add a player to the current selection. A full selection requires explicit replacement.', { player: playerRef }, ['player']),
  branch('removeFocus', 'Remove one player from the selection.', { player: playerRef }, ['player']),
  branch('replaceFocus', 'Replace a selected player in place.', { replace: playerRef, player: playerRef }, ['replace', 'player']),
  branch('clearFocus', 'Clear both focus slots and any pending replacement.'),
  branch('cancelReplacement', 'Dismiss the pending third-player choice and retain the existing selection.'),
  branch('pin', 'Pin the current or a specific frame as the comparison reference.', { time: seconds }),
  branch('unpin', 'Clear the pinned reference.'),
  {
    type: 'object', description: 'Execute one lesson action. Inspect the action branches for its arguments.',
    properties: { operation: { type: 'string', const: 'lesson' } }, required: ['operation'], oneOf: lessonBranches,
  },
];

function freezeSchema(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(freezeSchema);
    Object.freeze(value);
  }
  return value;
}

export const FILM_COMMAND_SCHEMAS = freezeSchema(commands);
const byOperation = new Map(commands.map(schema => [schema.properties.operation.const, schema]));
const byLessonAction = new Map(lessonBranches.map(schema => [schema.properties.action.const, schema]));

export function getFilmCapabilities() {
  return { version, commands: structuredClone(FILM_COMMAND_SCHEMAS) };
}

function fail(code, message, details = {}) {
  throw Object.assign(new Error(message), { code, details });
}

function invalid(message, field) {
  fail('INVALID_COMMAND', message, { field });
}

// The schema vocabulary here covers scalars and arrays of player references.
// The two discriminators select exactly one strict object shape before execution.
function validateValue(rule, value, field) {
  if (rule.type === 'array') {
    if (!Array.isArray(value) || value.length < (rule.minItems ?? 0) || value.length > rule.maxItems)
      invalid('Invalid number of players in ' + field + '.', field);
    for (let i = 0; i < value.length; i++) validateValue(rule.items, value[i], field + '[' + i + ']');
    if (rule.uniqueItems && new Set(value).size !== value.length) invalid('Player references must be distinct.', field);
    return;
  }
  if (rule.type === 'number' || rule.type === 'integer') {
    if (!Number.isFinite(value) || (rule.type === 'integer' && !Number.isInteger(value))
      || value < (rule.minimum ?? -Infinity) || value > (rule.maximum ?? Infinity))
      invalid('Invalid number for ' + field + '.', field);
  } else if (typeof value !== rule.type) {
    invalid('Expected ' + rule.type + ' for ' + field + '.', field);
  } else if (rule.type === 'string' && (value.length < (rule.minLength ?? 0)
    || value.length > (rule.maxLength ?? Infinity) || (rule.pattern && !value.trim()))) {
    invalid('Invalid text for ' + field + '.', field);
  }
  if ((rule.enum && !rule.enum.includes(value)) || ('const' in rule && value !== rule.const))
    invalid('Unsupported value for ' + field + '.', field);
}

export function validateFilmCommand(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || !Object.hasOwn(input, 'operation'))
    invalid('A film command must specify its operation.', 'operation');
  // Copy only the enumerable JSON fields and validate the exact values that will execute.
  const command = { ...input };
  const schema = command.operation === 'lesson' ? byLessonAction.get(command.action) : byOperation.get(command.operation);
  if (!schema) invalid('Unknown film operation or lesson action.', command.operation === 'lesson' ? 'action' : 'operation');
  for (const key of schema.required) {
    if (!Object.hasOwn(command, key)) invalid('Missing required field ' + key + '.', key);
  }
  if (schema.anyOf && !schema.anyOf.some(choice => choice.required.every(key => Object.hasOwn(command, key))))
    invalid('Supply a question, an answer, or both for a lesson update.', 'action');
  for (const [key, value] of Object.entries(command)) {
    if (!Object.hasOwn(schema.properties, key)) invalid('Unexpected field ' + key + '.', key);
    validateValue(schema.properties[key], value, key);
    if (Array.isArray(value)) command[key] = [...value];
  }
  return command;
}

function focusSnapshot(frame) {
  return (frame?.focus || []).map(({ id, position, origin, trail, depthYards }) => ({
    id, position: { ...position }, origin: { ...origin }, trail: trail.map(point => ({ ...point })), depthYards,
  }));
}

export function filmOperationAvailability(raw) {
  const { model, focusIds } = raw;
  const actors = !model.reference && model.players.length > 0;
  const selected = focusIds.length;
  return {
    open: true, close: true, state: true, capabilities: true, theme: true,
    seek: model.hasMotion, event: model.events.length > 0, play: model.hasMotion && !raw.hidden && !raw.playing,
    pause: raw.playing, speed: model.hasMotion, pin: model.hasMotion, unpin: raw.pinnedTime != null,
    focus: actors, addFocus: actors && selected < Math.min(2, model.players.length),
    removeFocus: selected > 0, replaceFocus: selected > 0, clearFocus: selected > 0,
    cancelReplacement: raw.pendingId != null, lesson: raw.lesson?.available === true,
  };
}

function serialize(raw) {
  if (!raw?.open) return { version, open: false };
  const { model, frame, referenceFrame } = raw;
  const reference = referenceFrame && !raw.questionMasked ? {
    time: referenceFrame.time, focus: focusSnapshot(referenceFrame),
    comparison: referenceFrame.comparison ? { ...referenceFrame.comparison } : null,
  } : null;
  return {
    version, open: true, playId: model.play.id, title: model.play.title, formation: model.play.formation || '',
    referenceOnly: model.reference, hasMotion: model.hasMotion, calibrated: model.calibrated,
    duration: model.duration, time: raw.time, playing: raw.playing, speed: raw.speed, theme: raw.theme,
    reducedMotion: Boolean(raw.reducedMotion), renderer: raw.renderer ?? null,
    activeEvent: raw.eventId, previousEvent: raw.previousEventId, nextEvent: raw.nextEventId,
    events: model.events.map(event => ({ ...event })),
    players: model.players.map(({ id, label, displayLabel, side }) => {
      const point = frame?.positions.get(id);
      return { id, label, displayLabel, side, position: point ? { ...point } : null };
    }),
    ball: { phase: frame?.phase ?? 'none', holderId: frame?.holderId ?? null, position: frame?.ball ? { ...frame.ball } : null },
    focusIds: [...raw.focusIds], pendingId: raw.pendingId ?? null, focus: focusSnapshot(frame),
    comparison: frame?.comparison ? { ...frame.comparison } : null,
    pinnedTime: raw.pinnedTime, reference, questionMasked: Boolean(raw.questionMasked),
    lesson: raw.lesson ? structuredClone(raw.lesson) : null, available: filmOperationAvailability(raw),
  };
}

export function readFilmState(session) {
  return serialize(session?.snapshot());
}

function resolvePlayer(players, ref) {
  const direct = players.find(player => player.id === ref);
  if (direct) return direct.id;
  const label = ref.trim().toLowerCase();
  const matches = players.filter(player => [player.label, player.displayLabel]
    .some(value => typeof value === 'string' && value.trim().toLowerCase() === label));
  if (matches.length === 1) return matches[0].id;
  if (matches.length > 1) fail('PLAYER_AMBIGUOUS', 'Multiple players match this label. Use a player ID.', {
    player: ref, candidates: matches.map(({ id, displayLabel }) => ({ id, displayLabel })),
  });
  fail('PLAYER_NOT_FOUND', 'This player does not appear in the current film.', { player: ref });
}

function changeFocus(raw, command) {
  const { players } = raw.model, current = raw.focusIds;
  if (command.operation === 'clearFocus') return [];
  if (command.operation === 'cancelReplacement') return [...current];
  if (command.operation === 'focus') {
    const ids = command.players.map(ref => resolvePlayer(players, ref));
    if (new Set(ids).size !== ids.length) fail('DUPLICATE_PLAYER', 'Both references resolve to the same player.', { ids });
    return ids;
  }
  const id = resolvePlayer(players, command.player);
  if (command.operation === 'removeFocus') return current.filter(selected => selected !== id);
  if (command.operation === 'replaceFocus') {
    const old = resolvePlayer(players, command.replace);
    if (!current.includes(old)) fail('FOCUS_NOT_SELECTED', 'The player to replace must be selected.', { player: old, focusIds: [...current] });
    if (old !== id && current.includes(id)) fail('DUPLICATE_PLAYER', 'The incoming player already occupies the other slot.', { player: id });
    return current.map(selected => selected === old ? id : selected);
  }
  if (current.includes(id)) return [...current];
  if (current.length === 2)
    fail('FOCUS_FULL', 'Both focus slots are occupied. Choose which player to replace.', { focusIds: [...current], player: id });
  return [...current, id];
}

function checkTime(time, duration) {
  if (time > duration) fail('TIME_OUT_OF_RANGE', 'Time exceeds the current play duration.', { time, duration });
}

export async function runFilmCommand(session, input) {
  const command = validateFilmCommand(input);
  if (command.operation === 'capabilities') return getFilmCapabilities();
  const raw = session?.snapshot();
  if (command.operation === 'state' || (command.operation === 'close' && !raw?.open)) return serialize(raw);
  if (!raw?.open) fail('ROOM_CLOSED', 'Open the coach film room first.');
  if (command.operation === 'open') return serialize(raw);
  if (command.operation === 'close') { session.close(); return readFilmState(session); }
  if (raw.model.reference && command.operation !== 'theme')
    fail('REFERENCE_ONLY', 'This reference diagram has no editable player positions or timeline.');
  if (command.time !== undefined) checkTime(command.time, raw.model.duration);
  switch (command.operation) {
    case 'lesson': {
      if (!raw.lesson?.available) fail('LESSON_UNAVAILABLE', 'A lesson is unavailable in this room.');
      for (const id of command.focusIds || []) {
        if (!raw.model.players.some(player => player.id === id)) fail('PLAYER_NOT_FOUND', 'A lesson focus ID is absent from this play.', { player: id });
      }
      const request = { ...command };
      delete request.operation;
      await session.lessonCommand(request);
      // Only an explicit teacher request discloses the authored answer key.
      return serialize(session.snapshot({ includeAnswers: request.action === 'state' && request.includeAnswers === true }));
    }
    case 'theme': session.setTheme(command.theme); break;
    case 'event': {
      let id = command.event;
      if (id === 'previous') id = raw.previousEventId;
      if (id === 'next') id = raw.nextEventId;
      if (!raw.model.events.some(event => event.id === id))
        fail('EVENT_UNAVAILABLE', 'This play has no such event in the requested direction.', { event: command.event, events: raw.model.events.map(event => event.id) });
      session.jumpEvent(id);
      break;
    }
    case 'focus': case 'addFocus': case 'removeFocus': case 'replaceFocus': case 'clearFocus': case 'cancelReplacement':
      session.setFocus(changeFocus(raw, command));
      break;
    default:
      if (!raw.model.hasMotion) fail('NO_MOTION', 'This play has no timed movement.');
      switch (command.operation) {
        case 'seek': session.seek(command.time); break;
        case 'play':
          if (raw.hidden) fail('ROOM_HIDDEN', 'Playback is suspended while the document is hidden.');
          session.setPlaying(true);
          break;
        case 'pause': session.setPlaying(false); break;
        case 'speed': session.setSpeed(command.speed); break;
        case 'pin': session.setPin(command.time ?? raw.time); break;
        case 'unpin': session.setPin(null); break;
      }
  }
  return readFilmState(session);
}
