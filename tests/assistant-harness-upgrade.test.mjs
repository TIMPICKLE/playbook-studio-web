import test from 'node:test';
import assert from 'node:assert/strict';
import * as runtime from '@langchain/langgraph';
import { boardAssistantInput, requestBoardAssistant } from '../web/assistant-provider.js';
import { runBoardAssistant } from '../web/assistant-harness.js';
import { starterWorkspace } from '../web/model.js';
import { assistantPlayers, buildAssistantEdit } from '../web/assistant-edit.js';
const board = {playId:'p',players:[
  {id:'c',label:'C',name:'Casey Smith',side:'offense',x:50,y:67},
  {id:'lt',label:'LT',side:'offense',x:42,y:67},
  {id:'d',label:'DT',side:'defense',x:50,y:62},
  {id:'l',label:'LB',name:'Avery Smith',side:'defense',x:48,y:40},
],routes:[],book:'offense'};
const call = (name,args) => ({role:'assistant',content:null,tool_calls:[{id:'a',type:'function',function:{name,arguments:JSON.stringify(args)}}]});
const final = result => call('submit_result', {result});
test('mode scopes tools and keeps full names, context and previous followups', async () => {
  const input = boardAssistantInput({instruction:'find Avery',board,mode:'search',previous:[{instruction:'prior',summary:'done'}]});
  assert.equal(input.board.players.find(p=>p.id==='l').name,'Avery Smith');
  let definitions;
  const result=await runBoardAssistant({runtime,input,searchCatalog:async()=>[],callModel:async(messages,tools)=>{
    definitions=tools.map(t=>t.function.name);
    assert.equal(JSON.parse(messages[1].content).previous[0].instruction,'prior');
    return final({kind:'clarify',message:'which one?'});
  }});
  assert.deepEqual(definitions,['search_madden','submit_result']);
  assert.equal(result.kind,'clarify');
});
test('group resolution grounds an entire atomic operations array', async () => {
  const input=boardAssistantInput({instruction:'OL left',board,mode:'edit'});
  let count=0;
  const result=await runBoardAssistant({runtime,input,callModel:async()=>{
    count++;
    if(count===1)return call('resolve_players',{selectors:[{role:'OL',side:'offense',selectMany:true}]});
    const operations=[{kind:'block',playerIds:['c','lt'],scheme:'zone',direction:'left'}];
    if(count===2)return call('preview_edit',{operations});
    return final({kind:'edit',summary:'line left',operations});
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
    fetchImpl:async()=>Response.json({choices:[{message:++count===1?call('resolve_player',{name:'Avery',role:'LB'}):count===2?call('read_board',{}):final({kind:'answer',message:'Avery',highlights:['l']})}]})});
  assert.deepEqual(progress,['resolve_player','read_board','submit_result']);
  assert.equal(result.kind,'answer');
});
test('a board answer must inspect the board before it can be returned', async () => {
  const input=boardAssistantInput({instruction:'who is first read?',board,mode:'edit'});
  let count=0;
  const result=await runBoardAssistant({runtime,input,callModel:async()=>{
    count++;
    if(count===1)return final({kind:'answer',message:'The X receiver.',highlights:[]});
    if(count===2)return call('read_board',{});
    return final({kind:'answer',message:'The play does not specify a first read.',highlights:[]});
  }});
  assert.equal(count,3);
  assert.match(result.message,/does not specify/);
});

test('a route reference must belong to the resolved player', async () => {
  const input=boardAssistantInput({instruction:'change C route',board:{...board,routes:[{id:'other-route',playerId:'lt',kind:'route',points:[{x:42,y:67},{x:42,y:50}]}]},mode:'edit'});
  let count=0;
  await assert.rejects(runBoardAssistant({runtime,input,callModel:async()=>{
    count++;
    if(count===1)return call('read_board',{});
    if(count===2)return call('resolve_player',{role:'C'});
    return final({kind:'edit',operations:[{kind:'route',playerId:'c',routeId:'other-route',concept:'go',depthYards:10}]});
  }}));
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
    const operations=[{kind:'route',playerId:'c',concept:'dig',depthYards:12}];
    if(count===3)return call('preview_edit',{operations});
    return final({kind:'edit',operations});
  }});
  assert.equal(count,4);
  assert.equal(result.operations[0].depthYards,12);
});

test('domain-invalid motion is repaired before reaching the editor', async () => {
  const input=boardAssistantInput({instruction:'C motion right',board,mode:'edit'});
  let count=0;
  const result=await runBoardAssistant({runtime,input,callModel:async()=>{
    count++;
    if(count===1)return call('resolve_player',{role:'C'});
    if(count===2)return final({kind:'edit',operations:[{kind:'motion',playerId:'c',type:'jet',toward:'up'}]});
    const operations=[{kind:'motion',playerId:'c',type:'jet',toward:'right'}];
    if(count===3)return call('preview_edit',{operations});
    return final({kind:'edit',operations});
  }});
  assert.equal(count,4);
  assert.equal(result.operations[0].toward,'right');
});

test('domain validation retries invalid zone, timing, move, pass, motion and block parameters', async () => {
  const cases=[
    [{kind:'zone',preset:'wrong',side:'left'}, {kind:'zone',preset:'flat',side:'left'}, 'Invalid zone.'],
    [{kind:'timing',playerId:'c',delay:-1,duration:2}, {kind:'timing',playerId:'c',delay:1,duration:2}, 'Invalid timing.'],
    [{kind:'move_player',playerId:'c',dxYards:'three'}, {kind:'move_player',playerId:'c',dxYards:3,dyYards:0}, 'Invalid movement.'],
    [{kind:'pass',receiverId:'c',throwAt:3,arriveAt:2}, {kind:'pass',receiverId:'c',throwAt:2,arriveAt:3}, 'Invalid pass timing.'],
    [{kind:'motion',playerId:'c',type:'jet',toward:'up'}, {kind:'motion',playerId:'c',type:'jet',toward:'right'}, 'Invalid motion.'],
    [{kind:'block',playerIds:['c'],scheme:'zone',direction:'up'}, {kind:'block',playerIds:['c'],scheme:'zone',direction:'left'}, 'Invalid blocking scheme.'],
  ];
  const source={...board,ball:{holderId:'lt',receiverId:'',passAt:1,arriveAt:2},routes:[{id:'route-c',playerId:'c',kind:'route',points:[{x:50,y:67},{x:50,y:50}],delay:0,duration:3}]};
  for (const [invalid, valid, reason] of cases) {
    const input=boardAssistantInput({instruction:'modify play',board:source,mode:'edit'});
    let count=0;
    const result=await runBoardAssistant({runtime,input,callModel:async messages=>{
      count++;
      if(count===1)return call('resolve_player',{role:'C'});
      if(count===2)return final({kind:'edit',operations:[invalid]});
      if(count===3) {
        assert.match(messages.at(-1).content,new RegExp(reason.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
        return call('preview_edit',{operations:[valid]});
      }
      return final({kind:'edit',operations:[valid]});
    }});
    assert.equal(count,4,reason);
    assert.equal(result.operations[0].kind,valid.kind);
  }
});

test('repeated invalid domain parameters produce a localized error', async () => {
  const input=boardAssistantInput({instruction:'make a zone',board,mode:'edit',locale:'zh-CN'});
  await assert.rejects(runBoardAssistant({runtime,input,callModel:async()=>final({kind:'edit',operations:[{kind:'zone',preset:'wrong',side:'left'}]})}),/防守区域类型或方向无效/);
});

test('too many group blockers are rejected before applying operations', async () => {
  const line=Array.from({length:12},(_,i)=>({id:`ol${i}`,label:'LT',side:'offense',x:10+i*3,y:67}));
  const input=boardAssistantInput({instruction:'OL blocks',board:{...board,players:line},mode:'edit'});
  let count=0;
  await assert.rejects(runBoardAssistant({runtime,input,callModel:async()=>{
    count++;
    if(count===1)return call('resolve_players',{selectors:[{role:'OL',selectMany:true}]});
    return final({kind:'edit',operations:[{kind:'block',playerIds:line.map(p=>p.id),scheme:'zone',direction:'left'}]});
  }}));
});

test('too many operations are rejected with localized limits', async () => {
  const input=boardAssistantInput({instruction:'many zones',board,mode:'edit',locale:'zh-CN'});
  const operations=Array.from({length:21},()=>({kind:'zone',preset:'flat',side:'left'}));
  await assert.rejects(runBoardAssistant({runtime,input,callModel:async()=>final({kind:'edit',operations})}),/1 至 20 个操作/);
});

test('unavailable catalog metadata filters are absent from the model tool contract', async () => {
  const input=boardAssistantInput({instruction:'find red zone plays',board,mode:'search'});
  await runBoardAssistant({runtime,input,searchCatalog:async()=>[],callModel:async(_messages,tools)=>{
    const properties=tools.find(tool=>tool.function.name==='search_madden').function.parameters.properties;
    assert.equal('personnel' in properties,false);
    assert.equal('playType' in properties,false);
    assert.equal('situation' in properties,false);
    return final({kind:'clarify',message:'The catalog has no situation metadata.'});
  }});
});

test('similar results follow catalog ranking even when the model reverses them', async () => {
  const input=boardAssistantInput({instruction:'find similar plays',board});
  let count=0;
  const result=await runBoardAssistant({runtime,input,searchCatalog:async()=>[{id:'best'},{id:'next'}],callModel:async()=>{
    count++;
    if(count===1)return call('search_madden',{similarToCurrent:true});
    return final({kind:'search',matches:[{id:'next',reason:'second match'},{id:'best',reason:'best match'}]});
  }});
  assert.deepEqual(result.matches.map(m=>m.id),['best','next']);
});

test('a follow-up sees the previous edit and the current route and deepens the same route', async () => {
  const play=starterWorkspace().plays[0];
  const actor=play.players.find(player=>player.label==='X');
  assert.ok(actor);
  const snapshot=p=>({...p,playId:p.id,players:assistantPlayers(p,[])});
  const firstInput=boardAssistantInput({instruction:'X runs a 10 yard dig',board:snapshot(play),mode:'edit'});
  let step=0;
  const first=await runBoardAssistant({runtime,input:firstInput,callModel:async()=>{
    step++;
    if(step===1)return call('resolve_player',{role:'X'});
    const operations=[{kind:'route',playerId:actor.id,concept:'dig',depthYards:10,breakTo:'inside'}];
    if(step===2)return call('preview_edit',{operations});
    return final({kind:'edit',summary:'10 yard dig',operations});
  }});
  const applied=buildAssistantEdit(play,[],first.operations);
  const previous=[{instruction:'X runs a 10 yard dig',kind:'edit',summary:first.summary,operations:first.operations,routeIds:[applied.routeId],playerIds:[actor.id]}];
  const secondInput=boardAssistantInput({instruction:'two yards deeper',board:snapshot(applied.play),mode:'edit',previous});
  step=0;
  const second=await runBoardAssistant({runtime,input:secondInput,callModel:async messages=>{
    step++;
    const recorded=JSON.parse(messages[1].content).previous[0];
    assert.equal(recorded.operations[0].depthYards,10);
    assert.equal(recorded.routeIds[0],applied.routeId);
    if(step===1)return call('read_board',{});
    if(step===2) {
      const current=JSON.parse(messages.find(message=>message.role==='tool').content);
      assert.ok(current.routes.some(route=>route.id===recorded.routeIds[0] && route.playerId===actor.id));
      return call('resolve_player',{role:'X'});
    }
    const operations=[{kind:'route',playerId:actor.id,routeId:recorded.routeIds[0],concept:'dig',depthYards:recorded.operations[0].depthYards+2,breakTo:'inside'}];
    if(step===3)return call('preview_edit',{operations});
    return final({kind:'edit',summary:'12 yard dig',operations});
  }});
  const deeper=buildAssistantEdit(applied.play,[],second.operations);
  assert.equal(deeper.routeId,applied.routeId);
  assert.equal(second.operations[0].depthYards,12);
});
