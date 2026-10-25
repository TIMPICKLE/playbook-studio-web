import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Window } from 'happy-dom';
import { createDigitalFallback, fallbackMesh } from '../web/digital-fallback.js';
import { projectBoardPoint } from '../web/digital-projection.js';
import { fieldSVG, project, updateAnimation } from '../web/field.js';
import { movePlayer, starterWorkspace } from '../web/model.js';

function fixture(markup='<svg class="pitch-svg" xmlns="http://www.w3.org/2000/svg"></svg>'){
  const win=new Window(),doc=win.document;
  doc.body.innerHTML=`<div class="pitch-stage">${markup}</div>`;
  const stage=doc.querySelector('.pitch-stage'),svg=doc.querySelector('.pitch-svg');
  stage.getBoundingClientRect=()=>({left:70,top:110,width:500,height:400});
  const renderer=createDigitalFallback(doc);renderer.mount(svg);
  return {win,doc,stage,svg,renderer};
}

test('fallback chips use tall closed three-dimensional mesh surfaces for every symbol',()=>{
  for(const shape of ['circle','square','triangle']){
    const mesh=fallbackMesh(shape);assert.ok(mesh.length>25);
    const heights=mesh.flatMap(f=>f.vertices.map(v=>v[2]));
    assert.equal(Math.min(...heights),0);assert.ok(Math.max(...heights)>=42);
    for(const face of mesh){assert.equal(face.vertices.length,4);assert.ok(face.vertices.flat().every(Number.isFinite));assert.ok(Math.abs(Math.hypot(...face.normal)-1)<1e-10);}
  }
  assert.notEqual(fallbackMesh('circle').length,fallbackMesh('triangle').length);
});

test('fallback follows shared animation without mutating data, retains labels and picks the raised head after zoom/scroll',()=>{
  const f=fixture(),play=starterWorkspace().plays[0],before=JSON.stringify(play);
  f.renderer.draw({play,time:0,settings:{},selected:{type:'player',id:play.players[0].id}});
  assert.equal(f.doc.querySelectorAll('[data-vector-player]').length,11);
  assert.equal(f.svg.classList.contains('digital-fallback-ready'),true);
  const p=play.players.find(p=>p.label==='X'),at=project(p),head=projectBoardPoint(at.x,at.y,42);
  assert.deepEqual(f.renderer.pick(70+head.x*.5,110+head.y*.5),{type:'player',id:p.id});
  assert.equal(f.renderer.pick(70,110),null);
  const first=f.doc.querySelector(`[data-vector-player="${p.id}"] path`).getAttribute('d');
  f.renderer.draw({play,time:2,settings:{}});
  assert.notEqual(f.doc.querySelector(`[data-vector-player="${p.id}"] path`).getAttribute('d'),first);
  f.renderer.draw({play,time:0,settings:{}});
  assert.equal(f.doc.querySelector(`[data-vector-player="${p.id}"] path`).getAttribute('d'),first);
  assert.equal(JSON.stringify(play),before);
  assert.equal(f.renderer.capture(),null,'vector fallback does not pretend to provide a WebGL PNG');
  f.renderer.destroy();assert.equal(f.doc.querySelector('.digital-token-overlay'),null);assert.equal(f.svg.classList.contains('digital-fallback-ready'),false);
});

test('fallback redraws colors, symbol shape and label changes and removes deleted players',()=>{
  const f=fixture(),play=starterWorkspace().plays[0];
  f.renderer.draw({play,settings:{},time:0});
  const p=play.players[0],old=f.doc.querySelector(`[data-vector-player="${p.id}"]`);
  p.shape='square';p.color='#abcdef';p.label='T1';
  f.renderer.draw({play,settings:{fieldTheme:'light'},time:0});
  const next=f.doc.querySelector(`[data-vector-player="${p.id}"]`);assert.notEqual(next,old);assert.equal(next.querySelector('text').textContent,'T1');
  play.players.shift();f.renderer.draw({play,settings:{},time:0});assert.equal(f.doc.querySelectorAll('[data-vector-player]').length,10);
  f.renderer.destroy();
});

test('fallback keeps its rendered pieces when remounting a patched or replaced field',()=>{
  const f=fixture(),play=starterWorkspace().plays[0];
  f.renderer.draw({play,settings:{},time:0});
  const overlay=f.doc.querySelector('.digital-token-overlay'),player=overlay.querySelector('[data-vector-player]');
  const paths=[...player.querySelectorAll('path')],geometry=paths.map(path=>path.getAttribute('d'));
  f.renderer.mount(f.svg);
  assert.ok(f.doc.querySelector('.digital-token-overlay')===overlay,'mounting the same field must keep its existing image');
  const next=f.svg.cloneNode(false);f.svg.replaceWith(next);f.renderer.mount(next);
  assert.ok(overlay.parentNode===f.stage);assert.ok(overlay.querySelector('[data-vector-player]')===player);
  assert.ok([...player.querySelectorAll('path')].every((path,i)=>path===paths[i]),'route edits must not rebuild player meshes');
  assert.deepEqual(paths.map(path=>path.getAttribute('d')),geometry,'the last complete image must exist before another draw');
  assert.equal(f.svg.classList.contains('digital-fallback-ready'),false);assert.equal(next.classList.contains('digital-fallback-ready'),true);
  const p=play.players.find(p=>p.id===player.getAttribute('data-vector-player'));movePlayer(play,p.id,p.x+5,p.y);f.renderer.draw({play,settings:{},time:0});
  assert.ok(overlay.querySelector('[data-vector-player]')===player);assert.notEqual(paths[0].getAttribute('d'),geometry[0]);
  f.renderer.destroy();assert.equal(f.doc.querySelector('.digital-token-overlay'),null);assert.equal(next.classList.contains('digital-fallback-ready'),false);
});

test('fallback migrates its complete image and picking to a replacement stage before drawing',()=>{
  const f=fixture(),play=starterWorkspace().plays[0],p=play.players.find(p=>p.label==='X');
  f.renderer.draw({play,settings:{},time:0});
  const overlay=f.doc.querySelector('.digital-token-overlay'),image=overlay.innerHTML;
  const nextStage=f.doc.createElement('div');nextStage.className='pitch-stage';nextStage.append(f.svg.cloneNode(false));f.doc.body.append(nextStage);
  nextStage.getBoundingClientRect=()=>({left:135,top:240,width:750,height:600});
  const next=nextStage.querySelector('.pitch-svg');f.renderer.mount(next);
  assert.ok(nextStage.querySelector('.digital-token-overlay')===overlay);assert.equal(overlay.innerHTML,image);
  assert.equal(f.stage.classList.contains('is-fallback'),false);assert.equal(nextStage.classList.contains('is-fallback'),true);
  const at=project(p),head=projectBoardPoint(at.x,at.y,42);
  assert.deepEqual(f.renderer.pick(135+head.x*.75,240+head.y*.75),{type:'player',id:p.id});
  f.renderer.destroy();assert.equal(nextStage.querySelector('.digital-token-overlay'),null);assert.equal(nextStage.classList.contains('is-fallback'),false);
});

test('fallback preserves the existing optional player name once and leaves it attached to animation',()=>{
  const play=starterWorkspace().plays[0],p=play.players.find(p=>p.label==='X');p.name='Alex Rivers';
  const settings={showNames:true},f=fixture(fieldSVG(play,settings));
  const style=f.doc.createElement('style');style.textContent=readFileSync(new URL('../web/visual-mode.css',import.meta.url),'utf8');f.doc.head.append(style);
  f.renderer.draw({play,settings,time:0});
  const token=f.svg.querySelector(`[data-player="${p.id}"]`),name=[...token.querySelectorAll('text')].find(n=>n.textContent===p.name);
  assert.ok(name,'the source SVG supplies the name outside the hidden body and position label');
  assert.equal(f.win.getComputedStyle(token.querySelector('.player-label')).opacity,'0');
  assert.notEqual(f.win.getComputedStyle(name).opacity,'0');
  assert.equal([...f.doc.querySelectorAll('text')].filter(n=>n.textContent===p.name).length,1,'the overlay must not duplicate the existing name');
  const before=token.getAttribute('transform');updateAnimation(f.svg,play,2);f.renderer.draw({play,settings,time:2});
  assert.notEqual(token.getAttribute('transform'),before);assert.equal(name.closest('[data-player]'),token);
  f.renderer.destroy();
  const hidden=fixture(fieldSVG(play,{showNames:false}));hidden.renderer.draw({play,settings:{showNames:false}});
  assert.equal([...hidden.doc.querySelectorAll('text')].some(n=>n.textContent===p.name),false);hidden.renderer.destroy();
});
