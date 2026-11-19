import { t } from './i18n.js';
import { createRouteFeedback } from './digital-routes.js';
import { boardCSSMatrix } from './digital-projection.js';
import { createDigitalFallback } from './digital-fallback.js';

export function createDigitalBoard({doc=document,getState,isGestureActive=()=>false,makeEngine=async invalidate=>{
  const {createDigitalMaterials}=await import('./digital-materials.js');return createDigitalMaterials(doc,{invalidate});
},notify=()=>{}}) {
  const win=doc.defaultView;
  let engine=null,fallback=null,stage=null,pending=null,feedback=null,svg=null,engineSvg=null,frame=null,generation=0,disposed=false,materialTime=0,last=null,hoveredId=null,pointer=[.3,.2],failed=false,inView=true,observedField=null;
  let backgroundChanged=false,contentDirty=false,projectionDirty=true;
  const allowed=()=>!disposed&&doc.documentElement.dataset.visualMode==='digital'&&!getState().play?.reference;
  const effectsEnabled=()=>doc.documentElement.dataset.effects!=='off';
  function cancelFrame(){if(frame!==null)win.cancelAnimationFrame(frame);frame=null;}
  function stop(){cancelFrame();last=null;projectionDirty=true;}
  function invalidate(){
    if(frame===null&&svg&&!doc.hidden&&inView&&!getState().playing)frame=win.requestAnimationFrame(update);
  }
  const viewportObserver=typeof win.IntersectionObserver==='function'?new win.IntersectionObserver(changes=>{
    for(const change of changes)if(change.target===observedField){inView=change.isIntersecting;if(!inView)stop();else if(!doc.hidden)sync();}
  },{rootMargin:'150px'}):null;
  function invalidateProjection(){projectionDirty=true;invalidate();}
  const resizeObserver=typeof win.ResizeObserver==='function'?new win.ResizeObserver(invalidateProjection):null;
  function observeField(field){if(field===observedField)return;viewportObserver?.disconnect();observedField=field;inView=true;if(field)viewportObserver?.observe(field);}
  function clear(){stop();observeField(null);resizeObserver?.disconnect();feedback?.destroy();feedback=null;engine?.destroy();fallback?.destroy();engine=null;fallback=null;stage?.classList.remove('is-perspective');stage?.style.removeProperty('--board-projection');stage=null;svg=null;engineSvg=null;backgroundChanged=false;contentDirty=false;hoveredId=null;}
  function projectStage(){
    if(!svg)return;
    let nextStage=svg.closest('.pitch-stage');
    if(!nextStage){nextStage=doc.createElement('div');nextStage.className='pitch-stage';svg.before(nextStage);nextStage.append(svg);}
    if(nextStage!==stage){
      resizeObserver?.disconnect();stage=nextStage;stage.classList.add('is-perspective');
      resizeObserver?.observe(stage);projectionDirty=true;
    }
    // Without element resize notifications a CSS-only zoom or panel resize
    // still needs a fresh measurement, even when the window size is unchanged.
    if(resizeObserver&&!projectionDirty)return;
    projectionDirty=false;
    const width=stage.clientWidth||1000,height=stage.clientHeight||width*.8;
    const matrix=boardCSSMatrix(width,height);
    if(stage.style.getPropertyValue('--board-projection')!==matrix)stage.style.setProperty('--board-projection',matrix);
  }
  function ensureFallback(state){if(!fallback){fallback=createDigitalFallback(doc);fallback.mount(svg,state.play,state.settings);}}
  function update(stamp){
    frame=null;if(!allowed()||doc.hidden||!inView)return;
    const state=getState(), current=doc.querySelector('#field .pitch-svg');
    if(!current||current.closest('[hidden]')){stop();return;}
    if(last!==null&&effectsEnabled()&&!state.rehearsal)materialTime+=Math.min(Math.max(0,stamp-last)/1000,.1);
    last=stamp;
    if(current!==svg){mount(current,state);return;}
    projectStage();
    drawFrame(state);
  }
  // The editor owns both the gesture frame and the rehearsal clock. Present
  // its SVG geometry, feedback and raised pieces together before this paint.
  function presentFrame(stamp=win.performance.now(),fieldChanged=false){
    if(!svg)return;
    if(fieldChanged)backgroundChanged=true;
    if(!allowed()||doc.hidden||!inView)return;
    cancelFrame();
    update(stamp);
  }
  function drawFrame(state,forceRefresh=false){
    const refreshTexture=forceRefresh||backgroundChanged;
    backgroundChanged=false;
    const animated=effectsEnabled();
    const moving=paint(state,animated,refreshTexture);
    // A still scene sleeps. Timeline changes, pointer movement, resize and
    // texture completion can each wake it without starting another loop.
    if(moving&&!state.playing)invalidate();
    else last=null;
  }
  function paint(state,animated,refreshTexture){
    const view={...state,materialTime:state.rehearsal?state.time:materialTime,animated,hoveredId,pointer};
    const focusChanged=feedback?.update(view);
    if(!engine){fallback?.draw(view);return;}
    let moving=false;
    try{moving=engine.draw(view,{refreshTexture:refreshTexture||focusChanged})===true;}
    catch(error){failed=true;engine?.destroy();engine=null;engineSvg=null;ensureFallback(state);fallback.draw(view);doc.documentElement.dataset.digitalBoard='unavailable';notify(t('support.fallback'));win.console.warn('Digital board stopped:',error);}
    if(engine){
      const status=engine.status;
      if(status==='unavailable'&&doc.documentElement.dataset.digitalBoard!==status)notify(t('support.fallback_update'));
      doc.documentElement.dataset.digitalBoard=status;
    }
    return moving;
  }
  function mount(current,state){feedback?.destroy();svg=current;projectStage();feedback=createRouteFeedback(svg,state.play);feedback.update({...state,materialTime,animated:effectsEnabled()});if(engine){fallback?.destroy();fallback=null;}else if(fallback)fallback.mount(svg,state.play,state.settings);else ensureFallback(state);engine?.mount(svg,state.play,state.settings,state.time);engineSvg=engine?svg:null;backgroundChanged=false;drawFrame(state);}
  async function sync({retry=false,contentChanged=false}={}){
    if(!allowed()){generation++;clear();delete doc.documentElement.dataset.digitalBoard;return;}
    if(retry)failed=false;
    if(typeof win.CanvasRenderingContext2D==='undefined')return;
    const current=doc.querySelector('#field .pitch-svg');if(!current)return;
    observeField(current.closest('#field'));
    if(contentChanged)contentDirty=true;
    if(retry)backgroundChanged=true;
    if(doc.hidden||!inView||current.closest('[hidden]')){stop();return;}
    if(!engine&&!pending&&!failed){const ticket=++generation;doc.documentElement.dataset.digitalBoard='loading';
      pending=Promise.resolve().then(()=>makeEngine(()=>{if(ticket===generation)invalidate();})).then(value=>{
        if(disposed||ticket!==generation||!allowed()){value.destroy();return;}engine=value;
      }).catch(error=>{if(!disposed&&ticket===generation){failed=true;doc.documentElement.dataset.digitalBoard='unavailable';notify(t('support.fallback'));win.console.warn('Digital board initialization failed:',error);}}).finally(()=>{pending=null;});
    }
    if(pending)await pending;
    if(!allowed()||doc.hidden||!inView)return;
    // A newer digital request may have outlived an obsolete startup.
    if(!engine&&!failed)return sync();
    const next=doc.querySelector('#field .pitch-svg');if(!next||next.closest('[hidden]'))return;
    const state=getState();
    cancelFrame();
    const rebuildFeedback=contentDirty;
    contentDirty=false;
    if(next!==svg||(engine&&engineSvg!==next))mount(next,state);
    else {
      projectStage();
      if(rebuildFeedback){feedback?.destroy();feedback=createRouteFeedback(svg,state.play);}
      // Commit feedback and retained pieces now, before the browser can paint.
      drawFrame(state,rebuildFeedback);
    }
  }
  const changed=()=>sync({retry:true});
  const visibility=()=>{if(doc.hidden)stop();else sync();};
  const move=event=>{
    if(isGestureActive())return;
    if(!stage||!inView){hoveredId=null;return;}
    const b=stage.getBoundingClientRect(),x=event.clientX-b.left,y=event.clientY-b.top;
    const inside=x>=0&&y>=0&&x<=b.width&&y<=b.height;
    const next=inside?((engine||fallback)?.pick?.(event.clientX,event.clientY)?.id||event.target.closest?.('#field [data-player]')?.dataset.player||null):null;
    if(inside)pointer=[x/(b.width||1),y/(b.height||1)];
    if(next!==hoveredId){hoveredId=next;invalidate();}
  };
  doc.addEventListener('playbook:effects-changed',changed);doc.addEventListener('visibilitychange',visibility);doc.addEventListener('pointermove',move,{passive:true});
  win.addEventListener('resize',invalidateProjection);
  const hide=()=>{generation++;clear();},show=()=>sync();win.addEventListener('pagehide',hide);win.addEventListener('pageshow',show);
  return {sync,invalidate,presentFrame,presentTimeline:presentFrame,
    deferPendingFrame(){
      // Place an earlier material/texture callback after the newly scheduled
      // gesture. presentFrame consumes it if the sampled geometry changed.
      if(frame!==null){cancelFrame();invalidate();}
    },
    finishGesture(event){
      if(event?.type==='pointerup'&&event.pointerType!=='touch')move(event);
      else if(hoveredId!==null){hoveredId=null;invalidate();}
    },
    get backgroundReady(){
      if(!allowed())return true;
      if(pending||!svg||backgroundChanged||contentDirty)return false;
      if(!engine)return !!fallback;
      if(engine.status==='unavailable')return true;
      return engine.backgroundReady??engine.status!=='loading';
    },
    pick(event){return allowed()?(engine||fallback)?.pick?.(event.clientX,event.clientY)||null:null;},
    refreshBackground(){if(!svg)return;backgroundChanged=true;invalidate();},
    capture(){
      if(!allowed()||!svg||!feedback)return null;
      if(!doc.hidden&&inView&&!svg.closest('[hidden]'))projectStage();
      const state=getState();
      const view={...state,materialTime:state.rehearsal?state.time:materialTime,animated:effectsEnabled(),hoveredId,pointer};
      const focusChanged=feedback.update(view);
      let image=null;
      if(engine&&!backgroundChanged&&!contentDirty&&engine.backgroundReady!==false&&svg.classList.contains('digital-ready')){
        try {
          // An export needs the exact time, even between sampled playback textures.
          engine.draw({...view,playing:false},{refreshTexture:focusChanged});
          if(engine.backgroundReady!==false)image=engine.capture();
        } catch {
          // WebGL may lose its drawing buffer after the download dialog opens.
          // The SVG frame below still has the committed geometry and clock.
        } finally {invalidate();}
      }
      return {image,fullScene:!!image&&engine?.fullScene===true,decoration:feedback.layer.outerHTML,time:state.time};
    },
    destroy(){disposed=true;generation++;clear();viewportObserver?.disconnect();doc.removeEventListener('playbook:effects-changed',changed);doc.removeEventListener('visibilitychange',visibility);doc.removeEventListener('pointermove',move);win.removeEventListener('resize',invalidateProjection);win.removeEventListener('pagehide',hide);win.removeEventListener('pageshow',show);}};
}
