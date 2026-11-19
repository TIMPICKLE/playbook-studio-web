// QA code, outside the application bundle. Native rAF is the default in a browser.
export const timeline = [.34, 2.15, .86, 2.97, 1.82, .49, 3.12, 1.28];
const now = () => performance.now();
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
export function stepClock(win) {
  const pending = new Map();
  let id = 0, stamp = 0;
  win.requestAnimationFrame = callback => { pending.set(++id, callback); return id; };
  win.cancelAnimationFrame = key => pending.delete(key);
  return () => {
    stamp += 1000 / 60;
    for (const [key, callback] of [...pending]) if (pending.delete(key)) callback(stamp);
  };
}
export function mountMeter(win) {
  const request = win.requestAnimationFrame.bind(win);
  const meter = { row: null, draw(state, render) {
    const row = meter.row;
    if (!row) return render();
    const start = now(), value = render();
    row.drawCpu += now() - start;
    row.draws++;
    row.lastDrawTime = state.time;
    if (row.finalSent && Math.abs(state.time - row.target) < 1e-7) {
      row.finalDrawEnd = now();
      row.complete();
    }
    return value;
  } };
  win.requestAnimationFrame = callback => request(stamp => {
    const row = meter.row, before = row?.draws, start = now();
    try { callback(stamp); } finally {
      if (row && row.draws > before) row.asyncRenderTask += now() - start;
    }
  });
  return meter;
}
function summary(rows) {
  const quantiles = key => {
    const xs = rows.map(row => row[key]).sort((a, b) => a - b);
    return Object.fromEntries([['p50', .5], ['p95', .95], ['max', 1]].map(([label, p]) => [label, +xs[Math.ceil(xs.length * p) - 1].toFixed(2)]));
  };
  return { samples: rows.length, inputs: rows.reduce((n, r) => n + r.inputs, 0), draws: rows.reduce((n, r) => n + r.draws, 0),
    drawCounts: [...new Set(rows.map(r => r.draws))].sort((a, b) => a - b),
    activeMs: quantiles('active'), activeWithLayoutMs: quantiles('activeWithLayout'), layoutReadMs: quantiles('layoutRead'), toFinalDrawMs: quantiles('toDraw'), toLayoutMs: quantiles('toLayout'),
    drawCpuMs: quantiles('drawCpu'), dispatchMs: quantiles('dispatch') };
}
function checksum(value) {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) hash = Math.imul(hash ^ value.charCodeAt(i), 16777619);
  return (hash >>> 0).toString(16);
}
export async function measureEditor({ win, meter, step, rounds = 3, samples = 16, onProgress = () => {} }) {
  const doc = win.document, $ = selector => doc.querySelector(selector);
  const input = $('#timeline'), stage = $('.pitch-stage');
  const markers = [...doc.querySelectorAll('#field [data-player]')];
  const tokens = [...doc.querySelectorAll('[data-vector-player]')];
  if (!stage || !input || markers.length !== 22 || tokens.length !== 22) throw Error('Expected the 22-player Mesh vector editor.');
  const records = { single: [], burst12: [] }, poses = new Map(), stageSizes = new Set();
  let totalChecked = 0;
  const frame = step ? async () => { step(); await delay(0); } : () => new Promise(resolve => win.requestAnimationFrame(resolve));
  function signature() {
    return checksum(JSON.stringify([markers.map(p => [p.dataset.player, p.getAttribute('transform')]),
      tokens.map(p => { const text = p.querySelector('text'); return [p.dataset.vectorPlayer, text.getAttribute('x'), text.getAttribute('y')]; }),
      $('#pitch-ball')?.getAttribute('transform'), $('#time-label').textContent, $('#playback-phase').textContent,
      $('.digital-decoration [data-ball-cue]')?.dataset.ballCue || '']));
  }
  const finalPaths = () => checksum([...doc.querySelectorAll('.digital-token-overlay path')].map(p => p.getAttribute('d')).join('|'));
  async function sample(index, inputs) {
    await frame();
    let complete;
    const done = new Promise(resolve => { complete = resolve; });
    const target = timeline[index % timeline.length];
    const row = { inputs, target, draws: 0, drawCpu: 0, asyncRenderTask: 0, complete };
    meter.row = row;
    let timer;
    try {
      const start = now();
      for (let j = 0; j < inputs; j++) {
        row.finalSent = j === inputs - 1;
        input.value = String(row.finalSent ? target : timeline[(index + j + 1) % timeline.length]);
        input.dispatchEvent(new win.Event('input', { bubbles: true }));
      }
      row.dispatch = now() - start;
      if (step && !row.finalDrawEnd) step();
      if (!row.finalDrawEnd) {
        await Promise.race([done, new Promise((_, reject) => { timer = setTimeout(() => reject(Error('Latest time did not reach vector draw: ' + target)), 8000); })]);
      }
      row.toDraw = row.finalDrawEnd - start;
      const beforeLayout = now();
      const rect = stage.getBoundingClientRect();
      if (!step && !rect.width) throw Error('Editor is not visible');
      const afterLayout = now();
      row.toLayout = afterLayout - start;
      row.layoutRead = afterLayout - beforeLayout;
      stageSizes.add(rect.width + 'x' + rect.height);
      row.active = row.dispatch + row.asyncRenderTask;
      row.activeWithLayout = row.active + row.layoutRead;
      if (row.lastDrawTime !== target || Number(input.value) !== target ||
        !$('#time-label').textContent.trim().startsWith(target.toFixed(1))) throw Error('Presentation and slider disagree at ' + target);
      const hash = signature();
      if (poses.has(target) && poses.get(target) !== hash) throw Error('Repeated pose changed at ' + target);
      poses.set(target, hash);
      totalChecked++;
      return row;
    } finally { meter.row = null; clearTimeout(timer); }
  }
  for (const n of [1, 12]) for (let i = 0; i < 4; i++) await sample(i, n);
  const ends = [];
  for (let round = 0; round < rounds; round++) {
    const variants = round % 2 ? ['burst12', 'single'] : ['single', 'burst12'];
    for (const variant of variants) {
      onProgress(variant + ' ' + (round + 1) + '/' + rounds);
      for (let i = 0; i < samples; i++) records[variant].push(await sample(i, variant === 'single' ? 1 : 12));
      ends.push({ round, variant, time: Number(input.value), pose: poses.get(Number(input.value)), pathHash: finalPaths() });
    }
  }
  const columns = ['target', 'inputs', 'draws', 'dispatch', 'active', 'toDraw', 'toLayout', 'layoutRead'];
  const raw = { columns };
  for (const [name, rows] of Object.entries(records)) {
    raw[name] = rows.map(row => columns.map(key => +row[key].toFixed(3)));
  }
  return { rounds, samplesPerRound: samples, poseChecks: totalChecked, stageSizes: [...stageSizes], raw, poses: Object.fromEntries(poses), ends,
    single: summary(records.single), burst12: summary(records.burst12) };
}
