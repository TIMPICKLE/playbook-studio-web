import test from 'node:test';
import assert from 'node:assert/strict';
import * as runtime from '@langchain/langgraph';
import { starterWorkspace } from '../web/model.js';
import { requestBoardAssistant } from '../web/assistant-provider.js';
import { createDemoRequest } from '../web/ai-demo.js';
import { handleApi } from '../server/api.mjs';
import { database } from './helpers/db.mjs';

const apiKey = 'matrix-test-secret';
const modes = [
  {protocol:'openai',provider:'openai',endpoint:'https://api.openai.com/v1/chat/completions'},
  {protocol:'anthropic',provider:'anthropic',endpoint:'https://api.anthropic.com/v1/messages'},
  {protocol:'responses',provider:'openai',endpoint:'https://api.openai.com/v1/responses'},
];
const modelFor = mode => ({provider:mode.provider,protocol:mode.protocol,model:'matrix-test-model',apiKey});
const call = (id,name,args={}) => ({id,name,args});
const signedThinking = {type:'thinking',thinking:'private matrix reasoning',signature:'matrix-signature'};
const encryptedReasoning = {type:'reasoning',id:'rs_matrix',summary:[],encrypted_content:'opaque-matrix-reasoning'};

// Independent wire fixtures intentionally do not call the production serializer.
function wireResponse(protocol,{calls=[],text=null,reasoning=false}={}) {
  if (protocol==='anthropic') return Response.json({type:'message',role:'assistant',stop_reason:calls.length?'tool_use':'end_turn',content:[
    ...(reasoning?[signedThinking]:[]),
    ...calls.map(item=>({type:'tool_use',id:item.id,name:item.name,input:item.args})),
    ...(text==null?[]:[{type:'text',text}]),
  ]});
  if (protocol==='responses') return Response.json({id:'resp_matrix',object:'response',status:'completed',output:[
    ...(reasoning?[encryptedReasoning]:[]),
    ...calls.map(item=>({type:'function_call',id:'fc_'+item.id,call_id:item.id,name:item.name,arguments:JSON.stringify(item.args),status:'completed'})),
    ...(text==null?[]:[{type:'message',id:'msg_matrix',role:'assistant',status:'completed',content:[{type:'output_text',text,annotations:[]}]}]),
  ]});
  return Response.json({choices:[{finish_reason:calls.length?'tool_calls':'stop',message:{role:'assistant',content:text,
    ...(calls.length?{tool_calls:calls.map(item=>({id:item.id,type:'function',function:{name:item.name,arguments:JSON.stringify(item.args)}}))}:{}),
  }}]});
}

function wireResults(protocol,body) {
  if (protocol==='responses') return body.input.filter(item=>item.type==='function_call_output').map(item=>({id:item.call_id,value:JSON.parse(item.output)}));
  if (protocol==='anthropic') return body.messages.flatMap(message=>Array.isArray(message.content)?message.content:[])
    .filter(block=>block.type==='tool_result').map(item=>({id:item.tool_use_id,value:JSON.parse(item.content)}));
  return body.messages.filter(message=>message.role==='tool').map(item=>({id:item.tool_call_id,value:JSON.parse(item.content)}));
}
function bodyUserText(protocol,body) {
  const messages=protocol==='responses'?body.input:body.messages;
  return messages.filter(item=>item.role==='user').map(item=>typeof item.content==='string'?item.content:
    (item.content||[]).filter(block=>['text','input_text'].includes(block.type)).map(block=>block.text).join('')).find(text=>text.startsWith('{'));
}
function checkEnvelope(mode,url,options,{browser=false}={}) {
  assert.equal(url,mode.endpoint);
  const body=JSON.parse(options.body),headers=new Headers(options.headers);
  assert.doesNotMatch(options.body,new RegExp(apiKey));
  if(mode.protocol==='anthropic') {
    assert.equal(headers.get('x-api-key'),apiKey);
    assert.equal(headers.get('anthropic-version'),'2023-06-01');
    assert.equal(headers.has('Authorization'),false);
    assert.ok(typeof body.system==='string');
    assert.equal(body.messages.some(message=>message.role==='system'),false);
    if(browser&&new URL(url).hostname==='api.anthropic.com')assert.equal(headers.get('anthropic-dangerous-direct-browser-access'),'true');
  } else {
    assert.equal(headers.get('Authorization'),'Bearer '+apiKey);
    assert.equal(headers.has('x-api-key'),false);
  }
  if(mode.protocol==='responses') {
    assert.equal(body.store,false);
    assert.ok(Array.isArray(body.input));
    assert.equal('messages' in body,false);
    assert.ok(body.max_output_tokens>0);
    for(const tool of body.tools||[]) {
      assert.equal(tool.type,'function');
      assert.equal(typeof tool.name,'string');
      assert.equal('function' in tool,false);
      assert.equal(tool.strict,false,'optional editor schemas must remain non-strict on the wire');
    }
  }
  return body;
}
function checkReplay(mode,body) {
  if(mode.protocol==='anthropic') {
    const assistant=body.messages.find(message=>message.role==='assistant');
    assert.deepEqual(assistant.content[0],signedThinking,'signed original blocks survive native continuation');
    const parallel=body.messages.find(message=>message.role==='user'&&Array.isArray(message.content)&&message.content.some(block=>block.tool_use_id==='board'));
    assert.deepEqual(parallel.content.map(block=>block.tool_use_id),['board','actor']);
  }
  if(mode.protocol==='responses') {
    assert.deepEqual(body.input.find(item=>item.type==='reasoning'),encryptedReasoning);
    assert.deepEqual(body.input.filter(item=>item.type==='function_call').map(item=>item.call_id),['board','actor']);
    assert.deepEqual(body.input.filter(item=>item.type==='function_call_output').map(item=>item.call_id),['board','actor']);
  }
}
function boardModel(mode,play,{browser=false}={}) {
  let requests=0;
  const actor=play.players.find(player=>player.label==='X');
  const operations=[{kind:'route',playerId:actor.id,concept:'post',depthYards:12}];
  return {operations,get requests(){return requests;},async fetch(url,options) {
    const body=checkEnvelope(mode,url,options,{browser});requests++;
    if(requests===1)return wireResponse(mode.protocol,{calls:[call('board','read_board'),call('actor','resolve_player',{role:'X'})],reasoning:true});
    const results=wireResults(mode.protocol,body);
    if(requests===2) {
      checkReplay(mode,body);
      assert.deepEqual(results.map(item=>item.id),['board','actor']);
      assert.equal(results.find(item=>item.id==='actor').value.candidates[0].id,actor.id);
      return wireResponse(mode.protocol,{calls:[call('preview','preview_edit',{operations})]});
    }
    assert.equal(requests,3);
    const preview=results.find(item=>item.id==='preview').value;
    assert.equal(preview.effects[0].depthYards,12);
    assert.equal(preview.effects[0].routes[0].breakTo,'inside');
    return wireResponse(mode.protocol,{calls:[call('finish','submit_result',{result:{kind:'edit',operations}})]});
  }};
}

test('all three native formats run browser board read/resolve/preview/submit edits',async t=>{
  for(const mode of modes)await t.test(mode.protocol,async()=>{
    const play=starterWorkspace().plays[0],before=structuredClone(play),script=boardModel(mode,play,{browser:true});
    const result=await requestBoardAssistant({instruction:'X runs a twelve yard post',locale:'en',board:play,model:modelFor(mode),runtime,fetchImpl:script.fetch});
    assert.deepEqual(result.operations,script.operations);
    assert.equal(script.requests,3);
    assert.equal(result.submission,'tool');
    assert.deepEqual(play,before,'the provider returns a proposal, never persists diagram edits');
    assert.doesNotMatch(JSON.stringify(result),/opaque-matrix|matrix-signature|private matrix|matrix-test-secret/);
  });
});

async function workspaceFixture(t) {
  const db=database(t),user={userId:'matrix-owner',email:'matrix@example.com'};
  const post=(path,body)=>handleApi(new Request('https://test.local/api'+path,{method:'POST',headers:{origin:'https://test.local','content-type':'application/json'},body:JSON.stringify(body)}),{DB:db},user);
  const response=await post('/workspaces',{title:'Protocol matrix'});
  assert.equal(response.status,201);
  const book=await response.json();
  return {db,post,book};
}

test('Worker board endpoints resolve every native format and retain the full edit tool cycle',async t=>{
  for(const mode of modes)await t.test(mode.protocol,async st=>{
    const {book,post}=await workspaceFixture(st),play=book.data.plays[0],script=boardModel(mode,play);
    st.mock.method(globalThis,'fetch',script.fetch);
    const response=await post('/workspaces/'+book.id+'/board-assistant',{instruction:'X runs a twelve yard post',locale:'en',board:play,revision:book.revision,model:modelFor(mode)});
    const result=await response.json();
    assert.equal(response.status,200,JSON.stringify(result));
    assert.deepEqual(result.operations,script.operations);
    assert.equal(script.requests,3);
    assert.equal(result.revision,book.revision);
    assert.doesNotMatch(JSON.stringify(result),/opaque-matrix|matrix-signature|private matrix|matrix-test-secret/);
  });
});

const report = evidenceId => ({summary:'Conditional diagram review',scenarios:[
  {title:'If the defender widens',condition:'If the installed rule permits',observation:'Watch the short defender',possibility:'An inside window may appear',action:'Follow the installed read',limitations:'Assignments and arrival times are unknown',evidenceIds:[evidenceId]},
  {title:'If the defender stays inside',condition:'If the coverage is confirmed',observation:'Watch outside leverage',possibility:'The outside option may become available',action:'Confirm the read with the coach',limitations:'Static geometry cannot establish an outcome',evidenceIds:[evidenceId]},
],missingInfo:['Installed timing']});
const analysisBody=(data,mode)=>({locale:'en',offensePlayId:data.plays.find(play=>play.book==='offense').id,defensePlayId:data.plays.find(play=>play.book==='defense').id,
  coverage:'unknown',mode:'real_football',context:'third and six',includeNotes:false,model:modelFor(mode)});

test('the browser matchup demo parses all three final-response shapes and checks real evidence IDs',async t=>{
  for(const mode of modes)await t.test(mode.protocol,async()=>{
    const data=starterWorkspace(),body=analysisBody(data,mode);
    data.plays[0].players[0].name='DO NOT SEND ROSTER NAME';data.plays[0].notes='DO NOT SEND PRIVATE NOTES';
    let count=0;
    const request=createDemoRequest(()=>data,async(url,options)=>{
      const payload=checkEnvelope(mode,url,options,{browser:true});count++;
      assert.doesNotMatch(options.body,/DO NOT SEND ROSTER NAME|DO NOT SEND PRIVATE NOTES/);
      const context=JSON.parse(bodyUserText(mode.protocol,payload));
      assert.ok(context.evidence.length);
      return wireResponse(mode.protocol,{text:JSON.stringify(report(context.evidence[0].id))});
    });
    const result=await request('/ignored',{body});
    assert.equal(count,1);assert.equal(result.scenarios.length,2);
    assert.ok(result.evidence.some(item=>item.id===result.scenarios[0].evidenceIds[0]));
    assert.equal(result.grounding.citationIdsVerified,true);
    assert.equal(result.grounding.visualContentSent,false);
    const foreign=createDemoRequest(()=>data,async()=>wireResponse(mode.protocol,{text:JSON.stringify(report('offense:player:foreign'))}));
    await assert.rejects(foreign('',{body}),/outside this analysis|本次分析以外/);
  });
});

test('Worker matchup endpoints run their context tool before accepting each native final response',async t=>{
  for(const mode of modes)await t.test(mode.protocol,async st=>{
    const {book,post}=await workspaceFixture(st);let count=0;
    st.mock.method(globalThis,'fetch',async(url,options)=>{
      const payload=checkEnvelope(mode,url,options);count++;
      if(count===1)return wireResponse(mode.protocol,{calls:[call('context','get_matchup_context')],reasoning:true});
      assert.equal(count,2);
      const context=wireResults(mode.protocol,payload).find(item=>item.id==='context').value;
      assert.ok(context.matchup.evidence.length);
      if(mode.protocol==='responses')assert.deepEqual(payload.input.find(item=>item.type==='reasoning'),encryptedReasoning);
      return wireResponse(mode.protocol,{text:JSON.stringify(report(context.matchup.evidence[0].id))});
    });
    const response=await post('/workspaces/'+book.id+'/matchup-analysis',{...analysisBody(book.data,mode),revision:book.revision});
    const result=await response.json();
    assert.equal(response.status,200,JSON.stringify(result));
    assert.equal(result.scenarios.length,2);assert.equal(count,2);
    assert.equal(result.execution.modelCalls,2);
    assert.deepEqual(result.execution.toolsUsed,['get_matchup_context']);
    assert.doesNotMatch(JSON.stringify(result),/matrix-test-secret|opaque-matrix|matrix-signature/);
  });
});

test('unsupported forced-tool selection falls back within the selected protocol without bypassing result validation',async t=>{
  for(const mode of modes)await t.test(mode.protocol,async()=>{
    const play=starterWorkspace().plays[0];let count=0,lookups=0,fallback=false;
    const result=await requestBoardAssistant({instruction:'Inspect the board',locale:'en',board:play,model:modelFor(mode),runtime,fetchImpl:async(url,options)=>{
      const body=checkEnvelope(mode,url,options,{browser:true});count++;
      const choice=body.tool_choice;
      const forced=choice&&typeof choice==='object'&&['function','tool'].includes(choice.type);
      if(forced)return Response.json({error:{message:'tool_choice is not supported by this model'}},{status:400});
      if(choice===undefined&&/generated contract/.test(JSON.stringify(body))) {
        fallback=true;
        // Anthropic retains tool definitions for historical tool_use blocks,
        // even though this retry explicitly asks for a plain JSON result.
        if(mode.protocol!=='anthropic')assert.equal(body.tools,undefined);
        return wireResponse(mode.protocol,{text:JSON.stringify({kind:'clarify',message:'Which assignment should change?'})});
      }
      if(body.tools?.length) {
        lookups++;
        return wireResponse(mode.protocol,{calls:[call('read_'+count,'read_board')]});
      }
      assert.fail('Unexpected retry shape without native tools or a generated JSON fallback contract.');
    }});
    assert.equal(fallback,true);assert.equal(result.submission,'text');assert.equal(result.kind,'clarify');
    assert.equal(result.modelCalls,lookups+1);assert.equal(count,result.modelCalls+1);
  });
});

function rejectedPayload(protocol,kind) {
  if(protocol==='anthropic')return {stop_reason:kind==='incomplete'?'max_tokens':'refusal',content:[{type:'text',text:'Not a valid final result'}]};
  if(protocol==='responses')return kind==='incomplete'?{status:'incomplete',incomplete_details:{reason:'max_output_tokens'},output:[]}:
    {status:'completed',output:[{type:'message',role:'assistant',content:[{type:'refusal',refusal:'Cannot complete'}]}]};
  return {choices:[{finish_reason:kind==='incomplete'?'length':'stop',message:{role:'assistant',content:null,...(kind==='refusal'?{refusal:'Cannot complete'}:{})}}]};
}

test('no protocol can turn truncation, refusal, HTTP failure or cancellation into a successful analysis',async t=>{
  for(const mode of modes)await t.test(mode.protocol,async()=>{
    const data=starterWorkspace(),body=analysisBody(data,mode);
    for(const kind of ['incomplete','refusal']) {
      const request=createDemoRequest(()=>data,async()=>Response.json(rejectedPayload(mode.protocol,kind)));
      await assert.rejects(request('',{body}));
    }
    for(const status of [401,429]) {
      const request=createDemoRequest(()=>data,async()=>Response.json({error:{message:'PRIVATE PROVIDER DETAIL'}},{status}));
      await assert.rejects(request('',{body}),error=>error.message.includes('HTTP '+status)&&!error.message.includes('PRIVATE PROVIDER DETAIL'));
    }
    const control=new AbortController();control.abort();
    const canceled=createDemoRequest(()=>data,async(_url,{signal})=>{signal.throwIfAborted();return wireResponse(mode.protocol,{text:'{}'});});
    await assert.rejects(canceled('',{body,signal:control.signal}),{name:'AbortError'});
  });
});

test('browser custom gateways accept base or existing endpoint URLs and route the chosen format correctly',async t=>{
  for(const mode of modes)await t.test(mode.protocol,async()=>{
    const suffix={openai:'chat/completions',anthropic:'messages',responses:'responses'}[mode.protocol];
    const expected={...mode,endpoint:'https://models.example.test/proxy/v1/'+suffix};
    for(const baseUrl of ['https://models.example.test/proxy/v1','https://models.example.test/proxy/v1/chat/completions']) {
      const result=await requestBoardAssistant({instruction:'Clarify the target',locale:'en',board:starterWorkspace().plays[0],runtime,
        model:{provider:'custom',protocol:mode.protocol,baseUrl,model:'gateway-model',apiKey},fetchImpl:async(url,options)=>{
          checkEnvelope(expected,url,options,{browser:true});
          return wireResponse(mode.protocol,{calls:[call('finish','submit_result',{result:{kind:'clarify',message:'Which player?'}})]});
        }});
      assert.equal(result.kind,'clarify');
    }
  });
});
