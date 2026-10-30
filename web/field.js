import { t } from './i18n.js';
import { escapeHTML as e, cubicSegments, animatedPlayer, animatedBall, passFlightRoute } from './model.js';
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
export function fieldSVG(play, settings = {}, options = {}) {
  if (play.reference) return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 560" class="pitch-svg reference-svg" role="img" aria-label="${e(play.title)} · ${t('support.original')}"><rect width="1000" height="560" fill="#080808"/><image href="./${e(play.reference.image)}" width="1000" height="560" preserveAspectRatio="xMidYMid meet"/></svg>`;
  const { thumbnail = false, selected = null, time = 0, drawing = null, print = false, prefix = 'pitch' } = options;
  const light = settings.fieldTheme === 'light' || print;
  // Graphite turf with mowing bands under a soft floodlight; chalk lines stay quiet so routes read first.
  const bg = light ? '#f4f5f7' : '#1a1c20', band = light ? '#eceef1' : '#1e2025', line = light ? '#d3d7dd' : '#33363d', major = light ? '#bfc4cc' : '#464a53', ink = light ? '#4a4f57' : '#dfe2e7';
  const lines = [];
  for (let i = 0; i <= 10; i++) {
    const y = 20 + i * 76;
    if (i < 10 && i % 2 === 0) lines.push(`<rect x="18" y="${y}" width="964" height="76" fill="${band}"/>`);
    if (settings.showGrid !== false) {
      lines.push(`<line x1="18" y1="${y}" x2="982" y2="${y}" stroke="${i % 2 ? line : major}" stroke-width="${i % 2 ? 1 : 1.5}"/>`);
      if (!thumbnail && i > 0 && i < 10) {
        const label = 50 - i * 5;
        lines.push(`<text x="75" y="${y + 13}" text-anchor="middle" fill="${ink}" font-size="40" font-weight="800" opacity=".3" font-family="'Big Shoulders Display','Arial Narrow',Arial,sans-serif">${label}</text><text x="925" y="${y + 13}" text-anchor="middle" fill="${ink}" font-size="40" font-weight="800" opacity=".3" font-family="'Big Shoulders Display','Arial Narrow',Arial,sans-serif">${label}</text>`);
      }
      if (i < 10) for (let j = 1; j < 5; j++) for (const x of [362, 638]) lines.push(`<line x1="${x}" y1="${y + j * 15.2}" x2="${x + 8}" y2="${y + j * 15.2}" stroke="${major}" stroke-width="1.3"/>`);
    }
  }
  const los = project({ x: 0, y: 67 }).y;
  lines.push(`<line x1="18" y1="${los}" x2="982" y2="${los}" stroke="${light ? '#6b7079' : '#e6e8eb'}" stroke-width="1.6" stroke-dasharray="8 8" opacity=".65"/>`);
  if (!thumbnail) lines.push(`<text x="949" y="${los - 9}" fill="${ink}" font-size="12" opacity=".6" text-anchor="end" letter-spacing="1">${t('support.los')}</text>`);
  const zones = play.zones.map(z => {
    const p = project(z), active = selected?.type === 'zone' && selected.id === z.id;
    return `<g data-zone="${e(z.id)}" class="zone-token" role="button" aria-label="${e(t('support.zone', { label: z.label }))}" tabindex="0"><ellipse cx="${n(p.x)}" cy="${n(p.y)}" rx="${n(z.rx * 9.64)}" ry="${n(z.ry * 7.6)}" fill="${z.color}" fill-opacity="${active ? '.23' : '.11'}" stroke="${z.color}" stroke-opacity=".65" stroke-width="${active ? 3 : 1.5}" stroke-dasharray="5 5"/><text x="${n(p.x)}" y="${n(p.y + 4)}" text-anchor="middle" fill="${light ? '#447eaa' : z.color}" font-size="12" font-weight="700" letter-spacing="1">${e(z.label)}</text></g>`;
  }).join('');
  let defs = '';
  const routes = play.routes.map((r, i) => {
    const active = selected?.type === 'route' && selected.id === r.id, markerId = `${prefix}-r${i}`, stroke = displayColor(r.color, light);
    defs += marker(markerId, stroke);
    const d = r.kind === 'motion' ? motionPath(r) : routePath(r);
    const dash = r.kind === 'pass' ? '4 7' : r.optional ? '9 6' : '';
    let path = `<g data-route="${e(r.id)}" role="button" aria-label="${e(t(r.optional ? 'support.option_route' : 'support.route', { label: play.players.find(p => p.id === r.playerId)?.label ?? '' }))}" tabindex="0"><path d="${d}" fill="none" stroke="transparent" stroke-width="20" class="route-hit"/><path class="route-stroke" ${dash ? '' : 'pathLength="1"'} d="${d}" fill="none" stroke="${stroke}" stroke-width="${active ? 4 : thumbnail ? 4 : 2.8}" stroke-linejoin="round" stroke-linecap="round" ${dash ? `stroke-dasharray="${dash}"` : ''} opacity="${r.optional ? .65 : 1}" marker-end="url(#${markerId}-${r.endCap})" pointer-events="none"/></g>`;
    if (active && !thumbnail && !print && time === 0) path += r.points.slice(1).map((p, j) => { const v = project(p); return `<circle data-point="${j + 1}" data-route-id="${e(r.id)}" cx="${n(v.x)}" cy="${n(v.y)}" r="6" fill="${stroke}" stroke="${bg}" stroke-width="2" class="point-handle"/>`; }).join('');
    return path;
  }).join('');
  if (drawing?.points?.length) {
    defs += marker(`${prefix}-draft`, '#ffffff');
  }
  const draft = drawing?.points?.length ? `<g class="draft-layer" pointer-events="none"><path d="${routePath({ points: drawing.points, smooth: false })}" stroke="#ffffff" stroke-width="3" fill="none" marker-end="url(#${prefix}-draft-arrow)"/><path class="draft-preview" stroke="#ffffff" stroke-width="2.5" stroke-dasharray="7 6" fill="none" opacity=".65"/><circle class="draft-cursor" r="6" fill="#ffffff" stroke="#111214" stroke-width="2" visibility="hidden"/>${drawing.points.slice(1).map((point, i) => { const v=project(point); return `<circle cx="${n(v.x)}" cy="${n(v.y)}" r="5" fill="#ffffff" stroke="#111214" stroke-width="2"/><text x="${n(v.x+11)}" y="${n(v.y-9)}" fill="#ffffff" font-size="14">${i+1}</text>`; }).join('')}</g>` : '';
  const players = play.players.map(p => {
    const v = project(animatedPlayer(play, p, time)), active = selected?.type === 'player' && selected.id === p.id;
    const fill = displayColor(p.color, light);
    return `<g data-player="${e(p.id)}" transform="translate(${n(v.x)} ${n(v.y)})" role="button" aria-label="${e(p.label)} ${e(p.name)}" aria-pressed="${active}" tabindex="0" class="player-token"><g class="player-symbol">${active && !thumbnail && !print ? `<circle class="selection-ring" r="25" fill="none" stroke="${light ? '#17191c' : '#ffffff'}" stroke-width="2"/>` : ''}<circle class="player-hit" r="27" fill="transparent"/><g class="player-body">${symbol(p, fill)}</g><text class="player-label" y="6" text-anchor="middle" font-family="'Big Shoulders Display','Arial Narrow',Arial,sans-serif" font-size="${p.label.length > 3 ? 13 : 17}" font-weight="800" fill="${inkOn(fill)}" pointer-events="none">${e(p.label)}</text>${settings.showNames && p.name && !thumbnail ? `<text y="34" text-anchor="middle" font-size="12" fill="${ink}" pointer-events="none">${e(p.name)}</text>` : ''}</g></g>`;
  }).join('');
  const annotations = play.annotations.map(a => { const p = project(a), active = selected?.type === 'annotation' && selected.id === a.id; return `<g data-annotation="${e(a.id)}" role="button" aria-label="${e(t('support.annotation', { text: a.text }))}" tabindex="0"><text x="${n(p.x)}" y="${n(p.y)}" fill="${active ? (light ? '#17191c' : '#ffffff') : ink}" font-size="18" font-weight="600" paint-order="stroke" stroke="${bg}" stroke-width="5" stroke-linejoin="round">${e(a.text)}</text></g>`; }).join('');
  const b = animatedBall(play, time), bv = b ? project(b) : null;
  const ball = bv ? `<g id="${prefix}-ball" transform="translate(${n(bv.x + 23)} ${n(bv.y - 11)})" pointer-events="none"><ellipse rx="9" ry="5.5" fill="#b77439" stroke="#f3d1a0" stroke-width="1.5" transform="rotate(-35)"/><path d="M-4 0 H4 M-2 -2 V2 M1 -2 V2" stroke="#ffffff" stroke-width="1" transform="rotate(-35)"/></g>` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 800" class="pitch-svg" ${thumbnail || print ? 'aria-hidden="true"' : `role="application" aria-label="${t('support.drawing_area')}" tabindex="0"`}><defs>${defs}</defs><rect width="1000" height="800" rx="${print ? 0 : 12}" fill="${bg}"/>${light || thumbnail ? '' : `<radialGradient id="${prefix}-flood" cx="50%" cy="50%" r="72%"><stop offset=".62" stop-color="#000000" stop-opacity="0"/><stop offset="1" stop-color="#000000" stop-opacity=".26"/></radialGradient>`}<rect x="18" y="20" width="964" height="760" fill="none" stroke="${line}" stroke-width="2"/><g class="yard-lines">${lines.join('')}</g>${light || thumbnail ? '' : `<rect x="18" y="20" width="964" height="760" fill="url(#${prefix}-flood)" pointer-events="none"/>`}${!thumbnail && !print ? `<text x="500" y="62" text-anchor="middle" fill="${ink}" opacity=".4" font-size="12" letter-spacing="2">${t('support.direction')}</text>` : ''}${zones}${routes}${draft}<g id="${prefix}-players">${players}</g>${annotations}${ball}</svg>`;
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
    if (route?.kind === 'pass') for (const path of node.querySelectorAll('path')) path.setAttribute('d', routePath(flight?.id === route.id ? flight : route));
  }
  const b = animatedBall(play, time), v = b ? project(b) : null;
  if (v) svg.querySelector(`#${prefix}-ball`)?.setAttribute('transform', `translate(${n(v.x + 23)} ${n(v.y - 11)})`);
}

// Preserve the SVG, focus, and pointer capture during a gesture. No markup replacement.
export function updateGeometry(svg, play) {
  updateAnimation(svg, play, 0);
  const routes = new Map(play.routes.map(route => [route.id,route]));
  for (const node of svg.querySelectorAll('[data-route]')) {
    const route = routes.get(node.dataset.route); if (!route) continue;
    const d = route.kind === 'motion' ? motionPath(route) : routePath(route);
    for (const path of node.querySelectorAll('path')) path.setAttribute('d', d);
  }
  for (const node of svg.querySelectorAll('[data-point]')) {
    const point = routes.get(node.dataset.routeId)?.points[Number(node.dataset.point)];
    if (point) { const v=project(point); node.setAttribute('cx',n(v.x)); node.setAttribute('cy',n(v.y)); }
  }
  for (const node of svg.querySelectorAll('[data-zone]')) {
    const zone=play.zones.find(z=>z.id===node.dataset.zone); if (!zone) continue;
    const v=project(zone), ellipse=node.querySelector('ellipse'), text=node.querySelector('text');
    ellipse.setAttribute('cx',n(v.x)); ellipse.setAttribute('cy',n(v.y)); ellipse.setAttribute('rx',n(zone.rx*9.64)); ellipse.setAttribute('ry',n(zone.ry*7.6)); text.setAttribute('x',n(v.x)); text.setAttribute('y',n(v.y+4));
  }
  for (const node of svg.querySelectorAll('[data-annotation]')) {
    const annotation=play.annotations.find(a=>a.id===node.dataset.annotation); if(!annotation)continue;
    const v=project(annotation), text=node.querySelector('text'); text.setAttribute('x',n(v.x)); text.setAttribute('y',n(v.y));
  }
}
export function previewDraft(svg, drawing, point) {
  const path=svg?.querySelector('.draft-preview'), cursor=svg?.querySelector('.draft-cursor');
  if (!path || !drawing || !cursor) return;
  path.setAttribute('d',point ? routePath({ points:[drawing.points.at(-1), point] }) : '');
  cursor.setAttribute('visibility',point?'visible':'hidden');
  if(point) { const v=project(point); cursor.setAttribute('cx',n(v.x));cursor.setAttribute('cy',n(v.y)); }
}
