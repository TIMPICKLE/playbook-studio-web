import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Window } from 'happy-dom';
import { animatedPlayer, encodeWorkspace, starterWorkspace, STORAGE_KEY } from '../web/model.js';
import { project } from '../web/field.js';

test('native range presents the latest seek, preserves focus and cancels obsolete frames', async t => {
  const win = new Window({url:'http://localhost:3000/local.html#editor', width:1440, height:900});
  const doc = win.document, data = starterWorkspace(), play = data.plays[0];
  const saved = encodeWorkspace(data);
  win.localStorage.setItem(STORAGE_KEY, saved);
  win.localStorage.setItem('playbook-studio:onboarding:v1', JSON.stringify({dismissed:true, completed:[]}));
  doc.body.innerHTML = readFileSync(new URL('../web/index.html',import.meta.url),'utf8').split('<body>')[1].split('</body>')[0];
  let nextFrame = 0, stamp = 0;
  const frames = new Map();
  win.requestAnimationFrame = callback => { frames.set(++nextFrame, callback); return nextFrame; };
  win.cancelAnimationFrame = id => frames.delete(id);
  const tick = () => {
    stamp += 16;
    for (const [id, callback] of [...frames]) if (frames.delete(id)) callback(stamp);
  };
  const globals = ['window','document','navigator','localStorage','location','history','Image','Blob','requestAnimationFrame','cancelAnimationFrame'];
  const prior = new Map(globals.map(key => [key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  for (const key of globals) Object.defineProperty(globalThis,key,{configurable:true,
    value:['requestAnimationFrame','cancelAnimationFrame'].includes(key) ? win[key].bind(win) : win[key]});
  t.after(async () => {
    win.dispatchEvent(new win.Event('pagehide')); await win.happyDOM.abort();
    for (const [key, descriptor] of prior) {
      if (descriptor) Object.defineProperty(globalThis,key,descriptor);
      else delete globalThis[key];
    }
  });
  await import('../web/app.js?timeline-scrub');
  const q = selector => doc.querySelector(selector);
  const action = name => q(`[data-action="${name}"]`).click();
  const range = () => q('#timeline');
  const seek = (value, type = 'input') => {
    range().value = String(value);
    range().dispatchEvent(new win.Event(type,{bubbles:true}));
  };
  const actor = play.players.find(p => p.id === play.routes[0].playerId);
  const pose = seconds => {
    const {x,y} = project(animatedPlayer(play,actor,seconds));
    return `translate(${x.toFixed(2)} ${y.toFixed(2)})`;
  };
  const marker = q(`#field [data-player="${actor.id}"]`);
  let writes = 0, layoutReads = 0;
  const setMarker = marker.setAttribute.bind(marker);
  marker.setAttribute = (key,value) => { if (key === 'transform') writes++; return setMarker(key,value); };
  const field = q('#field'), measure = field.getBoundingClientRect.bind(field);
  field.getBoundingClientRect = () => { layoutReads++; return measure(); };
  tick(); writes = 0; layoutReads = 0;
  range().focus();

  for (let i = 1; i <= 12; i++) seek(i / 10);
  assert.equal(writes,0,'intermediate range values never paint synchronously');
  tick();
  assert.equal(writes,1);
  assert.equal(marker.getAttribute('transform'),pose(1.2));
  assert.equal(layoutReads,0,'the native slider does not measure layout for an assistant receipt');
  assert.match(q('#time-label').textContent,/1\.2/);
  assert.equal(q('.editor-mode [data-action="rehearse-mode"]').getAttribute('aria-pressed'),'true');
  assert.equal(doc.activeElement,range());

  seek(2.1); seek(2.3);
  range().value = '2.45';
  range().dispatchEvent(new win.PointerEvent('pointerup',{bubbles:true,pointerId:1}));
  assert.equal(marker.getAttribute('transform'),pose(2.45));
  assert.equal(writes,2,'release flushes the last position before the next frame');
  seek(2.45,'change'); tick();
  assert.equal(writes,2,'a following change and frame do not present the final position again');

  const arrow = new win.KeyboardEvent('keydown',{key:'ArrowLeft',bubbles:true,cancelable:true});
  range().dispatchEvent(arrow);
  assert.equal(arrow.defaultPrevented,false,'the range keeps native keyboard behavior');
  seek(.7,'change');
  assert.equal(marker.getAttribute('transform'),pose(.7),'a keyboard or assistive-tech change without an input still commits');
  seek(0,'change');
  assert.match(q('.context-status').textContent,/就绪|准备|Ready/i);
  seek(Number(range().max),'change');
  assert.match(q('#field-context').textContent,/重播|重新播放|Replay/i);

  seek(1.7);
  action('play');
  tick();
  assert.equal(Number(range().value),1.7,'play starts at the latest pending seek');
  tick();
  assert.ok(Number(range().value)>1.7);
  seek(.5);
  tick();tick();
  assert.equal(Number(range().value),.5);
  assert.equal(q('#field').classList.contains('is-running'),false);
  seek(2.8);
  action('reset');
  tick();
  assert.equal(Number(range().value),0);
  assert.equal(q('#field .pitch-svg').querySelector(`[data-player="${actor.id}"]`).getAttribute('transform'),pose(0));

  seek(1.8);
  const nextPlay = data.plays.find(p=>p.id!==play.id && p.book===play.book);
  action('choose:'+nextPlay.id);
  tick();
  assert.ok(q('h1').textContent.includes(nextPlay.title));
  assert.equal(Number(range().value),0);
  seek(1.2);
  q('.workspace-nav [data-workspace-mode="roster"]').click();
  tick();
  q('.workspace-nav [data-workspace-mode="editor"]').click();
  tick();
  assert.equal(Number(range().value),0,'returning to the editor cannot adopt a seek from the previous surface');

  action('edit-mode');
  q('#field [data-player]').dispatchEvent(new win.KeyboardEvent('keydown',{key:'Enter',bubbles:true}));
  action('tool:route');
  assert.ok(q('#field-context [data-action="cancel-draft"]'));
  seek(1); tick();
  assert.equal(Number(range().value),0,'an unfinished drawing keeps its editing time');
  assert.ok(q('#field-context [data-action="cancel-draft"]'));
  assert.equal(win.localStorage.getItem(STORAGE_KEY),saved);

  action('cancel-draft');
  action('choose:'+play.id);
  q(`#field [data-route="${play.routes[0].id}"]`).dispatchEvent(new win.KeyboardEvent('keydown',{key:'Enter',bubbles:true}));
  const duration = q('[data-prop="duration"]'), slider = range();
  const editDuration = seconds => {
    duration.focus(); duration.value = String(seconds);
    duration.dispatchEvent(new win.Event('change',{bubbles:true}));
    assert.equal(range(),slider);
    assert.equal(doc.activeElement,duration,'timing updates preserve inspector focus');
  };
  editDuration(9);
  assert.equal(Number(slider.max),9);
  editDuration(3);
  assert.equal(Number(slider.max),6,'a shorter route updates the retained slider immediately');
  // A stale range value must still be bounded by the current model.
  slider.focus(); slider.max = '9'; seek(8,'change');
  assert.equal(Number(slider.value),6); assert.equal(Number(slider.max),6);
  assert.match(q('#time-label').textContent,/6\.0.*6\.0s/);
  assert.equal(doc.activeElement,slider);
  editDuration(10);
  assert.equal(Number(slider.max),10,'a longer route makes the extra time reachable');
  slider.focus(); seek(9.5,'change');
  assert.equal(Number(slider.value),9.5);
  assert.match(q('#time-label').textContent,/9\.5.*10\.0s/);
  assert.equal(doc.activeElement,slider);
});
