import test from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { createDigitalBoard } from '../web/digital-board.js';
import { boardCSSMatrix } from '../web/digital-projection.js';
import { fieldSVG } from '../web/field.js';
import { starterWorkspace } from '../web/model.js';

async function fixture(t,observeSize){
  const win=new Window(),doc=win.document;
  const {plays,settings}=starterWorkspace(),state={play:plays[0],settings,time:0};
  let notifyResize,frame,hidden=false;
  win.ResizeObserver=observeSize?class {
    constructor(callback){notifyResize=callback;}
    observe(){} disconnect(){}
  }:undefined;
  win.CanvasRenderingContext2D=class {};
  win.requestAnimationFrame=callback=>{frame=callback;return 1;};
  win.cancelAnimationFrame=()=>{frame=null;};
  Object.defineProperty(doc,'hidden',{get:()=>hidden});
  doc.documentElement.dataset.visualMode='digital';
  doc.body.innerHTML=`<div id="field"><div class="pitch-stage">${fieldSVG(state.play)}</div></div>`;
  const stage=doc.querySelector('.pitch-stage'),size={width:800,height:640},reads={width:0,height:0};
  Object.defineProperties(stage,{
    clientWidth:{get(){reads.width++;return size.width;}},
    clientHeight:{get(){reads.height++;return size.height;}}
  });
  const board=createDigitalBoard({doc,getState:()=>state,makeEngine:async()=>({
    status:'ready',mount(){},draw(){},destroy(){}
  })});
  t.after(async()=>{board.destroy();await win.happyDOM.abort();});
  await board.sync();
  const assertMatrix=()=>assert.equal(stage.style.getPropertyValue('--board-projection'),boardCSSMatrix(size.width,size.height));
  const visible=value=>{hidden=!value;doc.dispatchEvent(new win.Event('visibilitychange'));};
  return {board,size,reads,win,assertMatrix,visible,resizeStage:notifyResize,paint:()=>frame?.(16)};
}

test('ordinary digital frames reuse stage dimensions through drag, playback and export',async t=>{
  const f=await fixture(t,true);
  f.assertMatrix();
  assert.deepEqual(f.reads,{width:1,height:1});
  for(let i=0;i<120;i++)f.board.presentFrame(i*1000/60);
  f.board.capture();
  assert.deepEqual(f.reads,{width:1,height:1});

  f.size.width=900;f.size.height=712;
  f.resizeStage();
  f.win.dispatchEvent(new f.win.Event('resize'));
  f.paint();f.assertMatrix();
  assert.deepEqual(f.reads,{width:2,height:2},'element and window signals coalesce');

  f.size.height=720;f.resizeStage();
  f.board.capture();f.assertMatrix();
  f.paint();
  assert.deepEqual(f.reads,{width:3,height:3},'export can consume a pending resize before the next frame');

  f.visible(false);f.size.width=1000;
  f.board.presentFrame(2500);
  f.visible(true);f.assertMatrix();
  assert.deepEqual(f.reads,{width:4,height:4},'returning to a visible board remeasures once');
});

test('without ResizeObserver a CSS-only stage resize is reflected on the next frame',async t=>{
  const f=await fixture(t,false);
  f.size.width=700;f.size.height=590;
  f.board.presentFrame(16);
  f.assertMatrix();
  assert.deepEqual(f.reads,{width:2,height:2});
});
