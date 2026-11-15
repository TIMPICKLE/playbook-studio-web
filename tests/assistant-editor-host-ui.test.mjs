import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Window } from 'happy-dom';
import { STORAGE_KEY, decodeWorkspace, encodeWorkspace, starterWorkspace } from '../web/model.js';

test('AI editor actions use the real host for workspace transactions, local controls and browser handoffs', {timeout:30000}, async t => {
  const win = new Window({url:'http://localhost:3000/',width:1440,height:1000});
  win.document.body.innerHTML = readFileSync(new URL('../web/index.html',import.meta.url),'utf8').split('<body>')[1].split('</body>')[0];
  const names = ['window','document','navigator','localStorage','location','history','Image','Blob','requestAnimationFrame','cancelAnimationFrame'];
  const descriptors = Object.fromEntries(names.map(name=>[name,Object.getOwnPropertyDescriptor(globalThis,name)]));
  const originalFetch = globalThis.fetch;
  win.localStorage.setItem(STORAGE_KEY,encodeWorkspace(starterWorkspace()));
  for (const name of names) Object.defineProperty(globalThis,name,{configurable:true,value:typeof win[name]==='function'&&['requestAnimationFrame','cancelAnimationFrame'].includes(name)?win[name].bind(win):win[name]});
  const q = selector => win.document.querySelector(selector), ba = action => q(`[data-ba="${action}"]`);
  const saved = () => decodeWorkspace(win.localStorage.getItem(STORAGE_KEY));
  const until = async predicate => {
    const deadline = Date.now()+5000;
    while (!predicate() && Date.now()<deadline) await new Promise(resolve=>setTimeout(resolve,10));
    assert.ok(predicate(),'expected AI host result: '+(q('.ba-output')?.textContent||q('.ba-status')?.textContent||''));
  };
  let scenario;
  globalThis.fetch = async (url,options) => {
    assert.equal(url,'https://api.openai.com/v1/chat/completions');
    const body = JSON.parse(options.body), outputs = body.messages.filter(message=>message.role==='tool');
    let name, args;
    if (!outputs.length) {name='read_editor';args={};}
    else if (outputs.length===1) {
      scenario.editor = JSON.parse(outputs[0].content);
      assert.ok(scenario.editor.selectedPlayId);
      assert.ok(scenario.editor.capabilities.some(command=>command.id==='play_create'&&command.available));
      if (scenario.inspect) {name='submit_result';args={result:{kind:'clarify',message:'已检查编辑器状态。'}};}
      else {
        scenario.actions = typeof scenario.requested==='function' ? scenario.requested(scenario.editor) : scenario.requested;
        name='preview_actions';args={actions:scenario.actions};
      }
    } else {
      assert.equal(outputs.length,2,'workspace/local actions finish after the measured action preview');
      scenario.preview = JSON.parse(outputs[1].content);
      assert.equal(scenario.preview.error,undefined);
      assert.equal(scenario.preview.lane,scenario.lane);
      assert.ok(scenario.preview.changes.length);
      scenario.beforeSubmit?.();
      name='submit_result';args={result:{kind:'editor',summary:'执行已预览的编辑器指令',actions:scenario.actions}};
    }
    scenario.tools.push(name);
    return Response.json({choices:[{message:{role:'assistant',content:null,tool_calls:[{
      id:'editor-'+outputs.length,type:'function',function:{name,arguments:JSON.stringify(args)},
    }]}}]});
  };
  const send = async (requested,lane,options={}) => {
    scenario = {requested,lane,...options,tools:[]};
    const prompt = q('[data-ba-prompt]');
    prompt.value = options.inspect ? '检查当前编辑器状态' : '按要求更新战术板';
    prompt.dispatchEvent(new win.Event('input',{bubbles:true}));ba('send').click();
    await until(()=>!q('[data-ba-prompt]').readOnly&&!!q('.ba-output')?.textContent);
    assert.deepEqual(scenario.tools,options.inspect?['read_editor','submit_result']:['read_editor','preview_actions','submit_result']);
    return scenario;
  };
  const apply = async () => {assert.ok(ba('apply'));ba('apply').click();await until(()=>!!ba('undo'));};
  const undo = async expected => {assert.ok(ba('undo'),'the receipt survives the host adopting its new play scope');ba('undo').click();await until(()=>JSON.stringify(saved())===JSON.stringify(expected));};
  try {
    await import(`../web/app.js?editor-host-regression=${Date.now()}`);
    q('[data-cloud-action="enter-editor"]').click();
    ba('open').click();ba('settings').click();q('[data-ba-key]').value='test-provider-key';ba('done').click();
    const original = saved(), selected = original.plays.find(play=>q('h1').textContent.includes(play.title));
    assert.ok(selected);

    await t.test('create, duplicate and delete preview without persistence, apply once, and undo across selected-play scopes', async () => {
      const created = await send([{kind:'play_create',title:'AI Host Create',book:'offense',formation:'Gun Trips',count:11}],'workspace');
      assert.deepEqual(saved(),original);
      assert.ok(ba('apply'));assert.ok(ba('discard'));
      assert.match(q('.ba-output').textContent,/AI Host Create/);
      assert.notEqual(created.preview.selectedId,selected.id);
      await apply();
      assert.equal(saved().plays.length,original.plays.length+1);
      assert.equal(saved().plays.find(play=>play.id===created.preview.selectedId)?.title,'AI Host Create');
      assert.match(q('h1').textContent,/AI Host Create/);
      await undo(original);
      assert.ok(q('h1').textContent.includes(selected.title));

      await send([{kind:'play_duplicate',playId:selected.id,title:'AI Host Copy'}],'workspace');
      assert.deepEqual(saved(),original);
      await apply();
      const copied = saved().plays.find(play=>play.title==='AI Host Copy');
      assert.ok(copied);assert.notEqual(copied.id,selected.id);
      assert.deepEqual(copied.players,selected.players);
      assert.deepEqual(copied.routes,selected.routes);
      assert.match(q('h1').textContent,/AI Host Copy/);
      await undo(original);
      assert.ok(q('h1').textContent.includes(selected.title));

      const deleted = await send([{kind:'play_delete',playId:selected.id}],'workspace');
      assert.deepEqual(saved(),original);
      assert.notEqual(deleted.preview.selectedId,selected.id);
      await apply();
      assert.equal(saved().plays.length,original.plays.length-1);
      assert.ok(!saved().plays.some(play=>play.id===selected.id));
      assert.ok(q('h1').textContent.includes(saved().plays.find(play=>play.id===deleted.preview.selectedId).title));
      await undo(original);
      assert.ok(q('h1').textContent.includes(selected.title));

      await send([{kind:'play_create',title:'Discarded AI Plan',book:'offense',formation:'Gun Trips',count:11}],'workspace');
      ba('discard').click();
      assert.equal(ba('apply'),null);
      assert.deepEqual(saved(),original);
    });

    await t.test('local navigation, view, layout and playback update visible controls and real editor state', async () => {
      const target = original.plays.find(play=>play.id!==selected.id&&play.book===selected.book);
      await send([{kind:'play_select',playId:target.id}],'local');
      assert.ok(q('h1').textContent.includes(target.title));
      assert.match(q('.ba-output').textContent,/已更新战术板/,'navigation acknowledges its new scope instead of losing the reply');
      assert.equal(ba('apply'),null);
      assert.deepEqual(saved(),original);

      const changed = await send([
        {kind:'view_set',theme:'light',grid:false,names:true,visualMode:'traditional'},
        {kind:'layout_set',zoom:1.4,expanded:true,height:800,inspectorWidth:350},
        {kind:'playback_set',mode:'rehearse',playing:false,time:1,speed:1.5,loop:true},
      ],'local');
      assert.equal(changed.editor.selectedPlayId,target.id);
      assert.equal(q('[data-action="theme"]').getAttribute('aria-pressed'),'true');
      assert.equal(q('[data-action="grid"]').getAttribute('aria-pressed'),'false');
      assert.equal(q('#show-names').checked,true);
      assert.equal(q('#board-zoom-value').textContent,'140%');
      assert.equal(q('.workspace').style.getPropertyValue('--board-height'),'800px');
      assert.equal(q('.workspace').style.getPropertyValue('--inspector-width'),'350px');
      assert.ok(q('.workspace').classList.contains('board-expanded'));
      assert.equal(q('#speed').value,'1.5');
      assert.equal(q('[data-action="loop"]').getAttribute('aria-pressed'),'true');
      assert.equal(Number(q('#timeline').value),1);
      assert.equal(q('.editor-mode [data-action="rehearse-mode"]').getAttribute('aria-pressed'),'true');
      const inspection = await send(null,null,{inspect:true});
      assert.equal(inspection.editor.selectedPlayId,target.id);
      assert.equal(inspection.editor.view.theme,'light');
      assert.equal(inspection.editor.view.grid,false);
      assert.equal(inspection.editor.view.names,true);
      assert.equal(inspection.editor.view.visualMode,'traditional');
      for(const [key,value] of Object.entries({zoom:1.4,expanded:true,height:800,inspectorWidth:350}))assert.equal(inspection.editor.view.layout[key],value);
      assert.deepEqual(inspection.editor.view.playback,{playing:false,time:1,speed:1.5,loop:true,mode:'rehearse'});
      assert.deepEqual(saved(),original,'device controls do not mutate playbook content');
      await send([{kind:'playback_set',mode:'edit',reset:true,playing:false,speed:1,loop:false}],'local');
      assert.equal(Number(q('#timeline').value),0);
      assert.equal(q('.editor-mode [data-action="edit-mode"]').getAttribute('aria-pressed'),'true');
      const defensive=original.plays.find(play=>play.book==='defense');
      await send([{kind:'filter_set',book:'defense'}],'local');
      assert.ok(q('h1').textContent.includes(defensive.title),'book navigation changes the actual diagram');
      const defenseInspection=await send(null,null,{inspect:true});
      assert.equal(defenseInspection.editor.selectedPlayId,defensive.id);
      assert.equal(defenseInspection.editor.view.filter.book,'defense');
      await send([{kind:'filter_set',book:'offense'}],'local');
      assert.ok(q('h1').textContent.includes(original.plays.find(play=>play.book==='offense').title));
      assert.deepEqual(saved(),original);
    });

    await t.test('import, export and print are deferred until the reply Continue click and acknowledge pending user work', async () => {
      let imports = 0, prints = 0;
      const downloads = [], blobs = [];
      t.mock.method(q('#import-input'),'click',()=>{imports++;});
      t.mock.method(win.HTMLAnchorElement.prototype,'click',function(){downloads.push({name:this.download,url:this.href});});
      t.mock.method(URL,'createObjectURL',blob=>{blobs.push(blob);return 'blob:assistant-export';});
      t.mock.method(URL,'revokeObjectURL',()=>{});
      win.print = () => {prints++;};

      await send([{kind:'import_request'}],'interaction',{beforeSubmit:()=>assert.equal(imports,0)});
      assert.equal(imports,0);assert.ok(ba('continue'));assert.equal(ba('apply'),null);
      assert.match(q('.ba-output').textContent,/点击继续/);
      assert.doesNotMatch(q('.ba-output').textContent,/导入完成|导入成功/);
      assert.deepEqual(saved(),original);
      ba('continue').click();await until(()=>imports===1&&!ba('continue'));
      assert.match(q('.ba-output').textContent,/完成文件选择|文件选择/);
      assert.doesNotMatch(q('.ba-output').textContent,/导入完成|导入成功/);
      assert.deepEqual(saved(),original);

      await send([{kind:'export_request',format:'workspace_json'}],'interaction',{beforeSubmit:()=>assert.equal(downloads.length,0)});
      assert.equal(downloads.length,0);assert.equal(blobs.length,0);assert.ok(ba('continue'));
      assert.match(q('.ba-output').textContent,/点击继续/);
      ba('continue').click();await until(()=>downloads.length===1&&!ba('continue'));
      assert.match(downloads[0].name,/-playbook\.json$/);
      assert.equal(blobs[0].type,'application/json');
      assert.deepEqual(saved(),original);

      await send([{kind:'print_request',scope:'all',layout:'callsheet'}],'interaction',{beforeSubmit:()=>{
        assert.equal(prints,0);assert.equal(q('#print-scope'),null);
      }});
      assert.equal(prints,0);assert.equal(q('#print-scope'),null);assert.ok(ba('continue'));
      assert.match(q('.ba-output').textContent,/点击继续/);
      ba('continue').click();await until(()=>!!q('#print-scope')&&!ba('continue'));
      assert.equal(q('#print-scope').value,'all');
      assert.equal(q('#print-layout').value,'callsheet');
      assert.equal(q('#print-preview').querySelectorAll('tbody tr').length,original.plays.length);
      assert.equal(prints,0,'opening the preview has not printed anything');
      assert.match(q('.ba-output').textContent,/请在其中完成|打印/);
      q('[data-action="do-print"]').click();
      assert.equal(prints,1,'the separate browser print dialog is user initiated');
      q('.modal [data-action="close-modal"]').click();
      assert.deepEqual(saved(),original);
    });
  } finally {
    ba('close')?.click();globalThis.fetch=originalFetch;
    await win.happyDOM.abort();
    for (const name of names) {if(descriptors[name])Object.defineProperty(globalThis,name,descriptors[name]);else delete globalThis[name];}
  }
});
