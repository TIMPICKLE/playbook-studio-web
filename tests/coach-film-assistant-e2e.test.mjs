import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {starterWorkspace} from '../web/model.js';
import {createFilmModel} from '../web/coach-film-model.js';
import {createFilmLesson} from '../web/coach-film-lesson.js';
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
        const answer=active.answer(active.responses);
        const result=typeof answer==='string'?{kind:'answer',message:answer}:answer;
        name='submit_result';args={result};active.result=result;
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
  async function send(f,prompt,steps,answer=()=> 'Film inspection complete.',expectedFailure) {
    active={prompt,steps,answer,ids:[],responses:[]};
    const input=f.node('[data-ba-prompt]');
    input.value=prompt;f.emit(input,'input');f.click('[data-ba="send"]');
    const deadline=Date.now()+6500;
    while(Date.now()<deadline&&!active.failure && (f.node('[data-ba-prompt]').readOnly || (expectedFailure ? f.q('.ba-run-state')?.dataset.state!=='failed' : !active.result))) {
      await new Promise(resolve=>setTimeout(resolve,8));
    }
    if(active.failure)throw active.failure;
    const status=f.node('.ba-status').textContent,output=f.node('.ba-output').textContent;
    const shared=f.q('.ba-panel[data-ba-shared-lesson]');
    if(expectedFailure) {
      assert.equal(f.node('.ba-run-state').dataset.state,'failed');
      assert.equal(active.ids.length,steps.length+(active.result?.kind==='editor'?1:0),'the host rejected the failing command');
      if (!shared) {assert.match(status,expectedFailure);assert.match(output,expectedFailure);}
    } else {
      assert.equal(active.ids.length,steps.length+1,'all intended tools ran: '+status);
      if(shared) {
        assert.equal(f.node('.ba-run-state').dataset.state,'complete');
        assert.ok(status || output,'the audience gets a receipt');
        if(active.result.message) assert.ok(!status.includes(active.result.message) && !output.includes(active.result.message));
      } else if(active.result.kind==='edit') assert.ok(f.node('[data-ba="apply"]'));
      else if(active.result.kind==='editor') assert.ok(f.node('[data-ba="continue"]'));
      else assert.ok(output.includes(active.result.message),'the host reported the result to the coach: '+status);
      assert.equal(active.responses.length,steps.length,'each command produced a host receipt');
    }
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
  const opening=await model.send(f,'先检查课件，再打开教练讲解。',[read(),control('lesson',{action:'state'}),control('open'),control('lesson',{action:'state'})],()=> '教练讲解已打开。');
  assert.equal(opening[0].open,false);assert.equal(opening[0].roomAvailable,true);
  assert.ok(opening[0].events.some(event=>event.id==='release'&&event.time===2));
  assert.ok(opening[0].players.some(player=>player.id===h));
  assert.deepEqual(opening[1],opening[0],'a lesson-state query keeps the closed room closed');
  assert.ok(opening[2].open);assert.equal(opening[2].available.seek,true);
  assert.equal(opening[3].open,true);
  for(const state of opening) {
    assert.equal(state.available.lesson,true);assert.equal(state.lessonOnRequest,true);
    assert.equal(state.lesson,null,'an available on-demand lesson stays unmounted during inspection');
  }
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
  assert.equal(first[0].lesson,null);assert.equal(first[0].available.lesson,true);
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
  assert.equal(receipts[0].available.lesson,true);assert.equal(receipts[0].lesson.available,true);
  assert.equal(receipts[2].available.lesson,true);assert.equal(receipts[2].lesson.open,true);
  const key='playbook:coach-lesson:'+JSON.stringify(['local',play.id]);
  assert.equal(f.win.localStorage.getItem(key),null,'a draft stays in the open room until explicitly saved');
  const saved=await model.send(f,'Review the authored teacher answer privately and save this lesson on my device.',[
    read(),control('lesson',{action:'state',includeAnswers:true}),control('lesson',{action:'save'}),
  ]);
  assert.equal(saved[0].lesson.stops[0].answer,undefined,'the ordinary model read keeps the answer hidden');
  assert.equal(saved[1].lesson.stops[0].answer,answer,'the explicit teacher read can inspect an answer behind the question');
  assert.equal(saved[1].lesson.revealed,false,'private review does not reveal the answer on the field');
  assert.equal(saved[2].error,undefined);
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
    if(kind==='reference') {
      assert.equal(receipts[0].available.lesson,false);assert.equal(receipts[0].lessonOnRequest,false);
      const inspected=await model.send(f,'检查原图的课件。',[read(),control('lesson',{action:'state'})]);
      expectError(inspected[1],'REFERENCE_ONLY');
    }
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
    const unavailable=await model.send(f,'检查课件并打开完整教练讲解。',[read(),control('lesson',{action:'state'}),control('open')],()=> '当前界面没有完整讲解房间。');
    assert.equal(unavailable[0].open,false);assert.equal(unavailable[0].roomAvailable,false);
    assert.equal(unavailable[0].available.lesson,false);assert.equal(unavailable[0].lessonOnRequest,false);
    assert.ok(!unavailable[0].operations.includes('open'));
    assert.equal(unavailable[0].operations.includes('event'),gate==='events');
    expectError(unavailable[1],'FILM_UNAVAILABLE');expectError(unavailable[2],'FILM_UNAVAILABLE');
    assert.equal(f.q('#coach-film-room[open]'),null);
    if (gate==='events') {
      const moved=await model.send(f,'使用这个常规板上的事件控件定位出手。',[read(),control('event',{event:'release'}),read()]);
      assert.equal(moved[1].error,undefined);
      assert.equal(Number(f.node('#timeline').value),2);
      assert.equal(f.q('#coach-film-room[open]'),null);
      const [playing,live,menu,paused,stoppedMenu]=await model.send(f,'开始播放，检查可以暂停，然后暂停。',[
        control('play'),read(),['list_capabilities',{category:'film'}],control('pause'),['list_capabilities',{category:'film'}],
      ]);
      for(const state of [playing,live]) {
        assert.equal(state.playing,true);assert.equal(state.available.play,false);assert.equal(state.available.pause,true);
      }
      assert.equal(menu.capabilities.find(item=>item.id==='film_pause').available,true);
      assert.equal(paused.playing,false);assert.equal(paused.available.play,true);assert.equal(paused.available.pause,false);
      assert.equal(stoppedMenu.capabilities.find(item=>item.id==='film_pause').available,false);
    }
    assert.equal(f.raw(),original);
  });
});

test('staged reads use the proposal timeline and require the coach to choose before changing the projected field',async t=>{
  const model=scriptedModel(),f=await editor(t,{fetchImpl:model.fetch,reduced:true});configure(f);
  const original=f.raw(),operations=[{kind:'ball_update',patch:{passAt:1.4}}];
  await model.send(f,'先预览提前到 1.4 秒的出手。',[['read_board',{}],['preview_edit',{operations}]],()=>({kind:'edit',operations}));
  const receipts=await model.send(f,'这个待确认版本什么时候出手？',[
    ['read_board',{}],read(),control('capabilities'),['list_capabilities',{category:'film'}],
  ]);
  const [board,film,catalog,menu]=receipts;
  assert.equal(board.source,'staged');assert.equal(board.ball.passAt,1.4);
  assert.equal(film.source,'staged');assert.equal(film.events.find(e=>e.id==='release').time,1.4);
  assert.equal(film.open,false);assert.equal(film.projectedSource,null);
  assert.match(film.notice,/应用.*放弃/);
  assert.deepEqual(film.operations,['state','capabilities']);
  assert.equal(film.available.event,false);assert.equal(film.available.open,false);
  assert.deepEqual(catalog.commands.map(rule=>rule.properties.operation.const).sort(),[...film.operations].sort());
  assert.equal(menu.capabilities.length,19);
  assert.deepEqual(menu.capabilities.filter(item=>item.available).map(item=>item.id).sort(),['film_capabilities','film_state']);
  const noPlayback=/应用.*放弃/;
  await model.send(f,'在这个版本的出手时刻停下。',[control('event',{event:'release'})],()=> '已经停在出手。',noPlayback);
  for (const action of [{kind:'dialog_open',dialog:'coach_film'},{kind:'playback_set',playing:true}]) {
    const actions=[action];
    const [editorState]=await model.send(f,'打开待确认战术的演练。',[['read_editor',{}],['preview_actions',{actions}]],()=>({kind:'editor',actions}),noPlayback);
    assert.equal(editorState.capabilities.find(item=>item.id==='playback_set').available,false);
    assert.equal(editorState.view.playback.source,'committed');
    assert.equal(f.q('[data-ba="continue"]'),null);
  }
  assert.equal(f.q('#coach-film-room[open]'),null);assert.equal(f.raw(),original);
  await f.openFilm();roomPrompt(f);
  const [inRoom]=await model.send(f,'在已打开的球场再读同一份预览。',[read()]);
  assert.equal(inRoom.source,'staged');assert.equal(inRoom.projectedSource,'committed');assert.equal(inRoom.open,false);
  await model.send(f,'现在把画面跳到草稿的出手时刻。',[control('event',{event:'release'})],()=> '已跳转。',noPlayback);
  assert.equal(Number(f.node('[data-film-clock]').dataset.seconds),0);
  f.closeFilm();
  f.click('[data-ba="apply"]');await f.waitFor('.ba-turn-status[data-status="applied"]');
  const [committed,screen]=await model.send(f,'已经应用了，现在讲解出手。',[
    ['read_board',{}],control('event',{event:'release'}),
  ]);
  assert.equal(committed.source,'committed');assert.equal(screen.source,'committed');
  assert.equal(screen.time,1.4);assert.equal(Number(f.node('[data-film-clock]').dataset.seconds),1.4);
  f.closeFilm();f.action('undo');
  const [afterUndo]=await model.send(f,'撤销后再读一次。',[read()]);
  assert.equal(afterUndo.source,'committed');assert.equal(afterUndo.events.find(e=>e.id==='release').time,2);
});

test('a deferred film dialog checks its board again when the coach clicks Continue',async t=>{
  const model=scriptedModel(),f=await editor(t,{fetchImpl:model.fetch});configure(f);
  const actions=[{kind:'dialog_open',dialog:'coach_film'}],steps=[['read_editor',{}],['preview_actions',{actions}]];
  const prepare=()=>model.send(f,'准备打开讲解台。',steps,()=>({kind:'editor',actions}));
  await prepare();
  f.change('[data-prop="title"]','Changed after the dialog was prepared');
  f.click('[data-ba="continue"]');await f.waitFor('.ba-status.ba-error');
  assert.match(f.node('.ba-status').textContent,/战术已变更/);assert.equal(f.q('#coach-film-room[open]'),null);
  await prepare();
  f.click('[data-ba="continue"]');await f.waitFor('#coach-film-room[open]');
  assert.ok(f.node('#coach-film-room').textContent.includes('Changed after the dialog was prepared'));
});

test('a real competing lesson save ends the assistant turn with the storage receipt and keeps both drafts intact',async t=>{
  const seed=starterWorkspace(),model=scriptedModel(),f=await editor(t,{seed,pilot:'lesson',fetchImpl:model.fetch});
  configure(f);await f.openFilm();roomPrompt(f);
  await model.send(f,'记录问题。',[control('lesson',{action:'add',question:'本窗口未保存的问题'}),control('lesson',{action:'close'})]);
  const otherHost=f.doc.createElement('header');f.doc.body.append(otherHost);
  const peer=createFilmLesson({workspaceId:'local'}).mount({host:otherHost,model:createFilmModel(seed.plays[0]),read:()=>({time:1,focusIds:[]}),go(){}});
  await peer.execute({kind:'lesson_add',question:'另一窗口的问题'});await peer.execute({kind:'lesson_save'});peer.dispose();
  const key='playbook:coach-lesson:'+JSON.stringify(['local',seed.plays[0].id]),saved=f.win.localStorage.getItem(key);
  await model.send(f,'保存本机课件。',[control('lesson',{action:'save'})],()=> '成功保存。',/另一窗口/);
  assert.equal(f.win.localStorage.getItem(key),saved);assert.equal(JSON.parse(saved).stops[0].question,'另一窗口的问题');
  assert.ok(f.q('.ba-turn-status[data-status="failed"]'));assert.ok(!f.node('.ba-status').textContent.includes('成功保存'));
  const [remaining]=await model.send(f,'检查保留的草稿。',[read()]);
  assert.equal(remaining.lesson.dirty,true);assert.deepEqual(remaining.lesson.stops.map(s=>s.question),['本窗口未保存的问题']);
});

test('the ordinary editor assistant can execute every advertised film command and lesson action',async t=>{
  const seed=starterWorkspace(),model=scriptedModel(),f=await editor(t,{seed,fetchImpl:model.fetch});configure(f);
  const original=f.raw(),operations=new Set(),lessonActions=new Set();
  const lesson=(action,params={})=>control('lesson',{action,...params});
  async function run(prompt,steps) {
    const receipts=await model.send(f,prompt,steps);
    steps.forEach(([name,args],index)=>{
      if(name!=='control_film')return;
      assert.equal(receipts[index].error,undefined,JSON.stringify(receipts[index]));
      operations.add(args.command.operation);
      if(args.command.operation==='lesson')lessonActions.add(args.command.action);
    });
    return receipts;
  }
  const [catalog]=await run('列出教练讲解操作并打开。',[control('capabilities'),control('open'),control('state')]);
  await run('选择两名接球员并更换第二人。',[
    control('focus',{players:['H','Y']}),control('replaceFocus',{replace:'Y',player:'Z'}),
    control('removeFocus',{player:'Z'}),control('addFocus',{player:'Y'}),
  ]);
  f.click('[data-film-pick="'+actorId(seed.plays[0],'Z')+'"]');
  await run('取消更换，清空选择再演练。',[
    control('cancelReplacement'),control('clearFocus'),control('speed',{speed:1.5}),control('theme',{theme:'light'}),
    control('event',{event:'release'}),control('pin'),control('seek',{time:1}),control('unpin'),control('play'),control('pause'),
  ]);
  await run('准备两个提问停点。',[
    lesson('open'),lesson('state'),lesson('add',{question:'Q1',time:.5}),lesson('add',{question:'Q2',answer:'A2',time:2}),
    lesson('update',{index:0,question:'Q1 updated'}),lesson('replace',{index:1,time:2.35}),
  ]);
  await run('在停点间切换和揭晓。',[
    lesson('select',{index:1}),lesson('previous'),lesson('next'),lesson('revisit',{index:1}),lesson('reveal'),lesson('hide'),
  ]);
  f.click('[data-lesson-action="edit"]');
  const finished=await run('取消编辑后保存，再载入并退出。',[
    lesson('cancel'),lesson('remove',{index:0}),lesson('save'),lesson('close'),lesson('load'),control('close'),
  ]);
  assert.equal(finished.at(-2).lesson.stops[0].time,2.35);assert.equal(finished.at(-1).open,false);
  const lessonSchema=catalog.commands.find(rule=>rule.properties.operation.const==='lesson');
  assert.equal(operations.size,19);assert.equal(lessonActions.size,16);
  assert.deepEqual(operations,new Set(catalog.commands.map(rule=>rule.properties.operation.const)));
  assert.deepEqual(lessonActions,new Set(lessonSchema.oneOf.map(rule=>rule.properties.action.const)));
  assert.equal(f.raw(),original);
});
