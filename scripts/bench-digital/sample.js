// Drives the production field bindings, feedback and renderer with one timeline.
export const scenarios = ['still', 'free drag', 'linked drag', 'selection', 'playback', 'scrub'];
export function quantify(values) {
  const sorted = [...values].sort((a,b) => a-b);
  const quantile = p => Number(sorted[Math.ceil(sorted.length*p)-1].toFixed(2));
  return sorted.length ? { p50:quantile(.5), p95:quantile(.95), max:quantile(1) } : null;
}
export async function createSample({ modules, scene, state, svg }) {
  const { field, routes } = modules, { play } = state;
  const free = play.players.find(p=>p.label==='W'), linked = play.players.find(p=>p.id===play.routes.find(r=>r.stagedBlock).blockTargets[0]);
  const x = play.players.find(p=>p.label==='X'), y = play.players.find(p=>p.label==='Y');
  const initial = new Map([free,linked].map(p=>[p,p.x]));
  const gestures = new Map([free,linked].map(p=>[p,field.bindGestureGeometry(svg,play,{type:'player',id:p.id})]));
  const feedback = routes.createRouteFeedback(svg,play);
  const reset = () => {
    for (const [p,origin] of initial) {p.x=origin;gestures.get(p)();}
    Object.assign(state,{time:0,playing:false,rehearsal:false,selected:null,draggingId:null,materialTime:1,animated:true});
    field.updateAnimation(svg, play, 0);
  };
  function paint(sceneCase,index,count) {
    let refreshTexture=false;
    if(sceneCase==='free drag'||sceneCase==='linked drag'){
      const p=sceneCase==='free drag'?free:linked;
      state.draggingId=p.id;p.x=initial.get(p)+Math.sin((index+1)/count*Math.PI*2)*4;
      refreshTexture = gestures.get(p)();
    }else if(sceneCase==='selection'){
      state.selected={type:'player',id:(index%2 ? y:x).id};
    }else if(sceneCase==='playback'||sceneCase==='scrub'){
      state.rehearsal=true;
      state.playing=sceneCase==='playback';
      state.time=state.playing ? (index+1)/count*3.4 : [3.2,1,2.3,.4,3,1.7][index%6];
      field.updateAnimation(svg, play, state.time);
    }
    // Fixed sample times make zone and ball evaluations comparable across devices.
    state.materialTime+=(1/60);
    feedback.update(state);
    scene.draw(state,{refreshTexture});
    return refreshTexture;
  }
  function pose(name){
    reset();
    if(name==='select')state.selected={type:'player',id:x.id};
    if(name==='throw'||name==='catch'){state.rehearsal=true;state.time=name==='throw'?play.ball.passAt+.16:play.ball.arriveAt;}
    field.updateAnimation(svg,play,state.time);feedback.update(state);scene.draw(state,{refreshTexture:true});
  }
  return {reset,paint,pose,close(){feedback.destroy();scene.destroy();}};
}
