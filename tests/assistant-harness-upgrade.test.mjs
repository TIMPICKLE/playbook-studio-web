import test from 'node:test';
import assert from 'node:assert/strict';
import * as runtime from '@langchain/langgraph';
import { boardAssistantInput, requestBoardAssistant } from '../web/assistant-provider.js';
import { runBoardAssistant } from '../web/assistant-harness.js';
const board = {playId:'p',players:[
  {id:'c',label:'C',name:'Casey Smith',side:'offense',x:50,y:67},
  {id:'lt',label:'LT',side:'offense',x:42,y:67},
  {id:'d',label:'DT',side:'defense',x:50,y:62},
  {id:'l',label:'LB',name:'Avery Smith',side:'defense',x:48,y:40},
],routes:[],book:'offense'};
const call = (name,args) => ({role:'assistant',content:null,tool_calls:[{id:'a',type:'function',function:{name,arguments:JSON.stringify(args)}}]});
const final = data => ({role:'assistant',content:JSON.stringify(data)});
test('mode scopes tools and keeps full names, context and previous followups', async () => {
  const input = boardAssistantInput({instruction:'find Avery',board,mode:'search',previous:[{instruction:'prior',summary:'done'}]});
  assert.equal(input.board.players.find(p=>p.id==='l').name,'Avery Smith');
  let definitions;
  const result=await runBoardAssistant({runtime,input,searchCatalog:async()=>[],callModel:async(messages,tools)=>{
    definitions=tools.map(t=>t.function.name);
    assert.equal(JSON.parse(messages[1].content).previous[0].instruction,'prior');
    return final({kind:'clarify',message:'which one?'});
  }});
  assert.deepEqual(definitions,['search_madden']);
  assert.equal(result.kind,'clarify');
});
test('group resolution grounds an entire atomic operations array', async () => {
  const input=boardAssistantInput({instruction:'OL left',board,mode:'edit'});
  let count=0;
  const result=await runBoardAssistant({runtime,input,callModel:async()=>{
    count++;
    if(count===1)return call('resolve_players',{selectors:[{role:'OL',side:'offense',selectMany:true}]});
    return final({kind:'edit',summary:'line left',operations:[{kind:'block',playerIds:['c','lt'],scheme:'zone',direction:'left'}]});
  }});
  assert.deepEqual(result.operations[0].playerIds,['c','lt']);
});
test('batch operations cannot reference ungrounded IDs', async () => {
  const input=boardAssistantInput({instruction:'edit',board});
  await assert.rejects(runBoardAssistant({runtime,input,callModel:async()=>final({kind:'edit',summary:'x',operations:[{kind:'route',playerId:'c',concept:'go',depthYards:9}]})}));
});
test('static provider reports each tool event before final result', async () => {
  const progress=[];let count=0;
  const result=await requestBoardAssistant({instruction:'identify Avery',board,mode:'edit',model:{provider:'openai',apiKey:'test'},onTool:name=>progress.push(name),runtime,
    fetchImpl:async()=>Response.json({choices:[{message:++count===1?call('resolve_player',{name:'Avery',role:'LB'}):final({kind:'answer',message:'Avery',highlights:['l']})}]})});
  assert.deepEqual(progress,['resolve_player']);
  assert.equal(result.kind,'answer');
});
test('cloud streamed tool events are delivered before the final result', async () => {
  const progress=[];
  const input={instruction:'find',board,mode:'search',model:{provider:'openai',apiKey:'test'},workspace:{id:'w',revision:1},onTool:name=>progress.push(name),
    fetchImpl:async(_url,options)=>{
      const body=JSON.parse(options.body);
      assert.equal(body.stream,true);
      assert.equal(body.mode,'search');
      return new Response('{"type":"tool","name":"search_madden"}\n{"type":"result","result":{"kind":"search","matches":[]}}\n',{headers:{'Content-Type':'application/x-ndjson'}});
    }};
  const result=await requestBoardAssistant(input);
  assert.deepEqual(progress,['search_madden']);
  assert.equal(result.kind,'search');
});
test('defense playbooks cannot expose Madden search tools', async () => {
  let calls=0;
  const defense={...board,book:'defense'};
  const search=boardAssistantInput({instruction:'find',board:defense,mode:'search'});
  const denied=await runBoardAssistant({runtime,input:search,callModel:async()=>{calls++;}});
  assert.equal(denied.kind,'clarify');
  assert.equal(calls,0);
  const auto=boardAssistantInput({instruction:'show board',board:defense,mode:'auto'});
  await runBoardAssistant({runtime,input:auto,callModel:async(_messages,tools)=>{
    assert.ok(!tools.some(tool=>tool.function.name==='search_madden'));
    return final({kind:'clarify',message:'Which player?'});
  }});
});
test('invalid semantic route depth is returned to the model for repair', async () => {
  const input=boardAssistantInput({instruction:'C go',board,mode:'edit'});
  let count=0;
  const result=await runBoardAssistant({runtime,input,callModel:async()=>{
    count++;
    if(count===1)return call('resolve_player',{role:'C'});
    if(count===2)return final({kind:'edit',operations:[{kind:'route',playerId:'c',concept:'dig'}]});
    return final({kind:'edit',operations:[{kind:'route',playerId:'c',concept:'dig',depthYards:12}]});
  }});
  assert.equal(count,3);
  assert.equal(result.operations[0].depthYards,12);
});
