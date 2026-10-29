import test from 'node:test';
import assert from 'node:assert/strict';
import {Window} from 'happy-dom';
import {createMaterialController} from '../web/liquid-materials.js';
import {reconcileHTML} from '../web/reconcile.js';

function fixture(makeEngine){
  const win=new Window({width:390,height:844}),doc=win.document,frames=new Map();let id=0,hidden=false;
  win.requestAnimationFrame=fn=>{frames.set(++id,fn);return id;};win.cancelAnimationFrame=key=>frames.delete(key);
  Object.defineProperty(doc,'hidden',{get:()=>hidden});
  const controller=createMaterialController({doc,makeEngine});
  return {win,doc,controller,frames,step(now){const batch=[...frames.values()];frames.clear();batch.forEach(fn=>fn(now));},visibility(value){hidden=value;doc.dispatchEvent(new win.Event('visibilitychange'));},async close(){controller.destroy();await win.happyDOM.abort();}};
}
test('material mode races reuse one engine and never leave a frame running while off',async()=>{
  let resolve,starts=0,destroyed=0;const draws=[];
  const f=fixture(()=>{starts++;return new Promise(r=>{resolve=r;});});
  try{
    const full=f.controller.setMode('full');await Promise.resolve();
    const repeated=f.controller.setMode('full');await f.controller.setMode('off');
    resolve({draw:x=>draws.push(x),destroy(){destroyed++;}});await Promise.all([full,repeated]);
    assert.equal(starts,1);assert.equal(f.frames.size,0);
    for(let i=0;i<8;i++){
      await f.controller.setMode('full');await f.controller.setMode('full');assert.equal(f.frames.size,1);
      f.step(i*100);assert.equal(f.frames.size,1);
      await f.controller.setMode('off');assert.equal(f.frames.size,0);
    }
    assert.equal(starts,1);assert.equal(draws.length,8);assert.equal(destroyed,0);
  }finally{await f.close();}assert.equal(destroyed,1);
});
test('hidden pages pause material time and pointer feedback does not cancel editor input',async()=>{
  const draws=[];const f=fixture(async()=>({draw:x=>draws.push(x),destroy(){}}));
  try{
    await f.controller.setMode('full');f.step(0);f.step(100);
    const event=new f.win.PointerEvent('pointerdown',{clientX:120,clientY:80,bubbles:true,cancelable:true});
    f.doc.dispatchEvent(event);assert.equal(event.defaultPrevented,false);
    f.step(200);assert.deepEqual(draws.at(-1).pulse,[120,80,.1]);
    f.visibility(true);assert.equal(f.frames.size,0);
    f.visibility(false);assert.equal(f.frames.size,1);f.step(100000);
    assert.equal(draws.at(-1).time,.2);
    f.doc.dispatchEvent(new f.win.CustomEvent('playbook:effects-changed',{detail:{mode:'off'}}));assert.equal(f.frames.size,0);
    f.doc.dispatchEvent(new f.win.CustomEvent('playbook:effects-changed',{detail:{mode:'full'}}));assert.equal(f.frames.size,1);
  }finally{await f.close();}
});
test('disposing an unfinished material startup releases its eventual engine',async()=>{
  let finish,destroyed=0;const f=fixture(()=>new Promise(r=>{finish=r;}));
  const pending=f.controller.setMode('full');await Promise.resolve();f.controller.destroy();
  finish({draw(){throw new Error('must not draw');},destroy(){destroyed++;}});await pending;
  assert.equal(destroyed,1);assert.equal(f.frames.size,0);await f.close();
});
test('render failure releases resources and a later explicit mode change can recover',async()=>{
  let starts=0,destroyed=0;const f=fixture(async()=>{const n=++starts;return{draw(){if(n===1)throw new Error('context lost');},destroy(){destroyed++;}};});
  f.win.console.warn=()=>{};
  try{await f.controller.setMode('full');f.step(0);assert.equal(destroyed,1);assert.equal(f.frames.size,0);assert.equal(f.doc.documentElement.dataset.material,'fallback');await f.controller.setMode('full');f.step(100);assert.equal(starts,2);assert.equal(f.frames.size,1);}finally{await f.close();}
});
test('cloud reconciliation preserves decorative canvases and the focused live card button',async()=>{
  const win=new Window(),previous=Object.getOwnPropertyDescriptor(globalThis,'document');
  Object.defineProperty(globalThis,'document',{configurable:true,value:win.document});
  const root=win.document.createElement('div');win.document.body.append(root);
  const html='<header class="cloud-bar"><button class="workspace-current-card">Book A</button><span class="status">Saved</span></header>';
  try{
    reconcileHTML(root,html);const header=root.firstElementChild,button=header.querySelector('button');button.focus();
    for(const node of [header,button]){const c=win.document.createElement('canvas');c.className='liquid-surface-canvas';node.prepend(c);}
    const canvases=[...root.querySelectorAll('canvas')];
    reconcileHTML(root,html.replace('Book A','Book B').replace('Saved','Saving'));
    assert.ok(root.querySelector('button')===button,'button identity is preserved');assert.ok(win.document.activeElement===button,'focus is preserved');assert.equal(button.textContent,'Book B');
    const after=[...root.querySelectorAll('canvas')];assert.equal(after.length,canvases.length);assert.ok(canvases.every(canvas=>after.includes(canvas)));
  }finally{if(previous)Object.defineProperty(globalThis,'document',previous);else delete globalThis.document;await win.happyDOM.abort();}
});
