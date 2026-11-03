import test from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { createTrainingView } from '../web/training.js';
import { trainingDemo } from '../web/training-demo.js';
import { publishDrill } from '../web/training-model.js';
import { trainingProgress } from '../web/training-progress.js';

function setup(t, {mobile=true}={}) {
  const win = new Window({ url: 'https://training.example/prerelease/' });
  if (mobile) Object.defineProperty(win.navigator, 'userAgent', { value: 'Mozilla/5.0 (iPhone; Mobile)' });
  const root = win.document.createElement('div');
  win.document.body.append(root);
  const context = { scope: ['guest','A'], editable: false, book: {drills:[],plays:[]}, author: null };
  const view = createTrainingView({ root, getData: () => context.book, getUserScope: () => context.scope,
    canEdit: () => context.editable, onAuthor: value => { context.author = value; } });
  view.open();
  t.after(() => { view.destroy(); return win.happyDOM.abort(); });
  const q = s => root.querySelector(s);
  const act = (name, index = 0) => root.querySelectorAll('[data-tr="' + name + '"]')[index].click();
  const marker = id => q('[data-training-marker="' + id + '"]');
  const pick = id => marker(id).dispatchEvent(new win.MouseEvent('click', {bubbles:true}));
  return {win, root, view, q, act, marker, pick, context};
}

test('sample round keeps routes and feedback hidden until submission, grades distinct targets and replays a second outcome', t => {
  const {root,q,act,pick,marker,win} = setup(t);
  assert.equal(root.querySelectorAll('[data-tr="start"]').length, 2);
  act('start-set');
  assert.ok(q('[data-tr-mode="pov"]').disabled);
  assert.equal(q('.tr-explanation'),null);
  assert.equal(marker('will').getAttribute('aria-label').includes('WILL'), false);
  assert.equal(root.querySelectorAll('path[stroke-dasharray="5 4"]').length, 0);
  assert.equal(q('[data-tr="submit"]').disabled,true);
  pick('will');
  marker('mike').dispatchEvent(new win.KeyboardEvent('keydown',{bubbles:true,key:'Enter'}));
  assert.equal(q('[data-tr="submit"]').disabled,false);
  pick('ss');  // cap prevents accidental replacement
  assert.equal(marker('ss').getAttribute('aria-pressed'), 'false');
  act('submit');
  assert.match(q('.tr-explanation').textContent,/冲传/);
  assert.match(q('.tr-answers').textContent,/W · 球员 5 \/ M · 球员 6/);
  assert.equal(q('.tr-instructions .tr-note').textContent,'作答视图 · 俯视');
  assert.equal(q('.tr-instructions .tr-stamp').textContent,'独立答对');
  assert.ok(root.querySelectorAll('path[stroke-dasharray="5 4"]').length > 0);
  const slider = q('[data-tr-time]');
  slider.value = '1.1'; slider.dispatchEvent(new win.Event('input',{bubbles:true}));
  assert.equal(q('.tr-clock').textContent, '1.1s');
  act('next');
  assert.equal(q('.tr-explanation'),null);
  act('hint'); act('hint');
  pick('le'); pick('re'); act('submit');
  assert.match(q('.tr-explanation').textContent,/两人都后撤/);
  assert.equal(q('.tr-instructions .tr-stamp').textContent,'需要重练');
  act('next');
  assert.equal(root.querySelectorAll('.tr-summary article').length,2);
  act('retry-misses');
  assert.match(q('.tr-crumb span').textContent,/共 1 题/);
  pick('will'); pick('mike'); act('submit'); act('next'); act('library');
  assert.match(q('.tr-card:nth-child(2) .tr-record').textContent,/尝试 2 次/);
  assert.match(q('.tr-card:nth-child(2) .tr-record').textContent,/需要重练/);
});

test('position entry, book changes, coach permissions and progress separation', t => {
  const {context,view,q,act,pick,root} = setup(t);
  view.open({role:'RB'});
  assert.ok(q('.tr-empty'));
  act('all');
  act('start'); pick('will'); pick('mike'); act('submit'); act('next'); act('library');
  assert.ok(q('.tr-record'));
  context.scope=['user1','book1']; view.refresh();
  assert.equal(q('.tr-record'),null);
  assert.equal(q('.tr-coach'),null);
  context.book=trainingDemo(); context.editable=true; view.refresh();
  assert.equal(root.querySelectorAll('.tr-coach-row').length,2);
  act('author',1);
  assert.equal(context.author.drillId,context.book.drills[0].id);
  view.close(); assert.equal(root.hidden,true);
  view.open(); assert.equal(root.hidden,false);
});

test('progress records first and last independently for each view and revision; blocked storage keeps the session usable', () => {
  const progress=trainingProgress(()=>['u','b'],()=> { throw new Error('blocked'); });
  const d={id:'example',revision:1};
  const rep=(correct,hinted,view)=>({correct,hinted,ids:['1'],view});
  progress.record('team',d,rep(false,true,'field'));
  progress.record('team',d,rep(true,false,'field'));
  progress.record('team',d,rep(true,false,'pov'));
  assert.equal(progress.read('team',d).attempts,3);
  assert.equal(progress.read('team',d).first.field.correct,false);
  assert.equal(progress.read('team',d).first.pov.correct,true);
  assert.equal(progress.read('team',d).last.correct,true);
  assert.equal(progress.read('team',{...d,revision:2}).attempts,0);
  assert.equal(progress.read('demo',d).attempts,0);
  assert.equal(progress.isPersistent(),false);
});


test('an accepted alternative uses the actual marked set for both feedback and overhead highlights', t => {
  const {context,view,q,act,root} = setup(t);
  const sample=trainingDemo();
  const alternative=['le','re'];
  context.book={plays:sample.plays,drills:[publishDrill({...sample.drills[0],id:'team-read',alternativeTargetIds:[alternative]},sample.plays)]};
  view.refresh(); act('start');
  q('.tr-numbered').open=true;
  for(const id of alternative) q('[data-tr="number"][data-marker-id="'+id+'"]').click();
  assert.equal(q('[data-tr="number"][data-marker-id="le"]').getAttribute('aria-pressed'),'true');
  act('submit');
  assert.equal(q('.tr-instructions .tr-stamp').textContent,'独立答对');
  assert.match(q('.tr-answers').textContent,/一种有效读法/);
  assert.doesNotMatch(q('.tr-answers').textContent,/W ·|M ·/);
  assert.equal(root.querySelectorAll('[data-training-marker="le"] circle[stroke="#7cf4ac"]').length,1);
  assert.equal(root.querySelectorAll('[data-training-marker="will"] circle[stroke="#7cf4ac"]').length,0);
});


test('a requested but unrendered POV never counts toward the answer view', t => {
  const {act,q,pick} = setup(t,{mobile:false});
  act('start');
  q('[data-tr-mode="field"]').click();  // switch during initial lazy loading
  pick('will'); pick('mike'); act('submit');
  assert.equal(q('.tr-instructions .tr-note').textContent,'作答视图 · 俯视');
});
