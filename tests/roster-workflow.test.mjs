import test from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { createRosterView } from '../web/roster.js';
import { createDepthChartView } from '../web/depth-chart.js';
import { defaultDepthChart } from '../web/depth-model.js';
import { starterWorkspace } from '../web/model.js';

function rosterHost(t) {
  const win = new Window();
  t.after(() => win.happyDOM.abort());
  const root = win.document.createElement('div'); root.hidden = true; win.document.body.append(root);
  const dataA = starterWorkspace(), dataB = starterWorkspace();
  const state = { data: dataA, book: 'a', editable: true, writes: 0, scrolls: [], fail: false };
  win.scrollTo = options => state.scrolls.push(options.top);
  const view = createRosterView({ root, getData: () => state.data, getWorkspaceId: () => state.book,
    canEdit: () => state.editable, commit(mutate) { if (state.fail) return false; mutate(state.data); state.writes++; } });
  const q = selector => root.querySelector(selector);
  const click = selector => { assert.ok(q(selector), selector); q(selector).click(); };
  const change = (selector, value) => { q(selector).value = value; q(selector).dispatchEvent(new win.Event('change', { bubbles: true })); };
  view.show(true);
  return { win, root, q, click, change, view, state, dataA, dataB };
}

test('returning to the roster restores the active tab, search and scroll without saving UI state into the playbook', async t => {
  const f = rosterHost(t), original = JSON.stringify(f.state.data);
  f.click('[data-roster-tab=directory]');
  f.q('[type=search]').value = f.state.data.roster[0].name;
  f.q('[type=search]').dispatchEvent(new f.win.Event('input', { bubbles: true }));
  Object.defineProperty(f.win, 'scrollY', { configurable: true, value: 427 });
  f.view.show(false); f.view.show(true);
  assert.equal(f.q('[data-roster-tab=directory]').getAttribute('aria-selected'), 'true');
  assert.equal(f.q('[type=search]').value, f.state.data.roster[0].name);
  assert.equal(f.q('.roster-results tbody').children.length, 1);
  await new Promise(resolve => f.win.requestAnimationFrame(resolve));
  assert.equal(f.state.scrolls.at(-1), 427);
  assert.equal(f.state.writes, 0); assert.equal(JSON.stringify(f.state.data), original);
});

test('personnel, view and inspected role survive a module round trip and remain isolated by playbook', t => {
  const f = rosterHost(t);
  f.click('[data-personnel-unit=defense]');
  const defense = f.q('[data-personnel-group]').value;
  f.click('[data-depth-chart=mode][data-mode=table]');
  f.view.show(false); f.state.data = f.dataB; f.state.book = 'b'; f.view.show(true);
  assert.equal(f.q('[data-personnel-unit=offense]').getAttribute('aria-pressed'), 'true');
  assert.equal(f.q('[data-mode=field]').getAttribute('aria-pressed'), 'true');
  f.click('[data-roster-tab=directory]');
  f.view.show(false); f.state.data = f.dataA; f.state.book = 'a'; f.view.show(true);
  assert.equal(f.q('[data-personnel-unit=defense]').getAttribute('aria-pressed'), 'true');
  assert.equal(f.q('[data-personnel-group]').value, defense);
  assert.equal(f.q('[data-mode=table]').getAttribute('aria-pressed'), 'true');
  assert.equal(f.q('[data-roster-tab=depth]').getAttribute('aria-selected'), 'true');
  f.click('[data-depth-chart=mode][data-mode=field]');
  const marker = f.root.querySelectorAll('[data-depth-chart=inspect]')[1];
  const slotId = marker.dataset.slot; marker.click();
  const playerId = f.state.data.roster[0].id;
  f.change('[data-formation-player]', playerId);
  f.view.show(false); f.view.show(true);
  assert.equal(f.q('[data-formation-player]').value, playerId);
  // Filtering chooses a matching role when one exists. Inspection then remains stable.
  f.q(`[data-depth-chart=inspect][data-slot="${slotId}"]`).click();
  f.view.show(false); f.view.show(true);
  assert.equal(f.q(`[data-depth-chart=inspect][data-slot="${slotId}"]`).getAttribute('aria-pressed'), 'true');
});

test('deleted saved groups, roles and roster filters fall back safely on return', t => {
  const f = rosterHost(t);
  const selected = f.q('[data-personnel-group]').value;
  f.change('[data-formation-player]', f.state.data.roster[0].id);
  f.view.show(false);
  f.state.data.depthChart.groups = f.state.data.depthChart.groups.filter(group => group.id !== selected);
  f.state.data.roster.shift();
  f.view.show(true);
  assert.notEqual(f.q('[data-personnel-group]').value, selected);
  assert.equal(f.q('[data-formation-player]').value, '');
  assert.ok(f.q('[data-depth-chart=inspect][aria-pressed=true]'));
  assert.equal(f.state.writes, 0);
});

test('player removal uses the existing native dialog and cancelling confirmation preserves the edited draft', t => {
  const f = rosterHost(t);
  f.win.confirm = () => { throw new Error('browser confirm must not be used'); };
  f.click('[data-roster-tab=directory]'); f.click('[data-roster=edit]');
  const name = f.q('.roster-dialog [name=name]'); name.value = 'Updated draft';
  f.click('[data-roster=remove]');
  assert.equal(f.root.querySelectorAll('dialog[open]').length, 1);
  assert.equal(f.q('.roster-dialog [type=submit]').disabled, true);
  f.q('.roster-page > .roster-dialog').dispatchEvent(new f.win.Event('cancel', { cancelable: true }));
  assert.equal(f.q('.roster-page > .roster-dialog').open, true);
  assert.equal(f.q('.roster-dialog [name=name]').value, 'Updated draft');
  assert.equal(f.q('.roster-dialog [type=submit]').disabled, false);
  f.click('[data-roster=remove]'); f.state.editable = false; f.view.refresh();
  assert.equal(f.q('[data-roster=confirm-remove]').disabled, true);
  assert.equal(f.state.writes, 0);
});

test('failed player saves preserve the form, retry once and suppress a second submit after success', t => {
  const f = rosterHost(t), before = structuredClone(f.state.data.roster);
  f.click('[data-roster-tab=directory]'); f.click('[data-roster=add]');
  f.q('.roster-dialog [name=name]').value = 'Retry player';
  f.q('.roster-dialog [name=number]').value = '87';
  f.state.fail = true;
  f.click('.roster-page > .roster-dialog [type=submit]');
  assert.deepEqual(f.state.data.roster, before);
  assert.equal(f.view.isEditing(), true);
  assert.equal(f.q('.roster-dialog [name=name]').value, 'Retry player');
  assert.match(f.q('.roster-dialog [role=alert]').textContent, /保存/);
  f.state.fail = false;
  f.click('.roster-page > .roster-dialog [type=submit]');
  assert.equal(f.state.data.roster.filter(player => player.name === 'Retry player').length, 1);
  f.q('.roster-page > .roster-dialog form').dispatchEvent(new f.win.Event('submit', { bubbles: true, cancelable: true }));
  assert.equal(f.state.writes, 1);
  assert.equal(f.win.document.activeElement.dataset.id, f.state.data.roster.at(-1).id);
});

function depthHost(t) {
  const win = new Window(); t.after(() => win.happyDOM.abort());
  const root = win.document.body;
  const depthChart = defaultDepthChart();
  const state = { book: 'a', groupId: depthChart.groups[0].id, editable: true, writes: 0, fail: false,
    data: { roster: ['A', 'B', 'C', 'D'].map((name, i) => ({ id: `p${i}`, name, number: String(i), position: 'QB' })), depthChart } };
  const slot = depthChart.groups[0].slots[0]; slot.playerIds = ['p0', 'p1', 'p2'];
  const view = createDepthChartView({ root, getData: () => state.data, getWorkspaceId: () => state.book,
    getSelectedId: () => state.groupId, canEdit: () => state.editable,
    commit(mutate) { if (state.fail) return false; mutate(state.data); state.writes++; } });
  const q = selector => root.querySelector(selector), click = selector => q(selector).click();
  view.refresh();
  return { win, root, q, click, view, state, slot };
}

test('coaches promote and reorder backups without opening a dialog and can undo the latest adjustment', t => {
  const f = depthHost(t);
  f.click('[data-depth-chart=quick-promote][data-player=p1]');
  assert.deepEqual(f.slot.playerIds, ['p1', 'p0', 'p2']);
  assert.equal(f.q('dialog').open, false);
  assert.match(f.q('.depth-status').textContent, /更新/);
  assert.equal(f.q('.depth-status').closest('[data-depth-feedback]')?.dataset.depthFeedback, f.slot.id);
  f.click('[data-depth-chart=undo-ranks]');
  assert.deepEqual(f.slot.playerIds, ['p0', 'p1', 'p2']);
  f.click('[data-depth-chart=mode][data-mode=table]');
  f.click('[data-depth-chart=quick-up][data-player=p2]');
  assert.deepEqual(f.slot.playerIds, ['p0', 'p2', 'p1']);
  f.click('[data-depth-chart=quick-down][data-player=p2]');
  assert.deepEqual(f.slot.playerIds, ['p0', 'p1', 'p2']);
  assert.equal(f.state.writes, 4);
});

test('quick lineup actions reject stale rows, duplicate starters, revoked permissions and failed storage', t => {
  const f = depthHost(t);
  f.state.data.depthChart.groups[0].slots[1].playerIds = ['p1'];
  f.click('[data-depth-chart=quick-promote][data-player=p1]');
  assert.equal(f.state.writes, 0); assert.match(f.q('.depth-status').textContent, /首发/);
  const stale = f.q('[data-depth-chart=quick-promote][data-player=p2]');
  f.slot.playerIds = ['p0', 'p2', 'p1']; stale.click();
  assert.equal(f.state.writes, 0); assert.match(f.q('.depth-status').textContent, /变化/);
  f.state.editable = false;
  f.click('[data-depth-chart=quick-promote][data-player=p2]');
  assert.equal(f.state.writes, 0);
  f.state.editable = true; f.state.fail = true; f.view.refresh();
  f.click('[data-depth-chart=quick-promote][data-player=p2]');
  assert.equal(f.state.writes, 0); assert.match(f.q('.depth-status').textContent, /未能保存/);
});

test('undo never overwrites a later remote lineup edit or reintroduces a deleted player', t => {
  const f = depthHost(t);
  f.click('[data-depth-chart=quick-promote][data-player=p1]');
  f.slot.playerIds = ['p3', 'p0', 'p2'];
  f.click('[data-depth-chart=undo-ranks]');
  assert.deepEqual(f.slot.playerIds, ['p3', 'p0', 'p2']); assert.equal(f.state.writes, 1);
  f.click('[data-depth-chart=quick-promote][data-player=p0]');
  f.state.data.roster = f.state.data.roster.filter(player => player.id !== 'p3');
  f.click('[data-depth-chart=undo-ranks]');
  assert.deepEqual(f.slot.playerIds, ['p0', 'p3', 'p2']); assert.equal(f.state.writes, 2);
});

test('position removal confirmation preserves ranks on cancel and rechecks remote changes before deletion', t => {
  const f = depthHost(t);
  f.win.confirm = () => { throw new Error('browser confirm must not be used'); };
  f.click('[data-depth-chart=edit]');
  f.click('[data-depth-chart=promote][data-index="1"]');
  f.click('[data-depth-chart=remove]');
  assert.equal(f.q('[type=submit]').disabled, true);
  f.q('dialog').dispatchEvent(new f.win.Event('cancel', { cancelable: true }));
  assert.equal(f.q('dialog').open, true);
  assert.equal(f.q('[data-rank="0"]').value, 'p1');
  f.click('[data-depth-chart=remove]');
  f.slot.playerIds = ['p3'];
  f.click('[data-depth-chart=confirm-remove]');
  assert.equal(f.state.writes, 0); assert.equal(f.q('dialog').open, true);
  assert.match(f.q('[role=alert]').textContent, /变更/);
});

test('failed position saves preserve chosen ranks and a later retry commits the exact same draft', t => {
  const f = depthHost(t), before = [...f.slot.playerIds];
  f.click('[data-depth-chart=edit]');
  f.q('[data-rank="1"]').value = 'p3';
  f.q('[data-rank="1"]').dispatchEvent(new f.win.Event('change', { bubbles: true }));
  f.state.fail = true;
  f.click('[type=submit]');
  assert.deepEqual(f.slot.playerIds, before);
  assert.equal(f.q('dialog').open, true);
  assert.equal(f.q('[data-rank="1"]').value, 'p3');
  f.state.fail = false;
  f.click('[type=submit]');
  assert.deepEqual(f.slot.playerIds, ['p0', 'p3', 'p2']);
  assert.equal(f.state.writes, 1);
});
