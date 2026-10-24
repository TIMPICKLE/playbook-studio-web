import test from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { readFileSync } from 'node:fs';
import { initViewportLayout } from '../web/viewport-layout.js';

test('side panel offsets follow the sticky header through wrapping, replacement and mobile layouts', async () => {
  const win = new Window({ url:'http://localhost:3000/editor/', width:1440, height:900 });
  const names=['window','document'], previous=Object.fromEntries(names.map(n=>[n,Object.getOwnPropertyDescriptor(globalThis,n)]));
  for(const n of names)Object.defineProperty(globalThis,n,{configurable:true,value:win[n]});
  win.document.head.innerHTML=`<style>${readFileSync(new URL('../web/board-layout.css',import.meta.url),'utf8')}</style>`;
  win.document.body.className='cloud-enabled';
  win.document.body.innerHTML='<div id="cloud-root"></div><div class="workspace"><aside class="sidebar"><nav></nav></aside></div>';
  const root=win.document.querySelector('#cloud-root'), css=win.document.documentElement.style;
  let resized, observed, disconnected=0;
  const visibleViewport=new win.EventTarget();visibleViewport.height=900;visibleViewport.offsetTop=0;
  Object.defineProperty(win,'visualViewport',{configurable:true,value:visibleViewport});
  win.ResizeObserver=class {
    constructor(callback){resized=callback;}
    observe(node){observed=node;}
    disconnect(){disconnected++;observed=null;}
  };
  const settle=()=>win.happyDOM.whenAsyncComplete();
  const stop=initViewportLayout();
  try {
    assert.equal(css.getPropertyValue('--cloud-height'),'0px');
    assert.equal(root.classList.contains('sticky-cloud-header'),false);
    const header=win.document.createElement('header');header.className='cloud-bar';
    let height=83.25;header.getBoundingClientRect=()=>({height});
    root.append(header);await settle();
    assert.ok(observed===header,'observes the inserted toolbar');assert.equal(css.getPropertyValue('--cloud-height'),'84px');
    height=147;resized();assert.equal(css.getPropertyValue('--cloud-height'),'147px');
    const replacement=header.cloneNode();replacement.getBoundingClientRect=()=>({height:99});
    root.replaceChildren(replacement);await settle();
    assert.ok(observed===replacement,'observes the replacement toolbar');assert.equal(css.getPropertyValue('--cloud-height'),'99px');assert.ok(disconnected>=2);
    win.happyDOM.setWindowSize({width:390,height:844});win.dispatchEvent(new win.Event('resize'));
    assert.equal(css.getPropertyValue('--cloud-height'),'0px');assert.equal(root.classList.contains('sticky-cloud-header'),false);
    win.happyDOM.setWindowSize({width:1024,height:900});win.dispatchEvent(new win.Event('resize'));
    assert.equal(css.getPropertyValue('--cloud-height'),'0px');assert.equal(root.classList.contains('sticky-cloud-header'),false);
    win.happyDOM.setWindowSize({width:1440,height:900});win.dispatchEvent(new win.Event('resize'));
    assert.equal(css.getPropertyValue('--cloud-height'),'99px');assert.equal(root.classList.contains('sticky-cloud-header'),true);
    root.insertAdjacentHTML('beforeend','<section class="cloud-empty"></section>');await settle();
    assert.equal(css.getPropertyValue('--cloud-height'),'0px');assert.equal(root.classList.contains('sticky-cloud-header'),false);
    root.innerHTML='<div class="cloud-local-entry">本地离线预览</div>';await settle();
    assert.equal(css.getPropertyValue('--cloud-height'),'0px');assert.equal(observed,null);
    visibleViewport.height=340;visibleViewport.offsetTop=20;visibleViewport.dispatchEvent(new win.Event('resize'));
    assert.equal(css.getPropertyValue('--visible-height'),'340px');assert.equal(css.getPropertyValue('--visible-top'),'20px');
    visibleViewport.height=900;visibleViewport.offsetTop=0;visibleViewport.dispatchEvent(new win.Event('scroll'));
    assert.equal(css.getPropertyValue('--visible-height'),'900px');assert.equal(css.getPropertyValue('--visible-top'),'0px');
    root.replaceChildren(replacement);await settle();
    assert.equal(win.getComputedStyle(root).position,'sticky');
    assert.equal(win.getComputedStyle(win.document.querySelector('.sidebar')).alignSelf,'start');
    assert.equal(win.getComputedStyle(win.document.querySelector('.sidebar > nav')).flexShrink,'0');
  } finally {
    stop();await win.happyDOM.abort();
    for(const n of names){if(previous[n])Object.defineProperty(globalThis,n,previous[n]);else delete globalThis[n];}
  }
});
