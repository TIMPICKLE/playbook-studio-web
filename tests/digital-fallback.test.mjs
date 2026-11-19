import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Window } from 'happy-dom';
import { createDigitalFallback, fallbackMesh } from '../web/digital-fallback.js';
import { FOCUS_RADIUS, PIECE_HEIGHT, focusInk, puckPalette } from '../web/digital-puck.js';
import { BOARD_CAMERA, projectBoardPoint, projectWorldPoint } from '../web/digital-projection.js';
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

test('fallback selection rings represent the same multiple-player selection as the traditional field',()=>{
  const f=fixture(),play=starterWorkspace().plays[0],ids=play.players.slice(0,2).map(player=>player.id);
  try {
    f.renderer.draw({play,settings:{},time:0,selected:{type:'players',ids}});
    const active=[...f.doc.querySelectorAll('[data-vector-player]')].filter(node=>node.querySelector('path[opacity="0.9"]')).map(node=>node.dataset.vectorPlayer);
    assert.deepEqual(new Set(active),new Set(ids));
    f.renderer.draw({play,settings:{fieldTheme:'light'},time:0,selected:{type:'players',ids}});
    assert.ok([...f.doc.querySelectorAll('path[opacity="0.9"]')].every(r=>r.getAttribute('stroke')===focusInk('light')));
    f.renderer.draw({play,settings:{},time:0,selected:null});
    assert.equal(f.doc.querySelectorAll('path[opacity="0.9"]').length,0);
  }finally{f.renderer.destroy();f.win.happyDOM.abort();}
});

test('a stationary fallback frame performs no DOM writes, selection changes only the focus ring',()=>{
  const f=fixture(),play=starterWorkspace().plays[0],view={play,settings:{},time:0};
  const observer=new f.win.MutationObserver(()=>{});
  try{
    f.renderer.draw(view);
    const overlay=f.doc.querySelector('.digital-token-overlay');
    observer.observe(overlay,{childList:true,attributes:true,subtree:true});
    f.renderer.draw(view);assert.equal(observer.takeRecords().length,0);
    f.renderer.draw({...view,selected:{type:'player',id:play.players[0].id}});
    assert.deepEqual(observer.takeRecords().map(m=>[m.type,m.attributeName]),[['attributes','opacity']]);
    movePlayer(play,play.players[0].id,play.players[0].x+1,play.players[0].y);
    f.renderer.draw(view);
    assert.ok(observer.takeRecords().every(m=>m.type!=='childList'),'movement within a row keeps the existing painter order');
  }finally{observer.disconnect();f.renderer.destroy();f.win.happyDOM.abort();}
});

test('preview masks hide and restore fallback pieces without rebuilding or mutating them',()=>{
  const f=fixture(),play=starterWorkspace().plays[0],before=JSON.stringify(play),player=play.players[0];
  try{
    f.renderer.draw({play,settings:{},time:0});
    const piece=f.doc.querySelector(`[data-vector-player="${player.id}"]`),geometry=piece.innerHTML;
    f.renderer.draw({play,settings:{},time:0,presentationMask:{playerIds:[player.id]}});
    assert.equal(piece.style.display,'none');
    const at=project(player),top=projectBoardPoint(at.x,at.y,PIECE_HEIGHT);
    assert.notEqual(f.renderer.pick(70+top.x*.5,110+top.y*.5)?.id,player.id);
    f.renderer.draw({play,settings:{},time:0});
    assert.equal(piece.style.display,'');assert.equal(piece.innerHTML,geometry);
    assert.equal(f.doc.querySelector(`[data-vector-player="${player.id}"]`),piece);
    assert.equal(JSON.stringify(play),before);
  }finally{f.renderer.destroy();f.win.happyDOM.abort();}
});

test('fallback uses the same closed low bevels, team-color band and matte face for every symbol',()=>{
  for(const shape of ['circle','square','triangle']){
    const mesh=fallbackMesh(shape);assert.ok(mesh.length>25);
    const heights=mesh.flatMap(f=>f.vertices.map(v=>v[2]));
    assert.equal(Math.min(...heights),0);assert.equal(Math.max(...heights),PIECE_HEIGHT);
    assert.deepEqual([...new Set(mesh.map(f=>f.material))].sort(),['band','face','foot','rim']);
    for(const face of mesh){assert.ok(face.vertices.length>=3);assert.ok(face.vertices.flat().every(Number.isFinite));assert.ok(Math.abs(Math.hypot(...face.normal)-1)<1e-10);}
  }
  assert.notEqual(fallbackMesh('circle').length,fallbackMesh('triangle').length);
});

test('fallback follows shared animation without mutating data, retains labels and picks the puck face after zoom/scroll',()=>{
  const f=fixture(),play=starterWorkspace().plays[0],before=JSON.stringify(play);
  f.renderer.draw({play,time:0,settings:{},selected:{type:'player',id:play.players[0].id}});
  assert.equal(f.doc.querySelectorAll('[data-vector-player]').length,11);
  assert.equal(f.svg.classList.contains('digital-fallback-ready'),true);
  const p=play.players.find(p=>p.label==='X'),at=project(p),head=projectBoardPoint(at.x,at.y,PIECE_HEIGHT);
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

test('the corners outside a triangle remain available to route editing',()=>{
  const f=fixture(),play=starterWorkspace().plays[0],p=play.players.find(p=>p.label==='X');
  try{
    p.shape='triangle';f.renderer.draw({play});
    const at=project(p),top=projectBoardPoint(at.x,at.y,PIECE_HEIGHT);
    const corner=projectBoardPoint(at.x-15,at.y-14,PIECE_HEIGHT);
    assert.equal(f.renderer.pick(70+top.x*.5,110+top.y*.5)?.id,p.id);
    assert.equal(f.renderer.pick(70+corner.x*.5,110+corner.y*.5),null);
  }finally{f.renderer.destroy();f.win.happyDOM.abort();}
});

test('fallback redraws colors, symbol shape and label changes and removes deleted players',()=>{
  const f=fixture(),play=starterWorkspace().plays[0];
  f.renderer.draw({play,settings:{},time:0});
  const p=play.players[0],old=f.doc.querySelector(`[data-vector-player="${p.id}"]`);
  p.shape='square';p.color='#abcdef';p.label='T1';
  f.renderer.draw({play,settings:{fieldTheme:'light'},time:0});
  const next=f.doc.querySelector(`[data-vector-player="${p.id}"]`);assert.notEqual(next,old);assert.equal(next.querySelector('text').textContent,'T1');assert.equal(next.querySelector('text').getAttribute('fill'),puckPalette(p).ink);
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
  const at=project(p),head=projectBoardPoint(at.x,at.y,PIECE_HEIGHT);
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

test('retained geometry preserves every front face, shadow and focus arc within half a board pixel', t=>{
  const f=fixture(),p=starterWorkspace().plays[0].players[0],play={players:[p],routes:[]};
  const coordinateNumbers=text=>text.match(/-?\d+(?:\.\d+)?(?:e[-+]?\d+)?/gi).map(Number);
  const curve=(rx,ry,start,sweep,dx=0,dy=0)=>Array.from({length:41},(_,i)=>{
    const a=start+sweep*i/40;
    return [Math.cos(a)*rx+dx,Math.sin(a)*ry+dy,.2];
  });
  const shadow=curve(28,27,0,2*Math.PI,1,-2);
  const ring=curve(FOCUS_RADIUS,FOCUS_RADIUS,Math.PI*.59,Math.PI*1.82);
  let worst=0, compared=0;
  try{
    for(const shape of ['circle','square','triangle']){
      p.shape=shape;
      const mesh=fallbackMesh(shape);
      for(const lift of [0,1.5,5])for(const cx of [24,504,976])for(const cy of [24,400,776]){
        for(const [dx,dy] of [[-3.99,-3.99],[3.99,-3.99],[3.99,3.99],[-3.99,3.99]]){
          p.x=(cx+dx-18)/9.64;p.y=(cy+dy-20)/7.6;
          const at=project(p), worldY=800-at.y;
          const exact=(vertex,z)=>projectWorldPoint({x:at.x+vertex[0],y:worldY+vertex[1],z:z+vertex[2]});
          const eye=[BOARD_CAMERA.position[0]-at.x,BOARD_CAMERA.position[1]-worldY,BOARD_CAMERA.position[2]-lift];
          const expected=mesh.filter(({normal,vertices})=>normal[2]>=0&&normal.reduce((v,n,i)=>v+n*(eye[i]-vertices[0][i]),0)>0)
            .map(face=>face.vertices.map(v=>exact(v,lift)));
          f.renderer.draw({play,hoveredId:lift===1.5?p.id:null,draggingId:lift===5?p.id:null,selected:{type:'player',id:p.id}});
          const geometry=f.doc.querySelector('[data-vector-player] > g');
          const [tx,ty,scale]=coordinateNumbers(geometry.getAttribute('transform'));
          const label=geometry.parentNode.querySelector('text');
          const labelAt=exact([0,shape==='triangle'?-2:0,PIECE_HEIGHT+.12],lift);
          assert.equal(+label.getAttribute('x'),labelAt.x);
          assert.equal(+label.getAttribute('y'),labelAt.y);
          assert.equal(+label.getAttribute('font-size'),15*labelAt.scale);
          const points=path=>{
            const coords=coordinateNumbers(path),result=[];
            for(let i=0;i<coords.length;i+=2)result.push({x:tx+coords[i]*scale,y:ty+coords[i+1]*scale});
            return result;
          };
          function error(actual,wanted){
            if(actual.length!==wanted.length)return Infinity;
            let max=0;
            for(let i=0;i<actual.length;i++){
              const distance=Math.hypot(actual[i].x-wanted[i].x,actual[i].y-wanted[i].y);
              if(distance>=.5)return Infinity;
              max=Math.max(max,distance);
            }
            return max;
          }
          const [shadowNode,ringNode,...surfaces]=geometry.children;
          assert.equal(+ringNode.getAttribute('stroke-width')*scale,1.6);
          assert.ok(surfaces.every(path=>+path.getAttribute('stroke-width')*scale===.28));
          for(const [node,outline] of [[shadowNode,shadow],[ringNode,ring]]){
            const distance=error(points(node.getAttribute('d')),outline.map(v=>exact(v,0)));
            assert.ok(distance<.5,'ground decoration follows its exact ground plane');
            worst=Math.max(worst,distance);compared+=outline.length;
          }
          for(const surface of surfaces)for(const polygon of surface.getAttribute('d').match(/M[^Z]+Z/g)||[]){
            const actual=points(polygon);
            const index=expected.findIndex(face=>error(actual,face)<.5);
            assert.notEqual(index,-1,'every rendered polygon matches a visible face with its original winding');
            const distance=error(actual,expected[index]);worst=Math.max(worst,distance);
            expected.splice(index,1);compared+=actual.length;
          }
          assert.equal(expected.length,0,'all visible mesh faces were drawn');
        }
      }
    }
    t.diagnostic(`${compared} projected vertices, maximum error ${worst.toFixed(4)} logical pixels`);
  }finally{f.renderer.destroy();f.win.happyDOM.abort();}
});

test('22-player Mesh stays within its SVG path-write budget for continuous playback and distant seeks', t=>{
  const f=fixture(),{play,settings}=JSON.parse(readFileSync(new URL('../scripts/bench-digital/mesh.json',import.meta.url)));
  const observer=new f.win.MutationObserver(()=>{});
  function median(values){return [...values].sort((a,b)=>a-b)[Math.ceil(values.length/2)-1];}
  function sample(times){
    f.renderer.draw({play,settings,time:0});
    observer.takeRecords();
    return times.map(time=>{
      f.renderer.draw({play,settings,time});
      return observer.takeRecords().reduce((sum,m)=>sum+m.target.getAttribute('d').length,0);
    });
  }
  try{
    f.renderer.draw({play,settings,time:0});
    observer.observe(f.doc.querySelector('.digital-token-overlay'),{attributes:true,subtree:true,attributeFilter:['d']});
    const playback=median(sample(Array.from({length:204},(_,i)=>(i+1)/60)));
    const seeks=median(sample(Array.from({length:36},(_,i)=>[3.2,1,2.3,.4,3,1.7][i%6])));
    // Half of the measured 22-player full-projection median in each scenario.
    assert.ok(playback<=66594/2,`playback rewrote ${playback} path characters`);
    assert.ok(seeks<=73778/2,`seeks rewrote ${seeks} path characters`);
    t.diagnostic(`median path characters per update: playback ${playback}, seeks ${seeks}`);
  }finally{observer.disconnect();f.renderer.destroy();f.win.happyDOM.abort();}
});
