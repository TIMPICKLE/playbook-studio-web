import test from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { readFileSync } from 'node:fs';
import { makePlay, starterWorkspace, STORAGE_KEY, encodeWorkspace, decodeWorkspace } from '../web/model.js';
import { project, routePath } from '../web/field.js';
import { digitalFieldPalette } from '../web/digital-field-palette.js';

let serial=0;
async function host(t,{raw=encodeWorkspace(starterWorkspace()),failures=null}={}) {
  const win=new Window({url:'http://localhost:3000/local.html#editor',width:1440,height:1000});
  win.document.body.innerHTML=readFileSync(new URL('../web/index.html',import.meta.url),'utf8').split('<body>')[1].split('</body>')[0];
  win.localStorage.setItem(STORAGE_KEY,raw);
  win.localStorage.setItem('playbook-studio:onboarding:v1',JSON.stringify({dismissed:true,completed:[]}));
  const names=['window','document','navigator','localStorage','location','history','Image','Blob','requestAnimationFrame','cancelAnimationFrame'];
  const previous=Object.fromEntries(names.map(name=>[name,Object.getOwnPropertyDescriptor(globalThis,name)]));
  const storage=failures?{getItem:key=>win.localStorage.getItem(key),removeItem:key=>win.localStorage.removeItem(key),setItem:(key,value)=>{if(key===STORAGE_KEY&&failures.write)throw new Error('QuotaExceededError');win.localStorage.setItem(key,value);}}:win.localStorage;
  for(const name of names)Object.defineProperty(globalThis,name,{configurable:true,value:name==='localStorage'?storage:['requestAnimationFrame','cancelAnimationFrame'].includes(name)?win[name].bind(win):win[name]});
  t.after(async()=>{win.dispatchEvent(new win.Event('pagehide'));await win.happyDOM.abort();for(const name of names){if(previous[name])Object.defineProperty(globalThis,name,previous[name]);else delete globalThis[name];}});
  await import(`../web/app.js?gesture-acceptance=${++serial}`);
  const q=s=>win.document.querySelector(s);
  const geometry=()=>{q('#field .pitch-svg').getBoundingClientRect=()=>({left:0,top:0,x:0,y:0,right:1000,bottom:800,width:1000,height:800});};
  const pointer=(node,type,point,extra={})=>{geometry();const at=project(point);node.dispatchEvent(new win.PointerEvent(type,{bubbles:true,cancelable:true,button:0,pointerId:1,isPrimary:true,clientX:at.x,clientY:at.y,...extra}));};
  const action=name=>{const node=q(`[data-action="${name}"]`);assert.ok(node,name);node.click();};
  const key=(node,key,extra={})=>node.dispatchEvent(new win.KeyboardEvent('keydown',{bubbles:true,cancelable:true,key,...extra}));
  return {win,q,geometry,pointer,action,key,data:()=>decodeWorkspace(win.localStorage.getItem(STORAGE_KEY)),raw:()=>win.localStorage.getItem(STORAGE_KEY)};
}

test('switching the field at the editor toolbar updates both the board and its surround', async t => {
  const f=await host(t);
  const mode=name=>f.q(`[data-effects-mode="${name}"]`).click();
  const check=theme=>{
    const field=f.q('#field'),paint=digitalFieldPalette(theme);
    assert.deepEqual([...field.querySelectorAll('.yard-lines linearGradient stop')].map(stop=>stop.getAttribute('stop-color')),
      [paint.top,paint.middle,paint.bottom]);
    assert.equal(field.style.getPropertyValue('--field-stage-mid'),paint.stageMid);
    assert.equal(field.style.getPropertyValue('--field-frame'),paint.frame);
  };
  mode('digital');
  check('dark');
  f.action('theme');check('light');
  mode('traditional');
  assert.equal(f.q('#field').style.getPropertyValue('--field-frame'),'');
  assert.equal(f.q('#field svg[data-field-surface]'),null);
  mode('digital');check('light');
  f.action('theme');check('dark');
});

test('unchanged field hints preserve the material canvas, live region and keyboard focus', async t => {
  const f = await host(t), doc = f.win.document;
  const styles = doc.createElement('style');
  styles.textContent = readFileSync(new URL('../web/liquid.css', import.meta.url), 'utf8');
  doc.head.append(styles);
  f.q('[data-effects-mode="digital"]').click();
  assert.equal(doc.documentElement.dataset.effects, 'full');
  f.action('rehearse-mode');
  const context = f.q('#field-context'), playButton = context.querySelector('[data-action="play"]');
  const hint = f.q('.canvas-hint').firstElementChild, toolbarButton = f.q('.selection-toolbar button');
  const canvas = doc.createElement('canvas');
  canvas.className = 'liquid-surface-canvas';
  canvas.setAttribute('aria-hidden', 'true');
  context.prepend(canvas);
  let entrances = 0;
  context.animate = () => { entrances++; };
  playButton.focus();
  for (let i = 0; i < 5; i++) {
    f.action('rehearse-mode');
    assert.equal(canvas.parentElement, context);
    assert.equal(doc.activeElement, playButton);
    assert.equal(context.querySelector('[data-action="play"]'), playButton);
    assert.equal(f.q('.canvas-hint').firstElementChild, hint);
    assert.equal(f.q('.selection-toolbar button'), toolbarButton);
  }
  assert.equal(entrances, 0);
  f.action('edit-mode');
  assert.equal(context.textContent.trim(), '');
  assert.equal(canvas.parentElement, context);
  assert.equal(f.win.getComputedStyle(context).display, 'none');
  f.key(f.q('#field [data-player]'), 'Enter');
  assert.ok(context.querySelector('.context-player'));
  assert.equal(canvas.parentElement, context);
  assert.equal(entrances, 1);
  f.q('[data-effects-mode="traditional"]').click();
  assert.equal(doc.documentElement.dataset.effects, 'off');
  canvas.remove();
  context.querySelector('[data-action="clear-selection"]').click();
  assert.equal(context.children.length, 0);
  f.key(f.q('#field [data-player]'), 'Enter');
  assert.ok(context.querySelector('.context-player'));
  assert.equal(entrances, 2);
});

test('Escape during a player drag rolls back the live preview and a late release never commits it',async t=>{
  const f=await host(t),before=f.data(),actor=before.plays[0].players.find(p=>p.label==='X');
  const player=()=>f.q(`#field [data-player="${actor.id}"]`);
  const originalTransform=player().getAttribute('transform');
  f.pointer(player(),'pointerdown',actor);
  f.pointer(f.q('#field'),'pointermove',{x:actor.x+3,y:actor.y-4});
  await new Promise(resolve=>f.win.requestAnimationFrame(resolve));
  assert.notEqual(player().getAttribute('transform'),originalTransform,'drag has a live preview');
  f.key(f.win.document.body,'Escape');
  assert.equal(player().getAttribute('transform'),originalTransform,'Escape restores the visible position immediately');
  f.pointer(f.q('#field'),'pointerup',{x:actor.x+3,y:actor.y-4});
  assert.deepEqual(f.data(),before,'Escape must cancel without committing on release');
  assert.equal(f.q('[data-action="undo"]').disabled,true,'a cancelled drag does not create a transaction');
  f.pointer(player(),'pointerdown',actor);f.pointer(f.q('#field'),'pointerup',{x:actor.x+1,y:actor.y-1});
  assert.ok(Math.abs(f.data().plays[0].players.find(p=>p.id===actor.id).x-(actor.x+1))<1e-9,'another gesture can start after cancellation');
});

test('returning to the starting point preserves Redo and a staged waypoint’s target metadata', async t => {
  const seed = starterWorkspace(), play = seed.plays[0];
  const actor = play.players.find(player => player.label === 'X');
  const block = play.routes.find(route => route.playerId !== actor.id);
  Object.assign(block, { kind: 'block', stagedBlock: true, blockTargets: block.points.slice(1).map(() => actor.id), endCap: 'bar' });
  const f = await host(t, { raw: encodeWorkspace(seed) }), before = f.data();
  const field = f.q('#field'), marker = () => f.q(`#field [data-player="${actor.id}"]`);
  f.pointer(marker(), 'pointerdown', actor);
  f.pointer(field, 'pointerup', { x: actor.x + 2, y: actor.y - 1 });
  f.action('undo');
  const roundTrip = async (target, start) => {
    f.pointer(target, 'pointerdown', start);
    f.pointer(field, 'pointermove', { x: start.x + 3, y: start.y - 3 });
    await new Promise(resolve => f.win.requestAnimationFrame(resolve));
    f.pointer(field, 'pointerup', start);
    assert.deepEqual(f.data(), before);
    assert.equal(f.q('[data-action="undo"]').disabled, true);
    assert.equal(f.q('[data-action="redo"]').disabled, false);
  };
  await roundTrip(marker(), actor);
  f.key(f.q(`#field [data-route="${block.id}"]`), 'Enter');
  const handle = f.q(`#field .point-hit[data-route-id="${block.id}"][data-point="1"]`);
  const start = { x: (Number(handle.getAttribute('cx')) - 18) / 9.64, y: (Number(handle.getAttribute('cy')) - 20) / 7.6 };
  await roundTrip(handle, start);
});

test('a preselected player drag can be cancelled from a focused search input without consuming IME Escape',async t=>{
  const f=await host(t),before=f.data(),actor=before.plays[0].players.find(p=>p.label==='X');
  const player=()=>f.q(`#field [data-player="${actor.id}"]`);
  const field=f.q('#field'),search=f.q('#search'),end={x:actor.x+3,y:actor.y-2};
  f.key(player(),'Enter');search.focus();
  const original=player().getAttribute('transform');
  for(const interruption of ['pointercancel','Escape']){
    f.pointer(player(),'pointerdown',actor);f.pointer(field,'pointermove',end);
    await new Promise(resolve=>f.win.requestAnimationFrame(resolve));
    const preview=player().getAttribute('transform');
    assert.notEqual(preview,original);
    assert.equal(f.win.document.activeElement,search);
    assert.equal(f.key(search,'Escape',{isComposing:true}),true,'IME owns composition cancellation');
    assert.equal(player().getAttribute('transform'),preview);
    if(interruption==='Escape')assert.equal(f.key(search,'Escape'),false,'an active gesture handles ordinary Escape');
    else f.pointer(field,interruption,end);
    assert.equal(player().getAttribute('transform'),original);
    assert.equal(player().getAttribute('aria-pressed'),'true');
    f.pointer(field,'pointerup',end);
    assert.deepEqual(f.data(),before);assert.equal(f.q('[data-action="undo"]').disabled,true);
  }
});

test('committing a property while dragging does not copy preview geometry into the edit',async t=>{
  const f=await host(t),before=f.data(),actor=before.plays[0].players.find(p=>p.label==='X');
  const player=()=>f.q(`#field [data-player="${actor.id}"]`);
  const end={x:actor.x+2,y:actor.y-3};
  f.key(player(),'Enter');
  f.pointer(player(),'pointerdown',actor);f.pointer(f.q('#field'),'pointermove',end);
  await new Promise(resolve=>f.win.requestAnimationFrame(resolve));
  const name=f.q('[data-prop="name"]');
  name.value='Independent rename';name.dispatchEvent(new f.win.Event('change',{bubbles:true}));
  f.pointer(f.q('#field'),'pointerup',end);
  const expected=structuredClone(before);
  expected.plays[0].players.find(p=>p.id===actor.id).name=name.value;
  assert.equal(name.value,'Independent rename');
  assert.deepEqual(f.data(),expected);
  f.action('undo');assert.deepEqual(f.data(),before);assert.equal(f.q('[data-action="undo"]').disabled,true);
});

test('entering export or rehearsal during a drag presents committed geometry and ignores a late release',async t=>{
  for(const destination of ['export','rehearsal'])await t.test(destination,async t=>{
    const f=await host(t),before=f.data(),actor=before.plays[0].players.find(p=>p.label==='X');
    const marker=()=>f.q(`#field [data-player="${actor.id}"]`);
    const original=marker().getAttribute('transform'),end={x:actor.x+3,y:actor.y-4};
    f.pointer(marker(),'pointerdown',actor);f.pointer(f.q('#field'),'pointermove',end);
    await new Promise(resolve=>f.win.requestAnimationFrame(resolve));
    assert.notEqual(marker().getAttribute('transform'),original);
    if(destination==='export')f.action('export');else f.key(f.win.document.body,' ');
    assert.equal(marker().getAttribute('transform'),original);
    f.pointer(f.q('#field'),'pointerup',end);
    assert.equal(f.q('[data-action="undo"]').disabled,true);
    assert.deepEqual(f.data(),before);
    if(destination==='rehearsal')f.key(f.win.document.body,' ');
  });
});

test('scrubbing the editor timeline wakes a still digital board and restores the exact earlier rehearsal frame',async t=>{
  const f=await host(t),{win,q}=f,doc=win.document,play=f.data().plays[0],before=f.raw();
  win.CanvasRenderingContext2D=function(){};
  win.console.warn=()=>{};
  doc.documentElement.dataset.visualMode='digital';
  doc.documentElement.dataset.effects='off';
  doc.dispatchEvent(new win.Event('playbook:effects-changed'));
  for(let attempt=0;attempt<100&&!q('.digital-token-overlay');attempt++)await new Promise(resolve=>setTimeout(resolve,10));
  assert.ok(q('.digital-token-overlay'),'the vector-compatible board is mounted');
  const seek=async time=>{
    const timeline=q('#timeline');timeline.value=String(time);
    timeline.dispatchEvent(new win.Event('input',{bubbles:true}));
    await new Promise(resolve=>win.requestAnimationFrame(resolve));
    return q('.digital-decoration [data-ball-cue]')?.dataset.ballCue;
  };
  const positions=()=>[...doc.querySelectorAll('.digital-token-overlay [data-vector-player]')].map(group=>{
    const label=group.querySelector('text');
    return [group.dataset.vectorPlayer,label.getAttribute('x'),label.getAttribute('y')];
  });
  assert.equal(await seek(play.ball.passAt+.1),'release');
  const released=positions(),feedback=q('.digital-decoration').innerHTML;
  assert.equal(await seek(play.ball.arriveAt+.1),'catch');
  const caught=positions();
  assert.notDeepEqual(caught,released);
  assert.equal(await seek(play.ball.passAt+.1),'release');
  assert.deepEqual(positions(),released);
  assert.equal(q('.digital-decoration').innerHTML,feedback);
  const progress=q('.digital-decoration [data-route-progress]'), read=progress.getAttribute.bind(progress);
  let feedbackUpdates=0;
  progress.getAttribute=name=>{if(name==='stroke-dashoffset')feedbackUpdates++;return read(name);};
  Object.defineProperty(doc,'hidden',{configurable:true,value:true});
  doc.dispatchEvent(new win.Event('visibilitychange'));
  assert.equal(await seek(play.ball.arriveAt+.1),'release','hidden board retains its last visible pose');
  assert.equal(feedbackUpdates,0);
  delete doc.hidden;
  doc.dispatchEvent(new win.Event('visibilitychange'));
  assert.equal(feedbackUpdates,1,'restoring the editor reconciles the digital layer once');
  assert.deepEqual(positions(),caught);
  assert.equal(q('.digital-decoration [data-ball-cue]').dataset.ballCue,'catch');
  assert.equal(f.raw(),before);
});

test('Escape cancels group, waypoint, new-zone and annotation gestures before late pointer events',async t=>{
  for(const kind of ['group','waypoint','new-zone','annotation'])await t.test(kind,async t=>{
    const seed=starterWorkspace(),play=seed.plays[0];
    play.annotations.push({id:'acceptance-note',text:'Weak side',x:48,y:30});
    const f=await host(t,{raw:encodeWorkspace(seed)}),before=f.data();
    const actor=before.plays[0].players.find(p=>p.label==='X');
    let target,start;
    if(kind==='group'){
      const other=before.plays[0].players.find(p=>p.label==='Z');
      f.key(f.q(`[data-player="${actor.id}"]`),'Enter');f.key(f.q(`[data-player="${other.id}"]`),'Enter',{shiftKey:true});
      target=f.q(`#field [data-player="${actor.id}"]`);start=actor;
    }else if(kind==='waypoint'){
      const route=before.plays[0].routes.find(r=>r.playerId===actor.id);
      f.key(f.q(`#field [data-route="${route.id}"]`),'Enter');
      target=f.q(`#field [data-route-id="${route.id}"][data-point="1"]`);start=route.points[1];
    }else if(kind==='new-zone'){
      f.action('tool:zone');target=f.q('#field');start={x:30,y:25};
    }else{
      target=f.q('#field [data-annotation="acceptance-note"]');start={x:48,y:30};
    }
    const end={x:start.x+3,y:start.y+3};
    f.pointer(target,'pointerdown',start);f.pointer(f.q('#field'),'pointermove',end);
    await new Promise(resolve=>f.win.requestAnimationFrame(resolve));
    f.key(f.win.document.body,'Escape');
    f.pointer(f.q('#field'),'pointermove',end);f.pointer(f.q('#field'),'pointerup',end);
    assert.deepEqual(f.data(),before,`${kind} cancellation never commits an ephemeral preview`);
    assert.equal(f.q('[data-action="undo"]').disabled,true);
  });
});

test('keyboard undo during a live drag cancels that preview before restoring the last committed edit',async t=>{
  const f=await host(t),before=f.data(),actor=before.plays[0].players.find(p=>p.label==='X');
  const title=f.q('[data-prop="title"]');title.value='Committed title';title.dispatchEvent(new f.win.Event('change',{bubbles:true}));
  f.pointer(f.q(`#field [data-player="${actor.id}"]`),'pointerdown',actor);
  f.pointer(f.q('#field'),'pointermove',{x:actor.x+3,y:actor.y-3});
  await new Promise(resolve=>f.win.requestAnimationFrame(resolve));
  f.key(f.win.document.body,'z',{ctrlKey:true});
  f.pointer(f.q('#field'),'pointerup',{x:actor.x+3,y:actor.y-3});
  assert.deepEqual(f.data(),before,'undo restores the committed baseline and a late release cannot reapply the drag');
  f.action('redo');
  const redone=f.data();assert.equal(redone.plays[0].title,'Committed title');
  assert.deepEqual(redone.plays[0].players,before.plays[0].players,'redo cannot resurrect a cancelled drag preview');
});

test('draft Escape, context-menu keyboard access and JSON restore preserve the current play',async t=>{
  const f=await host(t),before=f.data(),actor=before.plays[0].players.find(p=>p.label==='X');
  const player=()=>f.q(`#field [data-player="${actor.id}"]`);
  f.key(player(),'Enter');f.action('tool:route');
  f.pointer(f.q('#field'),'pointerdown',{x:actor.x+4,y:actor.y-10});
  assert.ok(f.q('.drawing-steps'));
  f.key(f.win.document.body,'Escape');assert.equal(f.q('.drawing-steps'),null);
  assert.deepEqual(f.data(),before,'route cancellation does not overwrite saved data');
  f.key(player(),'F10',{shiftKey:true});
  assert.ok(f.q('#field-context [data-action="delete-selection"]'),'keyboard context actions are available for the focused marker');
  const note=f.q('[data-prop="name"]');note.value='Acceptance receiver';note.dispatchEvent(new f.win.Event('change',{bubbles:true}));
  const raw=f.raw(),restored=decodeWorkspace(raw);
  assert.equal(restored.plays[0].players.find(p=>p.id===actor.id).name,'Acceptance receiver');
  assert.deepEqual(decodeWorkspace(encodeWorkspace(restored)),restored,'saved JSON round-trips without losing geometry');
});

test('a touch-selected overlapping waypoint can be dragged after explicit candidate confirmation',async t=>{
  const seed=starterWorkspace(),play=seed.plays[0],owner=play.players.find(p=>p.label==='X'),overlap=play.players.find(p=>p.label==='Y');
  const route=play.routes.find(r=>r.playerId===owner.id);
  route.points[1]={x:overlap.x,y:overlap.y};
  const f=await host(t,{raw:encodeWorkspace(seed)}),before=f.data();
  f.key(f.q(`#field [data-route="${route.id}"]`),'Enter');
  const waypoint=()=>f.q(`#field [data-route-id="${route.id}"][data-point="1"]`);
  const touch={pointerType:'touch'};
  const occludingPlayer=()=>f.q(`#field [data-player="${overlap.id}"]`);
  f.pointer(occludingPlayer(),'pointerdown',overlap,touch);f.pointer(f.q('#field'),'pointerup',overlap,touch);
  const option=[...f.win.document.querySelectorAll('#field-context [data-action^="pick-candidate:"]')].find(button=>/节点|Waypoint/.test(button.textContent));
  assert.ok(option,'overlapping targets offer a waypoint candidate');option.click();
  const end={x:overlap.x+4,y:overlap.y-5};
  assert.ok(waypoint(),'the chosen route still exposes its endpoint');
  f.pointer(occludingPlayer(),'pointerdown',overlap,touch);f.pointer(f.q('#field'),'pointermove',end,touch);f.pointer(f.q('#field'),'pointerup',end,touch);
  const result=f.data().plays[0].routes.find(r=>r.id===route.id).points[1];
  assert.ok(Math.abs(result.x-end.x)<1e-9&&Math.abs(result.y-end.y)<1e-9,'confirmed waypoint moves instead of reopening the candidate menu');
  assert.deepEqual(f.data().plays[0].players,before.plays[0].players,'the overlapping player never moves');
  f.action('undo');assert.deepEqual(f.data(),before,'one Undo restores one completed waypoint gesture');
});

test('an explicit overlapping waypoint choice expires after cancellation, another location or a screen change',async t=>{
  for(const interruption of ['Escape','elsewhere','play','roster'])await t.test(interruption,async t=>{
    const seed=starterWorkspace(),play=seed.plays[0],owner=play.players.find(p=>p.label==='X'),overlap=play.players.find(p=>p.label==='Y');
    const route=play.routes.find(r=>r.playerId===owner.id);route.points[1]={x:overlap.x,y:overlap.y};
    const f=await host(t,{raw:encodeWorkspace(seed)}),before=f.data(),touch={pointerType:'touch'};
    const pickRoute=()=>f.key(f.q(`#field [data-route="${route.id}"]`),'Enter');
    const tapOverlap=()=>{f.pointer(f.q(`#field [data-player="${overlap.id}"]`),'pointerdown',overlap,touch);f.pointer(f.q('#field'),'pointerup',overlap,touch);};
    pickRoute();tapOverlap();
    [...f.win.document.querySelectorAll('#field-context [data-action^="pick-candidate:"]')].find(button=>/节点|Waypoint/.test(button.textContent)).click();
    if(interruption==='Escape')f.key(f.win.document.body,'Escape');
    else if(interruption==='elsewhere'){f.pointer(f.q('#field'),'pointerdown',{x:95,y:5},touch);f.pointer(f.q('#field'),'pointerup',{x:95,y:5},touch);}
    else if(interruption==='play'){f.action(`choose:${before.plays[1].id}`);f.action(`choose:${play.id}`);}
    else {f.q('.workspace-nav [data-workspace-mode="roster"]').click();f.q('.workspace-nav [data-workspace-mode="editor"]').click();}
    pickRoute();tapOverlap();
    assert.ok(f.q('.selection-candidates'),`old confirmation is not silently reused after ${interruption}`);
    assert.deepEqual(f.data(),before);
  });
});

test('an explicitly chosen player wins over a later-painted overlapping marker for exactly the next gesture',async t=>{
  const seed=starterWorkspace(),play=seed.plays[0],chosen=play.players.find(p=>p.label==='X'),overlap=play.players.find(p=>p.label==='Y');
  play.routes=[];overlap.x=chosen.x;overlap.y=chosen.y;
  const f=await host(t,{raw:encodeWorkspace(seed)}),before=f.data(),touch={pointerType:'touch'};
  const occluding=()=>f.q(`#field [data-player="${overlap.id}"]`);
  f.pointer(occluding(),'pointerdown',overlap,touch);f.pointer(f.q('#field'),'pointerup',overlap,touch);
  const option=[...f.win.document.querySelectorAll('#field-context [data-action^="pick-candidate:"]')].find(button=>button.textContent.trim()==='X');
  assert.ok(option);option.click();
  const end={x:chosen.x+3,y:chosen.y-2};
  f.pointer(occluding(),'pointerdown',overlap,touch);f.pointer(f.q('#field'),'pointermove',end,touch);f.pointer(f.q('#field'),'pointerup',end,touch);
  const result=f.data().plays[0].players.find(p=>p.id===chosen.id);
  assert.ok(Math.abs(result.x-end.x)<1e-9&&Math.abs(result.y-end.y)<1e-9);
  assert.deepEqual(f.data().plays[0].players.find(p=>p.id===overlap.id),overlap,'the painted-over player remains untouched');
  f.action('undo');assert.deepEqual(f.data(),before);
});

test('switching play or leaving the editor cancels a live drag before late release and preserves the next edit',async t=>{
  for(const destination of ['play','roster','history'])await t.test(destination,async t=>{
    const f=await host(t),before=f.data(),actor=before.plays[0].players.find(p=>p.label==='X');
    const oldField=f.q('#field');
    f.pointer(f.q(`#field [data-player="${actor.id}"]`),'pointerdown',actor);
    f.pointer(oldField,'pointermove',{x:actor.x+2,y:actor.y-2});
    await new Promise(resolve=>f.win.requestAnimationFrame(resolve));
    const historyRoute=hash=>{
      f.win.history.pushState(null,'','#'+hash);
      f.win.dispatchEvent(new f.win.Event('popstate'));
    };
    if(destination==='play')f.action(`choose:${before.plays[1].id}`);
    else if(destination==='roster')f.q('.workspace-nav [data-workspace-mode="roster"]').click();
    else historyRoute('roster');
    // A release may arrive after capture ownership was lost to a new screen.
    const at=project({x:actor.x+2,y:actor.y-2});
    oldField.dispatchEvent(new f.win.PointerEvent('pointerup',{bubbles:true,pointerId:1,isPrimary:true,clientX:at.x,clientY:at.y}));
    if(destination==='roster')f.q('.workspace-nav [data-workspace-mode="editor"]').click();
    if(destination==='history'){
      assert.equal(f.q('#app').hidden,true);
      historyRoute('editor');
      const title=f.q('[data-prop="title"]');
      title.value='Only a new title';title.dispatchEvent(new f.win.Event('change',{bubbles:true}));
      const expected=structuredClone(before);expected.plays[0].title=title.value;
      assert.deepEqual(f.data(),expected,'a later save cannot capture the interrupted drag');
      f.action('undo');
    }
    assert.deepEqual(f.data(),before,'switching screens cannot save a gesture preview');
    const id=destination==='play'?before.plays[1].id:before.plays[0].id;
    const active=f.data().plays.find(p=>p.id===id),next=active.players[0];
    f.pointer(f.q(`#field [data-player="${next.id}"]`),'pointerdown',next);
    f.pointer(f.q('#field'),'pointerup',{x:next.x+1,y:next.y-1});
    const saved=f.data().plays.find(p=>p.id===id).players.find(p=>p.id===next.id);
    assert.ok(Math.abs(saved.x-next.x-1)<1e-9,'the next screen owns its own gesture');
    f.action('undo');assert.deepEqual(f.data(),before);
  });
});

test('recovery read-only mode rejects injected movement, drawing and deletion without overwriting original bytes',async t=>{
  const raw='{"partiallyRecoverable":',f=await host(t,{raw});
  const close=f.q('[data-action="close-modal"]');assert.ok(close);close.click();
  const marker=f.q('#field [data-player]'),before=marker.getAttribute('transform');
  f.pointer(marker,'pointerdown',{x:30,y:50});f.pointer(f.q('#field'),'pointermove',{x:35,y:45});f.pointer(f.q('#field'),'pointerup',{x:35,y:45});
  f.key(f.win.document.body,'r');f.pointer(f.q('#field'),'pointerdown',{x:40,y:20});
  f.key(f.win.document.body,'Delete');f.key(f.win.document.body,'z',{ctrlKey:true});
  assert.equal(f.raw(),raw,'no attempted operation replaces the protected source');
  assert.equal(f.q('#field [data-player]').getAttribute('transform'),before);
  assert.equal(f.q('[data-action="undo"]').disabled,true);
  assert.equal(f.q('.drawing-steps'),null);
});

test('a new editor page restores saved metadata and geometry rather than reverting to the starter example',async t=>{
  let raw,expected;
  await t.test('write through the editor',async t=>{
    const f=await host(t),initial=f.data(),actor=initial.plays[0].players.find(p=>p.label==='X');
    const title=f.q('[data-prop="title"]');title.value='Saved acceptance play';title.dispatchEvent(new f.win.Event('change',{bubbles:true}));
    f.pointer(f.q(`#field [data-player="${actor.id}"]`),'pointerdown',actor);f.pointer(f.q('#field'),'pointerup',{x:actor.x+2,y:actor.y-2});
    expected=f.data();raw=f.raw();
    assert.equal(expected.plays[0].title,'Saved acceptance play');
    assert.ok(Math.abs(expected.plays[0].players.find(p=>p.id===actor.id).x-actor.x-2)<1e-9);
  });
  await t.test('reload into a fresh page',async t=>{
    const f=await host(t,{raw});
    assert.deepEqual(f.data(),expected);
    assert.match(f.q('.play-header h1').textContent,/Saved acceptance play/);
    const actor=expected.plays[0].players.find(p=>p.label==='X'),p=project(actor);
    assert.equal(f.q(`#field [data-player="${actor.id}"]`).getAttribute('transform'),`translate(${p.x.toFixed(2)} ${p.y.toFixed(2)})`);
    assert.equal(f.q('[data-action="undo"]').disabled,true,'reload does not invent a pre-reload history transaction');
  });
});

test('a successful local save retry resolves the failure feedback and retains the in-memory edits',async t=>{
  const failures={write:false},f=await host(t,{failures}),before=f.data();
  failures.write=true;
  const title=f.q('[data-prop="title"]');title.value='Retain this failed save';title.dispatchEvent(new f.win.Event('change',{bubbles:true}));
  assert.deepEqual(f.data(),before,'a rejected storage write preserves the last persisted document');
  assert.match(f.q('.play-header h1').textContent,/Retain this failed save/,'unsaved changes remain in the live editor');
  assert.equal(f.q('.editor-status').dataset.state,'error');
  assert.ok(f.q('.editor-status [data-action="retry-save"]'));
  assert.ok(f.q('.editor-status [data-action="download-json"]'));
  assert.equal(f.q('#toast').dataset.type,'error');
  failures.write=false;f.action('retry-save');
  assert.equal(f.data().plays[0].title,'Retain this failed save');
  assert.equal(f.q('.editor-status').dataset.state,'saved');
  assert.equal(f.q('.editor-status [data-action="retry-save"]'),null);
  assert.ok(!f.q('#toast').classList.contains('visible')||f.q('#toast').dataset.type!=='error','a resolved save failure is not left announced as an active error');
});

test('local storage failure prevents silent page exit until the edited document is saved successfully',async t=>{
  const failures={write:false},f=await host(t,{failures});
  // Happy DOM 20.8.4 mis-parses selected attributes even in a raw four-option
  // SELECT (it selects option 2 instead of the marked option 3). Normalize only
  // these already-committed defaults so that this test isolates the unload
  // guard, not the DOM emulator's default-selectedness defect. Real browser
  // default values are checked independently in the browser acceptance.
  const committedBallDefaults=()=>{for(const select of f.win.document.querySelectorAll('#app select[data-ball]'))select.value=select.querySelector('option[selected]')?.value??'';};
  committedBallDefaults();
  const clean=new f.win.Event('beforeunload',{cancelable:true});f.win.dispatchEvent(clean);
  const play=f.data().plays[0];
  const controls=[...f.win.document.querySelectorAll('#app [data-prop],#app [data-ball]')].map(input=>{const key=input.dataset.prop;return {tag:input.tagName,type:input.type,key,ball:input.dataset.ball,value:input.value,checked:input.checked,expected:input.dataset.ball?play.ball[input.dataset.ball]:key?.startsWith('ball.')?play.ball[key.slice(5)]:play[key],...(input.dataset.ball?{options:[...input.options].map(o=>({text:o.text,value:o.value,selected:o.selected,defaultSelected:o.defaultSelected}))}:{})};});
  assert.equal(clean.defaultPrevented,false,'clean fields must not trigger a data-loss warning: '+JSON.stringify(controls));
  failures.write=true;
  const title=f.q('[data-prop="title"]');title.value='Unsaved local work';title.dispatchEvent(new f.win.Event('change',{bubbles:true}));
  committedBallDefaults();
  const blocked=new f.win.Event('beforeunload',{cancelable:true});f.win.dispatchEvent(blocked);
  assert.equal(blocked.defaultPrevented,true,'a failed save cannot be silently lost on refresh or close');
  failures.write=false;f.action('retry-save');
  const saved=new f.win.Event('beforeunload',{cancelable:true});f.win.dispatchEvent(saved);
  assert.equal(saved.defaultPrevented,false,'a successful save removes the data-loss warning');
});

// See the isolated Happy DOM parser defect documented in the quota test above.
function normalizeCommittedSelectDefaults(doc) {
  for(const select of doc.querySelectorAll('#app select[data-prop],#app select[data-ball]'))select.value=select.querySelector('option[selected]')?.value??select.options[0]?.value??'';
}

test('committed player and route fields are clean in each palette while uncommitted edits protect page exit',async t=>{
  for(const theme of ['dark','light'])for(const color of ['#ffdc42','#ABCDEF'])await t.test(`${theme} ${color}`,async t=>{
    const seed=starterWorkspace(),play=seed.plays[0],actor=play.players.find(p=>p.label==='X'),route=play.routes.find(r=>r.playerId===actor.id);
    seed.settings.fieldTheme=theme;actor.color=color;route.color=color;
    const f=await host(t,{raw:encodeWorkspace(seed)});
    const blocked=()=>{const event=new f.win.Event('beforeunload',{cancelable:true});f.win.dispatchEvent(event);return event.defaultPrevented;};
    f.key(f.q(`#field [data-player="${actor.id}"]`),'Enter');normalizeCommittedSelectDefaults(f.win.document);
    // Native color controls expose the same RGB in lowercase.
    f.q('[data-prop="color"]').value=f.q('[data-prop="color"]').value.toLowerCase();
    assert.equal(blocked(),false,'selecting a player does not create an unsaved color edit');
    const name=f.q('[data-prop="name"]');name.value='Typing only';name.dispatchEvent(new f.win.Event('input',{bubbles:true}));
    assert.equal(blocked(),true);assert.equal(f.q('.editor-status').dataset.state,'unsaved');
    name.value=actor.name;name.dispatchEvent(new f.win.Event('input',{bubbles:true}));assert.equal(blocked(),false);
    f.key(f.q(`#field [data-route="${route.id}"]`),'Enter');normalizeCommittedSelectDefaults(f.win.document);
    f.q('[data-prop="color"]').value=f.q('[data-prop="color"]').value.toLowerCase();
    assert.equal(blocked(),false,'selecting a route does not create an unsaved color edit');
    const duration=f.q('[data-prop="duration"]');duration.value=String(route.duration+1);duration.dispatchEvent(new f.win.Event('input',{bubbles:true}));
    assert.equal(blocked(),true);
    duration.dispatchEvent(new f.win.Event('change',{bubbles:true}));normalizeCommittedSelectDefaults(f.win.document);
    f.q('[data-prop="color"]').value=f.q('[data-prop="color"]').value.toLowerCase();
    assert.equal(f.data().plays[0].routes.find(r=>r.id===route.id).duration,route.duration+1);
    assert.equal(blocked(),false,'committing a valid route field clears its unfinished state');
  });
});

test('a route draft protects page exit until it is cancelled, then a clean editor can leave normally',async t=>{
  const f=await host(t),actor=f.data().plays[0].players.find(p=>p.label==='X');
  const blocked=()=>{const event=new f.win.Event('beforeunload',{cancelable:true});f.win.dispatchEvent(event);return event.defaultPrevented;};
  f.key(f.q(`#field [data-player="${actor.id}"]`),'Enter');f.action('tool:route');
  normalizeCommittedSelectDefaults(f.win.document);
  assert.equal(blocked(),false,'selecting the route tool without an endpoint is not a meaningful draft');
  f.pointer(f.q('#field'),'pointerdown',{x:actor.x+3,y:actor.y-4});
  assert.equal(blocked(),true,'an unfinished route endpoint must not be silently lost');
  f.action('cancel-draft');f.action('clear-selection');normalizeCommittedSelectDefaults(f.win.document);
  assert.equal(blocked(),false,'discarding a draft releases the page-exit guard');
});

test('a committed new zone refreshes its SVG and selected properties and remains one reversible edit',async t=>{
  const f=await host(t),before=f.data(),svg=f.q('#field .pitch-svg'),field=f.q('#field'),viewport=f.q('.pitch-viewport');
  f.action('tool:zone');
  f.pointer(field,'pointerdown',{x:20,y:20});f.pointer(field,'pointermove',{x:60,y:50});
  await new Promise(resolve=>f.win.requestAnimationFrame(resolve));
  const previewId=f.q('#field [data-zone]')?.dataset.zone;assert.ok(previewId,'the live zone preview exists before release');
  f.pointer(field,'pointerup',{x:60,y:50});
  const edited=f.data(),zones=edited.plays[0].zones;
  assert.equal(zones.length,1);assert.equal(zones[0].id,previewId,'committing the preview preserves its selected ID');
  const zone=zones[0],close=(actual,expected)=>assert.ok(Math.abs(Number(actual)-expected)<1e-9);
  close(zone.x,40);close(zone.y,35);close(zone.rx,20);close(zone.ry,15);
  assert.equal(f.q('#field'),field);assert.equal(f.q('#field .pitch-svg'),svg);assert.equal(f.q('.pitch-viewport'),viewport);
  assert.equal(f.win.document.querySelectorAll('#field [data-zone]').length,1);
  const ellipse=f.q(`#field [data-zone="${zone.id}"] ellipse`),point=project(zone);
  close(ellipse.getAttribute('cx'),point.x);close(ellipse.getAttribute('cy'),point.y);close(ellipse.getAttribute('rx'),zone.rx*9.64);close(ellipse.getAttribute('ry'),zone.ry*7.6);
  assert.equal(f.q('.inspector').dataset.context,`zone:${zone.id}`);
  close(f.q('[data-prop="rx"]').value,20);close(f.q('[data-prop="ry"]').value,15);
  assert.equal(f.q('.editor-status').dataset.state,'saved');assert.equal(f.q('.play-actions [data-action="undo"]').disabled,false);
  f.action('undo');assert.deepEqual(f.data(),before);assert.equal(f.q('#field [data-zone]'),null);
  f.action('redo');assert.deepEqual(f.data(),edited);assert.ok(f.q(`#field [data-zone="${zone.id}"]`));
});

test('committing a motion waypoint redraws the reanchored follow-up route and the current handle',async t=>{
  const seed=starterWorkspace(),play=seed.plays[0],actor=play.players.find(p=>p.label==='X');
  play.routes=play.routes.filter(route=>route.playerId!==actor.id);
  const line=(id,kind,points,delay,duration)=>({id,playerId:actor.id,kind,points,color:actor.color,smooth:false,endCap:'arrow',optional:false,delay,duration});
  const motion=line('acceptance-motion','motion',[{x:actor.x,y:actor.y},{x:30,y:67}],0,2);
  const follow=line('acceptance-follow','route',[{x:30,y:67},{x:30,y:40}],2,4);
  play.routes.push(motion,follow);
  const f=await host(t,{raw:encodeWorkspace(seed)}),before=f.data(),svg=f.q('#field .pitch-svg');
  f.key(f.q('#field [data-route="acceptance-motion"]'),'Enter');
  const path=()=>f.q('#field [data-route="acceptance-follow"] .route-stroke');
  const oldPath=path().getAttribute('d'),start=motion.points[1],end={x:35,y:63};
  f.pointer(f.q('#field [data-route-id="acceptance-motion"][data-point="1"]'),'pointerdown',start);
  f.pointer(f.q('#field'),'pointermove',end);await new Promise(resolve=>f.win.requestAnimationFrame(resolve));
  const previewPath = path().getAttribute('d');
  assert.notEqual(previewPath, oldPath, 'the linked route follows the motion endpoint in the drag frame');
  f.pointer(f.q('#field'),'pointerup',end);
  const edited=f.data(),next=edited.plays[0].routes.find(route=>route.id==='acceptance-follow');
  assert.equal(path().getAttribute('d'), previewPath, 'a validated motion edit has no release jump');
  assert.ok(Math.abs(next.points[0].x-35)<1e-9&&Math.abs(next.points[0].y-63)<1e-9);
  assert.ok(Math.abs(next.points[1].x-35)<1e-9&&Math.abs(next.points[1].y-36)<1e-9);assert.equal(next.delay,2);
  assert.equal(f.q('#field .pitch-svg'),svg);
  assert.notEqual(path().getAttribute('d'),oldPath);assert.equal(path().getAttribute('d'),routePath(next),'the field reflects dependent geometry changed by the domain commit');
  const handle=f.q('#field .point-hit[data-route-id="acceptance-motion"][data-point="1"]'),point=project(end);
  assert.ok(Math.abs(Number(handle.getAttribute('cx'))-point.x)<1e-9&&Math.abs(Number(handle.getAttribute('cy'))-point.y)<1e-9);
  assert.equal(f.q('.inspector').dataset.context,'route:acceptance-motion');assert.equal(Number(f.q('[data-prop="duration"]').value),2);
  f.action('undo');assert.deepEqual(f.data(),before);assert.equal(path().getAttribute('d'),oldPath);
  f.action('redo');assert.deepEqual(f.data(),edited);assert.equal(path().getAttribute('d'),routePath(next));
  f.key(f.q('#field [data-route="acceptance-motion"]'),'Enter');
  f.pointer(f.q('#field .point-hit[data-route-id="acceptance-motion"][data-point="1"]'),'pointerdown',end);
  const outside = { x: end.x, y: 1 };
  f.pointer(f.q('#field'),'pointermove',outside);await new Promise(resolve=>f.win.requestAnimationFrame(resolve));
  f.pointer(f.q('#field'),'pointerup',outside);
  assert.deepEqual(f.data(),edited,'an out-of-bounds follower rejects the entire motion edit');
  assert.equal(path().getAttribute('d'),routePath(next),'the rejected preview rolls back the follower');
  f.action('undo');assert.deepEqual(f.data(),before);
});

test('metadata edits and subsequent gesture commits retain the correct 11-player or flag league badge',async t=>{
  for(const count of [11,5])await t.test(`${count} per side`,async t=>{
    const seed=starterWorkspace();if(count===5)seed.plays=[makePlay({count:5,formation:'Flag 5 Spread',title:'Flag badge'})];
    const f=await host(t,{raw:encodeWorkspace(seed)}),expected=count===5?/5.*腰旗/:/11.*人制/;
    assert.match(f.q('.league-badge').textContent,expected);
    for(const [name,value]of [['title','Updated title'],['personnel','Updated personnel'],['category','Updated category']]){
      const input=f.q(`[data-prop="${name}"]`);input.value=value;input.dispatchEvent(new f.win.Event('change',{bubbles:true}));
      assert.match(f.q('.league-badge').textContent,expected,`${name} editing keeps the format visible`);
    }
    const actor=f.data().plays[0].players.find(p=>p.label==='X');
    f.pointer(f.q(`#field [data-player="${actor.id}"]`),'pointerdown',actor);f.pointer(f.q('#field'),'pointerup',{x:actor.x+1,y:actor.y-1});
    assert.match(f.q('.league-badge').textContent,expected,'geometry commit keeps the format visible');
    f.action('undo');assert.match(f.q('.league-badge').textContent,expected);
  });
});

test('a landscape editor can add an optional route beside Finish without changing rehearsal',async t=>{
  const f=await host(t);
  f.win.happyDOM.setWindowSize({width:844,height:390});
  const before=f.data().plays[0],actor=before.players.find(player=>player.label==='X');
  const {animatedPlayer}=await import('../web/model.js');
  const atTime=play=>[1,2,4].map(time=>animatedPlayer(play,actor,time));
  f.key(f.q(`#field [data-player="${actor.id}"]`),'Enter');f.action('tool:route');
  f.pointer(f.q('#field'),'pointerdown',{x:actor.x+4,y:actor.y-10});
  const purpose=f.q('#field-context #draft-mode');
  assert.ok(purpose,'route purpose belongs to the active drafting controls');
  purpose.focus();purpose.value='optional';
  purpose.dispatchEvent(new f.win.Event('change',{bubbles:true}));
  assert.equal(f.win.document.activeElement,purpose,'selecting a purpose keeps keyboard focus');
  f.action('finish-route');
  const after=f.data().plays[0],added=after.routes.find(route=>!before.routes.some(item=>item.id===route.id));
  assert.equal(added.optional,true);
  assert.deepEqual(after.routes.filter(route=>route.id!==added.id),before.routes);
  assert.deepEqual(atTime(after),atTime(before));
  f.action('undo');assert.deepEqual(f.data().plays[0],before);
});

test('history feedback uses the final hit position for an immediate drag and keeps keyboard focus on the real player', async t => {
  const f=await host(t), before=f.data(), actor=before.plays[0].players.find(p=>p.label==='X');
  const marker=()=>f.q('#field [data-player="' + actor.id + '"]');
  const field=f.q('#field'), end={x:actor.x+3,y:actor.y-2};
  f.pointer(marker(),'pointerdown',actor);
  f.pointer(field,'pointerup',end);
  const moved=f.data();
  marker().focus();
  f.key(marker(),'z',{ctrlKey:true});
  assert.deepEqual(f.data(),before);
  const overlay=f.q('#field .history-transition');
  assert.ok(overlay?.querySelector('[data-history-player]'));
  assert.equal(f.win.document.activeElement,marker());
  assert.equal(f.q('#toast').getAttribute('role'),'status');
  f.action('redo');
  assert.deepEqual(f.data(),moved);
  assert.equal(overlay.isConnected,false);
  assert.ok(f.q('#field .history-transition'));
  f.pointer(marker(),'pointerdown',end,{pointerType:'touch'});
  assert.equal(f.q('#field .history-transition'),null);
  const next={x:end.x+2,y:end.y-1};
  f.pointer(field,'pointerup',next,{pointerType:'touch'});
  const result=f.data().plays[0].players.find(p=>p.id===actor.id);
  assert.ok(Math.abs(result.x-next.x)<1e-9 && Math.abs(result.y-next.y)<1e-9);
  const matchMedia=f.win.matchMedia.bind(f.win);
  f.win.matchMedia=query=>query.includes('prefers-reduced-motion')?{...matchMedia(query),matches:true}:matchMedia(query);
  f.action('undo');
  assert.deepEqual(f.data(),moved);
  assert.equal(f.q('#field .history-transition'),null);
  assert.match(f.q('#toast').textContent,/Undone|已撤销/);
});
