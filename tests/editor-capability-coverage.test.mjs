import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { starterWorkspace } from '../web/model.js';
import { EDITOR_PLAY_COMMANDS } from '../web/editor-play-commands.js';
import { EDITOR_ACTIONS } from '../web/editor-actions.js';
import { editorCapabilities, editorCommandSchema } from '../web/editor-capabilities.js';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const app = read('../web/app.js');
const layout = read('../web/board-layout.js');
const effects = read('../web/effects.js');
const data = starterWorkspace();
const input = {board:data.plays[0], editor:{data, selectedId:data.plays[0].id, readOnly:false}};
const capabilities = editorCapabilities(input);
const playCommands = new Map(EDITOR_PLAY_COMMANDS.map(command => [command.id, command]));
const bound = binding => capabilities.filter(capability => capability.uiBindings?.includes(binding));

// This table follows user-visible terminal features rather than deriving an
// expected list from the command registry being checked. Transient modal
// close/cancel controls do not each represent a separate editor capability.
const terminalFeatures = [
  ['add-player','player_add'], ['add-defense-43','defense_formation'],
  ['delete-selection','object_remove'], ['create-text','annotation_add'],
  ['delete-selection','players_remove'], ['selection-nudge','players_move'], ['multi-select','selection_set'],
  ['favorite','play_update'], ['mirror','play_mirror'],
  ['apply-formation','formation_apply'], ['opponents','opponents_set'],
  ['space-madden-line','line_space'], ['apply-personnel','personnel_apply'],
  ['new','play_create'], ['duplicate','play_duplicate'], ['delete-play','play_delete'],
  ['save-formation','formation_save'], ['madden:add','catalog_import'],
  ['tool','tool_set'], ['clear-selection','selection_set'], ['select-route','selection_set'],
  ['finish-route','draft_action'], ['cancel-draft','draft_action'], ['undo-point','draft_action'],
  ['undo','history_action'], ['redo','history_action'],
  ['edit-mode','playback_set'], ['rehearse-mode','playback_set'],
  ['play','playback_set'], ['reset','playback_set'], ['loop','playback_set'],
  ['theme','view_set'], ['grid','view_set'], ['show-names','view_set'],
  ['search','filter_set'], ['category-filter','filter_set'], ['formation-filter','filter_set'],
  ['book','filter_set'], ['clear-filters','filter_set'],
  ['sidebar','panel_set'], ['inspector-panel','panel_set'], ['panel-field','panel_set'],
  ['close-panel','panel_set'], ['choose','play_select'],
  ['download-png','export_request'], ['download-svg','export_request'],
  ['download-play','export_request'], ['download-json','export_request'],
  ['print','print_request'], ['import','import_request'],
  ['help','dialog_open'], ['madden-library','dialog_open'],
  ['compare-source','dialog_open'], ['convert-reference','dialog_open'],
];

test('visible editor terminal features map to executable advertised commands', () => {
  const missing = [];
  for (const [binding, commandId] of terminalFeatures) {
    if (!bound(binding).some(capability => capability.id === commandId)) missing.push(`${binding} → ${commandId}`);
  }
  assert.deepEqual(missing, [], 'A UI feature cannot disappear from the AI command surface.');
});

function inspectorSegment(type, nextType) {
  const start = app.indexOf(`if (selection?.type === '${type}' && obj)`);
  assert.ok(start >= 0, `The real ${type} inspector should exist.`);
  const end = nextType ? app.indexOf(`else if (selection?.type === '${nextType}' && obj)`, start) : app.indexOf('\n  } else {', start);
  assert.ok(end > start);
  return app.slice(start, end);
}
const fieldsFrom = source => [...new Set([
  ...[...source.matchAll(/fieldInput\(t\("[^"]+"\), '([^']+)'/g)].map(match => match[1]),
  ...[...source.matchAll(/data-prop="([^"]+)"/g)].map(match => match[1]),
])];
const values = {label:'ROLE', name:'Player', roster:'roster-id', color:'#aabbcc', shape:'square', kind:'block', endCap:'bar', smooth:true, optional:true, delay:1, duration:3, rx:10, ry:8, text:'Coach note'};

test('every actual object inspector property is accepted by its shared typed command', () => {
  const inspectors = [
    ['player','route','player_update','playerId'], ['route','zone','route_update','routeId'],
    ['zone','annotation','zone_update','zoneId'], ['annotation',null,'annotation_update','annotationId'],
  ];
  for (const [type,next,commandId,idField] of inspectors) {
    const fields = fieldsFrom(inspectorSegment(type,next));
    assert.ok(fields.length, `${type} fields must come from the actual inspector markup.`);
    for (const field of fields) {
      assert.ok(Object.hasOwn(values,field), `New UI property ${type}.${field} needs a coverage sample.`);
      const key = field === 'roster' ? 'rosterId' : field;
      const result = playCommands.get(commandId).schema.safeParse({kind:commandId,[idField]:'existing-object',patch:{[key]:values[field]}});
      assert.equal(result.success,true, `${type}.${field} must be writable through AI and the shared reducer.`);
    }
    assert.ok(bound(`${type}:props`).some(capability=>capability.id===commandId));
  }
});

test('metadata and ball inspector features have typed command coverage', () => {
  const samples = [
    ['title','Mesh practice'], ['category','Pass'], ['personnel','11 personnel'], ['notes','Read the apex.'], ['favorite',true],
  ];
  for (const [field,value] of samples) {
    assert.equal(playCommands.get('play_update').schema.safeParse({kind:'play_update',patch:{[field]:value}}).success,true, field);
  }
  for (const [field,value] of [['holderId','qb'],['receiverId','wr'],['receiverId',''],['passAt',2],['arriveAt',3]]) {
    assert.equal(playCommands.get('ball_update').schema.safeParse({kind:'ball_update',patch:{[field]:value}}).success,true,field);
  }
  assert.ok(bound('ball:props').some(capability=>capability.id==='ball_update'));
  assert.ok(bound('play:props').some(capability=>capability.id==='play_update'));
});

test('field gestures have command mappings for the same terminal changes', () => {
  for (const [binding,commandId] of [
    ['field:select','selection_set'], ['field:drag-player','player_update'],
    ['field:drag-players','players_move'],
    ['field:drag-point','route_update'], ['field:draw-route','route_add'],
    ['field:draw-zone','zone_add'], ['field:drag-zone','zone_update'],
    ['field:drag-annotation','annotation_update'],
  ]) assert.ok(bound(binding).some(capability=>capability.id===commandId), `${binding} needs ${commandId}`);
});

test('every real layout button and resize control has an AI layout setting', () => {
  const buttons = [...new Set([...layout.matchAll(/data-board-action="([^"]+)"/g)].map(match=>match[1]))];
  assert.ok(buttons.includes('reset'));
  for (const button of buttons) assert.ok(bound(`board:${button}`).some(capability=>capability.id==='layout_set'), button);
  for (const binding of ['board-height','board:width','board:pan']) assert.ok(bound(binding).some(capability=>capability.id==='layout_set'),binding);
  for (const value of [{zoom:1.5},{fit:true},{expanded:true},{height:700},{inspectorWidth:300},{reset:true},{panX:120,panY:80}]) {
    assert.equal(EDITOR_ACTIONS.layout_set.schema.safeParse({kind:'layout_set',...value}).success,true,JSON.stringify(value));
  }
});

test('view, drawing mode and rehearsal controls expose their actual UI choices', () => {
  const visualChoices = [...effects.match(/const modes = new Set\(\[([^\]]+)\]/)[1].matchAll(/'([^']+)'/g)].map(match=>match[1]);
  for (const visualMode of visualChoices) assert.equal(EDITOR_ACTIONS.view_set.schema.safeParse({kind:'view_set',visualMode}).success,true);
  assert.ok(bound('effects-mode').some(capability=>capability.id==='view_set'));
  for (const tool of ['select','route','block','motion','pass','zone','text']) assert.equal(EDITOR_ACTIONS.tool_set.schema.safeParse({kind:'tool_set',tool}).success,true,tool);
  for (const speed of [.5,1,1.5,2]) assert.equal(EDITOR_ACTIONS.playback_set.schema.safeParse({kind:'playback_set',speed}).success,true);
  assert.ok(bound('speed').some(capability=>capability.id==='playback_set'));
  assert.ok(bound('timeline').some(capability=>capability.id==='playback_set'));
  assert.ok(app.includes('id="draft-mode"'));
  assert.ok(bound('draft-mode').some(capability=>capability.id==='draft_action'));
  const draftSchema=JSON.stringify(editorCommandSchema('draft_action'));
  for(const mode of ['main','optional']) assert.ok(draftSchema.includes(`"${mode}"`),`Draft ${mode} must be expressible without manually changing the select.`);
});

test('every advertised capability has a discoverable schema and stable identity', () => {
  assert.equal(new Set(capabilities.map(capability=>capability.id)).size,capabilities.length);
  for(const capability of capabilities) {
    assert.ok(capability.available,capability.id);
    const schema=editorCommandSchema(capability.id);
    assert.ok(schema,`${capability.id} was advertised but has no discoverable schema.`);
    assert.equal(typeof schema,'object');
  }
});

test('native-file, print and export workflows advertise their interaction boundary', () => {
  for(const id of ['import_request','print_request','export_request','dialog_open']) {
    const capability=capabilities.find(capability=>capability.id===id);
    assert.equal(capability.lane,'interaction');
    assert.equal(capability.undoable,false);
  }
  assert.equal(capabilities.find(capability=>capability.id==='play_create').lane,'workspace');
  assert.equal(capabilities.find(capability=>capability.id==='player_update').lane,'play');
});
