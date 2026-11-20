// Keep input acquisition independent of repaint. One observer records the most
// recent matching field commit and one rAF probe records what a callback sees.
export async function sampleDrag(range, pitch, {native = false, count = 32, periodMs = 8} = {}) {
  const doc = range.ownerDocument, win = doc.defaultView;
  const now = () => win.performance.now();
  const raw = {pointerType:null, trusted:null, downAtMs:null, upAtMs:null, moves:[], inputs:[]};
  let pointerId, nextFrame, timer, finish, fail, latest, released = false;
  const complete = new Promise((resolve,reject) => { finish = resolve; fail = reject; });
  const cleanup = new win.AbortController();
  const listen = (node,type,handler) => node.addEventListener(type,handler,{capture:true,signal:cleanup.signal});
  const sameTime = (a,b) => Math.abs(a-b) <= 1e-6;
  const markerTime = () => Number(pitch.dataset.filmTime);

  function observe(atFrame) {
    const time = markerTime();
    const sample = raw.inputs.findLast(input => sameTime(input.time,time));
    if (!sample) return;
    const stamp = now();
    sample.commitAtMs ??= stamp;
    if (atFrame) sample.rafAtMs ??= stamp;
    if (atFrame && released && latest === sample && sameTime(Number(range.value),sample.time)) finish();
  }
  function onFrame() {
    nextFrame = null;
    observe(true);
    if (latest && latest.rafAtMs == null) nextFrame = win.requestAnimationFrame(onFrame);
  }
  function scheduleObservation() {
    if (nextFrame == null) nextFrame = win.requestAnimationFrame(onFrame);
  }
  listen(range,'pointerdown',event => {
    if (pointerId != null || (native && !event.isTrusted)) return;
    pointerId = event.pointerId;
    raw.trusted = event.isTrusted === true;
    raw.pointerType = event.pointerType;
    raw.downAtMs = event.timeStamp;
  });
  listen(win,'pointermove',event => {
    if (!released && event.pointerId === pointerId && event.buttons) {
      raw.moves.push({atMs:event.timeStamp,x:event.clientX,y:event.clientY});
    }
  });
  listen(range,'input',event => {
    if (pointerId == null || (native && !event.isTrusted)) return;
    latest = {time:Number(range.value),atMs:event.timeStamp,commitAtMs:null,rafAtMs:null};
    raw.inputs.push(latest);
    if (sameTime(markerTime(),latest.time)) latest.commitAtMs = now();
    scheduleObservation();
  });
  listen(win,'pointerup',event => {
    if (event.pointerId !== pointerId) return;
    released = true;
    raw.upAtMs = event.timeStamp;
    if (raw.moves.length < 2 || new Set(raw.inputs.map(input => input.time)).size < 3) {
      fail(Error('Keep the pointer held and drag the timeline across at least three different values.'));
      return;
    }
    // A final value can already have been committed while the pointer was held.
    scheduleObservation();
  });
  listen(win,'pointercancel',event => { if (event.pointerId === pointerId) fail(Error('Pointer drag was cancelled.')); });
  listen(doc,'visibilitychange',() => { if (doc.hidden) fail(Error('Tab hidden during the drag. Repeat in the foreground.')); });
  const observer = new win.MutationObserver(() => observe(false));
  observer.observe(pitch,{attributes:true,attributeFilter:['data-film-time']});
  const deadline = win.setTimeout(() => fail(Error('Timed out waiting for a complete drag and its final field value.')),native ? 120000 : 15000);
  try {
    if (!native) {
      const rect = range.getBoundingClientRect();
      const min = Number(range.min), max = Number(range.max);
      function dispatch(type, value) {
        range.dispatchEvent(new win.PointerEvent(type,{bubbles:true,pointerId:1,pointerType:'mouse',isPrimary:true,
          buttons:type==='pointerup' ? 0 : 1, clientX:rect.left+rect.width*(value-min)/(max-min),clientY:rect.top+rect.height/2}));
      }
      dispatch('pointerdown',Number(range.value));
      let index = 0;
      function move() {
        // Untrusted pointer events do not make the browser move a range thumb.
        // Drive its value explicitly and label this gesture as scripted in the report.
        const value = min + (max-min) * (.09 + .79 * index/(count-1));
        dispatch('pointermove',value);
        range.value = value.toFixed(2);
        range.dispatchEvent(new win.Event('input',{bubbles:true}));
        if (++index < count) timer = win.setTimeout(move,periodMs);
        else {
          dispatch('pointerup',Number(range.value));
          range.dispatchEvent(new win.Event('change',{bubbles:true}));
        }
      }
      move();
    }
    await complete;
    if (!sameTime(markerTime(),latest.time) || !sameTime(Number(range.value),latest.time)) {
      throw Error('The final pointer value and the field disagree.');
    }
    return {source:native?'native-pointer':'scripted-pointer-and-range', ...raw};
  } finally {
    cleanup.abort();
    observer.disconnect();
    win.clearTimeout(deadline);
    win.clearTimeout(timer);
    if (nextFrame != null) win.cancelAnimationFrame(nextFrame);
  }
}

export function dragSummary(raw, stats) {
  const commits = raw.inputs.filter(sample => sample.commitAtMs != null);
  const observed = raw.inputs.filter(sample => sample.rafAtMs != null);
  const last = raw.inputs.at(-1);
  return {source:raw.source,trusted:raw.trusted,pointerType:raw.pointerType,moveCount:raw.moves.length,
    inputCount:raw.inputs.length,fieldCommitCount:commits.length,rafObservedCount:observed.length,
    inputToFieldCommitMs:stats(commits.map(sample => sample.commitAtMs-sample.atMs)),
    inputToMatchingRafMs:stats(observed.map(sample => sample.rafAtMs-sample.atMs)),
    final:{time:last.time,inputToFieldCommitMs:last.commitAtMs-last.atMs,inputToMatchingRafMs:last.rafAtMs-last.atMs}};
}
