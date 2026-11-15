import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Window } from 'happy-dom';
import { STORAGE_KEY, decodeWorkspace, encodeWorkspace, starterWorkspace } from '../web/model.js';

test('AI adds 4-3 on offensive Mesh through read, preview, apply and undo without a catalog or manual setup', {timeout:30000}, async () => {
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
    assert.ok(predicate(),'expected AI editor state: '+(q('.ba-output')?.textContent||q('.ba-status')?.textContent||''));
  };
  let mode='add',existing=0,rejected=false;
  const toolsUsed=[];
  globalThis.fetch=async(url,init)=>{
    assert.equal(url,'https://api.openai.com/v1/chat/completions','local defense never searches an external catalog');
    const body=JSON.parse(init.body),outputs=body.messages.filter(message=>message.role==='tool');
    const operations=[{kind:'defense_formation',formation:'4-3',mode}];
    const turn=outputs.length;
    let name,args;
    if(turn===0){name='read_board';args={};}
    else if(turn===1){
      const board=JSON.parse(outputs[0].content);
      assert.match(board.title,/Mesh/);
      assert.equal(board.book,'offense');
      assert.equal(board.formation,'Gun Trips');
      assert.equal(board.players.filter(player=>player.side==='defense').length,existing);
      assert.deepEqual(board.capabilities.defenseFormations,['4-3']);
      name='preview_edit';args={operations};
    }else{
      assert.equal(turn,2);
      const evidence=JSON.parse(outputs[1].content);
      if(rejected){
        assert.match(evidence.error,/defen|防守/i);
        name='submit_result';args={result:{kind:'clarify',message:'已有防守阵容，请明确要求重设 4-3。'}};
      }else{
        assert.equal(evidence.error,undefined);
        assert.equal(evidence.playerIds.length,11);
        if(mode==='reset')assert.equal(evidence.removed.players.length,11);
        name='submit_result';args={result:{kind:'edit',summary:'添加 4-3 防守阵容',operations}};
      }
    }
    toolsUsed.push(name);
    return Response.json({choices:[{message:{role:'assistant',content:null,tool_calls:[{
      id:'defense-'+turn,type:'function',function:{name,arguments:JSON.stringify(args)}
    }]}}]});
  };
  const send=async(operation='add',defenseCount=0,reject=false)=>{
    mode=operation;existing=defenseCount;rejected=reject;toolsUsed.length=0;
    const input=q('[data-ba-prompt]');input.value=operation==='reset'?'重设为 4-3 防守':'添加 4-3 防守';
    input.dispatchEvent(new win.Event('input',{bubbles:true}));ba('send').click();
    await until(()=>reject?toolsUsed.length===3&&!!q('.ba-output')?.textContent.includes('已有防守阵容'):!!q('.assistant-preview')&&!!ba('apply'));
    assert.deepEqual(toolsUsed,['read_board','preview_edit','submit_result']);
  };
  const apply=async()=>{ba('apply').click();await until(()=>!!ba('undo'));};
  try{
    await import(`../web/app.js?defense-regression=${Date.now()}`);
    q('[data-cloud-action="enter-editor"]').click();
    const original=saved(),selected=original.plays.find(play=>q('h1').textContent.includes(play.title));
    assert.ok(selected);assert.equal(selected.players.length,11);assert.ok(!selected.players.some(player=>player.side==='defense'));
    ba('open').click();ba('settings').click();q('[data-ba-key]').value='test-provider-key';ba('done').click();

    await send();
    const firstIds=[...q('.assistant-preview').querySelectorAll('[data-player]')].map(node=>node.dataset.player);
    assert.equal(firstIds.length,11,'the preview visibly creates all defenders');
    assert.ok(firstIds.every(id=>!selected.players.some(player=>player.id===id)));
    assert.deepEqual(saved(),original,'a preview must not change workspace persistence');
    assert.equal(q('#field .pitch-stage > .pitch-svg').querySelectorAll('[data-player]').length,11);
    ba('discard').click();assert.equal(q('.assistant-preview'),null);assert.deepEqual(saved(),original);

    await send();
    assert.deepEqual([...q('.assistant-preview').querySelectorAll('[data-player]')].map(node=>node.dataset.player),firstIds);
    await apply();
    const added=saved(),mixed=added.plays.find(play=>play.id===selected.id);
    assert.equal(mixed.players.filter(player=>player.side==='defense').length,11);
    assert.deepEqual(mixed.players.filter(player=>player.side==='offense'),selected.players);
    assert.deepEqual(mixed.routes,selected.routes);assert.deepEqual(mixed.ball,selected.ball);
    assert.equal(mixed.book,'offense');assert.equal(mixed.formation,'Gun Trips');
    assert.equal(added.plays.length,original.plays.length);
    assert.deepEqual(added.plays.filter(play=>play.id!==selected.id),original.plays.filter(play=>play.id!==selected.id));
    assert.deepEqual(added.settings,original.settings);assert.deepEqual(added.roster,original.roster);
    assert.match(q('h1').textContent,/Mesh/);

    await send('add',11,true);
    assert.deepEqual(saved(),added,'repeated add cannot duplicate or reset existing defenders');
    assert.equal(ba('apply'),null);
    const oldIds=mixed.players.filter(player=>player.side==='defense').map(player=>player.id);
    await send('reset',11);
    const replacementIds=[...q('.assistant-preview').querySelectorAll('[data-player]:not([data-removing])')].map(node=>node.dataset.player);
    assert.equal(replacementIds.length,11);
    assert.ok(replacementIds.every(id=>!oldIds.includes(id)));
    for(const id of oldIds)assert.equal(q(`#field .pitch-stage > .pitch-svg [data-player="${id}"]`).style.opacity,'0','removed defenders are masked during replacement preview');
    assert.deepEqual(saved(),added);
    await apply();
    const resetPlay=saved().plays.find(play=>play.id===selected.id);
    assert.equal(resetPlay.players.filter(player=>player.side==='defense').length,11);
    assert.deepEqual(resetPlay.players.filter(player=>player.side==='offense'),selected.players);
    ba('undo').click();assert.deepEqual(saved(),added,'assistant undo restores the exact previous defense');
    q('[data-action="undo"]').click();assert.deepEqual(saved(),original,'the original add is one undo checkpoint');
  }finally{
    ba('close')?.click();globalThis.fetch=originalFetch;
    await win.happyDOM.abort();
    for(const name of names){if(previous[name])Object.defineProperty(globalThis,name,previous[name]);else delete globalThis[name];}
  }
});
