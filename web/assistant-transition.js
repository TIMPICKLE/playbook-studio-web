import { interpolatePath, pathCommandsFromString } from './vendor/d3-interpolate-path-2.3.0.js';

const objectAttributes = ['route', 'player', 'zone', 'annotation'];
const clamp = value => Math.max(0, Math.min(1, value));
const ease = value => 1 - (1 - clamp(value)) ** 3;
const number = value => Number.parseFloat(value);

function savedAttribute(node, name) {
  const original = node.getAttribute(name);
  return () => original === null ? node.removeAttribute(name) : node.setAttribute(name, original);
}

function objectKey(node) {
  for (const type of objectAttributes) {
    const id = node.getAttribute('data-' + type);
    if (id !== null) return type + '/' + id;
  }
  return null;
}

function translate(value) {
  const match = value?.match(/^translate\(\s*(-?[\d.]+)(?:[ ,]+(-?[\d.]+))?\s*\)$/);
  return match ? [Number(match[1]), Number(match[2] || 0)] : null;
}

function numericAttributes(target, source, names, updates, restores) {
  for (const name of names) {
    const start = number(source.getAttribute(name)), end = number(target.getAttribute(name));
    if (!Number.isFinite(start) || !Number.isFinite(end) || start === end) continue;
    restores.push(savedAttribute(target, name));
    updates.push(progress => target.setAttribute(name, String(start + (end - start) * progress)));
  }
}

function opacity(target, start, end, updates, restores) {
  const restore = savedAttribute(target, 'opacity');
  updates.push(progress => target.setAttribute('opacity', String(start + (end - start) * progress)));
  restores.push(end === 0 ? () => target.setAttribute('opacity', '0') : restore);
}

function strokeColor(target, source, updates, restores) {
  const parse = value => {
    const hex = value?.match(/^#([\da-f]{3}|[\da-f]{6})$/i)?.[1];
    if (!hex) return null;
    const full = hex.length === 3 ? [...hex].map(char => char + char).join('') : hex;
    return [0, 2, 4].map(index => Number.parseInt(full.slice(index, index + 2), 16));
  };
  const start = parse(source.getAttribute('stroke')), end = parse(target.getAttribute('stroke'));
  if (!start || !end || start.every((channel, index) => channel === end[index])) return;
  restores.push(savedAttribute(target, 'stroke'));
  updates.push(progress => target.setAttribute('stroke', '#' + start.map((channel, index) =>
    Math.round(channel + (end[index] - channel) * progress).toString(16).padStart(2, '0')).join('')));
}

// D3 equalizes point counts before tweening. For a Go becoming a Post that
// would bend the shared stem partway upfield, before the actual break.
function routeMorph(from, to) {
  const a = pathCommandsFromString(from), b = pathCommandsFromString(to);
  const isPolyline = points => points[0]?.type === 'M' && points.slice(1).every(p => p.type === 'L');
  if (!isPolyline(a) || !isPolyline(b) || a[0].x !== b[0].x || a[0].y !== b[0].y)
    return { mix:interpolatePath(from, to) };

  let anchor = a[0], i = 1, j = 1;
  const prefix = [anchor];
  while (i < a.length && j < b.length) {
    const dx = a[i].x - anchor.x, dy = a[i].y - anchor.y;
    const ex = b[j].x - anchor.x, ey = b[j].y - anchor.y;
    const da = Math.hypot(dx, dy), db = Math.hypot(ex, ey);
    if (!da) { i++; continue; }
    if (!db) { j++; continue; }
    // A shared ray can have different waypoint spacing on its two paths.
    if (dx * ex + dy * ey <= 0 || Math.abs(dx * ey - dy * ex) > 1e-7 * da * db) break;
    anchor = da <= db ? a[i] : b[j];
    prefix.push(anchor);
    if (da <= db) i++;
    if (db <= da) j++;
  }
  const xy = p => p.x + ',' + p.y;
  // Trace only the first new leg, even when later parts of the route rejoin.
  // A shortened route or a change in waypoint spacing has no new leg.
  const next = b.slice(j).find(p => p.x !== anchor.x || p.y !== anchor.y);
  const segment = next ? 'M' + xy(anchor) + 'L' + xy(next) : null;
  if (prefix.length === 1) return { mix:interpolatePath(from, to), segment };
  const lines = points => points.map(p => 'L' + xy(p)).join('');
  const stem = 'M' + xy(prefix[0]) + lines(prefix.slice(1));
  const move = 'M' + xy(anchor);
  // Keep one segment when either tail is empty so D3 can grow or retract it.
  const tail = points => move + (lines(points) || 'L' + xy(anchor));
  const mixTail = interpolatePath(tail(a.slice(i)), tail(b.slice(j)));
  const mix = progress => {
    const suffix = mixTail(progress);
    return stem + suffix.slice(suffix.indexOf('L'));
  };
  return {mix, segment};
}

function changeTrace(path, segment) {
  let overlay;
  function draw(progress) {
    if (progress <= 0) return;
    if (progress >= 1) { overlay?.remove(); return; }
    if (!overlay) {
      overlay = path.ownerDocument.createElementNS(path.namespaceURI, 'path');
      const attributes = {
        class:'assistant-route-trace', d:segment, fill:'none', stroke:path.getAttribute('stroke') || 'currentColor',
        'stroke-width':(number(path.getAttribute('stroke-width')) || 2.8) + 2.4,
        'stroke-linecap':'round', pathLength:1, 'stroke-dasharray':'1 1',
        'pointer-events':'none', 'aria-hidden':'true',
      };
      for (const [key,value] of Object.entries(attributes)) overlay.setAttribute(key, String(value));
      path.after(overlay);
    }
    overlay.setAttribute('stroke-dashoffset', String(1 - clamp(progress / .7)));
    overlay.setAttribute('opacity', String(.72 * clamp((1 - progress) / .3)));
  }
  return {draw, remove:() => overlay?.remove()};
}

function pathChanges(target, source, updates, restores, traceChange) {
  let trace;
  const targetPaths = [...target.querySelectorAll('path')];
  const sourcePaths = [...source.querySelectorAll('path')];
  for (const [index, path] of targetPaths.entries()) {
    const selector = path.classList.contains('route-stroke') ? '.route-stroke'
      : path.classList.contains('route-hit') ? '.route-hit' : null;
    const old = selector ? source.querySelector(selector) : sourcePaths[index];
    const from = old?.getAttribute('d'), to = path.getAttribute('d');
    if (!old) continue;
    strokeColor(path, old, updates, restores);
    numericAttributes(path, old, ['stroke-width'], updates, restores);
    if (!from || !to || from === to) continue;
    let mix;
    try {
      if (selector) {
        const morph = routeMorph(from, to);
        mix = morph.mix;
        if (traceChange && selector === '.route-stroke' && morph.segment && !path.hasAttribute('stroke-dasharray'))
          trace = changeTrace(path, morph.segment);
      } else mix = interpolatePath(from, to);
    } catch { continue; }
    restores.push(savedAttribute(path, 'd'));
    updates.push(progress => path.setAttribute('d', progress <= 0 ? from : progress >= 1 ? to : mix(progress)));
  }
  return trace;
}

function drawNewRoute(node, updates, restores, start = 0) {
  for (const path of node.querySelectorAll('.route-stroke')) {
    // Optional/pass routes keep their own dash pattern. They enter through alpha.
    if (path.hasAttribute('stroke-dasharray')) continue;
    for (const attribute of ['pathLength', 'stroke-dasharray', 'stroke-dashoffset', 'marker-end']) restores.push(savedAttribute(path, attribute));
    const marker = path.getAttribute('marker-end');
    path.setAttribute('pathLength', '1');
    path.setAttribute('stroke-dasharray', '1 1');
    updates.push(progress => {
      const drawn = start + (1 - start) * progress;
      path.setAttribute('stroke-dashoffset', String(1 - drawn));
      if (marker && drawn > .92) path.setAttribute('marker-end', marker);
      else path.removeAttribute('marker-end');
    });
  }
}

function tweenObject({node: target, source, type, removing, fadeChange, traceChange}) {
  const updates = [], restores = [];
  const targetOpacity = number(target.getAttribute('opacity') ?? '1');
  if (removing) {
    opacity(target, targetOpacity, 0, updates, restores);
    return { updates, restores };
  }
  if (!source) {
    opacity(target, 0, targetOpacity, updates, restores);
    if (type === 'route') drawNewRoute(target, updates, restores);
    return { updates, restores };
  }
  const partial = type === 'route' && source.querySelector('.route-stroke[stroke-dasharray="1 1"][stroke-dashoffset]');
  if (partial) drawNewRoute(target, updates, restores, 1 - clamp(number(partial.getAttribute('stroke-dashoffset'))));
  const trace = pathChanges(target, source, updates, restores, traceChange);
  const from = translate(source.getAttribute('transform'));
  const to = translate(target.getAttribute('transform'));
  if (from && to && (from[0] !== to[0] || from[1] !== to[1])) {
    restores.push(savedAttribute(target, 'transform'));
    updates.push(progress => target.setAttribute('transform', 'translate(' + (from[0] + (to[0] - from[0]) * progress) + ' ' + (from[1] + (to[1] - from[1]) * progress) + ')'));
  }
  for (const selector of ['ellipse', 'text']) {
    const oldChildren = [...source.querySelectorAll(selector)];
    for (const [index, child] of [...target.querySelectorAll(selector)].entries()) {
      const old = oldChildren[index];
      if (!old) continue;
      numericAttributes(child, old, selector === 'ellipse' ? ['cx', 'cy', 'rx', 'ry'] : ['x', 'y'], updates, restores);
    }
  }
  const startOpacity = number(source.getAttribute('opacity') ?? '1');
  if (startOpacity !== targetOpacity) opacity(target, startOpacity, targetOpacity, updates, restores);
  else if ((source.textContent !== target.textContent && type === 'annotation') || (fadeChange && !updates.length))
    opacity(target, 0, targetOpacity, updates, restores);
  return { updates, restores, trace };
}

/** Animate a presentation layer only. Canonical play data and undo belong to the editor. */
export function animateAssistantLayer({ layer, beforeSvg, ...options }) {
  const selector = objectAttributes.map(type => '[data-' + type + ']').join(',');
  const originals = new Map([...(beforeSvg?.querySelectorAll(selector) || [])].map(node => [objectKey(node), node]));
  const objects = [...(layer?.querySelectorAll(selector) || [])].map(node => ({
    node, source: originals.get(objectKey(node)), type: objectAttributes.find(type => node.hasAttribute('data-' + type)),
    removing: node.hasAttribute('data-removing'),
  }));
  // A single edited route has a clear focus. A batch keeps its ordinary morphs.
  if (layer?.getAttribute('data-field-surface') === 'enamel') {
    const routes = objects.filter(({type}) => type === 'route');
    if (routes.length === 1) routes[0].traceChange = true;
  }
  const ball = layer?.querySelector(':scope > g[id$="-ball"]');
  if (ball && ball.style.visibility !== 'hidden') {
    objects.push({node:ball, source:beforeSvg?.querySelector(':scope > g[id$="-ball"]'), type:'ball'});
    // The carried ball and its holder must leave and arrive on the same frame.
    return animateFieldObjects({layer, objects, ...options, stagger:0});
  }
  return animateFieldObjects({layer, objects, ...options});
}

export function animateFieldObjects({ layer, objects, reducedMotion = false, duration = 620, stagger = 22, ready, win = layer?.ownerDocument?.defaultView }) {
  const motionPreference = win?.matchMedia?.('(prefers-reduced-motion: reduce)');
  let resolveFinished;
  const finished = new Promise(resolve => { resolveFinished = resolve; });
  let frame = null, complete = false;
  const active = objects.map(tweenObject).filter(object => object.updates.length);
  const length = Math.min(760, Math.max(0, Number.isFinite(duration) ? duration : 620));
  let started = null, waitingSince = null;
  function stop() {
    if (frame !== null) win?.cancelAnimationFrame(frame);
    frame = null;
  }
  function cleanup() {
    for (const object of active) object.trace?.remove();
    win?.removeEventListener?.('pagehide', cancel);
    win?.document?.removeEventListener?.('visibilitychange', visibility);
    win?.document?.removeEventListener?.('playbook:effects-changed', effects);
    if (motionPreference?.removeEventListener) motionPreference.removeEventListener('change', effects);
    else motionPreference?.removeListener?.(effects);
  }
  function finish() {
    if (complete) return;
    complete = true; stop();
    for (const object of active) for (const restore of object.restores) restore();
    layer?.removeAttribute('data-transitioning');
    cleanup(); resolveFinished({ cancelled: false });
  }
  function cancel() {
    if (complete) return;
    complete = true; stop();
    layer?.removeAttribute('data-transitioning');
    cleanup(); resolveFinished({ cancelled: true });
  }
  const visibility = () => { if (win.document.hidden) finish(); };
  const effects = () => {
    // Decorative effects can be off in traditional/mobile mode. A route change
    // remains functional feedback unless the system requests reduced motion.
    if (motionPreference?.matches) finish();
  };
  function step(now) {
    frame = null;
    if (complete) return;
    if (!layer?.isConnected) { cancel(); return; }
    if (started === null && ready && !ready()) {
      // A 3D field retains the previous texture until its replacement decodes.
      // Keep the source still so an old path never underlies a moving one.
      waitingSince ??= now;
      if (now - waitingSince >= 500) finish();
      else frame = win.requestAnimationFrame(step);
      return;
    }
    if (started === null) started = now;
    let allDone = true;
    active.forEach((object, index) => {
      const delay = Math.min(index * stagger, 110);
      const progress = length ? clamp((now - started - delay) / length) : 1;
      if (progress < 1) allDone = false;
      // Reserve the last part of the same clock for a single stroke on the
      // exact new break. Held-ball and player updates keep their own timing.
      const morphEnd = object.trace ? .62 : 1;
      for (const update of object.updates) update(ease(progress / morphEnd));
      if (object.trace) object.trace.draw((progress - morphEnd) / (1 - morphEnd));
    });
    if (allDone) finish();
    else frame = win.requestAnimationFrame(step);
  }
  if (reducedMotion || motionPreference?.matches || !win?.requestAnimationFrame || !active.length || length === 0) finish();
  else {
    layer.setAttribute('data-transitioning', '');
    // Establish the source geometry before the browser can paint the new layer.
    for (const object of active) for (const update of object.updates) update(0);
    win.addEventListener?.('pagehide', cancel);
    win.document.addEventListener?.('visibilitychange', visibility);
    win.document.addEventListener?.('playbook:effects-changed', effects);
    if (motionPreference?.addEventListener) motionPreference.addEventListener('change', effects);
    else motionPreference?.addListener?.(effects);
    frame = win.requestAnimationFrame(step);
  }
  return { finished, finish, cancel };
}
