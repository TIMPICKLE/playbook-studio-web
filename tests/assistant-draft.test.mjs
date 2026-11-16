import test from 'node:test';
import assert from 'node:assert/strict';
import * as runtime from '@langchain/langgraph';
import { starterWorkspace, clone } from '../web/model.js';
import { stageEdit, StagedEditConflict } from '../web/assistant-draft.js';
import { proposeEdit } from '../web/assistant-proposal.js';
import { createConversation, conversationContext } from '../web/assistant-session.js';
import { boardAssistantInput } from '../web/assistant-provider.js';
import { runBoardAssistant } from '../web/assistant-harness.js';
import { assistantPlayers, resolveBoardPlayer } from '../web/assistant-edit.js';

const mesh = () => clone(starterWorkspace().plays.find(play => /Mesh/.test(play.title)));
const label = (play, name) => play.players.find(player => player.label === name);
const defense = [{kind:'defense_formation',formation:'4-3',mode:'add'}];
const call = (name,args) => ({role:'assistant',content:null,tool_calls:[{id:'call-'+name,type:'function',function:{name,arguments:JSON.stringify(args)}}]});

test('staged turns stack on one working copy and later turns can use objects an earlier turn created', () => {
  const base = mesh(), x = label(base,'X'), untouched = clone(base);
  const first = stageEdit(base,[{instruction:'add 4-3',operations:defense}]);
  assert.equal(first.play.players.filter(player => player.side === 'defense').length,11);
  const mike = first.play.players.find(player => player.side === 'defense' && player.label === 'M');
  const second = stageEdit(base,[...first.steps,
    {instruction:'X slant',operations:[{kind:'route',playerId:x.id,concept:'slant',depthYards:5}]},
    {instruction:'note',operations:[{kind:'annotate',nearId:mike.id,text:'Mike'}]}]);
  assert.equal(second.steps.length,3);
  assert.equal(second.play.players.filter(player => player.side === 'defense').length,11);
  assert.equal(second.play.routes.find(route => route.playerId === x.id && route.intent)?.intent.concept,'slant');
  assert.equal(second.play.annotations.at(-1).text,'Mike');
  assert.deepEqual(second.turns.map(turn => turn.instruction),['add 4-3','X slant','note']);
  assert.equal(second.changes.length,3);
  assert.equal(second.operations.length,3);
  // One step is exactly the single proposal the editor used to show.
  assert.deepEqual(first.play,proposeEdit(base,defense).play);
  assert.deepEqual(base,untouched,'the committed play is never mutated');
});

test('an unrelated edit to the committed play rebases the stack and rewrites generated IDs', () => {
  const base = mesh(), x = label(base,'X');
  const first = stageEdit(base,[{instruction:'add 4-3',operations:defense}]);
  const mike = first.play.players.find(player => player.side === 'defense' && player.label === 'M');
  const staged = stageEdit(base,[...first.steps,{instruction:'note',operations:[{kind:'annotate',nearId:mike.id,text:'Mike'}]},
    {instruction:'X go',operations:[{kind:'route',playerId:x.id,concept:'go',depthYards:12}]}]);
  const edited = clone(base); edited.title = 'Renamed while pending';
  const rebased = stageEdit(edited,staged.steps);
  const nextMike = rebased.play.players.find(player => player.side === 'defense' && player.label === 'M');
  assert.notEqual(nextMike.id,mike.id,'proposal IDs follow the play they were built on');
  assert.equal(rebased.steps[1].operations[0].nearId,nextMike.id);
  assert.equal(rebased.play.title,'Renamed while pending');
  assert.equal(rebased.play.annotations.at(-1).text,'Mike');
  assert.equal(rebased.play.players.filter(player => player.side === 'defense').length,11);
});

test('a staged turn is rejected when the committed play changes what it depended on', () => {
  const base = mesh(), x = label(base,'X');
  const staged = stageEdit(base,[{instruction:'add 4-3',operations:defense},
    {instruction:'X go',operations:[{kind:'route',playerId:x.id,concept:'go',depthYards:12}]}]);
  const moved = clone(base); label(moved,'X').x += 6;
  assert.throws(() => stageEdit(moved,staged.steps),StagedEditConflict);
  const removed = clone(base); removed.players = removed.players.filter(player => player.id !== x.id);
  removed.routes = removed.routes.filter(route => route.playerId !== x.id);
  assert.throws(() => stageEdit(removed,staged.steps),StagedEditConflict);
  const defended = proposeEdit(base,defense).play;
  assert.throws(() => stageEdit(defended,staged.steps),StagedEditConflict,'the defense was added manually meanwhile');
  // A brand-new step reports its own domain error instead of a conflict.
  assert.throws(() => stageEdit(defended,[{operations:defense}]),error => !(error instanceof StagedEditConflict));
});

test('the thread keeps bounded records and settles pending turns in place', () => {
  const thread = createConversation(3);
  const first = thread.add({instruction:'a',kind:'edit',status:'pending'});
  thread.add({instruction:'b',kind:'answer'});
  thread.settle(first,'applied',{summary:'done'});
  assert.deepEqual(thread.records(),[{instruction:'a',kind:'edit',status:'applied',summary:'done'},{instruction:'b',kind:'answer'}]);
  thread.add({instruction:'c'}); thread.add({instruction:'d'});
  assert.deepEqual(thread.records().map(turn => turn.instruction),['b','c','d']);
  thread.settle(first,'discarded');
  assert.equal(thread.records().length,3,'a dropped record is not revived by a discard');
  thread.clear(); thread.settle(first,'applied');
  assert.deepEqual(thread.records().map(turn => turn.status),['applied'],'a committed turn survives a scope adoption');
});

test('focus and grounded players come only from records that still match the board', () => {
  const play = mesh(), x = label(play,'X'), y = label(play,'Y');
  const board = {...play,playId:play.id,players:assistantPlayers(play,[]),selectedPlayerId:y.id};
  const context = conversationContext({board,previous:[
    {instruction:'X dig',status:'pending',operations:[{kind:'route',playerId:x.id}],playerIds:[x.id,'gone'],routeIds:['missing']},
    {instruction:'who is first?',kind:'answer'}]});
  assert.deepEqual([...context.known].sort(),[x.id,y.id].sort());
  assert.deepEqual(context.focus.players,[{id:x.id,label:'X',side:'offense'}]);
  assert.deepEqual(context.focus.routeIds,[]); assert.equal(context.focus.instruction,'X dig'); assert.equal(context.staged,1);
  assert.equal(conversationContext({board:{players:[]},previous:'bad'}).focus,null);
});

test('a marker without a roster name resolves by its label when searched by name', () => {
  const players = [{id:'x',label:'X',name:'',side:'offense',x:10,y:67},{id:'h',label:'H',name:'',side:'offense',x:70,y:70},{id:'s',label:'S',name:'Sam Hill',side:'defense',x:50,y:50}];
  assert.deepEqual(resolveBoardPlayer(players,{name:'H'}).candidates.map(player => player.id),['h']);
  assert.deepEqual(resolveBoardPlayer(players,{name:'Sam'}).candidates.map(player => player.id),['s'],'a roster name still wins');
  assert.equal(resolveBoardPlayer(players,{name:'Q'}).status,'missing');
});

test('a follow-up without a subject edits the conversation focus on the staged board in one pass', async () => {
  const base = mesh(), h = label(base,'X');
  const staged = stageEdit(base,[{instruction:'X 跑 10 码 comeback',operations:[{kind:'route',playerId:h.id,concept:'comeback',depthYards:10,breakTo:'outside'}]}]);
  const route = staged.play.routes.find(item => item.playerId === h.id && item.intent);
  const previous = [{instruction:'X 跑 10 码 comeback',kind:'edit',status:'pending',...staged.turns[0]}];
  const input = boardAssistantInput({instruction:'再深两码',locale:'zh-CN',previous,
    board:{...staged.play,play:staged.play,playId:staged.play.id,players:assistantPlayers(staged.play,[])}});
  const operations = [{kind:'route',playerId:h.id,routeId:route.id,concept:'comeback',depthYards:12,breakTo:'outside'}];
  let step = 0;
  const result = await runBoardAssistant({runtime,input,callModel:async messages => {
    step++;
    if (step === 1) {
      const context = JSON.parse(messages[1].content);
      assert.equal(context.staged,1); assert.equal(context.previous[0].status,'pending');
      assert.deepEqual(context.focus.players.map(player => player.label),['X']);
      assert.deepEqual(context.focus.routeIds,[route.id]);
      assert.match(messages[0].content,/omits its subject/);
      return call('read_board',{});
    }
    if (step === 2) {
      const seen = JSON.parse(messages.at(-1).content).routes.find(item => item.id === route.id);
      assert.equal(seen.intent.concept,'comeback','the agent reads the pending edit, not the committed play');
      return call('preview_edit',{operations});
    }
    assert.equal(JSON.parse(messages.at(-1).content).error,undefined,'focus players need no second lookup');
    return call('submit_result',{result:{kind:'edit',summary:'12 码 comeback',operations}});
  }});
  assert.equal(result.kind,'edit'); assert.equal(result.repairs,0); assert.equal(result.modelCalls,3);
});
