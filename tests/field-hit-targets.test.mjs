import test from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { makePlay } from '../web/model.js';
import { fieldSVG, project, syncFieldHitTargets, fieldHitCandidates } from '../web/field.js';

function fixture({scale=.32,selected=null}={}) {
  const win=new Window(),play=makePlay({formation:'Gun Trips'});
  play.players=play.players.slice(0,2);
  for (const [i,player] of play.players.entries()) Object.assign(player,{x:50+i,y:70});
  const owner=play.players[0];
  play.routes=[{id:'test-route',playerId:owner.id,kind:'route',points:[{x:50,y:70},{x:50,y:30}],color:owner.color,smooth:false,endCap:'arrow',delay:0,duration:3,optional:false}];
  win.document.body.innerHTML=fieldSVG(play,{}, {selected});
  const svg=win.document.querySelector('svg');
  const matrix={a:scale,b:0,c:0,d:scale,e:15,f:20};
  svg.getScreenCTM=()=>matrix;
  svg.getBoundingClientRect=()=>({left:15,top:20,width:1000*scale,height:800*scale});
  const client=point=>{const v=project(point);return {clientX:15+v.x*scale,clientY:20+v.y*scale};};
  return {win,play,svg,matrix,client};
}

test('touch targets stay at least 44 CSS pixels after viewBox scaling without enlarging visible pieces',async()=>{
  const f=fixture({selected:{type:'route',id:'test-route'}});
  try {
    const body=f.svg.querySelector('.player-body').outerHTML;
    syncFieldHitTargets(f.svg,{pointerType:'touch'});
    assert.ok(Number(f.svg.querySelector('.player-hit').getAttribute('r'))*.32*2>=43.99);
    assert.ok(Number(f.svg.querySelector('.point-hit').getAttribute('r'))*.32*2>=43.99);
    assert.equal(f.svg.querySelector('.point-handle').getAttribute('r'),'6');
    assert.equal(f.svg.querySelector('.player-body').outerHTML,body);
    assert.equal(f.svg.querySelector('.route-hit').getAttribute('stroke-width'),'44.00');
    assert.equal(f.svg.querySelector('.route-hit').getAttribute('vector-effect'),'non-scaling-stroke');
    syncFieldHitTargets(f.svg,{pointerType:'mouse',minTargetPx:30});
    assert.equal(f.svg.querySelector('.route-hit').getAttribute('stroke-width'),'30.00');
  }finally{await f.win.happyDOM.abort();}
});

test('target sizing includes the smaller projection scale when the field is skewed',async()=>{
  const f=fixture();
  try {
    f.svg.getScreenCTM=()=>({a:.4,b:0,c:.2,d:.2,e:15,f:20});
    syncFieldHitTargets(f.svg,{pointerType:'touch'});
    assert.ok(Number(f.svg.querySelector('.player-hit').getAttribute('r'))>110);
  }finally{await f.win.happyDOM.abort();}
});

test('dense nearby players return explicit candidates ordered by distance rather than SVG paint order',async()=>{
  const f=fixture();
  try {
    const at=f.client(f.play.players[0]);
    const candidates=fieldHitCandidates(f.svg,{...at,pointerType:'touch'});
    assert.deepEqual(candidates.map(candidate=>candidate.id),f.play.players.map(player=>player.id));
    assert.equal(candidates[0].distance,0);
    assert.ok(candidates[1].distance>0);
    assert.equal(candidates[0].element.dataset.player,f.play.players[0].id);
    assert.equal(fieldHitCandidates(f.svg,{clientX:-100,clientY:-100,pointerType:'touch'}).length,0);
  }finally{await f.win.happyDOM.abort();}
});

test('route waypoint candidates retain their real route and point index for the existing drag handler',async()=>{
  const f=fixture({selected:{type:'route',id:'test-route'}});
  try {
    const at=f.client({x:50,y:30}),candidates=fieldHitCandidates(f.svg,{...at,pointerType:'touch'});
    assert.equal(candidates.length,1);
    assert.equal(candidates[0].type,'point');
    assert.equal(candidates[0].routeId,'test-route');
    assert.equal(candidates[0].index,1);
    assert.equal(fieldHitCandidates(f.svg,{...at,pointerType:'touch'},{playersOnly:true}).length,0);
  }finally{await f.win.happyDOM.abort();}
});

test('field renders every selected player while keeping legacy single-object selection and print clean',async()=>{
  const f=fixture();
  try {
    const ids=f.play.players.map(player=>player.id);
    f.svg.outerHTML=fieldSVG(f.play,{}, {selected:{type:'players',ids}});
    assert.equal(f.win.document.querySelectorAll('[data-player][aria-pressed="true"]').length,2);
    f.win.document.body.innerHTML=fieldSVG(f.play,{}, {selected:{type:'player',id:ids[0]}});
    assert.equal(f.win.document.querySelectorAll('.selection-ring').length,1);
    assert.doesNotMatch(fieldSVG(f.play,{}, {selectedPlayerIds:ids,print:true}),/class="selection-ring"/);
  }finally{await f.win.happyDOM.abort();}
});
