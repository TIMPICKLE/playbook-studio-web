import test from 'node:test';
import assert from 'node:assert/strict';
import { createConversation, conversationRecords, conversationContext } from '../web/assistant-session.js';

test('history compaction never evicts pending edits and keeps a subject across conversational answers', () => {
  const thread = createConversation(3);
  thread.add({instruction:'X go',status:'pending',playerIds:['x']});
  for (let index=0;index<8;index++) thread.add({instruction:'question '+index,kind:'answer'});
  const records = thread.records();
  assert.equal(records.filter(turn=>turn.status==='pending').length,1);
  assert.equal(records.length,4);
  assert.deepEqual(conversationRecords(records,2).map(turn=>turn.instruction),['X go','question 6','question 7']);
  const context = conversationContext({board:{players:[{id:'x',label:'X',side:'offense'}]},previous:conversationRecords(records,2)});
  assert.equal(context.focus.players[0].id,'x');
});

test('transaction status updates only the matching committed group', () => {
  const thread = createConversation();
  thread.add({instruction:'X go',transactionId:'first',status:'applied'});
  thread.add({instruction:'X deeper',transactionId:'first',status:'applied'});
  thread.add({instruction:'Y out',transactionId:'second',status:'applied'});
  assert.equal(thread.settleTransaction('first','undone'),true);
  assert.deepEqual(thread.records().map(turn=>turn.status),['undone','undone','applied']);
  thread.settleTransaction('first','redone');
  assert.deepEqual(thread.records().map(turn=>turn.status),['redone','redone','applied']);
  assert.equal(thread.settleTransaction('second','pending'),false);
});

test('a current multi-selection preserves the whole group rather than silently keeping one historical subject',()=>{
  const context=conversationContext({board:{players:[{id:'x',label:'X',side:'offense'},{id:'y',label:'Y',side:'offense'}],selectedPlayerIds:['x','y','missing']},previous:[{instruction:'X go',playerIds:['x']}]});
  assert.deepEqual(context.focus.players.map(player=>player.id),['x','y']);
  assert.equal(context.focus.group,true);assert.deepEqual(context.selection.map(player=>player.id),['x','y']);
  assert.deepEqual([...context.known],['x','y']);
});
