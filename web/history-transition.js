import { animateFieldObjects } from './assistant-transition.js';

const namespace = 'http://www.w3.org/2000/svg';
const collections = {zone:'zones', route:'routes', player:'players', annotation:'annotations'};
const selector = Object.keys(collections).map(type => '[data-' + type + ']').concat('#pitch-ball').join(',');

// Keep references to the outgoing geometry before the canonical SVG is updated.
// A rapid reversal can start at the currently displayed path or player position.
export function captureHistoryFrame(svg, play, displayed) {
  if (!svg || !play || play.reference) return null;
  const values = new Map();
  for (const [type, collection] of Object.entries(collections))
    for (const item of play[collection]) values.set(type + '/' + item.id, item);
  const objects = new Map();
  for (const node of svg.querySelectorAll(selector)) {
    const type = Object.keys(collections).find(type => node.hasAttribute('data-' + type)) || 'ball';
    const id = type === 'ball' ? 'ball' : node.getAttribute('data-' + type);
    const key = type + '/' + id;
    objects.set(key, {node, type, id, value:values.get(key)});
  }
  return {playId:play.id, objects, displayed, markers:new Map([...svg.querySelectorAll('marker'), ...(displayed?.layer.querySelectorAll('marker') || [])].map(marker => [marker.id, marker]))};
}

function changed(before, after) {
  if (!before || !after) return true;
  if (before.type === 'ball') return before.node.getAttribute('transform') !== after.node.getAttribute('transform');
  // A linked block or throw can move even when the stored route stays identical.
  if (before.type === 'route' && before.node.querySelector('.route-stroke')?.getAttribute('d') !== after.node.querySelector('.route-stroke')?.getAttribute('d')) return true;
  return JSON.stringify(before.value) !== JSON.stringify(after.value);
}

function copyRemovedMarkers(node, markers, defs) {
  for (const path of node.querySelectorAll('path')) for (const name of ['marker-mid','marker-end']) {
    const id = path.getAttribute(name)?.match(/^url\(#(.+)\)$/)?.[1];
    const marker = markers.get(id);
    if (!marker) continue;
    const copy = marker.cloneNode(true);
    copy.id = 'history-removed-' + defs.children.length;
    defs.append(copy);
    path.setAttribute(name, 'url(#' + copy.id + ')');
  }
}

export function presentHistoryFrame(svg, play, before, {ready} = {}) {
  const doc = svg?.ownerDocument, win = doc?.defaultView;
  if (!before || before.playId !== play?.id || play.reference || !svg?.isConnected || doc.hidden || svg.closest('[hidden]') ||
    win.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return null;
  const bounds = svg.getBoundingClientRect();
  if (bounds.height && (bounds.bottom <= 0 || bounds.top >= win.innerHeight || bounds.right <= 0 || bounds.left >= win.innerWidth)) return null;
  const after = captureHistoryFrame(svg, play);
  const keys = new Set([...after.objects.keys(), ...before.objects.keys()]);
  const layer = doc.createElementNS(namespace, 'svg'), defs = doc.createElementNS(namespace, 'defs');
  layer.setAttribute('class','history-transition');
  layer.setAttribute('viewBox',svg.getAttribute('viewBox'));
  layer.setAttribute('aria-hidden','true');
  layer.setAttribute('focusable','false');
  layer.setAttribute('pointer-events','none');
  layer.append(defs);
  const objects = [], shown = new Map(), hidden = new Map();
  const mask = {playerIds:[], routeIds:[], zoneIds:[], ball:false};
  for (const key of keys) {
    const prior = before.objects.get(key), next = after.objects.get(key);
    if (!changed(prior, next)) continue;
    const {type,id} = next || prior;
    const source = before.displayed?.shown.get(key) || prior?.node;
    const node = (next?.node || source).cloneNode(true);
    node.querySelectorAll('.player-hit,.route-hit,.selection-ring').forEach(hit => hit.remove());
    for (const name of ['id','role','aria-label','aria-pressed','tabindex','data-' + type]) node.removeAttribute(name);
    node.setAttribute('data-history-' + type, id);
    if (!next) copyRemovedMarkers(node, before.markers, defs);
    if (next) {
      hidden.set(next.node, next.node.style.opacity);
      next.node.style.opacity = '0'; // opacity preserves the final pointer and keyboard targets.
    }
    if (type === 'ball') mask.ball = true;
    else mask[type + 'Ids']?.push(id);
    layer.append(node);
    shown.set(key, node);
    objects.push({node, source, type, removing:!next, fadeChange:true});
  }
  if (!objects.length) return null;
  svg.after(layer);
  const transition = animateFieldObjects({layer, objects, duration:280, stagger:0, ready});
  return {
    layer, shown, mask, finished:transition.finished,
    unmask() {
      for (const [node, opacity] of hidden) node.style.opacity = opacity;
      hidden.clear();
    },
    cancel() {
      transition.cancel();
      this.unmask();
      layer.remove();
    },
  };
}
