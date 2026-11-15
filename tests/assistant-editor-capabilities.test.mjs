import test from 'node:test';
import assert from 'node:assert/strict';
import * as runtime from '@langchain/langgraph';
import { starterWorkspace, validatePlay } from '../web/model.js';
import { boardAssistantInput } from '../web/assistant-provider.js';
import { createBoardTools } from '../web/assistant-tools.js';
import { runBoardAssistant, validateBoardReply } from '../web/assistant-harness.js';
import { proposeEdit } from '../web/assistant-proposal.js';
import { parseBoardOperations, parseBoardResult } from '../web/assistant-schema.js';
import { EDITOR_PLAY_COMMANDS } from '../web/editor-play-commands.js';
import { EDITOR_ACTIONS, prepareEditorActions } from '../web/editor-actions.js';
import { hasEditableTrace, makeMaddenPlay } from '../web/madden-model.js';
import { boardCatalogRows } from '../server/board-assistant-catalog.mjs';

const call=(name,args)=>({role:'assistant',content:null,tool_calls:[{id:name,type:'function',function:{name,arguments:JSON.stringify(args)}}]});
const final=result=>call('submit_result',{result});
function fixture({readOnly=false,reference=false}={}) {
  const data=starterWorkspace({demoDepth:true});
  if(reference)data.plays[0]=makeMaddenPlay(boardCatalogRows.find(entry=>!hasEditableTrace(entry.id)));
  const play=data.plays[0];
  data.formations.push({id:'saved-offense',name:'Practice Spread',book:'offense',players:structuredClone(data.plays.find(item=>item.book==='offense'&&!item.reference).players)});
  const input=boardAssistantInput({instruction:'Prepare the requested editor change',board:play,editor:{data,readOnly,view:{theme:'light',grid:true,time:1.5}},locale:'en'});
  return {data,play,input,tools:createBoardTools(input,async()=>[])};
}

test('editor discovery exposes executable commands, authoritative schemas and real workspace objects',async()=>{
  const {data,play,input,tools}=fixture(),before=structuredClone(input);
  const overview=await tools.run('read_editor',{});
  assert.equal(overview.selectedPlayId,play.id);
  assert.deepEqual(overview.plays.map(item=>item.id),data.plays.map(item=>item.id));
  assert.deepEqual(overview.roster,data.roster);
  assert.deepEqual(overview.formations.saved,[{id:'saved-offense',name:'Practice Spread',book:'offense'}]);
  assert.deepEqual(overview.personnelGroups,data.depthChart.groups.map(({id,name,unit})=>({id,name,unit})));
  assert.deepEqual(overview.view,{theme:'light',grid:true,time:1.5});
  const playCommands=Object.values(EDITOR_PLAY_COMMANDS);
  assert.equal(playCommands.length,16);
  for(const entry of [...playCommands,...Object.values(EDITOR_ACTIONS)]) {
    const capability=overview.capabilities.find(item=>item.id===entry.id);
    assert.ok(capability,entry.id);assert.equal(capability.available,true,entry.id);
    const contract=await tools.run('get_command_schema',{command:entry.id});
    assert.equal(contract.command,entry.id);
    assert.ok(contract.schema.properties||contract.schema.anyOf,entry.id+' has an executable parameter schema');
  }
  const workspace=await tools.run('list_capabilities',{category:'workspace'});
  assert.deepEqual(workspace.capabilities.map(item=>item.id),Object.values(EDITOR_ACTIONS).filter(item=>item.lane==='workspace').map(item=>item.id));
  assert.match((await tools.run('get_command_schema',{command:'imaginary_editor_feature'})).error,/unknown/i);
  assert.deepEqual(input,before,'discovery never mutates the input snapshot');
});

test('availability reflects read-only workspaces and reference diagrams while retaining useful local controls',async()=>{
  const readonly=fixture({readOnly:true});
  const {capabilities}=await readonly.tools.run('read_editor',{});
  for(const id of ['player_add','play_update','play_create','formation_save','history_action']) {
    const item=capabilities.find(command=>command.id===id);
    assert.equal(item.available,false,id);assert.match(item.reason,/read.only/i);
  }
  for(const id of ['view_set','playback_set','export_request'])assert.equal(capabilities.find(command=>command.id===id).available,true,id);
  const reference=fixture({reference:true});
  const manifest=(await reference.tools.run('read_editor',{})).capabilities;
  assert.equal(manifest.find(item=>item.id==='player_add').available,false);
  assert.equal(manifest.find(item=>item.id==='play_update').available,true);
  await reference.tools.run('read_board',{});
  const updated=await reference.tools.run('preview_edit',{operations:[{kind:'play_update',patch:{notes:'A coach note about the original diagram'}}]});
  assert.equal(updated.error,undefined);
  const geometry=await reference.tools.run('preview_edit',{operations:[{kind:'player_add',side:'defense'}]});
  assert.match(geometry.error,/原图|reference|editable/i);
  const unavailable=createBoardTools(boardAssistantInput({instruction:'show capabilities',board:readonly.play}),async()=>[]);
  const noWorkspace=await unavailable.run('list_capabilities',{category:'workspace'});
  assert.ok(noWorkspace.capabilities.every(item=>item.available===false&&/context/i.test(item.reason)));
});

test('new marker aliases support one atomic read-board, preview and submitted semantic route group',async()=>{
  const {data,play,input}=fixture(),before=structuredClone(data);
  const operations=[{kind:'player_add',side:'defense',label:'Sam',x:72,y:46,as:'sam'},
    {kind:'route',playerId:'$sam',points:[{x:60,y:37},{x:55,y:30}]}];
  let step=0,preview;
  const result=await runBoardAssistant({runtime,input,callModel:async messages=>{
    step++;
    if(step===1)return call('read_board',{});
    if(step===2)return call('preview_edit',{operations});
    preview=JSON.parse(messages.filter(message=>message.role==='tool').at(-1).content);
    assert.equal(preview.error,undefined);
    assert.equal(preview.playerIds.length,1);assert.equal(preview.routeIds.length,1);
    return final({kind:'edit',operations});
  }});
  assert.deepEqual(result.toolsUsed,['read_board','preview_edit','submit_result']);
  assert.deepEqual(result.operations,operations);
  const proposal=proposeEdit(play,result.operations);
  const marker=proposal.play.players.find(player=>player.label==='Sam');
  assert.ok(marker);assert.notEqual(marker.id,'$sam');
  assert.equal(proposal.play.routes.find(route=>route.id===preview.routeIds[0]).playerId,marker.id);
  assert.deepEqual(proposal.playerIds,preview.playerIds);
  assert.deepEqual(validatePlay(proposal.play),proposal.play);
  assert.deepEqual(data,before,'the entire assistant flow remains a proposal');
});

test('aliases cannot refer forward, cross object types, reuse names or invent saved IDs',async()=>{
  for(const operations of [
    [{kind:'route',playerId:'$later',concept:'go',depthYards:10},{kind:'player_add',side:'offense',as:'later'}],
    [{kind:'zone_add',x:30,y:30,rx:10,ry:10,as:'sam'},{kind:'player_update',playerId:'$sam',patch:{name:'Wrong type'}}],
    [{kind:'player_add',side:'offense',as:'sam'},{kind:'player_add',side:'defense',as:'sam'}],
    [{kind:'player_update',playerId:'fabricated-id',patch:{name:'Missing'}}],
  ]) {
    const {input,tools}=fixture(),before=structuredClone(input);
    await tools.run('read_board',{});
    const proposal=await tools.run('preview_edit',{operations});
    assert.ok(proposal.error,JSON.stringify(operations));
    assert.deepEqual(input,before);
  }
});

test('workspace actions prepare deterministic CRUD and saved formations without persisting',async()=>{
  const {data,play,input,tools}=fixture(),before=structuredClone(data);
  const actions=[{kind:'play_duplicate',playId:play.id,title:'Scouting copy'},
    {kind:'formation_save',name:'Scouting alignment'},{kind:'play_delete',playId:play.id}];
  assert.match((await tools.run('preview_actions',{actions})).error,/read.*editor/i);
  await tools.run('read_editor',{});
  const evidence=await tools.run('preview_actions',{actions});
  assert.equal(evidence.lane,'workspace');assert.equal(evidence.error,undefined);
  assert.deepEqual(tools.getActionPreview(actions),evidence);
  const plan=prepareEditorActions({data,selectedId:play.id},actions,{locale:'en'});
  assert.equal(plan.data.plays.length,data.plays.length);
  assert.ok(!plan.data.plays.some(item=>item.id===play.id));
  const copy=plan.data.plays.find(item=>item.id===plan.selectedId);
  assert.equal(copy.title,'Scouting copy');assert.equal(copy.formation,'Scouting alignment');
  assert.deepEqual(copy.players,play.players);assert.deepEqual(copy.routes,play.routes);
  assert.equal(plan.data.formations.at(-1).name,'Scouting alignment');
  assert.deepEqual(prepareEditorActions({data,selectedId:play.id},actions,{locale:'en'}),plan);
  assert.deepEqual(data,before);assert.deepEqual(input.editor.data,before);
  assert.throws(()=>prepareEditorActions({data,selectedId:play.id},[{kind:'play_duplicate',playId:'imaginary'}]),/not.*playbook/i);
  const one={...data,plays:[play]};
  assert.throws(()=>prepareEditorActions({data:one,selectedId:play.id},[{kind:'play_delete',playId:play.id}]),/at least one/i);
});

test('creation uses a saved formation ID and never accepts a model-invented formation',()=>{
  const {data,play}=fixture();
  const action={kind:'play_create',title:'Saved package',book:'offense',formation:'custom:saved-offense',count:11};
  const plan=prepareEditorActions({data,selectedId:play.id},[action]);
  const created=plan.data.plays.find(item=>item.id===plan.selectedId);
  assert.equal(created.formation,'Practice Spread');assert.equal(created.players.length,11);
  assert.deepEqual(created.players.map(({id,...marker})=>marker),data.formations[0].players.map(({id,...marker})=>marker));
  assert.throws(()=>prepareEditorActions({data,selectedId:play.id},[{...action,formation:'Made Up Formation'}]),/existing|built.in/i);
});

test('catalog import accepts searched IDs and imports canonical catalog data without side effects',async()=>{
  const {input,data,play}=fixture(),before=structuredClone(data);
  const canonical=boardCatalogRows.find(entry=>hasEditableTrace(entry.id));
  input.editor.catalogRows=boardCatalogRows;
  const tools=createBoardTools(input,async()=>[{id:canonical.id,name:'Model invented title'}]);
  await tools.run('read_editor',{});
  const actions=[{kind:'catalog_import',catalogId:canonical.id}];
  assert.match((await tools.run('preview_actions',{actions})).error,/search.*catalog/i);
  await tools.run('search_madden',{concepts:['mesh']});
  assert.match((await tools.run('preview_actions',{actions:[{kind:'catalog_import',catalogId:'fabricated-id'}]})).error,/returned catalog ID/i);
  const preview=await tools.run('preview_actions',{actions});
  assert.equal(preview.error,undefined);assert.match(preview.summary,new RegExp(canonical.name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
  assert.doesNotMatch(preview.summary,/Model invented title/);
  const plan=prepareEditorActions({data,selectedId:play.id,catalogRows:boardCatalogRows},actions);
  assert.equal(plan.data.plays.at(-1).diagramSource.catalogId,canonical.id);
  assert.deepEqual(data,before);
});

test('workspace, local and interaction lanes cannot mix or masquerade as a completed export',async()=>{
  const {data,play,tools}=fixture(),before=structuredClone(data);
  await tools.run('read_editor',{});
  for(const actions of [
    [{kind:'formation_save',name:'Illegal mixed batch'},{kind:'view_set',grid:false}],
    [{kind:'tool_set',tool:'route'},{kind:'export_request',format:'png'}],
  ])assert.match((await tools.run('preview_actions',{actions})).error,/mix/i);
  for(const actions of [[{kind:'view_set',grid:false},{kind:'playback_set',time:2,playing:true}],
    [{kind:'export_request',format:'workspace_json'},{kind:'import_request'}]]) {
    const plan=prepareEditorActions({data,selectedId:play.id},actions);
    assert.equal(plan.data,undefined,'device actions are prepared without writing workspace data');
    assert.equal(plan.completed,undefined,'a preview is not evidence that a native interaction completed');
  }
  assert.deepEqual(data,before);
});

test('editor results require the exact previewed complete action group',async()=>{
  const {input,tools}=fixture();
  const actions=[{kind:'view_set',grid:false}];
  const result={kind:'editor',summary:'Hide yard lines',actions};
  assert.deepEqual(parseBoardResult(result),result);
  assert.throws(()=>validateBoardReply(result,input,tools,{requirePreview:true}),/read_editor|preview_actions/);
  await tools.run('read_editor',{});await tools.run('preview_actions',{actions});
  assert.deepEqual(validateBoardReply(result,input,tools,{requirePreview:true}),result);
  assert.throws(()=>validateBoardReply({...result,actions:[{kind:'view_set',grid:true}]},input,tools,{requirePreview:true}),/preview_actions/);
  assert.throws(()=>parseBoardOperations(actions),'local commands cannot use the geometry operation lane');
  let step=0;
  const flow=await runBoardAssistant({runtime,input,callModel:async()=>{
    if(++step===1)return call('read_editor',{});
    if(step===2)return call('preview_actions',{actions});
    return final(result);
  }});
  assert.equal(flow.kind,'editor');assert.deepEqual(flow.actions,actions);
  assert.deepEqual(flow.toolsUsed,['read_editor','preview_actions','submit_result']);
});
