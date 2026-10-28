import test from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { readFileSync } from 'node:fs';
import { starterWorkspace, clone } from '../web/model.js';
import { composeMatchup } from '../web/ai-matchup.js';

test('matchup overlay uses legible side colors without changing saved plays', () => {
  const data=starterWorkspace(),off=data.plays.find(p=>p.book==='offense'),def=data.plays.find(p=>p.book==='defense');
  off.players[0].color='#dfffaa';off.routes[0].color='#dfffaa';
  const before=JSON.stringify({off,def}), overlay=composeMatchup(off,def);
  assert.ok(overlay.players.filter(p=>p.side==='offense').every(p=>p.color==='#5b2f91'));
  assert.ok(overlay.players.filter(p=>p.side==='defense').every(p=>p.color==='#c16f56'));
  assert.ok(overlay.routes.filter(r=>r.id.startsWith('offense:')).every(r=>r.color==='#5b2f91'));
  assert.ok(overlay.routes.filter(r=>r.id.startsWith('defense:')).every(r=>r.color==='#c16f56'));
  assert.equal(JSON.stringify({off,def}),before);
});

test('signed-in players can choose providers and view scenarios without a consent checkbox', async t => {
  const win=new Window({url:'https://playbook.test/editor/index.html',width:390,height:844});
  win.document.body.innerHTML=readFileSync(new URL('../web/index.html',import.meta.url),'utf8').split('<body>')[1].split('</body>')[0];
  win.setInterval=()=>1;
  const names=['window','document','navigator','localStorage','location','history','Image','Blob','requestAnimationFrame','cancelAnimationFrame','fetch'];
  const previous=Object.fromEntries(names.map(n=>[n,Object.getOwnPropertyDescriptor(globalThis,n)]));
  for(const n of names.filter(n=>n!=='fetch'))Object.defineProperty(globalThis,n,{configurable:true,value:['requestAnimationFrame','cancelAnimationFrame'].includes(n)?win[n].bind(win):win[n]});
  const data=starterWorkspace(), record={id:'book',title:'Team',role:'viewer',revision:1,data}, calls=[];
  let finishDelayed;
  const off=data.plays.find(p=>p.book==='offense'), routeId=`offense:route:${off.routes[0].id}`;
  const response=body=>new Response(JSON.stringify(body),{headers:{'Content-Type':'application/json'}});
  Object.defineProperty(globalThis,'fetch',{configurable:true,value:async(path,options={})=>{
    const body=options.body?JSON.parse(options.body):undefined;calls.push({path,body,method:options.method||'GET'});
    if(path==='/api/session')return response({user:{id:'me',name:'球员',email:'player@example.com'}});
    if(path==='/api/workspaces')return response({workspaces:[{id:'book',title:'Team',role:'viewer'}]});
    if(path.endsWith('/matchup-analysis')){
      const result={summary:'一次教学情景',scenarios:[{title:'情景 A',condition:'如果向外',observation:'留意防守者',possibility:'<img src=x onerror=alert(1)>',action:'依球队规则',limitations:'时序未知',evidenceIds:[routeId]},{title:'情景 B',condition:'如果留中',observation:'留意外侧',possibility:'短传可能出现空间',action:'',limitations:'',evidenceIds:[]}],missingInfo:['责任'],warnings:['未确认时序'],evidence:[{id:routeId,label:'X · 路线',type:'route'}],status:'limited',execution:{modelCalls:2,toolsUsed:['get_matchup_context']}};
      if(body.context==='pending')return new Promise(resolve=>{finishDelayed=()=>resolve(response(result));});
      return response(result);
    }
    return response(clone(record));
  }});
  const q=s=>win.document.querySelector(s), settle=async()=>{for(let i=0;i<12;i++)await new Promise(resolve=>setImmediate(resolve));};
  function input(field,value) {const node=q(`[data-ai-field="${field}"]`);node.value=value;node.dispatchEvent(new win.Event('input',{bubbles:true}));}
  try {
    await import(`../web/app.js?matchup-test=${Date.now()}`);await settle();
    assert.equal(q('#app').hidden,true);assert.ok(q('[data-cloud-action="enter-editor"]'));assert.ok(q('[data-cloud-action="enter-analysis"]'));
    q('[data-cloud-action="enter-analysis"]').click();await settle();
    assert.equal(q('#ai-matchup-root').hidden,false);assert.ok(q('.ai-board svg'));assert.equal(q('[data-ai-field="coverage"]').value,'unknown');
    assert.equal(q('[data-ai-field="model"]').value,'deepseek-flash');assert.equal(q('[data-ai-field="baseUrl"]'),null);assert.equal(q('[data-ai-field="consent"]'),null);
    q('[data-ai-action="analyze"]').click();assert.match(q('.ai-error').textContent,/API Key/);assert.equal(calls.filter(c=>c.path.endsWith('/matchup-analysis')).length,0);
    input('model','fake-model');input('apiKey','fake-key');q('[data-ai-action="analyze"]').click();await settle();
    const submitted=calls.find(c=>c.path.endsWith('/matchup-analysis'));assert.equal(submitted.body.model.apiKey,'fake-key');assert.equal(submitted.body.model.protocol,'openai');assert.equal(submitted.body.consent,undefined);
    assert.equal(win.localStorage.getItem('fake-key'),null);assert.doesNotMatch(JSON.stringify(win.localStorage),/fake-key/);
    assert.match(q('.ai-scenario').textContent,/<img src=x/);assert.equal(q('.ai-scenario img'),null);
    assert.match(q('.ai-result-badge').textContent,/信息有限/);assert.match(q('.ai-execution').textContent,/2 次模型请求/);
    assert.ok([...q('.ai-board').querySelectorAll('[data-route]')].some(n=>n.dataset.route===routeId&&n.classList.contains('ai-evidence-active')));
    q('[data-ai-scenario="1"]').click();assert.match(q('.ai-scenario').textContent,/短传可能/);assert.equal(q('.ai-board .ai-evidence-active'),null);
    input('context','pending');assert.equal(q('.ai-scenario'),null);q('[data-ai-action="analyze"]').click();await settle();
    assert.equal(typeof finishDelayed,'function');assert.equal(q('[data-ai-action="cancel"]').hidden,false);
    const finishOld=finishDelayed;q('[data-ai-action="cancel"]').click();assert.match(q('.ai-error').textContent,/已取消/);
    q('[data-ai-action="analyze"]').click();await settle();assert.equal(q('[data-ai-action="analyze"]').disabled,true);
    finishOld();await settle();assert.equal(q('[data-ai-action="analyze"]').disabled,true);
    q('[data-cloud-action="home"]').click();await settle();q('[data-cloud-action="enter-analysis"]').click();await settle();
    finishDelayed();await settle();assert.equal(q('.ai-scenario'),null);
    const provider=q('[data-ai-field="provider"]');provider.value='anthropic';provider.dispatchEvent(new win.Event('change',{bubbles:true}));
    assert.equal(q('[data-ai-field="model"]').value,'claude-sonnet-4-6');assert.equal(q('[data-ai-field="apiKey"]').value,'');assert.equal(q('[data-ai-field="baseUrl"]'),null);
    q('[data-cloud-action="home"]').click();await settle();assert.equal(q('#ai-matchup-root').hidden,true);
    q('[data-cloud-action="enter-editor"]').click();await settle();assert.equal(q('#app').hidden,false);
    assert.equal(calls.filter(c=>c.method==='PUT').length,0);
  } finally {await win.happyDOM.abort();for(const n of names){if(previous[n])Object.defineProperty(globalThis,n,previous[n]);else delete globalThis[n];}}
});
