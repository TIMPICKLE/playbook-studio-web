import test from 'node:test';
import assert from 'node:assert/strict';
import * as runtime from '@langchain/langgraph';
import { starterWorkspace } from '../web/model.js';
import { requestBoardAssistant, boardAssistantInput } from '../web/assistant-provider.js';
import { runBoardAssistant } from '../web/assistant-harness.js';
import { BoardOperationsSchema, SubmitResultSchema, submitResultTool, previewEditTool } from '../web/assistant-schema.js';

const play = starterWorkspace().plays[0];
const actor = play.players.find(player => player.label === 'X');
const operations = [{kind:'route',playerId:actor.id,concept:'dig',depthYards:12,breakTo:'inside'}];
const input = boardAssistantInput({instruction:'X runs a twelve yard dig',mode:'edit',board:{...play,play,playId:play.id}});
const call = (name,args,id=name) => ({role:'assistant',content:null,tool_calls:[{id,type:'function',function:{name,arguments:JSON.stringify(args)}}]});
const submit = result => call('submit_result',{result});

test('submission and preview expose the same operation contract used by runtime parsing', () => {
  const edit = SubmitResultSchema.parse({result:{kind:'edit',operations}}).result;
  assert.deepEqual(edit.operations,BoardOperationsSchema.parse(operations));
  const submitJSON = submitResultTool.function.parameters.properties.result;
  const editJSON = submitJSON.oneOf.find(branch => branch.properties.kind.const === 'edit');
  assert.deepEqual(editJSON.properties.operations,previewEditTool.function.parameters.properties.operations);
});

test('native edit submission requires a measured preview before it can end the run', async () => {
  let step=0;
  const events=[];
  const result=await runBoardAssistant({runtime,input,onEvent:event=>events.push(event),callModel:async messages=>{
    step++;
    if(step===1)return call('resolve_player',{role:'X'});
    if(step===2)return submit({kind:'edit',operations});
    if(step===3){
      assert.match(messages.at(-1).content,/preview_edit/);
      return call('preview_edit',{operations});
    }
    const evidence=JSON.parse(messages.filter(message=>message.role==='tool').at(-1).content);
    assert.equal(evidence.effects[0].routes[0].breakDepthYards,12);
    return submit({kind:'edit',summary:'X twelve yard dig',operations});
  }});
  assert.equal(result.kind,'edit');assert.equal(result.submission,'tool');assert.equal(result.repairs,1);
  assert.ok(events.some(event=>event.type==='validation_error'));
  assert.ok(events.some(event=>event.type==='tool'&&event.name==='preview_edit'&&event.summary.includes('breakDepthYards')));
});

test('preview and final submission in one message is a repairable protocol error', async () => {
  let step=0;
  const result=await runBoardAssistant({runtime,input,callModel:async messages=>{
    step++;
    if(step===1)return call('resolve_player',{role:'X'});
    if(step===2)return {role:'assistant',content:null,tool_calls:[...call('preview_edit',{operations},'preview').tool_calls,...submit({kind:'edit',operations}).tool_calls]};
    if(step===3){assert.match(messages.at(-1).content,/later message/);return call('preview_edit',{operations});}
    return submit({kind:'edit',operations});
  }});
  assert.equal(result.repairs,1);assert.equal(result.kind,'edit');
});

test('ordinary model text cannot bypass native submission and preview rules', async () => {
  let step=0;
  const result=await runBoardAssistant({runtime,input,callModel:async messages=>{
    step++;
    if(step===1)return {role:'assistant',content:JSON.stringify({kind:'clarify',message:'Which receiver?'})};
    assert.match(messages.at(-1).content,/submit_result/);
    return submit({kind:'clarify',message:'Which receiver?'});
  }});
  assert.equal(result.submission,'tool');assert.equal(result.repairs,1);
});

test('the final model turn forces submit_result and a known unsupported choice falls back to the generated text contract', async () => {
  let calls=0;
  const result=await requestBoardAssistant({instruction:'inspect',board:{...play,play,playId:play.id},runtime,model:{provider:'openai',model:'test-model',apiKey:'unit-test-key'},fetchImpl:async(_url,options)=>{
    calls++;
    const body=JSON.parse(options.body);
    if(calls<6)return Response.json({choices:[{message:call('read_board',{},'read-'+calls)}]});
    if(calls===6){
      assert.deepEqual(body.tool_choice,{type:'function',function:{name:'submit_result'}});
      assert.deepEqual(body.tools.map(tool=>tool.function.name),['submit_result']);
      return Response.json({error:{message:'tool_choice is not supported by this model'}},{status:400});
    }
    assert.equal(body.tools,undefined);assert.equal(body.tool_choice,undefined);
    assert.match(body.messages.at(-1).content,/generated contract/);
    return Response.json({choices:[{message:{role:'assistant',content:JSON.stringify({kind:'clarify',message:'Which assignment?'})}}]});
  }});
  assert.equal(result.submission,'text');assert.equal(result.modelCalls,6);assert.equal(result.providerCalls,7);
});

test('unrelated provider HTTP errors do not trigger a forced-tool fallback', async () => {
  let calls=0;
  await assert.rejects(requestBoardAssistant({instruction:'inspect',board:{...play,play},runtime,model:{provider:'openai',model:'test-model',apiKey:'unit-test-key'},fetchImpl:async()=>{
    calls++;
    if(calls<6)return Response.json({choices:[{message:call('read_board',{},'read-'+calls)}]});
    return Response.json({error:{message:'invalid tools JSON schema'}},{status:400});
  }}),/HTTP 400/);
  assert.equal(calls,6);
});

test('a failed preview is reported to the model and counts toward the shared repair limit', async () => {
  let step=0;
  const result=await runBoardAssistant({runtime,input,callModel:async messages=>{
    step++;
    if(step===1)return call('resolve_player',{role:'X'});
    if(step===2)return call('preview_edit',{operations:[{...operations[0],depthYards:-2}]});
    if(step===3){assert.match(messages.at(-1).content,/Invalid route concept or depth/);return call('preview_edit',{operations});}
    return submit({kind:'edit',operations});
  }});
  assert.equal(result.repairs,1);assert.equal(result.kind,'edit');
});

test('the full proposal snapshot retains existing long hand-drawn routes and display fields', () => {
  const source=structuredClone(play);
  source.routes=[];
  source.routes.push({id:'long-route',playerId:actor.id,kind:'route',color:actor.color,endCap:'arrow',smooth:false,optional:false,delay:0,duration:4,
    points:Array.from({length:200},(_,index)=>({x:actor.x,y:actor.y-index/10}))});
  const prepared=boardAssistantInput({instruction:'inspect this play',board:{...source,play:source}});
  assert.equal(prepared.board.play.routes[0].points.length,200);
  assert.equal(prepared.board.routes[0].points.length,200);
  assert.equal(prepared.board.play.players[0].shape,source.players[0].shape);
  assert.equal(prepared.board.play.players[0].color,source.players[0].color);
});
