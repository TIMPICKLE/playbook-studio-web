import { t } from './i18n.js';
import { createFilmModel, filmLessonSource, selectFilmFocus } from './coach-film-model.js';
import { createFilmField } from './coach-film-field.js';
import { createFilmView } from './coach-film-view.js';
import { mountFilmAssistant } from './coach-film-assistant.js';
import { readFilmState, runFilmCommand } from './coach-film-commands.js';
import { createScrubPresentation } from './scrub-presentation.js';
import { createPlaybackClock } from './playback-clock.js';

const validTheme = settings => settings?.fieldTheme === 'light' ? 'light' : 'dark';

// The editor can mutate a play in place. Compare the inputs used by the teaching view
// on editor updates, and give a session a stable snapshot to evaluate between updates.
function sourceSignature(play, roster) {
  const boundIds = new Set((play.players || []).map(player => player.rosterId).filter(Boolean));
  const bindings = roster.filter(member => boundIds.has(member.id))
    .map(member => [member.id, member.name, member.number, member.position])
    .sort(([left], [right]) => left.localeCompare(right));
  return JSON.stringify([play.id, play.formation, play.league, play.book, play.reference,
    play.players, play.routes, play.zones, play.annotations, play.ball, bindings]);
}

export function openFilmRoom({ play, settings = {}, roster = [], onClose = () => {}, lesson = null, assistant = null, doc = document }) {
  const win = doc.defaultView;
  const opener = doc.activeElement;
  const view = createFilmView(doc);
  const { dialog } = view;
  const motion = win.matchMedia?.('(prefers-reduced-motion: reduce)');
  const inertSiblings = [];
  let assistantPanel;
  let questionMasked = false;
  let model, field, signature, lessonController, currentRoster = roster;
  let sampledFrame, sampledFocus;
  let time = 0, speed = 1, playing = false;
  let focusIds = [], pendingId = null, activeEvent = null, selectedPin = null, referenceFrame = null;
  let sourceTheme = validTheme(settings), theme = sourceTheme, closed = false, lastPhase = '';
  const scrub = createScrubPresentation(win, paint);
  const playback = createPlaybackClock(win, (at, stamp, running) => {
    time = at;
    playing = running;
    paint();
  });

  function eventAtTime() {
    return model.events.find(event => event.id === activeEvent && event.time === time)
      ?? model.events.find(event => event.time === time);
  }

  function neighbours() {
    const index = model.events.indexOf(eventAtTime());
    if (index >= 0) return { previous: model.events[index - 1], next: model.events[index + 1] };
    return { previous: model.events.findLast(event => event.time < time), next: model.events.find(event => event.time > time) };
  }

  // The field, readings and programmatic inspection share this sample. A
  // screen-reader announcement or state query never creates another clock.
  function currentFrame() {
    if (!model || model.reference) return null;
    if (sampledFrame?.time !== time || sampledFocus !== focusIds) {
      sampledFrame = model.frameAt(time, focusIds);
      sampledFocus = focusIds;
    }
    return sampledFrame;
  }

  function paint() {
    if (closed || !model || model.reference) return;
    const frame = currentFrame();
    field.render(frame, focusIds, referenceFrame, questionMasked);
    lastPhase = view.draw(frame, model, eventAtTime()?.id ?? null, neighbours(), playing);
    view.setPlaying(playing, model.hasMotion && time === model.duration);
  }

  function stopClock() {
    time = playback.pause() ?? time;
    scrub.cancel();
    playing = false;
    if (model) view.setPlaying(false, model.hasMotion && time === model.duration);
  }

  function jump(value, eventId = null, immediate = true) {
    const requested = Number(value);
    if (!Number.isFinite(requested) || !model || model.reference) return;
    if (playing) stopClock();
    activeEvent = eventId;
    time = Math.max(0, Math.min(requested, model.duration));
    if (immediate) { scrub.cancel(); paint(); }
    else scrub.queue();
  }

  function rangeSeek(final = false) {
    const requested = Number(view.timeline.value);
    if (playing || activeEvent != null || requested !== time) jump(requested, null, false);
    if (final) scrub.flush();
  }

  function jumpToEvent(event) {
    if (!event) return;
    jump(event.time, event.id);
    const label = t('film.eventAnnouncement', { event: t('film.event.' + event.id), time: view.readTime(), phase: lastPhase });
    view.announce(!questionMasked && focusIds.length === 2 ? `${label} ${view.readComparison()}` : label);
  }

  function announceComparison() {
    if (!questionMasked && focusIds.length === 2) {
      view.announce(t('film.comparisonAnnouncement', { time:view.readTime(), result:view.readComparison() }));
    }
  }

  function seek(at) {
    jump(at);
    announceComparison();
  }

  function jumpEvent(id) {
    const event = model.events.find(item => item.id === id);
    jumpToEvent(event);
    return event;
  }

  function setPlaying(next) {
    if (!next) {
      if (playing || scrub.pending) { stopClock(); paint(); }
      return;
    }
    if (playing || !model.hasMotion || doc.hidden) return;
    scrub.cancel();
    time = playback.start(time, {duration:model.duration, speed});
    activeEvent = null;
    playing = true;
    paint();
  }

  function setSpeed(next) {
    if (speed === next) return;
    speed = next;
    view.speed.value = String(speed);
    if (playing) {
      time = playback.configure(speed);
      playing = playback.running;
      paint();
    }
  }

  function syncFocus() {
    view.setFocus(focusIds, pendingId);
    referenceFrame = selectedPin == null ? null :
      selectedPin === time ? currentFrame() : model.frameAt(selectedPin, focusIds);
    view.setReference(referenceFrame);
  }

  function setFocus(ids, pending = null) {
    stopClock();
    focusIds = [...ids];
    pendingId = pending;
    syncFocus();
    paint();
    if (!pendingId) announceComparison();
  }

  function pick(id, replaceId) {
    if (closed || !model.players.some(player => player.id === id)) return;
    const result = selectFilmFocus(focusIds, id, replaceId);
    setFocus(result.ids, result.needsReplacement ? id : null);
    if (pendingId) view.focusReplacement();
    else if (replaceId) view.focusPlayer(id);
  }

  function setPin(next) {
    if (!model.hasMotion || (next === undefined ? !playing && selectedPin === time : selectedPin === next)) return;
    stopClock();
    selectedPin = next === undefined ? time : next;
    syncFocus();
    paint();
  }

  function lessonGo(at, ids = []) {
    if (closed || !model || model.reference) return;
    stopClock();
    const known = new Set(model.players.map(player => player.id));
    focusIds = [...new Set(ids)].filter(id => known.has(id)).slice(0, 2);
    pendingId = null;
    syncFocus();
    jump(at);
  }

  function setTheme(next) {
    if (theme === next) return;
    theme = next;
    view.setTheme(theme);
    field?.setTheme(theme);
  }

  function mountLesson() {
    if (!lesson || closed || !model || model.reference) return;
    lessonController = lesson.mount({
      host: view.headerActions, model,
      read: () => ({time, focusIds: [...focusIds]}),
      go: lessonGo,
      onProjectionChange(masked, lessonOpen) {
        assistantPanel?.setLessonOpen(lessonOpen && !closed);
        if (questionMasked === masked) return;
        questionMasked = masked;
        view.setQuestionMasked(masked);
        view.setReference(referenceFrame);
        if (field && !closed) paint();
      },
    });
  }

  function attachLesson(nextLesson) {
    if (closed || model.reference || !nextLesson) return false;
    if (!lessonController) {
      lesson = nextLesson;
      mountLesson();
    }
    return !!lessonController;
  }

  function releaseLesson() {
    lessonController?.dispose();
    lessonController = null;
  }

  function update(nextPlay, next = {}) {
    if (closed || !nextPlay) return;
    if (next.settings && sourceTheme !== validTheme(next.settings)) {
      sourceTheme = validTheme(next.settings);
      setTheme(sourceTheme);
    }
    currentRoster = next.roster ?? currentRoster;
    const nextSignature = sourceSignature(nextPlay, currentRoster);
    if (signature === nextSignature) {
      if (model.play.title !== nextPlay.title) {
        model.play.title = nextPlay.title;
        view.setTitle(nextPlay.title);
      }
      return;
    }
    const nextModel = createFilmModel(nextPlay, {roster: currentRoster});
    const wasMounted = !!model, samePlay = model?.play.id === nextPlay.id;
    const sameLesson = samePlay && !model.reference && !nextModel.reference;
    const sameLayout = sameLesson && filmLessonSource(model) === filmLessonSource(nextModel);
    const oldEvent = model?.events.find(event => event.id === activeEvent);
    const previousFocus = focusIds;
    const hadPin = selectedPin != null;
    const activeControl = doc.activeElement?.dataset;
    if (!sameLayout) {
      stopClock();
      field?.destroy();
      field = null;
      if (!sameLesson) releaseLesson();
    }
    signature = nextSignature;
    model = nextModel;
    sampledFrame = null;
    if (sameLayout) {
      view.setMetadata(model);
      field.setMetadata(model);
    } else {
      const known = new Set(model.players.map(player => player.id));
      focusIds = samePlay ? previousFocus.filter(id => known.has(id)) : [];
      const retainedEvent = samePlay && oldEvent && model.events.find(event => event.id === oldEvent.id);
      time = retainedEvent ? retainedEvent.time : samePlay ? Math.min(time, model.duration) : 0;
      activeEvent = retainedEvent?.id ?? null;
      selectedPin = pendingId = null;
      view.setModel(model);
      if (sameLesson && lessonController) {
        if (lessonController.revise) lessonController.revise(model);
        else releaseLesson();
      }
      if (wasMounted) {
        const lostMarkers = previousFocus.length !== focusIds.length || (oldEvent && !retainedEvent) || hadPin;
        view.revision(t(lostMarkers ? 'film.focusExpired' : 'film.updated'));
      }
    }
    view.setTheme(theme);
    if (!field && !model.reference) field = createFilmField(view.field, { model, theme, onPick: pick, reducedMotion: !!motion?.matches });
    syncFocus();
    paint();
    if (!lessonController) mountLesson();
    if (sameLayout && activeControl) {
      if (activeControl.filmReplace) {
        [...dialog.querySelectorAll('[data-film-replace]')].find(node => node.dataset.filmReplace === activeControl.filmReplace)?.focus({preventScroll:true});
      } else if (activeControl.filmAction === 'cancel-replace') {
        dialog.querySelector('[data-film-action="cancel-replace"]')?.focus({preventScroll:true});
      }
    }
  }

  function click(event) {
    if (event.defaultPrevented) return;
    const button = event.target.closest?.('button');
    if (!button || button.disabled) return;
    if (button.hasAttribute('data-film-pick')) { pick(button.dataset.filmPick); return; }
    if (button.hasAttribute('data-film-replace')) { if (pendingId) pick(pendingId, button.dataset.filmReplace); return; }
    if (button.hasAttribute('data-film-event')) {
      jumpEvent(button.dataset.filmEvent);
      return;
    }
    switch (button.dataset.filmAction) {
      case 'exit': close(); break;
      case 'play': setPlaying(!playing); break;
      case 'next': jumpToEvent(neighbours().next); break;
      case 'prev': jumpToEvent(neighbours().previous); break;
      case 'theme': setTheme(theme === 'light' ? 'dark' : 'light'); break;
      case 'pin': setPin(selectedPin == null ? undefined : null); break;
      case 'cancel-replace': dismissReplacement(); break;
    }
  }

  function dismissReplacement() {
    if (!pendingId) return false;
    const cancelled = pendingId;
    pendingId = null;
    syncFocus();
    view.focusPlayer(cancelled);
    return true;
  }

  function cancel(event) {
    event.preventDefault();
    event.stopPropagation();
    if (assistantPanel?.dismiss() || dismissReplacement() || lessonController?.dismiss?.()) return;
    close();
  }

  function keydown(event) {
    if (event.defaultPrevented || event.isComposing || event.ctrlKey || event.metaKey) return;
    if (event.key === 'Escape') {
      cancel(event);
      return;
    }
    if (event.key === 'Tab' && inertSiblings.length) {
      const nodes = [...dialog.querySelectorAll('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),summary,[tabindex="0"]')];
      const available = nodes.filter(node => {
        if (node.closest('[hidden],[inert]') || win.getComputedStyle(node).display === 'none') return false;
        const folded = node.closest('details:not([open])');
        return !folded || folded.querySelector('summary')?.contains(node);
      });
      if (available.length && event.shiftKey && (doc.activeElement === available[0] || doc.activeElement === view.title)) {
        event.preventDefault(); available.at(-1).focus();
      } else if (available.length && !event.shiftKey && doc.activeElement === available.at(-1)) {
        event.preventDefault(); available[0].focus();
      }
      return;
    }
    if (event.target.closest?.('textarea,input:not([type="range"]),[contenteditable]:not([contenteditable="false"]),[role="textbox"]')) return;
    if (event.altKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')
        && lessonController?.navigateStop?.(event.key === 'ArrowUp' ? 'previous' : 'next')) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    const backwards = event.key === '[' || (event.altKey && event.key === 'ArrowLeft');
    const forwards = event.key === ']' || (event.altKey && event.key === 'ArrowRight');
    if (backwards || forwards) {
      event.preventDefault();
      jumpToEvent(neighbours()[backwards ? 'previous' : 'next']);
    } else if (event.key === ' ' && !event.target.closest?.('button,input,select,[role="button"]')) {
      event.preventDefault();
      setPlaying(!playing);
    }
  }

  function hidden() {
    if (doc.hidden) stopClock();
    else if (scrub.pending) scrub.flush();
    else paint();
  }

  function motionChange() {
    field?.setReducedMotion(!!motion?.matches);
    paint();
  }

  function close() {
    if (closed) return;
    closed = true;
    stopClock();
    releaseLesson();
    field?.destroy();
    doc.removeEventListener('visibilitychange', hidden);
    win.removeEventListener('pagehide', close);
    motion?.removeEventListener?.('change', motionChange);
    const assistantFocus = assistantPanel?.release();
    if (dialog.open && typeof dialog.close === 'function') dialog.close();
    dialog.remove();
    for (const node of inertSiblings) node.removeAttribute('inert');
    const returnFocus = opener?.isConnected && !opener.closest('[hidden],[inert]') ? opener : assistantFocus;
    returnFocus?.focus({preventScroll:true});
    onClose();
  }

  dialog.addEventListener('click', click);
  dialog.addEventListener('keydown', keydown);
  dialog.addEventListener('cancel', cancel);
  dialog.addEventListener('close', close);
  view.timeline.addEventListener('pointerdown', () => { scrub.flush(); setPlaying(false); });
  view.timeline.addEventListener('input', () => rangeSeek());
  view.timeline.addEventListener('change', () => { rangeSeek(true); announceComparison(); });
  view.timeline.addEventListener('pointerup', () => rangeSeek(true));
  view.timeline.addEventListener('pointercancel', () => rangeSeek(true));
  view.speed.addEventListener('change', () => setSpeed(Number(view.speed.value)));
  doc.addEventListener('visibilitychange', hidden);
  win.addEventListener('pagehide', close);
  motion?.addEventListener?.('change', motionChange);
  doc.body.append(dialog);
  try {
    assistantPanel = mountFilmAssistant(dialog, assistant);
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else {
      dialog.setAttribute('open', '');
      dialog.setAttribute('role', 'dialog');
      dialog.setAttribute('aria-modal', 'true');
      for (const node of doc.body.children) {
        if (node === dialog || node.hasAttribute('inert')) continue;
        node.setAttribute('inert', '');
        inertSiblings.push(node);
      }
    }
    update(play, {settings, roster});
    view.title.focus({preventScroll:true});
  } catch (error) {
    close();
    throw error;
  }
  // No editor state, DOM elements or mutable model references cross the
  // public boundary. The command module serializes the current domain frame.
  const controls = {
    snapshot(options) {
      if (closed) return {open: false};
      const {previous, next} = neighbours();
      return {
        open: true, model, time, speed, theme, playing, focusIds, pendingId,
        pinnedTime: selectedPin, eventId: eventAtTime()?.id ?? null,
        previousEventId: previous?.id ?? null, nextEventId: next?.id ?? null,
        hidden: doc.hidden, reducedMotion: !!motion?.matches,
        questionMasked: dialog.hasAttribute('data-film-question'),
        renderer: field?.renderer ?? null, frame: currentFrame(), referenceFrame,
        lesson: lessonController?.snapshot(options) ?? null,
      };
    },
    seek, jumpEvent, setPlaying, setSpeed, setFocus, setPin, setTheme, close,
    lessonCommand({action, ...params}) {
      delete params.operation;
      return lessonController.execute({...params, kind: 'lesson_' + action});
    },
  };
  return {
    close, update, attachLesson, isOpen: () => !closed,
    readState: () => readFilmState(controls),
    perform: command => runFilmCommand(controls, command),
  };
}
