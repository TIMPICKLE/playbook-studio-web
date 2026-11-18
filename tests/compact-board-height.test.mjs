import test from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { createBoardLayout, boardSizeControls, boardHeightHandle, BOARD_LAYOUT_KEY } from '../web/board-layout.js';

test('compact height fits real chrome, short landscape budgets the side controls, and manual sizes survive', async () => {
  const win=new Window({width:375,height:667}),doc=win.document;
  const names=['window','document','localStorage'],previous=new Map(names.map(name=>[name,Object.getOwnPropertyDescriptor(globalThis,name)]));
  for(const name of names)Object.defineProperty(globalThis,name,{configurable:true,value:name==='window'?win:name==='document'?doc:win.localStorage});
  try {
    doc.body.innerHTML=`<nav class="workspace-nav"></nav><div class="workspace"><main>${boardSizeControls()}<div id="field"><div class="pitch-viewport"><div class="pitch-stage"></div></div></div><div class="stage-dock"><div class="editor-mode"></div></div>${boardHeightHandle}</main><nav class="compact-nav"></nav></div>`;
    const short=()=>win.innerWidth>600&&win.innerHeight<=500;
    const rect=(top,height)=>({left:0,right:300,top,bottom:top+height,width:300,height});
    doc.querySelector('.workspace-nav').getBoundingClientRect=()=>rect(0,53);
    doc.querySelector('#field').getBoundingClientRect=()=>rect(short()?59:275,200);
    doc.querySelector('.stage-dock').getBoundingClientRect=()=>rect(0,short()?0:96);
    doc.querySelector('.compact-nav').getBoundingClientRect=()=>rect(0,short()?53:66);
    doc.querySelector('.editor-mode').getBoundingClientRect=()=>rect(0,44);
    const layout=createBoardLayout();layout.mount();
    assert.equal(layout.getState().height,200,'a 280px floor must not cover tools on a 375x667 view');
    assert.equal(doc.querySelector('#board-height').min,'200');
    assert.equal(doc.querySelector('[data-board-resize]').getAttribute('aria-valuemin'),'200');
    layout.setState({height:600});
    assert.equal(layout.getState().height,600,'manual long-board intent remains available');
    win.happyDOM.setWindowSize({width:844,height:390});layout.mount();
    assert.equal(layout.getState().height,600,'rotation does not erase explicit sizing');
    layout.setState({reset:true});
    assert.equal(layout.getState().height,224,'landscape reserves 53px navigation, 53px bottom bar, 44px mode, 16px spacing');
    layout.setState({height:200});
    win.happyDOM.setWindowSize({width:1440,height:900});layout.mount();
    assert.equal(layout.getState().height,280,'desktop regains its minimum without corrupting the saved mobile preference');
    assert.equal(JSON.parse(win.localStorage.getItem(BOARD_LAYOUT_KEY)).height,200);
    win.happyDOM.setWindowSize({width:390,height:844});layout.mount();
    assert.equal(layout.getState().height,200);
  } finally {
    await win.happyDOM.abort();for(const name of names){const value=previous.get(name);if(value)Object.defineProperty(globalThis,name,value);else delete globalThis[name];}
  }
});

test('advanced size defaults closed in short landscape and closes through rotation, Escape and outside interaction', async () => {
  const win=new Window({width:1440,height:900}),doc=win.document;
  const names=['window','document','localStorage'],previous=new Map(names.map(name=>[name,Object.getOwnPropertyDescriptor(globalThis,name)]));
  for(const name of names)Object.defineProperty(globalThis,name,{configurable:true,value:name==='window'?win:name==='document'?doc:win.localStorage});
  try {
    doc.body.innerHTML=`<div class="workspace">${boardSizeControls()}<div class="pitch-viewport"><div class="pitch-stage"></div></div><button id="outside">Drawing tool</button></div>`;
    win.localStorage.setItem(BOARD_LAYOUT_KEY,JSON.stringify({height:200,expandedHeight:210}));
    const layout=createBoardLayout();layout.mount();
    const panel=()=>doc.querySelector('.board-advanced');
    const open=()=>{panel().open=true;panel().dispatchEvent(new win.Event('toggle'));};
    const rotate=(width,height)=>{win.happyDOM.setWindowSize({width,height});win.dispatchEvent(new win.Event('resize'));};
    assert.equal(panel().open,true,'desktop dimensions remain inline');
    doc.querySelector('[data-board-action="zoom-in"]').click();
    assert.equal(layout.getState().height,280,'desktop clamps the displayed height');
    assert.deepEqual(JSON.parse(win.localStorage.getItem(BOARD_LAYOUT_KEY)),{height:200,expandedHeight:210},'zoom after a desktop reload preserves stored narrow dimensions');
    rotate(375,667);assert.equal(panel().open,false);
    assert.equal(layout.getState().height,200);
    layout.setState({expanded:true});assert.equal(layout.getState().height,210);
    layout.setState({expanded:false});
    open();assert.equal(panel().open,true);layout.mount();assert.equal(panel().open,true,'an explicit opening survives an ordinary rerender');
    rotate(844,390);assert.equal(panel().open,false,'portrait open state must not cover the landscape tools');
    open();panel().querySelector('summary').focus();
    panel().dispatchEvent(new win.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
    assert.equal(panel().open,false);assert.equal(doc.activeElement,panel().querySelector('summary'));
    open();doc.querySelector('#outside').click();assert.equal(panel().open,false);
    rotate(1440,900);assert.equal(panel().open,true);
    rotate(844,390);assert.equal(panel().open,false,'direct desktop to short landscape also collapses');
    open();layout.setState({reset:true});assert.equal(panel().open,false,'reset returns to the current viewport default');
    const detached=panel();detached.remove();doc.querySelector('.workspace').insertAdjacentHTML('afterbegin',boardSizeControls());layout.mount();
    detached.open=true;detached.dispatchEvent(new win.Event('toggle',{bubbles:true}));layout.mount();
    assert.equal(panel().open,false,'queued events from detached controls cannot reopen the current panel');
  } finally {
    await win.happyDOM.abort();for(const name of names){const value=previous.get(name);if(value)Object.defineProperty(globalThis,name,value);else delete globalThis[name];}
  }
});
