import { t } from './i18n.js';
import { COLORS, escapeHTML as e, cubicSegments, animatedPlayer, animatedBall, passFlightRoute, dynamicBlockRoute } from './model.js';
import { projectBoardPoint } from './digital-projection.js';
import { digitalFieldPalette } from './digital-field-palette.js';
import { SCRIMMAGE_Y } from './field-metrics.js';
export { digitalFieldChrome } from './digital-field-palette.js';
export const project = p => ({ x: 18 + p.x * 9.64, y: 20 + p.y * 7.6 });
const n = x => Number(x).toFixed(2);
const xy = p => { const v = project(p); return `${n(v.x)},${n(v.y)}`; };
export function routePath(route) {
  const points = route.points;
  if (!points.length) return '';
  let d = `M${xy(points[0])}`;
  if (route.smooth && points.length > 2) {
    for (const [, b, c, end] of cubicSegments(points)) d += ` C${xy(b)} ${xy(c)} ${xy(end)}`;
  } else for (const p of points.slice(1)) d += ` L${xy(p)}`;
  return d;
}
export function motionPath(route) {
  const points = route.points.map(project), out = [points[0]];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i], length = Math.hypot(b.x - a.x, b.y - a.y), steps = Math.max(2, Math.round(length / 14));
    for (let j = 1; j < steps; j++) { const t = j / steps, offset = j % 2 ? 4 : -4; out.push({ x: a.x + (b.x - a.x) * t - (b.y - a.y) / (length || 1) * offset, y: a.y + (b.y - a.y) * t + (b.x - a.x) / (length || 1) * offset }); }
    out.push(b);
  }
  return out.map((p, i) => `${i ? 'L' : 'M'}${n(p.x)},${n(p.y)}`).join(' ');
}
function marker(id, color) {
  return `<marker id="${id}-arrow" viewBox="0 0 12 12" refX="10" refY="6" markerWidth="8" markerHeight="8" orient="auto-start-reverse" markerUnits="strokeWidth"><path d="M1 1 L11 6 L1 11" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></marker><marker id="${id}-bar" viewBox="0 0 12 16" refX="6" refY="8" markerWidth="9" markerHeight="12" orient="auto"><path d="M6 1 V15" fill="none" stroke="${color}" stroke-width="2.5" stroke-linecap="round"/></marker><marker id="${id}-dot" viewBox="0 0 12 12" refX="6" refY="6" markerWidth="6" markerHeight="6" orient="auto"><circle cx="6" cy="6" r="4" fill="${color}"/></marker>`;
}
function symbol(p, color) {
  if (p.shape === 'square') return `<rect x="-15" y="-15" width="30" height="30" rx="6" fill="${color}"/>`;
  if (p.shape === 'triangle') return `<path d="M0 -20 L21 15 L-21 15 Z" fill="${color}"/>`;
  return `<circle r="17" fill="${color}"/>`;
}
// Built-in default colours render through the product palette; custom colours pass through unchanged.
const DARK_DISPLAY = { '#ffdc42': '#eef0f3', '#c4a5f5': '#8fa7c3', '#ffd166': '#b7c0cc' };
const LIGHT_DISPLAY = { '#ffdc42': '#2b2f36', '#c4a5f5': '#5d7491', '#ffd166': '#6b7380' };
const inkOn = color => { const h = String(color).replace('#', ''); const v = h.length === 3 ? h.split('').map(c => c + c).join('') : h.slice(0, 6); const [r, g, b] = [0, 2, 4].map(i => parseInt(v.slice(i, i + 2), 16) / 255); return Number.isNaN(r) || .2126 * r + .7152 * g + .0722 * b > .55 ? '#111214' : '#ffffff'; };
export const displayColor = (color, light = false) => (light ? LIGHT_DISPLAY : DARK_DISPLAY)[String(color).toLowerCase()] || color;
export const displayZoneColor = (color, light = false) => light && String(color).toLowerCase() === COLORS.zone ? '#235477' : color;

function enamelSurface(paint, prefix, showGrid) {
  const wash = `${prefix}-enamel-wash`;
  const marks = [];
  if (showGrid) {
    const hashes = [];
    for (let i = 0; i < 10; i++) {
      const y = 20 + i * 76;
      const major = i % 2 === 0;
      if (i > 0) {
        marks.push(`<path data-field-mark="${major ? 'major' : 'minor'}" d="M18 ${y}H982" stroke="${major ? paint.major : paint.minor}" stroke-width="${major ? 1.6 : 1}"/>`);
        if (major) for (const x of [70, 930]) {
          marks.push(`<text x="${x}" y="${y - 8}" text-anchor="middle" fill="${paint.yard}" font-family="Arial,sans-serif" font-size="24" font-weight="700" letter-spacing="1.5">${50 - i * 5}</text>`);
        }
      }
      for (let yard = 1; yard < 5; yard++) {
        const at = n(y + yard * 15.2);
        hashes.push(`M18 ${at}h6M362 ${at}h9M638 ${at}h9M976 ${at}h6`);
      }
    }
    marks.push(`<path data-field-mark="hash" d="${hashes.join('')}" stroke="${paint.hash}" stroke-width="1.1"/>`);
  }
  const los = project({ x: 0, y: SCRIMMAGE_Y }).y;
  return `<g class="yard-lines" pointer-events="none" aria-hidden="true">
    <defs><linearGradient id="${wash}" x1="0%" y1="0%" x2="85%" y2="100%">
      <stop stop-color="${paint.top}"/><stop offset=".45" stop-color="${paint.middle}"/><stop offset="1" stop-color="${paint.bottom}"/>
    </linearGradient></defs>
    <rect width="1000" height="800" rx="12" fill="${paint.edge}"/>
    <rect x="3" y="3" width="994" height="794" rx="10" fill="url(#${wash})" stroke="${paint.outerRim}" stroke-width="1.5"/>
    <rect x="18" y="20" width="964" height="760" rx="2" fill="none" stroke="${paint.innerRim}" stroke-width="1.5"/>
    ${marks.join('')}
    <path data-field-mark="los" d="M18 ${los}H982" fill="none" stroke="${paint.los}" stroke-width="2" stroke-dasharray="13 7"/>
    <path d="M18 ${los - 4}l6 4-6 4zM982 ${los - 4}l-6 4 6 4z" fill="${paint.los}"/>
    <text x="968" y="${los - 9}" text-anchor="end" font-family="Arial,sans-serif" font-size="12" font-weight="700" letter-spacing="1" fill="${paint.los}">${t('support.los')}</text>
    <text x="500" y="49" text-anchor="middle" font-family="Arial,sans-serif" font-size="12" letter-spacing="2" fill="${paint.yard}">${t('support.direction')}</text>
  </g>`;
}

function traditionalSurface({ light, thumbnail, print, prefix, bg, ink, showGrid }) {
  // Graphite turf with mowing bands under a soft floodlight; chalk lines stay quiet so routes read first.
  const band = light ? '#eceef1' : '#1e2025', line = light ? '#d3d7dd' : '#33363d', major = light ? '#bfc4cc' : '#464a53';
  const lines = [];
  for (let i = 0; i <= 10; i++) {
    const y = 20 + i * 76;
    if (i < 10 && i % 2 === 0) lines.push(`<rect x="18" y="${y}" width="964" height="76" fill="${band}"/>`);
    if (showGrid) {
      lines.push(`<line x1="18" y1="${y}" x2="982" y2="${y}" stroke="${i % 2 ? line : major}" stroke-width="${i % 2 ? 1 : 1.5}"/>`);
      if (!thumbnail && i > 0 && i < 10) {
        const label = 50 - i * 5;
        lines.push(`<text x="75" y="${y + 13}" text-anchor="middle" fill="${ink}" font-size="40" font-weight="800" opacity=".3" font-family="'Big Shoulders Display','Arial Narrow',Arial,sans-serif">${label}</text><text x="925" y="${y + 13}" text-anchor="middle" fill="${ink}" font-size="40" font-weight="800" opacity=".3" font-family="'Big Shoulders Display','Arial Narrow',Arial,sans-serif">${label}</text>`);
      }
      if (i < 10) for (let j = 1; j < 5; j++) for (const x of [362, 638]) lines.push(`<line x1="${x}" y1="${y + j * 15.2}" x2="${x + 8}" y2="${y + j * 15.2}" stroke="${major}" stroke-width="1.3"/>`);
    }
  }
  const los = project({ x: 0, y: SCRIMMAGE_Y }).y;
  lines.push(`<line x1="18" y1="${los}" x2="982" y2="${los}" stroke="${light ? '#6b7079' : '#e6e8eb'}" stroke-width="1.6" stroke-dasharray="8 8" opacity=".65"/>`);
  if (!thumbnail) lines.push(`<text x="949" y="${los - 9}" fill="${ink}" font-size="12" opacity=".6" text-anchor="end" letter-spacing="1">${t('support.los')}</text>`);
  return `<rect width="1000" height="800" rx="${print ? 0 : 12}" fill="${bg}"/>${light || thumbnail ? '' : `<radialGradient id="${prefix}-flood" cx="50%" cy="50%" r="72%"><stop offset=".62" stop-color="#000000" stop-opacity="0"/><stop offset="1" stop-color="#000000" stop-opacity=".26"/></radialGradient>`}<rect x="18" y="20" width="964" height="760" fill="none" stroke="${line}" stroke-width="2"/><g class="yard-lines">${lines.join('')}</g>${light || thumbnail ? '' : `<rect x="18" y="20" width="964" height="760" fill="url(#${prefix}-flood)" pointer-events="none"/>`}${!thumbnail && !print ? `<text x="500" y="62" text-anchor="middle" fill="${ink}" opacity=".4" font-size="12" letter-spacing="2">${t('support.direction')}</text>` : ''}`;
}

export function fieldSVG(play, settings = {}, options = {}) {
  if (play.reference) return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 560" class="pitch-svg reference-svg" role="img" aria-label="${e(play.title)} · ${t('support.original')}"><rect width="1000" height="560" fill="#080808"/><image href="./${e(play.reference.image)}" width="1000" height="560" preserveAspectRatio="xMidYMid meet"/></svg>`;
  const { thumbnail = false, selected = null, selectedPlayerIds = [], time = 0, drawing = null, print = false, prefix = 'pitch' } = options;
  const selectedPlayers = new Set([...selectedPlayerIds, ...(selected?.type === 'players' ? selected.ids || [] : selected?.type === 'player' ? [selected.id] : [])]);
  const light = settings.fieldTheme === 'light' || print;
  const enamel = !thumbnail && !print && settings.visualMode === 'digital' ? digitalFieldPalette(settings.fieldTheme) : null;
  const bg = enamel?.middle || (light ? '#f4f5f7' : '#1a1c20');
  const ink = enamel?.ink || (light ? '#4a4f57' : '#dfe2e7');
  const showGrid = settings.showGrid !== false;
  const surface = enamel ? enamelSurface(enamel, prefix, showGrid) :
    traditionalSurface({ light, thumbnail, print, prefix, bg, ink, showGrid });
  const zones = play.zones.map(z => {
    const p = project(z), active = selected?.type === 'zone' && selected.id === z.id;
    const zoneColor = enamel ? displayZoneColor(z.color, light) : z.color;
    const defaultZone = enamel && String(z.color).toLowerCase() === COLORS.zone;
    const labelColor = enamel ? zoneColor : light ? '#447eaa' : z.color;
    return `<g data-zone="${e(z.id)}" class="zone-token" role="button" aria-label="${e(t('support.zone', { label: z.label }))}" tabindex="0"><ellipse cx="${n(p.x)}" cy="${n(p.y)}" rx="${n(z.rx * 9.64)}" ry="${n(z.ry * 7.6)}" fill="${zoneColor}" fill-opacity="${active ? '.23' : '.11'}" stroke="${zoneColor}" stroke-opacity="${defaultZone ? '.85' : '.65'}" stroke-width="${active ? 3 : 1.5}" stroke-dasharray="5 5"/><text x="${n(p.x)}" y="${n(p.y + 4)}" text-anchor="middle" fill="${labelColor}" font-size="12" font-weight="700" letter-spacing="1">${e(z.label)}</text></g>`;
  }).join('');
  let defs = '';
  const routes = play.routes.map((r, i) => {
    const active = selected?.type === 'route' && selected.id === r.id, markerId = `${prefix}-r${i}`, stroke = displayColor(r.color, light);
    defs += marker(markerId, stroke);
    const displayRoute = dynamicBlockRoute(play, r, time);
    const d = r.kind === 'motion' ? motionPath(r) : routePath(displayRoute);
    const dash = r.kind === 'pass' ? '4 7' : r.optional ? '9 6' : '';
    // The dashed pattern carries the option on enamel, including at small projection sizes.
    const optionalOpacity = enamel && stroke !== r.color ? .96 : .65;
    let path = `<g data-route="${e(r.id)}" role="button" aria-label="${e(t(r.optional ? 'support.option_route' : 'support.route', { label: play.players.find(p => p.id === r.playerId)?.label ?? '' }))}" tabindex="0"><path d="${d}" fill="none" stroke="transparent" stroke-width="20" vector-effect="non-scaling-stroke" class="route-hit"/><path class="route-stroke" ${dash ? '' : 'pathLength="1"'} d="${d}" fill="none" stroke="${stroke}" stroke-width="${active ? 4 : thumbnail ? 4 : 2.8}" stroke-linejoin="round" stroke-linecap="round" ${dash ? `stroke-dasharray="${dash}"` : ''} opacity="${r.optional ? optionalOpacity : 1}" ${r.stagedBlock && r.kind === 'block' ? `marker-mid="url(#${markerId}-bar)"` : ''} marker-end="url(#${markerId}-${r.endCap})" pointer-events="none"/></g>`;
    if (active && !thumbnail && !print && time === 0) path += displayRoute.points.slice(1).map((p, j) => { const v = project(p), attributes = `data-point="${j + 1}" data-route-id="${e(r.id)}" cx="${n(v.x)}" cy="${n(v.y)}"`; return `<circle ${attributes} r="16" fill="transparent" class="point-hit"/><circle ${attributes} r="6" fill="${stroke}" stroke="${bg}" stroke-width="2" class="point-handle" pointer-events="none"/>`; }).join('');
    return path;
  }).join('');
  const draftInk=enamel?.ink || '#ffffff', draftKeyline=enamel?.middle || '#111214';
  if (drawing?.points?.length) {
    defs += marker(`${prefix}-draft`, draftInk);
  }
  const draft = drawing?.points?.length ? `<g class="draft-layer" pointer-events="none"><path d="${routePath({ points: drawing.points, smooth: false })}" stroke="${draftInk}" stroke-width="3" fill="none" marker-end="url(#${prefix}-draft-arrow)"/><path class="draft-preview" stroke="${draftInk}" stroke-width="2.5" stroke-dasharray="7 6" fill="none" opacity=".65"/><circle class="draft-cursor" r="6" fill="${draftInk}" stroke="${draftKeyline}" stroke-width="2" visibility="hidden"/>${drawing.points.slice(1).map((point, i) => { const v=project(point); return `<circle cx="${n(v.x)}" cy="${n(v.y)}" r="5" fill="${draftInk}" stroke="${draftKeyline}" stroke-width="2"/><text x="${n(v.x+11)}" y="${n(v.y-9)}" fill="${draftInk}" font-size="14">${i+1}</text>`; }).join('')}</g>` : '';
  const ringFinish = enamel
    ? `pathLength="100" stroke-dasharray="21 4" stroke-dashoffset="10.5" stroke="${enamel.focus}"`
    : `stroke="${light ? '#17191c' : '#ffffff'}"`;
  const players = play.players.map(p => {
    const v = project(animatedPlayer(play, p, time)), active = selectedPlayers.has(p.id);
    const fill = displayColor(p.color, light);
    return `<g data-player="${e(p.id)}" transform="translate(${n(v.x)} ${n(v.y)})" role="button" aria-label="${e(p.label)} ${e(p.name)}" aria-pressed="${active}" tabindex="0" class="player-token"><g class="player-symbol">${active && !thumbnail && !print ? `<circle class="selection-ring" r="25" fill="none" ${ringFinish} stroke-width="2"/>` : ''}<circle class="player-hit" r="27" fill="transparent"/><g class="player-body">${symbol(p, fill)}</g><text class="player-label" y="6" text-anchor="middle" font-family="'Big Shoulders Display','Arial Narrow',Arial,sans-serif" font-size="${p.label.length > 3 ? 13 : 17}" font-weight="800" fill="${inkOn(fill)}" pointer-events="none">${e(p.label)}</text>${settings.showNames && p.name && !thumbnail ? `<text y="34" text-anchor="middle" font-size="12" fill="${ink}" pointer-events="none">${e(p.name)}</text>` : ''}</g></g>`;
  }).join('');
  const annotations = play.annotations.map(a => { const p = project(a), active = selected?.type === 'annotation' && selected.id === a.id; return `<g data-annotation="${e(a.id)}" role="button" aria-label="${e(t('support.annotation', { text: a.text }))}" tabindex="0"><text x="${n(p.x)}" y="${n(p.y)}" fill="${active ? (light ? '#17191c' : '#ffffff') : ink}" font-size="18" font-weight="600" paint-order="stroke" stroke="${bg}" stroke-width="5" stroke-linejoin="round">${e(a.text)}</text></g>`; }).join('');
  const b = animatedBall(play, time), bv = b ? project(b) : null;
  const ball = bv ? `<g id="${prefix}-ball" transform="translate(${n(bv.x + 23)} ${n(bv.y - 11)})" pointer-events="none"><ellipse rx="9" ry="5.5" fill="#b77439" stroke="#f3d1a0" stroke-width="1.5" transform="rotate(-35)"/><path d="M-4 0 H4 M-2 -2 V2 M1 -2 V2" stroke="#ffffff" stroke-width="1" transform="rotate(-35)"/></g>` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 800" class="pitch-svg"${enamel ? ' data-field-surface="enamel"' : ''} ${thumbnail || print ? 'aria-hidden="true"' : `role="application" aria-label="${t('support.drawing_area')}" tabindex="0"`}><defs>${defs}</defs>${surface}${zones}${routes}${draft}<g id="${prefix}-players">${players}</g>${annotations}${ball}</svg>`;
}

export function updateAnimation(svg, play, time, prefix = 'pitch') {
  if (!svg) return;
  const nodes = new Map([...svg.querySelectorAll('[data-player]')].map(node => [node.dataset.player,node]));
  for (const p of play.players) {
    const v = project(animatedPlayer(play, p, time));
    const node = nodes.get(p.id);
    node?.setAttribute('transform', `translate(${n(v.x)} ${n(v.y)})`);
  }
  const flight = time > 0 ? passFlightRoute(play) : null;
  for (const node of svg.querySelectorAll('[data-route]')) {
    const route = play.routes.find(r => r.id === node.dataset.route);
    if (route?.kind === 'pass' || route?.blockTargets) {
      const displayRoute = flight?.id === route.id ? flight : dynamicBlockRoute(play, route, time);
      for (const path of node.querySelectorAll('path')) path.setAttribute('d', routePath(displayRoute));
    }
  }
  const b = animatedBall(play, time), v = b ? project(b) : null;
  if (v) svg.querySelector(`#${prefix}-ball`)?.setAttribute('transform', `translate(${n(v.x + 23)} ${n(v.y - 11)})`);
}

// Bind changing model objects to the current SVG children once per gesture.
// Route handles are siblings of the route, and a block can belong to another
// player while depending on a defender in the moving group.
export function bindGestureGeometry(svg, play, gesture) {
  let backgroundChanged = false;
  function set(node, name, value) {
    if (!node || node.getAttribute(name) === value) return false;
    node.setAttribute(name, value);
    return true;
  }
  function setBackground(node, name, value) {
    if (set(node, name, value)) backgroundChanged = true;
  }
  if (gesture.type === 'zone' || gesture.type === 'new-zone' || gesture.type === 'annotation') {
    const isZone = gesture.type !== 'annotation';
    const kind = isZone ? 'zone' : 'annotation';
    const id = gesture.type === 'new-zone' ? gesture.zoneId : gesture.id;
    const object = (isZone ? play.zones : play.annotations).find(item => item.id === id);
    const node = [...svg.querySelectorAll(`[data-${kind}]`)].find(item => item.dataset[kind] === id);
    const ellipse = node?.querySelector('ellipse'), text = node?.querySelector('text');
    return () => {
      backgroundChanged = false;
      const v = project(object);
      if (ellipse) {
        setBackground(ellipse, 'cx', n(v.x));
        setBackground(ellipse, 'cy', n(v.y));
        setBackground(ellipse, 'rx', n(object.rx * 9.64));
        setBackground(ellipse, 'ry', n(object.ry * 7.6));
      }
      setBackground(text, 'x', n(v.x));
      setBackground(text, 'y', n(v.y + (isZone ? 4 : 0)));
      return backgroundChanged;
    };
  }

  const ids = new Set(gesture.type === 'players' ? gesture.ids : gesture.type === 'player' ? [gesture.id] : []);
  const players = new Map(play.players.filter(p => ids.has(p.id)).map(p => [p.id, p]));
  const changedRoutes = new Set(gesture.waypoint?.routeIds);
  const affected = play.routes.filter(route => ids.has(route.playerId) || route.blockTargets?.some(id => ids.has(id)) || changedRoutes.has(route.id));
  const routes = new Map(affected.map(route => [route.id, { route, paths: [], handles: [] }]));
  const markers = [];
  if (players.size) for (const node of svg.querySelectorAll('[data-player]')) {
    const player = players.get(node.dataset.player);
    if (player) markers.push({ player, node });
  }
  if (routes.size) {
    for (const node of svg.querySelectorAll('[data-route]')) {
      const binding = routes.get(node.dataset.route);
      if (binding) {
        binding.paths = node.querySelectorAll('path');
        if (gesture.type === 'point' && binding.route.id === gesture.routeId && !binding.route.stagedBlock) {
          binding.stagedStroke = node.querySelector('[marker-mid]');
        }
      }
    }
    for (const node of svg.querySelectorAll('[data-point]')) {
      routes.get(node.dataset.routeId)?.handles.push({ node, index: Number(node.dataset.point) });
    }
  }
  const ball = ids.has(play.ball.holderId) || ids.has(play.ball.receiverId) ? svg.querySelector('#pitch-ball') : null;
  return () => {
    backgroundChanged = false;
    for (const { player, node } of markers) {
      const v = project(animatedPlayer(play, player, 0));
      set(node, 'transform', `translate(${n(v.x)} ${n(v.y)})`);
    }
    for (const binding of routes.values()) {
      const { route, paths, handles } = binding;
      const display = dynamicBlockRoute(play, route, 0);
      const d = display.kind === 'motion' ? motionPath(display) : routePath(display);
      for (const path of paths) setBackground(path, 'd', d);
      if (binding.stagedStroke) {
        binding.stagedStroke.removeAttribute('marker-mid');
        binding.stagedStroke = null;
        backgroundChanged = true;
      }
      for (const { node, index } of handles) {
        const v = project(display.points[index]);
        set(node, 'cx', n(v.x));
        set(node, 'cy', n(v.y));
      }
    }
    if (ball) {
      const point = animatedBall(play, 0);
      if (point) {
        const v = project(point);
        const moved = set(ball, 'transform', `translate(${n(v.x + 23)} ${n(v.y - 11)})`);
        // Player and ball meshes are separate from the WebGL field texture.
        // At time zero an immediate pass can already show a trail on the turf.
        if (moved && play.ball.passAt === 0 && play.ball.receiverId) backgroundChanged = true;
      }
    }
    return backgroundChanged;
  };
}
export function previewDraft(svg, drawing, point) {
  const path=svg?.querySelector('.draft-preview'), cursor=svg?.querySelector('.draft-cursor');
  if (!path || !drawing || !cursor) return;
  path.setAttribute('d',point ? routePath({ points:[drawing.points.at(-1), point] }) : '');
  cursor.setAttribute('visibility',point?'visible':'hidden');
  if(point) { const v=project(point); cursor.setAttribute('cx',n(v.x));cursor.setAttribute('cy',n(v.y)); }
}

function fieldMatrix(svg) {
  try {
    const matrix = svg.getScreenCTM?.();
    if (matrix && ['a','b','c','d','e','f'].every(key => Number.isFinite(matrix[key]))) return matrix;
  } catch { /* A detached SVG may have no screen matrix yet. */ }
  const box = svg.getBoundingClientRect();
  return { a:(box.width || 1000)/1000, b:0, c:0, d:(box.height || 800)/800, e:box.left || 0, f:box.top || 0 };
}

function minimumScale(matrix) {
  // The smaller singular value also covers skewed/rotated 2.5D fields. Using
  // only the x scale can leave one dimension smaller than the touch target.
  const sum = matrix.a**2 + matrix.b**2 + matrix.c**2 + matrix.d**2;
  const determinant = matrix.a * matrix.d - matrix.b * matrix.c;
  const squared = (sum - Math.sqrt(Math.max(0, sum**2 - 4 * determinant**2))) / 2;
  return Math.sqrt(Math.max(squared, 1e-8));
}

const targetSize = ({ pointerType = 'mouse', minTargetPx } = {}) => Number.isFinite(minTargetPx) && minTargetPx > 0
  ? minTargetPx : pointerType === 'touch' || pointerType === 'pen' ? 44 : 24;

/** Resize invisible targets after render/resize/zoom; visible pieces stay fixed. */
export function syncFieldHitTargets(svg, options = {}) {
  if (!svg || svg.classList.contains('reference-svg')) return;
  const size = targetSize(options), radius = size / (2 * minimumScale(fieldMatrix(svg)));
  for (const node of svg.querySelectorAll('.player-hit')) node.setAttribute('r', n(Math.max(27, radius)));
  for (const node of svg.querySelectorAll('.point-hit')) node.setAttribute('r', n(Math.max(6, radius)));
  for (const node of svg.querySelectorAll('.route-hit')) node.setAttribute('stroke-width', n(size));
}

function fieldNodeCenter(svg, node, matrix) {
  const player = node.matches('[data-player]');
  const translation = player ? /translate\(\s*([-+\d.e]+)[,\s]+([-+\d.e]+)\s*\)/i.exec(node.getAttribute('transform') || '') : null;
  const x = player ? Number(translation?.[1]) : Number(node.getAttribute('cx'));
  const y = player ? Number(translation?.[2]) : Number(node.getAttribute('cy'));
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  const stage = svg.closest('.pitch-stage.is-perspective');
  if (stage) {
    const box = stage.getBoundingClientRect(), projected = projectBoardPoint(x,y);
    return { x:box.left + projected.x * box.width/1000, y:box.top + projected.y * box.height/800 };
  }
  return { x:matrix.a*x + matrix.c*y + matrix.e, y:matrix.b*x + matrix.d*y + matrix.f };
}

/** Nearby players/waypoints, nearest first. The host presents ambiguity choices.
 * Uses CSS-pixel distances so overlapping expanded targets do not choose the
 * last SVG node by accident. `element` can start the existing pointer gesture.
 */
export function fieldHitCandidates(svg, event, options = {}) {
  if (!svg || !Number.isFinite(event?.clientX) || !Number.isFinite(event?.clientY)) return [];
  const matrix = fieldMatrix(svg), size = targetSize({ pointerType:event.pointerType, ...options });
  const scale = minimumScale(matrix), candidates = [];
  for (const node of svg.querySelectorAll('[data-player],.point-hit')) {
    const player = !!node.dataset.player;
    if (options.playersOnly && !player) continue;
    const center = fieldNodeCenter(svg,node,matrix);
    if (!center) continue;
    const distance = Math.hypot(event.clientX-center.x,event.clientY-center.y);
    if (distance > Math.max(size/2, (player ? 27 : 6) * scale)) continue;
    candidates.push(player
      ? { type:'player', id:node.dataset.player, label:node.getAttribute('aria-label') || node.dataset.player, distance, element:node }
      : { type:'point', id:node.dataset.routeId, routeId:node.dataset.routeId, index:Number(node.dataset.point), distance, element:node });
  }
  return candidates.sort((a,b) => a.distance-b.distance || (a.type===b.type ? 0 : a.type==='point' ? -1 : 1));
}
