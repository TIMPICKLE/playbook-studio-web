export const ONBOARDING_STORAGE_KEY = 'playbook-studio:onboarding:v1';

const sessionRecords = new WeakMap();
const words = locale => locale === 'en'
  ? {skip:'Skip guide',next:'Next',previous:'Back',done:'Get started',progress:'Step {{current}} of {{total}}',label:'Getting started'}
  : {skip:'跳过引导',next:'下一步',previous:'上一步',done:'开始使用',progress:'第 {{current}} 步，共 {{total}} 步',label:'快速上手'};
const contextKey = context => context ? JSON.stringify([context.id,context.locale,!!context.readOnly,!!context.reference]) : '';
const escape = value => String(value ?? '').replace(/[&<>"']/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));

export function isOnboardingTargetVisible(element) {
  if (!element?.isConnected || element.closest('[hidden],[inert],[aria-hidden="true"]')) return false;
  const win = element.ownerDocument.defaultView;
  for (let node=element;node?.nodeType===1;node=node.parentElement) {
    const style=win.getComputedStyle(node);
    if (style.display==='none' || ['hidden','collapse'].includes(style.visibility)) return false;
    if (node.tagName==='DETAILS' && !node.open && !node.querySelector(':scope > summary')?.contains(element)) return false;
  }
  const rect=element.getBoundingClientRect();
  return rect.width>0 && rect.height>0;
}

/** A tour only explains existing controls. It never dispatches editor actions. */
export function createOnboarding({document:doc=globalThis.document,getContext,getSteps,isBusy=()=>false,delay=800,
  loadDriver=()=>import('./vendor/driver-1.14.0.js'),storage}={}) {
  const win=doc.defaultView;
  const record=sessionRecords.get(doc) || {dismissed:false,completed:[]};
  sessionRecords.set(doc,record);
  let persistence=storage;
  if (persistence===undefined) try { persistence=win.localStorage; } catch { persistence=null; }
  try {
    const saved=JSON.parse(persistence?.getItem(ONBOARDING_STORAGE_KEY) || 'null');
    if (saved && typeof saved==='object') {
      record.dismissed=record.dismissed || saved.dismissed===true;
      if (Array.isArray(saved.completed)) record.completed=[...new Set([...record.completed,...saved.completed.filter(id=>typeof id==='string').slice(0,50)])];
    }
  } catch { /* The editor remains usable when storage is denied or malformed. */ }
  let currentKey='', running=null, timer=null, scheduled=null, loading=null, factory;
  let generation=0, destroyed=false;
  const persist = () => { try { persistence?.setItem(ONBOARDING_STORAGE_KEY,JSON.stringify(record)); } catch { /* Retain the choice for this page. */ } };
  const readContext = () => { try { const context=getContext?.(); return context?.id ? context : null; } catch { return null; } };
  const resolve = step => { try { return typeof step.element==='function' ? step.element() : typeof step.element==='string' ? doc.querySelector(step.element) : step.element; } catch { return null; } };
  const visibleSteps = context => (getSteps?.(context) || []).map(step=>({...step,resolved:resolve(step)})).filter(step=>isOnboardingTargetVisible(step.resolved));
  const uiNode = node => node?.nodeType===1 && (node.matches('.driver-popover,.driver-overlay,#driver-dummy-element,.driver-live-region,[data-onboarding-ui]') || !!node.closest('.driver-popover,[data-onboarding-ui]'));
  const inputFocused = () => {
    const focused=doc.activeElement;
    return !focused?.closest('.driver-popover') && (['INPUT','TEXTAREA','SELECT'].includes(focused?.tagName) || focused?.isContentEditable);
  };
  const blocked = () => {
    if (doc.hidden || inputFocused()) return true;
    try { return !!isBusy(); } catch { return true; }
  };
  const clearTimer = () => { if (timer!==null) win.clearTimeout(timer); timer=null; };
  function restoreFocus(session) {
    if (!session.trigger || !isOnboardingTargetVisible(session.trigger)) return;
    win.setTimeout(()=>{
      if (!running && !destroyed && isOnboardingTargetVisible(session.trigger)) session.trigger.focus?.({preventScroll:true});
    },0);
  }
  function ended(session,reason) {
    if (running!==session) return;
    running=null;
    if (!session.programmatic) {
      const endedBy=session.reason || reason;
      if (endedBy==='done') record.completed=[...new Set([...record.completed,session.context.id])];
      else if (['close','escape','overlay'].includes(endedBy)) record.dismissed=true;
      persist();
      restoreFocus(session);
    }
    doc.documentElement.style.removeProperty('--onboarding-vh');
    doc.documentElement.style.removeProperty('--onboarding-vw');
  }
  function stop() {
    generation++;
    clearTimer();
    loading=null;
    const session=running;
    if (!session) return;
    session.programmatic=true;
    running=null;
    session.driver?.destroy();
    doc.documentElement.style.removeProperty('--onboarding-vh');
    doc.documentElement.style.removeProperty('--onboarding-vw');
  }
  function finish(reason) {
    if (!running) return;
    running.reason=reason;
    const session=running;
    session.driver.destroy();
    // A custom/fake Driver can omit its lifecycle hook; still record the choice.
    ended(session,reason);
  }
  function viewport() {
    const visual=win.visualViewport;
    return {left:visual?.offsetLeft || 0,top:visual?.offsetTop || 0,width:visual?.width || win.innerWidth,height:visual?.height || win.innerHeight};
  }
  function positionPopover(popover) {
    if (!running) return;
    const area=viewport();
    doc.documentElement.style.setProperty('--onboarding-vh',`${area.height}px`);
    doc.documentElement.style.setProperty('--onboarding-vw',`${area.width}px`);
    const rect=popover.wrapper.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const left=Math.max(area.left+12,Math.min(rect.left,area.left+area.width-rect.width-12));
    const top=Math.max(area.top+12,Math.min(rect.top,area.top+area.height-rect.height-12));
    const moved=Math.abs(rect.left-left)>1 || Math.abs(rect.top-top)>1;
    if (moved) {
      popover.wrapper.style.left=`${left}px`;popover.wrapper.style.top=`${top}px`;
      popover.wrapper.style.right='auto';popover.wrapper.style.bottom='auto';
    }
    popover.arrow.style.visibility=moved?'hidden':'';
  }
  function decorate(popover,opts,session) {
    const copy=words(session.context.locale);
    popover.wrapper.dataset.onboardingUi='';
    popover.wrapper.setAttribute('role','dialog');
    popover.wrapper.setAttribute('aria-modal','true');
    popover.wrapper.setAttribute('aria-labelledby','onboarding-step-title');
    popover.wrapper.setAttribute('aria-describedby','onboarding-step-description');
    popover.title.id='onboarding-step-title';
    popover.title.setAttribute('role','heading');popover.title.setAttribute('aria-level','2');
    popover.description.id='onboarding-step-description';
    popover.closeButton.textContent=copy.skip;
    popover.closeButton.setAttribute('aria-label',copy.skip);
    popover.closeButton.title=copy.skip;
    popover.previousButton.setAttribute('aria-label',copy.previous);
    popover.nextButton.setAttribute('aria-label',opts.index===session.steps.length-1?copy.done:copy.next);
    popover.wrapper.querySelectorAll('.onboarding-eyebrow,.onboarding-track').forEach(node=>node.remove());
    const eyebrow=doc.createElement('div');eyebrow.className='onboarding-eyebrow';eyebrow.textContent=copy.label;
    popover.title.before(eyebrow);
    const track=doc.createElement('div');track.className='onboarding-track';track.setAttribute('aria-hidden','true');
    const fill=doc.createElement('span');fill.style.width=`${((opts.index ?? 0)+1)/session.steps.length*100}%`;track.append(fill);
    popover.footer.before(track);
    positionPopover(popover);
  }
  function driverSteps(session) {
    return session.steps.map(step=>({
      element:()=>resolve(step) || undefined,
      data:{onboardingId:step.id},
      popover:{title:escape(step.title),description:escape(step.description),side:step.side || 'bottom',align:'start'},
    }));
  }
  function configuration(session) {
    const copy=words(session.context.locale);
    return {
      steps:driverSteps(session),animate:!win.matchMedia?.('(prefers-reduced-motion: reduce)').matches,duration:220,
      stagePadding:8,stageRadius:14,overlayColor:'#101820',overlayOpacity:.64,popoverOffset:14,
      allowClose:true,allowScroll:true,overlayClickBehavior:'none',disableActiveInteraction:true,
      allowKeyboardControl:true,focus:'popover',showProgress:true,
      showButtons:['next','previous','close'],popoverClass:'onboarding-popover',
      nextBtnText:copy.next,prevBtnText:copy.previous,doneBtnText:copy.done,closeBtnLabel:copy.skip,progressText:copy.progress,
      smoothScroll:false,scrollIntoView:{block:'center',inline:'nearest'},skipMissingElement:true,
      onPopoverRender:(popover,opts)=>decorate(popover,opts,session),
      onPopoverPositioned:popover=>positionPopover(popover),
      onDestroyed:(_element,_step,opts)=>ended(session,opts?.reason || 'api'),
    };
  }
  async function start({manual=true}={}) {
    if (destroyed) return false;
    const context=readContext(), key=contextKey(context);
    if (!context || (!manual && (record.dismissed || record.completed.includes(context.id))) || blocked()) return false;
    if (running && contextKey(running.context)===key) return true;
    if (loading?.key===key) return loading.promise;
    stop();
    currentKey=key;
    const token=++generation;
    const job={key,token,promise:null};
    loading=job;
    job.promise=(async()=>{
      try {
        factory ??= (await loadDriver()).driver;
        if (destroyed || token!==generation || contextKey(readContext())!==key || blocked()) return false;
        const steps=visibleSteps(context);
        if (!steps.length || typeof factory!=='function') return false;
        const session={context,steps,trigger:doc.activeElement,programmatic:false,driver:null};
        running=session;
        session.driver=factory(configuration(session));
        session.driver.drive();
        return true;
      } catch {
        if (token===generation && running) stop();
        return false;
      } finally { if (loading===job) loading=null; }
    })();
    return job.promise;
  }
  function sync() {
    if (destroyed) return;
    const next=readContext(), nextKey=contextKey(next);
    if (nextKey!==currentKey) {
      stop();currentKey=nextKey;
    }
    if (!next) return;
    if (running) {
      if (blocked()) { stop(); return; }
      const fresh=visibleSteps(next), index=running.driver.getActiveIndex?.() ?? 0;
      const prior=running.steps[index], replacement=fresh.findIndex(step=>step.id===prior?.id);
      if (!fresh.length) { stop(); return; }
      const changed=fresh.length!==running.steps.length || fresh.some((step,i)=>step.id!==running.steps[i]?.id || step.resolved!==running.steps[i]?.resolved);
      if (changed) {
        running.steps=fresh;
        running.driver.setSteps(driverSteps(running));
        running.driver.drive(replacement<0?Math.min(index,fresh.length-1):replacement);
      }
      return;
    }
    if (loading || timer!==null || record.dismissed || record.completed.includes(next.id) || blocked()) return;
    timer=win.setTimeout(()=>{timer=null;void start({manual:false});},delay);
  }
  function scheduleSync() {
    if (destroyed || scheduled!==null) return;
    scheduled=win.setTimeout(()=>{scheduled=null;sync();},0);
  }
  function refresh() { sync();running?.driver.refresh(); }
  function keyboard(event) {
    if (!running || event.key==='Tab') return;
    if (event.type==='keydown' && !event.repeat && !event.ctrlKey && !event.metaKey && !event.altKey) {
      if (event.key==='Escape') { event.preventDefault();event.stopImmediatePropagation();finish('escape');return; }
      if (event.key==='ArrowRight' || event.key==='ArrowLeft') {
        event.preventDefault();event.stopImmediatePropagation();
        if (event.key==='ArrowRight') running.driver.moveNext();
        else if ((running.driver.getActiveIndex?.() || 0)>0) running.driver.movePrevious();
        return;
      }
    }
    // Retain native Enter/Space activation on tour buttons, but prevent those
    // same keys (or Delete/R/Space) reaching the editor's keyboard shortcuts.
    if (!event.target?.closest?.('.driver-popover') && !event.ctrlKey && !event.metaKey) event.preventDefault();
    event.stopPropagation();
  }
  const observer=typeof win.MutationObserver==='function' ? new win.MutationObserver(mutations=>{
    const relevant=mutations.some(mutation=>!uiNode(mutation.target) &&
      !(mutation.type==='childList' && [...mutation.addedNodes,...mutation.removedNodes].length && [...mutation.addedNodes,...mutation.removedNodes].every(uiNode)));
    if (relevant) scheduleSync();
  }) : null;
  observer?.observe(doc.body,{childList:true,subtree:true,attributes:true,attributeFilter:['hidden','inert','class','aria-hidden']});
  win.addEventListener('keydown',keyboard,true);win.addEventListener('keyup',keyboard,true);
  win.addEventListener('resize',refresh);win.addEventListener('scroll',refresh,true);
  win.visualViewport?.addEventListener('resize',refresh);win.visualViewport?.addEventListener('scroll',refresh);
  doc.addEventListener('focusout',scheduleSync);
  doc.addEventListener('visibilitychange',refresh);
  function destroy() {
    if (destroyed) return;
    stop();destroyed=true;observer?.disconnect();
    if (scheduled!==null) win.clearTimeout(scheduled);scheduled=null;
    win.removeEventListener('keydown',keyboard,true);win.removeEventListener('keyup',keyboard,true);
    win.removeEventListener('resize',refresh);win.removeEventListener('scroll',refresh,true);
    win.visualViewport?.removeEventListener('resize',refresh);win.visualViewport?.removeEventListener('scroll',refresh);
    doc.removeEventListener('focusout',scheduleSync);doc.removeEventListener('visibilitychange',refresh);
  }
  sync();
  return {sync,start,stop,destroy,get active(){return !!running;},get contextId(){return readContext()?.id || null;}};
}
