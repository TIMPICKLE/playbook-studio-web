import { animatedBall, animatedPlayer, blockContact, clamp, dynamicBlockRoute, passFlightRoute } from './model.js';
import { displayColor, displayZoneColor, motionPath, project, routePath } from './field.js';

const NS = 'http://www.w3.org/2000/svg';
const PITCH_SCALE = { x: 9.64, y: 7.6 };

function attributes(node, values) {
  for (const [key, value] of Object.entries(values)) {
    const text = String(value);
    if (node.getAttribute(key) !== text) node.setAttribute(key, text);
  }
  return node;
}

function element(doc, name, values = {}) {
  return attributes(doc.createElementNS(NS, name), values);
}

function show(node, visible) {
  const display = visible ? '' : 'none';
  if (node.style.display !== display) node.style.display = display;
}

export function feedbackProgress(play, route, time) {
  const flight = route.kind === 'pass' && route.playerId === play.ball.holderId && play.ball.receiverId;
  const delay = flight ? play.ball.passAt : route.delay;
  const duration = flight ? play.ball.arriveAt - play.ball.passAt : route.duration;
  const elapsed = time - delay;
  return {
    progress: clamp(elapsed / Math.max(.01, duration), 0, 1),
    active: !route.optional && elapsed >= 0 && elapsed < duration,
    impact: route.kind === 'block' && !route.optional && elapsed >= duration ? clamp(1 - (elapsed - duration) / .55, 0, 1) : 0,
  };
}

function createZone(doc, defs, layer, zone, index) {
  const id = `digital-zone-${index}`;
  const gradient = element(doc, 'radialGradient', { id });
  for (const [offset, opacity] of [[0, .13], [.72, .06], [1, 0]]) {
    gradient.append(element(doc, 'stop', { offset, 'stop-color': zone.color, 'stop-opacity': opacity }));
  }
  defs.append(gradient);
  const group = element(doc, 'g', { 'data-feedback-zone': zone.id });
  const fill = element(doc, 'ellipse', { fill: `url(#${id})` });
  const contour = element(doc, 'ellipse', { fill: 'none', stroke: zone.color, 'stroke-width': 1 });
  group.append(fill, contour);
  layer.append(group);
  return { group, fill, contour, stops: Array.from(gradient.children) };
}

function createRoute(doc, layer, route) {
  const group = element(doc, 'g', { 'data-feedback-route': route.id });
  const stroke = { fill: 'none', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' };
  const halo = element(doc, 'path', { ...stroke, 'data-route-focus': '', 'stroke-width': 9 });
  if (route.optional || route.kind === 'pass') halo.setAttribute('stroke-dasharray', route.kind === 'pass' ? '4 7' : '9 6');
  const progress = element(doc, 'path', { ...stroke, 'data-route-progress': '', 'stroke-width': 3.6, pathLength: 1, 'stroke-dasharray': '1 1' });
  const impact = element(doc, 'circle', { fill: 'none', 'stroke-width': 2 });
  group.append(halo, progress, impact);
  layer.append(group);
  return { group, halo, progress, impact };
}

function renderRoute(item, route, play, view, flight) {
  const { selected, time, animated } = view;
  const selectedRoute = selected?.type === 'route' && selected.id === route.id;
  const selectedOwner = selected?.type === 'player' && selected.id === route.playerId || selected?.type === 'players' && selected.ids?.includes(route.playerId);
  const light = view.settings?.fieldTheme === 'light';
  const color = displayColor(route.color, light);
  const display = flight?.id === route.id ? flight : dynamicBlockRoute(play, route, time);
  const d = route.kind === 'motion' ? motionPath(display) : routePath(display);
  const focus = selectedRoute ? .34 : selectedOwner ? .2 : 0;
  const focusChanged = item.halo.getAttribute('opacity') !== String(focus);
  attributes(item.halo, { d, stroke: color, opacity: focus });
  const timing = feedbackProgress(play, route, time);
  const contact = blockContact(route, time);
  const tracing = animated && (selectedRoute || selectedOwner) && !contact && timing.active && time > 0 && route.kind !== 'pass';
  attributes(item.progress, { d, stroke: color, opacity: tracing ? .85 : 0, 'stroke-dashoffset': 1 - timing.progress });
  const end = project(contact ? display.points[contact.index + 1] : display.points.at(-1));
  const impact = contact ? (route.optional ? 0 : contact.impact) : timing.impact;
  attributes(item.impact, { cx: end.x, cy: end.y, stroke: color, r: animated ? 13 + (1 - impact) * 13 : 18, opacity: animated ? impact * .75 : impact > 0 ? .65 : 0 });
  return focusChanged;
}

// The model stores release and arrival times. The first cue marks the initial
// ball holder at timeline zero without inventing a center-to-quarterback pass.
function ballCue(play, time) {
  const { holderId, receiverId, passAt, arriveAt } = play.ball;
  if (!holderId) return null;
  if (receiverId && time >= arriveAt) return { kind: 'catch', playerId: receiverId, at: arriveAt, duration: .48 };
  if (receiverId && time >= passAt) return { kind: 'release', playerId: holderId, at: passAt, duration: Math.min(.32, arriveAt - passAt) };
  return { kind: 'snap', playerId: holderId, at: 0, duration: .32 };
}

function renderBall(layer, play, view, hiddenPlayers) {
  const { time, animated, rehearsal, playing } = view;
  const { receiverId, passAt, arriveAt } = play.ball;
  const light = view.settings?.fieldTheme === 'light';
  const inFlight = !!receiverId && time >= passAt && time < arriveAt;
  const active = time > 0 || rehearsal || playing;
  const cue = active && ballCue(play, time);
  const age = cue ? time - cue.at : 0;
  const player = cue && age < cue.duration && !hiddenPlayers.has(cue.playerId) && play.players.find(p => p.id === cue.playerId);
  const colors = light ? { snap: '#235a52', release: '#885720', catch: '#1c665a' } : { snap: '#c9e4d7', release: '#ffcf8a', catch: '#a9ead1' };
  const cueVisible = !!player && !view.presentationMask?.ball;
  show(layer.cue, cueVisible);
  if (cueVisible) {
    const at = project(animatedPlayer(play, player, cue.at)), fraction = age / cue.duration;
    attributes(layer.cue, { 'data-ball-cue': cue.kind, transform: `translate(${at.x} ${at.y})`, stroke: colors[cue.kind], opacity: animated ? 1 - fraction : .85 });
    const eased = 1 - (1 - fraction) ** 2;
    const radius = cue.kind === 'catch' ? 39 - 13 * eased : 26 + 11 * eased;
    attributes(layer.outer, { r: animated ? radius : 29, 'stroke-dasharray': cue.kind === 'release' ? '14 6' : 'none' });
    show(layer.inner, cue.kind === 'catch');
  } else {
    layer.cue.removeAttribute('data-ball-cue');
    layer.cue.removeAttribute('transform');
    layer.cue.removeAttribute('stroke');
    layer.cue.removeAttribute('opacity');
    attributes(layer.outer, { r: 26, 'stroke-dasharray': 'none' });
    show(layer.inner, false);
  }
  const flying = animated && inFlight && !view.presentationMask?.ball;
  show(layer.trail, flying);
  let d = '';
  if (flying) {
    const start = Math.max(passAt, time - .13);
    for (let i = 0; i <= 4; i++) {
      const ball = animatedBall(play, start + (time - start) * i / 4);
      if (!ball) break;
      const p = project(ball);
      d += `${i ? 'L' : 'M'}${(p.x + 23).toFixed(2)} ${(p.y - 11).toFixed(2)} `;
    }
  }
  attributes(layer.trail, { d, stroke: colors.release });
  const ball = layer.svg.querySelector(`#${layer.prefix}-ball`);
  if (ball) {
    const rotation = animated && inFlight ? 1260 * (time - passAt) / Math.max(.01, arriveAt - passAt) : 0;
    for (const child of ball.children) attributes(child, { transform: `rotate(${-35 + rotation})` });
  }
}

export function createRouteFeedback(svg, play, prefix = 'pitch') {
  const doc = svg.ownerDocument;
  const layer = element(doc, 'g', { class: 'digital-decoration', 'pointer-events': 'none', 'aria-hidden': 'true' });
  const defs = element(doc, 'defs');
  layer.append(defs);
  const zones = new Map(play.zones.map((zone, index) => [zone.id, createZone(doc, defs, layer, zone, index)]));
  const routes = new Map(play.routes.map(route => [route.id, createRoute(doc, layer, route)]));
  const trail = element(doc, 'path', { fill: 'none', 'stroke-width': 3, 'stroke-linecap': 'round', opacity: .75, 'data-ball-trail': '' });
  const cue = element(doc, 'g', { fill: 'none' });
  const outer = element(doc, 'circle', { r: 26, 'stroke-width': 2.2 });
  const inner = element(doc, 'circle', { r: 23, 'stroke-width': 1, opacity: .75 });
  cue.append(outer, inner);
  layer.append(trail, cue);
  svg.insertBefore(layer, svg.querySelector(`#${prefix}-players`));
  const ballLayer = { svg, prefix, trail, cue, outer, inner };
  return {
    layer,
    update({ animated = true, ...state }) {
      const view = { ...state, animated };
      const { play, time, selected, presentationMask } = view;
      const hiddenRoutes = new Set(presentationMask?.routeIds), hiddenZones = new Set(presentationMask?.zoneIds);
      const flight = time > 0 ? passFlightRoute(play) : null;
      let focusChanged = false;
      for (const route of play.routes) {
        const item = routes.get(route.id);
        if (!item) continue;
        show(item.group, !hiddenRoutes.has(route.id));
        if (renderRoute(item, route, play, view, flight)) focusChanged = true;
      }
      for (const zone of play.zones) {
        const item = zones.get(zone.id);
        if (!item) continue;
        show(item.group, !hiddenZones.has(zone.id));
        const p = project(zone), rx = zone.rx * PITCH_SCALE.x, ry = zone.ry * PITCH_SCALE.y;
        const color = displayZoneColor(zone.color, view.settings?.fieldTheme === 'light');
        for (const stop of item.stops) attributes(stop, { 'stop-color': color });
        attributes(item.group, { transform: `translate(${p.x} ${p.y})` });
        attributes(item.fill, { rx, ry });
        const focus = selected?.type === 'zone' && selected.id === zone.id ? .55 : .25;
        if (item.contour.getAttribute('opacity') !== String(focus)) focusChanged = true;
        attributes(item.contour, { rx: rx * .78, ry: ry * .78, stroke: color, opacity: focus });
      }
      renderBall(ballLayer, play, view, new Set(presentationMask?.playerIds));
      return focusChanged;
    },
    destroy() {
      layer.remove();
      const ball = svg.querySelector(`#${prefix}-ball`);
      if (ball) for (const child of ball.children) attributes(child, { transform: 'rotate(-35)' });
    },
  };
}
