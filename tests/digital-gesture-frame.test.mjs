import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Window } from 'happy-dom';
import { decodeWorkspace, encodeWorkspace, starterWorkspace, STORAGE_KEY } from '../web/model.js';
import { fieldSVG, project } from '../web/field.js';
import { createDigitalBoard } from '../web/digital-board.js';
import { projectBoardPoint } from '../web/digital-projection.js';

test('captured edits present the latest pointer, linked routes and raised pieces together', {timeout:30000}, async t => {
  const win = new Window({url:'http://localhost:3000/local.html#editor',width:1440,height:1000});
  const doc = win.document;
  doc.body.innerHTML = readFileSync(new URL('../web/index.html',import.meta.url),'utf8').split('<body>')[1].split('</body>')[0];
  const {play} = JSON.parse(readFileSync(new URL('../scripts/bench-digital/mesh.json',import.meta.url),'utf8'));
  const workspace = starterWorkspace();
  workspace.plays[0] = play;
  win.localStorage.setItem(STORAGE_KEY,encodeWorkspace(workspace));
  win.localStorage.setItem('playbook-visual-mode','digital');
  win.localStorage.setItem('playbook-studio:onboarding:v1',JSON.stringify({dismissed:true,completed:[]}));
  win.CanvasRenderingContext2D = class {};

  const frames = new Map();
  let frameId=0, stamp=0;
  win.requestAnimationFrame=callback=>{frames.set(++frameId,callback);return frameId;};
  win.cancelAnimationFrame=id=>frames.delete(id);
  function nextFrame() {
    stamp+=1000/60;
    for(const [id,callback] of [...frames])if(frames.delete(id))callback(stamp);
  }
  for(const name of ['window','document','navigator','localStorage','location','history','Image','Blob','requestAnimationFrame','cancelAnimationFrame']) {
    const original=Object.getOwnPropertyDescriptor(globalThis,name);
    Object.defineProperty(globalThis,name,{configurable:true,value:win[name]});
    t.after(()=>{if(original)Object.defineProperty(globalThis,name,original);else delete globalThis[name];});
  }
  try {
    // Match the production vector fallback: a desktop canvas API without WebGL.
    const ready=new Promise(resolve=>{
      const observer=new win.MutationObserver(()=>{
        if(doc.querySelector('.digital-token-overlay')){observer.disconnect();resolve();}
      });
      observer.observe(doc.body,{subtree:true,childList:true});
    });
    await import('../web/app.js?digital-gesture-frame');
    await ready;
    nextFrame();

    const field=doc.querySelector('#field'),stage=field.querySelector('.pitch-stage');
    const box={left:0,top:0,right:1000,bottom:800,width:1000,height:800};
    let stageReads=0;
    stage.getBoundingClientRect=()=>{stageReads++;return box;};
    const svg=field.querySelector('.pitch-svg');
    svg.getBoundingClientRect=()=>box;
    const marker=p=>svg.querySelector(`[data-player="${p.id}"]`);
    const position=p=>{
      const group=stage.querySelector(`[data-vector-player="${p.id}"]`),label=group.querySelector('text');
      return [group.getAttribute('transform'),label.getAttribute('x'),label.getAttribute('y')];
    };
    function pointer(node,type,player,dx=0) {
      const flat=project({x:player.x+dx,y:player.y}),screen=projectBoardPoint(flat.x,flat.y);
      node.dispatchEvent(new win.PointerEvent(type,{bubbles:true,cancelable:true,button:0,pointerType:'mouse',
        pointerId:1,isPrimary:true,clientX:screen.x,clientY:screen.y}));
    }

    const block=play.routes.find(r=>r.stagedBlock),target=play.players.find(p=>p.id===block.blockTargets[0]);
    const line=()=>svg.querySelector(`[data-route="${block.id}"] .route-stroke`).getAttribute('d');
    pointer(marker(target),'pointerdown',target);
    const originalLine=line(),originalPosition=position(target);
    pointer(field,'pointermove',target,2);
    nextFrame();
    assert.notEqual(line(),originalLine);
    assert.notDeepEqual(position(target),originalPosition,'linked player moves with its route in the first frame');
    pointer(field,'pointercancel',target);
    assert.equal(line(),originalLine);
    assert.deepEqual(position(target),originalPosition);
    assert.equal(doc.querySelector('[data-action="undo"]').disabled,true);

    const free=play.players.find(p=>p.label==='W');
    pointer(marker(free),'pointermove',free);
    nextFrame();
    pointer(marker(free),'pointerdown',free);
    const initialTransform=marker(free).getAttribute('transform'),initialVector=position(free);
    const originalSave=win.localStorage.getItem(STORAGE_KEY);
    stageReads=0;
    for(let i=1;i<=120;i++)pointer(field,'pointermove',free,i/120);
    assert.equal(stageReads,0,'captured samples skip document hover picking');
    assert.equal(marker(free).getAttribute('transform'),initialTransform);
    nextFrame();
    assert.equal(stageReads,1,'the gesture transforms its last sample once');
    assert.notEqual(marker(free).getAttribute('transform'),initialTransform);
    assert.notDeepEqual(position(free),initialVector,'the visible piece uses this same frame');
    assert.equal(frames.size,0,'the free drag has no pending presentation frame');
    assert.equal(win.localStorage.getItem(STORAGE_KEY),originalSave);

    pointer(field,'pointerup',free,12);
    nextFrame();
    const released=position(free);
    pointer(field,'pointermove',free,12);
    nextFrame();
    assert.deepEqual(position(free),released,'a stationary pointer already has the committed hover');
    const saved=()=>decodeWorkspace(win.localStorage.getItem(STORAGE_KEY)).plays[0].players.find(p=>p.id===free.id);
    assert.ok(Math.abs(saved().x-free.x-12)<1e-8,'release commits the most recent pointer');
    doc.querySelector('[data-action="undo"]').click();
    assert.equal(saved().x,free.x);
  } finally {
    win.dispatchEvent(new win.Event('pagehide'));
    await win.happyDOM.abort();
  }
});

test('an editor frame consumes pending WebGL work and refreshes only changed field geometry',async()=>{
  const win=new Window(),doc=win.document;
  const {plays,settings}=starterWorkspace(),state={play:plays[0],settings,time:0};
  doc.body.innerHTML=`<div id="field">${fieldSVG(state.play)}</div>`;
  doc.documentElement.dataset.visualMode='digital';
  win.CanvasRenderingContext2D=class {};
  const draws=[],frames=new Map();
  let sequence=0,materialMoving=false;
  win.requestAnimationFrame=callback=>{frames.set(++sequence,callback);return sequence;};
  win.cancelAnimationFrame=id=>frames.delete(id);
  function tick(stamp){
    for(const [id,callback] of [...frames])if(frames.delete(id))callback(stamp);
  }
  const board=createDigitalBoard({doc,getState:()=>state,makeEngine:async()=>({
    status:'ready',mount(){},destroy(){},draw(view,{refreshTexture}){draws.push(refreshTexture);return materialMoving;}
  })});
  try{
    await board.sync();
    draws.length=0;
    board.invalidate();
    assert.equal(frames.size,1);
    board.presentFrame(16,true);
    assert.deepEqual(draws,[true]);
    assert.equal(frames.size,0);
    board.presentFrame(32,false);
    assert.deepEqual(draws,[true,false]);
    assert.equal(frames.size,0);

    materialMoving=true;
    board.presentFrame(48);
    assert.equal(frames.size,1,'a moving material has an earlier renderer callback');
    win.requestAnimationFrame(stamp=>board.presentFrame(stamp,true));
    board.deferPendingFrame();
    materialMoving=false;
    draws.length=0;
    tick(64);
    assert.deepEqual(draws,[true],'this refresh only presents the new gesture pose');
    assert.equal(frames.size,0);

    board.invalidate();
    win.requestAnimationFrame(()=>{}); // a sample below the drag threshold
    board.deferPendingFrame();
    tick(80);
    assert.deepEqual(draws,[true,false],'a no-op sample still services pending renderer work');
  }finally{board.destroy();await win.happyDOM.abort();}
});
