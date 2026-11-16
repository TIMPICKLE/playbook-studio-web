import { z } from './vendor/assistant-zod.js';
import { COLORS, FORMATIONS, clone, formationPlayers, mirrorPlay, movePlayer, uid } from './model.js';
import { spaceMaddenLine } from './madden-model.js';
import { linkRosterPlayer, personnelMatches } from './board-personnel.js';
import { LEAGUE_SIZES, defaultFormation, getPlayLeague, resolveFormation } from './game-formats.js';
import { movePlayerGroup, removePlayerGroup } from './player-group.js';

const id = z.string().min(1).max(100);
const color = z.string().regex(/^#[0-9a-f]{6}$/i);
const coordinate = z.number().min(0).max(100);
const point = z.strictObject({ x: coordinate, y: coordinate });
const playerIds = z.array(id).min(1).max(40).refine(values=>new Set(values).size===values.length,'Choose each player only once.');
const points = z.array(point).min(2).max(200);
const side = z.enum(['offense', 'defense']);
const shape = z.enum(['circle', 'square', 'triangle']);
const routeKind = z.enum(['route', 'block', 'motion', 'pass']);
const count = z.union(LEAGUE_SIZES.map(value => z.literal(value)));
const playerFields = { label: z.string().max(10), name: z.string().max(80), x: coordinate, y: coordinate, side, color, shape, rosterId: z.string().max(100) };
const routeFields = { kind: routeKind, color, smooth: z.boolean(), endCap: z.enum(['arrow', 'bar', 'dot']), optional: z.boolean(), delay: z.number().min(0).max(10), duration: z.number().min(.2).max(10), points };
const zoneFields = { x: coordinate, y: coordinate, rx: z.number().min(1).max(50), ry: z.number().min(1).max(50), color, label: z.string().max(80) };
const annotationFields = { x: coordinate, y: coordinate, text: z.string().max(200) };
const patch = fields => z.strictObject(fields).partial().refine(value => Object.keys(value).length > 0, 'An update must include at least one field.');
const bindings = {
  player_add:['add-player'],player_update:['player:props','field:drag-player'],object_remove:['delete-selection'],players_move:['field:drag-players','selection-nudge'],players_remove:['delete-selection'],
  route_add:['field:draw-route'],route_update:['route:props','field:drag-point'],zone_add:['field:draw-zone'],zone_update:['zone:props','field:drag-zone'],
  annotation_add:['create-text'],annotation_update:['annotation:props','field:drag-annotation'],ball_update:['ball:props'],play_update:['play:props','favorite'],
  play_mirror:['mirror'],formation_apply:['apply-formation'],opponents_set:['opponents'],line_space:['space-madden-line'],personnel_apply:['apply-personnel'],
};
const command = (id, schema, description, destructive = false) => ({ id, schema, description, destructive, undoable: true,uiBindings:bindings[id] || [] });

/** The executable play commands are shared by manual controls and the board assistant. */
export const EDITOR_PLAY_COMMANDS = [
  command('player_add', z.strictObject({ kind: z.literal('player_add'), ...z.strictObject(playerFields).partial().shape, side, as: id.optional() }), 'Add one player marker, optionally linked to an existing roster player.'),
  command('player_update', z.strictObject({ kind: z.literal('player_update'), playerId: id, patch: patch(playerFields) }), 'Update a player. Moving coordinates translates attached routes; a manual name change clears the roster link.'),
  command('players_move', z.strictObject({kind:z.literal('players_move'),playerIds,dx:z.number().min(-100).max(100),dy:z.number().min(-100).max(100)}), 'Move a real group by one shared delta in board units (2 board units = 1 yard). Attached routes and motion links move together. The whole group stops at the nearest field edge; relative spacing is preserved.'),
  command('players_remove', z.strictObject({kind:z.literal('players_remove'),playerIds}), 'Remove a real group and its routes in one transaction. Cleans ball and blocking references and retains at least one player.', true),
  command('object_remove', z.strictObject({ kind: z.literal('object_remove'), objectType: z.enum(['player', 'route', 'zone', 'annotation']), objectId: id }), 'Remove an object, clean its references, and retain a valid ball carrier.', true),
  command('route_add', z.strictObject({ kind: z.literal('route_add'), playerId: id, routeKind, points, color: color.optional(), smooth: z.boolean().optional(), endCap: routeFields.endCap.optional(), optional: z.boolean().optional(), delay: routeFields.delay.optional(), duration: routeFields.duration.optional(), as: id.optional() }), 'Draw a complete route, block, motion or pass path. Points include the starting point at its owner or active motion endpoint.'),
  command('route_update', z.strictObject({ kind: z.literal('route_update'), routeId: id, patch: patch(routeFields) }), 'Update route geometry, timing or styling. Points include the start; linked motion routes remain coherent.'),
  command('zone_add', z.strictObject({ kind: z.literal('zone_add'), x: coordinate, y: coordinate, rx: zoneFields.rx, ry: zoneFields.ry, color: color.optional(), label: zoneFields.label.optional(), as: id.optional() }), 'Add a custom coverage ellipse with explicit geometry and label.'),
  command('zone_update', z.strictObject({ kind: z.literal('zone_update'), zoneId: id, patch: patch(zoneFields) }), 'Update an existing coverage ellipse.'),
  command('annotation_add', z.strictObject({ kind: z.literal('annotation_add'), ...annotationFields, as: id.optional() }), 'Add text at explicit board coordinates.'),
  command('annotation_update', z.strictObject({ kind: z.literal('annotation_update'), annotationId: id, patch: patch(annotationFields) }), 'Update text or the position of an existing annotation.'),
  command('ball_update', z.strictObject({ kind: z.literal('ball_update'), patch: patch({ holderId: id, receiverId: z.string().max(100), passAt: z.number().min(0).max(10), arriveAt: z.number().min(.1).max(15) }) }), 'Set the ball carrier, receiver or pass timing. An empty receiver means no pass.'),
  command('play_update', z.strictObject({ kind: z.literal('play_update'), patch: patch({ title: z.string().max(120), category: z.string().max(60), personnel: z.string().max(80), notes: z.string().max(10000), favorite: z.boolean() }) }), 'Update play details, coach notes or favorite status.'),
  command('play_mirror', z.strictObject({ kind: z.literal('play_mirror') }), 'Mirror players, routes, zones and annotations horizontally.'),
  command('formation_apply', z.union([
    z.strictObject({ kind: z.literal('formation_apply'), formation: z.enum(FORMATIONS), count: count.optional() }),
    z.strictObject({ kind: z.literal('formation_apply'), formationId: id, count: count.optional() }),
  ]), 'Replace home-side markers with a built-in or saved formation, using the current play league unless count is supplied. Clears replaced players\' routes and resets their ball assignments; existing opponents and their routes remain.', true),
  command('opponents_set', z.strictObject({ kind: z.literal('opponents_set'), enabled: z.boolean(), count: count.optional() }), 'Ensure the opposing formation is present or absent. Existing opposing players are retained when enabling.', true),
  command('line_space', z.strictObject({ kind: z.literal('line_space') }), 'Use the existing safe spacing adjustment for an editable Madden offensive line.'),
  command('personnel_apply', z.strictObject({ kind: z.literal('personnel_apply'), groupId: id }), 'Apply matching starters from an existing depth-chart group without moving role markers.'),
];
export const EditorPlayOperationSchema = z.union(EDITOR_PLAY_COMMANDS.map(item => item.schema));
const byKind = new Map(EDITOR_PLAY_COMMANDS.map(item => [item.id, item]));
const fail = message => { throw new Error(message); };
const find = (items, value, name) => items.find(item => item.id === value) || fail(`${name} not found on this play.`);
const has = (value, key) => Object.hasOwn(value, key);
const close = (a, b) => Math.hypot(a.x - b.x, a.y - b.y) <= .01;

function translateRoute(route, anchor) {
  const dx = anchor.x - route.points[0].x, dy = anchor.y - route.points[0].y;
  const translated = route.points.map(point => ({ x: point.x + dx, y: point.y + dy }));
  if (translated.some(point => point.x < 0 || point.x > 100 || point.y < 0 || point.y > 100)) fail('Moving the route would put a waypoint outside the field.');
  route.points = translated;
  if (dx || dy) delete route.intent;
}

function relinkMotion(play, before, after) {
  if (before.kind !== 'motion' || before.optional) return;
  const owner = find(play.players, before.playerId, 'Player');
  const oldEnd = before.points.at(-1), remainsActive = after?.kind === 'motion' && !after.optional;
  const anchor = remainsActive ? after.points.at(-1) : owner;
  const oldFinish = before.delay + before.duration, newFinish = remainsActive ? after.delay + after.duration : 0;
  for (const route of play.routes) {
    if (route.id === before.id || route.playerId !== before.playerId || route.kind === 'motion' || !close(route.points[0], oldEnd)) continue;
    translateRoute(route, anchor);
    route.delay = Math.max(0, route.delay - oldFinish) + newFinish;
  }
}

function removePlayers(play, ids) {
  return removePlayerGroup(play,[...ids]);
}

function bindRoster(play, marker, patch, roster) {
  if (has(patch, 'rosterId')) {
    const player = patch.rosterId ? roster.find(player => player.id === patch.rosterId) || fail('Roster player not found.') : undefined;
    if (player && has(patch, 'name') && patch.name !== player.name) fail('Player name conflicts with the selected roster player.');
    linkRosterPlayer(marker, player);
    if (!player && has(patch, 'name')) marker.name = patch.name;
  } else if (has(patch, 'name')) delete marker.rosterId;
  if (marker.rosterId && play.players.some(other => other.id !== marker.id && other.side === marker.side && other.rosterId === marker.rosterId)) fail('This roster player is already assigned to another marker on the same side.');
}

function updateRoute(play, route, fields) {
  const before = clone(route);
  Object.assign(route, clone(fields));
  if (has(fields, 'points') || before.kind !== route.kind) {
    delete route.intent; delete route.blockTargets; delete route.stagedBlock;
  }
  if (before.kind !== route.kind && route.kind === 'block' && !has(fields, 'endCap')) route.endCap = 'bar';
  relinkMotion(play, before, route);
  // Making a route the main movement follows the manual editor's replacement rule.
  if (!route.optional && ['route', 'motion'].includes(route.kind) && (has(fields, 'optional') || has(fields, 'kind'))) {
    for (const other of play.routes) {
      if (other.id === route.id || other.playerId !== route.playerId || other.optional || !['route', 'motion'].includes(other.kind)) continue;
      const previous = clone(other); other.optional = true;
      relinkMotion(play, previous, other);
    }
  }
}

/** Mutates a caller-owned draft; callers clone before execution and validate the complete group. */
export function runEditorPlayCommand(play, input, { idFactory = uid, roster = [], formations = [], depthChart } = {}) {
  const entry = byKind.get(input?.kind);
  if (!entry) return null;
  const op = entry.schema.parse(input);
  if (play.reference && op.kind !== 'play_update') fail('A reference diagram has no editable player coordinates.');
  const result = { handled: true };
  if (op.kind === 'player_add') {
    if (play.players.length >= 40) fail('Player limit reached.');
    const marker = { id: idFactory(), side: op.side, label: op.label ?? (op.side === 'defense' ? 'DB' : 'WR'), name: op.name ?? '', x: op.x ?? 25, y: op.y ?? (op.side === 'defense' ? 45 : 75), color: op.color ?? COLORS[op.side], shape: op.shape ?? (op.side === 'defense' ? 'square' : 'circle') };
    bindRoster(play, marker, op, roster);
    play.players.push(marker); result.createdId = marker.id;
  } else if (op.kind === 'player_update') {
    const marker = find(play.players, op.playerId, 'Player');
    if (has(op.patch, 'x') || has(op.patch, 'y')) movePlayer(play, marker.id, op.patch.x ?? marker.x, op.patch.y ?? marker.y);
    const fields = { ...op.patch };
    delete fields.x; delete fields.y; delete fields.rosterId;
    const sameName = fields.name === marker.name;
    Object.assign(marker, fields);
    const rosterPatch = { ...op.patch };
    if (!has(op.patch, 'rosterId') && sameName) delete rosterPatch.name;
    bindRoster(play, marker, rosterPatch, roster);
  } else if(op.kind==='players_move') {
    Object.assign(result,movePlayerGroup(play,op.playerIds,op.dx,op.dy));
  } else if(op.kind==='players_remove') {
    Object.assign(result,removePlayerGroup(play,op.playerIds));
  } else if (op.kind === 'object_remove') {
    const key = { player: 'players', route: 'routes', zone: 'zones', annotation: 'annotations' }[op.objectType];
    const object = find(play[key], op.objectId, op.objectType);
    if (op.objectType === 'player') removePlayers(play, new Set([object.id]));
    else { if (op.objectType === 'route') relinkMotion(play, object, null); play[key] = play[key].filter(item => item.id !== object.id); }
  } else if (op.kind === 'route_add') {
    if (play.routes.length >= 100) fail('Route limit reached.');
    const owner = find(play.players, op.playerId, 'Player');
    const route = { id: idFactory(), playerId: owner.id, kind: op.routeKind, points: clone(op.points), color: op.color ?? (op.routeKind === 'pass' ? COLORS.pass : owner.color), smooth: op.smooth ?? false, endCap: op.endCap ?? (op.routeKind === 'block' ? 'bar' : 'arrow'), optional: op.optional ?? false, delay: op.delay ?? 0, duration: op.duration ?? (op.routeKind === 'block' ? 2 : 4) };
    if (!route.optional && ['route', 'motion'].includes(route.kind)) {
      for (const other of play.routes) if (other.playerId === owner.id && !other.optional && ['route', 'motion'].includes(other.kind)) { const before = clone(other); other.optional = true; relinkMotion(play, before, other); }
    }
    play.routes.push(route); result.createdId = route.id;
  } else if (op.kind === 'route_update') updateRoute(play, find(play.routes, op.routeId, 'Route'), op.patch);
  else if (op.kind === 'zone_add') {
    if (play.zones.length >= 60) fail('Zone limit reached.');
    const zone = { id: idFactory(), x: op.x, y: op.y, rx: op.rx, ry: op.ry, color: op.color ?? COLORS.zone, label: op.label ?? '' };
    play.zones.push(zone); result.createdId = zone.id;
  } else if (op.kind === 'zone_update') Object.assign(find(play.zones, op.zoneId, 'Zone'), op.patch);
  else if (op.kind === 'annotation_add') {
    if (play.annotations.length >= 100) fail('Annotation limit reached.');
    const annotation = { id: idFactory(), x: op.x, y: op.y, text: op.text };
    play.annotations.push(annotation); result.createdId = annotation.id;
  } else if (op.kind === 'annotation_update') Object.assign(find(play.annotations, op.annotationId, 'Annotation'), op.patch);
  else if (op.kind === 'ball_update') {
    if (op.patch.holderId) find(play.players, op.patch.holderId, 'Player');
    if (op.patch.receiverId) find(play.players, op.patch.receiverId, 'Player');
    Object.assign(play.ball, op.patch);
    if (play.ball.receiverId === play.ball.holderId) play.ball.receiverId = '';
    if (play.ball.arriveAt <= play.ball.passAt) fail('Pass arrival must follow release.');
  } else if (op.kind === 'play_update') Object.assign(play, op.patch);
  else if (op.kind === 'play_mirror') Object.assign(play, mirrorPlay(play));
  else if (op.kind === 'formation_apply') {
    const custom = op.formationId ? formations.find(item => item.id === op.formationId) || fail('Saved formation not found.') : null;
    if (custom && custom.book !== play.book) fail('The saved formation belongs to another playbook.');
    const side = play.book === 'defense' ? 'defense' : 'offense';
    const previousLeague = getPlayLeague(play);
    const league = op.count ?? (custom ? getPlayLeague(custom, previousLeague) : previousLeague);
    if (custom && op.count !== undefined && custom.players.filter(player => player.side === side).length !== league) fail('The saved formation player count does not match the requested league size.');
    const formation = custom?.name || resolveFormation(op.formation, play.book, league);
    const source = custom ? clone(custom.players) : formationPlayers(formation, league, side);
    const home = source.filter(player => player.side === side);
    // Legacy books allow a defensive template inside the offense category.
    // Keep their explicit whole-board replacement instead of doubling that side.
    const retained = home.length ? play.players.filter(player => player.side !== side) : [];
    const positions = custom && retained.length ? home : source;
    const players = positions.map(player => ({ ...player, id: idFactory() }));
    if (!players.length || players.length > 40) fail('A formation must contain 1–40 players.');
    if (retained.length + players.length > 40) fail('Player limit reached.');
    const retainedIds = new Set(retained.map(player => player.id));
    play.players = [...players, ...retained]; play.formation = formation; play.league = league;
    if (league !== previousLeague) play.personnel = league === 11 ? '11 personnel' : league === 5 ? '5v5 Flag' : `${league} players`;
    play.routes = play.routes.filter(route => retainedIds.has(route.playerId)).map(route => route.blockTargets
      ? { ...route, blockTargets: route.blockTargets.map(target => retainedIds.has(target) ? target : null) } : route);
    if (!retained.length || side === 'defense') play.zones = [];
    if (!retained.length) play.annotations = [];
    if (!retainedIds.has(play.ball.holderId)) play.ball.holderId = players.find(player => player.label === 'QB')?.id || players[0].id;
    if (!retainedIds.has(play.ball.receiverId)) play.ball.receiverId = '';
  } else if (op.kind === 'opponents_set') {
    const opposingSide = play.book === 'defense' ? 'offense' : 'defense';
    const existing = play.players.filter(player => player.side === opposingSide);
    if (!op.enabled && existing.length) removePlayers(play, new Set(existing.map(player => player.id)));
    if (op.enabled && !existing.length) {
      const league = op.count ?? getPlayLeague(play);
      const formation = league === 5 ? defaultFormation(opposingSide, league) : opposingSide === 'offense' ? 'Gun Doubles' : '4–3';
      const players = formationPlayers(formation, league, opposingSide).map(player => ({ ...player, id: idFactory() }));
      if (play.players.length + players.length > 40) fail('Player limit reached.');
      play.players.push(...players);
    }
  } else if (op.kind === 'line_space') {
    const spaced = spaceMaddenLine(play);
    if (!spaced.changed && spaced.reason !== 'already-spaced') fail('This offensive line cannot be safely spaced automatically.');
  } else if (op.kind === 'personnel_apply') {
    const group = depthChart?.groups?.find(group => group.id === op.groupId) || fail('Depth-chart group not found.');
    if (group.unit !== play.book) fail('The depth-chart group belongs to another playbook.');
    const matches = personnelMatches(play, group, roster);
    if (!matches.length) fail('No uniquely matching starter assignments are available for this play.');
    for (const { marker, player } of matches) linkRosterPlayer(marker, player);
  }
  return result;
}

const labels = {
  player_add: ['添加球员', 'Add player'], player_update: ['修改球员', 'Update player'], object_remove: ['删除对象', 'Remove object'],
  players_move:['整组移动球员','Move player group'],players_remove:['整组删除球员','Remove player group'],
  route_add: ['绘制路线', 'Draw route'], route_update: ['修改路线', 'Update route'], zone_add: ['添加区域', 'Add zone'], zone_update: ['修改区域', 'Update zone'],
  annotation_add: ['添加文字', 'Add annotation'], annotation_update: ['修改文字', 'Update annotation'], ball_update: ['修改球权与传球', 'Update ball'],
  play_update: ['修改战术信息', 'Update play'], play_mirror: ['镜像战术', 'Mirror play'], formation_apply: ['替换阵型', 'Replace formation'],
  opponents_set: ['设置对手阵容', 'Set opponents'], line_space: ['调整锋线间距', 'Space offensive line'], personnel_apply: ['应用首发人员', 'Apply starters'],
};
const fieldLabels = {
  label:['位置名称','Role'],name:['姓名','Name'],side:['攻防方','Side'],color:['颜色','Color'],shape:['图形','Shape'],x:['横向位置','Horizontal position'],y:['纵向位置','Vertical position'],
  kind:['路线类型','Line type'],smooth:['平滑曲线','Smooth curve'],endCap:['终点形状','End cap'],optional:['备选路线','Optional route'],delay:['启动延迟','Delay'],duration:['持续时间','Duration'],
  points:['路线节点','Waypoints'],rx:['横向半径','Horizontal radius'],ry:['纵向半径','Vertical radius'],text:['文字','Text'],title:['战术名称','Title'],category:['分类','Category'],
  personnel:['人员组','Personnel'],notes:['教练说明','Coach notes'],favorite:['收藏','Favorite'],passAt:['出手时间','Throw time'],arriveAt:['接球时间','Arrival time'],
};
export function describeEditorPlayCommand(op, locale = 'zh') {
  const index = locale === 'en' ? 1 : 0, label = labels[op?.kind]?.[index];
  if (!label) return null;
  const details = [];
  for (const [key,value] of Object.entries(op.patch || {})) {
    if (!fieldLabels[key]) continue;
    const shown = Array.isArray(value) ? value.length : typeof value === 'boolean' ? (index ? (value ? 'on' : 'off') : (value ? '开启' : '关闭')) : String(value).slice(0,300);
    details.push(`${fieldLabels[key][index]}: ${shown}`);
  }
  if (['player_add','zone_add'].includes(op.kind)) details.push(op.name || op.label || op.side);
  if (op.kind === 'annotation_add') details.push(op.text);
  if (op.kind === 'formation_apply') details.push(op.formation || (index ? 'Saved formation' : '已存阵型'));
  if (op.kind === 'opponents_set') details.push(index ? (op.enabled ? 'show opponents' : 'remove opponents') : (op.enabled ? '显示对手' : '移除对手'));
  if (op.kind === 'route_add') details.push(op.routeKind, `${op.points.length} ${index ? 'waypoints' : '个节点'}`);
  if(['players_move','players_remove'].includes(op.kind))details.push(`${op.playerIds.length} ${index?'players':'名球员'}`);
  if(op.kind==='players_move')details.push(`ΔX ${op.dx}, ΔY ${op.dy}`);
  return [label,...details.filter(Boolean)].join(' · ');
}
