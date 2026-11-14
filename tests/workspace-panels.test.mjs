import test from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { createWorkspacePanels } from '../web/workspace-panels.js';

test('large iPad touch panels stay accessible through rotation and pointer changes', async () => {
  const win=new Window({width:1366,height:1024});
  const saved=Object.fromEntries(['window','document'].map(name=>[name,Object.getOwnPropertyDescriptor(globalThis,name)]));
  for(const name of ['window','document'])Object.defineProperty(globalThis,name,{configurable:true,value:win[name]});
  const media=new win.EventTarget();media.matches=true;
  win.matchMedia=()=>media;
  win.document.body.innerHTML=`<div id="cloud-root"></div><div class="workspace">
    <aside class="sidebar"><button class="panel-close">Close plays</button></aside>
    <main id="main-content"><section class="canvas-section"></section><div class="inspector-panel"><button class="panel-close">Close properties</button></div></main>
    <nav class="compact-nav"><button data-action="sidebar">Plays</button><button data-action="panel-field">Field</button><button data-action="inspector-panel">Properties</button></nav>
    </div><section class="board-ai ba-floating"><textarea></textarea></section>`;
  const q=s=>win.document.querySelector(s);
  try {
    const panels=createWorkspacePanels();panels.mount();
    assert.equal(q('.sidebar').inert,true);
    assert.equal(q('.inspector-panel').inert,true);
    panels.toggle('properties');
    assert.equal(q('.inspector-panel').getAttribute('aria-modal'),'true');
    assert.equal(q('.canvas-section').inert,true);
    assert.equal(q('.board-ai').inert,true,'portaled AI is part of the modal background');
    win.happyDOM.setWindowSize({width:1024,height:1366});win.dispatchEvent(new win.Event('resize'));
    assert.equal(panels.active,'properties','rotation keeps the active touch panel');
    win.happyDOM.setWindowSize({width:1366,height:1024});win.dispatchEvent(new win.Event('resize'));
    assert.equal(q('.inspector-panel').inert,false);
    media.matches=false;media.dispatchEvent(new win.Event('change'));
    assert.equal(panels.active,null);
    assert.equal(q('.sidebar').inert,false,'a fine-pointer desktop retains its columns');
    assert.equal(q('.board-ai').inert,false);
    media.matches=true;media.dispatchEvent(new win.Event('change'));
    assert.equal(q('.sidebar').inert,true,'a touch device switches without requiring a resize');
    panels.toggle('plays');panels.close();
    assert.equal(q('#main-content').inert,false);
  } finally {
    await win.happyDOM.abort();
    for(const name of ['window','document']){if(saved[name])Object.defineProperty(globalThis,name,saved[name]);else delete globalThis[name];}
  }
});
