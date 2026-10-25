import { createRouteFeedback } from './digital-routes.js';

export function createDigitalBoard({doc=document,getState,makeEngine=async()=>{
  const {createDigitalMaterials}=await import('./digital-materials.js');return createDigitalMaterials(doc);
},notify=()=>{}}) {
  const win=doc.defaultView;
  let engine=null,pending=null,feedback=null,svg=null,engineSvg=null,frame=null,generation=0,disposed=false,materialTime=0,last=null,hoveredId=null,pointer=[.3,.2],failed=false;
  const allowed=()=>!disposed&&doc.documentElement.dataset.visualMode==='digital'&&!getState().play?.reference;
  function stop(){if(frame!==null)win.cancelAnimationFrame(frame);frame=null;last=null;}
  function clear(){stop();feedback?.destroy();feedback=null;engine?.destroy();engine=null;svg=null;engineSvg=null;}
  function update(stamp){
    frame=null;if(!allowed()||doc.hidden)return;
    const state=getState(), current=doc.querySelector('#field .pitch-svg');
    if(!current||current.closest('[hidden]')){last=null;frame=win.requestAnimationFrame(update);return;}
    if(current!==svg)mount(current,state);
    const animated=doc.documentElement.dataset.effects!=='off';
    if(last!==null&&animated&&(!state.rehearsal||state.playing))materialTime+=Math.min((stamp-last)/1000,.1);
    last=stamp;
    try{feedback?.update({...state,materialTime,animated});engine?.draw({...state,materialTime,animated,hoveredId,pointer});}
    catch(error){failed=true;engine?.destroy();engine=null;engineSvg=null;doc.documentElement.dataset.digitalBoard='unavailable';notify('当前浏览器未能启动立体材质，已保留平面球员和路线反馈。切换模式可重试。');win.console.warn('Digital board stopped:',error);}
    if(engine)doc.documentElement.dataset.digitalBoard='ready';frame=win.requestAnimationFrame(update);
  }
  function mount(current,state){feedback?.destroy();svg=current;engine?.mount(svg,state.play,state.settings);engineSvg=engine?svg:null;feedback=createRouteFeedback(svg,state.play);}
  async function sync({retry=false}={}){
    if(!allowed()){generation++;clear();delete doc.documentElement.dataset.digitalBoard;return;}
    if(retry)failed=false;
    if(typeof win.CanvasRenderingContext2D==='undefined')return;
    const current=doc.querySelector('#field .pitch-svg');if(!current)return;
    if(!engine&&!pending&&!failed){const ticket=++generation;doc.documentElement.dataset.digitalBoard='loading';
      pending=Promise.resolve().then(makeEngine).then(value=>{
        if(disposed||ticket!==generation||!allowed()){value.destroy();return;}engine=value;
      }).catch(error=>{if(!disposed&&ticket===generation){failed=true;doc.documentElement.dataset.digitalBoard='unavailable';notify('当前浏览器未能启动立体材质，已保留平面球员和路线反馈。');win.console.warn('Digital board initialization failed:',error);}}).finally(()=>{pending=null;});
    }
    await pending;
    if(!allowed())return;
    // A newer digital request may have outlived an obsolete startup.
    if(!engine&&!failed)return sync();
    const next=doc.querySelector('#field .pitch-svg');if(!next)return;
    if(next!==svg||(engine&&engineSvg!==next))mount(next,getState());else engine?.refreshBackground();
    if(frame===null&&!doc.hidden)frame=win.requestAnimationFrame(update);
  }
  const changed=()=>sync({retry:true});
  const visibility=()=>{if(doc.hidden)stop();else sync();};
  const move=event=>{hoveredId=event.target.closest?.('[data-player]')?.dataset.player||null;if(svg){const b=svg.getBoundingClientRect();pointer=[(event.clientX-b.left)/(b.width||1),(event.clientY-b.top)/(b.height||1)];}};
  doc.addEventListener('playbook:effects-changed',changed);doc.addEventListener('visibilitychange',visibility);doc.addEventListener('pointermove',move,{passive:true});
  const hide=()=>{generation++;clear();},show=()=>sync();win.addEventListener('pagehide',hide);win.addEventListener('pageshow',show);
  return {sync,refreshBackground(){engine?.refreshBackground();},capture(){
    if(!allowed()||!svg||!feedback)return null;
    const state=getState();feedback.update({...state,materialTime,animated:doc.documentElement.dataset.effects!=='off'});
    let image=null;
    if(engine&&svg.classList.contains('digital-ready')){engine.draw({...state,materialTime,animated:false});image=engine.capture();}
    return {image,decoration:feedback.layer.outerHTML,time:state.time};},
    destroy(){disposed=true;generation++;clear();doc.removeEventListener('playbook:effects-changed',changed);doc.removeEventListener('visibilitychange',visibility);doc.removeEventListener('pointermove',move);win.removeEventListener('pagehide',hide);win.removeEventListener('pageshow',show);}};
}
