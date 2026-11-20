import { getFilmTimeline, formatFilmTime } from './coach-film-model.js';
import { t } from './i18n.js';
import { escapeHTML as e } from './model.js';

// Research arms are per URL. They must never change anyone's saved display preference.
export function getFilmPilotVariant(search) {
  const [variant, ...duplicates] = new URLSearchParams(search).getAll('filmPilot');
  return !duplicates.length && ['baseline', 'events', 'film', 'lesson'].includes(variant) ? variant : null;
}

export function filmPilotEventControls(play) {
  const { events } = getFilmTimeline(play);
  if (events.length < 2) return '';
  const buttons = events.map(({ id, time }) => {
    return `<button type="button" class="button subtle" data-action="film-pilot-event:${id}">${e(t('film.event.' + id))} <span>${formatFilmTime(time, true)}s</span></button>`;
  }).join('');
  return `<div class="film-pilot-events" role="group" aria-label="${e(t('film.events'))}">${buttons}</div>`;
}

// Resolve against the current play on activation. Rendered buttons may predate an edit.
export function filmPilotEventTime(play, eventId) {
  return getFilmTimeline(play).events.find(event => event.id === eventId)?.time ?? null;
}
