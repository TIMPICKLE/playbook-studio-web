import { createRouteFeedback } from './digital-routes.js';
import { boardCSSMatrix } from './digital-projection.js';
import { createDigitalFallback } from './digital-fallback.js';

export function createDigitalBoard({doc=document,getState,makeEngine=async()=>{
  const {createDigitalMaterials}=await import('./digital-materials.js');return createDigitalMaterials(doc);
},notify=()=>{}}) {
  const win=doc.defaultView;
  let engine=null,fallback=null,stage=null,pending=null,feedback=null,svg=null,engineSvg=null,frame=null,generation=0,disposed=false,materialTime=0,last=null,hoveredId=null,pointer=[.3,.2],failed=false;
  const allowed=()=>!disposed&&doc.documentElement.dataset.visualMode==='digital'&&!getState().play?.reference;
  function stop(){if(frame!==null)win.cancelAnimationFrame(frame);frame=null;last=null;}
  function clear(){stop();feedback?.destroy();feedback=null;engine?.destroy();fallback?.destroy();engine=null;fallback=null;stage?.classList.remove('is-perspective');stage?.style.removeProperty('--board-projection');stage=null;svg=null;engineSvg=null;}
  function projectStage(){
    if(!svg)return;
    stage=svg.closest('.pitch-stage');
    if(!stage){stage=doc.createElement('div');stage.className='pitch-stage';svg.before(stage);stage.append(svg);}
    stage.classList.add('is-perspective');
    const width=stage.clientWidth||1000,height=stage.clientHeight||width*.8;
    const matrix=boardCSSMatrix(width,height);
    if(stage.style.getPropertyValue('--board-projection')!==matrix)stage.style.setProperty('--board-projection',matrix);
  }
  function ensureFallback(state){if(!fallback){fallback=createDigitalFallback(doc);fallback.mount(svg,state.play,state.settings);}}
  function update(stamp){
    frame=null;if(!allowed()||doc.hidden)return;
    const state=getState(), current=doc.querySelector('#field .pitch-svg');
    if(!current||current.closest('[hidden]')){last=null;frame=win.requestAnimationFrame(update);return;}
    if(current!==svg)mount(current,state);
    projectStage();
    const animated=doc.documentElement.dataset.effects!=='off';
    if(last!==null&&animated&&(!state.rehearsal||state.playing))materialTime+=Math.min((stamp-last)/1000,.1);
    last=stamp;
    paint(state,animated);frame=win.requestAnimationFrame(update);
  }
  function paint(state,animated=doc.documentElement.dataset.effects!=='off'){
    const view={...state,materialTime,animated,hoveredId,pointer};
    try{feedback?.update(view);(engine||fallback)?.draw(view);}
    catch(error){failed=true;engine?.destroy();engine=null;engineSvg=null;ensureFallback(state);fallback.draw(view);doc.documentElement.dataset.digitalBoard='unavailable';notify('WebGL 不可用，已切换到立体棋子兼容视图。');win.console.warn('Digital board stopped:',error);}
    if(engine)doc.documentElement.dataset.digitalBoard='ready';
  }
  function mount(current,state){feedback?.destroy();svg=current;projectStage();feedback=createRouteFeedback(svg,state.play);feedback.update({...state,materialTime,animated:doc.documentElement.dataset.effects!=='off'});if(engine){fallback?.destroy();fallback=null;}else if(fallback)fallback.mount(svg,state.play,state.settings);else ensureFallback(state);engine?.mount(svg,state.play,state.settings);engineSvg=engine?svg:null;paint(state);}
  async function sync({retry=false,contentChanged=false}={}){
    if(!allowed()){generation++;clear();delete doc.documentElement.dataset.digitalBoard;return;}
    if(retry)failed=false;
    if(typeof win.CanvasRenderingContext2D==='undefined')return;
    const current=doc.querySelector('#field .pitch-svg');if(!current)return;
    if(!engine&&!pending&&!failed){const ticket=++generation;doc.documentElement.dataset.digitalBoard='loading';
      pending=Promise.resolve().then(makeEngine).then(value=>{
        if(disposed||ticket!==generation||!allowed()){value.destroy();return;}engine=value;
      }).catch(error=>{if(!disposed&&ticket===generation){failed=true;doc.documentElement.dataset.digitalBoard='unavailable';notify('WebGL 不可用，已切换到立体棋子兼容视图。');win.console.warn('Digital board initialization failed:',error);}}).finally(()=>{pending=null;});
    }
    if(pending)await pending;
    if(!allowed())return;
    // A newer digital request may have outlived an obsolete startup.
    if(!engine&&!failed)return sync();
    const next=doc.querySelector('#field .pitch-svg');if(!next)return;
    const state=getState();
    if(next!==svg||(engine&&engineSvg!==next))mount(next,state);
    else {
      if(contentChanged){feedback?.destroy();feedback=createRouteFeedback(svg,state.play);}
      // Commit feedback and retained pieces now, before the browser can paint.
      paint(state);engine?.refreshBackground();
    }
    if(frame===null&&!doc.hidden)frame=win.requestAnimationFrame(update);
  }
  const changed=()=>sync({retry:true});
  const visibility=()=>{if(doc.hidden)stop();else sync();};
  const move=event=>{hoveredId=(engine||fallback)?.pick?.(event.clientX,event.clientY)?.id||event.target.closest?.('[data-player]')?.dataset.player||null;if(stage){const b=stage.getBoundingClientRect();pointer=[(event.clientX-b.left)/(b.width||1),(event.clientY-b.top)/(b.height||1)];}};
  doc.addEventListener('playbook:effects-changed',changed);doc.addEventListener('visibilitychange',visibility);doc.addEventListener('pointermove',move,{passive:true});
  const hide=()=>{generation++;clear();},show=()=>sync();win.addEventListener('pagehide',hide);win.addEventListener('pageshow',show);
  return {sync,pick(event){return allowed()?(engine||fallback)?.pick?.(event.clientX,event.clientY)||null:null;},refreshBackground(){engine?.refreshBackground();},capture(){
    if(!allowed()||!svg||!feedback)return null;
    const state=getState();feedback.update({...state,materialTime,animated:doc.documentElement.dataset.effects!=='off'});
    let image=null;
    if(engine&&svg.classList.contains('digital-ready')){engine.draw({...state,materialTime,animated:false});image=engine.capture();}
    return {image,fullScene:!!image&&engine?.fullScene===true,decoration:feedback.layer.outerHTML,time:state.time};},
    destroy(){disposed=true;generation++;clear();doc.removeEventListener('playbook:effects-changed',changed);doc.removeEventListener('visibilitychange',visibility);doc.removeEventListener('pointermove',move);win.removeEventListener('pagehide',hide);win.removeEventListener('pageshow',show);}};
}
