import test from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { Vector3 } from '../web/vendor/three-0.186.0/three.module.js';
import { trainingDemo } from '../web/training-demo.js';
import { createTrainingField } from '../web/training-field.js';
import { createTrainingWorld } from '../web/training-field-pov.js';

const base={time:0,selectedIds:[],correctIds:[],picking:true,revealed:false};

test('both paired pre-snap targets are hittable from the same QB camera',()=>{
  const {plays,drills}=trainingDemo(), visible=[];
  for(const play of plays){
    const world=createTrainingWorld({play,cameraId:'qb',losY:67});
    try {
      world.resize(800,430);world.update(base);
      const seen=world.visibleIds();visible.push(seen);
      assert(drills[0].targetIds.every(id=>seen.includes(id)));
      assert(!seen.includes('qb'));
      assert.deepEqual(world.camera.position.toArray().map(x=>+x.toFixed(2)),[0,1.76,10.22]);
      world.turn(.3); world.resetLook();
      assert.deepEqual(world.visibleIds(),seen);
      world.update({...base,time:1.8,revealed:true,correctIds:['will','mike']});
      assert(world.camera.position.z>10.22,'Replaying follows the moving camera marker');
    }finally{world.dispose();}
  }
  assert.deepEqual(visible[0],visible[1]);
});

test('the first intersected uniform blocks a defender behind it',()=>{
  const {plays}=trainingDemo(), play=structuredClone(plays[0]);
  play.players=play.players.filter(p=>['qb','lt','will'].includes(p.id));
  play.routes=[];
  // Collinear, nearly identical silhouettes, but the offensive blocker is nearer.
  Object.assign(play.players.find(p=>p.id==='lt'),{label:'WR',x:50,y:74});
  Object.assign(play.players.find(p=>p.id==='will'),{x:50,y:42});
  const w=createTrainingWorld({play,cameraId:'qb'});
  try {
    w.resize(720,400);w.update(base);
    const target=new Vector3(0,1.68,(42-50)*.365).project(w.camera);
    assert.equal(w.pick(target.x,target.y),'lt');
    assert(!w.visibleIds(true).includes('will'));
  }finally {w.dispose();}
});

test('overhead fallback hides answers, supports keyboard selection, and stops accepting input on reveal',()=>{
  const win=new Window(), root=win.document.createElement('div'), chosen=[], modes=[];
  Object.defineProperty(win.navigator,'userAgent',{value:'iPhone Mobile'});
  win.document.body.append(root);
  const {plays}=trainingDemo(), field=createTrainingField({root,play:plays[0],cameraId:'qb',onPick:id=>chosen.push(id),onModeChange:mode=>modes.push(mode)});
  try {
    field.setState({...base,mode:'pov',correctIds:['will','mike']});
    assert.equal(field.supportsPOV,false);assert.deepEqual(modes,['field']);
    const node=root.querySelector('[data-training-marker="will"]');
    assert.equal(node.getAttribute('tabindex'),'0');assert.doesNotMatch(node.getAttribute('aria-label'),/WILL|\bW\b/i);
    node.dispatchEvent(new win.KeyboardEvent('keydown',{key:'Enter',bubbles:true}));
    assert.deepEqual(chosen,['will']);
    const friendly=root.querySelector('[data-training-marker="c"]');
    friendly.dispatchEvent(new win.MouseEvent('click',{bubbles:true}));
    assert.deepEqual(chosen,['will']);
    assert.equal(root.querySelectorAll('[stroke-dasharray="5 4"]').length,0);
    field.setState({...base,revealed:true,picking:false,time:1.8,correctIds:['will','mike']});
    assert.equal(node.getAttribute('tabindex'),'-1');assert.match(node.getAttribute('aria-label'),/ W$/);
    assert.equal(root.querySelectorAll('[stroke-dasharray="5 4"]').length,2);
    node.dispatchEvent(new win.KeyboardEvent('keydown',{key:'Enter'}));
    assert.deepEqual(chosen,['will']);
    field.destroy();assert.equal(root.childNodes.length,0);
  } finally {win.close();}
});

test('desktop without WebGL keeps the eye-level projection, drag/keyboard look and target picks',async()=>{
  const win=new Window(),root=win.document.createElement('div'), modes=[],picks=[];
  win.document.body.append(root);
  const {plays}=trainingDemo();
  const field=createTrainingField({root,play:plays[0],cameraId:'qb',direction:'up',onModeChange:m=>modes.push(m),onPick:id=>picks.push(id)});
  try{
    assert.equal(field.supportsPOV,true);
    field.setState({...base,mode:'pov'});
    for(let i=0;i<30&&!modes.length;i++)await new Promise(res=>setTimeout(res,5));
    const pov=root.querySelector('[data-training-renderer="projected"]');assert(pov);
    assert.equal(pov.getAttribute('viewBox'),'0 0 800 450');
    assert.deepEqual(modes,['pov']);assert(field.getVisibleIds().includes('will'));
    const helmet=pov.querySelector('[data-pov-player="will"] ellipse[fill]');
    const center=()=>[helmet.getAttribute('cx'),helmet.getAttribute('cy')];
    const initial=center();
    pov.dispatchEvent(new win.KeyboardEvent('keydown',{key:'ArrowRight'}));assert.notDeepEqual(center(),initial);
    field.resetLook();assert.deepEqual(center(),initial);
    // pick at the projected middle of an exposed target's equipment
    pov.getBoundingClientRect=()=>({left:0,top:0,width:800,height:450});
    const [x,y]=initial.map(Number);
    for(const type of ['pointerdown','pointerup'])pov.dispatchEvent(new win.PointerEvent(type,{clientX:x,clientY:y,button:0,pointerId:1}));
    assert.deepEqual(picks,['will']);
    field.setState({...base,time:1.8,mode:'pov',selectedIds:['will'],correctIds:['will','mike'],revealed:true,picking:false});
    assert.notDeepEqual(center(),initial);
    field.setState({mode:'field'});assert.equal(modes.at(-1),'field');
    field.setState({mode:'pov'});assert.equal(modes.at(-1),'pov');assert.equal(root.querySelector('[data-training-renderer]'),pov);
  }finally{field.destroy();win.close();}
});
