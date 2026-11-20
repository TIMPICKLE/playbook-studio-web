import {sampleClock,round,stats} from './film-clock.js';

const query=new URLSearchParams(location.search);
const isolate=query.has('isolate');
const duration=query.has('quick')?1500:isolate?4500:8000;
const originalRaf=window.requestAnimationFrame.bind(window);
const originalCancel=window.cancelAnimationFrame.bind(window);
const frame=()=>new Promise(resolve=>originalRaf(resolve));
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const panel=document.querySelector('main');
const output=panel.querySelector('pre'),button=panel.querySelector('button'),link=panel.querySelector('a');
const stages=[];
const longFrames=[];
let callbacks=null,backgrounded=document.hidden;
document.addEventListener('visibilitychange',()=>{if(document.hidden)backgrounded=true;});

// The timing probe uses the original display scheduler. Only page/application
// callbacks pass through this timer, and the default acceptance run has no hooks.
const measuredRaf=window.requestAnimationFrame=callback=>originalRaf(stamp=>{
  if (!callbacks) return callback(stamp);
  const metrics=callbacks;
  const name=callback.name||'(anonymous)',start=performance.now();
  try{return callback(stamp);}finally{(metrics[name]??=[]).push(performance.now()-start);}
});
const supportsLoaf=PerformanceObserver.supportedEntryTypes.includes('long-animation-frame');
const collectLongFrame=entry=>({startMs:round(entry.startTime),durationMs:round(entry.duration),blockedMs:round(entry.blockingDuration),
  renderMs:entry.renderStart?round(entry.startTime+entry.duration-entry.renderStart):null,
  styleLayoutAndPaintMs:entry.styleAndLayoutStart?round(entry.startTime+entry.duration-entry.styleAndLayoutStart):null,
  scripts:entry.scripts.slice(0,8).map(script=>({fn:script.sourceFunctionName,source:script.sourceURL.split('/').at(-1),durationMs:round(script.duration),forcedLayoutMs:round(script.forcedStyleAndLayoutDuration)}))});
const observer=supportsLoaf?new PerformanceObserver(list=>longFrames.push(...list.getEntries().map(collectLongFrame))):null;
observer?.observe({type:'long-animation-frame'});
function pageState() {
  return {visibility:document.visibilityState,hasFocus:document.hasFocus(),embedded:window.self!==window.top,visual:document.documentElement.dataset.visualMode||null,
    digitalBackend:document.documentElement.dataset.digitalBoard||null,coachRenderer:document.querySelector('.film-pitch')?.dataset.filmRenderer||null,
    canvases:document.querySelectorAll('canvas').length,originalProbeUnchanged:window.requestAnimationFrame===measuredRaf,
    nodes:document.getElementsByTagName('*').length,styles:[...document.styleSheets].filter(s=>!s.disabled).length,
    runningAnimations:document.getAnimations().filter(a=>a.playState==='running').slice(0,10).map(a=>a.effect?.target?.classList?.value||a.animationName||a.id||'(unnamed)')};
}
function status(value) {output.textContent=value;}
async function sample(name,afterFrame) {
  if(backgrounded)throw Error('Tab was hidden. Reload and repeat in the foreground.');
  status('测量 '+name+' · 保持前台');
  await frame();await frame();
  callbacks={};
  const since=performance.now(),frameAge=[],timerIntervals=[];
  let lastPlayTime,lastTimer=since;
  const timer=setInterval(()=>{const now=performance.now();timerIntervals.push(now-lastTimer);lastTimer=now;},32);
  const schedule=callback=>originalRaf(stamp=>{frameAge.push(performance.now()-stamp);if(afterFrame)lastPlayTime=afterFrame();callback(stamp);});
  let clock;
  try { clock=await sampleClock(duration,schedule,originalCancel); }
  finally {clearInterval(timer);}
  const until=performance.now();
  const entry={name,clock:{frameIntervalMs:clock.frameIntervalMs,over33_3msPercent:clock.over33_3msPercent},
    sampleWindowMs:[since,until],timerIntervalMs:timerIntervals.length?stats(timerIntervals):null,frameAgeMs:stats(frameAge),
    callbackCpuMs:Object.fromEntries(Object.entries(callbacks).map(([k,samples])=>[k,stats(samples)])),
    page:pageState(),lastPlayTime:lastPlayTime??null,
    raw:{clock:clock.raw,cpu:Object.fromEntries(Object.entries(callbacks).map(([k,samples])=>[k,samples.map(round)]))}};
  callbacks=null;stages.push(entry);
}
async function waitFor(selector) {
  const start=performance.now();
  while(!document.querySelector(selector)) {
    if(backgrounded || performance.now()-start>15000)throw Error('Could not open '+selector);
    await pause(20);
  }
  return document.querySelector(selector);
}
async function loadEditor(play) {
  const [html,{encodeWorkspace,starterWorkspace,STORAGE_KEY},{ONBOARDING_STORAGE_KEY},{VISUAL_MODE_KEY}]=await Promise.all([
    fetch('./index.html').then(response=>response.text()),import('./model.js'),import('./onboarding.js'),import('./visual-mode.js')]);
  const entry=new DOMParser().parseFromString(html,'text/html');
  entry.querySelectorAll('script').forEach(node=>node.remove());
  document.body.replaceChildren(...Array.from(entry.body.childNodes,node=>document.importNode(node,true)),panel);
  if(isolate)await sample('static-editor-shell-no-css-or-app');
  const styles=Array.from(entry.querySelectorAll('link[rel=stylesheet]'),node=>new Promise((resolve,reject)=>{
    const link=document.createElement('link');link.rel='stylesheet';link.href=node.getAttribute('href');link.onload=resolve;link.onerror=reject;document.head.append(link);
  }));
  const workspace=starterWorkspace();workspace.plays=[play];
  localStorage.setItem(STORAGE_KEY,encodeWorkspace(workspace));localStorage.setItem(VISUAL_MODE_KEY,'traditional');
  localStorage.setItem(ONBOARDING_STORAGE_KEY,JSON.stringify({dismissed:true,completed:[]}));
  await Promise.all(styles);
  if(isolate) {
    await sample('static-editor-shell-all-css-before-app');
    document.querySelector('#app').style.display='none';
  }
  await import('./app.js');await waitFor('[data-action="coach-film"]');await document.fonts.ready;
}
async function isolateEditor() {
  const app=document.querySelector('#app'),field=document.querySelector('#field');
  const sheets=[...document.styleSheets],names=sheets.map(s=>s.href?.split('/').at(-1)||'(inline)');
  const enable=(indices)=>sheets.forEach((sheet,i)=>{sheet.disabled=!indices.has(i);});
  const all=new Set(sheets.map((_,i)=>i));
  await sample('app-running-editor-display-none-all-css');
  enable(new Set());await sample('app-running-editor-display-none-no-css');
  app.style.display='';await sample('app-running-visible-editor-no-css');
  enable(all);field.style.display='none';await sample('visible-editor-all-css-pitch-removed');
  field.style.display='';await sample('visible-editor-all-css');
  // Locate an independently sufficient stylesheet when the no-CSS version is fast.
  const slow=name=>stages.find(stage=>stage.name===name)?.clock.frameIntervalMs.p50>100;
  if (!slow('app-running-visible-editor-no-css') && slow('visible-editor-all-css')) {
    let candidates=[...all];
    for(let round=1;candidates.length>1;round++) {
      const split=Math.ceil(candidates.length/2),parts=[candidates.slice(0,split),candidates.slice(split)];
      let heavy;
      for(const [i,part] of parts.entries()) {
        enable(new Set(part));const name='css-'+round+'-'+(i+1);await sample(name);stages.at(-1).stylesTested=part.map(j=>names[j]);
        if(slow(name)) {heavy=part;break;}
      }
      if(!heavy)break; // The original effect requires interacting rules from both sets.
      candidates=heavy;
    }
    enable(all);
  }
  // Keep all module/timer registrations alive, with the rendered editor removed.
  const siblings=[...document.body.children].filter(node=>node!==panel);
  const detached=document.createDocumentFragment();siblings.forEach(el=>detached.append(el));enable(new Set());
  try{await sample('app-runtime-alive-empty-document-no-css');}
  finally{document.body.prepend(detached);enable(all);}
}
async function finish(build,input=[]) {
  await pause(100);
  longFrames.push(...(observer?.takeRecords()||[]).map(collectLongFrame));
  for(const entry of stages) {
    const [start,end]=entry.sampleWindowMs;
    const relevant=longFrames.filter(f=>f.startMs>=start && f.startMs<end);
    entry.longFrames={count:relevant.length,longestMs:round(Math.max(0,...relevant.map(f=>f.durationMs)))};
    entry.raw.longFrames=relevant;
  }
  const report={context:{...build,sample:isolate?'editor-isolation':'paired-profile',durationMs:duration,viewport:[innerWidth,innerHeight],dpr:devicePixelRatio,
    userAgent:navigator.userAgent,supportsLongAnimationFrames:supportsLoaf},phases:stages.map(({raw,...stage})=>stage),input,raw:stages.map(({name,raw})=>({name,...raw}))};
  window.coachFilmBenchmark=report;
  const {raw,...summary}=report;status(JSON.stringify(summary,null,2));
  link.href=URL.createObjectURL(new Blob([JSON.stringify(report,null,2)],{type:'application/json'}));link.hidden=false;
}
async function start() {
  button.disabled=true;
  panel.style.cssText='position:fixed;top:.25rem;left:.25rem;z-index:2147483647;max-height:60vh;max-width:90vw;overflow:auto;background:white;color:#222;padding:.4rem;font:12px system-ui';
  const [build,scene]=await Promise.all(['./film-bench-build.json','./film-bench-scene.json'].map(file=>fetch(file).then(response=>response.json())));
  await sample('empty');
  await loadEditor(scene.play);
  if(isolate){await isolateEditor();await finish(build);return;}
  await sample('traditional-editor-idle');
  document.querySelector('[data-effects-mode="digital"]').click();
  await waitFor('html[data-visual-mode="digital"]');await pause(1200);
  await sample('digital-editor-idle');
  document.querySelector('[data-action="coach-film"]').click();
  const dialog=await waitFor('#coach-film-room[open]');
  const pitch=await waitFor('#coach-film-room [data-film-renderer]');
  for(const label of ['H','Y'])dialog.querySelector('[data-film-pick="'+scene.play.players.find(player=>player.label===label).id+'"]').click();
  await sample('coach-idle');
  const playButton=dialog.querySelector('[data-film-action=play]'),range=dialog.querySelector('input[data-film-time]');
  async function playStage(name) {
    range.value='0';range.dispatchEvent(new Event('change',{bubbles:true}));playButton.click();
    await sample(name,()=>{
      const time=Number(pitch.dataset.filmTime);
      if(time>=Number(range.max)-1e-7)playButton.click();
      return time;
    });
    range.value='1';range.dispatchEvent(new Event('change',{bubbles:true}));
  }
  await playStage('coach-playing');
  const app=document.querySelector('#app');
  const initialVisibility=app.style.visibility;
  app.style.visibility='hidden'; // Diagnostic-only suppression of the occluded editor.
  try {await playStage('coach-playing-hidden-editor');}
  finally {app.style.visibility=initialVisibility;}
  const input=[];
  for(const time of [.75,3.25,.5,3.5,.8,2.6]) {
    const start=performance.now();let commitMs;
    const matches=()=>Math.abs(Number(pitch.dataset.filmTime)-time)<=1e-6;
    const record=()=>{if(commitMs==null && matches())commitMs=performance.now()-start;};
    const mutation=new MutationObserver(record);
    mutation.observe(pitch,{attributes:true,attributeFilter:['data-film-time']});
    try {
      range.value=String(time);range.dispatchEvent(new Event('input',{bubbles:true}));
      const afterInput=performance.now();record();
      do{await frame();if(performance.now()-start>4000||backgrounded)throw Error('Seek did not commit in the foreground.');}while(!matches());
      record();
      input.push({eventCpuMs:round(afterInput-start),inputToFieldCommitMs:round(commitMs),inputToObservedFrameMs:round(performance.now()-start)});
    } finally{mutation.disconnect();}
  }
  dialog.querySelector('[data-film-action=exit]').click();
  await finish(build,input);
}
button.onclick=()=>start().catch(error=>{status('ERROR: '+error.message);document.querySelector('#coach-film-room [data-film-action=exit]')?.click();});
button.disabled=false;
if(query.has('run'))button.click();
