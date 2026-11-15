import test from 'node:test';
import assert from 'node:assert/strict';
import { addRoute, makePlay, starterWorkspace, validatePlay } from '../web/model.js';
import { withDefense43 } from '../web/defense-formation.js';
import { proposeEdit } from '../web/assistant-proposal.js';
import { parseBoardOperations, previewEditTool, submitResultTool } from '../web/assistant-schema.js';
import { boardAssistantInput } from '../web/assistant-provider.js';
import { createBoardTools } from '../web/assistant-tools.js';
import { proposalConflicts } from '../web/assistant-conflicts.js';

const add = {kind:'defense_formation',formation:'4-3',mode:'add'};
const reset = {...add,mode:'reset'};
const defenders = play => play.players.filter(player => player.side === 'defense');
const offense = play => play.players.filter(player => player.side === 'offense');
const freshIds = () => {let next=0;return () => 'test-defense-'+next++;};

test('the model contract exposes only explicit supported defensive formation operations', () => {
  assert.deepEqual(parseBoardOperations([add,reset]),[add,reset]);
  for (const invalid of [
    {...add,formation:'3-4'}, {...add,formation:'4–3'}, {...add,mode:'replace'},
    {kind:'defense_formation',formation:'4-3'}, {...add,count:7}, {...add,coverage:'cover2'},
  ]) assert.throws(() => parseBoardOperations([invalid]));
  for (const tool of [previewEditTool,submitResultTool]) {
    const schema=JSON.stringify(tool.function.parameters);
    assert.match(schema,/defense_formation/);
    assert.match(schema,/4-3/);
  }
});

test('4-3 overlays a complete front and secondary on Mesh without changing the offensive play', () => {
  const play=starterWorkspace().plays[0], before=structuredClone(play);
  const proposal=proposeEdit(play,[add]);
  const defense=defenders(proposal.play);
  assert.deepEqual(play,before,'proposal generation never persists or mutates the source');
  assert.equal(defense.length,11);
  assert.deepEqual(defense.map(player=>player.label),['DE','DT','DT','DE','W','M','S','CB','CB','SS','FS']);
  assert.equal(new Set(proposal.play.players.map(player=>player.id)).size,22);
  assert.deepEqual(offense(proposal.play),before.players);
  assert.deepEqual(proposal.play.routes,before.routes);
  assert.deepEqual(proposal.play.ball,before.ball);
  assert.deepEqual(proposal.play.zones,before.zones,'personnel alignment does not imply coverage');
  assert.deepEqual(proposal.play.annotations,before.annotations);
  for (const key of ['id','title','book','formation','category','personnel','notes','favorite','createdAt'])
    assert.deepEqual(proposal.play[key],before[key],key);
  assert.deepEqual(validatePlay(proposal.play),proposal.play);
  assert.deepEqual(new Set(proposal.playerIds),new Set(defense.map(player=>player.id)));
  assert.match(proposal.summary,/4.?3/);
  assert.equal(proposal.effects[0].kind,'defense_formation');
  assert.equal(proposal.effects[0].playerIds.length,11);
  assert.deepEqual(proposeEdit(structuredClone(play),[add]).play,proposal.play,'preview and application IDs agree');
});

test('the shared helper always adds eleven, respects the marker cap and refuses duplicate addition', () => {
  const play=makePlay({count:7}),before=structuredClone(play);
  const added=withDefense43(play,{idFactory:freshIds()});
  assert.deepEqual(play,before);
  assert.equal(defenders(added).length,11);
  assert.equal(offense(added).length,7);
  const mixed=structuredClone(added);
  assert.throws(()=>withDefense43(added),/defen|防守/i);
  assert.throws(()=>proposeEdit(added,[add]),/defen|防守/i);
  assert.deepEqual(added,mixed);
  const crowded=makePlay();
  const actor=crowded.players[0];
  for(let index=0;index<19;index++)crowded.players.push({...actor,id:'extra-'+index});
  assert.equal(crowded.players.length,30);
  const original=structuredClone(crowded);
  assert.throws(()=>withDefense43(crowded),/40|limit|上限|数量/i);
  assert.deepEqual(crowded,original);
});

test('explicit reset reports removed defenders and routes while repairing dependent references', () => {
  const play=withDefense43(starterWorkspace().plays[0],{idFactory:freshIds()});
  const old=defenders(play), oldIds=new Set(old.map(player=>player.id));
  addRoute(play,'DE',[[old[0].x,73]]);
  const removedRoute=play.routes.at(-1).id;
  const block=play.routes.find(route=>route.kind==='block');
  block.blockTargets=[old[0].id];
  play.ball.holderId=old[0].id;
  play.ball.receiverId=old[1].id;
  const before=structuredClone(play),proposal=proposeEdit(play,[reset]);
  assert.deepEqual(play,before);
  assert.equal(defenders(proposal.play).length,11);
  assert.ok(defenders(proposal.play).every(player=>!oldIds.has(player.id)));
  assert.deepEqual(offense(proposal.play),offense(before));
  assert.ok(!proposal.play.routes.some(route=>oldIds.has(route.playerId)));
  assert.deepEqual(proposal.play.routes.find(route=>route.id===block.id),{...block,blockTargets:[null]});
  assert.deepEqual(proposal.play.routes.filter(route=>route.id!==block.id),before.routes.filter(route=>route.id!==block.id&&route.id!==removedRoute));
  assert.equal(proposal.play.ball.holderId,play.players.find(player=>player.label==='QB').id);
  assert.equal(proposal.play.ball.receiverId,'');
  assert.equal(proposal.play.ball.passAt,before.ball.passAt);
  assert.equal(proposal.play.ball.arriveAt,before.ball.arriveAt);
  assert.deepEqual(new Set(proposal.removed.players),oldIds);
  assert.deepEqual(proposal.removed.routes,[removedRoute]);
  assert.deepEqual(validatePlay(proposal.play),proposal.play);
});

test('read_board advertises local formation creation and permits preview without resolving nonexistent defenders', async () => {
  const play=starterWorkspace().plays[0];
  const input=boardAssistantInput({instruction:'添加 4-3 防守',board:play,mode:'edit'});
  const tools=createBoardTools(input,async()=>{throw new Error('A local formation must not search the catalog.');});
  const unread=await tools.run('preview_edit',{operations:[add]});
  assert.match(unread.error,/read|读取|查看/i);
  const board=await tools.run('read_board',{});
  assert.deepEqual(board.capabilities.defenseFormations,['4-3']);
  assert.equal(board.players.filter(player=>player.side==='defense').length,0);
  assert.equal(tools.resolved.size,0);
  const preview=await tools.run('preview_edit',{operations:[add]});
  assert.equal(preview.error,undefined);
  assert.equal(preview.playerIds.length,11);
  assert.equal(tools.resolved.size,0);
  assert.deepEqual(tools.getPreview(parseBoardOperations([add])),preview);
  assert.equal(play.players.length,11);
});

test('formation previews conflict with newly added defenders and rebase unrelated offense edits', () => {
  const play=starterWorkspace().plays[0],proposal=proposeEdit(play,[add]);
  const renamed=structuredClone(play);renamed.title='Coach rename';
  assert.equal(proposalConflicts(play,renamed,[add],proposal),false);
  assert.equal(proposeEdit(renamed,[add]).play.title,'Coach rename');
  const shifted=structuredClone(play);shifted.players.find(player=>player.label==='QB').name='Coach assignment';
  assert.equal(proposalConflicts(play,shifted,[add],proposal),false);
  assert.deepEqual(offense(proposeEdit(shifted,[add]).play),shifted.players);
  const concurrent=withDefense43(play,{idFactory:freshIds()});
  assert.equal(proposalConflicts(play,concurrent,[add],proposal),true);
});

test('reset cannot overwrite defenders or their routes edited after preview', () => {
  const play=withDefense43(starterWorkspace().plays[0],{idFactory:freshIds()});
  const defense=defenders(play)[0];
  addRoute(play,'DE',[[defense.x,73]]);
  const proposal=proposeEdit(play,[reset]);
  for(const mutate of [
    current=>{current.players.find(player=>player.id===defense.id).x+=1;},
    current=>{current.routes.at(-1).duration+=1;},
    current=>{current.ball.holderId=defense.id;},
    current=>{current.routes.find(route=>route.kind==='block').blockTargets=[defense.id];},
  ]) {
    const current=structuredClone(play);mutate(current);
    assert.equal(proposalConflicts(play,current,[reset],proposal),true);
  }
});
