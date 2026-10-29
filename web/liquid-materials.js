import { createLensPainter } from './liquid-optics.js';
import { createCanvasMetal,createCanvasLensPainter } from './liquid-canvas.js';

const SURFACES='.cloud-bar,.workspace-current-card,.topbar,.draw-tools,.editor-mode,.playback,.inspector,.sidebar,.modal,.book-card,.compact-nav,.field-context,.effects-panel,.madden-panel,.login-panel,.entry-demo,.button.primary,.play-button,.new-play';

// One metal context and one reusable lens context, irrespective of card count.
// Each panel receives a decorative 2D canvas; its real controls stay mounted.
export async function createMaterialEngine(doc=document) {
  const win=doc.defaultView;
  const {ShaderMount,liquidMetalFragmentShader,emptyPixel}=await import('./vendor/paper-shaders-0.0.82/paper-liquid-metal-0.0.82.js');
  const pixel=new win.Image();pixel.src=emptyPixel;await pixel.decode();
  const world=doc.createElement('div');world.id='liquid-metal-world';world.setAttribute('aria-hidden','true');
  doc.querySelector('.atmosphere').prepend(world);
  let metal,painter,renderer='webgl';
  try {
    metal=new ShaderMount(world,liquidMetalFragmentShader,{
      u_image:pixel,u_isImage:false,u_shape:0,u_colorBack:[.03,.032,.036,1],u_colorTint:[.86,.88,.92,1],
      u_contour:.45,u_distortion:.48,u_softness:.11,u_repetition:2.1,u_shiftRed:.20,u_shiftBlue:.32,u_angle:55,
      u_fit:0,u_scale:1.5,u_rotation:0,u_offsetX:0,u_offsetY:0,u_originX:.5,u_originY:.5,u_worldWidth:0,u_worldHeight:0
    },{preserveDrawingBuffer:true,alpha:true,premultipliedAlpha:false},0,9000,Math.max(2,win.devicePixelRatio||1),Infinity);
    painter=createLensPainter(metal.canvasElement,doc);
  } catch(error){
    painter?.dispose();metal?.dispose();world.replaceChildren();renderer='canvas';
    try{metal=createCanvasMetal(world);painter=createCanvasLensPainter(metal.canvasElement,doc);}
    catch(fallbackError){metal?.dispose();world.remove();throw fallbackError;}
    win.console.info('WebGL material unavailable; using animated Canvas material.',error.message);
  }
  world.dataset.renderer=renderer;
  const surfaces=new Map();
  let dirty=true,disposed=false;
  const observer=new win.MutationObserver(()=>{dirty=true;});observer.observe(doc.body,{childList:true,subtree:true});
  function sync(){
    for(const [node,item] of surfaces)if(!node.isConnected||(node.matches('.field-context')&&!node.textContent.trim())){item.canvas.remove();node.classList.remove('liquid-surface','liquid-positioned');surfaces.delete(node);}
    for(const node of doc.querySelectorAll(SURFACES)){
      if(node.matches('.field-context')&&!node.textContent.trim())continue;
      // The inspector's desktop shell is display:contents on compact layouts.
      let item=surfaces.get(node);
      if(!item){const canvas=doc.createElement('canvas');canvas.className='liquid-surface-canvas';canvas.setAttribute('aria-hidden','true');const ctx=canvas.getContext('2d');if(!ctx)continue;item={canvas,ctx};surfaces.set(node,item);}
      if(item.canvas.parentElement!==node)node.prepend(item.canvas);
      node.classList.add('liquid-surface');
      if(win.getComputedStyle(node).position==='static')node.classList.add('liquid-positioned');
    }
    dirty=false;
  }
  doc.documentElement.dataset.material='liquid';
  function destroy(){
    if(disposed)return;disposed=true;observer.disconnect();
    for(const [node,item]of surfaces){item.canvas.remove();node.classList.remove('liquid-surface','liquid-positioned');}
    surfaces.clear();painter.dispose();metal.dispose();world.remove();delete doc.documentElement.dataset.material;
  }
  return {
    draw({time,pointer,pulse}){
      if(disposed)return;
      if(dirty)sync();
      metal.setFrame(9000+time*700);
      painter.begin({width:win.innerWidth,height:win.innerHeight,time,pointer,pulse});
      const dpr=Math.max(1,win.devicePixelRatio||1);
      for(const [node,{canvas,ctx}]of surfaces){
        const rect=node.getBoundingClientRect();
        if(rect.width<1||rect.height<1||rect.right<=0||rect.bottom<=0||rect.left>=win.innerWidth||rect.top>=win.innerHeight||node.hidden)continue;
        const style=win.getComputedStyle(node);
        if(style.visibility==='hidden'||style.display==='none')continue;
        if(!node.classList.contains('liquid-surface')){node.classList.add('liquid-surface');if(style.position==='static')node.classList.add('liquid-positioned');}
        const radius=parseFloat(style.borderTopLeftRadius)||0;
        painter.paint(ctx,rect,{radius,gold:node.matches('.button.primary,.play-button,.new-play'),current:node.matches('.is-current,.workspace-current-card'),dpr});
        canvas.dataset.ready='true';
      }
    },
    destroy
  };
}

export function createMaterialController({doc=document,makeEngine=createMaterialEngine}={}) {
  const win=doc.defaultView;
  let mode='off',engine=null,pending=null,raf=null,disposed=false,generation=0,time=0,last=null;
  let pointer=[win.innerWidth*.65,win.innerHeight*.3],target=[...pointer],pulse=[-1000,-1000,-1000];
  const canRun=()=>!disposed&&mode!=='off'&&!doc.hidden;
  function stop(){if(raf!==null)win.cancelAnimationFrame(raf);raf=null;last=null;}
  function tick(now){
    raf=null;if(!canRun()||!engine)return;
    if(last!==null)time+=Math.min((now-last)/1000,.1);
    last=now;pointer=pointer.map((v,i)=>v+(target[i]-v)*.16);
    try{engine.draw({time,pointer,pulse});}catch(error){win.console.warn('Liquid material rendering stopped:',error);engine.destroy();engine=null;doc.documentElement.dataset.material='fallback';stop();return;}
    raf=win.requestAnimationFrame(tick);
  }
  function start(){if(canRun()&&engine&&raf===null)raf=win.requestAnimationFrame(tick);}
  async function setMode(value){
    mode=value==='full'?'full':'off';
    if(!canRun()){stop();return;}
    if(engine){start();return;}
    if(!pending){const ticket=++generation;pending=Promise.resolve().then(()=>makeEngine(doc)).then(value=>{if(disposed||ticket!==generation){value.destroy();return;}engine=value;start();}).catch(error=>{if(!disposed){win.console.warn('Liquid material initialization failed:',error);doc.documentElement.dataset.material='fallback';}}).finally(()=>{pending=null;});}
    await pending;start();
  }
  const move=event=>{target=[event.clientX,event.clientY];};
  const down=event=>{move(event);if(mode==='full')pulse=[event.clientX,event.clientY,time];};
  const visibility=()=>{if(doc.hidden)stop();else setMode(mode);};
  const changed=event=>setMode(event.detail.mode);
  doc.addEventListener('pointermove',move,{passive:true});doc.addEventListener('pointerdown',down,{passive:true});
  doc.addEventListener('visibilitychange',visibility);doc.addEventListener('playbook:effects-changed',changed);
  return {setMode,destroy(){if(disposed)return;disposed=true;generation++;stop();engine?.destroy();engine=null;doc.removeEventListener('pointermove',move);doc.removeEventListener('pointerdown',down);doc.removeEventListener('visibilitychange',visibility);doc.removeEventListener('playbook:effects-changed',changed);}};
}

export function initLiquidMaterials(){
  if(typeof window.CanvasRenderingContext2D==='undefined')return null;
  const controller=createMaterialController();controller.setMode(document.documentElement.dataset.effects||'full');
  window.addEventListener('pagehide',()=>controller.setMode('off'));
  window.addEventListener('pageshow',()=>controller.setMode(document.documentElement.dataset.effects||'full'));
  return controller;
}
