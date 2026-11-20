import { t } from './i18n.js';
import { escapeHTML as e } from './model.js';
import { formatFilmTime } from './coach-film-model.js';

const symbols = {
  exit: '<path d="M9 5H5v14h4m1-7h10m-4-4 4 4-4 4"/>',
  theme: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/>',
  play: '<path d="m8 5 11 7-11 7z" fill="currentColor" stroke="none"/>',
  pause: '<path d="M7 5h3v14H7zm7 0h3v14h-3z" fill="currentColor" stroke="none"/>',
  previous: '<path d="M5 5v14m13-14L8 12l10 7z"/>',
  next: '<path d="M19 5v14M6 5l10 7-10 7z"/>',
  pin: '<path d="m7 4 10 0m-2 0 .5 6 2.5 3v1H6v-1l2.5-3L9 4m3 10v6"/>',
};
const icon = name => `<svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${symbols[name]}</svg>`;

function write(node, value) {
  if (node.textContent !== value) node.textContent = value;
}

function rosterGroup(players, side) {
  const members = players.filter(player => player.side === side);
  if (!members.length) return '';
  return `<div class="film-side" role="group" aria-label="${t('film.' + side)}">
    <h4>${t('film.' + side)}</h4><div class="film-player-list">${members.map(player => {
      const [position, ...detail] = player.displayLabel.split(' · ');
      return `<button type="button" class="film-player" data-film-pick="${e(player.id)}" aria-pressed="false" aria-label="${e(player.displayLabel)}" title="${e(player.displayLabel)}">
        <span class="film-player-label">${e(position)}</span><span class="film-player-detail">${e(detail.join(' · '))}</span>
      </button>`;
    }).join('')}</div>
  </div>`;
}

function comparisonText(frame, playerNames) {
  if (!frame?.comparison) return '';
  const { deeperId, shallowerId, gapYards } = frame.comparison;
  if (deeperId == null) return t('film.fieldSameDepth');
  return t(gapYards == null ? 'film.deeperRelative' : 'film.deeper', {
    first: playerNames.get(deeperId), second: playerNames.get(shallowerId), yards: gapYards?.toFixed(1),
  });
}

// The shell owns controls and text only. The field owns its retained SVG/GL nodes.
export function createFilmView(doc) {
  const dialog = doc.createElement('dialog');
  dialog.id = 'coach-film-room';
  dialog.className = 'coach-film coach-film-room';
  dialog.setAttribute('aria-labelledby', 'film-room-name film-play-title');
  dialog.innerHTML = `<div class="film-shell">
    <header class="film-header">
      <div class="film-heading"><span class="film-meta" id="film-room-name">${t('film.room')}</span><h2 id="film-play-title" class="film-title" tabindex="-1"></h2><p data-film-formation></p></div>
      <div class="film-actions">
        <button type="button" class="film-control film-theme" data-film-action="theme" aria-label="${t('film.theme')}" title="${t('film.theme')}">${icon('theme')}</button>
        <button type="button" class="film-control film-exit" data-film-action="exit">${icon('exit')}${t('film.exit')}</button>
      </div>
    </header>
    <div class="film-workspace">
      <main class="film-stage" aria-label="${t('film.fieldLabel')}">
        <div class="film-field"></div>
        <div class="film-unavailable" hidden><p>${t('film.referenceHelp')}</p></div>
        <div class="film-legend">
          <span class="film-legend-route">${t('film.route')}</span><span class="film-legend-recent">${t('film.recent')}</span><span class="film-legend-origin">${t('film.origin')}</span>
        </div>
      </main>
      <aside class="film-inspector" aria-labelledby="film-focus-title">
        <div class="film-inspector-heading"><h3 id="film-focus-title">${t('film.focus')}</h3><span class="film-focus-count"></span></div>
        <div class="film-readout"><p class="film-comparison" data-film-comparison></p><div class="film-depth-list"></div>
          <p class="film-reference" data-film-reference hidden></p>
          <button type="button" class="film-control film-pin" data-film-action="pin" aria-pressed="false">${icon('pin')}<span>${t('film.pin')}</span></button>
        </div>
        <div class="film-replace" hidden></div>
        <div class="film-roster" aria-label="${t('film.players')}"></div>
        <p class="film-notice" hidden></p>
        <p class="film-notice" data-film-update role="status" hidden></p>
      </aside>
    </div>
    <footer class="film-transport" aria-label="${t('film.timeline')}">
      <div class="film-transport-controls">
        <button type="button" class="film-control film-play" data-film-action="play"><span data-film-glyph>${icon('play')}</span><span data-film-playing-label>${t('film.play')}</span></button>
        <button type="button" class="film-control film-prev" data-film-action="prev" aria-label="${t('film.previous')}" title="${t('film.previous')} ([)" aria-keyshortcuts="[ Alt+ArrowLeft">${icon('previous')}</button>
        <button type="button" class="film-control film-next" data-film-action="next" aria-label="${t('film.next')}" title="${t('film.next')} (])" aria-keyshortcuts="] Alt+ArrowRight">${icon('next')}</button>
        <span class="film-time" data-film-clock></span>
        <span class="film-phase" data-film-phase></span>
        <select class="film-speed" data-film-speed aria-label="${t('film.speed')}" title="${t('film.speed')}">${[.5, 1, 1.5, 2].map(speed =>
          `<option value="${speed}"${speed === 1 ? ' selected' : ''}>${speed}×</option>`).join('')}</select>
      </div>
      <div class="film-track">
        <div class="film-scrub"><input type="range" class="film-timeline" min="0" step="0.01" value="0" aria-label="${t('film.timeline')}" data-film-time>
          <div class="film-ticks" aria-hidden="true"></div></div>
        <div class="film-events" role="group" aria-label="${t('film.events')}"></div>
      </div>
    </footer>
    <span class="sr-only" data-film-announcement aria-live="polite" aria-atomic="true"></span>
  </div>`;
  const get = selector => dialog.querySelector(selector);
  const title = get('.film-title'), headerActions = get('.film-actions'), field = get('.film-field');
  const timeline = get('[data-film-time]'), transport = get('.film-transport'), speed = get('[data-film-speed]');
  const timeText = get('[data-film-clock]'), phaseText = get('[data-film-phase]'), comparison = get('[data-film-comparison]');
  const playButton = get('.film-play'), playGlyph = get('[data-film-glyph]'), playLabel = get('[data-film-playing-label]');
  const prev = get('.film-prev'), next = get('.film-next'), themeButton = get('.film-theme'), pin = get('.film-pin');
  const pinned = get('[data-film-reference]'), originLegend = get('.film-legend-origin'), legend = get('.film-legend');
  const inspector = get('.film-inspector'), roster = get('.film-roster'), readout = get('.film-readout');
  const replace = get('.film-replace'), focusCount = get('.film-focus-count'), depthList = get('.film-depth-list');
  const notice = get('.film-notice'), announceNode = get('[data-film-announcement]');
  const revisionNotice = get('[data-film-update]');
  const events = get('.film-events'), ticks = get('.film-ticks'), unavailable = get('.film-unavailable');
  let names = new Map(), playerButtons = new Map(), depthRows = new Map(), eventButtons = [], eventTicks = [];
  let activeEvent = null;
  let durationLabel, displayedTime, eventTimes = new Set();

  function stoppedTime(time) {
    return formatFilmTime(eventTimes.has(time) ? time : Math.round(time * 100) / 100, true);
  }

  function setModel(model) {
    const play = model.play;
    names = new Map(model.players.map(player => [player.id, player.displayLabel]));
    title.textContent = play.title;
    get('[data-film-formation]').textContent = play.formation || '';
    unavailable.hidden = !model.reference;
    unavailable.querySelector('img')?.remove();
    if (model.reference && play.reference.image) {
      const image = doc.createElement('img');
      image.src = './' + play.reference.image;
      image.alt = play.title;
      unavailable.prepend(image);
    }
    field.hidden = legend.hidden = inspector.hidden = transport.hidden = model.reference;
    roster.innerHTML = rosterGroup(model.players, 'offense') + rosterGroup(model.players, 'defense');
    playerButtons = new Map([...roster.querySelectorAll('[data-film-pick]')].map(node => [node.dataset.filmPick, node]));
    const messages = [];
    if (!model.reference && !model.hasMotion) messages.push(t('film.stationary'));
    if (!model.reference && !model.calibrated) messages.push(t('film.uncalibrated'));
    notice.textContent = messages.join(' ');
    notice.hidden = !messages.length;
    timeline.max = String(model.duration);
    durationLabel = formatFilmTime(model.duration, true);
    eventTimes = new Set(model.events.map(event => event.time));
    timeline.disabled = playButton.disabled = speed.disabled = !model.hasMotion;
    events.innerHTML = model.events.map(event =>
      `<button type="button" class="film-event" data-film-event="${event.id}">
        <strong>${t('film.event.' + event.id)}</strong><time>${formatFilmTime(event.time, true)}s</time>
      </button>`).join('');
    ticks.innerHTML = model.events.map(event =>
      `<i class="film-tick" style="--film-at:${model.duration ? event.time / model.duration * 100 : 0}%"></i>`).join('');
    eventButtons = [...events.querySelectorAll('button')];
    eventTicks = [...ticks.children];
    activeEvent = null;
  }

  function setFocus(ids, pendingId) {
    for (const [id, node] of playerButtons) node.setAttribute('aria-pressed', String(ids.includes(id)));
    focusCount.textContent = `${ids.length} / 2`;
    focusCount.setAttribute('aria-label', t('film.focusCount', { count: ids.length }));
    readout.dataset.count = String(ids.length);
    depthList.innerHTML = ids.map(id => `<div class="film-depth-row" data-film-depth="${e(id)}"><strong>${e(names.get(id))}</strong><span></span></div>`).join('');
    depthRows = new Map([...depthList.children].map(row => [row.dataset.filmDepth, row.lastElementChild]));
    replace.hidden = !pendingId;
    replace.replaceChildren();
    if (pendingId) {
      replace.innerHTML = `<p>${e(t('film.replacePrompt', { name: names.get(pendingId) }))}</p>
        <div>${ids.map(id => `<button type="button" data-film-replace="${e(id)}">${e(t('film.replace', {name:names.get(id)}))}</button>`).join('')}
        <button type="button" data-film-action="cancel-replace">${t('film.cancel')}</button></div>`;
    }
  }

  function setReference(referenceFrame) {
    const active = !!referenceFrame;
    pin.setAttribute('aria-pressed', String(active));
    write(pin.lastElementChild, t(active ? 'film.unpin' : 'film.pin'));
    pinned.hidden = !active;
    write(originLegend, t(active ? 'film.pinnedOrigin' : 'film.origin'));
    if (active) {
      const result = comparisonText(referenceFrame, names), args = { time: stoppedTime(referenceFrame.time), result };
      write(pinned, t(result ? 'film.referenceGap' : 'film.referenceAt', args));
    }
  }

  function setTheme(theme) {
    dialog.dataset.theme = field.dataset.theme = theme;
    themeButton.setAttribute('aria-pressed', String(theme === 'light'));
    themeButton.title = `${t('film.theme')} · ${t('film.' + theme)}`;
  }

  function setPlaying(playing, ended) {
    const mode = playing ? 'pause' : ended ? 'replay' : 'play';
    if (playButton.dataset.state === mode) return;
    playButton.dataset.state = mode;
    playGlyph.innerHTML = icon(playing ? 'pause' : 'play');
    write(playLabel, t('film.' + mode));
  }

  function draw(frame, model, eventId, neighbours, playing) {
    const time = playing ? formatFilmTime(frame.time) : stoppedTime(frame.time);
    const fullTime = `${time} / ${durationLabel} s`;
    displayedTime = time;
    if (timeText.textContent !== fullTime) {
      timeText.textContent = fullTime;
      timeText.setAttribute('aria-label', t('film.clock', {time, duration:durationLabel}));
    }
    timeText.dataset.seconds = String(frame.time);
    const sliderValue = String(Math.round(frame.time * 100) / 100);
    if (timeline.value !== sliderValue) timeline.value = sliderValue;
    const accessibleTime = t('film.timelineValue', {time});
    if (timeline.getAttribute('aria-valuetext') !== accessibleTime) timeline.setAttribute('aria-valuetext', accessibleTime);
    const phase = t('film.phase.' + frame.phase, {player:names.get(frame.holderId) || ''});
    write(phaseText, phase);
    if (phaseText.dataset.phase !== frame.phase) phaseText.dataset.phase = frame.phase;
    write(comparison, comparisonText(frame, names) || t(frame.focus.length ? 'film.chooseSecond' : 'film.choose'));
    for (const player of frame.focus) {
      const cell = depthRows.get(player.id);
      if (cell) write(cell, player.depthYards == null ? t('film.relative') : t('film.depth', { yards:player.depthYards.toFixed(1) }));
    }
    if (activeEvent !== eventId) {
      activeEvent = eventId;
      for (let i = 0; i < eventButtons.length; i++) {
        const current = eventButtons[i].dataset.filmEvent === eventId;
        eventButtons[i].setAttribute('aria-current', current ? 'step' : 'false');
        for (const node of [eventButtons[i], eventTicks[i]]) {
          if (current) node.dataset.current = 'true';
          else delete node.dataset.current;
        }
      }
    }
    if (prev.disabled !== !neighbours.previous) prev.disabled = !neighbours.previous;
    if (next.disabled !== !neighbours.next) next.disabled = !neighbours.next;
    if (pin.disabled !== !model.hasMotion) pin.disabled = !model.hasMotion;
    return phase;
  }

  return { dialog, title, headerActions, field, timeline, speed, pin, setModel, setFocus, setReference, setPlaying, setTheme, draw,
    readComparison: () => comparison.textContent,
    readTime: () => displayedTime,
    announce: message => write(announceNode, message),
    revision(message = '') {
      write(revisionNotice, message);
      revisionNotice.hidden = !message;
    },
    focusReplacement: () => replace.querySelector('button')?.focus({preventScroll:true}),
    focusPlayer: id => playerButtons.get(id)?.focus({preventScroll:true}),
  };
}
