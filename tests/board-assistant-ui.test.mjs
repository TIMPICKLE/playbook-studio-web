import test from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { createBoardAssistant } from '../web/board-assistant.js';

const flush = () => new Promise(resolve => setImmediate(resolve));
function fixture(onRequest, onAdd = () => true, Speech, handlers = {}) {
  const win = new Window({url:'https://playbook.test/local.html'});
  const host = win.document.createElement('div');
  win.document.body.append(host);
  if (Speech) win.SpeechRecognition = Speech;
  const context = {scope:'book/a',title:'Mesh',readOnly:false};
  const assistant = createBoardAssistant({host, getContext:() => context, onRequest, onAdd, ...handlers});
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
    requests.push(request); request.onTool('resolve_player', {role:'C'}); request.onTool('resolve_player', {name:'Avery'}); request.onTool('build_preview');
    return {kind:'preview',message:'Route preview',changes:['X dig 12'],operations:[{kind:'route',playerId:'x'}],
      apply:() => {applied++; return {kind:'edit',message:'Applied',operations:[{kind:'route',playerId:'x'}],routeIds:['r1','r2'],zoneIds:['z1','z2']};},
      discard:() => {discarded++;}};
  });
  f.click('edit'); f.type('[data-ba-prompt]', 'X dig 12'); f.click('send');
  assert.match(f.q('.ba-status').textContent,/定位 C.*定位 Avery.*生成改图预览/); await flush();
  assert.equal(requests[0].mode,'edit'); assert.equal(applied,0); assert.match(f.q('.ba-output').textContent,/X dig 12/);
  f.click('apply'); await flush(); assert.equal(applied,1);
  f.type('[data-ba-prompt]', 'two yards deeper'); f.click('send'); await flush();
  assert.deepEqual(requests[1].previous[0].routeIds,['r1','r2']);
  assert.deepEqual(requests[1].previous[0].zoneIds,['z1','z2']);
  f.click('discard'); assert.equal(discarded,1);
  f.click('clear-mode'); f.type('[data-ba-prompt]','find'); f.click('send'); await flush(); assert.equal(requests[2].mode,'auto');
  f.assistant.destroy(); await f.win.happyDOM.abort();
});

test('closing a pending preview discards it without applying', async () => {
  let applied = 0, discarded = 0;
  const f = fixture(() => ({kind:'preview', message:'Route', changes:['X dig 12'],
    apply:() => { applied++; }, discard:() => { discarded++; }}));
  f.type('[data-ba-prompt]', 'X dig 12'); f.click('send'); await flush();
  f.click('close');
  assert.equal(discarded, 1); assert.equal(applied, 0);
  f.click('open'); assert.equal(f.q('[data-ba=apply]'), null);
  f.assistant.destroy(); await f.win.happyDOM.abort();
});

test('answer highlights board IDs and handoff acts only after the coach clicks', async () => {
  let calls = 0, highlighted, handed;
  const f = fixture(() => ++calls === 1 ? {kind:'answer',message:'Read X',highlights:['x']} :
    {kind:'handoff',message:'Analyze both plays',playId:'play-1'}, undefined, undefined,
  {onHighlight: ids => {highlighted = ids;}, onHandoff: result => {handed = result;}});
  f.type('[data-ba-prompt]', 'who is the first read'); f.click('send'); await flush();
  assert.deepEqual(highlighted, ['x']); assert.equal(handed, undefined);
  f.type('[data-ba-prompt]', 'analyze matchup'); f.click('send'); await flush();
  assert.equal(handed, undefined); f.click('handoff'); assert.equal(handed.playId, 'play-1');
  f.assistant.destroy(); await f.win.happyDOM.abort();
});

test('discarded proposals remain structured context for the next instruction', async () => {
  const requests = [], operations = [{kind:'route',playerId:'x',concept:'dig',depthYards:12}];
  const f = fixture(request => {
    requests.push(request);
    return {kind:'preview',message:'X dig 12 yards',operations,routeIds:['r-x'],zoneIds:['z-left'],playerIds:['x'],discard() {}};
  });
  f.type('[data-ba-prompt]', 'X dig 12'); f.click('send'); await flush();
  f.click('discard');
  f.type('[data-ba-prompt]', 'change that to a post'); f.click('send'); await flush();
  assert.deepEqual(requests[1].previous[0], {
    instruction:'X dig 12',kind:'edit',status:'discarded',summary:'X dig 12 yards',
    operations,routeIds:['r-x'],zoneIds:['z-left'],playerIds:['x']
  });
  f.assistant.destroy(); await f.win.happyDOM.abort();
});

test('a rebase refresh keeps the proposal uncommitted until the coach confirms again', async () => {
  const requests = []; let saved = 0;
  const refreshed = {kind:'preview',message:'Recomputed',operations:[{kind:'route',playerId:'x'}],discard() {},
    apply() {saved++; return {kind:'edit',message:'Applied',routeIds:['r-x']};}};
  const f = fixture(request => {requests.push(request); return {kind:'preview',message:'Initial',discard() {},apply:() => refreshed};});
  f.type('[data-ba-prompt]', 'X dig'); f.click('send'); await flush();
  f.click('apply'); await flush();
  assert.equal(saved,0); assert.match(f.q('.ba-output').textContent,/Recomputed/);
  f.click('apply'); await flush(); assert.equal(saved,1);
  f.type('[data-ba-prompt]', 'deeper'); f.click('send'); await flush();
  assert.equal(requests[1].previous.length,1);
  assert.equal(requests[1].previous[0].status,'applied');
  f.assistant.destroy(); await f.win.happyDOM.abort();
});

test('the local process log shows only bounded tool evidence and clears with the play scope', async () => {
  const f = fixture(request => {
    request.onEvent({type:'tool',name:'resolve_player',args:{name:'Avery',apiKey:'test-opaque-value',thinking:'private text'},summary:'Found l1'});
    request.onEvent({type:'validation_error',error:'Invalid depth: test-opaque-value'});
    request.onEvent({type:'result',kind:'clarify',summary:'Which LB?'});
    request.onEvent({type:'model_step',reasoning:'hidden reasoning'});
    return {kind:'clarify',message:'Which LB?'};
  });
  f.type('[data-ba-prompt]', 'Find Avery'); f.click('send'); await flush();
  assert.equal(f.q('.ba-trace').hidden,false);
  assert.equal(f.q('.ba-trace-list').children.length,3);
  assert.match(f.q('.ba-trace').textContent,/resolve_player[\s\S]*Avery[\s\S]*Found l1[\s\S]*Invalid depth/);
  assert.doesNotMatch(f.q('.ba-trace').textContent,/test-opaque-value|private text|hidden reasoning|apiKey/);
  assert.match(f.q('.ba-trace').textContent,/\[redacted\]/);
  f.q('.ba-trace').open = true; f.click('close'); f.click('open');
  assert.equal(f.q('.ba-trace-list').children.length,3);
  f.context.scope = 'book/b'; f.assistant.refresh();
  assert.equal(f.q('.ba-trace').hidden,true); assert.equal(f.q('.ba-trace').open,false);
  assert.equal(f.q('.ba-trace-list').children.length,0);
  assert.equal(f.win.localStorage.length,0); assert.equal(f.win.sessionStorage.length,0);
  f.assistant.destroy(); await f.win.happyDOM.abort();
});
