import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Window } from 'happy-dom';
import { createMaddenLibrary } from '../web/madden.js';

const catalog=JSON.parse(readFileSync(new URL('../web/data/huddle-catalog.json',import.meta.url)));
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function deferred() {
  let resolve,reject;
  const promise=new Promise((success,failure)=>{resolve=success;reject=failure;});
  return {promise,resolve,reject};
}
async function until(predicate,message) {
  const deadline=Date.now()+2000;
  while(!predicate()&&Date.now()<deadline)await tick();
  assert.ok(predicate(),message);
}
async function fixture(t,onImport) {
  const win=new Window({url:'https://playbook.test/local.html',width:1440,height:900});
  win.document.body.innerHTML='<button id="opener">Library</button><div id="madden-root" hidden></div><button id="outside">Continue elsewhere</button>';
  const names=['window','document','fetch'];
  const previous=Object.fromEntries(names.map(name=>[name,Object.getOwnPropertyDescriptor(globalThis,name)]));
  for(const name of names)Object.defineProperty(globalThis,name,{configurable:true,value:name==='fetch'?async()=>new Response(JSON.stringify(catalog)):win[name]});
  const state={editable:true,plays:[],calls:[]},q=selector=>win.document.querySelector(selector);
  const library=createMaddenLibrary({
    canEdit:()=>state.editable,getPlays:()=>state.plays,notify:()=>{},
    onImport(entry,options){state.calls.push(entry);return onImport(entry,state,options);},
  });
  t.after(async()=>{
    if(library.isOpen)library.close();
    await win.happyDOM.abort();
    for(const name of names){if(previous[name])Object.defineProperty(globalThis,name,previous[name]);else delete globalThis[name];}
  });
  q('#opener').focus();await library.open();
  return {win,state,q,library,add:()=>q('.madden-card [data-madden="add"]')};
}

test('library waits for an async import, shows pending state, and retains success undo and view actions',async t=>{
  const work=deferred();let undoCount=0,viewCount=0;
  const f=await fixture(t,async(entry,state)=>{
    await work.promise;
    state.plays.push({diagramSource:{catalogId:entry.id}});
    return {ok:true,canUndo:()=>state.plays.length>0,undo(){undoCount++;state.plays.pop();},view(){viewCount++;}};
  });
  f.add().click();
  assert.equal(f.state.calls.length,1);
  assert.ok([...f.win.document.querySelectorAll('[data-madden="add"]')].every(button=>button.disabled),'add controls cannot start another import while pending');
  assert.equal(f.q('.madden-result-message')?.getAttribute('role'),'status','pending feedback is not reported as a failed import');
  assert.equal(f.q('.madden-result-bar')?.dataset.type==='error',false);
  assert.equal(f.q('[data-madden="undo-result"]'),null);
  work.resolve();
  await until(()=>f.q('.madden-result-bar')?.dataset.type==='success','async completion produces a success result');
  assert.equal(f.state.plays.length,1);
  assert.ok(f.q('[data-madden="view-result"]'));
  f.q('[data-madden="undo-result"]').click();
  assert.equal(undoCount,1);assert.equal(f.state.plays.length,0);
  f.add().click();
  await until(()=>f.q('[data-madden="view-result"]'),'a new successful import remains usable after undo');
  f.q('[data-madden="view-result"]').click();
  assert.equal(viewCount,1);assert.equal(f.library.isOpen,false);assert.equal(f.q('#madden-root').hidden,true);
});

test('global language and tour controls cannot cover library actions and return after closing',async t=>{
  const f=await fixture(t,()=>({ok:true}));
  f.win.document.head.innerHTML=`<style>${readFileSync(new URL('../web/component-layout.css',import.meta.url),'utf8')}</style>`;
  const utilities=f.win.document.createElement('div');utilities.className='locale-control';
  utilities.innerHTML='<button>Quick tour</button><select><option>Language</option></select>';
  f.win.document.body.append(utilities);
  assert.equal(f.win.getComputedStyle(utilities).visibility,'hidden');
  f.library.close();
  assert.notEqual(f.win.getComputedStyle(utilities).visibility,'hidden');
  await f.library.open();
  assert.equal(f.win.getComputedStyle(utilities).visibility,'hidden');
});

test('a rejected async import reports an error and can be retried without stale pending state',async t=>{
  const first=deferred();
  const f=await fixture(t,(_entry,state)=>state.calls.length===1?first.promise:Promise.resolve({ok:true}));
  const id=f.add().dataset.id;
  f.add().click();first.reject(Error('Geometry unavailable'));
  await until(()=>f.q('.madden-result-message')?.getAttribute('role')==='alert','failure is caught and announced');
  assert.equal(f.q('.madden-result-bar').dataset.type,'error');
  const retry=f.q(`[data-madden="add"][data-id="${id}"]`);
  assert.ok(retry);assert.equal(retry.disabled,false,'a network failure does not permanently disable the item');
  retry.click();
  await until(()=>f.q('.madden-result-bar')?.dataset.type==='success','retry can finish successfully');
  assert.equal(f.state.calls.length,2);
});

test('rapid repeated add requests and drops share one pending UI operation',async t=>{
  const work=deferred();
  const f=await fixture(t,()=>work.promise),id=f.add().dataset.id;
  f.add().click();
  const pendingButton=f.q(`[data-madden="add"][data-id="${id}"]`);
  pendingButton.dispatchEvent(new f.win.MouseEvent('click',{bubbles:true}));
  const drop=f.win.document.createElement('div');drop.dataset.maddenDrop='offense';f.win.document.body.append(drop);
  const event=new f.win.Event('drop',{bubbles:true,cancelable:true});
  Object.defineProperty(event,'dataTransfer',{value:{types:['application/x-playbook-madden'],getData:()=>id}});
  drop.dispatchEvent(event);
  assert.equal(f.state.calls.length,1,'duplicate button and drag paths cannot create concurrent imports');
  work.resolve({ok:true});
  await until(()=>f.q('.madden-result-bar')?.dataset.type==='success','single pending import resolves');
});

test('settling an import after closing does not reopen the library or take focus from another task',async t=>{
  const work=deferred();let signal;
  const f=await fixture(t,(_entry,_state,options)=>{signal=options?.signal;return work.promise;});
  f.add().click();assert.equal(signal?.aborted,false,'the host receives an active import cancellation signal');
  f.library.close();assert.equal(signal.aborted,true,'closing the library cancels the pending host operation');f.q('#outside').focus();
  work.resolve({ok:true});await tick();await tick();
  assert.equal(f.library.isOpen,false);assert.equal(f.q('#madden-root').hidden,true);
  assert.equal(f.q('.madden-panel'),null);
  assert.ok(f.win.document.activeElement===f.q('#outside'),'a late completion cannot focus a removed result message');
  await f.library.open();
  assert.equal(f.q('.madden-result-bar').hidden,true,'an old closed-session result is not announced in a new session');
  assert.equal(f.q('[data-madden="view-result"]'),null);
});

test('an old closed-session result cannot unlock or replace a newer import after reopening',async t=>{
  const oldWork=deferred(),newWork=deferred(),signals=[];let oldViews=0,newViews=0;
  const f=await fixture(t,(_entry,state,options)=>{signals.push(options?.signal);return state.calls.length===1?oldWork.promise:newWork.promise;});
  f.add().click();f.library.close();await f.library.open();f.add().click();
  assert.equal(f.state.calls.length,2);
  assert.equal(signals[0]?.aborted,true);assert.equal(signals[1]?.aborted,false,'a new session owns a separate active cancellation signal');
  assert.equal(f.q('.madden-panel').getAttribute('aria-busy'),'true');
  oldWork.resolve({ok:true,view(){oldViews++;}});await tick();await tick();
  assert.equal(f.q('.madden-panel').getAttribute('aria-busy'),'true','the old finally must not clear the new pending job');
  assert.ok([...f.win.document.querySelectorAll('[data-madden="add"]')].every(button=>button.disabled));
  assert.equal(f.q('[data-madden="view-result"]'),null,'a closed-session result cannot surface as the new result');
  newWork.resolve({ok:true,view(){newViews++;}});
  await until(()=>f.q('.madden-result-bar')?.dataset.type==='success','the current import owns completion');
  f.q('[data-madden="view-result"]').click();assert.equal(newViews,1);assert.equal(oldViews,0);
});

test('read-only access prevents new add and drag requests, including while an import is pending',async t=>{
  const work=deferred();
  const f=await fixture(t,()=>work.promise),id=f.add().dataset.id;
  f.add().click();f.state.editable=false;f.library.refresh();
  assert.ok([...f.win.document.querySelectorAll('[data-madden="add"]')].every(button=>button.disabled));
  const button=f.q(`[data-madden="add"][data-id="${id}"]`);
  button.dispatchEvent(new f.win.MouseEvent('click',{bubbles:true}));
  const drop=f.win.document.createElement('div');drop.dataset.maddenDrop='offense';f.win.document.body.append(drop);
  const event=new f.win.Event('drop',{bubbles:true,cancelable:true});
  Object.defineProperty(event,'dataTransfer',{value:{types:['application/x-playbook-madden'],getData:()=>id}});
  drop.dispatchEvent(event);
  assert.equal(f.state.calls.length,1,'permission loss cannot start another host import');
  work.resolve({ok:false,message:'Editing access changed'});
  await until(()=>f.q('.madden-result-message')?.getAttribute('role')==='alert','the host can reject the pending write after permission loss');
  assert.equal(f.state.plays.length,0);assert.equal(f.q(`[data-madden="add"][data-id="${id}"]`).disabled,true);
});
