import test from 'node:test';
import assert from 'node:assert/strict';
import { starterWorkspace } from '../web/model.js';
import { withDefense43 } from '../web/defense-formation.js';
import { boardAssistantInput } from '../web/assistant-provider.js';
import { createBoardTools } from '../web/assistant-tools.js';
import { validateBoardReply } from '../web/assistant-harness.js';
import { proposeEdit } from '../web/assistant-proposal.js';
import { proposalConflicts } from '../web/assistant-conflicts.js';

function context(play) {
  const data = starterWorkspace();
  if (play) data.plays[0] = play;
  const input = boardAssistantInput({instruction:'Apply the complete requested edit',board:data.plays[0],editor:{data}});
  const tools = createBoardTools(input,async()=>{throw Error('Local object edits must not search Madden.');});
  return {input,tools,play:input.board.play};
}

async function preview(tools, operations, selectors = []) {
  await tools.run('read_board',{});
  for (const selector of selectors) assert.equal((await tools.run('resolve_player',selector)).status,'found');
  const evidence = await tools.run('preview_edit',{operations});
  assert.equal(evidence.error,undefined);
  return evidence;
}

test('a newly created player alias participates in a group blocking assignment in the same proposal', async () => {
  const {input,tools,play} = context(withDefense43(starterWorkspace().plays[0]));
  const original = structuredClone(play);
  const operations = [
    {kind:'player_add',side:'offense',label:'OL',as:'extraLineman'},
    {kind:'block',playerIds:['$extraLineman'],scheme:'pass_pro',direction:'left'},
  ];
  const evidence = await preview(tools,operations);
  const proposal = proposeEdit(play,operations);
  const added = proposal.play.players.find(player=>!play.players.some(original=>original.id===player.id));
  const route = proposal.play.routes.find(route=>route.playerId===added.id);
  assert.equal(route.kind,'block');
  assert.ok(route.blockTargets.some(id=>play.players.some(player=>player.id===id&&player.side==='defense')));
  assert.ok(evidence.playerIds.includes(added.id));
  assert.equal(proposalConflicts(play,play,operations,proposal),false);
  assert.deepEqual(validateBoardReply({kind:'edit',operations},input,tools,{requirePreview:true}).operations,operations);
  assert.deepEqual(play,original,'building and checking the proposal never saves the new marker');
});

test('a new route alias can be timed through the semantic operation before it is persisted', async () => {
  const {input,tools,play} = context();
  const actor = play.players.find(player=>player.label==='X');
  const operations = [
    {kind:'route_add',playerId:actor.id,routeKind:'route',points:[{x:actor.x,y:actor.y},{x:actor.x,y:40}],as:'newRoute'},
    {kind:'timing',playerId:actor.id,routeId:'$newRoute',delay:1.5,duration:3},
  ];
  const evidence = await preview(tools,operations,[{role:'X'}]);
  const proposal = proposeEdit(play,operations);
  const created = proposal.play.routes.find(route=>!play.routes.some(original=>original.id===route.id));
  assert.equal(created.delay,1.5);
  assert.equal(created.duration,3);
  assert.ok(evidence.routeIds.includes(created.id));
  assert.equal(proposalConflicts(play,play,operations,proposal),false);
  assert.deepEqual(validateBoardReply({kind:'edit',operations},input,tools,{requirePreview:true}).operations,operations);
});

test('blocking a defender created in the same group does not cause a false stale-board conflict', async () => {
  const {input,tools,play} = context();
  const actor = play.players.find(player=>player.label==='C');
  const operations = [
    {kind:'player_add',side:'defense',label:'DT',as:'newTackle'},
    {kind:'block',playerId:actor.id,targetIds:['$newTackle']},
  ];
  await preview(tools,operations,[{role:'C'}]);
  const proposal = proposeEdit(play,operations);
  const added = proposal.play.players.find(player=>!play.players.some(original=>original.id===player.id));
  assert.deepEqual(proposal.play.routes.find(route=>route.playerId===actor.id).blockTargets,[added.id]);
  assert.equal(proposalConflicts(play,play,operations,proposal),false);
  const renamed = structuredClone(play); renamed.title='A concurrent coach note title';
  assert.equal(proposalConflicts(play,renamed,operations,proposal),false);
  const moved = structuredClone(play); moved.players.find(player=>player.id===actor.id).x+=1;
  assert.equal(proposalConflicts(play,moved,operations,proposal),true,'an existing actor is still a real dependency');
  assert.deepEqual(validateBoardReply({kind:'edit',operations},input,tools,{requirePreview:true}).operations,operations);
});

test('aliases retain their object type and a new route still has to belong to the timing actor', async () => {
  const {tools,play} = context();
  await tools.run('read_board',{});
  const badType = await tools.run('preview_edit',{operations:[
    {kind:'zone_add',x:30,y:30,rx:10,ry:10,as:'area'},
    {kind:'player_update',playerId:'$area',patch:{name:'Not a player'}},
  ]});
  assert.match(badType.error,/referenced editor object does not exist/i);
  const actor = play.players.find(player=>player.label==='X');
  const other = play.players.find(player=>player.label==='C');
  await tools.run('resolve_player',{role:'X'});
  await tools.run('resolve_player',{role:'C'});
  const wrongOwner = await tools.run('preview_edit',{operations:[
    {kind:'route_add',playerId:actor.id,routeKind:'route',points:[{x:actor.x,y:actor.y},{x:actor.x,y:40}],as:'path'},
    {kind:'timing',playerId:other.id,routeId:'$path',delay:1,duration:3},
  ]});
  assert.match(wrongOwner.error,/does not belong to this player/i);
});
