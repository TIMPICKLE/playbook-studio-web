import { escapeHTML as e, cubicSegments, animatedPlayer, animatedBall, COLORS } from './model.js';
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
function motionPath(route) {
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
export function fieldSVG(play, settings = {}, options = {}) {
  const { thumbnail = false, selected = null, time = 0, drawing = null, print = false, prefix = 'pitch' } = options;
  const light = settings.fieldTheme === 'light' || print;
  const bg = light ? '#f0f3e9' : '#153c30', line = light ? '#b7c8b3' : '#426051', ink = light ? '#4e6e55' : '#b4c7b8';
  const lines = [];
  for (let i = 0; i <= 10; i++) {
    const y = 20 + i * 76;
    if (settings.showGrid !== false) {
      lines.push(`<line x1="18" y1="${y}" x2="982" y2="${y}" stroke="${line}" stroke-width="${i % 2 ? 1 : 1.5}"/>`);
      if (!thumbnail && i > 0 && i < 10) {
        const label = 50 - i * 5;
        lines.push(`<text x="75" y="${y + 9}" text-anchor="middle" fill="${ink}" font-size="26" opacity=".55" font-family="Arial,sans-serif">${label}</text><text x="925" y="${y + 9}" text-anchor="middle" fill="${ink}" font-size="26" opacity=".55" font-family="Arial,sans-serif">${label}</text>`);
      }
      if (i < 10) for (let j = 1; j < 5; j++) for (const x of [362, 638]) lines.push(`<line x1="${x}" y1="${y + j * 15.2}" x2="${x + 8}" y2="${y + j * 15.2}" stroke="${line}" stroke-width="1.3"/>`);
    }
  }
  const los = project({ x: 0, y: 67 }).y;
  lines.push(`<line x1="18" y1="${los}" x2="982" y2="${los}" stroke="${light ? '#90a877' : '#bdd09c'}" stroke-width="1.6" stroke-dasharray="8 8" opacity=".65"/>`);
  if (!thumbnail) lines.push(`<text x="949" y="${los - 9}" fill="${ink}" font-size="11" text-anchor="end" letter-spacing="2">LINE OF SCRIMMAGE</text>`);
  const zones = play.zones.map(z => {
    const p = project(z), active = selected?.type === 'zone' && selected.id === z.id;
    return `<g data-zone="${e(z.id)}" class="zone-token" role="button" aria-label="防守区域 ${e(z.label)}" tabindex="0"><ellipse cx="${n(p.x)}" cy="${n(p.y)}" rx="${n(z.rx * 9.64)}" ry="${n(z.ry * 7.6)}" fill="${z.color}" fill-opacity="${active ? '.23' : '.11'}" stroke="${z.color}" stroke-opacity=".65" stroke-width="${active ? 3 : 1.5}" stroke-dasharray="5 5"/><text x="${n(p.x)}" y="${n(p.y + 4)}" text-anchor="middle" fill="${light ? '#447eaa' : z.color}" font-size="12" font-weight="700" letter-spacing="1">${e(z.label)}</text></g>`;
  }).join('');
  let defs = '';
  const routes = play.routes.map((r, i) => {
    const active = selected?.type === 'route' && selected.id === r.id, markerId = `${prefix}-r${i}`, stroke = light && r.color === COLORS.offense ? '#356b3d' : light && r.color === '#ffd166' ? '#bd8610' : r.color;
    defs += marker(markerId, stroke);
    const d = r.kind === 'motion' ? motionPath(r) : routePath(r);
    const dash = r.kind === 'pass' ? '4 7' : r.optional ? '9 6' : '';
    let path = `<g data-route="${e(r.id)}" role="button" aria-label="${e(play.players.find(p => p.id === r.playerId)?.label)} 的${r.optional ? '选项' : ''}路线" tabindex="0"><path d="${d}" fill="none" stroke="transparent" stroke-width="20" class="route-hit"/><path d="${d}" fill="none" stroke="${stroke}" stroke-width="${active ? 4 : thumbnail ? 4 : 2.8}" stroke-linejoin="round" stroke-linecap="round" ${dash ? `stroke-dasharray="${dash}"` : ''} opacity="${r.optional ? .65 : 1}" marker-end="url(#${markerId}-${r.endCap})" pointer-events="none"/></g>`;
    if (active && !thumbnail && !print && time === 0) path += r.points.slice(1).map((p, j) => { const v = project(p); return `<circle data-point="${j + 1}" data-route-id="${e(r.id)}" cx="${n(v.x)}" cy="${n(v.y)}" r="6" fill="${stroke}" stroke="${bg}" stroke-width="2" class="point-handle"/>`; }).join('');
    return path;
  }).join('');
  if (drawing?.points?.length > 1) {
    const r = { points: drawing.points, smooth: false };
    defs += marker(`${prefix}-draft`, '#ffd166');
  }
  const draft = drawing?.points?.length > 1 ? `<path d="${routePath({ points: drawing.points, smooth: false })}" stroke="#ffd166" stroke-width="3" stroke-dasharray="6 5" fill="none" pointer-events="none" marker-end="url(#${prefix}-draft-arrow)"/>` : '';
  const players = play.players.map(p => {
    const v = project(animatedPlayer(play, p, time)), active = selected?.type === 'player' && selected.id === p.id;
    const fill = light && p.color === COLORS.offense ? '#356b3d' : p.color;
    return `<g data-player="${e(p.id)}" transform="translate(${n(v.x)} ${n(v.y)})" role="button" aria-label="${e(p.label)} ${e(p.name)}" tabindex="0" class="player-token">${active && !thumbnail && !print ? '<circle r="24" fill="none" stroke="#ffd166" stroke-width="2.5" stroke-dasharray="4 3"/>' : ''}${symbol(p, fill)}<text y="4.5" text-anchor="middle" font-family="Arial,sans-serif" font-size="${p.label.length > 3 ? 9 : 12}" font-weight="800" fill="${light && fill === '#356b3d' ? '#ffffff' : '#163325'}" pointer-events="none">${e(p.label)}</text>${settings.showNames && p.name && !thumbnail ? `<text y="34" text-anchor="middle" font-size="12" fill="${ink}" pointer-events="none">${e(p.name)}</text>` : ''}</g>`;
  }).join('');
  const annotations = play.annotations.map(a => { const p = project(a), active = selected?.type === 'annotation' && selected.id === a.id; return `<g data-annotation="${e(a.id)}" role="button" aria-label="标注 ${e(a.text)}" tabindex="0"><text x="${n(p.x)}" y="${n(p.y)}" fill="${active ? '#ffd166' : ink}" font-size="18" font-weight="600" paint-order="stroke" stroke="${bg}" stroke-width="5" stroke-linejoin="round">${e(a.text)}</text></g>`; }).join('');
  const b = animatedBall(play, time), bv = b ? project(b) : null;
  const ball = bv ? `<g id="${prefix}-ball" transform="translate(${n(bv.x + 23)} ${n(bv.y - 11)})" pointer-events="none"><ellipse rx="9" ry="5.5" fill="#b77439" stroke="#f3d1a0" stroke-width="1.5" transform="rotate(-35)"/><path d="M-4 0 H4 M-2 -2 V2 M1 -2 V2" stroke="#ffffff" stroke-width="1" transform="rotate(-35)"/></g>` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 800" class="pitch-svg" ${thumbnail || print ? 'aria-hidden="true"' : 'role="application" aria-label="战术绘图区" tabindex="0"'}><defs>${defs}</defs><rect width="1000" height="800" rx="${print ? 0 : 12}" fill="${bg}"/><rect x="18" y="20" width="964" height="760" fill="none" stroke="${line}" stroke-width="2"/><g class="yard-lines">${lines.join('')}</g>${!thumbnail && !print ? `<text x="500" y="65" text-anchor="middle" fill="${ink}" opacity=".36" font-size="11" letter-spacing="5">ATTACK DIRECTION ↑</text>` : ''}${zones}${routes}${draft}<g id="${prefix}-players">${players}</g>${annotations}${ball}</svg>`;
}

export function updateAnimation(svg, play, time, prefix = 'pitch') {
  if (!svg) return;
  for (const p of play.players) {
    const v = project(animatedPlayer(play, p, time));
    const node = [...svg.querySelectorAll('[data-player]')].find(n => n.dataset.player === p.id);
    node?.setAttribute('transform', `translate(${n(v.x)} ${n(v.y)})`);
  }
  const b = animatedBall(play, time), v = b ? project(b) : null;
  if (v) svg.querySelector(`#${prefix}-ball`)?.setAttribute('transform', `translate(${n(v.x + 23)} ${n(v.y - 11)})`);
}
