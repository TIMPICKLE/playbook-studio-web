import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Window } from 'happy-dom';
import { STORAGE_KEY, decodeWorkspace, encodeWorkspace, starterWorkspace } from '../web/model.js';
import { getEditableEntry } from '../web/madden-model.js';
import { TRACE_SHARDS } from '../web/data/madden-trace-index.js';
import { ONBOARDING_STORAGE_KEY } from '../web/onboarding.js';
import { editableTraces } from '../web/madden-traces.js';

const catalog=JSON.parse(readFileSync(new URL('../web/data/huddle-catalog.json',import.meta.url)));
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function deferredGeometry() {
  const original=editableTraces.loadMany;
  let release,settled=false;
  const waiting=new Promise(resolve=>{release=resolve;});
  editableTraces.loadMany=async ids=>{
    try { await waiting;return await original(ids); }
    finally { settled=true; }
  };
  return {release,settled:()=>settled,restore:()=>{editableTraces.loadMany=original;}};
}
async function until(predicate,message) {
  const deadline=Date.now()+5000;
  while(!predicate()&&Date.now()<deadline)await tick();
  assert.ok(predicate(),message);
}
const entryFor=shard=>catalog.plays.find(entry=>TRACE_SHARDS[entry.id]===shard);
const loaded=id=>{try{return !!getEditableEntry(id);}catch{return false;}};
function referenceWorkspace(entry) {
  const data=starterWorkspace(),play=data.plays[0];
  data.plays[0]={...play,title:'My source diagram',notes:'Keep these coaching notes',favorite:true,
    players:[],routes:[],zones:[],annotations:[],ball:{holderId:'',receiverId:'',passAt:2,arriveAt:3},
    reference:{provider:'huddle.gg',catalogId:entry.id,team:entry.team,game:entry.game,sourceUrl:entry.sourceUrl,image:entry.image}};
  return data;
}
async function fixture(t,data=starterWorkspace()) {
  const win=new Window({url:'http://localhost:3000/local.html',width:1440,height:1000});
  win.document.body.innerHTML=readFileSync(new URL('../web/index.html',import.meta.url),'utf8').split('<body>')[1].split('</body>')[0];
  const original=encodeWorkspace(data);win.localStorage.setItem(STORAGE_KEY,original);
  win.localStorage.setItem(ONBOARDING_STORAGE_KEY,JSON.stringify({dismissed:true,completed:[]}));
  const names=['window','document','navigator','localStorage','location','history','Image','Blob','HTMLElement','SVGElement','Node','MutationObserver','ResizeObserver','DOMRect','DOMPoint','Element','HTMLButtonElement','MouseEvent','ShadowRoot','getComputedStyle','requestAnimationFrame','cancelAnimationFrame','fetch'];
  const old=Object.fromEntries(names.map(name=>[name,Object.getOwnPropertyDescriptor(globalThis,name)]));
  for(const name of names)Object.defineProperty(globalThis,name,{configurable:true,value:name==='fetch'?async path=>{
    if(String(path).endsWith('/data/huddle-catalog.json'))return Response.json(catalog);
    throw Error('Unexpected test network request: '+path);
  }:['getComputedStyle','requestAnimationFrame','cancelAnimationFrame'].includes(name)?win[name].bind(win):win[name]});
  const q=selector=>win.document.querySelector(selector),saved=()=>decodeWorkspace(win.localStorage.getItem(STORAGE_KEY));
  t.after(async()=>{
    q('[data-madden="close"]')?.click();q('[data-cloud-action="home"]')?.click();
    win.dispatchEvent(new win.Event('pagehide'));
    await win.happyDOM.abort();
    for(const name of names){if(old[name])Object.defineProperty(globalThis,name,old[name]);else delete globalThis[name];}
  });
  await import(`../web/app.js?madden-lifecycle=${Date.now()}-${Math.random()}`);
  await until(()=>q('#field svg'),'the actual editor mounts');
  const openEntry=async entry=>{
    q('[data-action="madden-library"]').click();
    await until(()=>q('#madden-search'),'the catalog is available');
    q(`[data-madden="team"][data-id="${entry.team}"]`).click();
    const search=q('#madden-search');search.value=entry.name;search.dispatchEvent(new win.Event('input',{bubbles:true}));
    const button=q(`[data-madden="add"][data-id="${entry.id}"]`);assert.ok(button,'the chosen real catalog entry is offered');return button;
  };
  return {win,q,saved,original,openEntry};
}

test('a cold Madden import cannot append a play after navigating away from its editor',async t=>{
  const entry=entryFor('seed');assert.ok(entry);assert.equal(loaded(entry.id),false);
  const f=await fixture(t);
  const add=await f.openEntry(entry);add.click();
  assert.equal(f.q('.madden-panel').getAttribute('aria-busy'),'true');
  f.q('[data-cloud-action="home"]').click();
  await until(()=>loaded(entry.id),'the in-flight geometry preparation finishes');await tick();await tick();
  assert.equal(f.win.localStorage.getItem(STORAGE_KEY),f.original,'late loading never commits into a departed workspace');
  assert.equal(f.q('#app').hidden,true);assert.equal(f.q('#madden-root').hidden,true);
  assert.ok(f.q('.studio-home'));assert.equal(f.q('.madden-panel'),null);
});

test('a normal cold Madden import loads editable geometry and creates one undoable play',async t=>{
  const entry=entryFor('final');assert.ok(entry);assert.equal(loaded(entry.id),false);
  const f=await fixture(t),count=f.saved().plays.length;
  const add=await f.openEntry(entry);add.click();
  await until(()=>f.q('.madden-result-bar')?.dataset.type==='success','cold import resolves as an editable play');
  const imported=f.saved().plays.filter(play=>play.diagramSource?.catalogId===entry.id);
  assert.equal(f.saved().plays.length,count+1);assert.equal(imported.length,1);
  assert.ok(imported[0].players.length>0);assert.ok(imported[0].routes.length>0);assert.equal(imported[0].reference,undefined);
  assert.equal(f.q('#app').hidden,false);
  f.q('[data-madden="undo-result"]').click();
  assert.deepEqual(f.saved(),decodeWorkspace(f.original),'undo restores the original workspace independently of backup timestamps');
});

test('converting a cold source diagram preserves the original and personal details in the editable copy',async t=>{
  const entry=entryFor('batch');assert.ok(entry);assert.equal(loaded(entry.id),false);
  const data=referenceWorkspace(entry),f=await fixture(t,data),original=data.plays[0];
  const convert=f.q('[data-action="convert-reference"]');assert.ok(convert);assert.equal(convert.disabled,false);
  convert.click();
  await until(()=>f.saved().plays.length===data.plays.length+1,'conversion loads geometry and appends its editable copy');
  const saved=f.saved(),copy=saved.plays.find(play=>play.diagramSource?.catalogId===entry.id);
  assert.deepEqual(saved.plays.find(play=>play.id===original.id),original,'the original source play remains untouched');
  assert.ok(copy);assert.equal(copy.title,original.title);assert.ok(copy.notes.startsWith(original.notes+'\n'),'personal notes remain before reconstruction provenance');assert.equal(copy.favorite,true);
  assert.ok(copy.players.length>0);assert.equal(copy.reference,undefined);
  f.q('[data-action="undo"]').click();
  assert.deepEqual(f.saved(),decodeWorkspace(f.original));
});

test('leaving while source geometry loads cancels conversion without altering the saved source diagram',async t=>{
  const entry=entryFor('oct28');assert.ok(entry);assert.equal(loaded(entry.id),false);
  const f=await fixture(t,referenceWorkspace(entry));
  f.q('[data-action="convert-reference"]').click();f.q('[data-cloud-action="home"]').click();
  await until(()=>loaded(entry.id),'the deferred source shard finishes');await tick();await tick();
  assert.equal(f.win.localStorage.getItem(STORAGE_KEY),f.original);
  assert.equal(f.q('#app').hidden,true);assert.ok(f.q('.studio-home'));
});

test('closing a pending library import preserves unsaved notes and never switches to the imported play',async t=>{
  const entry=entryFor('expanded');assert.ok(entry);
  const f=await fixture(t),geometry=deferredGeometry();
  try {
    const add=await f.openEntry(entry);add.click();
    assert.equal(f.q('.madden-panel').getAttribute('aria-busy'),'true');
    f.q('[data-madden="close"]').click();
    const notes=f.q('[data-prop="notes"]');assert.ok(notes);notes.focus();notes.value='Still composing my coaching notes';
    const title=f.q('h1').textContent;
    geometry.release();await until(geometry.settled,'the delayed geometry import finishes');await tick();await tick();
    assert.equal(f.win.localStorage.getItem(STORAGE_KEY),f.original,'a cancelled import cannot append or save a new play');
    assert.ok(notes.isConnected&&f.q('[data-prop="notes"]')===notes,'the notes editor remains attached to the current play');
    assert.equal(notes.value,'Still composing my coaching notes');assert.equal(f.q('h1').textContent,title);
    assert.ok(f.win.document.activeElement===notes,'late completion cannot take focus from the notes draft');
    assert.equal(f.q('#madden-root').hidden,true);
  } finally {
    geometry.release();await tick();geometry.restore();
  }
});

test('a still-open library cannot apply a late import over an actively edited unsaved property',async t=>{
  const entry=entryFor('continued');assert.ok(entry);
  const f=await fixture(t),geometry=deferredGeometry();
  try {
    const add=await f.openEntry(entry);add.click();
    const notes=f.q('[data-prop="notes"]');assert.ok(notes);notes.focus();notes.value='Working on this text without a change event';
    const title=f.q('h1').textContent;
    geometry.release();await until(geometry.settled,'the delayed geometry import finishes');
    await until(()=>f.q('.madden-result-message')?.getAttribute('role')==='alert','the host rejects the late import while a property is being edited');
    assert.equal(f.win.localStorage.getItem(STORAGE_KEY),f.original);
    assert.ok(notes.isConnected&&f.q('[data-prop="notes"]')===notes);
    assert.equal(notes.value,'Working on this text without a change event');assert.equal(f.q('h1').textContent,title);
    assert.ok(f.win.document.activeElement===notes,'the library result does not steal the active property focus');
    assert.equal(f.q('#madden-root').hidden,false);
  } finally {
    geometry.release();await tick();geometry.restore();
  }
});
