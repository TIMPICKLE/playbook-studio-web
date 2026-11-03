import test from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { createDepthChartView } from '../web/depth-chart.js';
import { defaultDepthChart } from '../web/depth-model.js';

function setup(t) {
  const win = new Window();
  t.after(() => win.happyDOM.abort());
  const root = win.document.body;
  const state = {
    data: {
      roster: ['Robin', 'Casey', 'Parker'].map((name, i) => ({ id: `p${i}`, name, number: String(i), position: 'QB' })),
      depthChart: defaultDepthChart()
    },
    id: 'spread', book: 'book1', editable: true, writes: 0, saved: 0, fail: false
  };
  const view = createDepthChartView({
    root, getData: () => state.data, getSelectedId: () => state.id, getWorkspaceId: () => state.book,
    canEdit: () => state.editable, onChange: () => state.saved++,
    commit: mutate => {
      if (state.fail) return false;
      mutate(state.data);
      state.writes++;
    }
  });
  const q = selector => root.querySelector(selector);
  const click = (action, suffix = '') => {
    const button = q(`[data-depth-chart="${action}"]${suffix}`);
    assert.ok(button, `Expected ${action}${suffix}`);
    button.click();
  };
  const showMode = mode => click('mode', `[data-mode="${mode}"]`);
  const choose = (index, id) => {
    const select = q(`[data-rank="${index}"]`);
    select.value = id;
    select.dispatchEvent(new win.Event('change', { bubbles: true }));
  };
  const submit = () => q('form').dispatchEvent(new win.Event('submit', { bubbles: true, cancelable: true }));
  view.refresh();
  return { state, win, view, q, click, showMode, choose, submit, slots: state.data.depthChart.groups[0].slots };
}

test('coaches rank reserves, swap in a starter, and intentionally leave ranks open', t => {
  const { state, q, click, showMode, choose, submit, slots } = setup(t);
  showMode('table');
  click('edit');
  choose(0, 'p0');
  click('add-rank');
  choose(1, 'p1');
  click('add-rank');
  choose(2, 'p2');
  click('up', '[data-index="2"]');
  click('promote', '[data-index="1"]');
  submit();
  assert.deepEqual(slots[0].playerIds, ['p2', 'p0', 'p1']);
  assert.equal(state.saved, 1);
  assert.match(q('.depth-starter').textContent, /Parker/);
  assert.equal(q('.depth-backups li:last-child .depth-athlete span').textContent, 'Casey');

  click('edit');
  choose(0, '');
  click('drop', '[data-index="1"]');
  click('add-rank');
  submit();
  assert.deepEqual(slots[0].playerIds, [null, 'p1', null]);
});

test('cross-training is allowed but a backup cannot start twice for one personnel group', t => {
  const { q, click, showMode, choose, submit, slots, view } = setup(t);
  showMode('table');
  slots[1].playerIds = ['p1'];
  view.refresh();
  click('edit');
  assert.equal(q('[data-rank="0"] option[value="p1"]').disabled, true);
  click('add-rank');
  choose(1, 'p1');
  click('promote');
  assert.equal(q('[data-rank="0"]').value, '');
  assert.ok(q('[role="alert"]').textContent);
  submit();
  assert.deepEqual(slots[0].playerIds, [null, 'p1']);
  assert.deepEqual(slots[1].playerIds, ['p1']);
});

test('custom positions can be added, renamed and removed without modifying the directory', t => {
  const { win, state, q, click, showMode, choose, submit, slots } = setup(t);
  showMode('table');
  click('add');
  q('[name="label"]').value = ' qb ';
  submit();
  assert.equal(state.writes, 0);
  q('[name="label"]').value = 'Slot <Left>';
  choose(0, 'p1');
  submit();
  const slot = slots.at(-1);
  assert.equal(q('tbody tr:last-child th').textContent, 'Slot <Left>');
  showMode('field');
  const target = `[data-slot="${slot.id}"]`;
  assert.equal(q(`.df-pitch ${target}`), null);
  click('inspect', target);
  assert.match(q('#depth-formation-detail').textContent, /Slot <Left>/);
  assert.match(q('#depth-formation-detail').textContent, /Casey/);
  click('edit', target);
  q('[name="label"]').value = 'Slot right';
  submit();
  assert.equal(slot.label, 'Slot right');
  click('edit', target);
  win.confirm = () => false;
  click('remove');
  assert.equal(state.data.depthChart.groups[0].slots.includes(slot), true);
  win.confirm = () => true;
  click('remove');
  assert.equal(state.data.depthChart.groups[0].slots.includes(slot), false);
  assert.equal(state.data.roster.length, 3);
});

test('conflicting position, active book or permissions changes leave the draft intact', t => {
  const { state, view, q, click, showMode, choose, submit, slots } = setup(t);
  showMode('table');
  click('edit');
  choose(0, 'p2');
  slots[0].playerIds = ['p1'];
  view.refresh();
  assert.equal(q('button[type="submit"]').disabled, true);
  submit();
  assert.deepEqual(slots[0].playerIds, ['p1']);
  assert.equal(q('[data-rank="0"]').value, 'p2');
  click('close');
  click('edit');
  state.book = 'book2';
  submit();
  assert.equal(state.writes, 0);
  state.editable = false;
  view.refresh();
  click('close');
  assert.equal(q('[data-depth-chart="edit"]'), null);
  assert.equal(view.isEditing(), false);
});

test('a new roster deletion blocks stale choices, while an unrelated row can change independently', t => {
  const { state, view, q, click, showMode, choose, submit, slots } = setup(t);
  showMode('table');
  click('edit');
  choose(0, 'p2');
  state.data.roster.pop();
  submit();
  assert.ok(q('[role="alert"]').textContent);
  assert.equal(state.writes, 0);
  click('close');
  click('edit');
  choose(0, 'p0');
  slots[1].playerIds = ['p1'];
  view.refresh();
  state.fail = true;
  submit();
  assert.equal(view.isEditing(), true);
  assert.equal(state.saved, 0);
  state.fail = false;
  submit();
  assert.deepEqual(slots[0].playerIds, ['p0']);
  assert.deepEqual(slots[1].playerIds, ['p1']);
});

test('sideline lineup shows starters only across group changes and keeps editing available to coaches', t => {
  const { state, view, q, click, showMode, choose, submit, slots } = setup(t);
  slots[0].playerIds = ['p0', 'p1'];
  showMode('starters');
  assert.ok(q('.depth-lineup'));
  assert.match(q('.depth-lineup').textContent, /Robin/);
  assert.doesNotMatch(q('.depth-lineup').textContent, /Casey/);
  click('edit');
  choose(1, 'p2');
  click('promote');
  submit();
  assert.match(q('.depth-lineup').textContent, /Parker/);
  assert.doesNotMatch(q('.depth-lineup').textContent, /Robin/);
  state.id = '4-2-5';
  state.editable = false;
  view.refresh();
  assert.ok(q('.depth-lineup'));
  assert.match(q('.depth-lineup').textContent, /WDE/);
  assert.equal(q('[data-depth-chart="edit"]'), null);
  showMode('table');
  assert.ok(q('.depth-backups'));
  assert.equal(state.writes, 1);
});

test('players open the field first and can inspect every rank, including a vacant starter', t => {
  const { win, state, view, q, click, showMode, slots } = setup(t);
  const qb = slots.find(slot => slot.label === 'QB');
  const x = slots.find(slot => slot.label === 'X');
  qb.playerIds = ['p0'];
  x.playerIds = [null, 'p1', 'p2'];
  state.editable = false;
  view.refresh();
  const inspect = id => q(`button[data-depth-chart="inspect"][data-slot="${id}"]`);
  const pitch = q('.df-pitch');
  assert.ok(pitch);
  assert.ok(slots.every(slot => pitch.contains(inspect(slot.id))), 'each role has a keyboard-operable position on the field');
  assert.equal(q('table'), null);
  assert.match(inspect(qb.id).textContent, /Robin/);
  click('inspect', `[data-slot="${x.id}"]`);
  assert.equal(win.document.activeElement, inspect(x.id));
  assert.equal(inspect(x.id).getAttribute('aria-pressed'), 'true');
  const detail = q('#depth-formation-detail');
  assert.match(detail.textContent, /待定/);
  assert.match(detail.textContent, /Casey[\s\S]*Parker/);
  assert.doesNotMatch(detail.textContent, /Robin/);
  assert.equal(q('[data-depth-chart="edit"]'), null);
  assert.equal(q('[data-depth-chart="add"]'), null);
  showMode('table');
  assert.ok(q('table'));
  assert.equal(win.document.activeElement, q('[data-mode="table"]'));
  showMode('field');
  state.id = 'kickoff';
  view.refresh();
  const kickoff = state.data.depthChart.groups.find(group => group.id === state.id);
  assert.ok(kickoff.slots.every(slot => inspect(slot.id)));
  assert.equal(inspect(x.id), null);
  assert.doesNotMatch(q('#depth-formation-detail').textContent, /Casey|Parker/);
  assert.equal(state.writes, 0);
});

test('swapping a backup in from the field updates the same role on both the field and the table', t => {
  const { state, view, q, click, showMode, submit, slots } = setup(t);
  const x = slots.find(slot => slot.label === 'X');
  const suffix = `[data-slot="${x.id}"]`;
  x.playerIds = ['p0', 'p1'];
  view.refresh();
  click('inspect', suffix);
  click('edit', suffix);
  click('promote');
  submit();
  const marker = q(`button[data-depth-chart="inspect"]${suffix}`);
  assert.equal(marker.getAttribute('aria-pressed'), 'true');
  assert.match(marker.textContent, /Casey/);
  assert.match(q('#depth-formation-detail').textContent, /Casey[\s\S]*Robin/);
  showMode('table');
  const row = q(`[data-depth-chart="edit"]${suffix}`).closest('tr');
  assert.match(row.querySelector('.depth-starter').textContent, /Casey/);
  assert.match(row.querySelector('.depth-backups').textContent, /Robin/);
  assert.equal(state.writes, 1);
});

test('a player can find all of their assignments and retain their selection across units', t => {
  const { win, state, view, q, slots } = setup(t);
  const [qb, h, x] = slots;
  qb.playerIds = ['p0', null, 'p2'];
  h.playerIds = ['p2'];
  x.playerIds = ['p1', 'p2'];
  state.editable = false;
  view.refresh();
  const rankAt = slot => q(`[data-depth-chart="inspect"][data-slot="${slot.id}"]`).getAttribute('data-formation-rank');
  const findPlayer = playerId => {
    const picker = q('[data-formation-player]');
    picker.focus();
    picker.value = playerId;
    picker.dispatchEvent(new win.Event('change', { bubbles: true }));
    assert.equal(win.document.activeElement, q('[data-formation-player]'));
  };
  findPlayer('p2');
  assert.deepEqual([rankAt(qb), rankAt(h), rankAt(x)], ['2', '0', '1']);
  const shownAt = slot => q(`[data-depth-chart="inspect"][data-slot="${slot.id}"] .df-name`).textContent;
  assert.ok([qb, h, x].every(slot => shownAt(slot).includes('Parker')));
  assert.match(q('#depth-formation-detail').textContent, /Robin[\s\S]*Parker/);
  assert.equal(win.document.querySelectorAll('[data-formation-rank]').length, 3);
  assert.match(q('[data-formation-results]').textContent, /Parker.*3/);
  state.id = '4-2-5';
  view.refresh();
  assert.equal(q('[data-formation-player]').value, 'p2');
  assert.equal(q('[data-formation-rank]'), null);
  assert.match(q('[data-formation-results]').textContent, /Parker.*没有/);
  state.id = 'spread';
  view.refresh();
  assert.equal(rankAt(qb), '2');
  findPlayer('');
  assert.match(shownAt(qb), /Robin/);
  assert.equal(q('[data-formation-rank]'), null);
  assert.equal(win.document.querySelectorAll('button[data-depth-chart="inspect"]').length, slots.length);
  assert.equal(state.writes, 0);
});
