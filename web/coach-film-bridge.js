import { createFilmModel } from './coach-film-model.js';
import { FILM_COMMAND_SCHEMAS, filmOperationAvailability, getFilmCapabilities, validateFilmCommand } from './coach-film-commands.js';

const allOperations = FILM_COMMAND_SCHEMAS.map(rule => rule.properties.operation.const);
const transport = ['state', 'capabilities', 'event', 'seek', 'play', 'pause', 'speed'];

function fail(code, message) {
  throw Object.assign(new Error(message), {code});
}

// Each request is scoped to its original workspace and play. The model calls the
// same live session as the field controls and receives its actual resulting state.
export function createFilmBridge({guard, available, pilot, getPlay, getRoster, getRoom, open, attachLesson, regular}) {
  function operations(full, eventsOnly) {
    if (full) return allOperations;
    return eventsOnly ? transport : ['state', 'capabilities'];
  }

  // The host can attach a personal lesson on demand. The room's own lesson
  // snapshot separately describes the controller which is actually mounted.
  function hostState(state, full) {
    const lessonOnRequest = full && !state.referenceOnly;
    return {...state, roomAvailable:full, pilot, lessonOnRequest,
      available:{...state.available, lesson:lessonOnRequest}};
  }

  function read() {
    guard();
    const room = getRoom();
    const full = available();
    if (room) return hostState(room.readState(), full);
    const play = getPlay();
    const eventsOnly = !full && pilot === 'events' && regular.enabled();
    const supported = operations(full, eventsOnly);
    const metadata = {version:1, open:false, playId:play.id, title:play.title, lesson:null,
      operations:supported, available:Object.fromEntries(supported.map(name=>[name,true]))};
    if (!full && !eventsOnly) return hostState({...metadata, events:[], players:[]}, false);
    const model = createFilmModel(play,{roster:getRoster()});
    const enabled = filmOperationAvailability({model, focusIds:[], hidden:false});
    metadata.available = Object.fromEntries(supported.map(name=>[name, Boolean(enabled[name])]));
    return hostState({...metadata, ...(eventsOnly ? regular.read() : {}),
      events: model.events, duration:model.duration, calibrated:model.calibrated, referenceOnly:model.reference, reference:null,
      players: model.players.map(({id,label,displayLabel,side})=>({id,label,displayLabel,side}))}, full);
  }

  async function execute(input) {
    guard();
    validateFilmCommand(input);
    const op = input.operation;
    if (op === 'state') return read();
    if (op === 'capabilities') {
      const catalog = getFilmCapabilities();
      if (available()) return catalog;
      const allowed = operations(false, pilot === 'events' && regular.enabled());
      return {...catalog, commands:catalog.commands.filter(rule => allowed.includes(rule.properties.operation.const))};
    }
    if (!available()) {
      if (pilot !== 'events' || !regular.enabled() || !transport.includes(op)) {
        fail('FILM_UNAVAILABLE', 'Film room is unavailable in this device or study condition.');
      }
      const snapshot = read();
      if (op === 'seek' && input.time > snapshot.duration) fail('TIME_OUT_OF_RANGE', 'Time exceeds the current play duration.');
      if (op === 'event') {
        const target = input.event === 'previous' ? snapshot.events.findLast(event => event.time < snapshot.time)
          : input.event === 'next' ? snapshot.events.find(event => event.time > snapshot.time)
          : snapshot.events.find(event => event.id === input.event);
        if (!target) fail('EVENT_UNAVAILABLE', 'This play has no such event.');
        regular.apply({operation:'seek', time:target.time});
      } else regular.apply(input);
      return read();
    }
    if (op === 'lesson' && input.action === 'state') {
      const state = read();
      if (state.referenceOnly) fail('REFERENCE_ONLY', 'This reference diagram has no editable player positions or timeline.');
      if (!state.lesson) return state;
    }
    if (op === 'close' && !getRoom()) return read();
    if (!getRoom()) {
      const opened = await open();
      guard();
      if (!opened || !getRoom()) fail('FILM_UNAVAILABLE', 'The film room could not be opened.');
    }
    const room = getRoom();
    if (op === 'open') return read();
    if (op === 'lesson' && input.action !== 'state') {
      await attachLesson(room);
      guard();
      if (room !== getRoom()) fail('ROOM_CLOSED', 'The original film room has been closed.');
    }
    const result = await room.perform(input);
    guard();
    if (op === 'close') return read();
    if (result?.open) return hostState(result, available());
    return result;
  }
  return {read, execute};
}
