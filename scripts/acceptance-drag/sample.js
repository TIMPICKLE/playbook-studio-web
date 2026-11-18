// One synthetic pointermove per native rAF. All checks exercise the editor's own event handlers.
function check(condition, message) {
  if (!condition) throw Error(message);
}
function geometry(svg) {
  const selector = '[data-player], [data-route] path, [data-zone] > *, [data-annotation] > *, [id$="-ball"]';
  return [...svg.querySelectorAll(selector)].map(node => ['transform', 'd', 'cx', 'cy', 'rx', 'ry', 'x', 'y'].map(key => node.getAttribute(key)));
}
function stats(values) {
  const sorted = values.toSorted((a, b) => a - b);
  const at = quantile => +sorted[Math.ceil(sorted.length * quantile) - 1].toFixed(2);
  return { p50: at(.5), p95: at(.95), max: at(1) };
}

export async function sampleDrag(win, model, group, steps = 96) {
  const doc = win.document;
  const play = () => model.decodeWorkspace(win.localStorage.getItem(model.STORAGE_KEY)).plays[0];
  const before = play();
  check(before.players.length === 22, 'Expected an 11 v 11 play');
  const actors = (group ? ['X', 'Z'] : ['X']).map(label => before.players.find(player => player.label === label));
  const marker = actor => doc.querySelector('#field [data-player="' + actor.id + '"]');
  actors.forEach((actor, index) => marker(actor).dispatchEvent(new win.KeyboardEvent('keydown', {
    key: 'Enter', shiftKey: index > 0, bubbles: true,
  })));

  const field = doc.querySelector('#field');
  const svg = () => field.querySelector('.pitch-svg');
  const origin = actors[0];
  const standardRaf = win.requestAnimationFrame;
  const nextFrame = () => new Promise(resolve => standardRaf.call(win, resolve));
  const durations = [];
  // Synthetic pointer IDs cannot acquire native capture; dispatch move/up directly to its normal owner.
  field.setPointerCapture = () => {};
  function pointer(type, node, point) {
    const x = 18 + 9.64 * point.x, y = 20 + 7.6 * point.y;
    const matrix = svg().getScreenCTM();
    const event = new win.PointerEvent(type, {
      pointerType: 'mouse', button: 0, buttons: type === 'pointerup' ? 0 : 1, pointerId: 47,
      isPrimary: true, bubbles: true, cancelable: true, clientX: matrix.a * x + matrix.c * y + matrix.e, clientY: matrix.b * x + matrix.d * y + matrix.f,
    });
    if (type !== 'pointermove') return node.dispatchEvent(event);
    // Time only callbacks scheduled by the pointermove handler. Layout, paint and frame presentation are separate.
    win.requestAnimationFrame = callback => standardRaf.call(win, time => {
      const start = win.performance.now();
      try { callback(time); } finally { durations.push(win.performance.now() - start); }
    });
    try { return node.dispatchEvent(event); } finally { win.requestAnimationFrame = standardRaf; }
  }

  pointer('pointerdown', marker(origin), origin);
  const measured = svg();
  const related = new Set();
  for (const actor of actors) {
    related.add(marker(actor));
    for (const route of before.routes.filter(route => route.playerId === actor.id || route.blockTargets?.includes(actor.id))) {
      for (const node of measured.querySelectorAll('[data-route="' + route.id + '"] path, [data-route-id="' + route.id + '"]')) related.add(node);
    }
    if (actor.id === before.ball.holderId) related.add(measured.querySelector('[id$="-ball"]'));
  }

  const records = [];
  const observer = new win.MutationObserver(batch => records.push(...batch));
  let previous = await nextFrame();
  const intervals = [];
  let end;
  observer.observe(measured, { attributes: true, childList: true, subtree: true });
  try {
    for (let i = 1; i <= steps; i++) {
      const progress = i / steps;
      const phase = 2 * Math.PI * progress;
      end = { x: origin.x + .5 + 5 * progress + 1.8 * Math.sin(phase), y: origin.y - 3 * progress + 1.2 * Math.sin(2 * phase) };
      pointer('pointermove', field, end);
      const now = await nextFrame();
      intervals.push(now - previous);
      previous = now;
    }
    records.push(...observer.takeRecords());
  } finally { observer.disconnect(); }

  check(durations.length === steps, 'Expected one field update per move');
  check(svg() === measured, 'Live preview replaced the field SVG');
  const preview = JSON.stringify(geometry(measured));
  pointer('pointerup', field, end);
  const committed = play();
  for (const player of before.players) {
    const shifted = actors.some(actor => actor.id === player.id);
    const next = committed.players.find(p => p.id === player.id);
    check(Math.abs(next.x - player.x - (shifted ? end.x - origin.x : 0)) < .01 &&
      Math.abs(next.y - player.y - (shifted ? end.y - origin.y : 0)) < .01, 'Wrong committed position for ' + player.label);
  }
  check(preview === JSON.stringify(geometry(svg())), 'Released geometry differs from live preview');
  const undo = () => doc.querySelector('[data-action="undo"]');
  check(!undo().disabled, 'Missing undo entry');
  undo().click();
  check(JSON.stringify(play()) === JSON.stringify(before) && undo().disabled, 'One undo must restore the entire play');

  const writes = records.filter(record => record.type === 'attributes');
  return {
    case: group ? 'group X+Z' : 'single X', steps, svgWrites: writes.length,
    unrelatedWrites: writes.filter(record => !related.has(record.target)).length,
    childList: records.filter(record => record.type === 'childList').length, commitAndUndo: true,
    flushMs: { count: durations.length, ...stats(durations), total: +durations.reduce((a, b) => a + b).toFixed(2) },
    frameIntervalMs: { ...stats(intervals), over25ms: intervals.filter(ms => ms > 25).length },
  };
}
