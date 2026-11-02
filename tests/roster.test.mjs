import test from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { createRosterView } from '../web/roster.js';
import { starterWorkspace } from '../web/model.js';

function setup(t) {
  const win = new Window();
  t.after(() => win.happyDOM.abort());
  win.document.body.innerHTML = '<div id="roster-root" hidden></div>';
  const root = win.document.querySelector('#roster-root');
  const state = { data: starterWorkspace(), book: 'current', editable: true, writes: 0 };
  const view = createRosterView({
    root, getData: () => state.data, getWorkspaceId: () => state.book, canEdit: () => state.editable,
    commit(mutate) { mutate(state.data); state.writes++; }
  });
  view.show(true);
  const q = selector => root.querySelector(selector);
  const click = action => q(`[data-roster="${action}"]`).click();
  const save = () => q('form').dispatchEvent(new win.Event('submit', { bubbles: true, cancelable: true }));
  return { win, state, view, q, click, save };
}

test('player and team forms patch the latest data and preserve other fields, roster ids and plays', t => {
  const { state, view, q, click, save } = setup(t);
  const player = state.data.roster[0], id = player.id, plays = JSON.stringify(state.data.plays);
  click('edit');
  q('[name=name]').value = 'Casey';
  player.position = 'CB';
  state.data.roster[1].name = 'Parker';
  view.refresh();
  assert.equal(q('[name=name]').value, 'Casey');
  save();
  assert.equal(view.isEditing(), false);
  assert.equal(player.id, id);
  assert.equal(player.name, 'Casey');
  assert.equal(player.position, 'CB');
  assert.equal(state.data.roster[1].name, 'Parker');
  click('team');
  q('[name=league]').value = '7';
  state.data.team.subtitle = 'Finals';
  save();
  assert.equal(state.data.settings.league, 7);
  assert.equal(state.data.team.subtitle, 'Finals');
  assert.equal(JSON.stringify(state.data.plays), plays);
  assert.equal(state.writes, 2);
});

test('stale rows, active playbook changes and revoked permissions cannot overwrite another edit', t => {
  const { state, view, q, click, save } = setup(t);
  click('edit');
  q('[name=number]').value = '17';
  state.data.roster[0].number = '19';
  save();
  assert.equal(state.data.roster[0].number, '19');
  assert.equal(q('[name=number]').value, '17');
  assert.ok(q('[role=alert]').textContent);
  state.editable = false;
  view.refresh();
  assert.equal(q('[type=submit]').disabled, true);
  save();
  assert.equal(state.writes, 0);
  click('cancel');
  assert.equal(q('[data-roster=edit]'), null);
  state.editable = true;
  view.refresh();
  click('add');
  q('[name=name]').value = 'Sid';
  state.book = 'different';
  save();
  assert.equal(state.writes, 0);
  assert.equal(q('[name=name]').value, 'Sid');
});

test('delete confirmation, roster cap and search handle legacy names and jersey numbers', t => {
  const { state, win, view, q, click, save } = setup(t);
  const name = '<Coach & Sam>';
  Object.assign(state.data.roster[0], { name, number: '00', position: 'FS' });
  view.refresh();
  const search = q('[type=search]');
  for (const query of ['00', 'sAm', 'fs']) {
    search.value = query;
    search.dispatchEvent(new win.Event('input', { bubbles: true }));
    assert.equal(q('tbody').children.length, 1);
    assert.equal(q('th[scope=row]').textContent, name);
  }
  click('edit');
  win.confirm = () => false;
  click('remove');
  assert.equal(view.isEditing(), true);
  assert.equal(state.writes, 0);
  win.confirm = () => true;
  click('remove');
  assert.equal(state.data.roster.some(player => player.name === name), false);
  assert.ok(q('[data-roster=clear]'));
  click('clear');
  click('add');
  q('[name=name]').value = 'One more';
  while (state.data.roster.length < 200) state.data.roster.push({ id: `id-${state.data.roster.length}`, name: 'Player', number: '', position: '' });
  save();
  assert.equal(state.data.roster.length, 200);
  assert.equal(state.writes, 1);
  click('cancel');
  assert.equal(q('[data-roster=add]').disabled, true);
});
