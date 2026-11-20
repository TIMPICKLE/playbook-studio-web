// Shared statistics for a display clock and a workload sampled in the same browser.
export const round = value => Math.round(value*100)/100;
export function stats(values) {
  if (!values.length) return {samples:0,p50:null,p95:null,max:null};
  const sorted=[...values].sort((a,b)=>a-b);
  const quantile=pct=>sorted[Math.max(0,Math.ceil(sorted.length*pct)-1)];
  return {samples:sorted.length,p50:round(quantile(.5)),p95:round(quantile(.95)),max:round(sorted.at(-1))};
}

export function frameSummary(intervals) {
  const wallMs = intervals.reduce((sum,ms) => sum + ms, 0);
  const over33_3msCount = intervals.filter(ms => ms > 33.3).length;
  const stalls = intervals.filter(ms => ms >= 500);
  const totalMs = stalls.reduce((sum,ms) => sum + ms, 0);
  return { frameIntervalMs:stats(intervals), wallMs, over33_3msCount,
    over33_3msPercent:intervals.length ? round(100 * over33_3msCount / intervals.length) : null,
    stall500ms:{count:stalls.length, totalMs, wallPercent:wallMs ? round(100 * totalMs / wallMs) : null} };
}

// One foreground rAF callback per display tick, with no reads or writes to the DOM.
export function sampleClock(durationMs,requestFrame=callback=>requestAnimationFrame(callback),cancelFrame=id=>cancelAnimationFrame(id),maxWallMs=durationMs+12000) {
  return new Promise((resolve,reject)=>{
    const samples=[];
    let request,start,last;
    const timeout=setTimeout(()=>{
      finish();
      reject(Error('The visible page did not receive enough rAF callbacks to finish its clock sample.'));
    },maxWallMs);
    function finish() {
      clearTimeout(timeout);
      if(request!=null)cancelFrame(request);
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
        resolve({...frameSummary(samples),raw:samples});
      }
    }
    document.addEventListener('visibilitychange',visibility);
    if (document.hidden) visibility();
    else request=requestFrame(onFrame);
  });
}
