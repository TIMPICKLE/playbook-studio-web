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
  const click = (action, suffix = '') => q(`[data-depth-chart="${action}"]${suffix}`).click();
  const choose = (index, id) => {
    const select = q(`[data-rank="${index}"]`);
    select.value = id;
    select.dispatchEvent(new win.Event('change', { bubbles: true }));
  };
  const submit = () => q('form').dispatchEvent(new win.Event('submit', { bubbles: true, cancelable: true }));
  view.refresh();
  return { state, win, view, q, click, choose, submit, slots: state.data.depthChart.groups[0].slots };
}

test('coaches rank reserves, swap in a starter, and intentionally leave ranks open', t => {
  const { state, q, click, choose, submit, slots } = setup(t);
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
  const { q, click, choose, submit, slots, view } = setup(t);
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
  const { win, state, q, click, choose, submit, slots } = setup(t);
  click('add');
  q('[name="label"]').value = ' qb ';
  submit();
  assert.equal(state.writes, 0);
  q('[name="label"]').value = 'Slot <Left>';
  choose(0, 'p1');
  submit();
  const slot = slots.at(-1);
  assert.equal(q('tbody tr:last-child th').textContent, 'Slot <Left>');
  click('edit', `[data-slot="${slot.id}"]`);
  q('[name="label"]').value = 'Slot right';
  submit();
  assert.equal(slot.label, 'Slot right');
  click('edit', `[data-slot="${slot.id}"]`);
  win.confirm = () => false;
  click('remove');
  assert.equal(state.data.depthChart.groups[0].slots.includes(slot), true);
  win.confirm = () => true;
  click('remove');
  assert.equal(state.data.depthChart.groups[0].slots.includes(slot), false);
  assert.equal(state.data.roster.length, 3);
});

test('conflicting position, active book or permissions changes leave the draft intact', t => {
  const { state, view, q, click, choose, submit, slots } = setup(t);
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
  const { state, view, q, click, choose, submit, slots } = setup(t);
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
  const { state, view, q, click, choose, submit, slots } = setup(t);
  slots[0].playerIds = ['p0', 'p1'];
  click('view');
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
  click('view');
  assert.ok(q('.depth-backups'));
  assert.equal(state.writes, 1);
});
