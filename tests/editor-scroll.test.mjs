import test from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { readFileSync } from 'node:fs';
import { STORAGE_KEY, starterWorkspace, encodeWorkspace, decodeWorkspace } from '../web/model.js';
import { captureEditorScroll } from '../web/viewport-layout.js';

test('scroll restoration is instant and atomic even when the digital theme enables smooth scrolling',async()=>{
  const win=new Window(),doc=win.document;
  doc.head.innerHTML='<style>html { scroll-behavior:smooth }</style>';
  doc.body.innerHTML='<div class="pitch-viewport"></div>';
  const page=doc.scrollingElement||doc.documentElement,viewport=doc.querySelector('.pitch-viewport');
  page.scrollTop=28;viewport.scrollLeft=10;viewport.scrollTop=197;
  const restore=captureEditorScroll({doc,samePlay:true});
  doc.body.innerHTML='<div class="pitch-viewport"></div>';
  const replacement=doc.querySelector('.pitch-viewport'),calls=[];
  for(const node of [page,replacement])node.scrollTo=options=>{
    assert.equal(options.behavior,'instant','must override inherited smooth scrolling');
    assert.ok('left' in options&&'top' in options,'both axes move together');
    calls.push(node);node.scrollLeft=options.left;node.scrollTop=options.top;
  };
  page.scrollTop=214;restore();
  assert.equal(page.scrollTop,28);assert.equal(replacement.scrollLeft,10);assert.equal(replacement.scrollTop,197);
  assert.equal(calls.at(-1),page,'outer page is restored after the nested viewport');
  // No queued correction may pull the user back after a subsequent wheel/drag.
  page.scrollTop=91;replacement.scrollTop=240;
  await new Promise(resolve=>win.requestAnimationFrame(resolve));
  assert.equal(page.scrollTop,91);assert.equal(replacement.scrollTop,240);
  await win.happyDOM.abort();
});

test('zoomed editor retains the viewport through deletion and history operations', async t => {
  const win=new Window({url:'http://localhost:3000/',width:1440,height:1000});
  const doc=win.document;
  doc.head.innerHTML=`<style>${readFileSync(new URL('../web/board-layout.css',import.meta.url),'utf8')}</style>`;
  doc.body.innerHTML=readFileSync(new URL('../web/index.html',import.meta.url),'utf8').split('<body>')[1].split('</body>')[0];
  const seed=starterWorkspace();win.localStorage.setItem(STORAGE_KEY,encodeWorkspace(seed));
  const globals=['window','document','navigator','localStorage','location','Image','Blob','requestAnimationFrame','cancelAnimationFrame'];
  const previous=Object.fromEntries(globals.map(n=>[n,Object.getOwnPropertyDescriptor(globalThis,n)]));
  for(const n of globals)Object.defineProperty(globalThis,n,{configurable:true,value:['requestAnimationFrame','cancelAnimationFrame'].includes(n)?win[n].bind(win):win[n]});
  const q=s=>doc.querySelector(s),click=s=>{assert.ok(q(s),s);q(s).click();};
  const data=()=>decodeWorkspace(win.localStorage.getItem(STORAGE_KEY));
  const action=name=>click(`[data-action="${name}"]`);
  const scrollSelectors=['.pitch-viewport','.main','.sidebar','.play-list','.inspector-panel','.inspector'];
  function positionView(){
    for(const [i,selector]of scrollSelectors.entries()){q(selector).scrollLeft=40+i*12;q(selector).scrollTop=260+i*40;}
    (doc.scrollingElement||doc.documentElement).scrollTop=420;
  }
  function assertView(){
    for(const [i,selector]of scrollSelectors.entries()){
      assert.equal(q(selector).scrollLeft,40+i*12,`${selector} horizontal position`);
      assert.equal(q(selector).scrollTop,260+i*40,`${selector} vertical position`);
    }
    assert.equal((doc.scrollingElement||doc.documentElement).scrollTop,420,'outer page position');
    assert.equal(q('#board-zoom-value').textContent,'200%');
    assert.equal(q('#board-height').value,'700');
  }
  function selectRoute(id){
    const geometry=()=>{q('#field .pitch-svg').getBoundingClientRect=()=>({left:0,top:0,width:2000,height:1600});};
    geometry();q(`#field [data-route="${id}"]`).dispatchEvent(new win.PointerEvent('pointerdown',{bubbles:true,cancelable:true,button:0,pointerId:1,clientX:600,clientY:500}));
    geometry();q('#field').dispatchEvent(new win.PointerEvent('pointerup',{bubbles:true,button:0,pointerId:1,clientX:600,clientY:500}));
  }
  try{
    await import(`../web/app.js?editorScroll=${Date.now()}`);
    await t.test('the replaceable editor subtree cannot become a browser scroll anchor',()=>{
      assert.equal(win.getComputedStyle(q('#app')).getPropertyValue('overflow-anchor'),'none');
    });
    for(let i=0;i<4;i++)click('[data-board-action="zoom-in"]');
    const height=q('#board-height');height.value='700';height.dispatchEvent(new win.Event('input',{bubbles:true}));height.dispatchEvent(new win.Event('change',{bubbles:true}));
    const layout=win.localStorage.getItem('playbook-studio-board-layout-v1'), width=q('.workspace').style.getPropertyValue('--pitch-width');
    const routeId=seed.plays[0].routes[0].id, routeCount=seed.plays[0].routes.length;
    await t.test('delete button preserves both pitch axes and the page after replacing the editor',()=>{
      selectRoute(routeId);positionView();const viewport=q('.pitch-viewport');
      click('.inspector [data-action="delete-selection"]');
      assert.notEqual(q('.pitch-viewport'),viewport,'regression exercises a full remount');
      assert.equal(data().plays[0].routes.length,routeCount-1);assert.equal(q(`#field [data-route="${routeId}"]`),null);
      assertView();assert.equal(q('.workspace').style.getPropertyValue('--pitch-width'),width);
      assert.equal(win.localStorage.getItem('playbook-studio-board-layout-v1'),layout,'editing does not overwrite local dimensions');
    });
    await t.test('undo and redo restore route data without moving the zoomed view',()=>{
      action('undo');assert.equal(data().plays[0].routes.length,routeCount);assert.ok(q(`#field [data-route="${routeId}"]`));assertView();
      action('redo');assert.equal(data().plays[0].routes.length,routeCount-1);assertView();
      action('undo');assert.equal(data().plays[0].routes.length,routeCount);assertView();
    });
    await t.test('keyboard deletion and repeated theme changes retain the same offsets',()=>{
      selectRoute(routeId);positionView();
      doc.body.dispatchEvent(new win.KeyboardEvent('keydown',{key:'Delete',bubbles:true,cancelable:true}));
      assert.equal(data().plays[0].routes.length,routeCount-1);assertView();
      for(let i=0;i<4;i++){action('theme');assertView();}
      action('undo');assertView();
    });
    await t.test('choosing a different play starts its field at the origin while preserving panel positions',()=>{
      const id=seed.plays[1].id;action(`choose:${id}`);
      assert.equal(q('.pitch-viewport').scrollTop,0);assert.equal(q('.pitch-viewport').scrollLeft,0);
      assert.equal(q('#board-zoom-value').textContent,'200%');
      assert.equal(q('.sidebar').scrollTop,340);assert.equal(q('.play-list').scrollTop,380);
      assert.equal(win.localStorage.getItem('playbook-studio-board-layout-v1'),layout);
    });
  }finally{
    await win.happyDOM.abort();
    for(const n of globals){if(previous[n])Object.defineProperty(globalThis,n,previous[n]);else delete globalThis[n];}
  }
});
