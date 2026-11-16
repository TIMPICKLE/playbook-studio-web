import test from 'node:test';
import assert from 'node:assert/strict';
import * as runtime from '@langchain/langgraph';
import {starterWorkspace} from '../web/model.js';
import {boardAssistantInput} from '../web/assistant-provider.js';
import {createBoardTools} from '../web/assistant-tools.js';
import {runBoardAssistant} from '../web/assistant-harness.js';

const base=()=>starterWorkspace().plays[0];
const call=(name,args)=>({role:'assistant',content:null,tool_calls:[{id:name,type:'function',function:{name,arguments:JSON.stringify(args)}}]});

test('selected groups are validated before they enter the shared model context',()=>{
  const play=base(),[first,second]=play.players;
  const input=boardAssistantInput({instruction:'move them',board:{...play,selectedPlayerIds:[first.id,'invented',second.id,first.id]}});
  assert.deepEqual(input.board.selectedPlayerIds,[first.id,second.id]);
});

test('group commands reject every invented member at the same reference boundary as single-object edits',async()=>{
  const play=base(),input=boardAssistantInput({instruction:'move group',board:play}),tools=createBoardTools(input,()=>[]);
  await tools.run('read_board',{});
  for(const kind of ['players_move','players_remove']){
    const operation={kind,playerIds:[play.players[0].id,'invented'],...(kind==='players_move'?{dx:2,dy:0}:{})};
    const result=await tools.run('preview_edit',{operations:[operation]});
    assert.match(result.error,/referenced editor object does not exist/);
  }
});

test('singular clarification with a multi-selection returns the real group as selectable candidates',async()=>{
  const play=base(),ids=play.players.slice(0,2).map(player=>player.id);
  const input=boardAssistantInput({instruction:'move him left',locale:'en',board:{...play,selectedPlayerIds:ids},previous:[{instruction:'prior single edit',playerIds:[ids[0]]}]});
  let step=0;
  const result=await runBoardAssistant({runtime,input,callModel:async messages=>{
    const request=JSON.parse(messages[1].content);
    assert.deepEqual(request.selectedPlayerIds,ids);assert.deepEqual(request.focus.players.map(player=>player.id),ids);
    assert.match(messages[0].content,/not permission to pick its first player/);
    return ++step===1?call('read_board',{}):call('submit_result',{result:{kind:'clarify',message:'Which selected player should move?'}});
  }});
  assert.equal(result.kind,'clarify');assert.deepEqual(result.candidates.map(player=>player.id),ids);assert.equal(result.operations,undefined);
});
