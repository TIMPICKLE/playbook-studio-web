// Copied only into an isolated QA page. Drive the same editor entry, range and player
// buttons as the public product; expose raw samples so machine-level traces can be joined.
import { encodeWorkspace, starterWorkspace, STORAGE_KEY } from './model.js';
import { ONBOARDING_STORAGE_KEY } from './onboarding.js';
import { VISUAL_MODE_KEY } from './visual-mode.js';
import { stats, round, sampleClock, frameSummary } from './film-clock.js';
import { sampleDrag, dragSummary } from './pointer-trial.js';

const normalEntry=new URL(import.meta.url).searchParams.has('normal-entry');
const query = new URLSearchParams(normalEntry?sessionStorage.getItem('coach-film-normal-entry:'+new URL('.',location.href).pathname):location.search);
const forcedSvg = query.get('renderer') === 'svg';
const quick = query.has('quick');
const panel = document.createElement('section');
panel.style.cssText = 'position:fixed;z-index:2147483647;inset:1rem auto auto 1rem;max-width:90vw;max-height:85vh;overflow:auto;background:white;color:#222;padding:1rem;font:14px system-ui';
panel.innerHTML = '<label>讲解台性能验收 <button type="button" disabled>开始测量</button></label><a hidden download="coach-film-performance.json"> 下载逐帧数据</a><pre id="film-bench-result" style="white-space:pre-wrap" role="status">正在启动编辑器</pre>';
document.body.append(panel);
const resultNode = panel.querySelector('pre');
const runButton = panel.querySelector('button');
const link = panel.querySelector('a');
const readJson = path => fetch(path, {cache:'no-store'}).then(res => {
  if (!res.ok) throw Error(path + ' • HTTP ' + res.status);
  return res.json();
});
function waitFor(selector) {
  const current = document.querySelector(selector);
  if (current) return Promise.resolve(current);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {observer.disconnect();reject(Error('Missing ' + selector));}, 12000);
    const observer = new MutationObserver(() => {
      const el = document.querySelector(selector);
      if (el) {clearTimeout(timer);observer.disconnect();resolve(el);}
    });
    observer.observe(document.body,{subtree:true, childList:true, attributes:true});
  });
}

const contexts = new Map();
const originalContext = HTMLCanvasElement.prototype.getContext;
HTMLCanvasElement.prototype.getContext = function(kind, ...args) {
  if (forcedSvg && ['webgl2','webgl','experimental-webgl'].includes(kind)) return null;
  const gl = originalContext.call(this, kind, ...args);
  if (gl && ['webgl2','webgl','experimental-webgl'].includes(kind)) contexts.set(this, gl);
  return gl;
};

async function measure({build,play}) {
  let interrupted = document.hidden, cancelWait = null, dialog;
  const focusChanges = [{atMs:performance.now(),hasFocus:document.hasFocus()}];
  const recordFocus = () => focusChanges.push({atMs:performance.now(),hasFocus:document.hasFocus()});
  const hiddenError = () => Error('Tab hidden during sampling. Restart and keep this tab in the foreground.');
  const hidden = () => {
    if (!document.hidden) return;
    interrupted = true;
    cancelWait?.();
  };
  function check() {
    if (interrupted) throw hiddenError();
    if (dialog && !dialog.open) throw Error('Film room closed during sampling.');
  }
  function waitVisible(schedule, cancel) {
    check();
    return new Promise((resolve,reject)=>{
      const handle=schedule(stamp=>{cancelWait=null;resolve(stamp);});
      cancelWait=()=>{cancel(handle);cancelWait=null;reject(hiddenError());};
    });
  }
  const nextFrame = () => waitVisible(callback=>requestAnimationFrame(callback),id=>cancelAnimationFrame(id));
  document.addEventListener('visibilitychange', hidden);
  window.addEventListener('focus',recordFocus);
  window.addEventListener('blur',recordFocus);
  try {
    check();
    const enter=document.querySelector('[data-action="coach-film"]');
    if (!enter || enter.disabled) throw Error('Coach film is unavailable on this device.');
    const clockStages=[],stageSamples=[];
    const entryState=normalEntry?{readyState:document.readyState,fonts:document.fonts?.status,automatic:query.has('run'),
      visual:document.documentElement.dataset.visualMode,loadedAtMs:round(performance.getEntriesByType('navigation')[0]?.loadEventEnd||0),
      observedAtMs:round(performance.now()),path:location.pathname.split('/').at(-1)}:null;
    async function clockStage(name) {
      if (!normalEntry)return;
      const {raw,...timing}=await sampleClock(quick?1200:6500);
      clockStages.push({name,readyState:document.readyState,visibility:document.visibilityState,hasFocus:document.hasFocus(),...timing});
      stageSamples.push({name,frameIntervalMs:raw});
    }
    if (normalEntry) {
      if(document.readyState!=='complete'||document.fonts?.status!=='loaded')throw Error('The editor did not finish normal startup before measurement.');
      enter.scrollIntoView({block:'center',inline:'nearest',behavior:'instant'});
      await nextFrame();
      const bounds=enter.getBoundingClientRect(),x=bounds.x+bounds.width/2,y=bounds.y+bounds.height/2;
      entryState.visibleLaunchTarget=bounds.width>0 && bounds.height>0 && enter.contains(document.elementFromPoint(x,y));
      if(!entryState.visibleLaunchTarget)throw Error('The actual entry button is obscured.');
    }
    await clockStage('normal-editor-idle');
    enter.click();
    dialog = await waitFor('#coach-film-room[open]');
    const pitch = await waitFor('#coach-film-room [data-film-renderer]');
    const range = dialog.querySelector('[data-film-time][type=range]');
    const playButton = dialog.querySelector('[data-film-action=play]');
    check();
    const actors=pitch.querySelectorAll('[data-film-player]').length;
    if (actors!==22 || actors!==play.players.length || play.routes.length!==10) throw Error('Incorrect field workload. Expected 22 players and 10 routes.');
    for (const label of ['H','Y']) {
      const id = play.players.find(actor=>actor.label===label).id;
      dialog.querySelector('[data-film-pick="'+id+'"]').click();
    }
    if (pitch.querySelectorAll('[data-film-player][aria-pressed="true"]').length!==2) throw Error('The two focus players were not selected.');
    const renderer=pitch.dataset.filmRenderer;
    const checkField = () => {
      check();
      if (pitch.dataset.filmRenderer!==renderer) throw Error('The renderer changed during sampling. Run each renderer separately.');
    };
    const markerTime = () => {
      const attribute = pitch.getAttribute('data-film-time');
      return attribute === null ? NaN : Number(attribute);
    };
    await clockStage('coach-open-idle');
    async function seek(time) {
      checkField();
      const start = performance.now();
      let commitMs=null;
      const matches=()=>Number.isFinite(markerTime()) && Math.abs(markerTime()-time)<=1e-6;
      const recordCommit=()=>{if(commitMs==null && matches())commitMs=performance.now()-start;};
      const observer=new MutationObserver(recordCommit);
      observer.observe(pitch,{attributes:true,attributeFilter:['data-film-time']});
      try {
        range.value = String(time);
        range.dispatchEvent(new Event('input', {bubbles:true}));
        recordCommit();
        do {
          await nextFrame();
          checkField();
          if (!matches() && performance.now()-start > 3000) throw Error('No rAF observed a matching field time for '+time);
        } while (!matches());
        recordCommit();
        return {commitMs,observedMs:performance.now()-start};
      } finally {observer.disconnect();}
    }
    await seek(1);
    for (let i=0; i<12; i++) await seek(i%2 ? .75 : 2.75);
    async function playback(durationMs) {
      await seek(0);
      playButton.click();
      const intervals = [];
      const startTime = await nextFrame();
      let prior = startTime, end = startTime, previousModel = markerTime(), modelSecondsAdvanced=0;
      while (end - startTime < durationMs) {
        end = await nextFrame();
        checkField();
        intervals.push(end-prior); prior=end;
        const modelTime=markerTime();
        if (!Number.isFinite(modelTime)) throw Error('The field did not expose its committed play time.');
        if (modelTime>previousModel) modelSecondsAdvanced+=modelTime-previousModel;
        previousModel=modelTime;
        if (modelTime >= Number(range.max)-1e-7) {
          playButton.click();
          previousModel = markerTime();
        }
      }
      if (modelSecondsAdvanced<=0) throw Error('The play stopped advancing during the playback sample.');
      return {intervals,modelSecondsAdvanced};
    }
    await playback(quick ? 250 : 2000);
    const trials = [];
    for (let step = 0; step < (quick ? 1 : 3); step++) {
      const {intervals,modelSecondsAdvanced} = await playback(quick ? 2500 : 30000);
      const latencies = [],commitLatencies=[];
      const times = [.26,4.25,1.0,3.0,.75,2.25,.5,3.5];
      for (let i=0; i<(quick ? 8 : 32); i++) {
        const {commitMs,observedMs}=await seek(times[i%times.length]);
        commitLatencies.push(commitMs);latencies.push(observedMs);
      }
      const native = query.get('gesture') === 'native';
      const instruction = document.createElement('p');
      if (native) {
        instruction.textContent = `第 ${step+1} 轮 · 按住时间轴滑块并连续拖动一段距离，再松开。`;
        dialog.querySelector('.film-transport').prepend(instruction);
      }
      let drag;
      try { drag = await sampleDrag(range,pitch,{native,count:quick ? 12 : 32}); }
      finally { instruction.remove(); }
      checkField();
      trials.push({intervals,latencies,commitLatencies,drag,summary:{
        modelSecondsAdvanced,
        ...frameSummary(intervals),
        inputToMatchingRafMs:stats(latencies),
        inputToFieldCommitMs:stats(commitLatencies),
        drag:dragSummary(drag,stats),
      }});
    }
    const idleMs = quick ? 1000 : 10000;
    const idleCalls = {domChanges:0, glCommands:0};
    const observer = new MutationObserver(records=>{idleCalls.domChanges+=records.length;});
    const fieldGl = [...contexts].find(([canvas])=>pitch.contains(canvas))?.[1];
    const undo = [];
    try {
      for (const name of ['clear','drawArrays','drawElements','drawArraysInstanced','drawElementsInstanced','blitFramebuffer']) {
        if (fieldGl && typeof fieldGl[name]==='function') {
          const original = fieldGl[name];
          const descriptor = Object.getOwnPropertyDescriptor(fieldGl,name);
          fieldGl[name] = function(...args){idleCalls.glCommands++;return original.apply(this,args);};
          undo.push(()=>{if(descriptor)Object.defineProperty(fieldGl,name,descriptor);else delete fieldGl[name];});
        }
      }
      observer.observe(pitch,{subtree:true,attributes:true,childList:true,characterData:true});
      await waitVisible(callback=>setTimeout(callback,idleMs),clearTimeout);
      checkField();
    } finally {
      observer.disconnect();
      for (const restore of undo) restore();
    }
    const box=pitch.getBoundingClientRect();
    const gpuInfo=fieldGl?.getExtension('WEBGL_debug_renderer_info');
    return {
      context:{...build,schemaVersion:2,sample:quick?'smoke':'full',startup:normalEntry?'normal-app-entry':'driver-started-app',entryState,renderer:[renderer],forcedSvg,
        userAgent:navigator.userAgent,graphics:gpuInfo?fieldGl.getParameter(gpuInfo.UNMASKED_RENDERER_WEBGL):null,
        visibility:document.visibilityState,hasFocus:document.hasFocus(),focusChanges,embedded:window.self!==window.top,timeOrigin:performance.timeOrigin,
        viewport:[innerWidth,innerHeight],pixelRatio:devicePixelRatio,fieldSize:[round(box.width),round(box.height)],
        players:play.players.length,routes:play.routes.length,focus:['H','Y'],machine:query.get('machine')||null},
      rounds:trials.map(t=>t.summary),
      ...(normalEntry ? {clockStages,rawClockStages:stageSamples} : {}),
      idle:{durationMs:idleMs,...idleCalls,glObserved:!!fieldGl},
      raw:trials.map(({intervals,latencies,commitLatencies,drag})=>({frameIntervalMs:intervals,inputToMatchingRafMs:latencies,inputToFieldCommitMs:commitLatencies,drag})),
    };
  } finally {
    document.removeEventListener('visibilitychange',hidden);
    window.removeEventListener('focus',recordFocus);
    window.removeEventListener('blur',recordFocus);
    dialog?.querySelector('[data-film-action=exit]')?.click();
  }
}

async function startBenchmark() {
  const [build,{play}] = await Promise.all([readJson('./film-bench-build.json'),readJson('./film-bench-scene.json')]);
  if (!normalEntry) {
    const workspace=starterWorkspace();workspace.plays=[play];
    localStorage.setItem(STORAGE_KEY,encodeWorkspace(workspace));
    localStorage.setItem(VISUAL_MODE_KEY,'digital');
    localStorage.setItem(ONBOARDING_STORAGE_KEY,JSON.stringify({dismissed:true,completed:[]}));
    await import('./app.js');
  }
  await waitFor('[data-action="coach-film"]');
  await document.fonts?.ready;
  resultNode.textContent = quick ? '已就绪 · 快速自检' : '已就绪 · 三轮各 30 秒，保持此标签前台';
  runButton.disabled=false;
  runButton.onclick=async () => {
    runButton.disabled=true;
    if (link.hasAttribute('href')) URL.revokeObjectURL(link.href);
    link.removeAttribute('href');
    link.hidden=true;
    delete window.coachFilmBenchmark;
    resultNode.textContent='测量进行中 · 保持前台';
    if(normalEntry)panel.hidden=true;
    try {
      const report=await measure({build,play});
      window.coachFilmBenchmark=report;
      const {raw,rawClockStages, ...summary}=report;
      resultNode.textContent=JSON.stringify(summary,null,2);
      try {
        link.href=URL.createObjectURL(new Blob([JSON.stringify(report,null,2)],{type:'application/json'}));
        link.hidden=false;
      } catch { resultNode.textContent+='\n下载不可用 · 完整数据保留在 window.coachFilmBenchmark'; }
    } catch (error) {resultNode.textContent='ERROR: '+error.message;}
    finally {panel.hidden=false;runButton.disabled=false;}
  };
  if (query.has('run')) runButton.click();
}
startBenchmark().catch(error=>{resultNode.textContent='ERROR: '+error.message;});
