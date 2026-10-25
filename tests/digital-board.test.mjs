import test from 'node:test';
import assert from 'node:assert/strict';
import {Window} from 'happy-dom';
import {traditionalDevice,resolveVisualMode} from '../web/visual-mode.js';
import {starterWorkspace,clone,animatedPlayer,animatedBall,passFlightRoute,pointAlong,sampledRoute} from '../web/model.js';
import {fieldSVG,updateAnimation,routePath} from '../web/field.js';
import {feedbackProgress,createRouteFeedback} from '../web/digital-routes.js';
import {createDigitalBoard} from '../web/digital-board.js';

test('phones and iPads stay traditional including desktop-site iPad with a mouse; desktops keep their choice',()=>{
  for(const device of [
    {userAgent:'Mozilla iPhone'}, {userAgent:'Android 15'}, {userAgent:'Mozilla iPad'},
    {userAgent:'Macintosh Intel Mac OS X',platform:'MacIntel',maxTouchPoints:5,coarse:false,noHover:false},
    {mobile:true}, {coarse:true,noHover:true}
  ]){assert.equal(traditionalDevice(device),true);assert.equal(resolveVisualMode('digital',traditionalDevice(device)),'traditional');}
  assert.equal(traditionalDevice({platform:'MacIntel',maxTouchPoints:0}),false);
  assert.equal(traditionalDevice({platform:'Win32',maxTouchPoints:10,coarse:false,noHover:false}),false);
  assert.equal(resolveVisualMode('digital',false),'digital');assert.equal(resolveVisualMode(null,false),'traditional');
});

test('block-only players follow their route; optional blocks do not change playback',()=>{
  const play=clone(starterWorkspace().plays[0]), route=play.routes.find(r=>r.kind==='block'), player=play.players.find(p=>p.id===route.playerId);
  assert.deepEqual(animatedPlayer(play,player,route.delay+route.duration),route.points.at(-1));
  route.optional=true;assert.deepEqual(animatedPlayer(play,player,10),{x:player.x,y:player.y});
});

test('drawn passing bends, release and catch share the same path across playback and scrubbing',()=>{
  const play=clone(starterWorkspace().plays[0]), holder=play.players.find(p=>p.id===play.ball.holderId);
  play.routes.push({id:'bent-pass',playerId:holder.id,kind:'pass',points:[{x:holder.x,y:holder.y},{x:20,y:15},{x:70,y:35}],smooth:true,optional:false,color:'#ffffff',endCap:'arrow',delay:0,duration:4});
  const before=JSON.stringify(play),flight=passFlightRoute(play), t=(play.ball.passAt+play.ball.arriveAt)/2;
  assert.deepEqual(flight.points[0],animatedPlayer(play,holder,play.ball.passAt));
  assert.deepEqual(flight.points.at(-1),animatedPlayer(play,play.players.find(p=>p.id===play.ball.receiverId),play.ball.arriveAt));
  assert.deepEqual(animatedBall(play,t),pointAlong(sampledRoute(flight),.5));
  const win=new Window();win.document.body.innerHTML=fieldSVG(play);const svg=win.document.querySelector('svg');
  updateAnimation(svg,play,t);assert.equal(svg.querySelector('[data-route="bent-pass"] .route-stroke').getAttribute('d'),routePath(flight));
  updateAnimation(svg,play,0);assert.equal(svg.querySelector('[data-route="bent-pass"] .route-stroke').getAttribute('d'),routePath(play.routes.at(-1)));
  assert.equal(JSON.stringify(play),before);win.happyDOM.abort();
});

test('route light, blocking pulse and zones are deterministic at the playback time and do not mutate the play',()=>{
  const play=clone(starterWorkspace().plays[0]), before=JSON.stringify(play), route=play.routes.find(r=>r.kind==='block');
  assert.equal(feedbackProgress(play,route,route.delay+route.duration/2).progress,.5);
  assert.equal(feedbackProgress(play,route,route.delay+route.duration).impact,1);
  assert.equal(feedbackProgress(play,route,route.delay+route.duration+1).impact,0);
  const win=new Window();win.document.body.innerHTML=fieldSVG(play);const svg=win.document.querySelector('svg'), player=svg.querySelector('[data-player]');
  const feedback=createRouteFeedback(svg,play);feedback.update({play,time:1,animated:true});const first=feedback.layer.outerHTML;
  feedback.update({play,time:4,animated:true});feedback.update({play,time:1,animated:true});assert.equal(feedback.layer.outerHTML,first);
  assert.equal(svg.querySelector('[data-player]'),player);assert.equal(JSON.stringify(play),before);feedback.destroy();assert.equal(svg.querySelector('.digital-decoration'),null);win.happyDOM.abort();
});

function fixture(makeEngine){
  const win=new Window({width:1440,height:900}),doc=win.document,frames=new Map();let id=0,hidden=false;
  win.CanvasRenderingContext2D=function(){};win.requestAnimationFrame=fn=>{frames.set(++id,fn);return id;};win.cancelAnimationFrame=id=>frames.delete(id);
  Object.defineProperty(doc,'hidden',{get:()=>hidden});
  const data=starterWorkspace(),state={play:data.plays[0],settings:data.settings,time:0,playing:false,rehearsal:false};
  doc.body.innerHTML=`<div id="field">${fieldSVG(state.play)}</div>`;doc.documentElement.dataset.visualMode='traditional';
  const controller=createDigitalBoard({doc,getState:()=>state,makeEngine});
  return {win,doc,state,controller,frames,step(now){const all=[...frames.values()];frames.clear();all.forEach(fn=>fn(now));},async close(){controller.destroy();await win.happyDOM.abort();},visibility(value){hidden=value;doc.dispatchEvent(new win.Event('visibilitychange'));}};
}
test('traditional mode never starts Three; stale digital startup is disposed without replacing the SVG',async()=>{
  let resolve,started=0,destroyed=0;
  const f=fixture(()=>{started++;return new Promise(r=>resolve=r);});
  try{
    const svg=f.doc.querySelector('svg');await f.controller.sync();assert.equal(started,0);
    f.doc.documentElement.dataset.visualMode='digital';const pending=f.controller.sync();await Promise.resolve();
    f.doc.documentElement.dataset.visualMode='traditional';await f.controller.sync();
    resolve({destroy(){destroyed++;}});await pending;
    assert.equal(destroyed,1);assert.equal(f.frames.size,0);assert.equal(f.doc.querySelector('svg'),svg);
  }finally{await f.close();}
});
test('digital renderer follows playback and survives theme remounts without resetting time or the play',async()=>{
  const draws=[];let mounts=0,destroyed=0;
  const f=fixture(async()=>({mount(){mounts++;},draw(state){draws.push({...state});},refreshBackground(){},destroy(){destroyed++;}}));
  try{
    f.doc.documentElement.dataset.visualMode='digital';await f.controller.sync();f.step(0);f.step(100);
    f.state.rehearsal=true;f.state.time=2.5;f.step(200);const frozen=draws.at(-1).materialTime;f.step(300);assert.equal(draws.at(-1).materialTime,frozen);assert.equal(draws.at(-1).time,2.5);
    f.doc.querySelector('svg').outerHTML=fieldSVG(f.state.play,{fieldTheme:'light'},{time:2.5});await f.controller.sync();f.step(400);
    assert.equal(mounts,2);assert.equal(draws.at(-1).time,2.5);assert.equal(f.doc.querySelectorAll('.digital-decoration').length,1);
    f.visibility(true);assert.equal(f.frames.size,0);f.visibility(false);await Promise.resolve();assert.equal(f.frames.size,1);
    f.doc.documentElement.dataset.visualMode='traditional';await f.controller.sync();assert.equal(f.frames.size,0);assert.equal(destroyed,1);assert.equal(f.doc.querySelectorAll('.digital-decoration').length,0);
  }finally{await f.close();}
});
test('unavailable WebGL keeps SVG route feedback and accessible players; switching modes can recover',async()=>{
  let starts=0,mounts=0;
  const f=fixture(async()=>{if(++starts===1)throw new Error('WebGL disabled');return{mount(){mounts++;},draw(){},refreshBackground(){},destroy(){}};});
  f.win.console.warn=()=>{};
  try{
    const player=f.doc.querySelector('[data-player]');f.doc.documentElement.dataset.visualMode='digital';await f.controller.sync();f.step(0);
    assert.equal(f.doc.documentElement.dataset.digitalBoard,'unavailable');assert.equal(f.doc.querySelector('[data-player]'),player);assert.ok(f.doc.querySelector('.digital-decoration'));assert.equal(f.frames.size,1);
    await f.controller.sync({retry:true});f.step(100);assert.equal(mounts,1);assert.equal(f.doc.documentElement.dataset.digitalBoard,'ready');
  }finally{await f.close();}
});
