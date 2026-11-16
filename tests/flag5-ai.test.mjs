import test from 'node:test';
import assert from 'node:assert/strict';
import * as runtime from '@langchain/langgraph';
import { Window } from 'happy-dom';
import { makePlay, starterWorkspace, addRoute } from '../web/model.js';
import { assistantPlayers, resolveBoardPlayer } from '../web/assistant-edit.js';
import { boardAssistantInput } from '../web/assistant-provider.js';
import { createBoardTools } from '../web/assistant-tools.js';
import { runBoardAssistant } from '../web/assistant-harness.js';
import { diagramFacts, retrieveMatchupKnowledge } from '../web/analysis-evidence.js';
import { retrieveKnowledge } from '../web/knowledge-base.js';
import { localBriefHTML } from '../web/knowledge-panel.js';
import { getLocale, setLocale } from '../web/i18n.js';
import { createDemoRequest } from '../web/ai-demo.js';
import { createMatchupView } from '../web/ai-matchup.js';
import { buildMatchup } from '../server/matchup.mjs';
import { localizeMatchupAnnotations } from '../server/matchup-locale.mjs';
import { runMatchupAgent } from '../server/matchup-agent.mjs';

const fixture = () => ({
  off: makePlay({title:'Flag Mesh',count:5,formation:'Flag 5 Spread'}),
  def: makePlay({title:'Flag Zone',count:5,book:'defense',formation:'Flag 5 Zone'}),
});
const teamPack = () => ({format:'playbook-studio-knowledge',version:1,
  sources:[{id:'team:flag',title:'Flag team install',kind:'team'}],
  cards:[{id:'flag-mesh',sourceId:'team:flag',title:'Flag Mesh',content:'Flag mesh: the center releases after the snap under the installed flag rules.',tags:['flag','mesh'],coverages:['man'],appliesWhen:['The team confirms its flag rules.'],exceptions:['Rushing and QB rules vary by competition.']}]});
const invoke = (name,args,id=name) => ({id,type:'function',function:{name,arguments:JSON.stringify(args)}});
const calls = (...tool_calls) => ({role:'assistant',content:null,tool_calls});
const report = id => ({summary:'Conditional flag study',scenarios:[1,2].map(n=>({title:'Read '+n,condition:'If the defender widens',observation:'Watch the center release',possibility:'An inside window may develop',action:'Confirm flag rules and spacing',limitations:'Rushing rules and game timing are unconfirmed',evidenceIds:[id]})),missingInfo:[]});
const completion = message => Response.json({choices:[{message}]});

// This exercises the same tool preview and submit path used by all providers.
test('flag board context retains a custom-named play format and exposes five-player formation commands', async () => {
  const {off}=fixture();off.formation='Our flag install';
  const input=boardAssistantInput({instruction:'Add a five-player flag defense',board:off});
  assert.equal(input.board.play.league,5);
  assert.equal(input.board.playersPerSide,5);
  assert.equal(input.board.gameFormat,'flag5');
  assert.equal(input.board.geometry.regulationFieldVerified,false);
  const tools=createBoardTools(input,async()=>{throw new Error('No catalog lookup for a local flag formation.');});
  const board=await tools.run('read_board',{});
  assert.equal(board.capabilities.defensePlayerCount,5);
  assert.deepEqual(board.capabilities.defenseFormations,['Flag 5 Zone','Flag 5 Man']);
  assert.equal(board.capabilities.defaultOpponentFormation,'Flag 5 Zone');
  assert.equal(board.capabilities.tackleDefense.count,11);
  assert.deepEqual(board.capabilities.addOpponents,{kind:'opponents_set',enabled:true,count:5});
  const preview=await tools.run('preview_edit',{operations:[{kind:'opponents_set',enabled:true}]});
  assert.equal(preview.error,undefined);
  assert.equal(preview.playerIds.length,5);
  assert.deepEqual(preview.effects[0].playerLabels,['R','LCB','RCB','S','DB']);
  const explicitTackle=await tools.run('preview_edit',{operations:[{kind:'defense_formation',formation:'4-3',mode:'add'}]});
  assert.equal(explicitTackle.error,undefined);
  assert.equal(explicitTackle.playerIds.length,11,'an explicit 4-3 comparison is never truncated to five');
  assert.equal(off.players.length,5,'preview does not write to the current play');
});

test('the board harness previews and submits five-player opponents without Madden or a new board', async () => {
  const {off}=fixture();const input=boardAssistantInput({instruction:'Add a flag defense',board:off});
  const operations=[{kind:'opponents_set',enabled:true,count:5}];let round=0;
  const result=await runBoardAssistant({input,runtime,searchCatalog:async()=>{throw new Error('No Madden import');},callModel:async messages=>{
    assert.match(messages[0].content,/center may receive|center can receive/);
    assert.match(messages[0].content,/eleven-player defense_formation/);
    if(++round===1)return calls(invoke('read_board',{}));
    if(round===2)return calls(invoke('preview_edit',{operations}));
    return calls(invoke('submit_result',{result:{kind:'edit',operations}}));
  }});
  assert.deepEqual(result.operations,operations);
  assert.deepEqual(result.toolsUsed,['read_board','preview_edit','submit_result']);
});

test('flag center remains addressable as a receiver while tackle OL groups and flag rusher/corner aliases stay distinct', () => {
  const {off,def}=fixture();
  const players=[...assistantPlayers(off),...assistantPlayers(def)];
  assert.equal(resolveBoardPlayer(players,{role:'中锋',side:'offense'}).candidates[0].label,'C');
  assert.equal(resolveBoardPlayer(players,{role:'OL',side:'offense'}).status,'missing');
  assert.equal(resolveBoardPlayer(players,{role:'rusher',side:'defense'}).candidates[0].label,'R');
  assert.equal(resolveBoardPlayer(players,{role:'冲传手',side:'defense'}).candidates[0].label,'R');
  assert.deepEqual(resolveBoardPlayer(players,{role:'CB',side:'defense',selectMany:true}).candidates.map(p=>p.label),['LCB','RCB']);
  assert.equal(resolveBoardPlayer(assistantPlayers(makePlay()),{role:'OL',selectMany:true}).candidates.length,5);
});

test('five remaining markers in a legacy tackle diagram are not enough to declare flag rules', () => {
  const play=makePlay();delete play.league;
  play.players=play.players.filter(p=>['C','QB','X','Y','Z'].includes(p.label));
  const input=boardAssistantInput({instruction:'Inspect this fragment',board:play});
  assert.equal(input.board.gameFormat,'unspecified');
  const facts=diagramFacts(play,makePlay({book:'defense'}),{locale:'en'});
  assert.equal(facts.gameFormat.flag5,false);
  assert.doesNotMatch(facts.unknowns.join(' '),/5v5 flag/);
});

test('flag matchup facts and server snapshots retain format metadata and warn about mixed formats', () => {
  const {off,def}=fixture();
  const matchup=buildMatchup(off,def,{coverage:'man',locale:'en'});
  assert.equal(matchup.offense.league,5);
  assert.equal(matchup.offense.personnel,off.personnel);
  assert.equal(matchup.defense.gameFormat,'flag5');
  assert.equal(matchup.facts.gameFormat.flag5,true);
  assert.equal(matchup.facts.gameFormat.mixed,false);
  assert.match(matchup.facts.unknowns.join(' '),/center can receive/);
  assert.match(matchup.facts.unknowns.join(' '),/diagram grid/);
  const mixed=buildMatchup(off,makePlay({book:'defense'}),{locale:'en'});
  assert.equal(mixed.facts.gameFormat.mixed,true);
  const localized=localizeMatchupAnnotations(mixed.evidence,mixed.warnings,'en');
  assert.match(localized.warnings.join(' '),/different player counts or format/);
  assert.doesNotMatch(localized.warnings.join(' '),/[\u3400-\u9fff]/);
});

test('flag retrieval excludes unadapted tackle principles but keeps conditional team knowledge', () => {
  const {off,def}=fixture();
  assert.deepEqual(retrieveMatchupKnowledge(off,def,{coverage:'man',knowledgeQuery:'mesh press pressure'}),[]);
  const cards=retrieveMatchupKnowledge(off,def,{coverage:'man',knowledgeQuery:'flag mesh',knowledgePack:teamPack()});
  assert.equal(cards.length,1);
  assert.equal(cards[0].source.kind,'team');
  assert.match(cards[0].evidenceId,/knowledge:team:/);
  assert.deepEqual(retrieveKnowledge({query:'press pressure mesh',includeBuiltin:false}),[]);
  const tackle=starterWorkspace();
  assert.ok(retrieveMatchupKnowledge(tackle.plays[0],tackle.plays.find(p=>p.book==='defense'),{knowledgeQuery:'press pressure mesh'}).length);
});

test('the no-key local brief explains flag context and mixed-format limits in either language', () => {
  const {off,def}=fixture(),locale=getLocale();
  const storage = Object.getOwnPropertyDescriptor(globalThis,'localStorage');
  Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{setItem(){}}});
  try {
    setLocale('en');
    const html=localBriefHTML(off,def,'unknown','Unconfirmed');
    assert.match(html,/data-game-format-note/);
    assert.match(html,/5v5 flag/);
    assert.match(html,/Built-in tackle-football knowledge/);
    assert.match(localBriefHTML(off,makePlay({book:'defense'}),'unknown','Unconfirmed'),/different player counts/);
    setLocale('zh-CN');
    assert.match(localBriefHTML(off,def,'unknown','未确认'),/5人腰旗/);
  } finally {setLocale(locale);if(storage)Object.defineProperty(globalThis,'localStorage',storage);else delete globalThis.localStorage;}
});

test('the actual no-key matchup page excludes tackle cards and can still import team flag notes', async () => {
  const win=new Window({url:'https://playbook.test/editor/'}),previous={};
  for(const key of ['window','document','localStorage']) {
    previous[key]=Object.getOwnPropertyDescriptor(globalThis,key);
    Object.defineProperty(globalThis,key,{configurable:true,value:key==='window'?win:win[key]});
  }
  win.document.body.innerHTML='<main id="flag-analysis"></main>';
  const {off,def}=fixture(),data={...starterWorkspace(),plays:[off,def]},record={id:'flag-team',title:'Flag team',revision:1};
  const root=win.document.querySelector('#flag-analysis');let requests=0;
  const view=createMatchupView({root,getCurrent:()=>record,getData:()=>data,isDirty:()=>false,request:async()=>{requests++;throw new Error('No key, no request.');}});
  try {
    view.onData(data,record);view.show(true);
    assert.equal(root.querySelector('.ai-fact-grid strong').textContent,'05');
    const search=root.querySelector('[data-ai-field="knowledgeQuery"]');
    search.value='mesh press pressure';search.dispatchEvent(new win.Event('input',{bubbles:true}));
    assert.equal(root.querySelectorAll('[data-knowledge-card]').length,0);
    assert.ok(root.querySelector('[data-game-format-note]'));
    const text='Flag Mesh: center releases after the snap. Check the installed flag rules.';
    await view.importKnowledgeFile({name:'flag-install.md',size:text.length,text:async()=>text});
    assert.ok(root.querySelectorAll('[data-knowledge-card]').length>0);
    assert.match(root.querySelector('.ai-knowledge-list').textContent,/Flag Mesh/);
    assert.equal(requests,0);
  } finally {
    view.show(false);await win.happyDOM.abort();
    for(const [key,descriptor]of Object.entries(previous)){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];}
  }
});

test('static analysis sends flag format and excludes tackle knowledge before the model call', async () => {
  const {off,def}=fixture();off.players[0].name='PRIVATE FLAG NAME';
  let payload;
  const request=createDemoRequest(()=>({plays:[off,def]}),async(_url,options)=>{
    payload=JSON.parse(options.body);
    const context=JSON.parse(payload.messages[1].content);
    return completion({content:JSON.stringify(report(context.offense.players[0].id))});
  });
  const result=await request('/ignored',{body:{locale:'en',offensePlayId:off.id,defensePlayId:def.id,coverage:'man',knowledgeQuery:'mesh press',model:{provider:'openai',model:'test',apiKey:'fake-test-key'}}});
  const context=JSON.parse(payload.messages[1].content);
  assert.equal(context.offense.league,5);
  assert.equal(context.defense.gameFormat,'flag5');
  assert.equal(context.facts.gameFormat.flag5,true);
  assert.deepEqual(context.knowledge,[]);
  assert.match(payload.messages[0].content,/center may receive/);
  assert.doesNotMatch(JSON.stringify(payload),/PRIVATE FLAG NAME|fake-test-key/);
  assert.match(result.warnings.join(' '),/5v5 flag/);
});

test('server analysis tools see the same explicit flag context and do not claim verified rules completeness', async t => {
  const {off,def}=fixture();addRoute(off,'C',[[50,54],[72,50]]);
  def.zones=[{id:'flag-zone',x:50,y:50,rx:20,ry:10,color:'#88bfff',label:'Middle'}];
  const matchup=buildMatchup(off,def,{coverage:'man',knowledgeQuery:'flag mesh',knowledgePack:teamPack(),locale:'en'});
  const original=globalThis.fetch,requests=[];t.after(()=>{globalThis.fetch=original;});
  globalThis.fetch=async(_url,options)=>{
    const payload=JSON.parse(options.body);requests.push(payload);
    if(requests.length===1)return completion(calls(invoke('get_matchup_context',{},'ctx')));
    const context=JSON.parse(payload.messages.find(m=>m.tool_call_id==='ctx').content);
    assert.equal(context.matchup.offense.league,5);
    assert.equal(context.matchup.facts.gameFormat.flag5,true);
    assert.ok(context.matchup.knowledge.every(card=>card.source.kind==='team'));
    return completion({content:JSON.stringify(report(matchup.offense.routes[0].id))});
  };
  const result=await runMatchupAgent(matchup,{locale:'en',model:{provider:'openai',model:'test',apiKey:'fake-test-key'}},{},new AbortController().signal);
  assert.equal(result.status,'limited');
  assert.equal(result.facts.gameFormat.flag5,true);
  assert.match(requests[0].messages[0].content,/flag5/);
});
