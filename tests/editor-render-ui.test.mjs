import test from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { readFileSync } from 'node:fs';
import { clone, starterWorkspace, STORAGE_KEY, encodeWorkspace, decodeWorkspace } from '../web/model.js';

test('large playbooks keep live editor nodes through search and edits; switching plays scopes the next drag correctly',async()=>{
  const win=new Window({url:'http://localhost:3000/local.html#editor',width:1440,height:1000});
  win.IntersectionObserver=class {
    constructor(callback){this.callback=callback;}
    observe(node){if(node.hasAttribute('data-thumbnail-index')&&Number(node.dataset.thumbnailIndex)<12)this.callback([{target:node,isIntersecting:true}]);}
    disconnect(){}
  };
  const data=starterWorkspace(),first=data.plays[0];
  data.plays=Array.from({length:200},(_,index)=>({...clone(first),id:`practice-${index}`,title:`Practice ${index}`}));
  win.localStorage.setItem(STORAGE_KEY,encodeWorkspace(data));
  win.localStorage.setItem('playbook-studio:onboarding:v1',JSON.stringify({dismissed:true,completed:[]}));
  win.document.body.innerHTML=readFileSync(new URL('../web/index.html',import.meta.url),'utf8').split('<body>')[1].split('</body>')[0];
  const names=['window','document','navigator','localStorage','location','history','Image','Blob','requestAnimationFrame','cancelAnimationFrame'];
  const previous=Object.fromEntries(names.map(name=>[name,Object.getOwnPropertyDescriptor(globalThis,name)]));
  for(const name of names)Object.defineProperty(globalThis,name,{configurable:true,value:['requestAnimationFrame','cancelAnimationFrame'].includes(name)?win[name].bind(win):win[name]});
  const doc=win.document,q=selector=>doc.querySelector(selector),saved=()=>decodeWorkspace(win.localStorage.getItem(STORAGE_KEY));
  const click=action=>q(`[data-action="${action}"]`).click();
  const search=value=>{const input=q('#search');input.value=value;input.dispatchEvent(new win.Event('input',{bubbles:true}));};
  const pointer=(node,type,x,y)=>node.dispatchEvent(new win.PointerEvent(type,{bubbles:true,button:0,pointerId:1,clientX:x,clientY:y}));
  const geometry=()=>{q('#field svg').getBoundingClientRect=()=>({x:0,y:0,left:0,top:0,right:1000,bottom:800,width:1000,height:800});};
  try {
    await import(`../web/app.js?partial-render=${Date.now()}`);
    assert.equal(doc.querySelectorAll('.play-card').length,200);
    const workspace=q('.workspace'),field=q('#field'),svg=q('#field .pitch-svg'),stage=q('.pitch-stage'),inspector=q('.inspector'),input=q('#search');
    const stableCard=q('[data-action="choose:practice-10"]'),stableThumb=stableCard.querySelector('svg');
    assert.ok(stableThumb,'nearby thumbnails are visible in the fixture');
    search('Practice 1');
    assert.equal(doc.querySelectorAll('.play-card').length,111);
    assert.ok(q('[data-action="choose:practice-10"]')===stableCard);
    assert.ok(stableCard.querySelector('svg')===stableThumb,'search retains already-rendered matching thumbnails');
    search('');
    assert.equal(doc.querySelectorAll('.play-card').length,200);
    assert.ok(q('[data-action="choose:practice-10"]')===stableCard);
    const title=q('[data-prop="title"]');title.focus();title.value='Renamed practice';
    title.dispatchEvent(new win.Event('change',{bubbles:true}));title.setSelectionRange(2,6);
    const player=q('#field [data-player]');
    for(let i=0;i<4;i++)click('favorite');
    assert.ok(q('.workspace')===workspace && q('#field')===field && q('.pitch-stage')===stage && q('#field .pitch-svg')===svg);
    assert.ok(q('.inspector')===inspector && q('#search')===input && q('[data-prop="title"]')===title);
    assert.ok(q('#field [data-player]')===player,'non-geometric edits do not rebuild player nodes');
    assert.ok(doc.activeElement===title);assert.equal(title.selectionStart,2);assert.equal(title.selectionEnd,6);
    assert.equal(saved().plays[0].title,'Renamed practice');
    const before=saved();geometry();
    pointer(player,'pointerdown',400,500);pointer(field,'pointermove',460,530);pointer(field,'pointerup',460,530);
    assert.notDeepEqual(saved().plays[0].players,before.plays[0].players);
    click('undo');assert.deepEqual(saved().plays[0].players,before.plays[0].players,'one undo restores one drag after repeated same-play renders');
    click('choose:practice-1');
    assert.ok(q('#field')!==field,'a play switch creates a new editing boundary');
    const switched=saved();geometry();
    pointer(q('#field [data-player]'),'pointerdown',400,500);pointer(q('#field'),'pointerup',480,550);
    const after=saved();
    assert.deepEqual(after.plays[0],switched.plays[0],'a newly selected play cannot mutate the prior play');
    assert.notDeepEqual(after.plays[1].players,switched.plays[1].players);
    click('undo');assert.deepEqual(saved().plays[1].players,switched.plays[1].players);
    q('#field [data-player]').dispatchEvent(new win.KeyboardEvent('keydown',{key:'Enter',bubbles:true}));
    click('tool:route');geometry();pointer(q('#field'),'pointerdown',500,350);
    const drawing=q('.drawing-steps'),drawingSvg=q('#field .pitch-svg'),beforeRoute=saved().plays[1].routes.length;
    assert.ok(drawing);
    search('Practice 1');search('');
    assert.ok(q('.drawing-steps')===drawing && q('#field .pitch-svg')===drawingSvg,'search leaves an unfinished route and its live field untouched');
    click('tool:select');assert.ok(q('.modal'),'the pending draft still requires an explicit switching choice');
    click('keep-drawing');click('finish-route');
    assert.equal(saved().plays[1].routes.length,beforeRoute+1,'drawing can continue and commit after filtering');
    click('undo');assert.equal(saved().plays[1].routes.length,beforeRoute);
    const markers=[...doc.querySelectorAll('.play-list marker')].map(node=>node.id);
    assert.equal(new Set(markers).size,markers.length,'filtered and new cards never share SVG marker IDs');
  } finally {
    win.dispatchEvent(new win.Event('pagehide'));await win.happyDOM.abort();
    for(const name of names){if(previous[name])Object.defineProperty(globalThis,name,previous[name]);else delete globalThis[name];}
  }
});
