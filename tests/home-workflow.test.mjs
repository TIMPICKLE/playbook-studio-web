import test from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { firstTaskChecklist, studioHome } from '../web/studio-home.js';
import zh from '../web/locales/onboarding.zh-CN.js';
import en from '../web/locales/onboarding.en.js';

test('recent play creates a direct editing path and escapes imported titles', () => {
  const win = new Window();
  win.document.body.innerHTML = studioHome({recentPlay:{title:'<img src=x onerror=alert(1)>',formation:'Flag Spread',league:5}});
  const editor = win.document.querySelector('.studio-choice-editor');
  assert.match(editor.querySelector('h2').textContent,/继续编辑/);
  assert.match(editor.querySelector('p').textContent,/<img src=x/);
  assert.match(editor.querySelector('p').textContent,/5 人／每方/);
  assert.equal(editor.querySelector('p img'),null);
  assert.equal(editor.querySelector('button').dataset.cloudAction,'enter-editor');
  assert.match(editor.querySelector('button').getAttribute('aria-label'),/继续编辑: <img src=x/);
  assert.equal(win.document.querySelector('.home-first-task'),null,'practice is opt-in at the host');
});

test('optional first-play checklist only reports completed host events without creating actions', () => {
  const win = new Window();
  const progress={createdPlay:true,routeAdded:true,rehearsed:false,exported:false};
  const before=JSON.stringify(progress);
  win.document.body.innerHTML=firstTaskChecklist(progress);
  const details=win.document.querySelector('details');
  assert.equal(details.open,false,'the task list never forces an overlay');
  assert.equal(win.document.querySelectorAll('[data-complete=true]').length,2);
  assert.match(details.querySelector('summary').textContent,/2 \/ 4/);
  assert.equal(details.querySelector('button').dataset.cloudAction,'enter-editor');
  assert.equal(details.querySelector('[data-action]'),null,'the tutorial cannot issue an editor mutation');
  assert.equal(JSON.stringify(progress),before);
  win.document.body.innerHTML=firstTaskChecklist(progress,'en');
  assert.match(win.document.body.textContent,/Optional practice/);
  assert.match(win.document.body.textContent,/Completed/);
  assert.deepEqual(Object.keys(en).sort(),Object.keys(zh).sort());
});
