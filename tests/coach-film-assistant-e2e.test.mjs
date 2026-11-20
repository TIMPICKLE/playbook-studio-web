import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {starterWorkspace} from '../web/model.js';
import {hasEditableTrace,makeMaddenPlay} from '../web/madden-model.js';
import {editor,actorId} from './helpers/coach-film-editor.mjs';
import {database} from './helpers/db.mjs';
import {handleApi} from '../server/api.mjs';

const read = () => ['read_film',{}];
const control = (operation,args={}) => ['control_film',{command:{operation,...args}}];

// Return actual chat-completion tool calls. Only the external model is replaced:
// the provider loop, result validation, editor, dialog and persistence are real.
function scriptedModel() {
  let active,serial=0;
  const fetch=async (url,options)=>{
    try {
      assert.equal(url,'https://api.openai.com/v1/chat/completions');
      const body=JSON.parse(options.body);
      assert.ok(body.messages.some(message=>message.role==='user' && message.content.includes(active.prompt)));
      for (const message of body.messages.filter(m=>m.role==='tool')) {
        const index=active.ids.indexOf(message.tool_call_id);
        if (index>=0) active.responses[index]=JSON.parse(message.content);
      }
      const index=active.ids.length;
      assert.ok(index<=active.steps.length,'the provider received its terminal answer');
      let name,args;
      if (index===active.steps.length) {
        const message=active.answer(active.responses);
        name='submit_result';args={result:{kind:'answer',message}};active.message=message;
      } else {
        [name,args]=active.steps[index];
      }
      assert.ok(body.tools.some(spec=>spec.function.name===name),'advertised tool '+name);
      const id='film-test-'+(++serial);
      active.ids.push(id);
      return Response.json({choices:[{message:{role:'assistant',content:null,
        tool_calls:[{id,type:'function',function:{name,arguments:JSON.stringify(args)}}]}}]});
    } catch(error) {if(active)active.failure=error;throw error;}
  };
  async function send(f,prompt,steps,answer=()=> 'Film inspection complete.') {
    active={prompt,steps,answer,ids:[],responses:[]};
    const input=f.node('[data-ba-prompt]');
    input.value=prompt;f.emit(input,'input');f.click('[data-ba="send"]');
    const deadline=Date.now()+6500;
    while(Date.now()<deadline&&!active.failure && !(active.message&&!input.readOnly&&f.q('.ba-output')?.textContent.includes(active.message))) {
      await new Promise(resolve=>setTimeout(resolve,8));
    }
    if(active.failure)throw active.failure;
    assert.equal(active.ids.length,steps.length+1,'all intended tools ran: '+f.node('.ba-status').textContent);
    assert.ok(f.node('.ba-output').textContent.includes(active.message),'the host reported the result to the coach: '+f.node('.ba-status').textContent);
    assert.equal(active.responses.length,steps.length,'each command produced a host receipt');
    const responses=active.responses;
    active=null;
    return responses;
  }
  return {fetch,send};
}
function configure(f) {
  f.click('[data-ba="open"]');f.click('[data-ba="settings"]');
  f.node('[data-ba-key]').value='test-provider-key';f.click('[data-ba="done"]');
}
function roomPrompt(f) {
  const panel=f.node('#coach-film-room #film-assistant-panel');
  if (panel.hidden) f.click('#coach-film-room [data-film-assistant-toggle]');
  return panel.querySelector('[data-ba-prompt]');
}
function expectError(receipt,code) {
  assert.ok(receipt.error,JSON.stringify(receipt));
  if(code) assert.equal(receipt.code,code);
}

test('Chinese tool calls teach Mesh across consecutive turns and read the true pinned and current depth',async t=>{
  const seed=starterWorkspace(),play=seed.plays[0];
  const model=scriptedModel(),f=await editor(t,{seed,fetchImpl:model.fetch});
  configure(f);
  const original=f.raw(),prompt=f.node('[data-ba-prompt]');
  const h=actorId(play,'H'),y=actorId(play,'Y');
  const opening=await model.send(f,'打开教练讲解。',[read(),control('open')],()=> '教练讲解已打开。');
  assert.equal(opening[0].open,false);assert.equal(opening[0].roomAvailable,true);
  assert.ok(opening[0].events.some(event=>event.id==='release'&&event.time===2));
  assert.ok(opening[0].players.some(player=>player.id===h));
  assert.ok(opening[1].open);assert.equal(opening[1].available.seek,true);
  const room=f.node('#coach-film-room[open]');
  assert.equal(roomPrompt(f),prompt,'the real composer and conversation survive moving into the dialog');
  const first=await model.send(f,'停到出手，对比 H 与 Y，固定这一帧。',[
    read(),control('event',{event:'release'}),control('focus',{players:[h,y]}),control('pin'),read(),
  ],responses=>{
    const state=responses.at(-1);
    assert.equal(state.time,2);assert.equal(state.pinnedTime,2);
    assert.equal(state.comparison.deeperId,h);assert.equal(state.comparison.gapYards,3);
    return '出手时 H 比 Y 深 '+state.comparison.gapYards.toFixed(1)+' 码。';
  });
  assert.deepEqual(first[2].focusIds,[h,y]);
  assert.match(f.node('[data-film-comparison]').textContent,/H.*Y.*3(?:\.0)?\s*码/);
  assert.equal(f.node('#coach-film-room[open]'),room);
  assert.equal(roomPrompt(f),prompt);
  await model.send(f,'再倒回一秒，跟刚才的定格比较。',[read(),control('seek',{time:1}),read()],responses=>{
    const state=responses.at(-1);
    assert.equal(state.time,1);assert.equal(state.reference.time,2);
    assert.equal(state.comparison.gapYards,1);assert.equal(state.reference.comparison.gapYards,3);
    return '现在 H 深 '+state.comparison.gapYards.toFixed(1)+' 码，出手定格是 '+state.reference.comparison.gapYards.toFixed(1)+' 码。';
  });
  assert.match(f.node('[data-film-comparison]').textContent,/H.*Y.*1(?:\.0)?\s*码/);
  assert.equal(f.raw(),original);
  assert.ok(f.node('[data-action="undo"]').disabled);
});

test('English lesson turns save and reload personal stops through the same host without a playbook write',async t=>{
  const seed=starterWorkspace(),play=seed.plays[0],model=scriptedModel();
  const f=await editor(t,{seed,locale:'en',pilot:'lesson',fetchImpl:model.fetch});
  configure(f);
  const original=f.raw();
  await f.openFilm();roomPrompt(f);
  const question='Which receiver is deeper?',answer='H by three yards.';
  const receipts=await model.send(f,'Draft a personal lesson stop at release.',[
    read(),control('event',{event:'release'}),control('lesson',{action:'add',question,answer}),read(),
  ]);
  for(const receipt of receipts) assert.equal(receipt.error,undefined);
  const key='playbook:coach-lesson:'+JSON.stringify(['local',play.id]);
  assert.equal(f.win.localStorage.getItem(key),null,'a draft stays in the open room until explicitly saved');
  const saved=await model.send(f,'Save this lesson on my device.',[read(),control('lesson',{action:'save'})]);
  assert.equal(saved[1].error,undefined);
  const encoded=f.win.localStorage.getItem(key);
  assert.ok(encoded?.includes(question));assert.ok(encoded.includes(answer));
  assert.equal(f.raw(),original);
  f.closeFilm();await f.openFilm();roomPrompt(f);
  const loaded=await model.send(f,'Load my saved stop, then reveal the answer.',[
    read(),control('lesson',{action:'load'}),control('lesson',{action:'reveal'}),read(),
  ]);
  for(const receipt of loaded) assert.equal(receipt.error,undefined);
  assert.ok(f.node('.film-lesson').textContent.includes(answer));
  assert.equal(f.win.localStorage.getItem(key),encoded);
  assert.equal(f.raw(),original);assert.ok(f.node('[data-action="undo"]').disabled);
});

test('a cloud viewer can teach and save an explicitly requested personal lesson without mutating the team book',async t=>{
  const db=database(t),url='https://playbook.test';
  const owner={userId:'home-coach',displayName:'Head coach',email:'owner@example.test'};
  const viewer={userId:'guest-coach',displayName:'Visiting coach',email:'viewer@example.test'};
  async function route(user,path,options={}) {
    const headers=new Headers(options.headers);
    headers.set('origin',url);
    return handleApi(new Request(url+path,{...options,headers}),{DB:db},user);
  }
  const create=await route(owner,'/api/workspaces',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({title:'Team film',data:starterWorkspace()})});
  assert.equal(create.status,201);
  const book=await create.json();
  assert.equal((await route(viewer,'/api/workspaces')).status,200);
  db.sql.prepare('INSERT INTO members(workspace_id,user_id,role,joined_at) VALUES(?,?,?,?)').run(book.id,viewer.userId,'viewer',Date.now());
  const stored=()=>db.sql.prepare('SELECT data_json,revision FROM workspaces WHERE id=?').get(book.id);
  const teamBefore=stored(),calls=[];
  const cloud={fetch:async(path,options)=>{calls.push([path,options?.method||'GET']);return route(viewer,path,options);}};
  const model=scriptedModel(),f=await editor(t,{cloud,fetchImpl:model.fetch});
  await f.waitFor('[data-cloud-action="enter-editor"]');f.click('[data-cloud-action="enter-editor"]');
  await f.waitFor('[data-action="coach-film"]');
  assert.ok(f.node('[data-prop="title"]').disabled);
  const localBefore=f.raw();
  configure(f);
  await f.openFilm();roomPrompt(f);
  const question='谁在出手时跑得更深？';
  const receipts=await model.send(f,'请为我个人保存一个出手停点。',[
    read(),control('event',{event:'release'}),control('lesson',{action:'add',question,answer:'H'}),control('lesson',{action:'save'}),
  ],responses=>{
    for(const receipt of responses) assert.equal(receipt.error,undefined);
    return '已保存到本机。';
  });
  assert.equal(receipts[1].time,2);
  const key='playbook:coach-lesson:'+JSON.stringify([book.id,book.data.plays[0].id]);
  assert.ok(f.win.localStorage.getItem(key)?.includes(question));
  assert.deepEqual(stored(),teamBefore);assert.equal(f.raw(),localBefore);
  assert.ok(f.node('[data-action="undo"]').disabled);
  const mutationRequests=calls.filter(([,method])=>method!=='GET');
  assert.ok(mutationRequests.length>1,'the real worker relayed the model to the device for its receipts');
  assert.ok(mutationRequests.every(([path,method])=>path==='/api/workspaces/'+book.id+'/board-assistant'&&method==='POST'));
});

test('film commands give specific errors for ambiguous players, missing passes, and reference diagrams',async t=>{
  const catalog=JSON.parse(readFileSync(new URL('../web/data/huddle-catalog.json',import.meta.url)));
  for (const kind of ['ambiguous','no-pass','reference']) await t.test(kind,async t=>{
    const seed=starterWorkspace(),model=scriptedModel();
    if(kind==='no-pass')seed.plays=[seed.plays.find(play=>play.title.startsWith('Inside Zone'))];
    if(kind==='reference')seed.plays=[makeMaddenPlay(catalog.plays.find(entry=>!hasEditableTrace(entry.id)))];
    if(kind==='ambiguous')seed.plays[0].players.find(p=>p.label==='Y').label='H';
    const f=await editor(t,{seed,fetchImpl:model.fetch});configure(f);
    const original=f.raw();
    await f.openFilm();roomPrompt(f);
    const ambiguous=kind==='ambiguous';
    const receipts=await model.send(f,ambiguous?'聚焦 H。':'定位出手时刻。',[
      read(),ambiguous?control('focus',{players:['H']}):control('event',{event:'release'}),read(),
    ],()=>ambiguous?'有两个 H，请指定具体球员。':'这套战术无法定位传球出手。');
    expectError(receipts[1],ambiguous?'PLAYER_AMBIGUOUS':kind==='no-pass'?'EVENT_UNAVAILABLE':'REFERENCE_ONLY');
    assert.deepEqual(receipts[2].focusIds,[]);
    assert.equal(receipts[2].time,0);
    assert.equal(f.raw(),original);
  });
});

test('device and trial gates also apply to AI; the event-only arm can still seek its own timeline',async t=>{
  for(const gate of ['iphone','ipad','baseline','events']) await t.test(gate,async t=>{
    const model=scriptedModel();
    const mobile=gate==='iphone'||gate==='ipad';
    const f=await editor(t,{device:mobile?gate:'desktop',pilot:mobile?undefined:gate,fetchImpl:model.fetch});
    configure(f);
    assert.equal(f.q('[data-action="coach-film"]'),null);
    const original=f.raw();
    const unavailable=await model.send(f,'请打开完整教练讲解。',[read(),control('open')],()=> '当前界面没有完整讲解房间。');
    assert.equal(unavailable[0].open,false);assert.equal(unavailable[0].roomAvailable,false);
    assert.ok(!unavailable[0].operations.includes('open'));
    assert.equal(unavailable[0].operations.includes('event'),gate==='events');
    expectError(unavailable[1],'FILM_UNAVAILABLE');
    assert.equal(f.q('#coach-film-room[open]'),null);
    if (gate==='events') {
      const moved=await model.send(f,'使用这个常规板上的事件控件定位出手。',[read(),control('event',{event:'release'}),read()]);
      assert.equal(moved[1].error,undefined);
      assert.equal(Number(f.node('#timeline').value),2);
      assert.equal(f.q('#coach-film-room[open]'),null);
    }
    assert.equal(f.raw(),original);
  });
});
