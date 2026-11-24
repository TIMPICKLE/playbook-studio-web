import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Window } from 'happy-dom';
import { STORAGE_KEY, encodeWorkspace, starterWorkspace } from '../web/model.js';
import { ONBOARDING_STORAGE_KEY } from '../web/onboarding.js';

const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(predicate,message='expected onboarding host state') {
  const deadline=Date.now()+5000;
  while(!predicate()&&Date.now()<deadline)await pause(20);
  assert.ok(predicate(),message);
}
function fixture(t,{url='http://localhost:3000/',width=1440,height=1000,fetchImpl}={}) {
  const win=new Window({url,width,height});
  win.document.body.innerHTML=readFileSync(new URL('../web/index.html',import.meta.url),'utf8').split('<body>')[1].split('</body>')[0];
  const original=encodeWorkspace(starterWorkspace());win.localStorage.setItem(STORAGE_KEY,original);
  // Happy DOM does not run layout. Supply viewport-valid target rectangles;
  // actual [hidden]/[inert] and computed display checks remain in the controller.
  win.HTMLElement.prototype.getBoundingClientRect=function(){
    // The desktop inspector wrapper uses display:contents, so only its inner
    // .inspector is a usable spotlight target.
    if(this.classList.contains('inspector-panel'))return {left:0,top:0,x:0,y:0,width:0,height:0,right:0,bottom:0};
    return {left:24,top:120,x:24,y:120,width:200,height:100,right:224,bottom:220};
  };
  const names=['window','document','navigator','localStorage','location','history','Image','Blob','HTMLElement','SVGElement','Node','MutationObserver','ResizeObserver','DOMRect','DOMPoint','Element','HTMLButtonElement','MouseEvent','ShadowRoot','getComputedStyle','requestAnimationFrame','cancelAnimationFrame','fetch'];
  const old=Object.fromEntries(names.map(name=>[name,Object.getOwnPropertyDescriptor(globalThis,name)]));
  for(const name of names.filter(name=>name!=='fetch'))Object.defineProperty(globalThis,name,{configurable:true,value:['getComputedStyle','requestAnimationFrame','cancelAnimationFrame'].includes(name)?win[name].bind(win):win[name]});
  Object.defineProperty(globalThis,'fetch',{configurable:true,value:fetchImpl||(async path=>{throw Error('An onboarding tour must not request a model or mutate cloud data: '+path);})});
  const q=selector=>win.document.querySelector(selector);
  const popover=()=>q('.onboarding-popover');
  const skip=async()=>{q('.driver-popover-close-btn')?.click();await until(()=>!popover());};
  const finish=async()=>{
    for(let index=0;index<16&&popover();index++){
      const previous=popover().textContent;
      q('.driver-popover-next-btn').click();
      await until(()=>!popover()||popover().textContent!==previous,'Next advances or completes the guide');
    }
    assert.equal(popover(),null,'the guide has a bounded sequence');
  };
  t.after(async()=>{
    q('.driver-popover-close-btn')?.click();
    win.dispatchEvent(new win.Event('pagehide'));
    await win.happyDOM.abort();
    for(const name of names){if(old[name])Object.defineProperty(globalThis,name,old[name]);else delete globalThis[name];}
  });
  return {win,q,original,popover,skip,finish};
}

test('first-time guests avoid home ambush, get per-page contextual tours, and replay without changing their playbook', {timeout:30000},async t=>{
  const f=fixture(t);
  await import(`../web/app.js?onboarding-host=${Date.now()}`);
  await until(()=>f.q('.studio-home') && f.q('[data-onboarding="replay"]'),'the home workspace and persistent help entry render');
  await pause(950);
  assert.equal(Boolean(f.popover()),false,'home does not ambush first-time guests with an automatic tour');
  f.q('[data-onboarding="replay"]').click();
  await until(f.popover,'manual replay works on home');
  assert.ok(f.q('.driver-active-element').closest('.studio-home'));
  const first=f.popover().textContent;
  f.q('.driver-popover-next-btn').click();await until(()=>f.popover()?.textContent!==first);
  f.q('.driver-popover-prev-btn').click();await until(()=>f.popover()?.textContent===first);
  await f.finish();
  assert.ok(JSON.parse(f.win.localStorage.getItem(ONBOARDING_STORAGE_KEY)).completed.includes('home'));
  assert.equal(f.win.localStorage.getItem(STORAGE_KEY),f.original);

  f.q('[data-cloud-action="enter-editor"]').click();
  await until(f.popover,'the first editor visit gets its own guide');
  assert.equal(f.q('#app').hidden,false);
  const initialTitle=f.q('h1').textContent;
  await f.finish();
  assert.ok(JSON.parse(f.win.localStorage.getItem(ONBOARDING_STORAGE_KEY)).completed.includes('editor'));
  assert.equal(f.q('h1').textContent,initialTitle);
  assert.equal(f.win.localStorage.getItem(STORAGE_KEY),f.original);
  assert.equal(f.q('[data-action="undo"]').disabled,true,'the tour does not add edit-history checkpoints');

  f.q('[data-cloud-action="home"]').click();
  await pause(950);assert.equal(Boolean(f.popover()),false,'a completed workspace guide is not repeated');
  f.q('[data-cloud-action="enter-analysis"]').click();
  await until(f.popover,'analysis has its own first-use explanation');
  await f.skip();
  const afterSkip=JSON.parse(f.win.localStorage.getItem(ONBOARDING_STORAGE_KEY));
  assert.equal(afterSkip.dismissed,false,'skipping analysis does not set global dismissal');
  assert.ok(afterSkip.dismissedScopes.includes('analysis'),'skipping analysis records its page scope');
  f.q('[data-cloud-action="home"]').click();
  f.q('[data-cloud-action="enter-roster"]').click();
  await until(f.popover,'skipping analysis does not silence the first-visit roster tour');
  assert.ok(!f.q('.driver-active-element').closest('[hidden],[inert]'));
  await f.finish();
  assert.ok(JSON.parse(f.win.localStorage.getItem(ONBOARDING_STORAGE_KEY)).completed.includes('roster'));
  f.q('[data-cloud-action="home"]').click();
  f.q('[data-cloud-action="enter-analysis"]').click();
  await pause(950);assert.equal(Boolean(f.popover()),false,'returning to a skipped page stays quiet');
  f.q('[data-onboarding="replay"]').click();await until(f.popover,'the persistent help entry can replay a skipped guide');
  assert.ok(!f.q('.driver-active-element').closest('[hidden],[inert]'));
  await f.finish();
  assert.equal(f.win.localStorage.getItem(STORAGE_KEY),f.original);
});

test('direct mobile editor links explain visible controls without opening drawers or modifying the draft', {timeout:15000},async t=>{
  const f=fixture(t,{url:'http://localhost:3000/local.html',width:390,height:844});
  await import(`../web/app.js?onboarding-mobile=${Date.now()}`);
  await until(f.popover);
  assert.equal(f.q('#app').hidden,false);
  assert.equal(f.q('.sidebar').inert,true);assert.equal(f.q('.inspector-panel').inert,true);
  for(let step=0;step<4&&f.popover();step++){
    assert.ok(!f.q('.driver-active-element')?.closest('[hidden],[inert]'),'only visible mobile controls can be spotlighted');
    assert.equal(f.q('.sidebar').inert,true);assert.equal(f.q('.inspector-panel').inert,true);
    const previous=f.popover().textContent;
    f.q('.driver-popover-next-btn').click();
    await until(()=>!f.popover()||f.popover().textContent!==previous);
  }
  if(f.popover())await f.skip();
  assert.equal(f.win.localStorage.getItem(STORAGE_KEY),f.original);
  f.q('[data-onboarding="replay"]').click();await until(f.popover);
  f.win.happyDOM.setWindowSize({width:844,height:390});f.win.dispatchEvent(new f.win.Event('resize'));
  await pause(60);
  assert.ok(f.popover(),'rotation preserves an active explanation');
  assert.equal(f.win.localStorage.getItem(STORAGE_KEY),f.original);
});

test('the cloud sign-in page never starts a tour or sends any data-writing request', {timeout:10000},async t=>{
  const calls=[];
  const f=fixture(t,{url:'https://playbook.test/editor/',fetchImpl:async(path,options={})=>{
    calls.push({path,method:options.method||'GET'});
    if(path==='/api/session')return Response.json({user:null});
    throw Error('Unexpected sign-in request: '+path);
  }});
  await import(`../web/app.js?onboarding-login=${Date.now()}`);
  await until(()=>f.q('#account-login'));
  await pause(1000);
  assert.equal(f.popover(),null);assert.equal(f.q('#app').hidden,true);
  assert.deepEqual(calls,[{path:'/api/session',method:'GET'}]);
  assert.equal(f.win.localStorage.getItem(ONBOARDING_STORAGE_KEY),null);
  assert.equal(f.win.localStorage.getItem(STORAGE_KEY),f.original);
});
