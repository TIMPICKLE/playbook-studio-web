import { readFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { cpus } from 'node:os';
import { setImmediate as yieldToLoop } from 'node:timers/promises';
import { Window } from 'happy-dom';
import { createSample, quantify, scenarios } from './sample.js';

const source = pathToFileURL(resolve(process.argv[2]||'web')+sep);
const load = name => import(new URL(name,source));
const [field,routes,{createDigitalFallback},{createDigitalBoard}] = await Promise.all([
  load('field.js'),load('digital-routes.js'),load('digital-fallback.js'),load('digital-board.js')
]);
const win=new Window({url:'http://localhost/local.html',width:1280,height:800});
const doc=win.document;
const state=JSON.parse(await readFile(new URL('mesh.json',import.meta.url),'utf8'));
state.settings.visualMode='digital';
Object.assign(state,{time:0,materialTime:1,animated:true,playing:false,rehearsal:false});
doc.documentElement.dataset.visualMode='digital';
doc.documentElement.dataset.effects='on';
doc.body.innerHTML='<div id="field"><div class="pitch-stage">'+field.fieldSVG(state.play,state.settings)+'</div></div>';
const svg=doc.querySelector('.pitch-svg');
const scene=createDigitalFallback(doc);
scene.mount(svg,state.play,state.settings);
const sample=await createSample({modules:{field,routes},scene,svg,state});
const rows=[];
const samples=36;
try{
  for(let round=0;round<=3;round++)for(const scenario of scenarios){
    sample.reset();sample.paint('still',0,1);
    const cpu=[];let dirty=0;
    for(let i=0;i<samples;i++){
      const start=performance.now();
      dirty+=Number(sample.paint(scenario,i,samples));cpu.push(performance.now()-start);
      await yieldToLoop();
    }
    if(round)rows.push({scenario,cpu,dirty});
  }
  sample.close();sample.reset();
  const frames=new Map();let next=0,draws=0;
  win.CanvasRenderingContext2D=class {};
  win.requestAnimationFrame=fn=>{frames.set(++next,fn);return next;};
  win.cancelAnimationFrame=id=>frames.delete(id);
  const controller=createDigitalBoard({doc,getState:()=>state,makeEngine:async()=>{
    const vector=createDigitalFallback(doc);
    return {...vector,draw(view,options){draws++;return vector.draw(view,options);}};
  }});
  await controller.sync();const initial=draws;
  for(let i=0;i<120;i++){const pending=[...frames.values()];frames.clear();for(const fn of pending)fn((i+1)*1000/60);}
  const idle={drawsAfterMount:draws-initial,queuedAfter120Ticks:frames.size};
  controller.destroy();
  const summary=scenarios.map(scenario=>{const group=rows.filter(r=>r.scenario===scenario);return {scenario,
    cpuMs:quantify(group.flatMap(r=>r.cpu)),dirty:group.reduce((n,row)=>n+row.dirty,0)};});
  console.log(JSON.stringify({node:process.version,cpu:cpus()[0].model,scene:'SVG vector fallback',width:1280,height:800,layout:false,samplesPerCase:samples*3,idle,summary}));
}finally{await win.happyDOM.abort();}
