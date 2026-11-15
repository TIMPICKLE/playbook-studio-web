import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { starterWorkspace, decodeWorkspace, encodeWorkspace } from '../web/model.js';
import { hasEditableTrace, loadEditableEntries } from '../web/madden-model.js';
import { EDITOR_ACTIONS, EditorActionSchema, parseEditorActions, prepareEditorActions, getEditorOverview } from '../web/editor-actions.js';

const context = () => {
  const data = starterWorkspace();
  return {data, selectedId:data.plays[0].id};
};
const makeIds = () => {let next = 0; return () => `test-editor-${next++}`;};
const withoutId = value => {const copy = {...value}; delete copy.id; return copy;};
const examples = [
  {kind:'play_create', title:'Base defense', book:'defense', formation:'4-3', count:11},
  {kind:'play_duplicate', playId:'play'}, {kind:'play_delete', playId:'play'},
  {kind:'formation_save', name:'Our trips'}, {kind:'catalog_import', catalogId:'catalog'},
  {kind:'selection_set', objectType:'player', id:'player'}, {kind:'tool_set', tool:'zone'},
  {kind:'draft_action', action:'finish'}, {kind:'history_action', action:'undo'},
  {kind:'playback_set', playing:true, speed:.5}, {kind:'view_set', grid:false, theme:'light'},
  {kind:'layout_set', zoom:1.5, expanded:true}, {kind:'filter_set', query:'Mesh', book:'offense'},
  {kind:'panel_set', panel:'properties'}, {kind:'play_select', playId:'play'},
  {kind:'export_request', format:'svg'}, {kind:'print_request', scope:'current', layout:'wristband'},
  {kind:'import_request'}, {kind:'dialog_open', dialog:'madden'},
];

test('every registered editor command owns a strict schema, execution lane and UI binding', () => {
  assert.equal(examples.length, Object.keys(EDITOR_ACTIONS).length);
  for (const value of examples) {
    const entry = EDITOR_ACTIONS[value.kind];
    assert.equal(entry.id, value.kind);
    assert.ok(entry.description.length);
    assert.ok(entry.uiBindings.length);
    assert.ok(['workspace', 'local', 'interaction'].includes(entry.lane));
    assert.equal(typeof entry.destructive, 'boolean');
    assert.equal(typeof entry.undoable, 'boolean');
    assert.deepEqual(parseEditorActions([value]), [value]);
    assert.equal(EditorActionSchema.safeParse({...value, arbitrary:true}).success, false);
  }
});

test('editor command validation rejects unsupported values and empty setting commands', () => {
  for (const value of [
    {kind:'arbitrary_click', selector:'button'}, {kind:'view_set'}, {kind:'playback_set'},
    {kind:'layout_set', zoom:5}, {kind:'layout_set', height:100},
    {kind:'playback_set', speed:10}, {kind:'playback_set', time:-1},
    {kind:'selection_set', objectType:'none', id:'unexpected'},
    {kind:'play_create', title:'Test', book:'offense', formation:'Gun Trips', count:10},
    {kind:'print_request', scope:'all', layout:'arbitrary'},
  ]) assert.throws(() => parseEditorActions([value]), /Invalid editor actions/);
  assert.throws(() => parseEditorActions([]));
});

test('new plays use actual formations, stable IDs, valid ball references and one cloned workspace', () => {
  const input = context(), before = structuredClone(input.data);
  const actions = [{kind:'play_create', title:'Base defense', book:'defense', formation:'4-3', count:11}];
  const plan = prepareEditorActions(input, actions);
  assert.deepEqual(input.data, before);
  assert.equal(plan.lane, 'workspace');
  assert.equal(plan.data.plays.length, before.plays.length + 1);
  const play = plan.data.plays.find(play => play.id === plan.selectedId);
  assert.equal(play.title, 'Base defense');
  assert.equal(play.book, 'defense');
  assert.equal(play.formation, '4–3');
  assert.equal(play.players.length, 11);
  assert.ok(play.players.every(player => player.side === 'defense'));
  assert.ok(play.players.some(player => player.id === play.ball.holderId));
  assert.deepEqual(prepareEditorActions(structuredClone(input), actions), plan);
  assert.deepEqual(decodeWorkspace(encodeWorkspace(plan.data)), plan.data);
  assert.throws(() => prepareEditorActions(input, [{...actions[0], formation:'Invented front'}]), /formation/);
});

test('custom formation creation remaps marker IDs while retaining roster assignments', () => {
  const input = context();
  const source = input.data.plays[0];
  input.data.formations.push({id:'saved-form', name:'Team Trips', book:'offense', players:structuredClone(source.players)});
  const actions = [{kind:'play_create', title:'Saved look', book:'offense', formation:'custom:saved-form', count:11}];
  const plan = prepareEditorActions(input, actions, {idFactory:makeIds(), locale:'en', now:'2026-11-15T12:00:00Z'});
  const play = plan.data.plays.find(play => play.id === plan.selectedId);
  assert.equal(play.formation, 'Team Trips');
  assert.equal(play.createdAt, '2026-11-15T12:00:00Z');
  assert.equal(plan.data.settings.league, 11);
  assert.deepEqual(play.players.map(withoutId), source.players.map(withoutId));
  assert.ok(play.players.every(player => !source.players.some(original => original.id === player.id)));
  assert.throws(() => prepareEditorActions(input, [{...actions[0], book:'defense'}]), /different playbook unit/);
  assert.throws(() => prepareEditorActions(input, [{...actions[0], count:7}]), /player count/);
});

test('duplicate, save formation and delete compose into a validated atomic workspace plan', () => {
  const input = context(), before = structuredClone(input.data);
  const original = input.data.plays[0];
  const actions = [
    {kind:'play_duplicate', playId:original.id, title:'Practice copy'},
    {kind:'formation_save', name:'Practice alignment'},
    {kind:'play_delete', playId:original.id},
  ];
  const plan = prepareEditorActions(input, actions, {idFactory:makeIds()});
  assert.deepEqual(input.data, before);
  assert.equal(plan.data.plays.length, before.plays.length);
  assert.ok(!plan.data.plays.some(play => play.id === original.id));
  const copy = plan.data.plays.find(play => play.id === plan.selectedId);
  assert.equal(copy.title, 'Practice copy');
  assert.equal(copy.formation, 'Practice alignment');
  assert.deepEqual(copy.routes, original.routes);
  assert.equal(plan.data.formations.at(-1).name, 'Practice alignment');
  assert.equal(plan.changes.length, 3);
  assert.throws(() => prepareEditorActions(input, [...actions, {kind:'play_delete', playId:'missing'}]), /not in the current playbook/);
  assert.deepEqual(input.data, before, 'a failed later command never leaves earlier changes behind');
});

test('workspace plans retain at least one play and enforce model capacities atomically', () => {
  const input = context();
  input.data.plays = [input.data.plays[0]];
  assert.throws(() => prepareEditorActions(input, [{kind:'play_delete', playId:input.selectedId}]), /at least one/);
  const source = structuredClone(input.data.plays[0]);
  input.data.plays = Array.from({length:500}, (_, index) => ({...structuredClone(source), id:index ? `full-${index}` : source.id}));
  const before = structuredClone(input.data);
  assert.throws(() => prepareEditorActions(input, [{kind:'play_duplicate', playId:input.selectedId}]));
  assert.deepEqual(input.data, before);
});

test('workspace, local controls and native workflows cannot execute as a mixed batch', () => {
  const input = context();
  assert.throws(() => prepareEditorActions(input, [
    {kind:'formation_save', name:'Saved'}, {kind:'view_set', theme:'light'},
  ]), /Do not mix/);
  assert.throws(() => prepareEditorActions(input, [
    {kind:'view_set', theme:'light'}, {kind:'export_request', format:'png'},
  ]), /Do not mix/);
});

test('local controls resolve real objects but never modify a play or claim to have executed', () => {
  const input = context(), before = structuredClone(input.data);
  const plan = prepareEditorActions(input, [
    {kind:'selection_set', objectType:'player', id:input.data.plays[0].players[0].id},
    {kind:'view_set', theme:'light', grid:false, visualMode:'traditional'},
    {kind:'playback_set', mode:'rehearse', speed:.5, loop:true, time:2},
    {kind:'layout_set', height:700, inspectorWidth:300, fit:true},
  ]);
  assert.equal(plan.lane, 'local');
  assert.equal(plan.data, undefined);
  assert.equal(plan.changes.length, 4);
  assert.match(plan.summary, /准备执行/);
  assert.deepEqual(input.data, before);
  assert.throws(() => prepareEditorActions(input, [{kind:'selection_set', objectType:'route', id:'invented'}]), /not on the current diagram/);
  assert.throws(() => prepareEditorActions(input, [{kind:'play_select', playId:'invented'}]), /not in the current playbook/);
});

test('file and print requests prepare native workflows without pretending to import or export', () => {
  const input = context(), before = structuredClone(input.data);
  for (const action of [
    {kind:'import_request'}, {kind:'export_request', format:'workspace_json'},
    {kind:'print_request', scope:'all', layout:'callsheet'}, {kind:'dialog_open', dialog:'convert_reference'},
  ]) {
    const plan = prepareEditorActions(input, [action]);
    assert.equal(plan.lane, 'interaction');
    assert.equal(plan.data, undefined);
    assert.deepEqual(plan.actions, [action]);
    assert.equal('completed' in plan, false);
  }
  assert.deepEqual(input.data, before);
});

test('a local batch resolves selections against the play selected earlier in that batch', () => {
  const input = context(), nextPlay = input.data.plays[1];
  const plan = prepareEditorActions(input, [
    {kind:'play_select', playId:nextPlay.id},
    {kind:'selection_set', objectType:'player', id:nextPlay.players[0].id},
  ]);
  assert.equal(plan.lane, 'local');
  assert.throws(() => prepareEditorActions(input, [
    {kind:'play_select', playId:nextPlay.id},
    {kind:'selection_set', objectType:'player', id:input.data.plays[0].players[0].id},
  ]), /not on the current diagram/);
});

test('catalog import requires actual entries, preserves references and remaps editable geometry coherently', async () => {
  const catalog = JSON.parse(readFileSync(new URL('../web/data/huddle-catalog.json', import.meta.url), 'utf8'));
  const entry = catalog.plays.find(row => hasEditableTrace(row.id));
  await loadEditableEntries([entry.id]);
  const input = {...context(), catalogRows:[entry]}, actions = [{kind:'catalog_import', catalogId:entry.id}];
  const plan = prepareEditorActions(input, actions);
  const play = plan.data.plays.find(play => play.id === plan.selectedId);
  assert.equal(play.diagramSource.catalogId, entry.id);
  const ids = new Set(play.players.map(player => player.id));
  assert.ok(play.routes.every(route => ids.has(route.playerId)));
  assert.ok(ids.has(play.ball.holderId));
  assert.deepEqual(prepareEditorActions(input, actions), plan);
  const repeated = prepareEditorActions({data:plan.data, selectedId:plan.selectedId, catalogRows:[entry]}, actions);
  assert.equal(repeated.data.plays.length, plan.data.plays.length);
  assert.equal(repeated.selectedId, plan.selectedId);
  assert.throws(() => prepareEditorActions(context(), actions), /Load verified catalog entries/);
  assert.throws(() => prepareEditorActions({...context(), catalogRows:[]}, actions), /not returned by the current catalog/);
});

test('overview exposes stable command IDs and real play, formation and roster evidence', () => {
  const {data, selectedId} = context();
  const overview = getEditorOverview(data, selectedId);
  assert.equal(overview.selectedPlayId, selectedId);
  assert.deepEqual(new Set(overview.capabilities.map(capability => capability.id)), new Set(Object.keys(EDITOR_ACTIONS)));
  assert.equal(overview.plays.length, data.plays.length);
  assert.equal(overview.roster.length, data.roster.length);
  assert.ok(overview.formations.builtIn.includes('4–3'));
  assert.equal(overview.limits.players, 40);
});
