import test from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

test('the bundled particle engine rejects plugin registration after startup', async () => {
  const context = vm.createContext({ console });
  vm.runInContext(readFileSync(new URL('../web/vendor/tsparticles.slim-4.4.0.min.js', import.meta.url), 'utf8'), context);
  await context.loadSlim(context.tsParticles);
  await context.tsParticles.init();
  await assert.rejects(context.loadSlim(context.tsParticles), /Register plugins can only be done before/);
});

test('visual preferences stay local and obsolete asynchronous particle startups cannot survive', async t => {
  const win = new Window({ url:'http://localhost:3000/', width:1440, height:900 });
  const names=['window','document','localStorage'], previous=Object.fromEntries(names.map(n=>[n,Object.getOwnPropertyDescriptor(globalThis,n)]));
  for (const n of names) Object.defineProperty(globalThis,n,{configurable:true,value:win[n]});
  let reduced=false, hidden=false, resolveFirst, delayed=true, paused=0, resumed=0, engineStarted=false, registrations=0;
  const reduceListeners=[], live=new Set();
  win.matchMedia=query=>({matches:query.includes('reduced-motion')?reduced:false,addEventListener:(_,fn)=>{if(query.includes('reduced-motion'))reduceListeners.push(fn);}});
  Object.defineProperty(win.document,'hidden',{get:()=>hidden,configurable:true});
  win.CanvasRenderingContext2D=function(){};
  win.tsParticles={load:async()=>{
    engineStarted=true;
    if(delayed)await new Promise(resolve=>{resolveFirst=resolve;});
    const canvas=win.document.createElement('canvas');win.document.querySelector('#ambient-particles').append(canvas);
    const container={destroy(){canvas.remove();live.delete(container);},pause(){paused++;},play(){resumed++;}};
    live.add(container);return container;
  }};
  win.loadSlim=async()=>{
    if(engineStarted)throw new Error('Register plugins can only be done before calling tsParticles.load()');
    registrations++;
  };
  const settle=async()=>{for(let i=0;i<8;i++)await new Promise(resolve=>setImmediate(resolve));};
  const fx=await import(`../web/effects.js?effects-test=${Date.now()}`);
  win.localStorage.setItem('playbook-shared-sentinel','unchanged');
  win.document.body.innerHTML=fx.effectsControl();
  try {
    await t.test('existing users default to traditional with an explicit two-mode control',async()=>{
      assert.equal(fx.preference(),'traditional');assert.equal(fx.effectiveMode(),'off');
      assert.equal(win.document.querySelectorAll('[data-effects-mode]').length,2);
      assert.match(win.document.body.textContent,/传统模式/);assert.match(win.document.body.textContent,/数字化模式/);
    });
    await t.test('turning off during startup cancels the stale instance and skips queued intermediate choices',async()=>{
      win.localStorage.setItem('playbook-visual-mode','digital');fx.initEffects();await settle();assert.equal(typeof resolveFirst,'function');
      const repeated=fx.setEffectsMode('digital');await fx.setEffectsMode('traditional');
      resolveFirst();await repeated;await settle();
      assert.equal(live.size,0);assert.equal(win.document.querySelectorAll('canvas').length,0);
      assert.equal(win.document.documentElement.dataset.effects,'off');
      assert.equal(win.localStorage.getItem('playbook-shared-sentinel'),'unchanged');
    });
    await t.test('restart owns exactly one canvas, hidden tabs pause and visible tabs resume',async()=>{
      delayed=false;await fx.setEffectsMode('digital');assert.equal(live.size,1);
      hidden=true;win.document.dispatchEvent(new win.Event('visibilitychange'));assert.equal(paused,1);
      hidden=false;win.document.dispatchEvent(new win.Event('visibilitychange'));assert.equal(resumed,1);
      await fx.setEffectsMode('digital');assert.equal(live.size,1);assert.equal(win.document.querySelectorAll('canvas').length,1);
    });
    await t.test('repeated digital and traditional switches keep particles alive without registering plugins again',async()=>{
      for(let i=0;i<6;i++)for(const mode of ['digital','traditional','digital']){
        await fx.setEffectsMode(mode);
        assert.equal(win.document.documentElement.dataset.effects,mode==='digital'?'full':'off');
        assert.equal(live.size,mode==='traditional'?0:1);
        assert.equal(win.document.querySelectorAll('#ambient-particles canvas').length,mode==='traditional'?0:1);
      }
      assert.equal(registrations,1);
      await fx.setEffectsMode('digital');
    });
    await t.test('system reduced motion overrides decorative effects without overwriting the chosen preference',async()=>{
      reduced=true;for(const fn of reduceListeners)await fn();assert.equal(live.size,0);
      assert.equal(win.document.documentElement.dataset.effects,'off');assert.equal(fx.preference(),'digital');
      assert.match(win.document.querySelector('.effects-note').textContent,/系统/);
      reduced=false;for(const fn of reduceListeners)await fn();assert.equal(live.size,1);
      assert.equal(win.document.documentElement.dataset.effects,'full');
    });
    await t.test('a denied local-storage write preserves the session setting and leaves shared data untouched',async()=>{
      const setItem=win.localStorage.setItem.bind(win.localStorage);
      win.localStorage.setItem=()=>{throw new Error('storage unavailable');};
      await fx.setEffectsMode('traditional');assert.equal(fx.preference(),'traditional');assert.equal(live.size,0);
      assert.equal(win.localStorage.getItem('playbook-shared-sentinel'),'unchanged');
      win.localStorage.setItem=setItem;
    });
    await t.test('iPad desktop-site identity locks digital controls and ignores attempted digital activation',async()=>{
      Object.defineProperty(win.navigator,'platform',{configurable:true,value:'MacIntel'});
      Object.defineProperty(win.navigator,'maxTouchPoints',{configurable:true,value:5});
      await fx.setEffectsMode('traditional');await fx.setEffectsMode('digital');
      assert.equal(fx.visualMode(),'traditional');assert.equal(live.size,0);
      assert.equal(win.document.querySelector('[data-effects-mode="digital"]').disabled,true);
      assert.match(win.document.querySelector('.effects-note').textContent,/iPad/);
      assert.equal(win.localStorage.getItem('playbook-visual-mode'),'traditional');
    });
  } finally {await fx.setEffectsMode('traditional');await win.happyDOM.abort();for(const n of names){if(previous[n])Object.defineProperty(globalThis,n,previous[n]);else delete globalThis[n];}}
});
