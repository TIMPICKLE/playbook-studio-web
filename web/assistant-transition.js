import { interpolatePath } from './vendor/d3-interpolate-path-2.3.0.js';

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

function pathChanges(target, source, updates, restores) {
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
    try { mix = interpolatePath(from, to); } catch { continue; }
    restores.push(savedAttribute(path, 'd'));
    updates.push(progress => path.setAttribute('d', progress <= 0 ? from : progress >= 1 ? to : mix(progress)));
  }
}

function drawNewRoute(node, updates, restores) {
  for (const path of node.querySelectorAll('.route-stroke')) {
    // Optional/pass routes keep their own dash pattern. They enter through alpha.
    if (path.hasAttribute('stroke-dasharray')) continue;
    for (const attribute of ['pathLength', 'stroke-dasharray', 'stroke-dashoffset', 'marker-end']) restores.push(savedAttribute(path, attribute));
    const marker = path.getAttribute('marker-end');
    path.setAttribute('pathLength', '1');
    path.setAttribute('stroke-dasharray', '1 1');
    updates.push(progress => {
      path.setAttribute('stroke-dashoffset', String(1 - progress));
      if (marker && progress > .92) path.setAttribute('marker-end', marker);
      else path.removeAttribute('marker-end');
    });
  }
}

function tweenObject(target, source) {
  const updates = [], restores = [];
  const targetOpacity = number(target.getAttribute('opacity') ?? '1');
  if (target.hasAttribute('data-removing')) {
    opacity(target, targetOpacity, 0, updates, restores);
    return { updates, restores };
  }
  if (!source) {
    opacity(target, 0, targetOpacity, updates, restores);
    if (target.hasAttribute('data-route')) drawNewRoute(target, updates, restores);
    return { updates, restores };
  }
  pathChanges(target, source, updates, restores);
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
  if (source.textContent !== target.textContent && target.hasAttribute('data-annotation')) opacity(target, 0, targetOpacity, updates, restores);
  return { updates, restores };
}

/** Animate a presentation layer only. Canonical play data and undo belong to the editor. */
export function animateAssistantLayer({ layer, beforeSvg, reducedMotion = false, duration = 620, win = layer?.ownerDocument?.defaultView }) {
  const motionPreference = win?.matchMedia?.('(prefers-reduced-motion: reduce)');
  let resolveFinished;
  const finished = new Promise(resolve => { resolveFinished = resolve; });
  let frame = null, complete = false;
  const selector = objectAttributes.map(type => '[data-' + type + ']').join(',');
  const originals = new Map([...(beforeSvg?.querySelectorAll(selector) || [])].map(node => [objectKey(node), node]));
  const objects = [...(layer?.querySelectorAll(selector) || [])].map(node => ({ node, ...tweenObject(node, originals.get(objectKey(node))) }));
  const active = objects.filter(object => object.updates.length);
  const length = Math.min(760, Math.max(0, Number.isFinite(duration) ? duration : 620));
  let started = null;
  function stop() {
    if (frame !== null) win?.cancelAnimationFrame(frame);
    frame = null;
  }
  function cleanup() {
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
    if (started === null) started = now;
    let allDone = true;
    active.forEach((object, index) => {
      const delay = Math.min(index * 22, 110);
      const progress = length ? clamp((now - started - delay) / length) : 1;
      if (progress < 1) allDone = false;
      for (const update of object.updates) update(ease(progress));
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
