export const VERSION = 1;
export const STORAGE_KEY = 'playbook-studio:v1';
export const BOOKS = { offense: '进攻', defense: '防守', special: '特勤' };
export const COLORS = { offense: '#ffdc42', defense: '#c4a5f5', route: '#ffdc42', pass: '#ffd166', zone: '#88bfff' };
export const clone = value => JSON.parse(JSON.stringify(value));
export const uid = () => globalThis.crypto?.randomUUID?.() || `id-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
export const clamp = (n, min = 0, max = 100) => Math.max(min, Math.min(max, n));
export const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const colorOK = value => /^#[0-9a-f]{6}$/i.test(value);

const player = (label, x, y, side = 'offense') => ({ id: uid(), label, x, y, side, name: '', color: COLORS[side], shape: side === 'defense' ? 'square' : 'circle' });
export const FORMATIONS = ['Gun Trips', 'Gun Doubles', 'I Formation', 'Singleback', '4–3', '3–4', 'Nickel', 'Field Goal'];

export function formationPlayers(formation = 'Gun Trips', count = 11, side) {
  const defense = side === 'defense' || ['4–3', '3–4', 'Nickel'].includes(formation);
  let points;
  if (defense) {
    points = formation === '3–4'
      ? [['LE', 40, 57], ['NT', 50, 57], ['RE', 60, 57], ['OLB', 29, 53], ['MLB', 44, 48], ['MLB', 56, 48], ['OLB', 71, 53], ['CB', 15, 52], ['CB', 86, 52], ['SS', 37, 34], ['FS', 64, 29]]
      : [['DE', 34, 57], ['DT', 45, 57], ['DT', 56, 57], ['DE', 67, 57], ['W', 36, 46], ['M', 51, 46], ['S', 65, 46], ['CB', 14, 53], ['CB', 86, 53], ['SS', 35, 31], ['FS', 66, 29]];
    if (formation === 'Nickel') points[6] = ['NB', 75, 45];
  } else {
    points = [['LT', 40, 67], ['LG', 45, 67], ['C', 50, 67], ['RG', 55, 67], ['RT', 60, 67], ['QB', 50, 77], ['RB', 60, 79], ['X', 13, 67], ['Y', 72, 70], ['Z', 87, 67], ['H', 80, 73]];
    if (formation === 'Gun Doubles') { points[8] = ['Y', 26, 70]; points[10] = ['H', 73, 70]; }
    if (formation === 'I Formation') { points[5] = ['QB', 50, 71]; points[6] = ['RB', 50, 85]; points[8] = ['TE', 66, 67]; points[10] = ['FB', 50, 78]; }
    if (formation === 'Singleback') { points[5] = ['QB', 50, 71]; points[6] = ['RB', 50, 83]; points[8] = ['TE', 66, 67]; points[10] = ['H', 25, 70]; }
    if (formation === 'Field Goal') { points[5] = ['H', 50, 80]; points[6] = ['K', 62, 88]; points[7] = ['LE', 27, 67]; points[8] = ['TE', 67, 67]; points[9] = ['RE', 73, 67]; points[10] = ['TE', 33, 67]; }
  }
  // In reduced-player leagues, retain skill positions rather than only linemen.
  const order = defense ? [0, 1, 3, 5, 7, 8, 9, 10, 2, 4, 6] : [2, 5, 6, 7, 9, 8, 10, 0, 4, 1, 3];
  const chosen = count < 11 ? order.slice(0, count).map(i => points[i]) : points;
  const result = chosen.map(p => player(...p, defense ? 'defense' : 'offense'));
  if (count === 12) result.push(player(defense ? 'DB' : 'W', defense ? 50 : 20, defense ? 22 : 72, defense ? 'defense' : 'offense'));
  return result;
}

export function makePlay({ title = '新战术', formation = 'Gun Trips', book = 'offense', count = 11 } = {}) {
  const players = formationPlayers(formation, count, book === 'defense' ? 'defense' : 'offense');
  return { id: uid(), title, book, formation, category: book === 'defense' ? '区域防守' : '传球', personnel: count === 11 ? '11 personnel' : `${count} 人制`, notes: '', favorite: false, players, routes: [], zones: [], annotations: [], ball: { holderId: players.find(p => p.label === 'QB')?.id || players[0].id, receiverId: '', passAt: 2, arriveAt: 3 }, createdAt: new Date().toISOString() };
}

export function addRoute(play, label, waypoints, kind = 'route', options = {}) {
  const p = play.players.find(p => p.label === label);
  if (!p) return;
  play.routes.push({ id: uid(), playerId: p.id, points: [{ x: p.x, y: p.y }, ...waypoints.map(([x, y]) => ({ x, y }))], kind, color: kind === 'pass' ? COLORS.pass : p.color, smooth: false, endCap: kind === 'block' ? 'bar' : 'arrow', delay: 0, duration: kind === 'block' ? 2 : 4, optional: false, ...options });
}

export function starterWorkspace() {
  const mesh = makePlay({ title: 'Mesh · 浅交叉', formation: 'Gun Trips' });
  mesh.notes = 'Y 与 H 在防守前方交叉，保持 4–6 码深度，避免相撞。\nQB：先读 Y，再看 RB 的外摆；X 拉深牵制安全卫。\n这是一组教学示例，需根据球队能力调整时序。';
  mesh.favorite = true;
  addRoute(mesh, 'X', [[13, 18]]);
  addRoute(mesh, 'Y', [[66, 58], [30, 58]], 'route', { color: '#ffd166', delay: .2, duration: 4.2 });
  addRoute(mesh, 'H', [[68, 52], [24, 52]], 'route', { duration: 4.5 });
  addRoute(mesh, 'Z', [[87, 39], [74, 27]]);
  addRoute(mesh, 'RB', [[66, 73], [91, 60]], 'route', { smooth: true, duration: 3 });
  ['LT', 'LG', 'C', 'RG', 'RT'].forEach(label => { const p = mesh.players.find(p => p.label === label); addRoute(mesh, label, [[p.x, 61]], 'block'); });
  mesh.ball.receiverId = mesh.players.find(p => p.label === 'Y').id;
  const verticals = makePlay({ title: 'Four Verticals · 四纵深', formation: 'Gun Doubles' });
  for (const label of ['X', 'Y', 'Z', 'H']) { const p = verticals.players.find(p => p.label === label); addRoute(verticals, label, [[p.x, 16]], 'route', { duration: 4.8 }); }
  addRoute(verticals, 'RB', [[61, 62], [82, 58]], 'route', { smooth: true });
  verticals.notes = '外侧接球手纵向拉伸防线，内侧走 seam。观察单高位/双高位安全卫，再决定落点。';
  const flood = makePlay({ title: 'Flood · 右侧三层', formation: 'Gun Trips' });
  addRoute(flood, 'Z', [[87, 17]]); addRoute(flood, 'Y', [[72, 44], [94, 44]]); addRoute(flood, 'RB', [[65, 73], [92, 63]], 'route', { smooth: true }); addRoute(flood, 'X', [[13, 35], [60, 35]]);
  flood.notes = '右侧形成深、中、短三层落点。QB 按深到浅阅读同一侧覆盖。';
  const slants = makePlay({ title: 'Slants · 快速斜插', formation: 'Gun Doubles' });
  addRoute(slants, 'X', [[13, 59], [37, 35]]); addRoute(slants, 'Z', [[87, 59], [62, 35]]); addRoute(slants, 'H', [[73, 53], [85, 48]]); addRoute(slants, 'Y', [[26, 53], [40, 48]]);
  const zone = makePlay({ title: 'Inside Zone · 内侧区域跑', formation: 'Singleback' });
  zone.category = '跑球'; addRoute(zone, 'RB', [[50, 72], [57, 55], [57, 35]], 'route', { smooth: true });
  for (const label of ['LT', 'LG', 'C', 'RG', 'RT']) { const p = zone.players.find(p => p.label === label); addRoute(zone, label, [[p.x + 3, 58]], 'block'); }
  zone.ball.holderId = zone.players.find(p => p.label === 'RB').id;
  const cover3 = makePlay({ title: 'Cover 3 · 三深区', formation: '4–3', book: 'defense' });
  cover3.favorite = true;
  for (const [label, x, y] of [['CB', 14, 27], ['FS', 50, 20], ['SS', 80, 27], ['W', 25, 49], ['M', 48, 46], ['S', 72, 49]]) {
    const p = cover3.players.find(p => p.label === label && !cover3.routes.some(r => r.playerId === p.id));
    if (p) { cover3.routes.push({ id: uid(), playerId: p.id, points: [{ x: p.x, y: p.y }, { x, y }], kind: 'route', color: '#88bfff', smooth: false, endCap: 'arrow', delay: 0, duration: 3, optional: false }); cover3.zones.push({ id: uid(), x, y, rx: label === 'CB' || label === 'FS' || label === 'SS' ? 16 : 12, ry: 12, color: '#88bfff', label: label === 'CB' || label === 'FS' || label === 'SS' ? 'DEEP ⅓' : 'UNDER' }); }
  }
  cover3.notes = '三名防守者负责纵深，各守三分之一；下层覆盖者保护短传区域。示例区域仅作教学示意。';
  const blitz = makePlay({ title: 'Nickel Blitz · 槽位冲传', formation: 'Nickel', book: 'defense' }); blitz.category = '冲传';
  addRoute(blitz, 'NB', [[68, 64], [53, 77]], 'route', { color: '#ffd166', duration: 3 });
  for (const label of ['DE', 'DT', 'M']) { const p = blitz.players.find(p => p.label === label); addRoute(blitz, label, [[p.x, 75]], 'route', { duration: 3 }); }
  const goal = makePlay({ title: 'Field Goal · 射门保护', formation: 'Field Goal', book: 'special' }); goal.category = '射门'; goal.personnel = 'Field Goal Unit';
  addRoute(goal, 'K', [[53, 80]], 'route', { duration: 2 }); goal.ball.holderId = goal.players.find(p => p.label === 'H').id;
  return { team: { name: 'TIM FOOTBALL', subtitle: '2026 SEASON', accent: '#46217a' }, plays: [mesh, verticals, flood, slants, zone, cover3, blitz, goal], roster: [{ id: uid(), name: 'TIM', number: '12', position: 'QB' }, { id: uid(), name: 'Alex', number: '10', position: 'WR' }, { id: uid(), name: 'Chris', number: '22', position: 'RB' }], formations: [], settings: { league: 11, fieldTheme: 'dark', showGrid: true, showNames: false } };
}

export function mirrorPlay(play) {
  const p = clone(play);
  p.players.forEach(v => { v.x = 100 - v.x; });
  p.routes.forEach(r => r.points.forEach(v => { v.x = 100 - v.x; }));
  p.zones.forEach(v => { v.x = 100 - v.x; });
  p.annotations.forEach(v => { v.x = 100 - v.x; });
  return p;
}

export function movePlayer(play, id, x, y) {
  const p = play.players.find(p => p.id === id); if (!p) return;
  let dx = clamp(x) - p.x, dy = clamp(y) - p.y;
  // Keep the entire attached route in bounds; never shear or clip its geometry.
  const all = [{ x: p.x, y: p.y }, ...play.routes.filter(r => r.playerId === id).flatMap(r => r.points)];
  dx = clamp(dx, -Math.min(...all.map(v => v.x)), 100 - Math.max(...all.map(v => v.x)));
  dy = clamp(dy, -Math.min(...all.map(v => v.y)), 100 - Math.max(...all.map(v => v.y)));
  p.x += dx; p.y += dy;
  play.routes.filter(r => r.playerId === id).forEach(r => r.points.forEach(v => { v.x += dx; v.y += dy; }));
}

// Both drawing and animation use the same Catmull–Rom cubic segments.
export function cubicSegments(points) {
  return points.slice(1).map((p2, i) => {
    const p1 = points[i], p0 = points[Math.max(0, i - 1)], p3 = points[Math.min(points.length - 1, i + 2)];
    return [p1, { x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6 }, { x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6 }, p2];
  });
}
export function sampledRoute(route) {
  if (!route.smooth || route.points.length < 3) return route.points;
  const out = [route.points[0]];
  for (const [a, b, c, d] of cubicSegments(route.points)) for (let i = 1; i <= 16; i++) {
    const t = i / 16, u = 1 - t;
    out.push({ x: u ** 3 * a.x + 3 * u * u * t * b.x + 3 * u * t * t * c.x + t ** 3 * d.x, y: u ** 3 * a.y + 3 * u * u * t * b.y + 3 * u * t * t * c.y + t ** 3 * d.y });
  }
  return out;
}
export function pointAlong(points, ratio) {
  if (!points.length) return { x: 50, y: 50 };
  if (points.length === 1) return { ...points[0] };
  if (ratio <= 0) return { ...points[0] };
  if (ratio >= 1) return { ...points.at(-1) };
  // A normalized field is wider than it is tall on screen. Account for scale.
  const lengths = points.slice(1).map((p, i) => Math.hypot((p.x - points[i].x) * 9.64, (p.y - points[i].y) * 7.6));
  const total = lengths.reduce((a, b) => a + b, 0);
  if (!total) return { ...points[0] };
  let distance = clamp(ratio, 0, 1) * total;
  for (let i = 0; i < lengths.length; i++) {
    if (distance <= lengths[i] || i === lengths.length - 1) {
      const t = lengths[i] ? distance / lengths[i] : 0;
      return { x: points[i].x + (points[i + 1].x - points[i].x) * t, y: points[i].y + (points[i + 1].y - points[i].y) * t };
    }
    distance -= lengths[i];
  }
  return { ...points.at(-1) };
}
export function animatedPlayer(play, player, time) {
  const routes = play.routes.filter(r => r.playerId === player.id && !r.optional && r.kind !== 'pass');
  const route = routes.find(r => r.kind === 'motion' && time < r.delay + r.duration) || routes.find(r => r.kind === 'route') || routes.find(r => r.kind === 'block') || routes[0];
  if (!route) return { x: player.x, y: player.y };
  return pointAlong(sampledRoute(route), (time - route.delay) / route.duration);
}
// Keep the drawn pass's bends while anchoring release/catch to the actual players.
// Shared by the flight animation and the rehearsal path in both visual modes.
export function passFlightRoute(play) {
  const holder = play.players.find(p => p.id === play.ball.holderId);
  const receiver = play.players.find(p => p.id === play.ball.receiverId);
  if (!holder || !receiver) return null;
  const route = play.routes.findLast(r => r.kind === 'pass' && r.playerId === holder.id && !r.optional && r.points.length > 1);
  if (!route) return null;
  const a = animatedPlayer(play, holder, play.ball.passAt), b = animatedPlayer(play, receiver, play.ball.arriveAt);
  const first = route.points[0], last = route.points.at(-1);
  return { ...route, points: route.points.map((p, i) => {
    const t = i / (route.points.length - 1);
    return { x: p.x + (a.x-first.x)*(1-t) + (b.x-last.x)*t, y: p.y + (a.y-first.y)*(1-t) + (b.y-last.y)*t };
  }) };
}
export function animatedBall(play, time) {
  const holder = play.players.find(p => p.id === play.ball.holderId);
  if (!holder) return null;
  const receiver = play.players.find(p => p.id === play.ball.receiverId);
  if (!receiver || time < play.ball.passAt) return animatedPlayer(play, holder, time);
  if (time >= play.ball.arriveAt) return animatedPlayer(play, receiver, time);
  const a = animatedPlayer(play, holder, play.ball.passAt), b = animatedPlayer(play, receiver, play.ball.arriveAt);
  const t = (time - play.ball.passAt) / (play.ball.arriveAt - play.ball.passAt);
  const route = passFlightRoute(play);
  if (route) return pointAlong(sampledRoute(route), t);
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}
export const animationLength = play => Math.max(6, play.ball.arriveAt, ...play.routes.filter(r => !r.optional).map(r => r.delay + r.duration));

export function encodeWorkspace(data) { return JSON.stringify({ format: 'playbook-studio', version: VERSION, exportedAt: new Date().toISOString(), data }, null, 2); }
const fail = message => { throw new Error(message); };
const text = (v, max, name) => typeof v === 'string' && v.length <= max ? v : fail(`${name}格式不正确`);
const array = (v, max, name) => Array.isArray(v) && v.length <= max ? v : fail(`${name}数量或格式不正确`);
const num = (v, min, max, name) => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max ? v : fail(`${name}超出范围`);
const id = v => text(v, 100, 'ID');
const col = v => colorOK(v) ? v : fail('颜色格式不正确');
const choice = (v, choices, name) => choices.includes(v) ? v : fail(`${name}无效`);
function unique(items, name) { if (new Set(items.map(x => x.id)).size !== items.length) fail(`${name}包含重复 ID`); return items; }
export function validatePlayers(value) {
  return unique(array(value, 40, '球员').map(p => ({ id: id(p.id), label: text(p.label, 10, '位置名称'), name: text(p.name ?? '', 80, '姓名'), x: num(p.x, 0, 100, '横坐标'), y: num(p.y, 0, 100, '纵坐标'), side: choice(p.side, ['offense', 'defense'], '球队'), color: col(p.color), shape: choice(p.shape, ['circle', 'square', 'triangle'], '图形') })), '球员');
}
export function validatePlay(p) {
  const diagramSource = p.diagramSource == null ? null : { ...validateReference(p.diagramSource), traceVersion: choice(p.diagramSource.traceVersion, [1], '识别版本') };
  const reference = p.reference == null ? null : validateReference(p.reference);
  if (reference && diagramSource) fail('战术不能同时为原图和可编辑版本');
  const players = validatePlayers(p.players); if (!players.length && !reference) fail('战术至少需要一个球员');
  if (reference && (players.length || p.routes?.length || p.zones?.length || p.annotations?.length)) fail('原图战术不能包含未经验证的可编辑坐标');
  const playerIds = new Set(players.map(p => p.id));
  const routes = unique(array(p.routes, 100, '路线').map(r => {
    if (!playerIds.has(r.playerId)) fail('路线关联的球员不存在');
    const points = array(r.points, 200, '路线节点').map(v => ({ x: num(v.x, 0, 100, '节点横坐标'), y: num(v.y, 0, 100, '节点纵坐标') }));
    if (points.length < 2) fail('路线至少需要两个节点');
    const owner = players.find(p => p.id === r.playerId);
    if (Math.hypot(points[0].x - owner.x, points[0].y - owner.y) > .01) fail('路线起点与球员位置不一致');
    return { id: id(r.id), playerId: r.playerId, points, kind: choice(r.kind, ['route', 'block', 'motion', 'pass'], '路线类型'), color: col(r.color), smooth: !!r.smooth, endCap: choice(r.endCap, ['arrow', 'bar', 'dot'], '路线终点'), delay: num(r.delay, 0, 10, '启动延迟'), duration: num(r.duration, .2, 10, '路线时长'), optional: !!r.optional };
  }), '路线');
  const zones = unique(array(p.zones, 60, '区域').map(z => ({ id: id(z.id), x: num(z.x, 0, 100, '区域横坐标'), y: num(z.y, 0, 100, '区域纵坐标'), rx: num(z.rx, 1, 50, '区域半径'), ry: num(z.ry, 1, 50, '区域半径'), color: col(z.color), label: text(z.label, 80, '区域名称') })), '区域');
  const annotations = unique(array(p.annotations, 100, '标注').map(a => ({ id: id(a.id), x: num(a.x, 0, 100, '标注横坐标'), y: num(a.y, 0, 100, '标注纵坐标'), text: text(a.text, 200, '标注内容') })), '标注');
  if (!p.ball || (reference ? p.ball.holderId !== '' || p.ball.receiverId !== '' : !playerIds.has(p.ball.holderId) || p.ball.receiverId && !playerIds.has(p.ball.receiverId))) fail('持球人或接球人不存在');
  const passAt = num(p.ball.passAt, 0, 10, '传球时间'), arriveAt = num(p.ball.arriveAt, .1, 15, '接球时间');
  if (arriveAt <= passAt) fail('接球时间须晚于传球时间');
  return { id: id(p.id), title: text(p.title, 120, '战术名称'), book: choice(p.book, Object.keys(BOOKS), '战术本'), formation: text(p.formation, 100, '阵型'), category: text(p.category, 60, '分类'), personnel: text(p.personnel, 80, '人员组'), notes: text(p.notes, 10000, '说明'), favorite: !!p.favorite, players, routes, zones, annotations, ball: { holderId: p.ball.holderId, receiverId: p.ball.receiverId || '', passAt, arriveAt }, createdAt: text(p.createdAt || '', 100, '创建时间'), ...(reference ? { reference } : {}), ...(diagramSource ? { diagramSource } : {}) };
}
export function validateReference(r) {
  for (const key of ['provider', 'catalogId', 'team', 'game', 'sourceUrl', 'image']) text(r[key], 600, '战术来源');
  if (r.provider !== 'huddle.gg' || !['eagles', 'ravens'].includes(r.team)) fail('战术来源无效');
  if (!new RegExp(`^${r.team}-[a-f0-9]{20}$`).test(r.catalogId)) fail('来源战术 ID 无效');
  if (!/^Madden \d{2}$/.test(r.game)) fail('游戏版本无效');
  if (!/^data\/huddle-art\/[a-f0-9]{20}\.jpg$/.test(r.image)) fail('原图路径无效');
  const version = r.game.split(' ')[1];
  if (!new RegExp(`^https://huddle\\.gg/${version}/playbooks/${r.team}-off/[a-z0-9-]+/[a-z0-9-]+/$`).test(r.sourceUrl)) fail('战术来源链接无效');
  return { provider: r.provider, catalogId: r.catalogId, team: r.team, game: r.game, sourceUrl: r.sourceUrl, image: r.image };
}
export function decodeWorkspace(raw) {
  if (typeof raw !== 'string' || raw.length > 5_000_000) fail('请导入 5 MB 以内的 JSON 文件');
  const parsed = JSON.parse(raw);
  if (parsed.format !== 'playbook-studio' || parsed.version !== VERSION || !parsed.data) fail('这不是支持的 Playbook Studio 战术本文件');
  const d = parsed.data;
  const plays = unique(array(d.plays, 500, '战术').map(validatePlay), '战术');
  if (!plays.length) fail('文件中没有战术');
  const team = { name: text(d.team.name, 80, '球队名称'), subtitle: text(d.team.subtitle, 80, '球队副标题'), accent: col(d.team.accent) };
  const roster = unique(array(d.roster, 200, '名单').map(r => ({ id: id(r.id), name: text(r.name, 80, '姓名'), number: text(r.number, 5, '号码'), position: text(r.position, 15, '位置') })), '名单');
  const formations = unique(array(d.formations, 100, '阵型模板').map(f => {
    const players = validatePlayers(f.players); if (!players.length) fail('阵型至少需要一个球员');
    return { id: id(f.id), name: text(f.name, 100, '模板名称'), book: choice(f.book, Object.keys(BOOKS), '模板类型'), players };
  }), '模板');
  const settings = { league: choice(d.settings.league, [6, 7, 8, 9, 11, 12], '人数'), fieldTheme: choice(d.settings.fieldTheme, ['dark', 'light'], '球场主题'), showGrid: !!d.settings.showGrid, showNames: !!d.settings.showNames };
  return { team, plays, roster, formations, settings };
}

export class History {
  constructor(limit = 50) { this.limit = limit; this.past = []; this.future = []; }
  record(state) { this.past.push(clone(state)); if (this.past.length > this.limit) this.past.shift(); this.future = []; }
  undo(state) { if (!this.past.length) return null; this.future.push(clone(state)); return this.past.pop(); }
  redo(state) { if (!this.future.length) return null; this.past.push(clone(state)); return this.future.pop(); }
}
