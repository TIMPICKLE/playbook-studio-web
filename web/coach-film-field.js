import { t } from './i18n.js';
import { COLORS, colorOK, dynamicBlockRoute, passFlightRoute } from './model.js';
import { displayColor, displayZoneColor, motionPath, routePath } from './field.js';
import { SCRIMMAGE_Y, UNITS_PER_YARD_Y } from './field-metrics.js';
import { createFilmPlayerSurface } from './coach-film-players-gl.js';

const NS = 'http://www.w3.org/2000/svg';
const WIDTH = 1000, HEIGHT = 550;
const LEFT = 44, TOP = 32, PITCH_WIDTH = 912, PITCH_HEIGHT = 484;
const right = LEFT + PITCH_WIDTH;
const fieldX = x => LEFT + x * PITCH_WIDTH / 100;
const fieldY = y => TOP + y * PITCH_HEIGHT / 100;
// Route paths use the editor's 1000 × 800 coordinate system. Project the
// geometry once into this fixed high-wide shot, leaving labels upright.
const sx = PITCH_WIDTH / 964, sy = PITCH_HEIGHT / 760;
const routeProjection = `matrix(${sx} 0 0 ${sy} ${LEFT - 18 * sx} ${TOP - 20 * sy})`;
const num = value => Number(value.toFixed(2));
const move = (x, y) => `translate(${num(x)} ${num(y)})`;
let fieldCount = 0;

function attr(node, key, value) {
  const text = String(value);
  if (node.getAttribute(key) !== text) node.setAttribute(key, text);
}
function svg(parent, tag, attributes = {}, text) {
  const node = parent.ownerDocument.createElementNS(NS, tag);
  for (const [key, value] of Object.entries(attributes)) attr(node, key, value);
  if (text != null) node.textContent = text;
  parent.append(node);
  return node;
}
function visible(node, show) {
  attr(node, 'display', show ? 'inline' : 'none');
}

function markings(ground, calibrated) {
  const layer = svg(ground, 'g', { class: 'film-markings', 'aria-hidden': true });
  svg(layer, 'rect', { x: LEFT, y: TOP, width: PITCH_WIDTH, height: PITCH_HEIGHT, class: 'film-boundary' });
  const major = [], minor = [], hashes = [];
  for (let i = 1; i < 50; i++) {
    const y = num(fieldY(i * UNITS_PER_YARD_Y));
    if (i % 5 === 0) {
      (i % 10 === 0 ? major : minor).push(`M${LEFT} ${y}H${right}`);
      if (calibrated && i % 10 === 0) {
        for (const x of [LEFT - 19, right + 19]) {
          svg(layer, 'text', { x, y, class: 'film-yard-number' }, 50 - i);
        }
      }
    } else {
      for (const x of [LEFT, fieldX(35.5), fieldX(64.5), right - 5]) hashes.push(`M${num(x)} ${y}h5`);
    }
  }
  for (const [name, paths] of [['major',major], ['minor',minor], ['hash',hashes]]) {
    svg(layer, 'path', { d: paths.join(''), class: 'film-grid-' + name });
  }
  const los = num(fieldY(SCRIMMAGE_Y));
  svg(layer, 'path', { d: `M${LEFT} ${los}H${right}`, class: 'film-los' });
  svg(layer, 'text', { x: right - 7, y: los - 7, 'text-anchor':'end', class: 'film-field-remark' }, t('support.los'));
  svg(layer, 'text', { x: LEFT, y: TOP - 11, class:'film-field-remark' }, t('support.direction'));
}

const capGeometry = {
  arrow: ['path', { d:'M1 -5 10 0 1 5', fill:'none', 'stroke-width':2.2 }],
  bar: ['path', { d:'M10 -7 V7', fill:'none', 'stroke-width':2.3 }],
  dot: ['circle', { cx:8, cy:0, r:3.5 }],
};
function addRoute(layer, defs, route, prefix, i, flight) {
  const cap = Object.hasOwn(capGeometry,route.endCap) ? route.endCap : 'arrow';
  const [tag, geometry] = capGeometry[cap];
  const endId = `${prefix}-end-${i}`;
  const marker = svg(defs, 'marker', { id:endId, viewBox:'0 -9 13 18', refX:10, refY:0,
    markerWidth:14, markerHeight:19, orient:'auto', markerUnits:'userSpaceOnUse', overflow:'visible' });
  const end = svg(marker, tag, geometry);
  const display = flight?.id === route.id ? flight : route;
  const path = svg(layer, 'path', {
    d: route.kind === 'motion' ? motionPath(display) : routePath(display),
    class: 'film-route', 'data-film-route':route.id, 'marker-end':`url(#${endId})`,
  });
  if (route.kind === 'pass' || route.optional) {
    attr(path, 'stroke-dasharray', route.kind === 'pass' ? '3 6' : '9 7');
  }
  if (route.stagedBlock && cap === 'bar') attr(path,'marker-mid',`url(#${endId})`);
  return { route, path, end, cap };
}

function addFace(parent, shape) {
  const props = { class:'film-token-face' };
  if (shape === 'triangle') return svg(parent,'path',{ ...props, d:'M0 -17 16 14 -16 14Z' });
  if (shape === 'square') return svg(parent,'rect',{ ...props, x:-15,y:-14,width:30,height:28,rx:4 });
  return svg(parent,'circle',{ ...props, r:14 });
}
function addToken(layer, player) {
  const group = svg(layer, 'g', {
    class:'film-token', 'data-film-player':player.id, tabindex:0, role:'button',
    'aria-label':player.displayLabel, 'aria-pressed':false,
  });
  svg(group,'title',{},player.displayLabel);
  svg(group,'circle',{r:23,fill:'transparent'});
  const face = addFace(group,player.shape);
  svg(group,'circle',{r:18.2,class:'film-token-selection'});
  svg(group,'circle',{r:21.8,class:'film-token-keyboard'});
  const label = svg(group,'text',{
    class:'film-token-label', 'font-size':Math.min(16, 48 / Math.max(1, Array.from(player.label).length)),
  },player.label);
  return { player, group, face, label };
}
function readableInk(hex) {
  const linear = [1,3,5].map(i => {
    const component = parseInt(hex.slice(i, i + 2), 16) / 255;
    return component <= .04045 ? component / 12.92 : ((component + .055) / 1.055) ** 2.4;
  });
  const luminance = .2126 * linear[0] + .7152 * linear[1] + .0722 * linear[2];
  if (luminance >= .25) return '#111820';
  return luminance > .179 ? '#000000' : '#ffffff';
}

function addTeachingLayer(layer) {
  const tracks = [0,1].map(() => {
    const group = svg(layer, 'g', { 'data-film-track':'', display:'none' });
    const trail = svg(group, 'path', { class:'film-recent-route' });
    const origin = svg(group, 'circle', { class:'film-reference-position', r:11 });
    return {group, trail, origin};
  });
  const depth = svg(layer,'g',{'data-film-depth':'',display:'none'});
  const guides = svg(depth,'path',{class:'film-depth-guides'});
  const bracket = svg(depth,'path',{class:'film-depth-bracket'});
  const label = svg(depth,'text',{class:'film-depth-label'});
  function update(frame, reference, reduced) {
    for (const [index,item] of tracks.entries()) {
      const player = frame.focus[index];
      visible(item.group, !!player);
      if (!player) continue;
      const origin = reference?.positions.get(player.id) || player.origin;
      attr(item.origin,'cx',num(fieldX(origin.x)));
      attr(item.origin,'cy',num(fieldY(origin.y)));
      const showTrail = !reduced && player.trail.length > 1;
      visible(item.trail, showTrail);
      if (showTrail) {
        const d = player.trail.map((pt,i) => `${i ? 'L' : 'M'}${num(fieldX(pt.x))} ${num(fieldY(pt.y))}`).join(' ');
        attr(item.trail,'d',d);
      }
    }
    visible(depth, !!frame.comparison);
    if (!frame.comparison) return;
    const [a,b] = frame.focus.map(({position})=>({x:fieldX(position.x),y:fieldY(position.y)}));
    const left = Math.min(a.x,b.x) - 35;
    const placeLeft = left > LEFT + 78;
    const x = num(placeLeft ? left : Math.min(right - 65, Math.max(a.x,b.x) + 35));
    const tick = placeLeft ? 6 : -6, aY = num(a.y), bY = num(b.y);
    attr(guides, 'd', `M${num(a.x)} ${aY}H${x}M${num(b.x)} ${bY}H${x}`);
    attr(bracket, 'd', `M${x + tick} ${aY}H${x}V${bY}H${x + tick}`);
    attr(label, 'x', x - tick);
    attr(label, 'y', num((a.y + b.y) / 2));
    attr(label, 'text-anchor', placeLeft ? 'end' : 'start');
    const {gapYards,deeperId} = frame.comparison;
    const value = !deeperId ? t('film.fieldSameDepth') : gapYards == null ? t('film.fieldDepth') : t('film.fieldGap',{yards:gapYards.toFixed(1)});
    if (label.textContent !== value) label.textContent = value;
  }
  return update;
}

function addBall(foreground, play) {
  const group = svg(foreground, 'g', { 'data-film-ball':'', 'pointer-events':'none', 'aria-hidden':true });
  const tether = svg(group, 'path', {class:'film-ball-tether'});
  const badge = svg(group,'g');
  const angled = svg(badge,'g',{ transform:'rotate(-28)' });
  svg(angled,'path',{ class:'film-ball-body', d:'M-9 0Q0 -11 9 0Q0 11 -9 0Z' });
  svg(angled,'path',{ class:'film-ball-laces', d:'M-3.7 0H3.7M-1.6 -1.8V1.8M1.5 -1.8V1.8' });
  return frame => {
    visible(group, !!frame.ball);
    attr(group, 'data-phase', frame.phase);
    if (!frame.ball) return;
    const x = fieldX(frame.ball.x), y = fieldY(frame.ball.y);
    attr(group, 'transform', move(x,y));
    // While possessed the icon sits on the shoulder of its marker, connected
    // to the physical anchor. It converges to the exact flight path on exit.
    let attached = 1;
    if (frame.phase === 'flight') {
      const ends = [play.ball.holderId,play.ball.receiverId].map(id=>frame.positions.get(id)).filter(Boolean);
      const distance = Math.min(...ends.map(p=>Math.hypot(fieldX(p.x) - x, fieldY(p.y) - y)));
      attached = Math.max(0, 1 - distance / 28);
    }
    const dx = (x > right - 16 ? -1 : 1) * 17 * attached;
    const dy = (y < TOP + 16 ? 1 : -1) * 14 * attached;
    attr(badge,'transform',move(dx,dy));
    visible(tether, attached > .15);
    attr(tether,'d',`M${num(dx * .55)} ${num(dy * .55)}L${num(dx)} ${num(dy)}`);
  };
}

export function createFilmField(host, { model, theme = 'dark', onPick, reducedMotion = false }) {
  const doc = host.ownerDocument, win = doc.defaultView;
  const root = doc.createElement('div');
  root.className = 'film-pitch';
  root.dataset.filmRenderer = 'svg';
  host.append(root);
  const viewBox = `0 0 ${WIDTH} ${HEIGHT}`;
  const ground = svg(root,'svg',{viewBox,class:'film-ground','aria-hidden':true,focusable:false});
  const canvas = doc.createElement('canvas');
  canvas.setAttribute('aria-hidden','true');
  root.append(canvas);
  const foreground = svg(root,'svg',{viewBox,class:'film-chalk',role:'group','aria-label':t('film.fieldLabel')});
  markings(ground,model.calibrated);
  const {play} = model;
  const zones = (play.zones || []).map(zone => {
    const group = svg(ground,'g',{'data-film-zone':zone.id});
    svg(group,'ellipse',{cx:num(fieldX(zone.x)),cy:num(fieldY(zone.y)),rx:num(zone.rx*PITCH_WIDTH/100),
      ry:num(zone.ry*PITCH_HEIGHT/100),class:'film-zone-shape'});
    svg(group,'text',{x:num(fieldX(zone.x)),y:num(fieldY(zone.y)),class:'film-zone-label'},zone.label);
    return {zone,group};
  });
  const defs = svg(ground,'defs'), prefix = 'film-route-' + ++fieldCount;
  const routesLayer = svg(ground,'g',{transform:routeProjection});
  const flight = model.events.some(event=>event.id==='release') ? passFlightRoute(play) : null;
  const routes = (play.routes || []).map((route,i)=>addRoute(routesLayer,defs,route,prefix,i,flight));
  const movingBlocks = routes.filter(({route})=>route.blockTargets?.length);
  for (const note of play.annotations || []) {
    svg(ground,'text',{x:num(fieldX(note.x)),y:num(fieldY(note.y)),class:'film-annotation'},note.text);
  }
  const updateTeaching = addTeachingLayer(ground);
  const tokenLayer = svg(foreground, 'g', {class:'film-players'});
  const focusedLayer = svg(foreground, 'g', {class:'film-focused-players'});
  const tokens = model.players.map(player=>addToken(tokenLayer,player));
  const updateBall = addBall(foreground,play);
  let surface = null, frame = null, reference = null, focused = [], destroyed = false;

  function paintColors() {
    root.dataset.theme = theme === 'light' ? 'light' : 'dark';
    const light = theme === 'light';
    for (const [i,token] of tokens.entries()) {
      const {player} = token;
      const hex = displayColor(colorOK(player.color) ? player.color : COLORS[player.side] || COLORS.offense, light);
      attr(token.face,'fill',hex);
      attr(token.label,'fill',readableInk(hex));
      surface?.setFace(i,player.shape,hex);
    }
    for (const {route,path,end,cap} of routes) {
      const color = displayColor(colorOK(route.color) ? route.color : COLORS.route,light);
      attr(path,'stroke',color);
      attr(end,cap === 'dot' ? 'fill' : 'stroke',color);
    }
    for (const {zone,group} of zones) attr(group,'color',displayZoneColor(colorOK(zone.color) ? zone.color : COLORS.zone,light));
  }
  function refreshSurface() {
    const width = root.clientWidth, height = root.clientHeight;
    surface?.resize(width,height,win?.devicePixelRatio);
    if (frame) drawFaces();
  }
  function drawFaces() {
    attr(root,'data-film-renderer',surface?.draw() ? 'webgl' : 'svg');
  }
  function startSurface() {
    try { surface = createFilmPlayerSurface(canvas,tokens.length,WIDTH,HEIGHT); }
    catch { surface = null; }
    paintColors();
    if (frame) updatePositions();
    refreshSurface();
  }
  function lost(event) {
    event.preventDefault();
    surface?.destroy();
    surface = null;
    root.dataset.filmRenderer = 'svg';
  }
  function updatePositions() {
    for (const [i,token] of tokens.entries()) {
      const pos = frame.positions.get(token.player.id);
      const x = fieldX(pos.x), y = fieldY(pos.y);
      attr(token.group,'transform',move(x,y));
      surface?.setPosition(i,x,y);
    }
  }
  function render(nextFrame, focusIds = nextFrame.focus.map(item=>item.id), referenceFrame = null) {
    if (destroyed) return;
    frame = nextFrame;
    reference = referenceFrame;
    if (focusIds.length !== focused.length || focusIds.some((id,i)=>id !== focused[i])) {
      focused = [...focusIds];
      for (const {player,group} of tokens) {
        const picked = focused.includes(player.id);
        attr(group, 'aria-pressed', picked);
        // A defender can overlap the receiver at the chosen instant. Paint the
        // selected piece above the crowd without changing its hit target or clock.
        const layer = picked ? focusedLayer : tokenLayer;
        if (group.parentNode !== layer) {
          if (typeof layer.moveBefore === 'function') layer.moveBefore(group, null);
          else {
            const hadFocus = doc.activeElement === group;
            layer.append(group);
            if (hadFocus) group.focus({preventScroll:true});
          }
        }
      }
      for (const {route,path} of routes) {
        attr(path,'data-emphasis',!focused.length ? 'normal' : focused.includes(route.playerId) ? 'focus' : 'dim');
      }
    }
    updatePositions();
    for (const {route,path} of movingBlocks) attr(path,'d',routePath(dynamicBlockRoute(play,route,frame.time)));
    updateTeaching(frame,reference,reducedMotion);
    updateBall(frame);
    drawFaces();
    attr(root,'data-film-time',frame.time);
  }
  function choose(event) {
    if (event.type === 'keydown' && event.key !== 'Enter' && event.key !== ' ') return;
    const player = event.target.closest?.('[data-film-player]');
    if (!player || !foreground.contains(player)) return;
    event.preventDefault();
    event.stopPropagation();
    onPick?.(player.getAttribute('data-film-player'));
  }
  const resizeObserver = win?.ResizeObserver ? new win.ResizeObserver(refreshSurface) : null;
  if (resizeObserver) resizeObserver.observe(root);
  else win?.addEventListener('resize',refreshSurface);
  foreground.addEventListener('click',choose);
  foreground.addEventListener('keydown',choose);
  canvas.addEventListener('webglcontextlost',lost);
  canvas.addEventListener('webglcontextrestored',startSurface);
  startSurface();
  return {
    render,
    get renderer() { return root.dataset.filmRenderer; },
    setTheme(next) {
      theme = next;
      paintColors();
      if (frame) drawFaces();
    },
    setReducedMotion(enabled) {
      reducedMotion = enabled;
      if (frame) updateTeaching(frame,reference,reducedMotion);
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      resizeObserver?.disconnect();
      win?.removeEventListener('resize',refreshSurface);
      foreground.removeEventListener('click',choose);
      foreground.removeEventListener('keydown',choose);
      canvas.removeEventListener('webglcontextlost',lost);
      canvas.removeEventListener('webglcontextrestored',startSurface);
      surface?.destroy(true);
      surface = null;
      root.remove();
    },
  };
}
