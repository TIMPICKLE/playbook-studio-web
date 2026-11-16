import { z } from './vendor/assistant-zod.js';
import { clone, decodeWorkspace, encodeWorkspace, FORMATIONS, makePlay } from './model.js';
import { hasEditableTrace, makeMaddenPlay } from './madden-model.js';
import { LEAGUE_SIZES, getPlayLeague, isFlag5Play } from './game-formats.js';

const id = z.string().trim().min(1).max(100);
const book = z.enum(['offense', 'defense', 'special']);
const count = z.union(LEAGUE_SIZES.map(value => z.literal(value)));
const action = (kind, fields = {}) => z.strictObject({kind:z.literal(kind), ...fields});
const changing = (kind, fields) => action(kind, fields).refine(value => Object.keys(value).length > 1, {message:'Specify at least one setting.'});
const definitions = [
  ['play_create', 'workspace', 'Create a play using an existing built-in or saved formation.', false, true, ['new', 'create-play'], action('play_create', {title:z.string().trim().min(1).max(120), book, formation:z.string().trim().min(1).max(107), count})],
  ['play_duplicate', 'workspace', 'Duplicate a real play, optionally giving the copy a title.', false, true, ['duplicate'], action('play_duplicate', {playId:id, title:z.string().trim().min(1).max(120).optional()})],
  ['play_delete', 'workspace', 'Delete a real play while retaining at least one play in the book.', true, true, ['delete-play', 'confirm-delete'], action('play_delete', {playId:id})],
  ['formation_save', 'workspace', 'Save the current editable starting positions as a custom formation.', false, true, ['save-formation', 'confirm-formation'], action('formation_save', {name:z.string().trim().min(1).max(100)})],
  ['catalog_import', 'workspace', 'Import a verified Madden catalog entry loaded by the host. Do not invent catalog IDs.', false, true, ['madden:add'], action('catalog_import', {catalogId:id})],
  ['selection_set', 'local', 'Select a real player, route, zone or annotation, select multiple existing players, or clear selection.', false, false, ['clear-selection', 'select-route', 'field:select','multi-select','pick-candidate'], z.union([
    action('selection_set', {objectType:z.enum(['player', 'route', 'zone', 'annotation']), id}),
    action('selection_set', {objectType:z.literal('players'),ids:z.array(id).min(1).max(40).refine(values=>new Set(values).size===values.length,'Choose each player only once.')}),
    action('selection_set', {objectType:z.literal('none')}),
  ])],
  ['tool_set', 'local', 'Select the editor drawing tool.', false, false, ['tool'], action('tool_set', {tool:z.enum(['select', 'route', 'block', 'motion', 'pass', 'zone', 'text'])})],
  ['draft_action', 'local', 'Finish, cancel, remove the last point, or set main/optional mode of the current draft.', false, false, ['finish-route', 'cancel-draft', 'undo-point', 'draft-mode'], z.union([action('draft_action', {action:z.enum(['finish', 'cancel', 'undo_point'])}), action('draft_action', {action:z.literal('set_mode'),mode:z.enum(['main','optional'])})])],
  ['history_action', 'local', 'Undo or redo one existing editor transaction.', false, false, ['undo', 'redo'], action('history_action', {action:z.enum(['undo', 'redo'])})],
  ['playback_set', 'local', 'Set rehearsal state, playback, loop, speed or timeline; this does not edit the play.', false, false, ['edit-mode', 'rehearse-mode', 'play', 'reset', 'loop', 'speed', 'timeline'], changing('playback_set', {playing:z.boolean().optional(), reset:z.boolean().optional(), loop:z.boolean().optional(), speed:z.union([.5, 1, 1.5, 2].map(value => z.literal(value))).optional(), time:z.number().min(0).optional(), mode:z.enum(['edit', 'rehearse']).optional()})],
  ['view_set', 'local', 'Set device-only field theme, yard lines, names or traditional/digital presentation.', false, false, ['theme', 'grid', 'show-names', 'effects-mode'], changing('view_set', {theme:z.enum(['dark', 'light']).optional(), grid:z.boolean().optional(), names:z.boolean().optional(), visualMode:z.enum(['traditional', 'digital']).optional()})],
  ['layout_set', 'local', 'Set or reset device-only zoom, fit, expanded state, height, inspector width and viewport pan.', false, false, ['board:zoom-in', 'board:zoom-out', 'board:fit', 'board:expand', 'board:reset', 'board-height', 'board:width', 'board:pan'], changing('layout_set', {zoom:z.number().min(1).max(3).optional(), fit:z.boolean().optional(), reset:z.boolean().optional(), expanded:z.boolean().optional(), height:z.number().min(280).max(1400).optional(), inspectorWidth:z.number().min(220).max(480).optional(),panX:z.number().min(0).max(100000).optional(),panY:z.number().min(0).max(100000).optional()})],
  ['filter_set', 'local', 'Set play-list search, category, formation or playbook filter.', false, false, ['search', 'category-filter', 'formation-filter', 'book', 'clear-filters'], changing('filter_set', {query:z.string().max(200).optional(), category:z.string().max(60).optional(), formation:z.string().max(100).optional(), book:book.optional()})],
  ['panel_set', 'local', 'Open the plays, properties or field panel, or close side panels.', false, false, ['sidebar', 'inspector-panel', 'panel-field', 'close-panel'], action('panel_set', {panel:z.enum(['plays', 'properties', 'field', 'none'])})],
  ['play_select', 'local', 'Open a real play from the current playbook.', false, false, ['choose'], action('play_select', {playId:id})],
  ['export_request', 'interaction', 'Prepare a PNG, SVG, current-play JSON or complete-workspace JSON export.', false, false, ['download-png', 'download-svg', 'download-play', 'download-json'], action('export_request', {format:z.enum(['png', 'svg', 'play_json', 'workspace_json'])})],
  ['print_request', 'interaction', 'Open the existing print workflow with the requested scope and layout.', false, false, ['print', 'print-scope', 'print-layout', 'do-print'], action('print_request', {scope:z.enum(['current', 'filtered', 'all']), layout:z.enum(['playbook', 'wristband', 'callsheet'])})],
  ['import_request', 'interaction', 'Open the native file picker; the user supplies a local playbook file before import can continue.', false, false, ['import', 'import-input', 'confirm-import'], action('import_request')],
  ['dialog_open', 'interaction', 'Open an existing editor workflow. A workflow is not completed merely by opening it.', false, false, ['help', 'new', 'export', 'personnel-group', 'madden-library', 'compare-source', 'local-recovery', 'convert-reference'], action('dialog_open', {dialog:z.enum(['help', 'new_play', 'export', 'personnel', 'madden', 'source', 'recovery', 'convert_reference'])})],
];

// One typed definition is shared by UI dispatch, model contracts and previews.
export const EDITOR_ACTIONS = Object.freeze(Object.fromEntries(definitions.map(([kind, lane, description, destructive, undoable, uiBindings, schema]) =>
  [kind, Object.freeze({id:kind, schema, description, lane, destructive, undoable, uiBindings:Object.freeze(uiBindings)})])));
export const EditorActionSchema = z.union(Object.values(EDITOR_ACTIONS).map(entry => entry.schema));
const EditorActionsSchema = z.array(EditorActionSchema).min(1).max(20);

export function parseEditorActions(actions) {
  const parsed = EditorActionsSchema.safeParse(actions);
  if (!parsed.success) throw new Error('Invalid editor actions. Use the advertised command schema and setting ranges.');
  return parsed.data;
}

const english = locale => locale === 'en';
const words = (locale, en, zh) => english(locale) ? en : zh;
const findPlay = (data, id) => data?.plays?.find(play => play.id === id);
const requirePlay = (data, id) => {
  const play = findPlay(data, id);
  if (!play) throw new Error('The requested play is not in the current playbook.');
  return play;
};
const validation = data => decodeWorkspace(encodeWorkspace(data));
const normalizeFormation = name => ({'4-3':'4–3', '3-4':'3–4'}[name] || name);
const canonical = value => JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);

function proposalIds(data, selectedId, actions) {
  const seed = canonical({data, selectedId, actions});
  let hash = 14695981039346656037n;
  for (const character of seed) hash = BigInt.asUintN(64, (hash ^ BigInt(character.codePointAt(0))) * 1099511628211n);
  const prefix = `editor-proposal-${hash.toString(36)}-`;
  const used = new Set();
  for (const play of [...data?.plays || [], ...data?.formations || []]) {
    used.add(play.id);
    for (const type of ['players', 'routes', 'zones', 'annotations']) for (const item of play[type] || []) used.add(item.id);
  }
  for (const player of data?.roster || []) used.add(player.id);
  let next = 0;
  return () => {
    let id;
    do { id = prefix + next++; } while (used.has(id));
    used.add(id);
    return id;
  };
}

// Newly generated geometry must use the caller's ID factory as one coherent map.
function identifyPlay(play, idFactory) {
  const next = clone(play), map = new Map();
  for (const type of ['players', 'routes', 'zones', 'annotations']) for (const item of next[type]) {
    const original = item.id;
    item.id = idFactory();
    map.set(original, item.id);
  }
  next.id = idFactory();
  for (const route of next.routes) {
    route.playerId = map.get(route.playerId) || route.playerId;
    if (route.blockTargets) route.blockTargets = route.blockTargets.map(target => map.get(target) || target);
  }
  for (const key of ['holderId', 'receiverId']) next.ball[key] = map.get(next.ball[key]) || next.ball[key];
  return next;
}

function localDescription(action, locale) {
  const detail = Object.entries(action).filter(([key]) => key !== 'kind').map(([key, value]) => `${key}=${String(value)}`).join(', ');
  return `${words(locale, 'Request', '准备执行')} ${action.kind}${detail ? ` · ${detail}` : ''}`;
}

export function prepareEditorActions({data, selectedId, catalogRows} = {}, value, {idFactory, locale = 'zh-CN', now = ''} = {}) {
  const actions = parseEditorActions(value);
  const makeId = idFactory || proposalIds(data, selectedId, actions);
  const lanes = new Set(actions.map(action => EDITOR_ACTIONS[action.kind].lane));
  if (lanes.size !== 1) throw new Error('Do not mix playbook edits, local controls and interactive workflows in one batch.');
  const lane = [...lanes][0], changes = [];
  if (lane !== 'workspace') {
    let previewSelectedId = selectedId;
    for (const action of actions) {
      if (action.kind === 'play_select') {
        requirePlay(data, action.playId);
        previewSelectedId = action.playId;
      }
      if (action.kind === 'filter_set' && action.book != null) {
        const first=data?.plays?.find(play => play.book === action.book);
        if (first) previewSelectedId=first.id;
      }
      if (action.kind === 'selection_set' && action.objectType !== 'none') {
        const current = data ? requirePlay(data, previewSelectedId) : null;
        const type = {player:'players', players:'players',route:'routes', zone:'zones', annotation:'annotations'}[action.objectType];
        const requested=action.objectType==='players'?action.ids:[action.id];
        if (!requested.every(id=>current?.[type].some(item => item.id === id))) throw new Error('The requested object is not on the current diagram.');
      }
      changes.push(localDescription(action, locale));
    }
    // A host must perform and verify these controls or open a native workflow.
    // Preparing them is neither a completed export nor an imported local file.
    return {lane, actions, changes, summary:changes.join('\n')};
  }
  if (!data) throw new Error('Read the current playbook before preparing workspace edits.');
  const next = validation(clone(data));
  let nextId = selectedId;
  requirePlay(next, nextId);
  for (const action of actions) {
    if (action.kind === 'play_create') {
      const name = normalizeFormation(action.formation);
      const customId = name.startsWith('custom:') ? name.slice(7) : name;
      const custom = next.formations.find(formation => formation.id === customId);
      if (!custom && !FORMATIONS.includes(name)) throw new Error('Choose a built-in formation or an existing saved formation ID.');
      if (custom && custom.book !== action.book) throw new Error('The saved formation belongs to a different playbook unit.');
      if (custom && custom.players.filter(player => player.side === (action.book === 'defense' ? 'defense' : 'offense')).length !== action.count)
        throw new Error('The saved formation player count does not match the requested league size.');
      let play = makePlay({...action, formation:custom?.name || name});
      if (custom) {
        play.formation = custom.name;
        play.players = clone(custom.players);
        play.ball.holderId = play.players.find(player => player.label === 'QB')?.id || play.players[0].id;
      }
      play = identifyPlay(play, makeId);
      play.createdAt = now;
      if (english(locale)) {
        play.category = action.book === 'defense' ? 'Zone defense' : 'Pass';
        if (action.count !== 11) play.personnel = action.count === 5 ? '5v5 Flag' : `${action.count} players`;
      }
      next.plays.push(play); nextId = play.id; next.settings.league = action.count;
      changes.push(words(locale, `Create play · ${play.title}`, `新建战术 · ${play.title}`));
    } else if (action.kind === 'play_duplicate') {
      const original = requirePlay(next, action.playId), copy = clone(original);
      copy.id = makeId();
      copy.title = action.title || `${copy.title} · ${words(locale, 'Copy', '副本')}`.slice(0, 120);
      copy.createdAt = now;
      next.plays.push(copy); nextId = copy.id;
      changes.push(words(locale, `Duplicate play · ${copy.title}`, `复制战术 · ${copy.title}`));
    } else if (action.kind === 'play_delete') {
      const original = requirePlay(next, action.playId);
      if (next.plays.length <= 1) throw new Error('Keep at least one play in the playbook.');
      next.plays = next.plays.filter(play => play.id !== original.id);
      if (nextId === original.id) nextId = next.plays.find(play => play.book === original.book)?.id || next.plays[0].id;
      changes.push(words(locale, `Delete play · ${original.title}`, `删除战术 · ${original.title}`));
    } else if (action.kind === 'formation_save') {
      const play = requirePlay(next, nextId);
      if (play.reference) throw new Error('A reference diagram has no editable starting positions.');
      next.formations.push({id:makeId(), name:action.name, book:play.book, league:getPlayLeague(play), players:clone(play.players)});
      play.formation = action.name;
      changes.push(words(locale, `Save formation · ${action.name}`, `保存阵型 · ${action.name}`));
    } else if (action.kind === 'catalog_import') {
      const rows = Array.isArray(catalogRows) ? catalogRows : catalogRows?.plays;
      if (!rows) throw new Error('Load verified catalog entries before preparing catalog import.');
      const entry = rows.find(row => row.id === action.catalogId);
      if (!entry) throw new Error('The requested catalog entry was not returned by the current catalog.');
      const existing = next.plays.find(play => (hasEditableTrace(entry.id) ? play.diagramSource : play.reference)?.catalogId === entry.id);
      if (existing) {
        nextId = existing.id;
        changes.push(words(locale, `Already in playbook · ${existing.title}`, `战术本已有该战术 · ${existing.title}`));
      } else {
        const play = identifyPlay(makeMaddenPlay(entry), makeId);
        play.createdAt = now;
        next.plays.push(play); nextId = play.id;
        changes.push(words(locale, `Import catalog play · ${play.title}`, `导入目录战术 · ${play.title}`));
      }
    }
  }
  const checked = validation(next);
  requirePlay(checked, nextId);
  return {lane, data:checked, selectedId:nextId, actions, changes, summary:changes.join('\n')};
}

// Model preview and editor UI deliberately share the same deterministic proposal.
export const proposeEditorActions = prepareEditorActions;

export function getEditorOverview(data, current) {
  const play = typeof current === 'string' ? findPlay(data, current) : current || data?.plays?.[0];
  return {
    selectedPlayId:play?.id,
    plays:(data?.plays || []).map(item => ({id:item.id, title:item.title, book:item.book, formation:item.formation, favorite:item.favorite, league:getPlayLeague(item), flag5:isFlag5Play(item)})),
    formations:{builtIn:[...FORMATIONS], saved:(data?.formations || []).map(item => ({id:item.id, name:item.name, book:item.book, league:getPlayLeague(item)}))},
    roster:(data?.roster || []).map(({id, name, number, position}) => ({id, name, number, position})),
    personnelGroups:(data?.depthChart?.groups || []).map(({id, name, unit}) => ({id, name, unit})),
    settings:clone(data?.settings || {}),
    limits:{plays:500, formations:100, roster:200, players:40, routes:100, zones:60, annotations:100},
    capabilities:Object.values(EDITOR_ACTIONS).map(({id, description, lane, destructive, undoable}) => ({id, description, lane, destructive, undoable})),
    reference:!!play?.reference,
  };
}
