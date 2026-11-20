import { getLocale } from './i18n.js';
import { formatFilmTime } from './coach-film-model.js';

const MAX_STOPS = 3;
const QUESTION_LIMIT = 160;
const ANSWER_LIMIT = 320;
const labels = {
  'zh-CN': {
    lesson: '课件', title: '停帧提问', empty: '把当前时刻和所选球员存为停点，最多三个。',
    add: '添加当前停点', question: '教练问题', answer: '参考答案（选填）', keep: '收录停点', cancel: '取消',
    previous: '上一停点', next: '下一停点', revisit: '回到此帧', edit: '编辑提问', replace: '替换为当前帧',
    remove: '删除停点', reveal: '揭示答案与走势', showRoutes: '揭示走势', hide: '重新提问', save: '保存到本机', load: '加载本机课件',
    saved: '已保存此次课件。', loaded: '已加载本机课件。', missing: '这套战术还没有本机课件。',
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
    add: 'Add current stop', question: 'Coach’s question', answer: 'Answer (optional)', keep: 'Keep stop', cancel: 'Cancel',
    previous: 'Previous stop', next: 'Next stop', revisit: 'Return to this frame', edit: 'Edit question', replace: 'Use current frame',
    remove: 'Remove stop', reveal: 'Reveal answer and routes', showRoutes: 'Reveal routes', hide: 'Ask again', save: 'Save on this device', load: 'Load saved lesson',
    saved: 'Lesson saved on this device.', loaded: 'Saved lesson loaded.', missing: 'No saved lesson for this play.',
    stale: 'The play or its timing has changed. This saved lesson is out of date.', invalid: 'This lesson could not be read.',
    unavailable: 'Local lesson storage is unavailable.', conflict: 'Another window updated the lesson. Load its latest version first.',
    required: 'Enter a question for this stop.', captured: 'Stop recorded.', replaced: 'Time and players updated.',
    removed: 'Stop removed.', seconds: ' s', unsaved: 'There are unsaved stops.',
    input: 'Invalid stop time, players or text.', selection: 'Select an existing stop.', full: 'A lesson can hold up to three stops.',
    unchanged: 'There are no changes to save.', cancelled: 'Loading the lesson was cancelled.',
    busy: 'A lesson is being saved or loaded. Try again shortly.', drafting: 'Keep or cancel the question being edited first.', absent: 'Lessons are unavailable for this play.',
  },
};

// Ignore unrelated notes, cosmetic changes and object key insertion order.
// Positions, route timing, assignments and ball events must still match.
async function playRevision(model) {
  const { play } = model;
  const actors = play.players.map(p => [p.id, p.label, p.rosterId || '', p.side, p.x, p.y]);
  const paths = play.routes.map(r => [r.id, r.playerId, r.kind, r.delay, r.duration, !!r.optional, !!r.smooth,
    r.endCap, !!r.stagedBlock, r.blockTargets || [], r.points.map(p => [p.x, p.y])]);
  const zones = (play.zones || []).map(z => [z.id, z.label, z.x, z.y, z.rx, z.ry]);
  const marks = (play.annotations || []).map(a => [a.id, a.text, a.x, a.y]);
  const { holderId, receiverId, passAt, arriveAt } = play.ball;
  const data = [play.book, play.formation, model.calibrated, actors, paths, zones, marks, [holderId, receiverId, passAt, arriveAt]];
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(data)));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

function validStops(stops, model) {
  const ids = new Set(model.players.map(player => player.id));
  return Array.isArray(stops) && stops.length <= MAX_STOPS && stops.every(stop =>
    stop && Number.isFinite(stop.time) && stop.time >= 0 && stop.time <= model.duration
      && Array.isArray(stop.focusIds) && stop.focusIds.length <= 2
      && new Set(stop.focusIds).size === stop.focusIds.length && stop.focusIds.every(id => ids.has(id))
      && typeof stop.question === 'string' && !!stop.question.trim() && stop.question.length <= QUESTION_LIMIT
      && typeof stop.answer === 'string' && stop.answer.length <= ANSWER_LIMIT);
}

function lessonError(code, message, details = {}) {
  return Object.assign(new Error(message), { code, details });
}

function mountLesson(workspaceId, { host, model, read, go }) {
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
  const currentIds = new Set(model.players.map(player => player.id));
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

  let stops = [], selected = -1, draft = null, revealed = false, dirty = false, busy = false, alive = true;
  let signature, baseRaw, loadRevision = 0;
  try { baseRaw = doc.defaultView.localStorage.getItem(key); } catch { /* in-memory teaching remains usable */ }
  const formatTime = time => formatFilmTime(time, true) + words.seconds;
  const status = message => { notice.textContent = message; };
  function update() {
    const stop = stops[selected];
    scope?.toggleAttribute('data-film-question', !panel.hidden && !!stop && !draft && !revealed);
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
    previous.disabled = selected < 1;
    next.disabled = selected + 1 >= stops.length;
    editing.hidden = !!draft;
    add.disabled = stops.length >= MAX_STOPS;
    edit.hidden = replace.hidden = remove.hidden = !stop;
    form.hidden = !draft;
    fileActions.hidden = !!draft;
    save.disabled = busy || !dirty;
    load.disabled = busy;
  }
  function snapshot({ includeAnswers = false } = {}) {
    return {
      available: alive, open: !panel.hidden, selectedIndex: selected < 0 ? null : selected,
      revealed, dirty, busy, drafting: !!draft,
      stops: stops.map((stop, index) => ({
        time: stop.time, focusIds: [...stop.focusIds], question: stop.question, hasAnswer: !!stop.answer,
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
  function showStop(index) {
    selected = index; revealed = false;
    const stop = stops[index];
    if (stop) go(stop.time, [...stop.focusIds]);
  }
  function closeForm() {
    draft = null;
    questionInput.value = ''; answerInput.value = '';
  }
  function setOpen(open) {
    panel.hidden = !open;
    trigger.setAttribute('aria-expanded', String(open));
    if (open && inspector) inspector.scrollTop = 0;
    if (!open) { closeForm(); revealed = false; }
  }
  function openForm(isNew) {
    if (busy || (isNew && stops.length >= MAX_STOPS)) return;
    draft = isNew ? { ...capture({}), question: '', answer: '', index: stops.length, isNew } : { ...stops[selected], index: selected, isNew };
    go(draft.time, [...draft.focusIds]);
    questionInput.value = draft.question;
    answerInput.value = draft.answer;
    revealed = false;
    status('');
    update();
    questionInput.focus();
  }
  async function persist(kind) {
    const requestedRevision = loadRevision;
    busy = true; update();
    try {
      signature ??= playRevision(model);
      const revision = await signature;
      if (!alive) throw lessonError('LESSON_DISPOSED', words.absent);
      if (kind === 'lesson_load' && loadRevision !== requestedRevision) throw lessonError('LESSON_CANCELLED', words.cancelled);
      const storage = doc.defaultView.localStorage;
      const raw = storage.getItem(key);
      if (kind === 'lesson_save') {
        if (raw !== (baseRaw ?? null)) throw lessonError('LESSON_CONFLICT', words.conflict);
        if (!dirty) { status(words.unchanged); return; }
        const nextRaw = JSON.stringify({ version: 1, revision, stops });
        storage.setItem(key, nextRaw);
        baseRaw = nextRaw; dirty = false; status(words.saved);
      } else {
        if (raw === null) { baseRaw = null; throw lessonError('LESSON_NOT_FOUND', words.missing); }
        let data;
        try { data = JSON.parse(raw); } catch { throw lessonError('LESSON_INVALID_DATA', words.invalid); }
        if (data?.version !== 1) throw lessonError('LESSON_INVALID_DATA', words.invalid);
        if (data.revision !== revision) { baseRaw = raw; throw lessonError('LESSON_STALE', words.stale); }
        if (!validStops(data.stops, model)) throw lessonError('LESSON_INVALID_DATA', words.invalid);
        baseRaw = raw; stops = data.stops.map(({time, focusIds, question, answer}) => ({time, focusIds, question, answer}));
        dirty = false; setOpen(true); showStop(stops.length ? 0 : -1); status(words.loaded);
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
      if (kind === 'lesson_state') return snapshot({ includeAnswers: action.includeAnswers === true });
      if (busy && kind !== 'lesson_close') throw lessonError('LESSON_BUSY', words.busy);
      if (draft && !fromForm && !['lesson_open', 'lesson_close', 'lesson_cancel'].includes(kind)) {
        throw lessonError('LESSON_DRAFT', words.drafting);
      }
      switch (kind) {
        case 'lesson_open': {
          if (panel.hidden) { setOpen(true); if (selected >= 0) showStop(selected); }
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
          setOpen(true); stops[index] = { ...stops[index], ...frame }; showStop(index);
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
          setOpen(true);
          showStop(index);
          revealed = kind === 'lesson_reveal';
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
      case 'cancel': void dispatch(action); (selected >= 0 ? edit : add).focus(); break;
      case 'remove': void dispatch(action); (selected >= 0 ? stopsNav[selected] : add).focus(); break;
      default: void dispatch(action);
    }
  });
  form.addEventListener('submit', event => {
    event.preventDefault();
    if (!draft) return;
    const { isNew, index, time, focusIds } = draft;
    const input = {
      kind: isNew ? 'lesson_add' : 'lesson_update', index, time, focusIds,
      question: questionInput.value.trim().slice(0, QUESTION_LIMIT), answer: answerInput.value.trim().slice(0, ANSWER_LIMIT),
    };
    void perform(input, true).then(() => stopsNav[index].focus(), () => questionInput.focus());
  });
  panel.addEventListener('keydown', event => {
    if (event.target.matches('textarea')) { event.stopPropagation(); return; }
    if (!draft && event.altKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
      event.preventDefault(); event.stopPropagation();
      void dispatch(event.key === 'ArrowUp' ? 'previous' : 'next');
    }
  });
  update();
  function dispose() {
    alive = false; setOpen(false); scope?.removeAttribute('data-film-question'); trigger.remove(); panel.remove();
  }
  return { dispose, snapshot, execute };
}

export function createFilmLesson({ workspaceId }) {
  return { mount: options => mountLesson(workspaceId, options) };
}
