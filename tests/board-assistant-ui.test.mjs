import test from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { createBoardAssistant } from '../web/board-assistant.js';

const flush = () => new Promise(resolve => setImmediate(resolve));
function fixture(onRequest, onAdd = () => true, Speech) {
  const win = new Window({url:'https://playbook.test/local.html'});
  const host = win.document.createElement('div');
  win.document.body.append(host);
  if (Speech) win.SpeechRecognition = Speech;
  const context = {scope:'book/a',title:'Mesh',readOnly:false};
  const assistant = createBoardAssistant({host, getContext:() => context, onRequest, onAdd});
  const q = selector => win.document.querySelector(selector);
  const click = action => q('[data-ba="' + action + '"]').click();
  const type = (selector, value) => {
    q(selector).value = value;
    q(selector).dispatchEvent(new win.Event('input', {bubbles:true}));
  };
  click('open'); click('settings'); type('[data-ba-key]','test-opaque-value'); click('done');
  return {win, assistant, host, context, q, click, type};
}

test('board search presents inert catalog cards and imports only the chosen item', async () => {
  const added = [], requests = [];
  const f = fixture(request => {
    requests.push(request);
    return {kind:'search',items:[
      {id:'a',title:'Flood',reason:'Stretch the sideline.',team:'Eagles',editable:true},
      {id:'b',title:'<em>Smash</em>',reason:'<img src=x onerror=bad()>',editable:false}
    ]};
  }, id => { added.push(id); return true; });
  f.click('search'); f.click('send'); await flush();
  assert.equal(requests[0].mode, 'search'); assert.equal(requests[0].model,'gpt-6.1-terra');
  assert.equal(f.q('.ba-card em'), null); assert.equal(f.q('.ba-card img'), null);
  assert.deepEqual(added, []);
  f.q('.ba-card:nth-of-type(2) [data-ba=add]').click(); await flush();
  assert.deepEqual(added,['b']); assert.ok(f.q('.ba-card:nth-of-type(2) [data-ba=add]').disabled);
  const key = f.q('[data-ba-key]');
  f.assistant.destroy(); assert.equal(key.value,'');
  assert.equal(f.win.localStorage.length,0); await f.win.happyDOM.abort();
});

test('a clarification retains its original command and the applied edit has one undo', async () => {
  const requests = []; let undone = 0;
  const f = fixture(request => {
    requests.push(request);
    return requests.length === 1 ? {kind:'clarify',message:'Which LB?'} : {kind:'edit',message:'C → DT → Sam',undo:() => { undone++; return true; }};
  });
  f.type('[data-ba-prompt]','Block DT then LB'); f.click('send'); await flush();
  assert.match(f.q('.ba-output').textContent,/Which LB/);
  f.type('[data-ba-prompt]','Sam'); f.click('send'); await flush();
  assert.equal(requests[1].prompt,'Sam');
  assert.equal(requests[1].previous[0].instruction,'Block DT then LB');
  assert.equal(requests[1].previous[0].message,'Which LB?');
  f.click('undo');
  assert.equal(undone, 1); assert.equal(f.q('[data-ba=undo]'),null);
  f.assistant.destroy(); await f.win.happyDOM.abort();
});

test('cancel, play switch and editor exit discard late responses', async () => {
  const calls = [];
  const f = fixture(request => new Promise(resolve => calls.push({request,resolve})));
  f.click('edit'); f.click('send'); f.click('send');
  assert.ok(calls[0].request.signal.aborted);
  f.click('send');
  f.context.scope = 'book/next'; f.assistant.refresh();
  assert.ok(calls[1].request.signal.aborted);
  for (const call of calls) call.resolve({kind:'edit',message:'old play'});
  await flush(); assert.doesNotMatch(f.q('.ba-output').textContent,/old play/);
  f.click('edit'); f.click('send');
  f.assistant.close({clear:true}); assert.ok(calls[2].request.signal.aborted);
  assert.equal(f.q('[data-ba-key]').value,'');
  f.assistant.destroy(); await f.win.happyDOM.abort();
});

test('dictation produces editable text, without sending until the coach submits', async () => {
  let recognition, sent = 0;
  class Speech {
    constructor() { recognition = this; }
    start() {}
    abort() {}
  }
  const f = fixture(() => { sent++; return {kind:'edit',message:'Done'}; }, undefined, Speech);
  f.click('mic'); assert.equal(recognition.lang,'zh-CN');
  recognition.onresult({results:[[{transcript:'C 先阻挡 DT'}]]}); recognition.onend();
  assert.equal(f.q('[data-ba-prompt]').value,'C 先阻挡 DT'); assert.equal(sent,0);
  f.click('mic'); recognition.onerror({error:'not-allowed'}); recognition.onend();
  assert.match(f.q('.ba-status').textContent,/麦克风/);
  f.click('send'); await flush(); assert.equal(sent,1);
  f.assistant.destroy(); await f.win.happyDOM.abort();
});


test('mode persists across typing and edit proposals require an explicit apply', async () => {
  let applied = 0, discarded = 0; const requests = [];
  const f = fixture(request => {
    requests.push(request); request.onTool('resolve_player');
    return {kind:'preview',message:'Route preview',changes:['X dig 12'],operations:[{kind:'route',playerId:'x'}],
      apply:() => {applied++; return {kind:'edit',message:'Applied',operations:[{kind:'route',playerId:'x'}],routeIds:['r1']};},
      discard:() => {discarded++;}};
  });
  f.click('edit'); f.type('[data-ba-prompt]', 'X dig 12'); f.click('send');
  assert.match(f.q('.ba-status').textContent,/定位/); await flush();
  assert.equal(requests[0].mode,'edit'); assert.equal(applied,0); assert.match(f.q('.ba-output').textContent,/X dig 12/);
  f.click('apply'); await flush(); assert.equal(applied,1);
  f.type('[data-ba-prompt]', 'two yards deeper'); f.click('send'); await flush();
  assert.deepEqual(requests[1].previous[0].routeIds,['r1']);
  f.click('discard'); assert.equal(discarded,1);
  f.click('clear-mode'); f.type('[data-ba-prompt]','find'); f.click('send'); await flush(); assert.equal(requests[2].mode,'auto');
  f.assistant.destroy(); await f.win.happyDOM.abort();
});
