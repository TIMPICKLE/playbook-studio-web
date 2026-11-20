// Each run maps the document's monotonic clock to seconds on the play. A
// delayed display tick skips directly to the frame for that instant.
export function createPlaybackClock(win, present) {
  let run = null, frame = null;

  function position(stamp) {
    const elapsed = Math.max(0, stamp - run.stamp) * run.speed / 1000;
    const at = run.time + elapsed;
    return run.loop ? at % run.duration : Math.min(at, run.duration);
  }

  function cancel() {
    run = null;
    if (frame !== null) win.cancelAnimationFrame(frame);
    frame = null;
  }

  function schedule(active) {
    function tick(stamp) {
      // A callback already dispatched before a seek/close cannot advance a new run.
      if (run !== active) return;
      frame = null;
      const at = position(stamp);
      if (at === run.duration) run = null;
      present(at, stamp, run !== null);
      if (run === active) frame = win.requestAnimationFrame(tick);
    }
    frame = win.requestAnimationFrame(tick);
  }

  function start(at, {duration, speed, loop = false}) {
    cancel();
    const time = at >= duration ? 0 : at;
    run = {time, stamp:win.performance.now(), duration, speed, loop};
    schedule(run);
    return time;
  }

  function pause() {
    if (!run) return null;
    const at = position(win.performance.now());
    cancel();
    return at;
  }

  function configure(speed, loop = false) {
    if (!run) return null;
    const stamp = win.performance.now();
    const at = position(stamp);
    if (at === run.duration) cancel();
    else Object.assign(run, {time:at, stamp, speed, loop});
    return at;
  }

  return {start, pause, configure, get running() { return run !== null; }};
}
