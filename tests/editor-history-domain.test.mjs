import test from 'node:test';
import assert from 'node:assert/strict';
import { starterWorkspace, clone, encodeWorkspace, decodeWorkspace } from '../web/model.js';
import { EditorHistory, PersonnelHistoryConflict } from '../web/editor-history.js';
import { refreshRosterBindings } from '../web/board-personnel.js';

test('undoing a diagram edit preserves a later roster rename and depth chart', () => {
  const data=starterWorkspace(), play=data.plays[0], marker=play.players.find(p=>p.label==='QB');
  marker.rosterId=data.roster[0].id;marker.name=data.roster[0].name;
  const initial={data,selectedId:play.id}, history=new EditorHistory();
  history.record(initial,{name:'Move X'});
  const changed=clone(initial);changed.data.plays[0].routes[0].points[1].y=22;
  const oldRoster=clone(changed.data.roster);changed.data.roster[0].name='New QB';
  refreshRosterBindings(changed.data,oldRoster);
  const restored=history.undo(changed);
  assert.equal(restored.data.roster[0].name,'New QB');
  assert.equal(restored.data.plays[0].players.find(p=>p.id===marker.id).name,'New QB');
  assert.equal(restored.data.plays[0].routes[0].points[1].y,initial.data.plays[0].routes[0].points[1].y);
  assert.deepEqual(decodeWorkspace(encodeWorkspace(restored.data)),restored.data);
});

test('redo applies current personnel without resurrecting deleted bindings', () => {
  const data=starterWorkspace(), id=data.roster[0].id;
  data.plays[0].players[0].rosterId=id;data.plays[0].players[0].name=data.roster[0].name;
  const state={data,selectedId:data.plays[0].id}, history=new EditorHistory();
  const receipt=history.record(state,{name:'AI routes',source:'assistant'});
  const changed=clone(state);changed.data.plays[0].title='Changed';
  const restored=history.undo(changed);assert.equal(history.lastTransaction.id,receipt.id);
  const personnel=clone(restored.data);personnel.roster=personnel.roster.filter(p=>p.id!==id);
  const redone=history.redo({...restored,data:personnel});
  assert.equal(redone.data.plays[0].players[0].rosterId,undefined);
  assert.ok(!redone.data.roster.some(p=>p.id===id));
  assert.equal(history.lastTransaction.status,'redone');
  assert.equal(history.info().id,receipt.id);
  assert.equal(JSON.stringify(redone).includes(receipt.id),false);
});

test('diagram undo and redo preserve team settings while retaining diagram view-setting history', () => {
  const data=starterWorkspace(), state={data,selectedId:data.plays[0].id}, history=new EditorHistory();
  history.record(state,{name:'Edit diagram and grid'});
  const changed=clone(state);
  changed.data.plays[0].title='Edited diagram'; changed.data.settings.showGrid=false;
  changed.data.team={name:'Flag squad',subtitle:'New season',accent:'#123456'};
  changed.data.settings.league=5;
  const restored=history.undo(changed);
  assert.deepEqual(restored.data.team,changed.data.team);
  assert.equal(restored.data.settings.league,5);
  assert.equal(restored.data.settings.showGrid,true);
  assert.equal(restored.data.plays[0].title,state.data.plays[0].title);
  const newer=clone(restored);
  newer.data.team.name='Renamed again'; newer.data.settings.league=8;
  const redone=history.redo(newer);
  assert.deepEqual(redone.data.team,newer.data.team);
  assert.equal(redone.data.settings.league,8);
  assert.equal(redone.data.settings.showGrid,false);
});

test('a quick personnel adjustment and its own reversal preserve the diagram undo transaction', () => {
  const data=starterWorkspace({demoDepth:true}), state={data,selectedId:data.plays[0].id}, history=new EditorHistory();
  const receipt=history.record(state,{name:'Move route',source:'assistant'});
  const changed=clone(state);changed.data.plays[0].routes[0].points[1].y+=10;
  const slot=changed.data.depthChart.groups[0].slots.find(item=>item.playerIds.length>1);
  assert.ok(slot,'demo has a starter and reserve');
  const original=[...slot.playerIds];
  [slot.playerIds[0],slot.playerIds[1]]=[slot.playerIds[1],slot.playerIds[0]];
  const restored = history.undo(changed);
  const restoredSlot = restored.data.depthChart.groups[0].slots.find(item => item.id === slot.id);
  assert.deepEqual(restoredSlot.playerIds, slot.playerIds);
  assert.deepEqual(restored.data.plays[0].routes, state.data.plays[0].routes);
  restoredSlot.playerIds = original;
  const redone = history.redo(restored);
  assert.deepEqual(redone.data.depthChart, state.data.depthChart);
  assert.deepEqual(redone.data.plays[0].routes, changed.data.plays[0].routes);
  assert.equal(history.info().id, receipt.id);
});

test('undo keeps history and data intact while later roster edits depend on the same imported player', () => {
  const data = starterWorkspace();
  const before = { data, selectedId: data.plays[0].id };
  const imported = clone(before);
  const newPlayer = { ...data.roster[0], id: 'new-qb', name: 'Imported QB' };
  imported.data.roster.push(newPlayer);
  const history = new EditorHistory();
  const receipt = history.record(before, { name: 'Import' }, imported.data);

  const live = clone(imported);
  const player = live.data.roster.at(-1);
  player.name = 'Renamed QB';
  const snapshot = history.past.at(-1);
  assert.throws(() => history.undo(live), PersonnelHistoryConflict);
  assert.equal(history.past.at(-1), snapshot);
  assert.equal(history.info().id, receipt.id);
  assert.equal(history.future.length, 0);
  assert.equal(player.name, 'Renamed QB');

  player.name = newPlayer.name;
  const slot = live.data.depthChart.groups[0].slots[0];
  slot.playerIds = [newPlayer.id];
  assert.throws(() => history.undo(live), PersonnelHistoryConflict);
  assert.equal(history.past.at(-1), snapshot);
  assert.deepEqual(slot.playerIds, [newPlayer.id]);
  slot.playerIds = [];
  assert.deepEqual(history.undo(live), before);
  assert.deepEqual(history.redo(before), imported);
});

test('redo only restores import effects actually undone after an independently removed roster member', () => {
  const data = starterWorkspace();
  const before = { data, selectedId: data.plays[0].id };
  const after = clone(before);
  after.data.plays.push({ ...clone(data.plays[0]), id: 'imported-play' });
  after.data.roster.push({ ...data.roster[0], id: 'imported-player' });
  const history = new EditorHistory();
  history.record(before, { name: 'Import' }, after.data);
  after.data.roster.pop();
  const undone = history.undo(after);
  undone.data.roster[0].name = 'Changed again';
  const redone = history.redo(undone);
  assert.equal(redone.data.plays.at(-1).id, 'imported-play');
  assert.equal(redone.data.roster[0].name, 'Changed again');
  assert.ok(!redone.data.roster.some(player => player.id === 'imported-player'));
});

test('undo after a roster rename and deletion keeps the last display name on a historical marker', () => {
  const data = starterWorkspace();
  const marker = data.plays[0].players[0];
  marker.rosterId = data.roster[0].id;
  marker.name = data.roster[0].name;
  const state = { data, selectedId: data.plays[0].id };
  const history = new EditorHistory();
  history.record(state);
  const after = clone(state);
  after.data.plays[0].title = 'Edited diagram';
  const [removed] = after.data.roster.splice(0, 1);
  removed.name = 'Final roster name';
  history.detachRemovedPlayers([removed]);
  const restored = history.undo(after);
  assert.equal(restored.data.plays[0].players[0].name, removed.name);
  assert.equal(restored.data.plays[0].players[0].rosterId, undefined);
});
