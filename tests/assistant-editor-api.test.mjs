import test from 'node:test';
import assert from 'node:assert/strict';
import { handleApi } from '../server/api.mjs';
import { database } from './helpers/db.mjs';
import { requestBoardAssistant } from '../web/assistant-provider.js';
import { starterWorkspace } from '../web/model.js';

const owner={userId:'editor-coach',email:'editor-coach@example.com'};
const viewer={userId:'editor-viewer',email:'editor-viewer@example.com'};
const model={provider:'openai',apiKey:'test-editor-secret',model:'test'};
const call=(name,args)=>({role:'assistant',content:null,tool_calls:[{id:name,type:'function',function:{name,arguments:JSON.stringify(args)}}]});
const final=result=>call('submit_result',{result});
const response=message=>Response.json({choices:[{message}]});
const outputs=messages=>messages.filter(message=>message.role==='tool').map(message=>JSON.parse(message.content));
const post=(db,path,user,body)=>handleApi(new Request('https://test.local/api'+path,{method:'POST',headers:{origin:'https://test.local','content-type':'application/json'},body:JSON.stringify(body)}),{DB:db},user);
const stored=(db,id)=>db.sql.prepare('SELECT data_json,revision FROM workspaces WHERE id=?').get(id);

test('Worker builds editor context from its stored workspace and overlays only the current working play',async t=>{
  const db=database(t);
  const book=await(await post(db,'/workspaces',owner,{title:'Authoritative editor',data:starterWorkspace({demoDepth:true})})).json();
  const current={...book.data.plays[0],title:'Local working Mesh'};
  const realOther=book.data.plays[1];
  const malicious=structuredClone(book.data);
  malicious.plays=[{...current,id:'client-invented-play',title:'Fake client play'}];
  malicious.roster=[{id:'client-invented-player',name:'Fake client roster',number:'99',position:'QB'}];
  const actions=[{kind:'play_duplicate',playId:realOther.id,title:'Verified copy'}];
  const before=stored(db,book.id);
  let calls=0;
  t.mock.method(globalThis,'fetch',async(_url,options)=>{
    calls++;
    const {messages}=JSON.parse(options.body),evidence=outputs(messages);
    if(!evidence.length)return response(call('read_editor',{}));
    if(evidence.length===1){
      const editor=evidence[0];
      assert.equal(editor.selectedPlayId,current.id);
      assert.equal(editor.plays.find(play=>play.id===current.id).title,'Local working Mesh');
      assert.ok(editor.plays.some(play=>play.id===realOther.id));
      assert.ok(!editor.plays.some(play=>play.id==='client-invented-play'));
      assert.deepEqual(editor.roster,book.data.roster);
      assert.deepEqual(editor.personnelGroups,book.data.depthChart.groups.map(({id,name,unit})=>({id,name,unit})));
      assert.equal(editor.capabilities.find(item=>item.id==='play_duplicate').available,true);
      assert.deepEqual(editor.view,{grid:false});
      return response(call('preview_actions',{actions}));
    }
    assert.equal(evidence.at(-1).error,undefined);assert.equal(evidence.at(-1).lane,'workspace');
    return response(final({kind:'editor',actions}));
  });
  const result=await post(db,`/workspaces/${book.id}/board-assistant`,owner,{instruction:'Duplicate the other real play',board:{...current,playId:current.id},editor:{data:malicious,view:{grid:false},readOnly:true},model,revision:book.revision});
  assert.equal(result.status,200);assert.deepEqual((await result.json()).actions,actions);
  assert.equal(calls,3);
  assert.deepEqual(stored(db,book.id),before,'generation prepares a proposal and never writes the database');
});

test('Worker protects mutation results with current membership while allowing read-only device controls',async t=>{
  const db=database(t),book=await(await post(db,'/workspaces',owner,{title:'Readonly editor'})).json();
  const path=`/workspaces/${book.id}/board-assistant`,play=book.data.plays[0];
  const body={instruction:'Prepare requested command',board:{...play,playId:play.id},editor:{readOnly:false},revision:book.revision,model};
  let mode='workspace',calls=0;
  t.mock.method(globalThis,'fetch',async(_url,options)=>{
    calls++;
    const evidence=outputs(JSON.parse(options.body).messages);
    if(mode==='geometry'){
      const operations=[{kind:'play_update',patch:{notes:'A proposed coach note'}}];
      if(!evidence.length)return response(call('read_board',{}));
      if(evidence.length===1)return response(call('preview_edit',{operations}));
      assert.equal(evidence.at(-1).error,undefined);
      return response(final({kind:'edit',operations}));
    }
    const actions=mode==='workspace'?[{kind:'play_duplicate',playId:play.id}]:[{kind:'view_set',grid:false}];
    if(!evidence.length)return response(call('read_editor',{}));
    if(evidence.length===1){
      assert.equal(evidence[0].capabilities.find(item=>item.id==='play_duplicate').available,false);
      assert.equal(evidence[0].capabilities.find(item=>item.id==='view_set').available,true);
      return response(call('preview_actions',{actions}));
    }
    assert.equal(evidence.at(-1).error,undefined,'pure simulation remains available to read-only users');
    return response(final({kind:'editor',actions}));
  });
  assert.equal((await post(db,path,viewer,body)).status,404);assert.equal(calls,0);
  db.sql.prepare('INSERT INTO members(workspace_id,user_id,role,joined_at) VALUES(?,?,?,?)').run(book.id,viewer.userId,'viewer',Date.now());
  const before=stored(db,book.id);
  assert.equal((await post(db,path,viewer,body)).status,403,'workspace proposals require write access before being returned');
  mode='geometry';assert.equal((await post(db,path,viewer,body)).status,403,'play mutation proposals require write access before being returned');
  mode='local';const local=await post(db,path,viewer,body);
  assert.equal(local.status,200);assert.deepEqual((await local.json()).actions,[{kind:'view_set',grid:false}]);
  assert.deepEqual(stored(db,book.id),before);
});

test('workspace action proposals reject stale and concurrently changed revisions',async t=>{
  const db=database(t),book=await(await post(db,'/workspaces',owner,{title:'Revision protected editor'})).json();
  const path=`/workspaces/${book.id}/board-assistant`,play=book.data.plays[0];
  const actions=[{kind:'formation_save',name:'Practice alignment'}];
  const before=stored(db,book.id);
  let concurrent=false,changed=false,calls=0;
  t.mock.method(globalThis,'fetch',async(_url,options)=>{
    calls++;
    if(concurrent&&!changed){
      changed=true;
      db.sql.prepare('UPDATE workspaces SET revision=revision+1 WHERE id=?').run(book.id);
    }
    const evidence=outputs(JSON.parse(options.body).messages);
    if(!evidence.length)return response(call('read_editor',{}));
    if(evidence.length===1)return response(call('preview_actions',{actions}));
    return response(final({kind:'editor',actions}));
  });
  const body={instruction:'Save the current formation',board:{...play,playId:play.id},revision:book.revision,model};
  assert.equal((await post(db,path,owner,{...body,revision:0})).status,400);assert.equal(calls,0);
  assert.equal((await post(db,path,owner,{...body,revision:book.revision+1})).status,409);
  assert.deepEqual(stored(db,book.id),before);
  concurrent=true;
  assert.equal((await post(db,path,owner,body)).status,409);
  assert.equal(stored(db,book.id).data_json,before.data_json,'a concurrent revision cannot be overwritten by proposal generation');
});

test('Worker catalog import proposals use searched server catalog IDs and canonical entries',async t=>{
  const db=database(t),book=await(await post(db,'/workspaces',owner,{title:'Catalog editor'})).json();
  const play=book.data.plays[0],before=stored(db,book.id);
  let selected;
  t.mock.method(globalThis,'fetch',async(_url,options)=>{
    const evidence=outputs(JSON.parse(options.body).messages);
    if(!evidence.length)return response(call('read_editor',{}));
    if(evidence.length===1)return response(call('search_madden',{concepts:['mesh'],editableOnly:true}));
    if(evidence.length===2){
      selected=evidence[1].candidates[0];
      assert.ok(selected);assert.notEqual(selected.id,'client-fake-catalog');
      return response(call('preview_actions',{actions:[{kind:'catalog_import',catalogId:selected.id}]}));
    }
    assert.equal(evidence.at(-1).error,undefined);
    assert.match(evidence.at(-1).summary,/导入|Import/);
    return response(final({kind:'editor',actions:[{kind:'catalog_import',catalogId:selected.id}]}));
  });
  const result=await post(db,`/workspaces/${book.id}/board-assistant`,owner,{instruction:'Import an editable Mesh from Madden',board:{...play,playId:play.id},revision:book.revision,model,
    editor:{catalogRows:[{id:'client-fake-catalog',name:'Fabricated play'}]},candidates:[{id:'client-fake-catalog'}]});
  assert.equal(result.status,200);assert.deepEqual((await result.json()).actions,[{kind:'catalog_import',catalogId:selected.id}]);
  assert.deepEqual(stored(db,book.id),before);
});

test('browser cloud requests send the current board and device view without duplicating the full workspace',async()=>{
  const data=starterWorkspace(),play=data.plays[0];
  data.plays[1].notes='PRIVATE_OTHER_PLAY_NOTES';
  const result=await requestBoardAssistant({instruction:'Hide the field grid',board:play,editor:{data,view:{grid:true},readOnly:false},model,workspace:{id:'workspace-real',revision:7},
    request:async(path,options)=>{
      assert.equal(path,'/api/workspaces/workspace-real/board-assistant');
      assert.equal(options.body.revision,7);assert.equal(options.body.board.play.id,play.id);
      assert.deepEqual(options.body.editor,{view:{grid:true}});
      assert.doesNotMatch(JSON.stringify(options.body),/PRIVATE_OTHER_PLAY_NOTES/);
      assert.equal(options.body.editor.data,undefined);
      return {kind:'editor',actions:[{kind:'view_set',grid:false}]};
    }});
  assert.equal(result.kind,'editor');
});

test('static provider sends compact tool evidence instead of unrelated play geometry or notes',async()=>{
  const data=starterWorkspace(),play=data.plays[0];
  data.plays[1].notes='PRIVATE_OTHER_PLAY_NOTES';
  let calls=0;
  const result=await requestBoardAssistant({instruction:'Hide the field grid',board:play,editor:{data,view:{grid:true}},model,
    fetchImpl:async(_url,options)=>{
      calls++;
      assert.doesNotMatch(options.body,/PRIVATE_OTHER_PLAY_NOTES|"data_json"|test-editor-secret/);
      const evidence=outputs(JSON.parse(options.body).messages);
      if(!evidence.length)return response(call('read_editor',{}));
      if(evidence.length===1){
        assert.equal(evidence[0].plays.length,data.plays.length);
        assert.ok(evidence[0].plays.every(item=>!Object.hasOwn(item,'players')&&!Object.hasOwn(item,'routes')&&!Object.hasOwn(item,'notes')));
        return response(call('preview_actions',{actions:[{kind:'view_set',grid:false}]}));
      }
      return response(final({kind:'editor',actions:[{kind:'view_set',grid:false}]}));
    }});
  assert.equal(result.kind,'editor');assert.equal(calls,3);
});
