import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Window } from 'happy-dom';
import { STORAGE_KEY, decodeWorkspace, encodeWorkspace, starterWorkspace } from '../web/model.js';

// Reproduces the reported conversation in the real editor host: three turns sent
// back to back without pressing Apply in between.
test('consecutive turns build on the staged preview and commit as one undoable transaction', {timeout:30000}, async () => {
  const win=new Window({url:'http://localhost:3000/',width:1440,height:1000});
  win.document.body.innerHTML=readFileSync(new URL('../web/index.html',import.meta.url),'utf8').split('<body>')[1].split('</body>')[0];
  const names=['window','document','navigator','localStorage','location','history','Image','Blob','requestAnimationFrame','cancelAnimationFrame'];
  const previous=Object.fromEntries(names.map(name=>[name,Object.getOwnPropertyDescriptor(globalThis,name)]));
  const originalFetch=globalThis.fetch;
  win.localStorage.setItem(STORAGE_KEY,encodeWorkspace(starterWorkspace()));
  for(const name of names)Object.defineProperty(globalThis,name,{configurable:true,value:typeof win[name]==='function'&&['requestAnimationFrame','cancelAnimationFrame'].includes(name)?win[name].bind(win):win[name]});
  const q=selector=>win.document.querySelector(selector),ba=action=>q(`[data-ba="${action}"]`);
  const saved=()=>decodeWorkspace(win.localStorage.getItem(STORAGE_KEY));
  const until=async predicate=>{
    const deadline=Date.now()+5000;
    while(!predicate()&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,10));
    assert.ok(predicate(),'expected AI editor state: '+(q('.ba-output')?.textContent||'')+' / '+(q('.ba-status')?.textContent||''));
  };
  // Each scripted turn decides its operations from the board the model was shown.
  let script, seen, lookup;
  globalThis.fetch=async(_url,init)=>{
    const body=JSON.parse(init.body),outputs=body.messages.filter(message=>message.role==='tool');
    const step=outputs.length-(lookup&&outputs.length>1?1:0);
    let name,args;
    if(!outputs.length){seen={context:JSON.parse(body.messages[1].content)};name='read_board';args={};}
    else if(lookup&&outputs.length===1){seen.board=JSON.parse(outputs[0].content);name='resolve_player';args={role:lookup};}
    else if(step===1){seen.board||=JSON.parse(outputs[0].content);seen.operations=script(seen);name='preview_edit';args={operations:seen.operations};}
    else{seen.preview=JSON.parse(outputs.at(-1).content);name='submit_result';args={result:{kind:'edit',summary:'已预览',operations:seen.operations}};}
    return Response.json({choices:[{message:{role:'assistant',content:null,tool_calls:[{id:'turn-'+outputs.length,type:'function',function:{name,arguments:JSON.stringify(args)}}]}}]});
  };
  const send=async(text,operations,role)=>{
    script=operations;seen=null;lookup=role;
    const done=q('.ba-trace-list').children.length;
    const input=q('[data-ba-prompt]');input.value=text;input.dispatchEvent(new win.Event('input',{bubbles:true}));ba('send').click();
    await until(()=>!q('[data-ba-prompt]').readOnly&&q('.ba-trace-list').children.length>done&&!!ba('apply')&&!ba('apply').disabled);
    assert.equal(seen.preview?.error,undefined,q('.ba-status').textContent);
    return seen;
  };
  const changes=()=>[...q('.ba-output ul').children].map(node=>node.textContent);
  try{
    await import(`../web/app.js?continuity=${Date.now()}`);
    q('[data-cloud-action="enter-editor"]').click();
    const original=saved(),selected=original.plays.find(play=>q('h1').textContent.includes(play.title));
    const x=selected.players.find(player=>player.label==='X');
    assert.ok(x);assert.ok(!selected.players.some(player=>player.side==='defense'));
    ba('open').click();ba('settings').click();q('[data-ba-key]').value='test-provider-key';ba('done').click();
    assert.equal(q('.board-ai').parentElement,q('.inspector-panel'),'the desktop assistant docks beside the board');
    assert.ok(q('.board-ai').classList.contains('ba-task-panel'));

    const first=await send('添加 4-3 防守',()=>[{kind:'defense_formation',formation:'4-3',mode:'add'}]);
    assert.equal(first.board.players.filter(player=>player.side==='defense').length,0);
    assert.equal(first.context.staged,undefined);

    const second=await send('X 改成 5 码 slant',()=>[{kind:'route',playerId:x.id,concept:'slant',depthYards:5}],'X');
    assert.equal(second.board.players.filter(player=>player.side==='defense').length,11,'the next turn reads the pending defense');
    assert.equal(second.context.staged,1);assert.equal(second.context.previous.at(-1).status,'pending');
    assert.equal(changes().length,2,'both turns stay listed for one confirmation');
    assert.ok(q('.assistant-preview').querySelectorAll('[data-player]').length>=11,'the preview still shows the first turn');
    assert.deepEqual(saved(),original,'nothing is committed while turns are staged');

    // Visiting another module removes the editor DOM, not its conversation or
    // working draft. Reopening the assistant must require preview confirmation.
    q('[data-ba-prompt]').value='unsent follow-up';
    q('.workspace-nav button[data-workspace-mode="roster"]').click();
    await until(()=>q('#app').hidden&&win.document.body.dataset.workspaceMode==='roster');
    q('.workspace-nav button[data-workspace-mode="editor"]').click();
    await until(()=>!q('#app').hidden&&!!ba('open'));
    ba('open').click();
    assert.equal(q('[data-ba-prompt]').value,'unsent follow-up');
    assert.equal([...win.document.querySelectorAll('.ba-turn-status')].filter(node=>node.dataset.status==='pending').length,2);
    assert.ok(ba('apply'));assert.deepEqual(saved(),original);

    // No subject and no lookup: the focus of the previous turn is already grounded.
    const third=await send('再深两码',({board,context})=>{
      const route=board.routes.find(item=>item.playerId===x.id&&item.intent);
      assert.equal(route.intent.concept,'slant','the follow-up sees the pending route, not the committed one');
      assert.deepEqual(context.focus.players.map(player=>player.id),[x.id]);
      return [{kind:'route',playerId:context.focus.players[0].id,routeId:route.id,concept:'slant',depthYards:7}];
    });
    assert.equal(third.preview.effects[0].endDepthYards,7);assert.equal(changes().length,3);
    assert.deepEqual(saved(),original);

    // The third group deepens the route created by group two. Removing its
    // dependency must fail without changing either the document or its preview.
    let group=q('[data-ba-group="1"]');group.checked=false;group.dispatchEvent(new win.Event('change',{bubbles:true}));
    ba('update-groups').click();await until(()=>!!q('.ba-group-error')?.textContent);
    assert.match(q('.ba-group-error').textContent,/依赖/);assert.equal(changes().length,3);assert.deepEqual(saved(),original);
    group=q('[data-ba-group="1"]');group.checked=true;group.dispatchEvent(new win.Event('change',{bubbles:true}));

    ba('revert').click();
    assert.equal(changes().length,2,'dropping the newest turn keeps the earlier ones');
    ba('revert').click();
    assert.equal(changes().length,1);assert.ok(!ba('revert'),'the first turn is dropped with Discard, not reverted');
    await send('X 改成 5 码 slant',()=>[{kind:'route',playerId:x.id,concept:'slant',depthYards:5}],'X');
    await send('再深两码',({board})=>[{kind:'route',playerId:x.id,routeId:board.routes.find(item=>item.playerId===x.id&&item.intent).id,concept:'slant',depthYards:7}]);

    // Keep only the first two turns, explicitly re-preview them, then apply.
    group=q('[data-ba-group="2"]');group.checked=false;group.dispatchEvent(new win.Event('change',{bubbles:true}));
    assert.equal(ba('apply').disabled,true);ba('update-groups').click();
    await until(()=>changes().length===2&&!ba('apply').disabled);
    assert.deepEqual(saved(),original,'choosing groups only refreshes the preview');

    ba('apply').click();await until(()=>!!ba('undo'));
    const play=saved().plays.find(item=>item.id===selected.id);
    assert.equal(play.players.filter(player=>player.side==='defense').length,11);
    const route=play.routes.find(item=>item.playerId===x.id&&item.intent);
    assert.equal(route.intent.concept,'slant');assert.equal(route.intent.depthYards,5,'the excluded depth change is never committed');
    assert.deepEqual(play.players.filter(player=>player.side==='offense'),selected.players);
    assert.ok(!ba('apply'),'nothing is left pending');
    ba('undo').click();
    assert.deepEqual(saved(),original,'the whole conversation is one undo checkpoint');
    assert.ok([...win.document.querySelectorAll('.ba-turn-status')].some(node=>node.dataset.status==='undone'));
    q('[data-action="redo"]').click();
    assert.equal(saved().plays.find(item=>item.id===selected.id).players.filter(player=>player.side==='defense').length,11);
    assert.ok([...win.document.querySelectorAll('.ba-turn-status')].some(node=>node.dataset.status==='redone'));
    q('[data-action="undo"]').click(); assert.deepEqual(saved(),original);
  }finally{
    ba('close')?.click();globalThis.fetch=originalFetch;
    await win.happyDOM.abort();
    for(const name of names){if(previous[name])Object.defineProperty(globalThis,name,previous[name]);else delete globalThis[name];}
  }
});
