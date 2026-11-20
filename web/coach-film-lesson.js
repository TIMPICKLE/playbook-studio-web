import { getLocale } from './i18n.js';
import { filmLessonSource, formatFilmTime } from './coach-film-model.js';

const MAX_STOPS = 3;
const QUESTION_LIMIT = 160;
const ANSWER_LIMIT = 320;
const labels = {
  'zh-CN': {
    lesson: '课件', title: '停帧提问', empty: '把当前时刻和所选球员存为停点，最多三个。',
    add: '添加当前停点', question: '教练问题', answer: '参考答案（选填）', coveredAnswer: '参考答案（本屏隐藏输入）', keep: '收录停点', cancel: '取消',
    previous: '上一停点', next: '下一停点', revisit: '回到此帧', edit: '编辑提问', replace: '替换为当前帧',
    remove: '删除停点', reveal: '揭示答案与走势', showRoutes: '揭示走势', hide: '重新提问', save: '保存到本机', load: '加载本机课件',
    saved: '已保存此次课件。', loaded: '已加载本机课件。', missing: '这套战术还没有本机课件。',
    restoring: '正在恢复本机课件…', review: '战术已更新。请逐个选择待复核停点，调整至正确画面后点「替换为当前帧」。待复核',
    draftReview: '在编提问', keepCurrent: '按当前帧收录',
    stale: '战术布局或演练时序已变，原课件已过期。', invalid: '此课件无法读取。',
    unavailable: '暂时无法读写本机课件。', conflict: '另一窗口更新了课件，请先加载最新版本。',
    required: '请先写下教练问题。', captured: '已收录停点。', replaced: '已替换停点的时间和球员。',
    removed: '已删除停点。', seconds: ' 秒', unsaved: '有未保存的停点。',
    input: '停点的时间、球员或文字无效。', selection: '请选择已有停点。', full: '一节课最多收录三个停点。',
    unchanged: '没有需要保存的更改。', cancelled: '已取消载入课件。',
    busy: '正在读写课件，请稍后再试。', drafting: '请先收录或取消正在编辑的提问。', absent: '此战术无法使用课件。',
  },
  en: {
    lesson: 'Lesson', title: 'Freeze-frame questions', empty: 'Capture the current time and players in up to three stops.',
    add: 'Add current stop', question: 'Coach’s question', answer: 'Answer (optional)', coveredAnswer: 'Answer (input concealed on this screen)', keep: 'Keep stop', cancel: 'Cancel',
    previous: 'Previous stop', next: 'Next stop', revisit: 'Return to this frame', edit: 'Edit question', replace: 'Use current frame',
    remove: 'Remove stop', reveal: 'Reveal answer and routes', showRoutes: 'Reveal routes', hide: 'Ask again', save: 'Save on this device', load: 'Load saved lesson',
    saved: 'Lesson saved on this device.', loaded: 'Saved lesson loaded.', missing: 'No saved lesson for this play.',
    restoring: 'Restoring the saved lesson…', review: 'The play changed. Select each affected stop, find the correct frame, then choose “Use current frame”. Review',
    draftReview: 'question being edited', keepCurrent: 'Keep at current frame',
    stale: 'The play or its timing has changed. This saved lesson is out of date.', invalid: 'This lesson could not be read.',
    unavailable: 'Local lesson storage is unavailable.', conflict: 'Another window updated the lesson. Load its latest version first.',
    required: 'Enter a question for this stop.', captured: 'Stop recorded.', replaced: 'Time and players updated.',
    removed: 'Stop removed.', seconds: ' s', unsaved: 'There are unsaved stops.',
    input: 'Invalid stop time, players or text.', selection: 'Select an existing stop.', full: 'A lesson can hold up to three stops.',
    unchanged: 'There are no changes to save.', cancelled: 'Loading the lesson was cancelled.',
    busy: 'A lesson is being saved or loaded. Try again shortly.', drafting: 'Keep or cancel the question being edited first.', absent: 'Lessons are unavailable for this play.',
  },
};

async function playRevision(model) {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(filmLessonSource(model)));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

function validStops(stops, model) {
  const ids = model && new Set(model.players.map(player => player.id));
  return Array.isArray(stops) && stops.length <= MAX_STOPS && stops.every(stop =>
    stop && Number.isFinite(stop.time) && stop.time >= 0 && (!model || stop.time <= model.duration)
      && Array.isArray(stop.focusIds) && stop.focusIds.length <= 2
      && new Set(stop.focusIds).size === stop.focusIds.length && stop.focusIds.every(id => typeof id === 'string' && (!ids || ids.has(id)))
      && typeof stop.question === 'string' && !!stop.question.trim() && stop.question.length <= QUESTION_LIMIT
      && typeof stop.answer === 'string' && stop.answer.length <= ANSWER_LIMIT);
}

function lessonError(code, message, details = {}) {
  return Object.assign(new Error(message), { code, details });
}

function mountLesson(workspaceId, { host, model, read, go, onProjectionChange }) {
  const words = labels[getLocale()];
  if (model.reference) {
    const snapshot = () => ({ available: false, open: false, selectedIndex: null, revealed: false, dirty: false, busy: false, drafting: false, stops: [] });
    return {
      snapshot, dispose() {},
      async execute(action) {
        if (action?.kind === 'lesson_state') return snapshot();
        throw lessonError('LESSON_UNAVAILABLE', words.absent);
      },
    };
  }
  const doc = host.ownerDocument;
  const key = 'playbook:coach-lesson:' + JSON.stringify([workspaceId, model.play.id]);
  let currentIds = new Set(model.players.map(player => player.id));
  const scope = host.closest('.coach-film');
  const inspector = scope?.querySelector('.film-inspector');
  if (!doc.querySelector('link[data-film-lesson-css]')) {
    const link = doc.createElement('link');
    link.rel = 'stylesheet'; link.href = new URL('./coach-film-lesson.css', import.meta.url).href;
    link.dataset.filmLessonCss = '';
    doc.head.append(link);
  }
  function element(tag, text) {
    const node = doc.createElement(tag);
    if (text) node.textContent = text;
    return node;
  }
  function button(action, text, parent) {
    const node = element('button', text);
    node.type = 'button';
    node.dataset.lessonAction = action;
    node.className = 'film-control';
    parent.append(node);
    return node;
  }
  function row(parent) {
    const div = element('div');
    div.className = 'film-lesson-row';
    parent.append(div);
    return div;
  }
  const panel = element('section');
  panel.id = 'film-lesson-panel';
  panel.className = 'film-lesson';
  panel.setAttribute('aria-label', words.title);
  panel.hidden = true;
  if (inspector) inspector.prepend(panel); else host.after(panel);
  const trigger = button('toggle', words.lesson, host);
  host.prepend(trigger);
  trigger.setAttribute('aria-controls', panel.id);
  trigger.setAttribute('aria-expanded', 'false');
  const heading = element('h3', words.title);
  heading.tabIndex = -1;
  const empty = element('p', words.empty);
  panel.append(heading, empty);
  const nav = row(panel);
  const stopsNav = Array.from({ length: MAX_STOPS }, (_, index) => button('stop-' + index, '', nav));
  const question = element('p'), answer = element('p');
  question.className = 'film-lesson-question';
  answer.className = 'film-lesson-answer';
  panel.append(question, answer);
  const presentation = row(panel);
  const previous = button('previous', words.previous, presentation);
  const next = button('next', words.next, presentation);
  for (const [control, shortcut] of [[previous, 'Alt+ArrowUp'], [next, 'Alt+ArrowDown']]) {
    control.setAttribute('aria-keyshortcuts', shortcut);
    control.title = control.textContent + ' (' + shortcut + ')';
  }
  button('revisit', words.revisit, presentation);
  const reveal = button('reveal', words.reveal, presentation);
  const editing = row(panel);
  const add = button('add', words.add, editing);
  const edit = button('edit', words.edit, editing);
  const replace = button('replace', words.replace, editing);
  const remove = button('remove', words.remove, editing);
  const form = element('form');
  form.className = 'film-lesson-form';
  panel.append(form);
  function textInput(name, title, limit) {
    const label = element('label', title), input = element('textarea');
    input.name = name; input.maxLength = limit; input.rows = 2;
    label.append(input); form.append(label); return input;
  }
  const questionInput = textInput('question', words.question, QUESTION_LIMIT);
  const answerInput = textInput('answer', words.answer, ANSWER_LIMIT);
  const coveredAnswer = element('input');
  coveredAnswer.type = 'password'; coveredAnswer.maxLength = ANSWER_LIMIT;
  coveredAnswer.name = 'answer'; coveredAnswer.placeholder = words.coveredAnswer;
  coveredAnswer.setAttribute('aria-label', words.coveredAnswer);
  coveredAnswer.autocomplete = 'off'; coveredAnswer.hidden = true;
  answerInput.after(coveredAnswer);
  const formActions = row(form);
  const keep = button('keep', words.keep, formActions);
  keep.type = 'submit';
  button('cancel', words.cancel, formActions);
  const fileActions = row(panel);
  const save = button('save', words.save, fileActions);
  const load = button('load', words.load, fileActions);
  const notice = element('p');
  notice.className = 'film-lesson-status';
  notice.setAttribute('role', 'status');
  panel.append(notice);
  const reviewNotice = element('p');
  reviewNotice.className = 'film-lesson-review';
  reviewNotice.setAttribute('role', 'status');
  panel.append(reviewNotice);

  let stops = [], selected = -1, draft = null, revealed = false, dirty = false, busy = false, alive = true;
  let signature, baseRaw = null, loadRevision = 0, needsRestore = false, restoring = null;
  try { needsRestore = doc.defaultView.localStorage.getItem(key) !== null; } catch { /* in-memory teaching remains usable */ }
  const formatTime = time => formatFilmTime(time, true) + words.seconds;
  const status = message => { notice.textContent = message; };
  const activeAnswerInput = () => coveredAnswer.hidden ? answerInput : coveredAnswer;
  function draftAnswer() {
    // A native password field conceals text but flattens line breaks. Preserve
    // the authored answer exactly when only the question was edited.
    if (!coveredAnswer.hidden && draft.answer.replace(/[\r\n]/g, '') === coveredAnswer.value) return draft.answer;
    return activeAnswerInput().value.trim().slice(0, ANSWER_LIMIT);
  }
  function revise(nextModel) {
    model = nextModel;
    currentIds = new Set(model.players.map(player => player.id));
    signature = null;
    for (const stop of stops) stop.needsReview = true;
    if (draft) draft.needsReview = true;
    if (stops.length) dirty = true;
    revealed = false;
    status('');
    update();
  }
  function syncProjection() {
    const masked = !panel.hidden && (draft ? draft.coverAnswer : !!stops[selected] && !revealed);
    scope?.toggleAttribute('data-film-question', !!masked);
    onProjectionChange?.(!!masked, !panel.hidden);
  }
  function update() {
    const stop = stops[selected];
    const pending = stops.flatMap((item, i) => item.needsReview ? [i + 1] : []);
    if (draft?.needsReview) pending.push(words.draftReview);
    reviewNotice.hidden = !pending.length;
    reviewNotice.textContent = pending.length ? words.review + ' · ' + pending.join(', ') : '';
    keep.textContent = draft?.needsReview && draft.isNew ? words.keepCurrent : words.keep;
    syncProjection();
    empty.hidden = !!stops.length || !!draft;
    nav.hidden = !stops.length || !!draft;
    stopsNav.forEach((control, i) => {
      control.hidden = !stops[i];
      if (!stops[i]) return;
      control.textContent = (i + 1) + ' · ' + formatTime(stops[i].time);
      control.setAttribute('aria-pressed', String(i === selected));
    });
    question.textContent = stop?.question || '';
    answer.textContent = revealed ? stop?.answer || '' : '';
    question.hidden = !stop || !!draft;
    answer.hidden = !revealed || !stop?.answer || !!draft;
    presentation.hidden = !stop || !!draft;
    reveal.textContent = revealed ? words.hide : stop?.answer ? words.reveal : words.showRoutes;
    reveal.setAttribute('aria-expanded', String(revealed));
    reveal.disabled = !!stop?.needsReview;
    previous.disabled = selected < 1;
    next.disabled = selected + 1 >= stops.length;
    editing.hidden = !!draft;
    add.disabled = busy || stops.length >= MAX_STOPS;
    edit.hidden = replace.hidden = remove.hidden = !stop;
    form.hidden = !draft;
    fileActions.hidden = !!draft;
    save.disabled = busy || !dirty || !!pending.length;
    load.disabled = busy;
  }
  function snapshot({ includeAnswers = false } = {}) {
    return {
      available: alive, open: !panel.hidden, selectedIndex: selected < 0 ? null : selected,
      revealed, dirty, busy, drafting: !!draft,
      ...(needsRestore ? {restorePending: true} : {}),
      ...(draft?.needsReview ? {draftNeedsReview: true} : {}),
      stops: stops.map((stop, index) => ({
        time: stop.time, focusIds: [...stop.focusIds], question: stop.question, hasAnswer: !!stop.answer,
        ...(stop.needsReview ? {needsReview: true} : {}),
        ...(includeAnswers || (index === selected && revealed) ? { answer: stop.answer } : {}),
      })),
    };
  }
  function capture(action) {
    const current = read();
    const time = action.time === undefined ? current.time : action.time;
    const ids = action.focusIds === undefined ? current.focusIds : action.focusIds;
    if (!Number.isFinite(time) || time < 0 || time > model.duration) {
      throw lessonError('LESSON_INVALID_INPUT', words.input, { field: 'time', min: 0, max: model.duration });
    }
    if (!Array.isArray(ids) || ids.length > 2 || new Set(ids).size !== ids.length || ids.some(id => !currentIds.has(id))) {
      throw lessonError('LESSON_INVALID_INPUT', words.input, { field: 'focusIds', max: 2 });
    }
    return { time, focusIds: [...ids] };
  }
  function textValue(value, field) {
    const limit = field === 'question' ? QUESTION_LIMIT : ANSWER_LIMIT;
    if (typeof value !== 'string' || value.trim().length > limit) {
      throw lessonError('LESSON_INVALID_INPUT', words.input, { field, maxLength: limit });
    }
    const result = value.trim();
    if (field === 'question' && !result) throw lessonError('LESSON_INVALID_INPUT', words.required, { field });
    return result;
  }
  function indexOfStop(value) {
    if (!Number.isInteger(value) || value < 0 || value >= stops.length) {
      throw lessonError('LESSON_SELECTION', words.selection, { index: value ?? null, count: stops.length });
    }
    return value;
  }
  function showStop(index, showAnswer = false) {
    selected = index; revealed = showAnswer;
    syncProjection();
    const stop = stops[index];
    if (stop && !stop.needsReview) go(stop.time, [...stop.focusIds]);
  }
  function closeForm() {
    draft = null;
    questionInput.value = ''; answerInput.value = ''; coveredAnswer.value = '';
    answerInput.hidden = false; coveredAnswer.hidden = true;
  }
  function setOpen(open) {
    panel.hidden = !open;
    trigger.setAttribute('aria-expanded', String(open));
    if (open && inspector) inspector.scrollTop = 0;
    if (!open) { closeForm(); revealed = false; }
  }
  function openForm(isNew) {
    if (busy || (isNew && stops.length >= MAX_STOPS)) return;
    const coverAnswer = isNew || !revealed;
    draft = isNew ? { ...capture({}), question: '', answer: '', index: stops.length, isNew } : { ...stops[selected], index: selected, isNew };
    draft.coverAnswer = coverAnswer;
    syncProjection();
    if (!draft.needsReview) go(draft.time, [...draft.focusIds]);
    questionInput.value = draft.question;
    answerInput.hidden = coverAnswer; coveredAnswer.hidden = !coverAnswer;
    activeAnswerInput().value = draft.answer;
    revealed = false;
    status('');
    update();
    questionInput.focus();
  }
  async function persist(kind) {
    const requestedRevision = loadRevision;
    const source = model;
    const guard = () => {
      if (!alive) throw lessonError('LESSON_DISPOSED', words.absent);
      if (source !== model) throw lessonError('LESSON_STALE', words.stale);
      if (kind !== 'lesson_save' && loadRevision !== requestedRevision) throw lessonError('LESSON_CANCELLED', words.cancelled);
    };
    busy = true; update();
    try {
      signature ??= playRevision(model);
      const revision = await signature;
      guard();
      const storage = doc.defaultView.localStorage;
      if (kind === 'lesson_save') {
        const commit = () => {
          guard();
          if (storage.getItem(key) !== baseRaw) throw lessonError('LESSON_CONFLICT', words.conflict);
          if (stops.some(stop => stop.needsReview)) throw lessonError('LESSON_STALE', reviewNotice.textContent);
          if (!dirty) { status(words.unchanged); return; }
          const nextRaw = JSON.stringify({ version: 1, revision, stops });
          storage.setItem(key, nextRaw);
          baseRaw = nextRaw; dirty = false; status(words.saved);
        };
        const locks = doc.defaultView.navigator.locks;
        if (locks?.request) await locks.request(key, commit);
        else commit();
      } else {
        const raw = storage.getItem(key);
        if (raw === null) {
          needsRestore = false;
          if (kind === 'resume') return;
          baseRaw = null;
          throw lessonError('LESSON_NOT_FOUND', words.missing);
        }
        let data;
        try { data = JSON.parse(raw); } catch { throw lessonError('LESSON_INVALID_DATA', words.invalid); }
        if (data?.version !== 1 || typeof data.revision !== 'string') throw lessonError('LESSON_INVALID_DATA', words.invalid);
        const stale = data.revision !== revision;
        if (stale && kind === 'lesson_load') throw lessonError('LESSON_STALE', words.stale);
        if (!validStops(data.stops, stale ? null : model)) throw lessonError('LESSON_INVALID_DATA', words.invalid);
        // Only a record actually reconciled with the in-memory lesson is a save baseline.
        baseRaw = raw; needsRestore = false;
        stops = data.stops.map(({time, focusIds, question, answer}) => ({time, focusIds, question, answer, ...(stale ? {needsReview:true} : {})}));
        dirty = false; selected = stops.length ? 0 : -1; revealed = false;
        if (kind === 'lesson_load') { setOpen(true); showStop(selected); }
        status(stale ? words.stale : words.loaded);
      }
    } catch (error) {
      if (error.code?.startsWith?.('LESSON_')) throw error;
      signature = null;
      throw lessonError('LESSON_STORAGE', words.unavailable);
    } finally {
      busy = false; if (alive) update();
    }
  }

  async function perform(action, fromForm = false) {
    const kind = action?.kind;
    try {
      if (!alive) throw lessonError('LESSON_DISPOSED', words.absent);
      const opening = kind === 'lesson_open' && panel.hidden;
      if (opening) setOpen(true);
      if (kind !== 'lesson_close' && (restoring || (needsRestore && kind !== 'lesson_load'))) {
        const request = loadRevision;
        if (!restoring) {
          status(words.restoring);
          restoring = persist('resume').finally(() => { restoring = null; });
        }
        await restoring;
        if (!alive) throw lessonError('LESSON_DISPOSED', words.absent);
        if (request !== loadRevision) throw lessonError('LESSON_CANCELLED', words.cancelled);
      }
      if (kind === 'lesson_state') return snapshot({ includeAnswers: action.includeAnswers === true });
      if (busy && kind !== 'lesson_close') throw lessonError('LESSON_BUSY', words.busy);
      if (draft && !fromForm && !['lesson_open', 'lesson_close', 'lesson_cancel'].includes(kind)) {
        throw lessonError('LESSON_DRAFT', words.drafting);
      }
      switch (kind) {
        case 'lesson_open': {
          if (opening && selected >= 0) showStop(selected);
          break;
        }
        case 'lesson_close': loadRevision++; setOpen(false); break;
        case 'lesson_cancel': closeForm(); break;
        case 'lesson_add': {
          if (stops.length >= MAX_STOPS) throw lessonError('LESSON_FULL', words.full, { max: MAX_STOPS });
          const stop = { ...capture(action), question: textValue(action.question, 'question'), answer: textValue(action.answer === undefined ? '' : action.answer, 'answer') };
          closeForm(); setOpen(true); stops.push(stop); showStop(stops.length - 1);
          dirty = true; status(words.captured + ' ' + words.unsaved);
          break;
        }
        case 'lesson_update': {
          const index = indexOfStop(action.index === undefined ? selected : action.index);
          if (action.question === undefined && action.answer === undefined) throw lessonError('LESSON_INVALID_INPUT', words.input, { fields: ['question','answer'] });
          const prior = stops[index];
          const question = action.question === undefined ? prior.question : textValue(action.question, 'question');
          const answer = action.answer === undefined ? prior.answer : textValue(action.answer, 'answer');
          closeForm(); setOpen(true); stops[index] = { ...prior, question, answer }; showStop(index);
          dirty = true; status(words.captured + ' ' + words.unsaved);
          break;
        }
        case 'lesson_replace': {
          const index = indexOfStop(action.index === undefined ? selected : action.index);
          const frame = capture(action);
          const {question, answer} = stops[index];
          setOpen(true); stops[index] = { question, answer, ...frame }; showStop(index);
          dirty = true; status(words.replaced + ' ' + words.unsaved);
          break;
        }
        case 'lesson_remove': {
          const index = indexOfStop(action.index === undefined ? selected : action.index);
          stops.splice(index, 1);
          const nextIndex = index < selected ? selected - 1 : Math.min(selected, stops.length - 1);
          setOpen(true); showStop(nextIndex);
          dirty = true; status(words.removed + ' ' + words.unsaved);
          break;
        }
        case 'lesson_select': case 'lesson_revisit': case 'lesson_previous': case 'lesson_next': {
          let value = action.index === undefined && kind !== 'lesson_select' ? selected : action.index;
          if (kind === 'lesson_previous') value = selected - 1;
          if (kind === 'lesson_next') value = selected + 1;
          const index = indexOfStop(value);
          setOpen(true); showStop(index);
          break;
        }
        case 'lesson_reveal': case 'lesson_hide': {
          const index = indexOfStop(action.index === undefined ? selected : action.index);
          if (kind === 'lesson_reveal' && stops[index].needsReview) throw lessonError('LESSON_STALE', reviewNotice.textContent);
          setOpen(true);
          showStop(index, kind === 'lesson_reveal');
          break;
        }
        case 'lesson_save': case 'lesson_load': await persist(kind); break;
        default: throw lessonError('LESSON_INVALID_ACTION', words.input, { kind: kind ?? null });
      }
      update();
      return snapshot();
    } catch (error) {
      if (alive) status(error.message);
      throw error;
    }
  }
  const execute = action => perform(action);
  const dispatch = (kind, args = {}) => execute({ kind: 'lesson_' + kind, ...args }).catch(() => {});
  function dismiss() {
    if (panel.hidden) return false;
    if (draft) {
      const opener = draft.isNew ? add : edit;
      void dispatch('cancel');
      opener.focus({ preventScroll: true });
    } else {
      void dispatch('close');
      trigger.focus({ preventScroll: true });
    }
    return true;
  }
  function navigateStop(direction) {
    if (panel.hidden || draft || busy) return false;
    const control = direction === 'previous' ? previous : next;
    if (!control.disabled) void dispatch(direction);
    return true;
  }
  trigger.addEventListener('click', () => {
    if (panel.hidden) {
      void dispatch('open');
      heading.focus({ preventScroll: true });
    } else void dispatch('close');
  });
  panel.addEventListener('click', event => {
    const action = event.target.closest('button')?.dataset.lessonAction;
    if (!action || action === 'keep') return;
    if (action.startsWith('stop-')) { void dispatch('select', { index: Number(action.slice(5)) }); return; }
    switch (action) {
      case 'add': case 'edit': openForm(action === 'add'); break;
      case 'reveal': void dispatch(revealed ? 'hide' : 'reveal'); break;
      case 'cancel': dismiss(); break;
      case 'remove': void dispatch(action); (selected >= 0 ? stopsNav[selected] : add).focus(); break;
      default: void dispatch(action);
    }
  });
  form.addEventListener('submit', event => {
    event.preventDefault();
    if (!draft) return;
    const { isNew, index } = draft;
    const { time, focusIds } = isNew && draft.needsReview ? read() : draft;
    const input = {
      kind: isNew ? 'lesson_add' : 'lesson_update', index, time, focusIds,
      question: questionInput.value.trim().slice(0, QUESTION_LIMIT),
      answer: draftAnswer(),
    };
    void perform(input, true).then(() => {
      if (alive && !draft && !panel.hidden && selected === index && (form.contains(doc.activeElement) || doc.activeElement === doc.body)) {
        stopsNav[index].focus();
      }
    }, () => { if (alive && draft && form.contains(doc.activeElement)) questionInput.focus(); });
  });
  update();
  function dispose() {
    alive = false; setOpen(false); syncProjection(); trigger.remove(); panel.remove();
  }
  return { dispose, snapshot, execute, dismiss, navigateStop, revise };
}

export function createFilmLesson({ workspaceId }) {
  return { mount: options => mountLesson(workspaceId, options) };
}
