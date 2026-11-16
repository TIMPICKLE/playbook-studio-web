import test from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { createMatchupView } from '../web/ai-matchup.js';
import { starterWorkspace } from '../web/model.js';
import { setModelConnection } from '../web/model-connection.js';
import { checkedMatchupFollowup, matchupInputKey } from '../web/matchup-model.js';
import { createDemoRequest } from '../web/ai-demo.js';
import { buildMatchup } from '../server/matchup.mjs';
import { runMatchupAgent } from '../server/matchup-agent.mjs';

const settle=async()=>{for(let i=0;i<8;i++)await new Promise(resolve=>setImmediate(resolve));};
const scenario=(id)=>({title:'Read X',condition:'If the corner widens',observation:'Read the corner',possibility:'An inside window may open',action:'Move X two yards inside',limitations:'Confirm assignments and timing',evidenceIds:[id]});
async function withView(run){
  const win=new Window({url:'https://playbook.test/editor/',width:390,height:844});
  const old=Object.fromEntries(['window','document','localStorage'].map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  for(const key of Object.keys(old))Object.defineProperty(globalThis,key,{configurable:true,value:key==='window'?win:win[key]});
  win.document.body.innerHTML='<div id="root"></div>';
  const root=win.document.querySelector('#root'),data=starterWorkspace();
  let record={id:'book-a',revision:1,title:'A'}, handler;
  const routeId=`offense:route:${data.plays[0].routes[0].id}`,calls=[],handoffs=[];
  const report=(summary='First report')=>({status:'limited',summary,scenarios:[scenario(routeId)],evidence:[{id:routeId,type:'route',label:'X route'}],warnings:[]});
  handler=async()=>report();
  setModelConnection({provider:'deepseek',protocol:'openai',model:'test-model',apiKey:'synthetic-key',baseUrl:''});
  const view=createMatchupView({root,getCurrent:()=>record,getData:()=>data,isDirty:()=>false,request:async(path,options)=>{calls.push(options.body);return handler(path,options);},onEditSuggestion:async payload=>handoffs.push(payload)});
  const q=selector=>root.querySelector(selector);
  const input=(field,value)=>{const node=q(`[data-ai-field="${field}"]`);node.value=value;node.dispatchEvent(new win.Event(node.tagName==='SELECT'?'change':'input',{bubbles:true}));};
  const question=value=>{const node=q('[data-ai-followup]');node.value=value;node.dispatchEvent(new win.Event('input',{bubbles:true}));};
  const click=async action=>{q(`[data-ai-action="${action}"]`).click();await settle();};
  const update=(id=record.id,revision=record.revision+1)=>{record={...record,id,revision};view.onData(data,record);};
  try{view.onData(data,record);view.show(true);await run({win,root,q,data,view,input,question,click,calls,report,handoffs,update,setRole:role=>{record={...record,role};view.show(true);},setHandler:fn=>handler=fn});}
  finally{view.destroy();await win.happyDOM.abort();for(const[key,descriptor]of Object.entries(old)){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];}}
}

test('completed analysis survives failed/canceled replacements and module navigation',async()=>{
  await withView(async({q,view,click,setHandler,report})=>{
    await click('analyze');assert.match(q('.ai-result-summary').textContent,/First report/);
    setHandler(async()=>{throw new Error('Provider unavailable');});await click('analyze');
    assert.match(q('.ai-result-summary').textContent,/First report/);assert.match(q('.ai-error').textContent,/Provider unavailable/);
    let resolve;setHandler(()=>new Promise(done=>resolve=done));await click('analyze');
    assert.ok(q('.ai-run-status'));assert.ok(q('.ai-scenario'));await click('cancel');
    assert.ok(!q('.ai-run-status'));assert.match(q('.ai-result-summary').textContent,/First report/);
    resolve(report('Late canceled report'));await settle();assert.doesNotMatch(q('.ai-result-summary').textContent,/Late/);
    view.show(false);view.show(true);assert.match(q('.ai-result-summary').textContent,/First report/);
  });
});

test('changed inputs retain the old report and its diagram without highlighting current objects',async()=>{
  await withView(async({q,data,click,update,input})=>{
    await click('analyze');const savedPlayer=q('.ai-board [data-player]').getAttribute('transform');
    input('model','another-model');assert.ok(!q('.ai-report-context').classList.contains('is-stale'),'Connection settings are not tactical input');
    data.plays[0].players[0].x+=10;update();
    assert.ok(q('.ai-report-context').classList.contains('is-stale'));assert.ok(q('[data-ai-action="followup"]').disabled);
    assert.ok(!q('.ai-board .ai-evidence-active'));assert.ok(q('[data-ai-action="edit-suggestion"]').disabled);
    await click('report-board');assert.match(q('.ai-board-heading h2').textContent,/报告原图/);
    assert.equal(q('.ai-board [data-player]').getAttribute('transform'),savedPlayer);
    assert.ok(q('.ai-board .ai-evidence-active'));
  });
});

test('follow-ups carry the same matchup, scenario and previous answer; failures preserve the question',async()=>{
  await withView(async({q,question,click,calls,setHandler,report,handoffs,data})=>{
    await click('analyze');question('Which defender should he read?');setHandler(async()=>report('Second report'));await click('followup');
    assert.equal(calls[1].followup.question,'Which defender should he read?');assert.equal(calls[1].followup.revision,1);
    assert.equal(calls[1].followup.offensePlayId,data.plays[0].id);assert.equal(calls[1].followup.scenarioIndex,0);
    assert.equal(calls[1].followup.previousReport.summary,'First report');assert.match(q('.ai-discussion-history').textContent,/Which defender/);
    assert.equal(q('[data-ai-followup]').value,'');
    question('What if he stays inside?');setHandler(async()=>{throw new Error('network failed');});await click('followup');
    assert.match(q('.ai-result-summary').textContent,/Second report/);assert.equal(q('[data-ai-followup]').value,'What if he stays inside?');
    assert.equal(calls[2].followup.previousReport.summary,'Second report');
    const before=JSON.stringify(data);await click('edit-suggestion');assert.equal(handoffs.length,1);
    assert.equal(handoffs[0].workspaceId,'book-a');assert.equal(handoffs[0].revision,1);
    assert.equal(handoffs[0].scenario.action,'Move X two yards inside');assert.equal(JSON.stringify(data),before);
  });
});

test('analysis sessions restore per playbook without leaking a report to another book',async()=>{
  await withView(async({q,update,click})=>{
    await click('analyze');update('book-b',1);assert.ok(!q('.ai-scenario'));
    update('book-a',1);assert.match(q('.ai-result-summary').textContent,/First report/);
  });
});

test('read-only members can discuss a report but cannot prepare an editing handoff',async()=>{
  await withView(async({q,click,setRole,handoffs})=>{
    await click('analyze');setRole('viewer');
    assert.ok(q('[data-ai-action="edit-suggestion"]').disabled);assert.match(q('.ai-suggestion-actions').textContent,/只读/);
    assert.equal(q('[data-ai-action="followup"]').disabled,false);await click('edit-suggestion');assert.equal(handoffs.length,0);
  });
});

test('follow-up normalization binds versions and strips foreign evidence and unrecognized fields',()=>{
  const input={question:'Which player?',revision:3,offensePlayId:'o',defensePlayId:'d',scenarioIndex:0,previousReport:{summary:'Earlier result',scenarios:[{...scenario('ok'),evidenceIds:['ok','foreign'],execute:'delete all'}]},apiKey:'secret'};
  const options={revision:3,offensePlayId:'o',defensePlayId:'d',evidenceIds:['ok']};
  const checked=checkedMatchupFollowup(input,options);assert.deepEqual(checked.previousReport.scenarios[0].evidenceIds,['ok']);
  assert.doesNotMatch(JSON.stringify(checked),/foreign|secret|execute/);
  assert.throws(()=>checkedMatchupFollowup(input,{...options,revision:4}),/版本不一致/);
  assert.throws(()=>checkedMatchupFollowup({...input,scenarioIndex:4},options),/情景已不可用/);
});

test('the diagram fingerprint tracks tactical changes and excludes private roster names',()=>{
  const data=starterWorkspace(),offense=data.plays[0],defense=data.plays.find(play=>play.book==='defense');
  const options={includeNotes:false},key=()=>matchupInputKey({workspaceId:'a',offense,defense,options,knowledge:{cards:[]}});
  const first=key();offense.players[0].name='Private roster name';assert.equal(key(),first);offense.players[0].x+=1;assert.notEqual(key(),first);
});

for(const protocol of ['openai','responses','anthropic'])test(`browser ${protocol} follow-up includes validated context in its shared protocol adapter`,async()=>{
  const data=starterWorkspace(),off=data.plays[0],def=data.plays.find(play=>play.book==='defense'),routeId=`offense:route:${off.routes[0].id}`;
  let sent;
  const result={summary:'Follow-up',scenarios:[scenario(routeId)]};
  const request=createDemoRequest(()=>data,async(_url,options)=>{
    sent=JSON.parse(options.body);
    const payload=protocol==='anthropic'?{content:[{type:'text',text:JSON.stringify(result)}]}:protocol==='responses'?{output:[{type:'message',role:'assistant',content:[{type:'output_text',text:JSON.stringify(result)}]}]}:{choices:[{message:{content:JSON.stringify(result)}}]};
    return new Response(JSON.stringify(payload),{headers:{'Content-Type':'application/json'}});
  });
  const response=await request('',{body:{offensePlayId:off.id,defensePlayId:def.id,revision:1,locale:'en',coverage:'unknown',model:{provider:'custom',protocol,model:'test',apiKey:'fake',baseUrl:'https://model.example/v1'},followup:{question:'Who should he read?',offensePlayId:off.id,defensePlayId:def.id,revision:1,scenarioIndex:0,previousReport:result}},signal:new AbortController().signal});
  assert.equal(response.summary,'Follow-up');assert.match(JSON.stringify(sent),/Who should he read/);assert.match(JSON.stringify(sent),/previousReport/);
});

test('cloud follow-up reaches the model as reference data after version validation',async t=>{
  const data=starterWorkspace(),off=data.plays[0],def=data.plays.find(play=>play.book==='defense'),matchup=buildMatchup(off,def),report={summary:'Original',scenarios:[scenario(matchup.evidence[0].id)]};
  const old=globalThis.fetch;t.after(()=>{globalThis.fetch=old;});const bodies=[];
  globalThis.fetch=async(_url,options)=>{const body=JSON.parse(options.body);bodies.push(body);return new Response(JSON.stringify({choices:[{message:bodies.length===1?{tool_calls:[{id:'read_ctx',type:'function',function:{name:'get_matchup_context',arguments:'{}'}}]}:{content:JSON.stringify(report)}}]}),{headers:{'Content-Type':'application/json'}});};
  const options={model:{provider:'deepseek',model:'test',apiKey:'fake'},offensePlayId:off.id,defensePlayId:def.id,revision:1,followup:{question:'Who should he read?',offensePlayId:off.id,defensePlayId:def.id,revision:1,scenarioIndex:0,previousReport:report}};
  const answer=await runMatchupAgent(matchup,options,{},new AbortController().signal);assert.equal(answer.summary,'Original');assert.match(JSON.stringify(bodies[0]),/Who should he read/);
  await assert.rejects(()=>runMatchupAgent(matchup,{...options,revision:2},{},new AbortController().signal),/版本不一致/);assert.equal(bodies.length,2);
});
