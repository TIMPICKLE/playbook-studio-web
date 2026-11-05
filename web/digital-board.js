import { t } from './i18n.js';
import { createRouteFeedback } from './digital-routes.js';
import { boardCSSMatrix } from './digital-projection.js';
import { createDigitalFallback } from './digital-fallback.js';

export function createDigitalBoard({doc=document,getState,makeEngine=async invalidate=>{
  const {createDigitalMaterials}=await import('./digital-materials.js');return createDigitalMaterials(doc,{invalidate});
},notify=()=>{}}) {
  const win=doc.defaultView;
  let engine=null,fallback=null,stage=null,pending=null,feedback=null,svg=null,engineSvg=null,frame=null,generation=0,disposed=false,materialTime=0,last=null,hoveredId=null,pointer=[.3,.2],failed=false,inView=true,observedField=null;
  let backgroundChanged=false;
  const allowed=()=>!disposed&&doc.documentElement.dataset.visualMode==='digital'&&!getState().play?.reference;
  const effectsEnabled=()=>doc.documentElement.dataset.effects!=='off';
  function cancelFrame(){if(frame!==null)win.cancelAnimationFrame(frame);frame=null;}
  function stop(){cancelFrame();last=null;}
  function invalidate(){
    if(frame===null&&svg&&!doc.hidden&&inView)frame=win.requestAnimationFrame(update);
  }
  const viewportObserver=typeof win.IntersectionObserver==='function'?new win.IntersectionObserver(changes=>{
    for(const change of changes)if(change.target===observedField){inView=change.isIntersecting;if(!inView)stop();else if(!doc.hidden)sync();}
  },{rootMargin:'150px'}):null;
  const resizeObserver=typeof win.ResizeObserver==='function'?new win.ResizeObserver(invalidate):null;
  function observeField(field){if(field===observedField)return;viewportObserver?.disconnect();observedField=field;inView=true;if(field)viewportObserver?.observe(field);}
  function clear(){stop();observeField(null);resizeObserver?.disconnect();feedback?.destroy();feedback=null;engine?.destroy();fallback?.destroy();engine=null;fallback=null;stage?.classList.remove('is-perspective');stage?.style.removeProperty('--board-projection');stage=null;svg=null;engineSvg=null;backgroundChanged=false;hoveredId=null;}
  function projectStage(){
    if(!svg)return;
    let nextStage=svg.closest('.pitch-stage');
    if(!nextStage){nextStage=doc.createElement('div');nextStage.className='pitch-stage';svg.before(nextStage);nextStage.append(svg);}
    if(nextStage!==stage){resizeObserver?.disconnect();stage=nextStage;resizeObserver?.observe(stage);}
    stage.classList.add('is-perspective');
    const width=stage.clientWidth||1000,height=stage.clientHeight||width*.8;
    const matrix=boardCSSMatrix(width,height);
    if(stage.style.getPropertyValue('--board-projection')!==matrix)stage.style.setProperty('--board-projection',matrix);
  }
  function ensureFallback(state){if(!fallback){fallback=createDigitalFallback(doc);fallback.mount(svg,state.play,state.settings);}}
  function update(stamp){
    frame=null;if(!allowed()||doc.hidden||!inView)return;
    const state=getState(), current=doc.querySelector('#field .pitch-svg');
    if(!current||current.closest('[hidden]')){last=null;return;}
    if(last!==null&&effectsEnabled()&&(!state.rehearsal||state.playing))materialTime+=Math.min((stamp-last)/1000,.1);
    last=stamp;
    if(current!==svg){mount(current,state);return;}
    projectStage();
    drawFrame(state);
  }
  function drawFrame(state,forceRefresh=false){
    const refreshTexture=forceRefresh||backgroundChanged;
    backgroundChanged=false;
    const animated=effectsEnabled();
    const moving=paint(state,animated,refreshTexture);
    // A still scene sleeps. Timeline changes, pointer movement, resize and
    // texture completion can each wake it without starting another loop.
    if(state.playing||moving||animated&&!state.rehearsal&&state.play.zones.length)invalidate();
    else last=null;
  }
  function paint(state,animated,refreshTexture){
    const view={...state,materialTime,animated,hoveredId,pointer};
    feedback?.update(view);
    if(!engine){fallback?.draw(view);return;}
    let moving=false;
    try{moving=engine.draw(view,{refreshTexture})===true;}
    catch(error){failed=true;engine?.destroy();engine=null;engineSvg=null;ensureFallback(state);fallback.draw(view);doc.documentElement.dataset.digitalBoard='unavailable';notify(t('support.fallback'));win.console.warn('Digital board stopped:',error);}
    if(engine){
      const status=engine.status;
      if(status==='unavailable'&&doc.documentElement.dataset.digitalBoard!==status)notify(t('support.fallback_update'));
      doc.documentElement.dataset.digitalBoard=status;
    }
    return moving;
  }
  function mount(current,state){feedback?.destroy();svg=current;projectStage();feedback=createRouteFeedback(svg,state.play);feedback.update({...state,materialTime,animated:effectsEnabled()});if(engine){fallback?.destroy();fallback=null;}else if(fallback)fallback.mount(svg,state.play,state.settings);else ensureFallback(state);engine?.mount(svg,state.play,state.settings);engineSvg=engine?svg:null;backgroundChanged=false;drawFrame(state);}
  async function sync({retry=false,contentChanged=false}={}){
    if(!allowed()){generation++;clear();delete doc.documentElement.dataset.digitalBoard;return;}
    if(retry)failed=false;
    if(typeof win.CanvasRenderingContext2D==='undefined')return;
    const current=doc.querySelector('#field .pitch-svg');if(!current)return;
    observeField(current.closest('#field'));
    if(!engine&&!pending&&!failed){const ticket=++generation;doc.documentElement.dataset.digitalBoard='loading';
      pending=Promise.resolve().then(()=>makeEngine(()=>{if(ticket===generation)invalidate();})).then(value=>{
        if(disposed||ticket!==generation||!allowed()){value.destroy();return;}engine=value;
      }).catch(error=>{if(!disposed&&ticket===generation){failed=true;doc.documentElement.dataset.digitalBoard='unavailable';notify(t('support.fallback'));win.console.warn('Digital board initialization failed:',error);}}).finally(()=>{pending=null;});
    }
    if(pending)await pending;
    if(!allowed())return;
    // A newer digital request may have outlived an obsolete startup.
    if(!engine&&!failed)return sync();
    const next=doc.querySelector('#field .pitch-svg');if(!next)return;
    const state=getState();
    cancelFrame();
    if(next!==svg||(engine&&engineSvg!==next))mount(next,state);
    else {
      projectStage();
      if(contentChanged){feedback?.destroy();feedback=createRouteFeedback(svg,state.play);}
      // Commit feedback and retained pieces now, before the browser can paint.
      drawFrame(state,contentChanged||retry);
    }
  }
  const changed=()=>sync({retry:true});
  const visibility=()=>{if(doc.hidden)stop();else sync();};
  const move=event=>{
    if(!stage||!inView){hoveredId=null;return;}
    const b=stage.getBoundingClientRect(),x=event.clientX-b.left,y=event.clientY-b.top;
    const inside=x>=0&&y>=0&&x<=b.width&&y<=b.height;
    const next=inside?((engine||fallback)?.pick?.(event.clientX,event.clientY)?.id||event.target.closest?.('#field [data-player]')?.dataset.player||null):null;
    if(inside)pointer=[x/(b.width||1),y/(b.height||1)];
    if(next!==hoveredId){hoveredId=next;invalidate();}
  };
  doc.addEventListener('playbook:effects-changed',changed);doc.addEventListener('visibilitychange',visibility);doc.addEventListener('pointermove',move,{passive:true});
  win.addEventListener('resize',invalidate);
  const hide=()=>{generation++;clear();},show=()=>sync();win.addEventListener('pagehide',hide);win.addEventListener('pageshow',show);
  return {sync,
    get backgroundReady(){
      if(!allowed())return true;
      if(pending||!svg||backgroundChanged)return false;
      if(!engine)return !!fallback;
      if(engine.status==='unavailable')return true;
      return engine.backgroundReady??engine.status!=='loading';
    },
    pick(event){return allowed()?(engine||fallback)?.pick?.(event.clientX,event.clientY)||null:null;},
    refreshBackground(){if(!svg)return;backgroundChanged=true;invalidate();},
    capture(){
    if(!allowed()||!svg||!feedback)return null;
    const state=getState();feedback.update({...state,materialTime,animated:doc.documentElement.dataset.effects!=='off'});
    let image=null;
    if(engine&&!backgroundChanged&&engine.backgroundReady!==false&&svg.classList.contains('digital-ready')){
      engine.draw({...state,materialTime,animated:false});image=engine.capture();invalidate();
    }
    return {image,fullScene:!!image&&engine?.fullScene===true,decoration:feedback.layer.outerHTML,time:state.time};},
    destroy(){disposed=true;generation++;clear();viewportObserver?.disconnect();doc.removeEventListener('playbook:effects-changed',changed);doc.removeEventListener('visibilitychange',visibility);doc.removeEventListener('pointermove',move);win.removeEventListener('resize',invalidate);win.removeEventListener('pagehide',hide);win.removeEventListener('pageshow',show);}};
}
