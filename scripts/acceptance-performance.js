// Development acceptance only. Read-only instrumentation: no app state is injected.
export function sampleFrames(win, { durationMs = 1600, onFinish } = {}) {
  const frames = [], tasks = [], started = win.performance.now();
  let frame, timer, previous, stopped = false, observer, result;
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  try {
    observer = new win.PerformanceObserver(list => {
      for (const task of list.getEntries()) if (task.startTime >= started) tasks.push({ start: task.startTime - started, duration: task.duration });
    });
    observer.observe({ type: 'longtask', buffered: false });
  } catch { observer?.disconnect(); observer = undefined; }
  function tick(time) {
    if (previous !== undefined) frames.push(time - previous);
    previous = time;
    frame = win.requestAnimationFrame(tick);
  }
  function finish() {
    if (stopped) return result;
    stopped = true;
    win.cancelAnimationFrame(frame); win.clearTimeout(timer);
    if (observer) for (const task of observer.takeRecords()) if (task.startTime >= started) tasks.push({ start: task.startTime - started, duration: task.duration });
    observer?.disconnect();
    const sorted = frames.slice().sort((a,b) => a-b);
    const percentile = p => sorted.length ? sorted[Math.min(sorted.length-1,Math.ceil(sorted.length*p)-1)] : null;
    result = {
      environment: 'Current browser / iframe; not a physical-device benchmark',
      durationMs: win.performance.now() - started, frameIntervals: frames.length,
      frameIntervalMedianMs: percentile(.5), frameIntervalP95Ms: percentile(.95),
      frameIntervalMaxMs: sorted.at(-1) ?? null,
      intervalsOver50Ms: frames.filter(value => value > 50).length,
      longTaskSupported: !!observer, longTasks: tasks.length,
      longTaskMaxMs: tasks.length ? Math.max(...tasks.map(value => value.duration)) : 0,
      viewport: { width: win.innerWidth, height: win.innerHeight },
      players: win.document.querySelectorAll('#field [data-player]').length,
      routes: win.document.querySelectorAll('#field [data-route]').length,
      visible: win.document.visibilityState === 'visible',
      validation: frames.length >= 10 ? 'sampled' : 'insufficient-samples',
    };
    resolve(result); onFinish?.(result); return result;
  }
  frame = win.requestAnimationFrame(tick);
  timer = win.setTimeout(finish, durationMs);
  return { promise, finish };
}

export function armFieldDragSample(win, { timeoutMs = 20000, onState } = {}) {
  // A real pointer gesture in the board starts the sample. Merely clicking Arm
  // cannot be reported as a drag benchmark, nor can a missing gesture pass.
  return new Promise(resolve => {
    let sample, timer, complete = false, origin, moved = false;
    const cleanup = () => {
      win.clearTimeout(timer);
      win.document.removeEventListener('pointerdown', down, true);
      win.document.removeEventListener('pointermove', move, true);
      win.document.removeEventListener('pointerup', up, true);
      win.document.removeEventListener('pointercancel', cancel, true);
    };
    const done = result => { if (complete) return; complete = true; cleanup(); onState?.(result.validation); resolve(result); };
    function down(event) {
      if (sample || !event.target.closest?.('#field')) return;
      origin={ x:event.clientX, y:event.clientY };
      onState?.('recording'); sample = sampleFrames(win, { durationMs: timeoutMs });
    }
    function move(event) {
      if (sample && Math.hypot(event.clientX-origin.x,event.clientY-origin.y)>=3) moved=true;
    }
    function up() {
      if (!sample) return;
      win.requestAnimationFrame(() => win.requestAnimationFrame(() => {
        const result=sample.finish();
        done(moved ? result : {...result,validation:'not-run',reason:'The board gesture was a tap, not a drag'});
      }));
    }
    function cancel() {
      if (sample) { sample.finish(); done({ validation: 'canceled' }); }
    }
    win.document.addEventListener('pointerdown', down, true);
    win.document.addEventListener('pointermove', move, true);
    win.document.addEventListener('pointerup', up, true);
    win.document.addEventListener('pointercancel', cancel, true);
    timer = win.setTimeout(() => {
      sample?.finish(); done({ validation: 'not-run', reason: 'No complete board pointer gesture before timeout' });
    }, timeoutMs);
    onState?.('armed');
  });
}
