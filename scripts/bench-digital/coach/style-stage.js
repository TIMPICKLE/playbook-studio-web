import {sampleClock,round,stats} from './film-clock.js';

const paths=new URL('.',location.href).pathname;
const runKey='coach-film-style-diagnostic:'+paths;
const load=()=>JSON.parse(sessionStorage.getItem(runKey)||'null');
const save=run=>sessionStorage.setItem(runKey,JSON.stringify(run));
const json=path=>fetch(path).then(r=>{if(!r.ok)throw Error('HTTP '+r.status+' '+path);return r.json();});
const params=new URLSearchParams(location.search);
const marker=document.querySelector('meta[name="film-style-case"]')?.content;
const native=window.requestAnimationFrame.bind(window);
const cancel=window.cancelAnimationFrame.bind(window);
const frame=()=>new Promise(resolve=>native(resolve));
const settled=()=>document.readyState==='complete'?Promise.resolve():new Promise(resolve=>addEventListener('load',resolve,{once:true}));

function output(text) {
  const main=document.createElement('main'),pre=document.createElement('pre');
  pre.id='film-bench-result';pre.setAttribute('role','status');pre.style.whiteSpace='pre-wrap';pre.textContent=text;
  main.append(pre);document.body.append(main);return main;
}
function next(run,manifest) {
  const upcoming=run.queue[0];save(run);
  location.replace(upcoming?manifest.cases[upcoming].href:'./film-style.html');
}
function extend(run,manifest) {
  if(run.mode || run.queue.length) return;
  const lookup=name=>run.samples.find(row=>row.name===name);
  const slow=name=>lookup(name)?.frameIntervalMs.p50>100;
  // If independent empty documents or empty link requests are slow, the
  // evidence does not isolate a particular real file. Retain that outcome.
  if(slow('blank-a')||slow('blank-b')||slow('blank-final')||slow('empty-links')||!slow(manifest.full))return;
  let node=manifest.full;
  while(manifest.cases[node].children.length) {
    const children=manifest.cases[node].children;
    const unchecked=children.filter(id=>!lookup(id));
    if(unchecked.length){run.queue.push(...unchecked);return;}
    node=children.find(slow);if(!node)return;
  }
}
async function stage(run,manifest) {
  if(run?.queue[0]!==marker)throw Error('The test sequence was interrupted. Restart from film-style.html?run=1.');
  const {mode,files}=manifest.cases[marker];
  if(mode==='dynamic')await Promise.all(files.map(file=>new Promise((resolve,reject)=>{
    const el=document.createElement('link');el.rel='stylesheet';el.href='./'+file;el.onload=resolve;el.onerror=reject;document.head.append(el);
  })));
  if(mode==='fetch')await Promise.all(files.map(file=>fetch('./'+file).then(r=>r.arrayBuffer())));
  await settled();await document.fonts?.ready;await frame();await frame();
  let last=performance.now(),timerTimes=[];
  const timer=setInterval(()=>{const now=performance.now();timerTimes.push(now-last);last=now;},32);
  let clock;
  try {clock=await sampleClock(run.durationMs,native,cancel);} finally {clearInterval(timer);}
  run.samples.push({name:marker,mode,files,documentStart:performance.timeOrigin,loadedInMs:round(performance.getEntriesByType('navigation')[0]?.loadEventEnd||0),
    visibility:document.visibilityState,hasFocus:document.hasFocus(),stylesheetCount:document.styleSheets.length,
    resources:performance.getEntriesByType('resource').length,timerIntervalMs:timerTimes.length?stats(timerTimes):null,
    frameIntervalMs:clock.frameIntervalMs,over33_3msPercent:clock.over33_3msPercent,raw:clock.raw});
  run.queue.shift();extend(run,manifest);next(run,manifest);
}
async function start(manifest,mode=null) {
  const selected={external:manifest.full,inline:'real-inline',bundle:'real-single',empty:'empty-links',dynamic:'real-dynamic'};
  if(mode && !selected[mode])throw Error('Unknown mode. Use external, inline, bundle, empty or dynamic.');
  const queue=mode?['blank-a',selected[mode],'blank-b']:[
    'blank-a','shell','empty-single','empty-links','real-network',manifest.full,'blank-b',
    ...manifest.cases[manifest.full].children,'real-single','real-inline','real-dynamic','blank-final',
  ];
  const run={mode,queue,durationMs:params.has('quick')?1200:3200,samples:[],build:await json('./film-bench-build.json')};
  next(run,manifest);
}
function summary(run) {
  const report={context:{...run.build,sample:'fresh-document-styles',durationMs:run.durationMs,mode:run.mode||'matrix',
    userAgent:navigator.userAgent,viewport:[innerWidth,innerHeight],dpr:devicePixelRatio},
    cases:run.samples.map(({raw,...row})=>row),raw:run.samples.map(({name,raw})=>({name,frameIntervalMs:raw}))};
  window.coachFilmBenchmark=report;
  const {raw,...visible}=report,main=output(JSON.stringify(visible,null,2));
  const link=document.createElement('a');link.textContent='下载逐帧数据';link.download='coach-film-fresh-styles.json';
  link.href=URL.createObjectURL(new Blob([JSON.stringify(report,null,2)],{type:'application/json'}));main.append(link);
}
async function main() {
  const manifest=await json('./film-style-cases.json'),run=load();
  if(marker)await stage(run,manifest);
  else if(params.has('run'))await start(manifest,params.get('mode'));
  else if(run&&!run.queue.length)summary(run);
  else {const main=output('独立文档样式测量。请保持此标签前台。'),button=document.createElement('button');button.textContent='开始';button.onclick=()=>start(manifest);main.append(button);}
}
main().catch(error=>output('ERROR: '+(error.message||error)));
