// A range input may emit many values before the next display refresh. The
// caller stores the latest model time; this queue presents it once per batch.
export function createScrubPresentation(win, present) {
  const deadline = 2 * (1000 / 60);
  let batch = null, lastPresented = -Infinity;

  function cancel() {
    if (batch?.frame != null) win.cancelAnimationFrame(batch.frame);
    if (batch?.timer != null) win.clearTimeout(batch.timer);
    batch = null;
  }

  function flush(stamp, ...options) {
    if (!batch || win.document.hidden) return;
    const {context} = batch;
    cancel();
    present(context, stamp, ...options);
    lastPresented = win.performance.now();
  }

  function queue(context) {
    if (batch) return;
    const request = {context, frame:null, timer:null};
    batch = request;
    if (win.document.hidden) return;
    // A losing rAF/timer or an obsolete microtask cannot consume a newer drag.
    const deliver = stamp => { if (batch === request) flush(stamp); };
    const remaining = lastPresented + deadline - win.performance.now();
    if (remaining <= 0) {
      queueMicrotask(deliver);
    } else {
      request.frame = win.requestAnimationFrame(deliver);
      request.timer = win.setTimeout(deliver, remaining);
    }
  }

  return {queue, flush, cancel, get pending() { return !!batch; }};
}
