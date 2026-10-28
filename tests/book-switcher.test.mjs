import test from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { readFileSync } from 'node:fs';
import { starterWorkspace, clone } from '../web/model.js';
import { currentBookCard, createBookSwitcher } from '../web/book-switcher.js';

test('empty and user-supplied book names render as inert text', async () => {
  const win=new Window({url:'http://localhost:3000/'}), old=Object.getOwnPropertyDescriptor(globalThis,'document'), oldWindow=Object.getOwnPropertyDescriptor(globalThis,'window');
  Object.defineProperty(globalThis,'document',{configurable:true,value:win.document});
  Object.defineProperty(globalThis,'window',{configurable:true,value:win});
  const root=win.document.createElement('div');win.document.body.append(root);
  const picker=createBookSwitcher(root,{onChoose:()=>{}});
  try {
    picker.update({books:[],currentId:''});assert.match(root.textContent,/还没有战术本/);
    const title='<img src=x onerror="alert(1)">';
    picker.update({books:[{id:'one',title,role:'owner'}],currentId:'one'});
    assert.equal(root.querySelector('img'),null);assert.equal(root.querySelector('.book-card strong').textContent,title);
    const trigger=win.document.createElement('div');trigger.innerHTML=currentBookCard([{id:'one',title,role:'owner'}],{id:'one',title});
    assert.equal(trigger.querySelector('img'),null);assert.equal(trigger.querySelector('strong').textContent,title);
  } finally {picker.destroy();await win.happyDOM.abort();if(old)Object.defineProperty(globalThis,'document',old);else delete globalThis.document;if(oldWindow)Object.defineProperty(globalThis,'window',oldWindow);else delete globalThis.window;}
});

test('the bundled carousel allows a deliberate click and suppresses the click after dragging', async () => {
  const win=new Window({url:'http://localhost:3000/'});
  const names=['window','document','ResizeObserver','IntersectionObserver'];
  const previous=Object.fromEntries(names.map(n=>[n,Object.getOwnPropertyDescriptor(globalThis,n)]));
  for(const n of names)Object.defineProperty(globalThis,n,{configurable:true,value:win[n]});
  // Happy DOM has no layout engine; supply only the measurements Embla reads.
  const proto=win.HTMLElement.prototype;
  Object.defineProperties(proto,{
    clientWidth:{configurable:true,get(){return this.classList.contains('book-viewport')?640:0;}},
    offsetWidth:{configurable:true,get(){return this.classList.contains('book-slide')?228:640;}},
    offsetHeight:{configurable:true,get(){return 170;}},
    offsetLeft:{configurable:true,get(){return this.classList.contains('book-slide')?[...this.parentElement.children].indexOf(this)*240:0;}},
    offsetParent:{configurable:true,get(){return win.document.body;}}
  });
  const root=win.document.createElement('div');win.document.body.append(root);
  const chosen=[],picker=createBookSwitcher(root,{onChoose:id=>chosen.push(id)});
  try {
    picker.update({books:['a','b','c','d'].map(id=>({id,title:id,role:'owner'})),currentId:'a'});
    assert.ok(root.classList.contains('book-carousel-ready'));
    root.querySelector('[data-book-scroll="next"]').click();assert.deepEqual(chosen,[]);
    const card=root.querySelector('[data-book-id="b"]');card.click();assert.deepEqual(chosen,['b']);
    card.dispatchEvent(new win.MouseEvent('mousedown',{clientX:240,button:0,bubbles:true}));
    win.document.dispatchEvent(new win.MouseEvent('mousemove',{clientX:40,buttons:1,bubbles:true,cancelable:true}));
    win.document.dispatchEvent(new win.MouseEvent('mouseup',{clientX:40,button:0,bubbles:true}));
    card.click();assert.deepEqual(chosen,['b']);
    card.click();assert.deepEqual(chosen,['b','b']);
  } finally {picker.destroy();await win.happyDOM.abort();for(const n of names){if(previous[n])Object.defineProperty(globalThis,n,previous[n]);else delete globalThis[n];}}
});

test('card switching loads the right workspace, guards pending changes and survives failures', async t => {
  const win=new Window({url:'https://playbook.test/editor/index.html',width:390,height:844});
  win.document.body.innerHTML=readFileSync(new URL('../web/index.html',import.meta.url),'utf8').split('<body>')[1].split('</body>')[0];
  const records=Object.fromEntries([['a','进攻战术本','owner'],['b','防守演练','viewer'],['c','比赛准备','editor']].map(([id,title,role])=>{const data=starterWorkspace();data.plays[0].title=`${id.toUpperCase()} · Mesh`;return[id,{id,title,role,revision:1,data}];}));
  const names=['window','document','navigator','localStorage','location','history','Image','Blob','requestAnimationFrame','cancelAnimationFrame','fetch'];
  const previous=Object.fromEntries(names.map(n=>[n,Object.getOwnPropertyDescriptor(globalThis,n)]));
  for(const n of names.filter(n=>n!=='fetch'))Object.defineProperty(globalThis,n,{configurable:true,value:['requestAnimationFrame','cancelAnimationFrame'].includes(n)?win[n].bind(win):win[n]});
  win.setInterval=()=>1;
  const response=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}}),calls=[];
  let finishB,finishSave,failC=true;
  Object.defineProperty(globalThis,'fetch',{configurable:true,value:async(path,options={})=>{
    calls.push({path,method:options.method||'GET'});
    if(path==='/api/session')return response({user:{id:'me',name:'Coach',email:'coach@example.test',authMode:'password'}});
    if(path==='/api/workspaces')return response({workspaces:Object.values(records).map(({id,title,role})=>({id,title,role}))});
    const id=path.split('/')[3];
    if(options.method==='PUT')return new Promise(resolve=>{finishSave=()=>{records[id].data=JSON.parse(options.body).data;resolve(response({revision:2}));};});
    if(id==='b')return new Promise(resolve=>{finishB=()=>resolve(response(clone(records.b)));});
    if(id==='c'&&failC)return response({error:'连接失败，请重试'},503);
    return response(clone(records[id]));
  }});
  const q=s=>win.document.querySelector(s),click=s=>{assert.ok(q(s),s);q(s).click();};
  const settle=async()=>{for(let i=0;i<12;i++)await new Promise(resolve=>setImmediate(resolve));};
  const reads=id=>calls.filter(c=>c.path===`/api/workspaces/${id}`&&c.method==='GET').length;
  try {
    await import(`../web/app.js?book-cards=${Date.now()}`);await settle();
    click('[data-cloud-action="enter-editor"]');await settle();
    await t.test('current book is a card trigger and keyboard browsing does not switch data',async()=>{
      assert.equal(q('#cloud-workspace'),null);assert.match(q('.workspace-current-card strong').textContent,/进攻/);
      click('[data-cloud-action="books"]');assert.equal(q('.book-card[aria-pressed=true]').dataset.bookId,'a');
      const first=q('[data-book-id="a"]');first.focus();first.dispatchEvent(new win.KeyboardEvent('keydown',{key:'End',bubbles:true,cancelable:true}));
      assert.equal(win.document.activeElement.dataset.bookId,'c');assert.equal(reads('c'),0);assert.match(q('h1').textContent,/A · Mesh/);
    });
    await t.test('rapid selections cannot race, old data remains until success, and viewer permissions apply',async()=>{
      const trigger=q('.workspace-current-card');click('[data-book-id="b"]');await settle();
      assert.equal(q('.book-switcher').getAttribute('aria-busy'),'true');assert.match(q('h1').textContent,/A · Mesh/);
      click('[data-book-id="c"]');assert.equal(reads('c'),0);assert.equal(reads('b'),1);
      finishB();await settle();
      assert.equal(q('#book-card-picker'),null);assert.match(q('h1').textContent,/B · Mesh/);
      assert.equal(q('[data-prop="title"]').disabled,true);assert.equal(q('[data-action="undo"]').disabled,true);
      assert.ok(q('.workspace-current-card')===trigger);assert.ok(win.document.activeElement===trigger);
      assert.match(win.location.search,/workspace=b/);
    });
    await t.test('failed loads keep the current selection and allow retry',async()=>{
      click('[data-cloud-action="books"]');click('[data-book-id="c"]');await settle();
      assert.match(q('.book-switcher-message').textContent,/连接失败/);
      assert.equal(q('.book-card[aria-pressed=true]').dataset.bookId,'b');assert.match(q('h1').textContent,/B · Mesh/);
      assert.equal(q('.book-switcher').getAttribute('aria-busy'),'false');
      failC=false;click('[data-book-id="c"]');await settle();
      assert.equal(q('#book-card-picker'),null);assert.match(q('h1').textContent,/C · Mesh/);assert.equal(q('[data-prop="title"]').disabled,false);
    });
    await t.test('unsynced changes block selection until the actual save finishes',async()=>{
      const input=q('[data-prop="title"]');input.value='C · 未同步修改';input.dispatchEvent(new win.Event('change',{bubbles:true}));
      click('[data-cloud-action="books"]');assert.match(q('.book-switcher-message').textContent,/未同步/);
      const before=reads('a');click('[data-book-id="a"]');await settle();assert.equal(reads('a'),before);
      await new Promise(resolve=>setTimeout(resolve,1000));assert.equal(typeof finishSave,'function');
      assert.equal(q('[data-book-id="a"]').getAttribute('aria-disabled'),'true');
      finishSave();await settle();assert.equal(q('[data-book-id="a"]').getAttribute('aria-disabled'),'false');
      click('[data-book-id="c"]');await settle();assert.equal(q('#book-card-picker'),null);
      assert.match(q('h1').textContent,/未同步修改/);
    });
    await t.test('new book uses the existing create flow and Escape returns focus to the current card',async()=>{
      click('[data-cloud-action="books"]');click('#modal-root [data-cloud-action="new"]');
      assert.equal(q('#book-card-picker'),null);assert.ok(q('#cloud-new-title'));
      click('#modal-root [data-action="close-modal"]');
      click('[data-cloud-action="books"]');q('#modal-root .modal').dispatchEvent(new win.KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));
      assert.equal(q('#book-card-picker'),null);assert.ok(win.document.activeElement===q('.workspace-current-card'));
    });
  } finally {await win.happyDOM.abort();for(const n of names){if(previous[n])Object.defineProperty(globalThis,n,previous[n]);else delete globalThis[n];}}
});
