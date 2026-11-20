import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Window } from 'happy-dom';
import { createFilmModel } from '../web/coach-film-model.js';
import { createFilmField } from '../web/coach-film-field.js';
import { dynamicBlockRoute, starterWorkspace } from '../web/model.js';
import { routePath } from '../web/field.js';
import { t } from '../web/i18n.js';

function scene({ play = starterWorkspace().plays[0], gl = null } = {}) {
  const win = new Window(), doc = win.document;
  Object.defineProperties(win.HTMLElement.prototype, {
    clientWidth: { configurable:true, get:()=>900 },
    clientHeight: { configurable:true, get:()=>400 },
  });
  win.HTMLCanvasElement.prototype.getContext = type => type === 'webgl2' ? gl : null;
  const model = createFilmModel(play), picks = [];
  const field = createFilmField(doc.body,{model,theme:'dark',onPick:id=>picks.push(id)});
  const one = selector=>doc.querySelector(selector);
  const h = model.players.find(player=>player.label==='H')?.id;
  const y = model.players.find(player=>player.label==='Y')?.id;
  const nodeFor = id=>one(`[data-film-player="${id}"]`);
  const at = (time, ids = [], reference=null) => field.render(model.frameAt(time,ids),ids,reference);
  return { win,doc,model,field,h,y,picks,one,nodeFor,at,async done(){field.destroy();await win.happyDOM.abort();} };
}

test('film field renders the Mesh release from the model, pins positions, and keeps keyboard targets attached', async()=>{
  const f=scene();
  try {
    const h=f.nodeFor(f.h), focus=[f.h,f.y];
    const ball=f.one('[data-film-ball]'), depth=f.one('[data-film-depth]');
    const route=f.one('[data-film-route]');
    f.at(2,focus);
    assert.equal(f.field.renderer,'svg');
    assert.equal(f.one('.film-pitch').dataset.filmTime,'2');
    assert.equal(ball.dataset.phase,'release');
    assert.equal(depth.textContent,t('film.fieldGap',{yards:'3.0'}));
    assert.equal(h.getAttribute('aria-pressed'),'true');
    assert.equal(f.nodeFor(f.y).parentNode.getAttribute('class'), 'film-focused-players', 'selected pieces paint above overlapping teammates and opponents');
    assert.equal(f.doc.querySelectorAll('.film-recent-route[display="inline"]').length,2);
    const refMark=f.one('.film-reference-position'), initial=refMark.getAttribute('cy');
    f.at(2,focus,f.model.frameAt(1));
    assert.notEqual(refMark.getAttribute('cy'),initial);
    f.at(2,focus);
    assert.equal(refMark.getAttribute('cy'),initial);
    f.at(1,focus);
    assert.equal(depth.textContent,t('film.fieldGap',{yards:'1.0'}));
    f.at(2.5,focus);
    assert.equal(ball.dataset.phase,'flight');
    f.field.setReducedMotion(true);
    assert.equal(f.doc.querySelectorAll('.film-recent-route[display="inline"]').length,0);
    assert.equal(depth.getAttribute('display'),'inline');
    f.field.setTheme('light');
    assert.strictEqual(f.one('[data-film-route]'),route);
    h.dispatchEvent(new f.win.KeyboardEvent('keydown',{key:' ',bubbles:true,cancelable:true}));
    f.nodeFor(f.y).querySelector('text').dispatchEvent(new f.win.MouseEvent('click',{bubbles:true,cancelable:true}));
    assert.deepEqual(f.picks,focus);
    f.at(3);
    assert.equal(ball.dataset.phase,'arrival');
    assert.equal(h.getAttribute('aria-pressed'),'false');
    assert.equal(depth.getAttribute('display'),'none');
    assert.strictEqual(f.nodeFor(f.h),h);
  } finally {await f.done();}
});

test('field retains route endings, option patterns, custom colours and text as data', async()=>{
  const play=starterWorkspace().plays[0];
  play.routes[0].color='#cc2277';
  play.routes[0].optional=true;
  play.players[0].shape='triangle';
  play.annotations.push({id:'annotation',x:66,y:20,text:'<script>coach sample</script>'});
  play.zones.push({id:'zone',x:43,y:45,rx:10,ry:12,label:'Left seam',color:'#358ca5'});
  const f=scene({play});
  try {
    f.at(1);
    const route=f.one(`[data-film-route="${play.routes[0].id}"]`);
    assert.equal(route.getAttribute('stroke-dasharray'),'9 7');
    assert.equal(route.getAttribute('stroke'),'#cc2277');
    const block=play.routes.find(route=>route.kind==='block');
    const endMarker=f.one(`[data-film-route="${block.id}"]`).getAttribute('marker-end').slice(5,-1);
    assert.equal(f.doc.getElementById(endMarker).firstElementChild.getAttribute('d'),'M10 -7 V7');
    assert.equal(f.one('[data-film-zone]').getAttribute('color'),'#358ca5');
    assert.equal(f.one('.film-annotation').textContent,'<script>coach sample</script>');
    assert.equal(f.one('script'),null);
    assert.equal(f.nodeFor(play.players[0].id).querySelector('.film-token-face').localName,'path');
    f.field.setTheme('light');
    assert.equal(route.getAttribute('stroke'),'#cc2277');
  } finally {await f.done();}
});

// The GL submission API is stubbed. Actual displayed GPU pixels and device
// timings are covered by the browser/device acceptance matrix.
function glRecorder() {
  const recorded={upload:null,draws:0,released:false,contextLost:false};
  const gl={};
  for(const key of ['createVertexArray','createBuffer','createProgram','createShader','getUniformLocation']){
    gl[key]=()=>({});
  }
  for(const key of ['deleteVertexArray','deleteBuffer','deleteProgram','deleteShader','shaderSource','compileShader',
    'attachShader','linkProgram','useProgram','enable','blendFunc','clearColor','bindBuffer','bindVertexArray',
    'bufferData','enableVertexAttribArray','vertexAttribPointer','vertexAttribDivisor','uniform2f','viewport','clear']){
    gl[key]=()=>{};
  }
  gl.getShaderParameter=gl.getProgramParameter=()=>true;
  gl.isContextLost=()=>recorded.contextLost;
  gl.bufferSubData=(_target,_offset,vertices)=>{recorded.upload=Array.from(vertices);};
  gl.drawArraysInstanced=(_kind,_first,vertices,instances)=>{recorded.draws++;recorded.vertices=vertices;recorded.instances=instances;};
  gl.getExtension=()=>({loseContext:()=>{recorded.released=true;}});
  return {gl,recorded};
}

test('stationary defenders and blocked paths reuse their geometry while moving markers still follow the simulation', async () => {
  const {play} = JSON.parse(readFileSync(new URL('../scripts/bench-digital/mesh.json',import.meta.url),'utf8'));
  const block = play.routes.find(route => route.blockTargets?.length);
  const movingTarget = play.players.find(player => player.id === block.blockTargets[0]);
  const still = play.players.find(player => player.side === 'defense' && player.id !== movingTarget.id);
  const points = [{x:movingTarget.x,y:movingTarget.y},{x:movingTarget.x+8,y:movingTarget.y+9}];
  play.routes.push({...play.routes[0],id:'moving-defender',playerId:movingTarget.id,points,delay:.5,duration:1});
  const {gl,recorded} = glRecorder(), f = scene({play,gl});
  try {
    const fixedOrigin = f.model.frameAt(0).positions.get(still.id);
    f.at(0,[still.id]);
    const node = f.nodeFor(still.id), reads = [];
    const getAttribute = node.getAttribute.bind(node);
    node.getAttribute = name => { reads.push(name); return getAttribute(name); };
    const path = f.one(`[data-film-route="${block.id}"]`);
    for (const time of [.2,.65,.9,1.4,1.1,4]) {
      const frame = f.model.frameAt(time,[still.id]);
      f.field.render(frame,[still.id]);
      assert.strictEqual(frame.positions.get(still.id),fixedOrigin);
      assert.deepEqual(frame.focus[0].trail,[fixedOrigin]);
      assert.equal(path.getAttribute('d'),routePath(dynamicBlockRoute(play,block,time)));
    }
    const draws = recorded.draws;
    f.at(4,[f.h,f.y]);
    f.at(4,[f.y],f.model.frameAt(.5));
    assert.equal(recorded.draws,draws,'focus and reference updates keep immutable GPU faces in place');
    assert.ok(!reads.includes('transform'),'unchanged positions require no SVG transform reads');
  } finally { await f.done(); }
});

test('GPU faces align with SVG picks; a lost and restored context keeps the exact frozen frame and focus', async()=>{
  const {gl,recorded}=glRecorder(), f=scene({gl});
  try{
    f.at(2.5,[f.h,f.y]);
    const root=f.one('.film-pitch'), token=f.nodeFor(f.h), canvas=f.one('canvas');
    const location=token.getAttribute('transform'), ball=f.one('[data-film-ball]').getAttribute('transform');
    assert.equal(root.dataset.filmRenderer,'webgl');
    assert.equal(recorded.vertices,6);
    assert.equal(recorded.instances,11);
    const i=f.model.players.findIndex(p=>p.id===f.h)*6;
    const xy=location.slice(10,-1).split(' ').map(Number);
    assert.ok(xy.every((n,dim)=>Math.abs(n-recorded.upload[i+dim])<.006));
    recorded.contextLost=true;
    canvas.dispatchEvent(new f.win.Event('webglcontextlost',{cancelable:true}));
    assert.equal(root.dataset.filmRenderer,'svg');
    assert.equal(root.dataset.filmTime,'2.5');
    assert.equal(f.nodeFor(f.h).getAttribute('aria-pressed'),'true');
    assert.equal(token.getAttribute('transform'),location);
    recorded.contextLost=false;
    canvas.dispatchEvent(new f.win.Event('webglcontextrestored'));
    assert.equal(f.field.renderer,'webgl');
    assert.equal(f.one('[data-film-ball]').getAttribute('transform'),ball);
    f.field.destroy();
    assert.equal(recorded.released,true);
    assert.equal(f.one('.film-pitch'),null);
  }finally{await f.done();}
});
