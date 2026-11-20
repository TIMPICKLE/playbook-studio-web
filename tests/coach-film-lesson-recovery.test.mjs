import assert from 'node:assert/strict';
import test from 'node:test';
import { Window } from 'happy-dom';
import { editor } from './helpers/coach-film-editor.mjs';
import { starterWorkspace } from '../web/model.js';
import { createFilmLesson } from '../web/coach-film-lesson.js';
import { openFilmRoom } from '../web/coach-film-room.js';

const control = name => '#coach-film-room [data-lesson-action="' + name + '"]';
const storageKey = (book, play) => 'playbook:coach-lesson:' + JSON.stringify([book, play.id]);
const diskQuestions = (f, key) => JSON.parse(f.win.localStorage.getItem(key)).stops.map(stop => stop.question);

function submit(f) {
  f.node('.film-lesson-form').dispatchEvent(new f.win.Event('submit', {bubbles:true, cancelable:true}));
}

function add(f, question) {
  f.click(control('add'));
  f.node('.film-lesson-form [name="question"]').value = question;
  submit(f);
}

async function saved(f) {
  const notice = f.node('.film-lesson-status');
  const done = Promise.withResolvers();
  const observer = new f.win.MutationObserver(() => {
    if (notice.textContent.includes('已保存')) done.resolve();
  });
  const timer = setTimeout(() => done.reject(Error(notice.textContent)), 3000);
  observer.observe(notice, {childList:true, subtree:true, characterData:true});
  try { f.click(control('save')); await done.promise; }
  finally { observer.disconnect(); clearTimeout(timer); }
}

test('the public lesson entrance resumes a saved two-stop lesson before appending and persisting the third question', async t => {
  const seed = starterWorkspace(), key = storageKey('local', seed.plays[0]);
  const f = await editor(t, {seed, pilot:'lesson'});
  await f.openFilm(); f.click(control('toggle'));
  add(f, 'Q1'); add(f, 'Q2');
  await saved(f);
  assert.deepEqual(diskQuestions(f, key), ['Q1','Q2']);
  f.closeFilm(); await f.openFilm(); f.click(control('toggle'));
  await f.waitFor(control('stop-1') + ':not([hidden])');
  assert.equal(f.node('.film-lesson-question').textContent, 'Q1');
  assert.equal(f.node('.film-lesson-status').textContent, '已加载本机课件。');
  add(f, 'Q3');
  await saved(f);
  assert.deepEqual(diskQuestions(f, key), ['Q1','Q2','Q3']);
  f.closeFilm(); await f.openFilm(); f.click(control('toggle'));
  await f.waitFor(control('stop-2') + ':not([hidden])');
  assert.ok(f.node(control('add')).disabled);
  for (const [index, question] of ['Q1','Q2','Q3'].entries()) {
    f.click(control('stop-' + index));
    assert.equal(f.node('.film-lesson-question').textContent, question);
  }
});

test('a direct AI append to a previously released v1 lesson keeps the authors’ stops and captures the current frame', async t => {
  const win = new Window({url:'https://practice.test'});
  const play = {
    id:'legacy', title:'Friday', book:'offense', formation:'Gun', league:11,
    players:[{id:'q', label:'QB', side:'offense', x:50, y:75}, {id:'h', label:'H', side:'offense', x:40, y:70}],
    routes:[{id:'h-go', playerId:'h', kind:'route', delay:0, duration:3, endCap:'arrow', points:[{x:40,y:70},{x:40,y:40}]}],
    ball:{holderId:'q', receiverId:'h', passAt:2, arriveAt:3},
  };
  const key = storageKey('home', play);
  // Fixed SHA-256 from the v62 record, independent of the current encoder.
  win.localStorage.setItem(key, JSON.stringify({version:1,
    revision:'c46538110aa53e4842e546fcfa58438534debe7accd201dcf82de59261290d2b',
    stops:[{time:.5, focusIds:['h'], question:'Q1', answer:'A1'}, {time:1, focusIds:[], question:'Q2', answer:'A2'}],
  }));
  const room = openFilmRoom({play, doc:win.document, lesson:createFilmLesson({workspaceId:'home'})});
  t.after(async () => { room.close(); await win.happyDOM.abort(); });
  await room.perform({operation:'event', event:'release'});
  const added = await room.perform({operation:'lesson', action:'add', question:'Q3'});
  assert.deepEqual(added.lesson.stops.map(stop => [stop.question, stop.time]), [['Q1',.5],['Q2',1],['Q3',2]]);
  await room.perform({operation:'lesson', action:'save'});
  assert.deepEqual(JSON.parse(win.localStorage.getItem(key)).stops.map(stop => stop.answer), ['A1','A2','']);
});

test('a viewer keeps the open form, recorded stops, reference and field through a real workspace poll', async t => {
  const data = starterWorkspace(), play = data.plays[0], h = play.players.find(p => p.label === 'H');
  const team = {id:'club-a', title:'Home', role:'viewer', revision:1, data};
  const cloud = {fetch: async (url, options = {}) => {
    assert.equal(options.method || 'GET', 'GET');
    if (url === '/api/session') return Response.json({user:{id:'coach', name:'Coach'}});
    if (url === '/api/workspaces') return Response.json({workspaces:[{id:team.id, title:team.title, role:team.role}]});
    if (url.split('?')[0] === '/api/workspaces/club-a') return Response.json(team);
    throw Error(url);
  }};
  const f = await editor(t, {pilot:'lesson', cloud});
  await f.waitFor('[data-cloud-action="enter-editor"]');
  f.click('[data-cloud-action="enter-editor"]'); await f.waitFor('[data-action="coach-film"]');
  const dialog = await f.openFilm(), canvas = f.node('.film-pitch canvas');
  const key = storageKey(team.id, play);
  f.click('[data-film-event="release"]'); f.click('[data-film-pick="' + h.id + '"]'); f.click('[data-film-action="pin"]');
  f.click(control('toggle')); add(f, 'Saved Q1'); await saved(f);
  add(f, 'Pending Q2'); f.click(control('add'));
  const input = f.node('.film-lesson-form [name="question"]');
  input.value = 'Typing Q3';
  const release = f.node('[data-film-event="release"]');
  release.focus(); release.click(); // Polling defers while the editor caret is active.
  play.title = 'Friday meeting'; team.revision++;
  await cloud.poll();
  assert.equal(f.node('.film-title').textContent, play.title);
  h.color = '#123456'; h.name = 'Away receiver'; h.shape = 'square'; team.revision++;
  await cloud.poll();
  assert.ok(f.node('#coach-film-room') === dialog, 'the meeting remains open');
  assert.ok(f.node('.film-pitch canvas') === canvas, 'metadata preserves the renderer');
  assert.ok(f.doc.activeElement === release, 'the active release control keeps keyboard focus');
  assert.equal(f.node('.film-lesson').hidden, false);
  assert.ok(f.node('.film-lesson-form [name="question"]') === input, 'the draft remains in the original textarea');
  assert.equal(input.value, 'Typing Q3');
  assert.equal(f.node(control('stop-1')).getAttribute('aria-pressed'), 'true');
  assert.equal(f.node('[data-film-action="pin"]').getAttribute('aria-pressed'), 'true');
  assert.deepEqual(diskQuestions(f, key), ['Saved Q1']);
  const piece = f.node('[data-film-player="' + h.id + '"]');
  assert.match(piece.getAttribute('aria-label'), /Away receiver/);
  assert.equal(piece.querySelector('.film-token-face').localName, 'rect');
  submit(f); await saved(f);
  assert.deepEqual(diskQuestions(f, key), ['Saved Q1','Pending Q2','Typing Q3']);
});

test('source revisions preserve authored text and require each stop to be re-anchored before replacing the saved lesson', async t => {
  const win = new Window({url:'https://practice.test'}), doc = win.document;
  const play = starterWorkspace().plays[0], h = play.players.find(p => p.label === 'H');
  h.rosterId = 'member';
  const roster = [{id:'member', name:'Receiver', number:'11'}];
  const room = openFilmRoom({play, doc, roster, lesson:createFilmLesson({workspaceId:'home'})});
  t.after(async () => { room.close(); await win.happyDOM.abort(); });
  const lesson = (action, args = {}) => room.perform({operation:'lesson', action, ...args});
  await lesson('add', {question:'First?', answer:'Private', time:2, focusIds:[h.id]});
  await lesson('save');
  const key = storageKey('home', play), raw = win.localStorage.getItem(key);
  await lesson('add', {question:'Second?', time:1});
  const piece = doc.querySelector('[data-film-player="' + h.id + '"]');
  const canvas = doc.querySelector('.film-pitch canvas');
  roster[0].number = '81'; roster[0].name = 'New name'; room.update(play, {roster});
  assert.ok(room.readState().lesson.open);
  assert.ok(doc.querySelector('.film-pitch canvas') === canvas);
  assert.ok(doc.querySelector('[data-film-player="' + h.id + '"]') === piece);
  assert.match(piece.getAttribute('aria-label'), /#81.*New name/);
  assert.equal(doc.querySelector('#coach-film-room').hasAttribute('data-film-question'), true);
  assert.equal(doc.querySelector('[data-film-plan]').getAttribute('display'), 'none');
  const addQuestion = doc.querySelector(control('add'));
  addQuestion.click();
  const form = doc.querySelector('.film-lesson-form');
  form.querySelector('[name="question"]').value = 'Third, in progress';
  const answer = form.querySelector('input:not([hidden]),textarea[name="answer"]:not([hidden])');
  answer.value = 'Third answer';
  play.ball.passAt = 1.5;
  room.update(play);
  assert.ok(doc.querySelector('.film-lesson-form') === form);
  assert.equal(form.querySelector('[name="question"]').value, 'Third, in progress');
  assert.equal(answer.value, 'Third answer');
  assert.match(doc.querySelector('.film-lesson-review').textContent, /1, 2, 在编提问/);
  assert.equal(win.localStorage.getItem(key), raw);
  await room.perform({operation:'event', event:'release'});
  form.dispatchEvent(new win.Event('submit', {bubbles:true, cancelable:true}));
  let reviewed = await lesson('state', {includeAnswers:true});
  assert.equal(reviewed.lesson.stops[2].time, 1.5);
  assert.equal(reviewed.lesson.stops[2].answer, 'Third answer');
  assert.deepEqual(reviewed.lesson.stops.map(stop => !!stop.needsReview), [true,true,false]);
  await assert.rejects(lesson('save'), {code:'LESSON_STALE'});
  await assert.rejects(lesson('reveal', {index:0}), {code:'LESSON_STALE'});
  await lesson('replace', {index:0, time:1.5, focusIds:[h.id]});
  await assert.rejects(lesson('save'), {code:'LESSON_STALE'});
  await lesson('replace', {index:1, time:1});
  reviewed = await lesson('save');
  assert.equal(reviewed.lesson.dirty, false);
  const stored = JSON.parse(win.localStorage.getItem(key));
  assert.notEqual(stored.revision, JSON.parse(raw).revision);
  assert.deepEqual(stored.stops.map(stop => [stop.question, stop.time]), [['First?',1.5],['Second?',1],['Third, in progress',1.5]]);
});
