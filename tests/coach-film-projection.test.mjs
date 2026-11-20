import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate as settle } from 'node:timers/promises';
import { Window } from 'happy-dom';
import { starterWorkspace } from '../web/model.js';
import { createBoardAssistant } from '../web/board-assistant.js';
import { createFilmLesson } from '../web/coach-film-lesson.js';
import { openFilmRoom } from '../web/coach-film-room.js';

function fixture(t, onRequest, setupWindow) {
  const win = new Window({url:'https://board.example', width:1366, height:768});
  setupWindow?.(win);
  const doc = win.document, play = starterWorkspace().plays[0];
  const host = doc.createElement('div'); doc.body.append(host);
  const assistant = onRequest && createBoardAssistant({host, getContext:()=>({scope:play.id}), onRequest});
  const room = openFilmRoom({play, doc, assistant, lesson:createFilmLesson({workspaceId:'team'})});
  t.after(async () => { room.close(); assistant?.destroy(); await win.happyDOM.abort(); });
  const dialog = doc.querySelector('#coach-film-room'), q = selector => dialog.querySelector(selector);
  const lesson = (action, args={}) => room.perform({operation:'lesson', action, ...args});
  return {win, dialog, q, room, assistant, lesson};
}

function assertMasked({dialog,q}) {
  assert.ok(dialog.hasAttribute('data-film-question'));
  for (const selector of ['[data-film-comparison]','[data-film-phase]','[data-film-reference]']) {
    assert.ok(q(selector).hidden, selector);
    assert.equal(q(selector).textContent, '', selector);
  }
  assert.ok(q('.film-depth-list').hidden);
  for (const depth of dialog.querySelectorAll('.film-depth-row span')) assert.equal(depth.textContent, '');
  assert.equal(q('.film-depth-label').textContent, '');
  assert.equal(q('.film-depth-label').parentElement.getAttribute('display'),'none');
  assert.equal(q('[data-film-plan]').getAttribute('display'),'none');
  assert.equal(q('.film-reference-position').getAttribute('display'),'none');
  assert.equal(q('.film-lesson-answer').textContent,'');
  assert.doesNotMatch(q('[data-film-announcement]').textContent,/比|deeper|3\.0\s*(码|yd)/i);
  assert.ok(!q('[data-film-question-hint]').hidden);
  assert.equal(dialog.querySelectorAll('[data-film-player][aria-pressed=true]').length,2);
}

test('Mesh students can inspect positions without field, inspector or live-region answers until reveal', async t => {
  const f = fixture(t), {q,room,lesson,win} = f;
  await room.perform({operation:'focus', players:['H','Y']});
  await room.perform({operation:'event', event:'release'});
  await room.perform({operation:'pin'});
  const reading = q('[data-film-comparison]').textContent, bracket = q('.film-depth-label').textContent;
  assert.match(reading,/H.*Y.*3\.0/);
  assert.match(q('[data-film-announcement]').textContent,/3\.0/);
  q('[data-lesson-action=toggle]').click(); q('[data-lesson-action=add]').click();
  const input = q('[name=answer]:not([hidden])');
  assert.equal(input.type,'password','even the first answer is authored behind a covered input');
  q('[name=question]').value = 'Which receiver is deeper at release, and by how much?';
  input.value = 'H, three yards deeper';
  assertMasked(f);
  q('.film-lesson form').dispatchEvent(new win.Event('submit',{bubbles:true,cancelable:true}));
  await settle();
  assertMasked(f);
  assert.ok(q('.film-lesson-question').textContent.startsWith('Which receiver'));
  assert.equal(q('[data-film-clock]').dataset.seconds,'2');
  const audience = room.readState(), teacher = await lesson('state',{includeAnswers:true});
  assert.ok(audience.players.every(player=>player.position));
  assert.equal(audience.comparison,null);
  assert.equal(audience.reference,null);
  assert.equal(audience.ball.holderId,null);
  assert.ok(audience.focus.every(player=>player.depthYards === null && player.origin === null));
  assert.equal(teacher.comparison.gapYards,3);
  assert.equal(teacher.reference.comparison.gapYards,3);
  assert.ok(teacher.focus.every(player=>Number.isFinite(player.depthYards)));
  assert.ok(teacher.questionMasked);
  assertMasked(f);
  assert.equal(q('[data-film-ball]').getAttribute('display'),'inline');
  q('[data-film-event=arrival]').click();
  assert.equal(q('[data-film-clock]').dataset.seconds,'3');
  assertMasked(f);
  await room.perform({operation:'theme',theme:'light'});
  await lesson('revisit'); assertMasked(f);
  q('[data-lesson-action=edit]').click();
  assert.equal(q('[name=answer]:not([hidden])').type,'password');
  assert.equal(q('textarea[name=answer]').value,'');
  assertMasked(f);
  await lesson('cancel');
  await lesson('reveal');
  assert.equal(q('.film-lesson-answer').textContent,'H, three yards deeper');
  assert.equal(q('[data-film-comparison]').textContent,reading);
  assert.equal(q('.film-depth-label').textContent,bracket);
  assert.equal(q('[data-film-plan]').getAttribute('display'),'inline');
  assert.equal(q('.film-reference-position').getAttribute('display'),'inline');
  assert.equal(q('[data-film-reference]').hidden,false);
  assert.match(q('[data-film-reference]').textContent,/3\.0/);
  assert.equal(q('.film-depth-list').hidden,false);
  await lesson('hide'); assertMasked(f);

  const multiline = 'First coaching cue\nSecond coaching cue';
  await lesson('update',{answer:multiline});
  q('[data-lesson-action=edit]').click();
  q('[name=question]').value = 'Which receiver crosses first?';
  q('.film-lesson form').dispatchEvent(new win.Event('submit',{bubbles:true,cancelable:true}));
  assert.equal((await lesson('state',{includeAnswers:true})).lesson.stops[0].answer, multiline);
});

test('a shared lesson covers earlier turns, in-flight private reads, trace and announcements and restores the coach conversation on exit', async t => {
  let finish, request;
  const f = fixture(t, input => {
    request = input;
    return new Promise(resolve => { finish = resolve; });
  });
  const {q,assistant,room,lesson} = f;
  q('[data-film-assistant-toggle]').click();
  q('[data-ba=settings]').click(); q('[data-ba-key]').value='test-key'; q('[data-ba=done]').click();
  assistant.compose('A previous private instruction',{send:true});
  request.onEvent({type:'tool',name:'read_board',summary:'H is the answer from a previous turn'});
  finish({kind:'answer',message:'An earlier answer on the projector'}); await settle();
  assert.match(q('.ba-history-list').textContent,/earlier answer/);
  assert.match(q('.ba-trace-list').textContent,/previous turn/);
  assistant.compose('In-flight private request',{send:true});
  await lesson('add',{question:'First stop?', answer:'First secret'});
  await lesson('add',{question:'Second stop?', answer:'Second secret'});
  const receipt = await lesson('state',{includeAnswers:true});
  assert.deepEqual(receipt.lesson.stops.map(stop=>stop.answer),['First secret','Second secret']);
  function privateView() {
    const panel=q('.ba-panel');
    assert.ok(panel.hasAttribute('data-ba-shared-lesson'));
    assert.equal(q('[data-ba-prompt]').type,'password');
    assert.equal(q('.ba-compose textarea').value,'');
    assert.doesNotMatch(panel.textContent,/secret|private request|previous turn|earlier answer|private instruction/i);
    assert.equal(q('.ba-history-list').children.length,0);
    assert.equal(q('.ba-trace-list').children.length,0);
    assert.ok(q('.ba-history').hidden && q('.ba-trace').hidden);
    assert.doesNotMatch(q('.ba-status').textContent,/secret|earlier answer|private/i);
  }
  privateView();
  request.onTool('resolve_player',{name:'Second secret'});
  request.onEvent({type:'tool',name:'control_film',summary:'First secret and Second secret'});
  finish({kind:'answer',message:'First secret and Second secret'}); await settle();
  privateView();
  assert.equal(q('.ba-run-state').dataset.state,'complete');
  q('[data-film-assistant-toggle]').click(); q('[data-film-assistant-toggle]').click(); privateView();
  assistant.compose('Still send the covered instruction',{send:true});
  assert.equal(request.prompt,'Still send the covered instruction');
  finish({kind:'answer',message:'Second secret'}); await settle();
  await lesson('reveal',{index:0});
  assert.equal(q('.film-lesson-answer').textContent,'First secret');
  assert.ok(!q('.film-shell').textContent.includes('Second secret'));
  privateView();
  await lesson('close');
  assert.equal(q('[data-ba-prompt]').tagName,'TEXTAREA');
  assert.match(q('.ba-output').textContent,/Second secret/);
  assert.match(q('.ba-history-list').textContent,/earlier answer/);
  assert.match(q('.ba-trace-list').textContent,/First secret/);
  assert.equal(room.readState().lesson.open,false);
});

test('switching the shared screen preserves a multiline draft, stops dictation and reports a save conflict without its private detail', async t => {
  let mic, request, rejectSave;
  const {q,assistant,lesson} = fixture(t, input => {
    request = input;
    return new Promise((resolve,reject) => { rejectSave = reject; });
  }, win => {
    win.SpeechRecognition = class {
      start() { mic = this; }
      abort() { this.aborted = true; }
    };
  });
  q('[data-film-assistant-toggle]').click(); q('[data-ba=settings]').click();
  q('[data-ba-key]').value='test-key'; q('[data-ba=done]').click();
  const draft = 'First private line\nSecond private line';
  assistant.compose(draft);
  q('[data-ba=mic]').click(); assert.ok(mic);
  await lesson('open');
  assert.ok(mic.aborted); assert.equal(mic.onresult,null);
  assert.equal(q('[data-ba-prompt]').type,'password');
  await lesson('close'); assert.equal(q('[data-ba-prompt]').value,draft);
  await lesson('open'); q('[data-ba=send]').click();
  assert.equal(request.prompt,draft);
  rejectSave(Object.assign(Error('Private answer in a diagnostic'),{code:'LESSON_CONFLICT'}));
  await settle();
  assert.equal(q('.ba-run-state').dataset.state,'failed');
  assert.match(q('.ba-status').textContent,/另一窗口|Another window/);
  assert.ok(!q('.ba-panel').textContent.includes('Private answer'));
  assert.ok(!q('[data-ba=retry]').disabled);
});
