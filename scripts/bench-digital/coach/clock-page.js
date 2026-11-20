import {sampleClock} from './film-clock.js';

const query=new URLSearchParams(location.search);
const status=document.querySelector('#film-bench-result');
const button=document.querySelector('button');
const link=document.querySelector('a');
const build=await fetch('./film-bench-build.json',{cache:'no-store'}).then(response=>response.json());
button.onclick=async()=>{
  button.disabled=true;
  delete window.coachFilmBenchmark;
  if (link.hasAttribute('href')) URL.revokeObjectURL(link.href);
  link.removeAttribute('href');link.hidden=true;
  const quick=query.has('quick');
  const durationMs=quick?2000:15000;
  status.textContent='测量进行中 · 保持前台';
  try {
    // Keep the UI static until all clocks have finished sampling.
    const rounds=[];
    for (let n=0;n<(quick?1:3);n++) rounds.push(await sampleClock(durationMs));
    const report={context:{...build,sample:quick?'bare-rAF-smoke':'bare-rAF',targetHz:60,
      userAgent:navigator.userAgent,viewport:[innerWidth,innerHeight],pixelRatio:devicePixelRatio,machine:query.get('machine')||null},
      durationMsPerRound:durationMs,rounds:rounds.map(({raw,...summary})=>summary),raw:rounds.map(({raw})=>raw)};
    window.coachFilmBenchmark=report;
    const {raw,...summary}=report;
    status.textContent=JSON.stringify(summary,null,2);
    try {
      link.href=URL.createObjectURL(new Blob([JSON.stringify(report,null,2)],{type:'application/json'}));link.hidden=false;
    } catch {status.textContent+='\n下载不可用 · 完整数据保留在 window.coachFilmBenchmark';}
  } catch(error) {status.textContent='ERROR: '+error.message;}
  finally {button.disabled=false;}
};
button.disabled=false;
if(query.has('run')) button.click();
