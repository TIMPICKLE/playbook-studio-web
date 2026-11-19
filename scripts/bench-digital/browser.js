import { createSample, quantify, scenarios } from './sample.js';
import * as field from './web/field.js';
import * as routes from './web/digital-routes.js';
import { createDigitalFallback } from './web/digital-fallback.js';
import { boardCSSMatrix } from './web/digital-projection.js';

const el = id => document.getElementById(id);
const state=await (await fetch('./mesh.json')).json();
state.settings.visualMode='digital';
const stage=document.querySelector('.pitch-stage');
const nativeFrame = () => new Promise(resolve=>requestAnimationFrame(resolve));
const options = new URLSearchParams(location.search);
if(options.get('theme')==='light')state.settings.fieldTheme='light';
if (field.digitalFieldChrome) el('field').style.cssText = field.digitalFieldChrome(state.settings.fieldTheme);
const counts = { rasterJobs:0, fieldUploads:0, drawCalls:0 };
const originalSerialize = XMLSerializer.prototype.serializeToString;
XMLSerializer.prototype.serializeToString=function(node) {
  if(node.localName==='svg' && node.getAttribute('width')==='2000' && node.getAttribute('height')==='1600') counts.rasterJobs++;
  return originalSerialize.call(this,node);
};
if (window.WebGL2RenderingContext) {
  const proto = WebGL2RenderingContext.prototype;
  for (const name of ['drawArrays','drawElements','drawArraysInstanced','drawElementsInstanced','texImage2D','texSubImage2D']) {
    const native=proto[name];if(!native)continue;
    proto[name]=function(...args) {
      if(name.startsWith('draw'))counts.drawCalls++;
      else if(args.some(arg=>arg instanceof HTMLCanvasElement && arg.width===2000 && arg.height===1600))counts.fieldUploads++;
      return native.apply(this,args);
    };
  }
}
function mountSvg(){
  stage.style.setProperty('--board-projection',boardCSSMatrix(stage.clientWidth,stage.clientHeight));
  const old=stage.querySelector('.pitch-svg');const template=document.createElement('template');
  template.innerHTML=field.fieldSVG(state.play,state.settings);
  const svg=template.content.firstElementChild;
  if(old)old.replaceWith(svg);else stage.append(svg);
  return svg;
}
let sample,scene,renderer='three',gpu=null,gl=null,timer=null,initFailure=null,renderPose=null;
try {
  if(options.get('renderer')==='vector')throw Error('Vector requested');
  const {createDigitalMaterials}=await import('./web/digital-materials.js');
  scene=createDigitalMaterials(document,{invalidate(){if(renderPose) requestAnimationFrame(()=>{if(renderPose)scene.draw(state);});}});
} catch(error){initFailure=String(error);scene=createDigitalFallback(document);renderer='vector';}
let svg=mountSvg();scene.mount(svg,state.play,state.settings);
sample=await createSample({modules:{field,routes},scene,state,svg});
function show(name){renderPose=name;sample.pose(name);}
show('formation');
if(renderer==='three'){
  gl=stage.querySelector('canvas')?.getContext('webgl2');
  const dbg=gl?.getExtension('WEBGL_debug_renderer_info');
  timer=gl?.getExtension('EXT_disjoint_timer_query_webgl2');
  gpu=dbg?gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL):gl?.getParameter(gl.RENDERER);
}
el('progress').textContent='Ready · '+renderer;el('run').disabled=false;
for(const button of document.querySelectorAll('[data-pose]'))button.onclick=async()=>{
  if(el('run').disabled)return;
  if(button.dataset.pose==='theme'){
    state.settings.fieldTheme=state.settings.fieldTheme==='light'?'dark':'light';
    sample.close();location.search='?renderer='+encodeURIComponent(renderer)+'&theme='+state.settings.fieldTheme;
  } else show(button.dataset.pose);
};
el('run').onclick=async()=>{
  if(document.hidden){el('progress').textContent='Bring this tab to the foreground';return;}
  el('run').disabled=true;renderPose=null;
  const rows=[],samples=6,pending=[];
  let hidden=document.hidden,disjoint=false;
  function collectGpu(){
    if(!timer)return;
    if(gl.getParameter(timer.GPU_DISJOINT_EXT)){
      disjoint=true;
      for(const entry of pending)gl.deleteQuery(entry.query);
      pending.length=0;
      return;
    }
    for(let i=pending.length-1;i>=0;i--){
      const {query,values}=pending[i];
      if(gl.getQueryParameter(query,gl.QUERY_RESULT_AVAILABLE)){
        values.push(gl.getQueryParameter(query,gl.QUERY_RESULT)/1e6);
        gl.deleteQuery(query);pending.splice(i,1);
      }
    }
  }
  const changed=()=>{hidden ||= document.hidden;};document.addEventListener('visibilitychange',changed);
  try{
    for(let run=0;run<=3;run++)for(const scenario of scenarios) {
      el('progress').textContent=(run===0?'Warm-up':'Round '+run)+' · '+scenario;
      sample.reset();sample.paint('still',0,1);let previous=await nativeFrame();
      const start={...counts},cpu=[],interval=[],gpuTimes=[];let dirty=0;
      for(let i=0;i<samples;i++){
        const query=run>0 && timer ? gl.createQuery() : null;
        if(query)gl.beginQuery(timer.TIME_ELAPSED_EXT,query);
        const t=performance.now();dirty+=Number(sample.paint(scenario,i,samples));cpu.push(performance.now()-t);
        if(query){gl.endQuery(timer.TIME_ELAPSED_EXT);pending.push({query,values:gpuTimes});}
        const frame=await nativeFrame();interval.push(frame-previous);previous=frame;collectGpu();
      }
      if(run)rows.push({run,scenario,cpu,interval,gpuTimes,dirty,rasterJobs:counts.rasterJobs-start.rasterJobs,fieldUploads:counts.fieldUploads-start.fieldUploads,drawCalls:counts.drawCalls-start.drawCalls});
    }
    for(let i=0;i<12 && pending.length;i++){await nativeFrame();collectGpu();}
    const summary=scenarios.map(scenario=>{
      const set=rows.filter(row=>row.scenario===scenario),sum=k=>set.reduce((n,row)=>n+row[k],0);
      return {scenario,cpuMs:quantify(set.flatMap(r=>r.cpu)),rafMs:quantify(set.flatMap(r=>r.interval)),gpuMs:disjoint?null:quantify(set.flatMap(r=>r.gpuTimes)),gpuSamples:disjoint?0:set.flatMap(r=>r.gpuTimes).length,dirty:sum('dirty'),rasterJobs:sum('rasterJobs'),fieldUploads:sum('fieldUploads'),drawCalls:sum('drawCalls')};
    });
    const result={browser:navigator.userAgent,dpr:devicePixelRatio,viewport:[innerWidth,innerHeight],stage:[stage.clientWidth,stage.clientHeight],renderer,gpu,hasGpuTimer:!!timer,disjoint,initFailure,hidden,summary};
    el('result').textContent=JSON.stringify(result);el('progress').textContent='Complete · '+renderer;
  }catch(error){el('result').textContent=error.stack;el('progress').textContent='Failed';}
  finally{for(const item of pending)gl.deleteQuery(item.query);document.removeEventListener('visibilitychange',changed);el('run').disabled=false;show('formation');}
};
