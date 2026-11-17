import test from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { starterWorkspace } from '../web/model.js';
import { createPersonnelGroups } from '../web/personnel-groups.js';

function setup(t) {
  const win = new Window();
  t.after(() => win.happyDOM.abort());
  const root = win.document.body, state = { book: 'one', editable: true, data: starterWorkspace(), selected: [], writes: 0, fail: false };
  const view = createPersonnelGroups({
    root, getData: () => state.data, getWorkspaceId: () => state.book, canEdit: () => state.editable,
    commit(mutate) { if (state.fail) return false; mutate(state.data); state.writes++; }, onSelect(id) { state.selected.push(id); }
  });
  const q = selector => root.querySelector(selector);
  const action = key => q(`[data-personnel-action="${key}"]`).click();
  const save = () => q('form').dispatchEvent(new win.Event('submit', { bubbles: true, cancelable: true }));
  const selectGroup = id => {
    q('[data-personnel-group]').value = id;
    q('[data-personnel-group]').dispatchEvent(new win.Event('change', { bubbles: true }));
  };
  return { state, view, q, action, save, selectGroup };
}

test('a coach switches units and copies an independent package with notes and depth assignments', t => {
  const { state, view, q, action, save, selectGroup } = setup(t);
  const groups = state.data.depthChart.groups;
  const source = groups.find(group => group.id === 'bunch');
  source.slots[0].playerIds = [state.data.roster[1].id, state.data.roster[0].id];
  selectGroup('bunch');
  q('[data-personnel-unit=special]').click();
  selectGroup('field-goal');
  q('[data-personnel-unit=offense]').click();
  assert.equal(view.getSelectedId(), 'bunch');
  action('copy');
  q('[name=name]').value = 'Fake punt';
  q('[name=unit]').value = 'special';
  q('[name=notes]').value = "Use inside the five.\nCheck X's sub.";
  save();
  const copy = groups.find(group => group.id === state.selected.at(-1));
  assert.equal(copy.name, 'Fake punt');
  assert.equal(copy.unit, 'special');
  assert.equal(q('[aria-pressed=true]').dataset.personnelUnit, 'special');
  assert.equal(q('.personnel-note').textContent.includes('Check X'), true);
  assert.deepEqual(copy.slots[0].playerIds, source.slots[0].playerIds);
  assert.notEqual(copy.slots[0].id, source.slots[0].id);
  copy.slots[0].playerIds.reverse();
  assert.notDeepEqual(source.slots[0].playerIds, copy.slots[0].playerIds);
  assert.equal(state.writes, 1);
});

test('custom groups, duplicate names, stale deletes and read-only permissions are handled in the group dialog', t => {
  const { state, view, q, action, save } = setup(t);
  q('[data-personnel-unit=defense]').click();
  action('new');
  q('[name=name]').value = '4-2-5';
  save();
  assert.equal(view.isEditing(), true);
  assert.equal(state.writes, 0);
  q('[name=name]').value = 'Dime';
  q('[name=template]').value = '';
  save();
  const group = state.data.depthChart.groups.find(item => item.id === view.getSelectedId());
  assert.equal(group.unit, 'defense');
  assert.deepEqual(group.slots, []);
  action('edit');
  q('[name=name]').value = 'Red zone';
  group.notes = 'External note';
  save();
  assert.equal(group.notes, 'External note');
  assert.equal(group.name, 'Red zone');
  action('remove');
  group.notes = 'Updated externally';
  save();
  assert.equal(view.isEditing(), true);
  assert.equal(state.writes, 2);
  action('cancel');
  action('remove');
  save();
  assert.equal(view.getSelectedId(), '4-2-5');
  assert.equal(state.writes, 3);
  action('edit');
  state.editable = false;
  view.refresh();
  assert.equal(q('[type=submit]').disabled, true);
  save();
  assert.equal(state.writes, 3);
  action('cancel');
  assert.equal(q('[data-personnel-action=new]'), null);
  assert.ok(q('[data-personnel-group]'));
});

test('changing playbooks keeps an open group draft from touching the new roster', t => {
  const { state, view, q, action, save } = setup(t);
  q('[data-personnel-unit=special]').click();
  action('new');
  q('[name=name]').value = 'Hands team';
  state.book = 'two';
  state.data = starterWorkspace();
  view.refresh();
  assert.equal(view.getSelectedId(), 'spread');
  assert.equal(q('[type=submit]').disabled, true);
  save();
  assert.equal(state.writes, 0);
  action('cancel');
  assert.equal(view.isEditing(), false);
  view.destroy();
  assert.equal(q('dialog'), null);
});

test('editing the field template preserves concurrent rank changes and prevents stale layout overwrites', t => {
  const { state, view, q, action, save } = setup(t);
  const group = state.data.depthChart.groups.find(item => item.id === 'spread');
  action('edit');
  assert.equal(q('[name=template]').value, 'spread');
  q('[name=template]').value = 'bunch';
  const ranks = [null, state.data.roster[0].id];
  group.slots[0].playerIds = ranks;
  save();
  assert.equal(group.templateId, 'bunch');
  assert.equal(group.slots[0].templateRole, 'QB');
  assert.deepEqual(group.slots[0].playerIds, ranks);
  action('edit');
  q('[name=template]').value = '';
  group.templateId = 'spread';
  save();
  assert.equal(group.templateId, 'spread');
  assert.equal(state.writes, 1);
  assert.equal(view.isEditing(), true);
});

test('flag defaults recommend five-player personnel templates without replacing existing tackle groups', t => {
  const { state, view, q, action, save } = setup(t);
  const legacy = structuredClone(state.data.depthChart.groups);
  state.data.settings.league = 5;
  view.refresh();
  assert.match(q('.personnel-note').textContent, /Flag 5/);
  action('new');
  assert.equal(q('[name=template]').value, 'flag5-offense');
  q('[name=name]').value = 'Flag game day';
  save();
  const offense = state.data.depthChart.groups.find(group => group.id === view.getSelectedId());
  assert.equal(offense.slots.length, 5);
  assert.equal(offense.templateId, 'flag5-offense');
  assert.deepEqual(state.data.depthChart.groups.slice(0, legacy.length), legacy);
  q('[data-personnel-unit=defense]').click();
  action('new');
  assert.equal(q('[name=template]').value, 'flag5-defense');
  q('[name=name]').value = 'Flag defense';
  save();
  const defense = state.data.depthChart.groups.find(group => group.id === view.getSelectedId());
  assert.deepEqual(defense.slots.map(slot => slot.label), ['R', 'LCB', 'RCB', 'S', 'DB']);
  assert.deepEqual(state.data.depthChart.groups.slice(0, legacy.length), legacy);
});

test('failed personnel copy retains the name, notes and destination and retries without duplicate creation', t => {
  const { state, view, q, action, save } = setup(t);
  const count = state.data.depthChart.groups.length;
  action('copy');
  q('[name=name]').value = 'Game-day copy';
  q('[name=notes]').value = 'Keep this draft';
  q('[name=unit]').value = 'special';
  state.fail = true; save();
  assert.equal(state.data.depthChart.groups.length, count);
  assert.equal(view.isEditing(), true);
  assert.equal(q('[name=name]').value, 'Game-day copy');
  assert.equal(q('[name=notes]').value, 'Keep this draft');
  assert.equal(q('[name=unit]').value, 'special');
  assert.ok(q('[role=alert]').textContent);
  state.fail = false; save();
  assert.equal(state.data.depthChart.groups.length, count + 1);
  assert.equal(state.data.depthChart.groups.at(-1).unit, 'special');
  assert.equal(state.writes, 1);
  assert.equal(view.isEditing(), false);
});
