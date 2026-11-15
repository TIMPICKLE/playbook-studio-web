import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Window } from 'happy-dom';
import { STORAGE_KEY, decodeWorkspace, encodeWorkspace, starterWorkspace } from '../web/model.js';

let fixtureId = 0;
async function fixture(t, {width=1440, raw=encodeWorkspace(starterWorkspace()), native=true}={}) {
  const win = new Window({url:'http://localhost:3000/local.html', width, height:1000});
  win.document.body.innerHTML=readFileSync(new URL('../web/index.html',import.meta.url),'utf8').split('<body>')[1].split('</body>')[0];
  win.localStorage.setItem(STORAGE_KEY,raw);
  if (!native) win.HTMLDialogElement.prototype.showModal=undefined;
  const names=['window','document','navigator','localStorage','location','history','Image','Blob','requestAnimationFrame','cancelAnimationFrame'];
  const previous=Object.fromEntries(names.map(name=>[name,Object.getOwnPropertyDescriptor(globalThis,name)]));
  for(const name of names)Object.defineProperty(globalThis,name,{configurable:true,value:['requestAnimationFrame','cancelAnimationFrame'].includes(name)?win[name].bind(win):win[name]});
  t.after(async()=>{
    await win.happyDOM.abort();
    for(const name of names){if(previous[name])Object.defineProperty(globalThis,name,previous[name]);else delete globalThis[name];}
  });
  await import(`../web/app.js?editor-dialog=${++fixtureId}`);
  const q=selector=>win.document.querySelector(selector);
  const click=action=>{const node=q(`[data-action="${action}"]`);assert.ok(node,action);node.click();};
  const key=(node,value,extra={})=>{
    const event=new win.KeyboardEvent('keydown',{key:value,bubbles:true,cancelable:true,...extra});
    node.dispatchEvent(event);return event;
  };
  return {win,q,click,key,saved:()=>win.localStorage.getItem(STORAGE_KEY),data:()=>decodeWorkspace(win.localStorage.getItem(STORAGE_KEY))};
}

test('IME candidate confirmation never saves a new play, custom formation or text annotation',async t=>{
  const f=await fixture(t);
  const scenarios=[
    {open:()=>f.click('new'),input:'#new-title',value:'浅交叉',count:data=>data.plays.length},
    {open:()=>f.click('save-formation'),input:'#formation-name',value:'四三防守',count:data=>data.formations.length},
    {open:()=>{
      f.click('tool:text');
      const svg=f.q('#field svg');
      svg.getBoundingClientRect=()=>({left:0,top:0,width:1000,height:800});
      svg.dispatchEvent(new f.win.PointerEvent('pointerdown',{bubbles:true,cancelable:true,button:0,pointerId:1,clientX:600,clientY:300}));
      f.q('#field').dispatchEvent(new f.win.PointerEvent('pointerup',{bubbles:true,cancelable:true,button:0,pointerId:1,clientX:600,clientY:300}));
    },input:'#annotation-text',value:'观察弱侧',count:data=>data.plays.at(-1).annotations.length},
  ];
  for(const scenario of scenarios){
    scenario.open();
    const input=f.q(scenario.input);assert.ok(input,scenario.input);input.value=scenario.value;
    const before=f.saved(),count=scenario.count(f.data());
    for(const composition of [{isComposing:true},{isComposing:false,keyCode:229}]){
      for(const key of ['Enter','Escape']){
        const event=f.key(input,key,composition);
        assert.equal(event.defaultPrevented,false,'IME keeps its own candidate confirmation/cancellation');
        assert.ok(f.q('dialog.editor-dialog[open]'),'composition does not dismiss the dialog');
        assert.equal(f.saved(),before,'composition never creates a history or storage write');
      }
    }
    f.key(input,'Enter');
    assert.equal(f.q('.modal'),null,'ordinary Enter still confirms the dialog');
    assert.equal(scenario.count(f.data()),count+1,scenario.input);
  }
});

test('native cancel and close share cleanup, keep browser modality, and restore the original opener',async t=>{
  const f=await fixture(t),opener=f.q('[data-action="new"]');opener.focus();f.click('new');
  const dialog=f.q('dialog.editor-dialog');
  assert.equal(dialog.open,true);assert.equal(dialog.dataset.nativeModal,'true');
  assert.ok(dialog.getAttribute('aria-label'));
  assert.equal(f.q('.modal').getAttribute('role'),null,'only the native outer dialog owns dialog semantics');
  assert.equal(f.q('#app').inert,false,'native modality does not write app inert state');
  assert.equal(f.win.document.activeElement.id,'new-title');
  const cancel=new f.win.Event('cancel',{cancelable:true});dialog.dispatchEvent(cancel);
  assert.equal(cancel.defaultPrevented,true,'cancel is routed through app cleanup');
  assert.equal(f.q('.modal'),null);assert.equal(f.win.document.body.classList.contains('modal-open'),false);
  assert.ok(f.win.document.activeElement===opener,'native cancellation returns to the opener');

  let closed=0;f.win.document.addEventListener('playbook:modal-closed',()=>closed++);
  f.click('print');assert.ok(f.q('#print-root .print-card'));
  f.q('dialog.editor-dialog').close();
  assert.equal(f.q('.modal'),null);assert.equal(f.q('#print-root').childElementCount,0);
  assert.equal(closed,1,'native close only dispatches one lifecycle completion');
});

test('a delayed close event from a replaced recovery step cannot dismiss the new step',async t=>{
  const f=await fixture(t,{raw:'{"partiallyRecoverable":'}),previous=f.q('dialog.editor-dialog');
  assert.ok(previous?.open);
  f.click('replace-local-workspace');
  const next=f.q('dialog.editor-dialog');assert.ok(next&&next!==previous);
  previous.dispatchEvent(new f.win.Event('close'));
  assert.ok(f.q('dialog.editor-dialog')===next,'the replacement still owns the modal root');
  assert.ok(f.q('[data-action="confirm-replace-local-workspace"]'));
  f.click('local-recovery');
  assert.ok(f.q('dialog.editor-dialog[open]'));
  f.q('dialog.editor-dialog').dispatchEvent(new f.win.Event('cancel',{cancelable:true}));
  assert.equal(f.q('.modal'),null);assert.equal(f.saved(),'{"partiallyRecoverable":');
});

test('closing a native dialog inside a mobile drawer preserves drawer focus and inert state',async t=>{
  const f=await fixture(t,{width:390});
  f.q('.compact-nav [data-action="sidebar"]').click();
  const opener=f.q('.sidebar [data-action="new"]');opener.focus();opener.click();
  assert.ok(f.q('dialog.editor-dialog[open]'));
  f.q('dialog.editor-dialog').dispatchEvent(new f.win.Event('cancel',{cancelable:true}));
  assert.equal(f.q('.modal'),null);
  assert.equal(f.q('.sidebar').inert,false);assert.equal(f.q('.main').inert,true);
  assert.ok(f.win.document.activeElement===opener);
});

test('without showModal the fallback isolates all background roots and restores their prior inert state',async t=>{
  const f=await fixture(t,{native:false}),background=f.q('#cloud-root');
  background.inert=true;
  f.click('new');
  assert.equal(f.q('dialog.editor-dialog').dataset.nativeModal,'false');
  for(const selector of ['#app','#cloud-root','.locale-control'])assert.equal(f.q(selector).inert,true,selector);
  const first=f.q('.modal header button'),last=f.q('.modal footer .primary');
  first.focus();f.key(first,'Tab',{shiftKey:true});assert.ok(f.win.document.activeElement===last);
  f.key(last,'Escape');
  assert.equal(f.q('.modal'),null);assert.equal(f.q('#app').inert,false);
  assert.equal(f.q('.locale-control').inert,false);assert.equal(background.inert,true,'pre-existing inert is retained');
});
