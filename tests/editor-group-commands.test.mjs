import test from 'node:test';
import assert from 'node:assert/strict';
import { makePlay, starterWorkspace, validatePlay } from '../web/model.js';
import { moveSelectedPlayers, removeSelectedPlayers } from '../web/editor-selection.js';
import { runEditorPlayCommand, EditorPlayOperationSchema } from '../web/editor-play-commands.js';
import { prepareEditorActions, EditorActionSchema } from '../web/editor-actions.js';
import { buildAssistantEdit } from '../web/assistant-edit.js';
import { editorCapabilities, editorCommandSchema } from '../web/editor-capabilities.js';

function diagram() {
  const play=makePlay({formation:'Gun Trips'}),[a,b]=play.players;
  Object.assign(a,{x:20,y:70});Object.assign(b,{x:60,y:70});play.ball.holderId=a.id;
  play.routes=[{id:'boundary-route',playerId:b.id,kind:'route',points:[{x:60,y:70},{x:95,y:40}],color:b.color,smooth:false,endCap:'arrow',delay:0,duration:3,optional:false}];
  return play;
}

test('AI and manual group movement share bounded geometry and report the same affected IDs',()=>{
  const play=diagram(),ids=play.players.slice(0,2).map(player=>player.id),before=structuredClone(play);
  const operation={kind:'players_move',playerIds:ids,dx:20,dy:-5};
  const manual=moveSelectedPlayers(play,ids,20,-5);
  const assistant=buildAssistantEdit(play,[],[operation]);
  assert.deepEqual(assistant.play,manual.play);
  assert.equal(assistant.play.players[0].x,25);
  assert.equal(assistant.play.players[1].x,65);
  assert.deepEqual(new Set(assistant.playerIds),new Set(ids));
  assert.deepEqual(play,before);
  validatePlay(assistant.play);
  const draft=structuredClone(play),receipt=runEditorPlayCommand(draft,operation);
  assert.deepEqual(receipt.delta,{x:5,y:-5});
});

test('AI and manual group deletion share cleanup and reject a later stale group without partial input writes',()=>{
  const play=diagram(),ids=play.players.slice(0,2).map(player=>player.id),before=structuredClone(play);
  assert.deepEqual(buildAssistantEdit(play,[],[{kind:'players_remove',playerIds:ids}]).play,removeSelectedPlayers(play,ids).play);
  assert.throws(()=>buildAssistantEdit(play,[],[{kind:'players_move',playerIds:ids,dx:1,dy:0},{kind:'players_remove',playerIds:[ids[0],'gone']}]),/no longer/);
  assert.deepEqual(play,before);
});

test('AI can discover group commands and select real groups without accepting stale IDs or malformed groups',()=>{
  const data=starterWorkspace(),play=data.plays[0],ids=play.players.slice(0,2).map(player=>player.id);
  const input={data,selectedId:play.id},action={kind:'selection_set',objectType:'players',ids};
  assert.deepEqual(prepareEditorActions(input,[action]).actions,[action]);
  assert.throws(()=>prepareEditorActions(input,[{...action,ids:[ids[0],'gone']}]),/not on the current/);
  const capabilities=editorCapabilities({board:play,editor:input});
  for(const id of ['players_move','players_remove']) {
    assert.ok(capabilities.find(item=>item.id===id)?.available);
    assert.ok(editorCommandSchema(id));
  }
  for(const value of [{...action,ids:[]},{...action,ids:[ids[0],ids[0]]},{...action,id:ids[0]}])assert.equal(EditorActionSchema.safeParse(value).success,false);
  for(const value of [{kind:'players_move',playerIds:ids,dx:101,dy:0},{kind:'players_remove',playerIds:[]},{kind:'players_remove',playerIds:[ids[0],ids[0]]}])assert.equal(EditorPlayOperationSchema.safeParse(value).success,false);
});
