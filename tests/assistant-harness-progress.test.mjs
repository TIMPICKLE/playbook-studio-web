import test from 'node:test';
import assert from 'node:assert/strict';
import * as runtime from '@langchain/langgraph';
import { starterWorkspace } from '../web/model.js';
import { boardAssistantInput, invokeBoardModel } from '../web/assistant-provider.js';
import { BOARD_AGENT_LIMITS, runBoardAssistant } from '../web/assistant-harness.js';

const play = starterWorkspace().plays[0];
const actor = play.players.find(player => player.label === 'X');
const input = () => boardAssistantInput({instruction:'Inspect the diagram and adjust X.',locale:'en',board:{...play,play,playId:play.id}});
const call = (name,args,id=name) => ({id,type:'function',function:{name,arguments:JSON.stringify(args)}});
const message = (...tool_calls) => ({role:'assistant',content:null,tool_calls});
const submit = result => message(call('submit_result',{result}));
const config = {provider:'openai',protocol:'openai',endpoint:'https://unit.test/model',model:'test',apiKey:'unit-test-key'};
const response = result => Response.json({choices:[{message:result}]});

test('productive work continues beyond six model turns and ten tool calls', async () => {
  let step = 0;
  const events = [];
  const people = [actor,...play.players.filter(player => player !== actor)];
  const operations = [{kind:'route',playerId:actor.id,concept:'dig',depthYards:12,breakTo:'inside'}];
  const result = await runBoardAssistant({runtime,input:input(),onEvent:event=>events.push(event),callModel:async (_messages,definitions,allowTools,options) => {
    assert.equal(allowTools,true);
    assert.equal(options.forceSubmit,false);
    assert.ok(definitions.some(tool => tool.function.name === 'resolve_player'));
    const current = step++;
    if (current < people.length) return message(call('resolve_player',{role:people[current].label},'person-'+current));
    if (current === people.length) return message(call('preview_edit',{operations}));
    return submit({kind:'edit',operations});
  }});
  assert.equal(result.kind,'edit');
  assert.ok(result.modelCalls > 6);
  assert.ok(result.toolsUsed.length > 10);
  assert.equal(result.repairs,0);
  assert.equal(events.filter(event => event.type === 'model_step').length,result.modelCalls);
  assert.equal('modelCalls' in BOARD_AGENT_LIMITS,false);
  assert.equal('toolCalls' in BOARD_AGENT_LIMITS,false);
});

test('repeated equivalent lookups finish from existing evidence instead of reporting a usage quota', async () => {
  let step = 0;
  const selectors = [{role:'X'},{role:'X',side:'offense'},{role:'X',selectMany:false},{side:'offense',role:'X'}];
  const result = await runBoardAssistant({runtime,input:input(),callModel:async (_messages,definitions,allowTools,options) => {
    if (options.forceSubmit) {
      assert.equal(allowTools,false);
      assert.deepEqual(definitions.map(tool => tool.function.name),['submit_result']);
      return submit({kind:'clarify',message:'X is resolved. Which assignment should change?'});
    }
    return message(call('resolve_player',selectors[step++],'resolve-'+step));
  }});
  assert.equal(result.kind,'clarify');
  assert.equal(step,4);
  assert.equal(result.modelCalls,5);
  assert.doesNotMatch(result.message,/limit|quota/i);
});

test('changing search terms without finding candidates does not count as progress', async () => {
  let queries = 0;
  const result = await runBoardAssistant({runtime,input:input(),searchCatalog:async()=>[],callModel:async (_messages,_definitions,_allowTools,options) => {
    if (options.forceSubmit) return submit({kind:'clarify',message:'No catalog evidence supports this request.'});
    return message(call('search_madden',{concepts:['unmatched-'+queries++]},'search-'+queries));
  }});
  assert.equal(queries,3);
  assert.equal(result.modelCalls,4);
  assert.equal(result.kind,'clarify');
});

test('missing players and repeated tool errors cannot keep an ineffective run alive', async () => {
  for (const name of ['resolve_player','unknown_tool']) {
    let queries = 0;
    const result = await runBoardAssistant({runtime,input:input(),callModel:async () => message(call(name,{role:'missing-'+queries++},'query-'+queries))});
    assert.equal(result.kind,'clarify');
    assert.equal(result.submission,'none');
    assert.match(result.message,/repeated queries/);
    assert.equal(result.modelCalls,4);
    assert.equal(result.toolsUsed.length,3);
  }
});

test('new ambiguous candidates count as evidence, while repeating the same ambiguity does not', async () => {
  const prepared = input(), roles = ['WR','DT','LB','CB'];
  prepared.board.players = roles.flatMap(role=>[1,2].map(index=>({...actor,id:role+index,label:role,side:role==='WR'?'offense':'defense'})));
  let step = 0;
  const explored = await runBoardAssistant({runtime,input:prepared,callModel:async (_messages,_definitions,_allowTools,options)=>{
    assert.equal(options.forceSubmit,false);
    if(step<roles.length)return message(call('resolve_player',{role:roles[step++]},'role-'+step));
    return submit({kind:'clarify',message:'Each role has two candidates; choose the intended players.'});
  }});
  assert.equal(explored.modelCalls,5);
  const repeated = await runBoardAssistant({runtime,input:prepared,callModel:async()=>message(call('resolve_player',{role:'WR'}))});
  assert.equal(repeated.kind,'clarify');
  assert.equal(repeated.modelCalls,5);
});

test('long productive histories compact exact evidence without losing IDs, preview effects, or tool protocol pairs', async () => {
  const prepared = input();
  prepared.board.notes = 'Detailed board context. '.repeat(1700);
  const people = [actor,...play.players.filter(player => player !== actor)];
  const operations = [{kind:'route',playerId:actor.id,concept:'dig',depthYards:12,breakTo:'inside'}];
  let turn = 0, person = 0, compacted = false, lastMessages;
  const result = await runBoardAssistant({runtime,input:prepared,onEvent:event=>{if(event.type==='context_compacted')compacted=true;},callModel:async messages => {
    lastMessages = structuredClone(messages);
    const toolCalls = new Set();
    for (const entry of messages) {
      for (const tool of entry.tool_calls || []) toolCalls.add(tool.id);
      if (entry.role === 'tool') assert.ok(toolCalls.has(entry.tool_call_id),'tool result retains its assistant call');
    }
    if (turn++ === 1) return message(call('preview_edit',{operations},'preview'));
    if (person < people.length) {
      const player = people[person++];
      return message(call('read_board',{},'read-'+turn),call('resolve_player',{role:player.label},'resolve-'+turn));
    }
    return submit({kind:'edit',operations});
  }});
  assert.equal(result.kind,'edit');
  assert.equal(result.repairs,0);
  assert.ok(compacted);
  const memory = lastMessages.find(entry=>entry.role==='user'&&entry.content.startsWith('Earlier read-only tool evidence'));
  assert.ok(memory);
  assert.ok(memory.content.includes(actor.id));
  assert.ok(memory.content.includes('preview_edit'));
  assert.ok(memory.content.includes('"breakDepthYards":12'));
  assert.ok(new TextEncoder().encode(JSON.stringify(lastMessages)).length < BOARD_AGENT_LIMITS.transcriptBytes);
});

test('oversized parallel batches still fail validation without a user query-limit error', async () => {
  await assert.rejects(runBoardAssistant({runtime,input:input(),callModel:async()=>message(...Array.from({length:6},(_,index)=>call('read_board',{},'read-'+index)))}),/invalid operation/);
});

test('user cancellation preserves the cancellation reason and stops further work', async () => {
  const control = new AbortController();
  let calls = 0;
  await assert.rejects(runBoardAssistant({runtime,input:input(),signal:control.signal,callModel:async()=>{
    calls++;
    control.abort();
    return message(call('read_board',{}));
  }}),error=>error.name==='AbortError');
  assert.equal(calls,1);
});

test('productive provider runs can exceed ninety seconds in total while each response remains timely', async t => {
  t.mock.timers.enable({apis:['setTimeout']});
  let calls = 0;
  const result = await invokeBoardModel(config,input(),{runtime,fetchImpl:async (_url,options)=>{
    t.mock.timers.tick(60000);
    assert.equal(options.signal.aborted,false);
    const index = calls++;
    return response(index < 3 ? message(call('resolve_player',{role:play.players[index].label},'person-'+index)) : submit({kind:'clarify',message:'Which assignment?'}));
  }});
  assert.equal(result.modelCalls,4);
  assert.equal(result.providerCalls,4);
});

test('a stalled HTTP request and a stalled response reader each time out independently', async t => {
  t.mock.timers.enable({apis:['setTimeout']});
  for (const stage of ['fetch','body']) {
    let started;
    const ready = new Promise(resolve=>{started=resolve;});
    const pending = invokeBoardModel(config,input(),{runtime,
      fetchImpl:async()=>{
        if(stage==='fetch'){started();return new Promise(()=>{});}
        return response(submit({kind:'clarify',message:'Which assignment?'}));
      },
      ...(stage==='body'?{readResponse:async()=>{started();return new Promise(()=>{});}}:{}),
    });
    await ready;
    t.mock.timers.tick(90000);
    await assert.rejects(pending,/timed out/);
  }
});

test('unsupported forced-tool fallback receives its own response deadline', async t => {
  t.mock.timers.enable({apis:['setTimeout']});
  let calls = 0;
  const result = await invokeBoardModel(config,input(),{runtime,fetchImpl:async (_url,options)=>{
    calls++;
    const body = JSON.parse(options.body);
    if(body.tool_choice==='auto')return response(message(call('read_board',{},'read-'+calls)));
    t.mock.timers.tick(60000);
    assert.equal(options.signal.aborted,false);
    if(body.tool_choice)return Response.json({error:{message:'tool_choice is not supported'}},{status:400});
    assert.equal(body.tools,undefined);
    return response({role:'assistant',content:JSON.stringify({kind:'clarify',message:'Which assignment?'})});
  }});
  assert.equal(result.submission,'text');
  assert.equal(result.providerCalls,result.modelCalls+1);
});

test('cancelling while reading a provider response rejects promptly as cancellation', async () => {
  const control = new AbortController();
  let started;
  const ready = new Promise(resolve=>{started=resolve;});
  const pending = invokeBoardModel(config,input(),{runtime,signal:control.signal,
    fetchImpl:async()=>response(submit({kind:'clarify',message:'Which assignment?'})),
    readResponse:async()=>{started();return new Promise(()=>{});},
  });
  await ready;
  control.abort();
  await assert.rejects(pending,error=>error.name==='AbortError');
});
