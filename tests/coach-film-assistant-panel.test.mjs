import test from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { createBoardAssistant } from '../web/board-assistant.js';
import { openFilmRoom } from '../web/coach-film-room.js';
import { starterWorkspace } from '../web/model.js';

const settle = () => new Promise(resolve => setImmediate(resolve));

function fixture(onRequest, {width = 1366, fallback = false} = {}) {
  const win = new Window({width, height:768});
  const showModal = win.HTMLDialogElement.prototype.showModal;
  if (fallback) win.HTMLDialogElement.prototype.showModal = undefined;
  const doc = win.document, play = starterWorkspace().plays[0];
  const editor = doc.createElement('main'), entry = doc.createElement('button');
  const field = doc.createElement('div'), dock = doc.createElement('aside');
  editor.append(entry, field, dock);
  doc.body.append(editor);
  const panelChanges = [];
  const assistant = createBoardAssistant({
    host:field, getContext:() => ({scope:play.id, title:play.title, dockHost:dock}),
    onPanelChange:state => panelChanges.push(state), onRequest,
  });
  const root = field.querySelector('.board-ai'), prompt = root.querySelector('[data-ba-prompt]');
  const action = name => root.querySelector('[data-ba="' + name + '"]');
  const configure = () => {
    action('settings').click();
    root.querySelector('[data-ba-key]').value = 'test-connection';
    action('done').click();
  };
  const press = (element, key) => element.dispatchEvent(new win.KeyboardEvent('keydown', {key, bubbles:true, cancelable:true}));
  let room;
  function enter() {
    room = openFilmRoom({assistant, play, doc});
    return room;
  }
  async function dispose() {
    room?.close();
    assistant.destroy();
    if (fallback) win.HTMLDialogElement.prototype.showModal = showModal;
    await win.happyDOM.abort();
  }
  return {win, doc, editor, entry, field, dock, assistant, root, prompt, panelChanges, action, configure, press, enter, dispose};
}

test('the default closed film assistant uses the same composer and applies a preview in the room exactly once', async () => {
  let applied = 0;
  const requests = [];
  const f = fixture(request => {
    requests.push(request);
    return {kind:'preview', message:'Freeze at release', changes:['Pass release'],
      apply() { applied++; return {kind:'answer', message:'At release'}; }};
  });
  try {
    f.entry.focus();
    const room = f.enter();
    const dialog = f.doc.querySelector('#coach-film-room');
    const rail = dialog.querySelector('#film-assistant-panel'), toggle = dialog.querySelector('[data-film-assistant-toggle]');
    assert.ok(rail.hidden);
    assert.equal(rail.querySelector('[data-ba-prompt]'), f.prompt);
    assert.equal(f.doc.querySelectorAll('.board-ai').length, 1);
    assert.equal(toggle.getAttribute('aria-controls'), rail.id);
    const notifications = f.panelChanges.length;
    toggle.click();
    assert.equal(rail.hidden, false);
    assert.equal(toggle.getAttribute('aria-expanded'), 'true');
    assert.equal(f.doc.activeElement, f.prompt);
    assert.equal(f.root.querySelector('.ba-panel').getAttribute('role'), 'region');
    assert.ok(f.root.querySelector('.ba-mode-switch').hidden && f.action('float').hidden);
    assert.equal(dialog.querySelector('.film-inspector').hidden, false);
    assert.equal(dialog.querySelector('.film-transport').hidden, false);
    f.configure();
    const suggestions = rail.querySelector('.ba-examples:not([hidden])');
    suggestions.firstElementChild.click();
    assert.match(f.prompt.value, /传球出手/);
    assert.equal(requests.length, 0);
    f.press(f.prompt, ']');
    assert.equal(Number(dialog.querySelector('[data-film-clock]').dataset.seconds), 0);
    f.press(f.prompt, 'Enter');
    await settle();
    assert.equal(requests.length, 1);
    assert.equal(requests[0].mode, 'auto');
    assert.equal(applied, 0);
    const replacementField = f.doc.createElement('div');
    f.editor.append(replacementField);
    f.assistant.mount(replacementField);
    f.win.dispatchEvent(new f.win.Event('resize'));
    assert.equal(f.root.parentElement, rail);
    assert.equal(f.panelChanges.length, notifications);
    f.press(f.prompt, 'Escape');
    assert.ok(rail.hidden && room.isOpen());
    assert.equal(f.doc.activeElement, toggle);
    toggle.click();
    f.action('apply').click();
    await settle();
    assert.equal(applied, 1);
    assert.ok(room.isOpen());
    f.prompt.value = 'next coaching cue';
    dialog.dispatchEvent(new f.win.Event('cancel', {cancelable:true}));
    assert.ok(room.isOpen() && rail.hidden);
    f.press(toggle, 'Escape');
    assert.equal(room.isOpen(), false);
    assert.equal(f.root.parentElement, replacementField);
    assert.equal(f.root.querySelector('.ba-panel').hidden, true);
    assert.equal(f.doc.activeElement, f.entry);
    f.assistant.open();
    assert.equal(f.root.parentElement, f.dock);
    assert.equal(f.prompt.value, 'next coaching cue');
    assert.match(f.root.querySelector('.ba-output').textContent, /At release/);
  } finally { await f.dispose(); }
});

test('entering on touch carries a running request out of the floating sheet into the fallback modal and back', async () => {
  let submitted, finish;
  const f = fixture(request => { submitted = request; return new Promise(resolve => { finish = resolve; }); }, {width:390, fallback:true});
  try {
    f.assistant.open();
    f.configure();
    f.assistant.compose('Describe the release', {send:true});
    assert.ok(submitted && !submitted.signal.aborted);
    assert.equal(f.root.parentElement, f.doc.body);
    assert.ok(f.root.classList.contains('ba-docked'));
    const room = f.enter();
    const rail = f.doc.querySelector('#film-assistant-panel');
    assert.equal(rail.hidden, false);
    assert.ok(!f.root.classList.contains('ba-floating') && !f.root.closest('[inert]'));
    assert.ok(f.editor.hasAttribute('inert'));
    f.assistant.refreshLayout();
    assert.equal(f.root.parentElement, rail);
    room.close();
    assert.equal(submitted.signal.aborted, false);
    assert.equal(f.root.parentElement, f.doc.body);
    assert.equal(f.root.querySelector('.ba-panel').hidden, false);
    assert.equal(f.root.querySelector('.ba-panel').getAttribute('role'), 'dialog');
    assert.ok(f.root.classList.contains('ba-docked') && !f.editor.hasAttribute('inert'));
    finish({kind:'answer',message:'Release at two seconds'});
    await settle();
    assert.match(f.root.querySelector('.ba-output').textContent, /Release at two seconds/);
    assert.equal(f.doc.querySelectorAll('#board-ai-panel').length, 1);
  } finally { await f.dispose(); }
});
