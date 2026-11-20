import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makePlay, starterWorkspace, decodeWorkspace } from '../web/model.js';
import { makeMaddenPlay, hasEditableTrace } from '../web/madden-model.js';

import {editor,actorId} from './helpers/coach-film-editor.mjs';

function chooseFilmActor(f,play,label) {
  f.click('#coach-film-room [data-film-pick="'+actorId(play,label)+'"]');
}
function filmTime(f) {
  return Number(f.node('#coach-film-room [data-film-time][type=range]').value);
}
function seekFilm(f,value) {
  const range=f.node('#coach-film-room input[data-film-time]');
  range.value=String(value);f.emit(range,'input');f.emit(range,'change');
}
function filmPose(f) {
  return [...f.doc.querySelectorAll('#coach-film-room [data-film-player],#coach-film-room [data-film-ball]')]
    .map(el=>[el.dataset.filmPlayer||'ball',el.getAttribute('transform'),el.dataset.phase]);
}

test('the two portable trials import through the editor and resolve opposite answers at distinct release times',async t=>{
  const f=await editor(t);
  for (const [id,time,deeper,other,gap] of [['a',2,'H','Y',3],['b',2.35,'Y','H',4]]) {
    const json=readFileSync(new URL('../samples/coach-film/pilot-'+id+'.json',import.meta.url),'utf8');
    const decoded=decodeWorkspace(json);
    const input=f.node('#import-input');
    Object.defineProperty(input,'files',{configurable:true,value:[new f.win.File([json],'pilot-'+id+'.json',{type:'application/json'})]});
    f.emit(input,'change');
    await f.waitFor('[data-action="confirm-import"]');
    f.action('confirm-import');
    assert.ok(f.node('.play-header h1').textContent.includes(decoded.plays[0].title));
    const saved=f.raw();
    const [play]=decodeWorkspace(saved).plays.slice(-1);
    assert.equal(play.players.length,11);
    assert.equal(play.routes.length,10);
    assert.equal(play.notes,'','the trial gives away no answer');
    await f.openFilm();
    f.click('[data-film-event="release"]');
    chooseFilmActor(f,play,deeper);
    chooseFilmActor(f,play,other);
    assert.equal(filmTime(f),time,'the event time is more precise than its formatted label');
    const text=f.node('[data-film-comparison]').textContent;
    assert.match(text,new RegExp(deeper+'.*'+other+'.*'+gap+'(?:\\.0)?\\s*码'));
    f.closeFilm();
    assert.equal(f.raw(),saved,'the walkthrough adds no workbench write');
  }
});

test('Mesh release, scrub and event keys update the same focused field without writing or seeking the editor',async t=>{
  const seed=starterWorkspace(),play=seed.plays[0];
  const f=await editor(t,{seed,digital:true,reduced:true});
  const before=f.raw();
  f.action('rehearse-mode');
  f.change('#speed',1.5);
  f.change('#timeline',.8);
  const fieldBefore=f.node('#field .pitch-svg'),digitalMode=f.doc.documentElement.dataset.visualMode;
  const dialog=await f.openFilm();
  assert.equal(filmTime(f),0);
  assert.deepEqual([...dialog.querySelectorAll('[data-film-event]')].map(b=>b.dataset.filmEvent),['start','release','arrival','end']);
  f.key(dialog,']');
  assert.equal(filmTime(f),2);
  chooseFilmActor(f,play,'H');
  // Select the second player on the board to exercise both normal input paths.
  f.key(f.node('[data-film-player="'+actorId(play,'Y')+'"]'),'Enter');
  assert.match(f.node('[data-film-comparison]').textContent,/H.*Y.*3(?:\.0)?\s*码/);
  seekFilm(f,1);
  assert.match(f.node('[data-film-comparison]').textContent,/H.*Y.*1(?:\.0)?\s*码/);
  seekFilm(f,2.5);
  const pose=filmPose(f);
  assert.equal(f.node('[data-film-ball]').dataset.phase,'flight');
  f.key(dialog,'ArrowRight',{altKey:true});
  assert.equal(filmTime(f),3);
  f.click('[data-film-action="play"]');
  seekFilm(f,2.5);
  await new Promise(resolve=>f.win.requestAnimationFrame(resolve));
  assert.equal(filmTime(f),2.5,'the scrub remains paused after release');
  assert.deepEqual(filmPose(f),pose,'returning from a different time yields the identical player and ball pose');
  f.click('[data-film-action="theme"]');
  assert.equal(filmTime(f),2.5);
  assert.match(f.node('[data-film-comparison]').textContent,/H.*Y.*3(?:\.0)?\s*码/);
  f.key(dialog,'Escape');
  assert.equal(f.q('#coach-film-room[open]'),null);
  assert.equal(f.node('#field .pitch-svg'),fieldBefore,'existing editor board was not remounted');
  assert.equal(Number(f.node('#timeline').value),.8);
  assert.equal(f.node('#speed').value,'1.5');
  assert.equal(f.doc.documentElement.dataset.visualMode,digitalMode);
  assert.equal(f.doc.activeElement,f.node('[data-action="coach-film"]'));
  assert.equal(f.raw(),before);
});

test('a pending route and zoomed layout survive teaching, then the first Undo removes only the committed edit',async t=>{
  const seed=starterWorkspace(),play=seed.plays[0],qb=actorId(play,'QB');
  const f=await editor(t,{seed});
  const saved=f.raw();
  f.key(f.node('#field [data-player="'+qb+'"]'),'Enter');
  f.action('tool:route');
  const field=f.node('#field');
  f.node('#field .pitch-svg').getBoundingClientRect=()=>({left:0,top:0,width:1000,height:800});
  field.dispatchEvent(new f.win.PointerEvent('pointerdown',{bubbles:true,button:0,pointerId:1,clientX:510,clientY:440}));
  const points=f.node('.context-player').textContent;
  f.click('[data-board-action="zoom-in"]');
  const viewport=f.node('.pitch-viewport'),zoom=f.node('#board-zoom-value').textContent;
  viewport.scrollTop=75;viewport.scrollLeft=30;
  for(let i=0;i<3;i++){
    const dialog=await f.openFilm();
    chooseFilmActor(f,play,'Y');
    f.key(dialog,'Escape');
    assert.equal(f.q('#coach-film-room[open]'),null);
    assert.equal(f.q('dialog.editor-dialog[open]'),null,'entering film never asks to discard the unfinished route');
    assert.equal(f.node('.context-player').textContent,points);
    assert.equal(f.node('#board-zoom-value').textContent,zoom);
    assert.equal(f.node('.pitch-viewport').scrollLeft,30);
    assert.equal(f.node('.pitch-viewport').scrollTop,75);
    assert.equal(f.node('[data-action="undo"]').disabled,true);
    assert.equal(f.raw(),saved);
  }
  f.action('finish-route');
  assert.equal(decodeWorkspace(f.raw()).plays[0].routes.length,play.routes.length+1);
  f.action('undo');
  assert.deepEqual(decodeWorkspace(f.raw()),decodeWorkspace(saved));
});

test('changing the pass in the editable inspector invalidates old event and focus state',async t=>{
  const seed=starterWorkspace(),play=seed.plays[0];
  const f=await editor(t,{seed});
  await f.openFilm();
  chooseFilmActor(f,play,'Y');
  f.click('[data-film-event="release"]');
  f.closeFilm();
  f.change('[data-prop="ball.passAt"]',1.4);
  await f.openFilm();
  f.click('[data-film-event="release"]');
  assert.equal(filmTime(f),1.4);
  f.closeFilm();
  f.change('[data-ball="receiverId"]','');
  await f.openFilm();
  assert.equal(f.q('[data-film-event="release"]'),null);
  assert.equal(f.q('[data-film-event="arrival"]'),null);
  assert.equal(filmTime(f),0);
  f.closeFilm();
  f.action('undo');
  await f.openFilm();
  f.click('[data-film-event="release"]');
  assert.equal(filmTime(f),1.4);
});

test('an unfinished inspector input retains its draft status across native modal focus changes',async t=>{
  const f=await editor(t);
  const original=f.raw(),title=f.node('[data-prop="title"]');
  title.focus();title.value='Unfinished play name';f.emit(title,'input');
  assert.equal(f.node('.editor-status').dataset.state,'unsaved');
  const launch=f.node('[data-action="coach-film"]');
  const down=new f.win.PointerEvent('pointerdown',{bubbles:true,cancelable:true,button:0});
  launch.dispatchEvent(down);
  assert.ok(down.defaultPrevented,'the trigger leaves native blur until the read-only dialog opens');
  launch.click();
  await f.waitFor('#coach-film-room[open]');
  // Native text fields emit a change on focus loss after a user edit. happy-dom
  // cannot infer a trusted keystroke from the programmatic input above.
  f.emit(title,'change');
  f.closeFilm();
  assert.equal(f.node('[data-prop="title"]'),title);
  assert.equal(title.value,'Unfinished play name');
  assert.equal(f.raw(),original);
  assert.equal(f.node('.editor-status').dataset.state,'unsaved');
  const unload=new f.win.Event('beforeunload',{cancelable:true});
  f.win.dispatchEvent(unload);
  assert.ok(unload.defaultPrevented,'closing the tab protects the uncommitted field');
  f.emit(title,'change');
  assert.equal(decodeWorkspace(f.raw()).plays[0].title,'Unfinished play name');
});

test('a cloud viewer follows live corrections, then leaves an open room on book change and access loss',async t=>{
  const data=starterWorkspace();
  const a={id:'club-a',title:'Club A',role:'viewer',revision:1,data};
  const b={id:'club-b',title:'Club B',role:'viewer',revision:1,data:structuredClone(data)};
  b.data.plays[0].title='Away team Mesh'; // Same play ID in a different book.
  let nextBook,revoked=false;
  const calls=[];
  const cloud={fetch:async (path,options={})=>{
    const method=options.method||'GET';calls.push({path,method});
    assert.equal(method,'GET','teaching or changing books never writes to cloud storage');
    if(path==='/api/session')return Response.json({user:{id:'coach',name:'Coach'}});
    if(path==='/api/workspaces')return Response.json({workspaces:[a,b].map(({id,title,role})=>({id,title,role}))});
    if(path==='/api/workspaces/club-a')return Response.json(a);
    if(path==='/api/workspaces/club-b')return nextBook.promise;
    if(path.startsWith('/api/workspaces/club-a?after='))return Response.json(a);
    if(revoked&&path.startsWith('/api/workspaces/club-b?after='))return Response.json({error:'Access removed'},{status:403});
    throw Error('Unexpected request '+path);
  }};
  const f=await editor(t,{cloud});
  await f.waitFor('[data-cloud-action="enter-editor"]');
  f.click('[data-cloud-action="enter-editor"]');
  await f.waitFor('[data-action="coach-film"]');
  const local=f.raw();
  assert.ok(f.node('[data-prop="title"]').disabled);
  const room=await f.openFilm();
  const h=actorId(a.data.plays[0],'H');
  chooseFilmActor(f,a.data.plays[0],'H');
  f.click('[data-film-event="release"]');
  assert.equal(filmTime(f),2);
  a.data.plays[0].ball.passAt=1.45;a.revision++;
  await cloud.poll();
  assert.equal(f.node('#coach-film-room[open]'),room,'the same play stays open');
  assert.equal(filmTime(f),1.45);
  assert.equal(f.node('[data-film-pick="'+h+'"]').getAttribute('aria-pressed'),'true');
  f.closeFilm();

  // The coach may dismiss the book picker and return to the current play
  // while the next book is still downloading.
  nextBook=Promise.withResolvers();
  f.click('[data-cloud-action="books"]');
  f.click('[data-book-id="club-b"]');
  f.click('.modal [data-action="close-modal"]');
  await f.openFilm();
  nextBook.resolve(Response.json(b));
  await f.waitFor('[data-prop="title"][value="Away team Mesh"]');
  assert.equal(f.q('#coach-film-room[open]'),null,'workspace boundaries discard the previous session even with identical play IDs');
  await f.openFilm();
  assert.equal(filmTime(f),0);
  assert.equal(f.q('[data-film-pick][aria-pressed="true"]'),null);
  revoked=true;
  await cloud.poll();
  assert.equal(f.q('#coach-film-room[open]'),null);
  assert.ok(f.node('#app').hidden);
  assert.ok(f.node('[data-cloud-action="reload-cloud"]'));
  assert.equal(f.raw(),local);
  assert.deepEqual([...new Set(calls.map(call=>call.method))],['GET']);
});

test('a third focus requires explicit replacement, native close or workspace departure releases the room',async t=>{
  const seed=starterWorkspace(),play=seed.plays[0];
  const f=await editor(t,{seed,locale:'en'});
  const selected=()=>[...f.doc.querySelectorAll('[data-film-pick][aria-pressed="true"]')].map(el=>el.dataset.filmPick).sort();
  const saved=f.raw();
  const dialog=await f.openFilm();
  for(const label of ['H','Y','X'])chooseFilmActor(f,play,label);
  assert.deepEqual(selected(),[actorId(play,'H'),actorId(play,'Y')].sort());
  f.click('[data-film-action="cancel-replace"]');
  assert.equal(f.q('[data-film-replace]:not([hidden])'),null);
  chooseFilmActor(f,play,'X');
  f.click('[data-film-replace="'+actorId(play,'H')+'"]');
  assert.deepEqual(selected(),[actorId(play,'X'),actorId(play,'Y')].sort());
  dialog.close();
  assert.equal(f.q('#coach-film-room[open]'),null);
  await f.openFilm();
  f.win.location.hash='#roster';
  await f.waitFor('body[data-workspace-mode="roster"]');
  assert.equal(f.q('#coach-film-room[open]'),null);
  assert.equal(f.raw(),saved);
});

test('run plays, diagrams without coordinates and restricted devices keep their proper entry paths',async t=>{
  const seed=starterWorkspace();
  const catalog=JSON.parse(readFileSync(new URL('../web/data/huddle-catalog.json',import.meta.url)));
  const reference=makeMaddenPlay(catalog.plays.find(entry=>!hasEditableTrace(entry.id)));
  const staticPlay=makePlay({title:'Standing formation'});
  seed.plays=[seed.plays.find(p=>p.title.startsWith('Inside Zone')),reference,staticPlay];
  const f=await editor(t,{seed});
  await f.openFilm();
  assert.equal(f.q('[data-film-event="release"],[data-film-event="arrival"]'),null);
  assert.ok(f.q('[data-film-player="'+actorId(seed.plays[0],'RB')+'"]'));
  f.closeFilm();
  f.action('choose:'+reference.id);
  let dialog=await f.openFilm();
  assert.match(dialog.textContent,/坐标/);
  assert.equal(f.q('[data-film-event="release"],[data-film-player]'),null);
  f.closeFilm();
  f.action('choose:'+staticPlay.id);
  dialog=await f.openFilm();
  assert.match(dialog.textContent,/布阵|站位/);
  assert.equal(f.q('[data-film-event="release"]'),null);
  f.closeFilm();
  for (const device of ['iphone','ipad']) await t.test('existing '+device+' editor still rehearses',async t=>{
    const m=await editor(t,{seed,device,digital:true});
    assert.equal(m.q('[data-action="coach-film"]'),null);
    m.action('rehearse-mode');
    assert.equal(m.node('[data-action="rehearse-mode"]').getAttribute('aria-pressed'),'true');
  });
});
