import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Window} from 'happy-dom';
import * as THREE from '../web/vendor/three-0.186.0/three.module.js';
import {starterWorkspace,animatedPlayer} from '../web/model.js';
import {fieldSVG,project} from '../web/field.js';
import {projectBoardPoint} from '../web/digital-projection.js';

// Exercise the production scene with actual Three geometry, materials, matrices
// and ray casting. Only GPU submission / environment baking and canvas I/O are
// replaced; this is deliberately not a claim that WebGL pixels were verified.
async function sceneFixture(){
  const win=new Window(),doc=win.document,renders=[],images=[];
  const gradient={addColorStop(){}};
  const context={fillRect(){},clearRect(){},fillText(){},drawImage(){},createLinearGradient(){return gradient;},createRadialGradient(){return gradient;}};
  win.HTMLCanvasElement.prototype.getContext=function(type){assert.equal(type,'2d');return {...context};};
  win.HTMLCanvasElement.prototype.toDataURL=()=> 'data:image/png;base64,c2NlbmU=';
  win.Image=class{set src(url){this.url=url;images.push(this);}};
  const renderer={shadowMap:{},debug:{},capabilities:{getMaxAnisotropy:()=>16},
    setPixelRatio(){},setSize(){},setClearColor(){},setRenderTarget(target){this.target=target;},clear(){},
    render(scene,camera){
      assert.ok(scene.isScene);assert.ok(camera.isPerspectiveCamera);scene.updateMatrixWorld(true);camera.updateMatrixWorld();
      const sprites=[],heads=[];scene.traverse(n=>{if(n.isSprite)sprites.push(n);if(n.material?.isMeshPhysicalMaterial&&n.material.uniforms)heads.push(n);});
      renders.push({scene,camera,target:this.target,sprites:sprites.map(n=>n.visible),heads:heads.map(n=>n.visible)});
    },dispose(){this.disposed=true;},forceContextLoss(){this.lost=true;}};
  const environment={texture:new THREE.Texture(),dispose(){this.disposed=true;}};
  const key=`digitalSceneSmoke${Date.now()}`;
  globalThis[key]={Renderer:class{constructor({canvas}){renderer.canvas=canvas;return renderer;}},PMREM:class{fromEquirectangular(){return environment;}dispose(){}}};
  const url=new URL('../web/digital-materials.js',import.meta.url);
  const source=(await readFile(url,'utf8'))
    .replace(/from '(\.\/[^']+)'/g,(_,path)=>`from '${new URL(path,url).href}'`)
    .replace('new THREE.WebGLRenderer(',`new globalThis.${key}.Renderer(`)
    .replace('new THREE.PMREMGenerator(',`new globalThis.${key}.PMREM(`);
  const {createDigitalMaterials}=await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
  const data=starterWorkspace(),play=data.plays[0],settings=data.settings;
  doc.body.innerHTML=`<div class="pitch-stage">${fieldSVG(play,settings)}</div>`;
  const svg=doc.querySelector('svg'),stage=doc.querySelector('.pitch-stage');
  stage.getBoundingClientRect=()=>({left:70,top:110,width:500,height:400});
  const engine=createDigitalMaterials(doc);
  return {win,doc,engine,svg,stage,play,settings,renderer,renders,images,environment,
    close(){engine.destroy();delete globalThis[key];return win.happyDOM.abort();}};
}

test('complete Three scene mounts, renders refraction and labels, picks a raised head, captures and releases resources',async()=>{
  const f=await sceneFixture(),before=JSON.stringify(f.play);
  try{
    f.engine.mount(f.svg,f.play,f.settings);
    const canvas=f.stage.querySelector('.digital-scene-canvas');assert.ok(canvas);assert.equal(canvas.parentElement,f.stage);assert.equal(f.engine.fullScene,true);
    f.images.shift().onload();
    f.engine.draw({play:f.play,settings:f.settings,time:0,materialTime:1,selected:{type:'player',id:f.play.players[0].id}});
    assert.equal(f.renders.length,2);assert.ok(f.renders[0].target?.isWebGLRenderTarget);assert.equal(f.renders[1].target,null);
    assert.equal(f.renders[1].sprites.length,f.play.players.length);
    assert.ok(f.renders[0].sprites.every(v=>!v));assert.ok(f.renders[1].sprites.every(Boolean),'number sprites survive the refraction pass');
    assert.equal(f.renders[1].heads.length,f.play.players.length);assert.ok(f.renders[0].heads.every(v=>!v));assert.ok(f.renders[1].heads.every(Boolean));
    assert.equal(f.svg.classList.contains('digital-ready'),true);assert.equal(f.stage.classList.contains('is-three'),true);
    const player=f.play.players.find(p=>p.label==='X'),at=project(player),head=projectBoardPoint(at.x,at.y,45);
    assert.deepEqual(f.engine.pick(70+head.x*.5,110+head.y*.5),{type:'player',id:player.id});
    assert.equal(f.engine.pick(70,110),null);
    assert.equal(f.engine.capture(),'data:image/png;base64,c2NlbmU=');
    f.engine.draw({play:f.play,settings:f.settings,time:2,materialTime:2,draggingId:player.id});
    const scene=f.renders.at(-1).scene;
    let body;scene.traverse(n=>{if(n.userData.playerId===player.id)body=n.parent;});
    const moved=project(animatedPlayer(f.play,player,2));assert.equal(body.position.x,moved.x);assert.equal(body.position.y,800-moved.y);assert.ok(body.position.z>0);
    assert.equal(JSON.stringify(f.play),before);
    f.engine.destroy();assert.equal(f.doc.querySelector('.digital-scene-canvas'),null);assert.equal(f.svg.classList.contains('digital-ready'),false);assert.equal(f.stage.classList.contains('is-three'),false);
    assert.equal(f.renderer.disposed,true);assert.equal(f.renderer.lost,true);assert.equal(f.environment.disposed,true);
    assert.equal(f.engine.pick(100,100),null);f.engine.destroy();
  }finally{await f.close();}
});

test('Three player edits, removals and theme remounts update a live scene without stale sprites',async()=>{
  const f=await sceneFixture();
  try{
    f.engine.mount(f.svg,f.play,f.settings);f.images.shift().onload();
    const draw=()=>f.engine.draw({play:f.play,settings:f.settings,time:0,materialTime:1,animated:false});draw();
    const player=f.play.players[0],oldSprites=f.renders.at(-1).sprites.length;
    let oldGroup;f.renders.at(-1).scene.traverse(n=>{if(n.userData.playerId===player.id)oldGroup=n.parent;});
    player.label='T1';player.shape='triangle';player.color='#abcdef';player.side='defense';draw();
    assert.equal(oldGroup.parent,null,'edited piece is replaced, rather than retaining the old number texture');
    assert.equal(f.renders.at(-1).sprites.length,oldSprites);assert.ok(f.renders.at(-1).sprites.every(Boolean));
    player.name='Alex';draw();assert.equal(f.renders.at(-1).sprites.length,oldSprites+1);assert.equal(f.renders.at(-1).sprites.filter(Boolean).length,oldSprites);
    f.settings.showNames=true;draw();assert.ok(f.renders.at(-1).sprites.every(Boolean),'the existing show-names preference remains available');
    f.play.players.shift();draw();assert.equal(f.renders.at(-1).sprites.length,oldSprites-1);
    f.settings.fieldTheme='light';const replacement=f.doc.createElement('div');replacement.innerHTML=fieldSVG(f.play,f.settings);const next=replacement.firstElementChild;f.svg.replaceWith(next);f.engine.mount(next,f.play,f.settings);draw();
    assert.equal(f.svg.classList.contains('digital-ready'),false);assert.equal(next.classList.contains('digital-ready'),true);assert.equal(f.stage.querySelectorAll('.digital-scene-canvas').length,1);
    f.renderer.canvas.dispatchEvent(new f.win.Event('webglcontextlost',{cancelable:true}));
    assert.throws(draw,/3D context is unavailable/);
  }finally{await f.close();}
});
