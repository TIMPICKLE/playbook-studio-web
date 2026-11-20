// Shared statistics for a display clock and a workload sampled in the same browser.
export const round = value => Math.round(value*100)/100;
export function stats(values) {
  const sorted=[...values].sort((a,b)=>a-b);
  const quantile=pct=>sorted[Math.max(0,Math.ceil(sorted.length*pct)-1)];
  return {samples:sorted.length,p50:round(quantile(.5)),p95:round(quantile(.95)),max:round(sorted.at(-1))};
}

// One foreground rAF callback per display tick, with no reads or writes to the DOM.
export function sampleClock(durationMs,requestFrame=callback=>requestAnimationFrame(callback),cancelFrame=id=>cancelAnimationFrame(id)) {
  return new Promise((resolve,reject)=>{
    const samples=[];
    let request,start,last;
    function finish() {
      cancelFrame(request);
      document.removeEventListener('visibilitychange',visibility);
    }
    function visibility() {
      if (!document.hidden) return;
      finish();
      reject(Error('Tab hidden during sampling. Restart and keep this tab in the foreground.'));
    }
    function onFrame(now) {
      if (last!==undefined) samples.push(now-last);
      else start=now;
      last=now;
      if (now-start < durationMs) request=requestFrame(onFrame);
      else {
        finish();
        resolve({frameIntervalMs:stats(samples),over33_3msPercent:round(100*samples.filter(ms=>ms>33.3).length/samples.length),raw:samples.map(round)});
      }
    }
    document.addEventListener('visibilitychange',visibility);
    if (document.hidden) visibility();
    else request=requestFrame(onFrame);
  });
}
