import test from 'node:test';
import assert from 'node:assert/strict';
import { makePlay, validatePlay } from '../web/model.js';
import { proposeEdit } from '../web/assistant-proposal.js';
import { buildOperations } from '../web/assistant-operations.js';
import { parseBoardOperations, previewEditTool } from '../web/assistant-schema.js';

test('the shared proposal engine measures the generated dig and returns readable object changes', () => {
  const play = makePlay({formation:'Gun Trips'});
  const actor = play.players.find(player => player.label === 'X');
  actor.name = 'Avery Smith';
  const before = JSON.stringify(play);
  const proposal = proposeEdit(play, [{kind:'route',playerId:actor.id,concept:'dig',depthYards:12,breakTo:'inside'}]);
  assert.equal(JSON.stringify(play), before);
  assert.deepEqual(validatePlay(proposal.play), proposal.play);
  assert.equal(proposal.effects[0].depthYards, 12);
  assert.equal(proposal.effects[0].breakTo, 'inside');
  assert.match(proposal.changes[0], /X Avery Smith/);
  assert.match(proposal.changes[0], /12 码/);
  assert.deepEqual(proposal.effects[0].routeIds, proposal.routeIds);
  assert.equal(proposal.effects[0].depthLimited, false);
});

test('full play limits are checked during proposal generation even with a legacy dryRun argument', () => {
  const play = makePlay({formation:'Gun Trips'});
  play.zones = Array.from({length:60}, (_, index) => ({id:'zone-'+index,x:20,y:30,rx:10,ry:10,color:'#88bfff',label:'ZONE'}));
  const before = JSON.stringify(play);
  const operations = [{kind:'zone',preset:'deep_third',side:'left'}];
  assert.throws(() => proposeEdit(play, operations));
  assert.throws(() => buildOperations(play, operations, {dryRun:true}));
  assert.equal(JSON.stringify(play), before);
});

test('effects report actual field clipping and the actual ordered block targets', () => {
  const play = makePlay({formation:'Gun Trips'});
  const actor = play.players.find(player => player.label === 'X');
  const deep = proposeEdit(play, [{kind:'route',playerId:actor.id,concept:'go',depthYards:40}]);
  assert.equal(deep.effects[0].requestedDepthYards, 40);
  assert.equal(deep.effects[0].depthYards, 33.5);
  assert.equal(deep.effects[0].depthLimited, true);

  const center = play.players.find(player => player.label === 'C');
  play.players.push(
    {id:'tackle',label:'DT',name:'Alex',x:center.x,y:center.y-8,side:'defense',color:'#88bfff',shape:'circle'},
    {id:'backer',label:'LB',name:'Mike',x:center.x+5,y:center.y-20,side:'defense',color:'#88bfff',shape:'circle'},
  );
  const blocked = proposeEdit(play,[{kind:'block',playerId:center.id,targetIds:['tackle','backer']}]);
  assert.deepEqual(blocked.effects[0].targetIds,['tackle','backer']);
  assert.deepEqual(blocked.effects[0].targetLabels,['DT Alex','LB Mike']);
  assert.match(blocked.changes[0],/DT Alex → LB Mike/);
});

test('multiple operations report measured changes, created IDs and removed route IDs', () => {
  const play = makePlay({formation:'Gun Trips'});
  const actor = play.players.find(player => player.label === 'X');
  const first = proposeEdit(play,[{kind:'route',playerId:actor.id,concept:'dig',depthYards:10}]);
  const next = proposeEdit(first.play,[
    {kind:'move_player',playerId:actor.id,dxYards:2,dyYards:1},
    {kind:'remove_route',playerId:actor.id,routeId:first.routeId},
    {kind:'zone',preset:'flat',side:'left'},
    {kind:'annotate',nearId:actor.id,text:'Look inside'},
  ]);
  assert.equal(next.effects[0].dxYards,2);
  assert.equal(next.effects[0].dyYards,1);
  assert.deepEqual(next.removed.routes,[first.routeId]);
  assert.deepEqual(next.effects[1].routeIds,[first.routeId]);
  assert.equal(next.zoneIds.length,1);
  assert.equal(next.annotationIds.length,1);
});

test('the same normalized proposal produces stable new IDs across preview and application', () => {
  const play = makePlay({formation:'Gun Trips'});
  const actor = play.players.find(player => player.label === 'X');
  const operations = [
    {kind:'route',playerId:actor.id,concept:'dig',depthYards:12,breakTo:'inside'},
    {kind:'zone',preset:'deep_third',side:'left'},
    {kind:'annotate',nearId:actor.id,text:'Read the corner'},
  ];
  const first = proposeEdit(play, operations);
  const reordered = Object.fromEntries(Object.entries(play).reverse());
  const second = proposeEdit(JSON.parse(JSON.stringify(reordered)), operations);
  assert.deepEqual(first.play,second.play);
  assert.deepEqual(first.routeIds,second.routeIds);
  assert.deepEqual(first.zoneIds,second.zoneIds);
  assert.deepEqual(first.annotationIds,second.annotationIds);
  const ids = [...first.routeIds,...first.zoneIds,...first.annotationIds];
  assert.equal(new Set(ids).size,ids.length);
});

test('new geometry intents survive validation while translated route intents are cleared', () => {
  const play = makePlay({formation:'Gun Trips'});
  const actor = play.players.find(player => player.label === 'X');
  const first = proposeEdit(play,[{kind:'route',playerId:actor.id,concept:'dig',depthYards:12,breakTo:'inside'}]);
  assert.deepEqual(first.play.routes.find(route => route.id === first.routeId).intent,{concept:'dig',depthYards:12,breakTo:'inside'});
  const shifted = proposeEdit(first.play,[{kind:'move_player',playerId:actor.id,dxYards:1,dyYards:1}]);
  assert.equal(shifted.play.routes.find(route => route.id === first.routeId).intent,undefined);
});

test('schema and proposal share movement limits and support either individual axis', () => {
  const play = makePlay({formation:'Gun Trips'});
  const actor = play.players.find(player => player.label === 'X');
  for (const offset of [{dxYards:2},{dyYards:2},{dxYards:53.333333,dyYards:30},{dxYards:-53.333333,dyYards:-30}]) {
    const operations = [{kind:'move_player',playerId:actor.id,...offset}];
    assert.doesNotThrow(() => parseBoardOperations(operations));
    const proposal = proposeEdit(play,operations);
    const effect = proposal.effects[0];
    const moved = proposal.play.players.find(player => player.id === actor.id);
    assert.equal(effect.forwardYards,effect.dyYards);
    assert.deepEqual(effect.start,{x:actor.x,y:actor.y});
    assert.deepEqual(effect.end,{x:moved.x,y:moved.y});
    if (!('dyYards' in offset)) assert.equal(effect.dyYards,0);
    if (!('dxYards' in offset)) assert.equal(effect.dxYards,0);
  }
  for (const offset of [{},{dxYards:53.333334},{dyYards:30.0001},{dyYards:-30.0001}]) {
    const operations = [{kind:'move_player',playerId:actor.id,...offset}];
    assert.throws(() => parseBoardOperations(operations),/Invalid movement/);
    assert.throws(() => proposeEdit(play,operations),/Invalid movement/);
  }
  // The tool contract is generated from the same input schema, including the
  // alternative required-axis shapes, rather than from handwritten descriptions.
  const tool = JSON.stringify(previewEditTool.function.parameters);
  assert.match(tool, /53\.333333/);
  assert.match(tool, /"maximum":30/);
  assert.doesNotMatch(tool, /"maximum":50/);
});
