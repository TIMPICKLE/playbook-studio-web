import test from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { createOnboarding, ONBOARDING_STORAGE_KEY } from '../web/onboarding.js';
import { onboardingSteps } from '../web/onboarding-steps.js';

const rect = (left=80,top=100,width=180,height=70) => ({x:left,y:top,left,top,right:left+width,bottom:top+height,width,height});
const tick = () => new Promise(resolve=>setTimeout(resolve,20));
async function until(predicate, message='expected onboarding state') {
  const deadline=Date.now()+3000;
  while(!predicate()&&Date.now()<deadline)await tick();
  assert.ok(predicate(),message);
}
function windowFixture(t,{width=1440,height=900}={}) {
  const win=new Window({url:'https://playbook.test/local.html',width,height});
  win.HTMLElement.prototype.getBoundingClientRect=()=>rect();
  win.document.body.innerHTML='<button id="launcher">Guide</button><section id="first">First</section><section id="second">Second</section>';
  for(const node of win.document.querySelectorAll('section'))node.getBoundingClientRect=()=>rect();
  const names=['window','document','navigator','location','localStorage','HTMLElement','SVGElement','Node','MutationObserver','ResizeObserver','DOMRect','DOMPoint','Element','HTMLButtonElement','MouseEvent','ShadowRoot','getComputedStyle','requestAnimationFrame','cancelAnimationFrame'];
  const old=Object.fromEntries(names.map(name=>[name,Object.getOwnPropertyDescriptor(globalThis,name)]));
  for(const name of names)Object.defineProperty(globalThis,name,{configurable:true,value:['getComputedStyle','requestAnimationFrame','cancelAnimationFrame'].includes(name)?win[name].bind(win):win[name]});
  t.after(async()=>{
    win.__onboardingCleanup?.();
    win.dispatchEvent(new win.Event('pagehide'));
    await win.happyDOM.abort();
    for(const name of names){if(old[name])Object.defineProperty(globalThis,name,old[name]);else delete globalThis[name];}
  });
  return win;
}
function fakeLibrary() {
  const instances=[];
  const driver=config=>{
    let index=0,active=false;
    const node=()=>{
      const element=config.steps?.[index]?.element;
      return typeof element==='function'?element():typeof element==='string'?document.querySelector(element):element;
    };
    const opts=reason=>({driver:instance,config,state:{activeIndex:index,activeElement:node()},index,reason});
    const notify=(name,reason)=>config[name]?.(node(),config.steps?.[index],opts(reason));
    const instance={
      config,refreshes:0,destroyed:0,
      isActive:()=>active,getActiveIndex:()=>active?index:undefined,getActiveElement:()=>active?node():undefined,
      getActiveStep:()=>config.steps?.[index],getConfig:()=>config,getState:()=>({activeIndex:index,activeElement:node()}),
      isLastStep:()=>index===(config.steps?.length||0)-1,isFirstStep:()=>index===0,
      hasNextStep:()=>index<(config.steps?.length||0)-1,hasPreviousStep:()=>index>0,
      drive(next=0){index=next;active=true;notify('onHighlighted');},
      refresh(){instance.refreshes++;},
      setSteps(steps){config.steps=steps;},setConfig(next){Object.assign(config,next);},
      moveTo(next){index=next;notify('onHighlighted');},
      moveNext(){if(instance.hasNextStep()){index++;notify('onHighlighted');}else instance.finish();},
      movePrevious(){if(index){index--;notify('onHighlighted');}},
      destroy(){if(!active)return;active=false;instance.destroyed++;notify('onDestroyed','api');},
      finish(){index=Math.max(0,config.steps.length-1);notify('onDoneClick','done');if(active){active=false;notify('onDestroyed','done');}},
      skip(reason='close'){if(reason==='close')notify('onCloseClick','close');if(active){active=false;notify('onDestroyed',reason);}},
    };
    instances.push(instance);return instance;
  };
  return {instances,loadDriver:async()=>({driver})};
}
function setup(t,options={}) {
  const win=windowFixture(t,options),library=fakeLibrary();
  const state={context:{id:'home',locale:'zh-CN'},busy:false};
  const steps=()=>['first','second'].map(id=>({id,element:()=>win.document.getElementById(id),title:id,description:'Learn '+id}));
  const controller=createOnboarding({document:win.document,getContext:()=>state.context,getSteps:steps,isBusy:()=>state.busy,delay:10,...library,...options});
  win.__onboardingCleanup=()=>controller.destroy();
  return {win,library,state,controller};
}

test('first-visit completion and skip are scoped per page, while replay still works',async t=>{
  const f=setup(t);
  await until(()=>f.controller.active);
  assert.equal(f.controller.contextId,'home');
  assert.equal(f.library.instances.length,1);
  assert.equal(f.library.instances.at(-1).config.closeBtnLabel,'跳过本页');
  f.controller.sync();await tick();assert.equal(f.library.instances.length,1,'re-renders do not duplicate the active tour');
  f.library.instances.at(-1).finish();
  await until(()=>!f.controller.active);
  f.controller.sync();await tick();assert.equal(f.controller.active,false,'a completed module does not auto-open again');
  assert.ok(JSON.parse(f.win.localStorage.getItem(ONBOARDING_STORAGE_KEY)).completed.includes('home'));
  f.state.context={id:'editor',locale:'zh-CN'};f.controller.sync();
  await until(()=>f.controller.active);
  f.library.instances.at(-1).skip();await until(()=>!f.controller.active);
  const afterEditorSkip=JSON.parse(f.win.localStorage.getItem(ONBOARDING_STORAGE_KEY));
  assert.equal(afterEditorSkip.dismissed,false,'skipping one page does not set legacy global dismissal');
  assert.deepEqual(afterEditorSkip.dismissedScopes,['editor']);
  f.controller.sync();await tick();assert.equal(f.controller.active,false,'a skipped page does not auto-open again');
  f.state.context={id:'roster',locale:'zh-CN'};f.controller.sync();
  await until(()=>f.controller.active,'skipping editor does not silence another page on its first visit');
  assert.equal(f.controller.contextId,'roster');
  f.library.instances.at(-1).finish();await until(()=>!f.controller.active);
  f.state.context={id:'editor',locale:'zh-CN'};f.controller.sync();await tick();
  assert.equal(f.controller.active,false,'returning to a skipped page stays quiet');
  await f.controller.start({manual:true});assert.equal(f.controller.active,true,'manual replay ignores dismissedScopes');
});

test('legacy global dismissed flag and autoStart gate automatic tours without blocking manual replay',async t=>{
  const legacy=setup(t,{delay:10});
  legacy.controller.destroy();
  legacy.win.localStorage.setItem(ONBOARDING_STORAGE_KEY,JSON.stringify({dismissed:true,completed:[]}));
  const legacyLib=fakeLibrary();
  const legacyState={context:{id:'home',locale:'en'}};
  const legacyCtrl=createOnboarding({document:legacy.win.document,getContext:()=>legacyState.context,delay:10,
    getSteps:()=>[{id:'first',element:()=>legacy.win.document.getElementById('first'),title:'First',description:'Desc'}],...legacyLib});
  legacy.win.__onboardingCleanup=()=>legacyCtrl.destroy();
  await tick();await tick();
  assert.equal(legacyCtrl.active,false,'legacy dismissed:true suppresses home auto-start');
  legacyState.context={id:'editor',locale:'en'};legacyCtrl.sync();await tick();await tick();
  assert.equal(legacyCtrl.active,false,'legacy dismissed:true suppresses editor auto-start');
  assert.equal(await legacyCtrl.start({manual:true}),true,'manual replay still starts under legacy dismissal');
  legacyCtrl.destroy();

  const gatedWin=windowFixture(t),gatedLib=fakeLibrary();
  const badScopes=Array.from({length:60},(_,i)=>`scope-${i}`);
  gatedWin.localStorage.setItem(ONBOARDING_STORAGE_KEY,JSON.stringify({dismissed:false,dismissedScopes:[123,null,...badScopes],completed:[]}));
  const gatedState={context:{id:'home',locale:'en'}};
  const gatedCtrl=createOnboarding({document:gatedWin.document,getContext:()=>gatedState.context,autoStart:ctx=>ctx.id!=='home',delay:10,
    getSteps:()=>[{id:'first',element:()=>gatedWin.document.getElementById('first'),title:'First',description:'Desc'}],...gatedLib});
  gatedWin.__onboardingCleanup=()=>gatedCtrl.destroy();
  await tick();await tick();
  assert.equal(gatedCtrl.active,false,'autoStart suppresses home automatic tour');
  assert.equal(await gatedCtrl.start({manual:true}),true,'manual replay works even when autoStart returns false');
  gatedCtrl.stop();
  gatedState.context={id:'editor',locale:'en'};gatedCtrl.sync();
  await until(()=>gatedCtrl.active,'non-suppressed scopes still auto-start');
  gatedLib.instances.at(-1).skip();await until(()=>!gatedCtrl.active);
  const stored=JSON.parse(gatedWin.localStorage.getItem(ONBOARDING_STORAGE_KEY));
  assert.ok(stored.dismissedScopes.length<=50,'dismissedScopes is safely capped at 50 strings');
  assert.ok(stored.dismissedScopes.every(item=>typeof item==='string'));
  assert.ok(stored.dismissedScopes.includes('editor'));
});

test('context changes for touch, serverAiConfigured and cloud refresh step copy accurately',async t=>{
  const win=windowFixture(t),library=fakeLibrary();
  const state={context:{id:'editor',locale:'en',cloud:false,touch:false,serverAiConfigured:false}};
  const getSteps=ctx=>[{id:'first',element:()=>win.document.getElementById('first'),title:'Mode',description:`cloud=${!!ctx.cloud};touch=${!!ctx.touch};ai=${!!ctx.serverAiConfigured}`}];
  const controller=createOnboarding({document:win.document,getContext:()=>state.context,getSteps,delay:100000,...library});
  win.__onboardingCleanup=()=>controller.destroy();
  await controller.start({manual:true});
  assert.equal(library.instances.at(-1).config.steps[0].popover.description,'cloud=false;touch=false;ai=false');
  state.context={...state.context,touch:true,serverAiConfigured:true};
  controller.sync();
  assert.equal(controller.active,true,'touch and server AI updates refresh the active tour without killing it');
  assert.equal(library.instances.at(-1).config.steps[0].popover.description,'cloud=false;touch=true;ai=true');
  state.context={...state.context,cloud:true};
  controller.sync();
  assert.equal(controller.active,false,'switching cloud mode resets context cleanly');
  await controller.start({manual:true});
  assert.equal(library.instances.at(-1).config.steps[0].popover.description,'cloud=true;touch=true;ai=true');
});

test('programmatic stops and navigation never become a user dismissal',async t=>{
  const f=setup(t,{delay:100000});
  await f.controller.start({manual:true});assert.equal(f.controller.active,true);
  f.controller.stop();assert.equal(f.controller.active,false);
  const stored=JSON.parse(f.win.localStorage.getItem(ONBOARDING_STORAGE_KEY)||'{}');
  assert.notEqual(stored.dismissed,true);
  assert.ok(!stored.completed?.includes('home'));
  for(let attempt=0;attempt<3;attempt++){
    await f.controller.start({manual:true});assert.equal(f.controller.active,true,'cached driver imports still allow repeated replay');f.controller.stop();
  }
  f.state.context={id:'editor',locale:'zh-CN'};f.controller.sync();
  await f.controller.start({manual:true});assert.equal(f.controller.contextId,'editor');
  f.state.context=null;f.controller.sync();
  assert.equal(f.controller.active,false);assert.equal(f.controller.contextId,null);
  assert.notEqual(JSON.parse(f.win.localStorage.getItem(ONBOARDING_STORAGE_KEY)||'{}').dismissed,true);
});

test('login and busy editing never start an automatic tour, and an unavailable storage backend is harmless',async t=>{
  const denied={getItem(){throw Error('unavailable');},setItem(){throw Error('unavailable');}};
  const f=setup(t,{storage:denied});
  f.state.context=null;f.controller.sync();await tick();assert.equal(f.library.instances.length,0);
  f.state.context={id:'editor',locale:'zh-CN'};f.state.busy=true;f.controller.sync();await tick();
  assert.equal(f.library.instances.length,0);
  f.state.busy=false;f.controller.sync();await until(()=>f.controller.active);
  f.library.instances.at(-1).finish();await until(()=>!f.controller.active);
  f.controller.sync();await tick();assert.equal(f.controller.active,false,'session state prevents repeated prompts even when persistence is blocked');
  await f.controller.start({manual:true});assert.equal(f.controller.active,true);
});

test('hidden, inert, zero-sized and disconnected targets are excluded rather than highlighted in the wrong place',async t=>{
  const f=setup(t,{delay:100000});
  const first=f.win.document.getElementById('first'),second=f.win.document.getElementById('second');
  first.hidden=true;
  await f.controller.start({manual:true});
  assert.equal(f.library.instances.at(-1).config.steps.length,1);
  assert.equal(f.library.instances.at(-1).getActiveElement(),second);
  f.controller.stop();second.parentElement.inert=true;
  await f.controller.start({manual:true});assert.equal(f.controller.active,false);
  second.parentElement.inert=false;first.hidden=false;first.getBoundingClientRect=()=>rect(0,0,0,0);second.remove();
  await f.controller.start({manual:true});assert.equal(f.controller.active,false);
});

test('geometry refresh follows resize, scroll, viewport changes and replacement without stale targets',async t=>{
  const f=setup(t,{delay:100000});
  const viewport=new f.win.EventTarget();viewport.height=900;viewport.offsetTop=0;
  Object.defineProperty(f.win,'visualViewport',{configurable:true,value:viewport});
  await f.controller.start({manual:true});
  const original=f.library.instances.at(-1),before=original.refreshes;
  f.win.dispatchEvent(new f.win.Event('resize'));
  f.win.document.dispatchEvent(new f.win.Event('scroll',{bubbles:true}));
  viewport.height=500;viewport.dispatchEvent(new f.win.Event('resize'));
  await tick();
  assert.ok(original.refreshes>before);
  const old=f.win.document.getElementById('first'),next=old.cloneNode(true);
  next.getBoundingClientRect=()=>rect(100,220);old.replaceWith(next);
  await tick();
  assert.ok(f.controller.active);
  assert.equal(f.library.instances.at(-1).getActiveElement(),next,'replacement resolves the live target');
  next.remove();f.win.document.getElementById('second').remove();
  await until(()=>!f.controller.active);
  assert.notEqual(JSON.parse(f.win.localStorage.getItem(ONBOARDING_STORAGE_KEY)||'{}').dismissed,true,'navigation or removed targets are not a user skip');
});

test('a late failed import for an old route cannot destroy the new route guide',async t=>{
  const win=windowFixture(t),library=fakeLibrary(),waiting=[];
  let context={id:'home',locale:'zh-CN'};
  const controller=createOnboarding({document:win.document,getContext:()=>context,delay:100000,
    getSteps:()=>[{id:'first',element:()=>win.document.getElementById('first'),title:'Learn',description:'Details'}],
    loadDriver:()=>new Promise((resolve,reject)=>waiting.push({resolve,reject}))});
  win.__onboardingCleanup=()=>controller.destroy();
  const first=controller.start({manual:true});
  context={id:'editor',locale:'zh-CN'};controller.sync();
  const second=controller.start({manual:true});
  assert.equal(waiting.length,2);
  waiting[1].resolve(await library.loadDriver());await second;
  assert.equal(controller.active,true);assert.equal(controller.contextId,'editor');
  waiting[0].reject(Error('old route import failed'));await first;
  assert.equal(controller.active,true);assert.equal(controller.contextId,'editor');
});

test('reduced motion and translated controls are reflected in the actual driver configuration',async t=>{
  const f=setup(t,{delay:100000});
  const native=f.win.matchMedia.bind(f.win);
  f.win.matchMedia=query=>query.includes('prefers-reduced-motion')?{matches:true,addEventListener(){},removeEventListener(){}}:native(query);
  f.state.context={id:'editor',locale:'en'};
  await f.controller.start({manual:true});
  const config=f.library.instances.at(-1).config;
  assert.equal(config.animate,false);assert.equal(config.smoothScroll,false);
  assert.equal(config.allowClose,true);assert.equal(config.disableActiveInteraction,true);
  assert.equal(config.overlayClickBehavior,'none');
  assert.match(config.nextBtnText,/next/i);assert.equal(config.closeBtnLabel,'Skip page');
});

test('read-only tours describe permissions and source images use the visible library fallback in both languages',t=>{
  const win=windowFixture(t);
  win.document.body.innerHTML=`<main id="app">
    <section class="play-list"></section>
    <section class="inspector-panel" style="display:contents"><section id="visible-inspector" class="inspector"></section></section>
    <button data-action="inspector-panel" style="display:none">Properties</button>
    <div class="top-actions"><button id="hidden-library" data-action="madden-library" style="display:none">Library</button></div>
    <aside><button id="visible-library" data-action="madden-library">Library</button></aside>
    <div id="field"></div></main>
    <main id="roster-root"><section class="roster-chart-root"></section></main>`;
  win.document.querySelector('.inspector-panel').getBoundingClientRect=()=>rect(0,0,0,0);
  for(const locale of ['en','zh-CN']){
    const steps=onboardingSteps({id:'editor',locale,readOnly:true,reference:true},win.document);
    const plays=steps.find(step=>step.id==='plays'),field=steps.find(step=>step.id==='field'),library=steps.find(step=>step.id==='tools');
    assert.match(plays.description,/Creating plays requires editing access|新建战术需要编辑权限/);
    assert.match(field.description,/Source images are for viewing|原图用于查看/);
    assert.match(library.description,/Adding an entry or editing its diagram requires editing access|加入条目或修改图面需要编辑权限/);
    assert.equal(library.element()?.id,'visible-library','a CSS-hidden top action falls back to the available sidebar library entry');
    const properties=steps.find(step=>step.id==='properties');
    assert.equal(properties.element()?.id,'visible-inspector','the inspector content has a box even when its outer display:contents wrapper does not');
    assert.match(properties.description,/Members with editing access can change|修改由有编辑权限的成员完成/);
    const depth=onboardingSteps({id:'roster',locale,readOnly:true},win.document).find(step=>step.id==='depth');
    assert.match(depth.description,/Changing or applying starters requires editing access|调整或应用首发需要编辑权限/);
    assert.equal(steps.find(step=>step.id==='coachFilm'),undefined,'reference source images omit the Coach Film step');
  }
});

test('onboardingSteps adapts to cloud, touch, mobile overflow, server AI and safety preview copy in both languages',t=>{
  const win=windowFixture(t);
  win.document.body.innerHTML=`
    <section class="studio-home">
      <article class="studio-choice-editor"></article>
      <article class="studio-choice-roster"></article>
      <article class="studio-choice-ai"></article>
    </section>
    <main id="app">
      <header class="topbar"><div class="top-actions"><button id="desktop-export" data-action="export">Export</button></div></header>
      <section class="play-list"></section>
      <button id="coach-film-btn" class="coach-film-entry">Film room</button>
      <details class="play-more-menu"><summary id="more-menu-summary">...</summary></details>
      <div id="field"></div>
      <div class="stage-dock"></div>
      <section class="inspector"></section>
      <div class="task-panel-tabs"><button id="assistant-tab" data-action="assistant-task">AI</button></div>
      <div class="board-ai"><button id="assistant-fab" data-ba="open">AI</button></div>
    </main>
    <main id="ai-matchup-root">
      <select data-ai-field="offense"></select>
      <div data-local-brief></div>
      <section class="ai-knowledge"></section>
      <select data-ai-field="provider"></select>
    </main>`;

  for(const locale of ['zh-CN','en']){
    const homeSteps=onboardingSteps({id:'home',locale},win.document);
    assert.match(homeSteps.find(s=>s.id==='editor').description,/AI 助手|AI board assistant/);
    assert.match(homeSteps.find(s=>s.id==='analysis').description,/免 API Key|no API key/i);

    const desktopCloud=onboardingSteps({id:'editor',locale,cloud:true,touch:false,serverAiConfigured:false},win.document);
    assert.equal(desktopCloud.find(s=>s.id==='coachFilm')?.element()?.id,'coach-film-btn');
    assert.match(desktopCloud.find(s=>s.id==='coachFilm').description,/Coach Film|Film room/);
    assert.match(desktopCloud.find(s=>s.id==='tools').description,/Enter/);
    const aiManual=desktopCloud.find(s=>s.id==='assistant');
    assert.equal(aiManual.element()?.id,'assistant-fab');
    assert.match(aiManual.description,/半透明预览|translucent field preview/i);
    assert.match(aiManual.description,/应用|Apply/);
    assert.match(aiManual.description,/一键撤销|one-click Undo/i);
    assert.match(aiManual.description,/deepseek-chat/);
    const expCloud=desktopCloud.find(s=>s.id==='export');
    assert.equal(expCloud.element()?.id,'desktop-export');
    assert.match(expCloud.description,/云端自动保存|auto-save to the cloud/i);

    const touchReady=onboardingSteps({id:'editor',locale,cloud:false,touch:true,serverAiConfigured:true},win.document);
    assert.match(touchReady.find(s=>s.id==='tools').description,/完成|Done/);
    assert.doesNotMatch(touchReady.find(s=>s.id==='tools').description,/Enter/);
    assert.match(touchReady.find(s=>s.id==='assistant').description,/DeepSeek/);
    assert.match(touchReady.find(s=>s.id==='assistant').description,/无需填写 API Key|no API key needed/i);

    // Simulate mobile <= 600px where .topbar is hidden and FAB is hidden so fallbacks kick in.
    win.document.querySelector('.topbar').style.display='none';
    win.document.querySelector('#assistant-fab').style.display='none';
    const mobileCloud=onboardingSteps({id:'editor',locale,cloud:true,touch:true},win.document);
    assert.equal(mobileCloud.find(s=>s.id==='assistant').element()?.id,'assistant-tab');
    assert.equal(mobileCloud.find(s=>s.id==='export').element()?.id,'more-menu-summary');
    assert.match(mobileCloud.find(s=>s.id==='export').description,/云端自动保存|auto-save to the cloud/i);
    const mobileLocal=onboardingSteps({id:'editor',locale,cloud:false,touch:true},win.document);
    assert.equal(mobileLocal.find(s=>s.id==='export').element()?.id,'more-menu-summary');
    assert.match(mobileLocal.find(s=>s.id==='export').description,/当前浏览器|this browser/i);
    win.document.querySelector('.topbar').style.display='';
    win.document.querySelector('#assistant-fab').style.display='';

    const analysisManual=onboardingSteps({id:'analysis',locale,serverAiConfigured:false},win.document);
    assert.match(analysisManual.find(s=>s.id==='matchup').description,/观察视角|perspective/i);
    assert.match(analysisManual.find(s=>s.id==='brief').description,/免 API Key|no API key/i);
    assert.match(analysisManual.find(s=>s.id==='model').description,/deepseek-chat/);
    const analysisReady=onboardingSteps({id:'analysis',locale,serverAiConfigured:true},win.document);
    assert.match(analysisReady.find(s=>s.id==='model').description,/DeepSeek/);
    assert.match(analysisReady.find(s=>s.id==='model').description,/免填 API Key|no API key needed/i);
  }
});

test('the real vendored driver renders accessible steps, moves backward and forward, and restores keyboard focus',async t=>{
  const win=windowFixture(t),q=selector=>win.document.querySelector(selector);
  const launcher=q('#launcher');launcher.getBoundingClientRect=()=>rect(20,20,100,30);launcher.focus();
  const controller=createOnboarding({document:win.document,getContext:()=>({id:'editor',locale:'en'}),isBusy:()=>false,delay:100000,
    getSteps:()=>['first','second'].map(id=>({id,element:()=>q('#'+id),title:'Learn '+id,description:'A clear explanation.'}))});
  win.__onboardingCleanup=()=>controller.destroy();
  await controller.start({manual:true});
  await until(()=>q('.onboarding-popover'));
  const popover=q('.onboarding-popover');
  assert.equal(popover.getAttribute('role'),'dialog');assert.equal(popover.getAttribute('aria-modal'),'true');
  assert.match(popover.textContent,/Learn first/);assert.equal(q('h1'),null);
  assert.ok(q('#first').classList.contains('driver-active-element'));
  q('.driver-popover-next-btn').click();await until(()=>q('.onboarding-popover')?.textContent.includes('Learn second'));
  assert.ok(q('#second').classList.contains('driver-active-element'));
  q('.driver-popover-prev-btn').click();await until(()=>q('.onboarding-popover')?.textContent.includes('Learn first'));
  q('.driver-popover-close-btn').focus();
  q('.driver-popover-close-btn').dispatchEvent(new win.KeyboardEvent('keydown',{key:'Tab',shiftKey:true,bubbles:true,cancelable:true}));
  assert.ok(q('.onboarding-popover').contains(win.document.activeElement),'Tab remains inside the guide');
  win.document.activeElement.dispatchEvent(new win.KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));
  win.document.activeElement.dispatchEvent(new win.KeyboardEvent('keyup',{key:'Escape',bubbles:true,cancelable:true}));
  await until(()=>!controller.active);
  assert.equal(q('.driver-popover'),null);
  await until(()=>win.document.activeElement===launcher,'dismissal restores the triggering control after the lifecycle settles');
  const stored=JSON.parse(win.localStorage.getItem(ONBOARDING_STORAGE_KEY));
  assert.equal(stored.dismissed,false);
  assert.ok(stored.dismissedScopes.includes('editor'));
});
