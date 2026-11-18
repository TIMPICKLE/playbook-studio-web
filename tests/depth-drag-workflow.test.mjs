import test from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { planDepthPlayerMove, validateDepthChart, DEPTH_LIMITS } from '../web/depth-model.js';
import { createDepthChartView } from '../web/depth-chart.js';

const fixture = () => ({ id: 'g', unit: 'offense', name: 'Practice', templateId: 'spread', notes: '', slots: [
  { id: 'qb', label: 'QB', templateRole: 'QB', playerIds: ['p0', 'p1', 'p2'] },
  { id: 'x', label: 'X', templateRole: 'X', playerIds: ['p3'] },
  { id: 'y', label: 'Y', templateRole: 'Y', playerIds: [] },
] });
const ids = new Set(Array.from({ length: 20 }, (_, i) => `p${i}`));

test('a cross-position starter drop leaves a vacancy and preserves the displaced starter as backup', () => {
  const group = fixture(), before = structuredClone(group);
  const plan = planDepthPlayerMove(group, ids, { slotId: 'qb', index: 0, playerId: 'p0' }, { slotId: 'x', index: 0 });
  assert.deepEqual(group, before, 'planning never mutates data');
  assert.deepEqual(plan.changes, [
    { id: 'qb', before: ['p0', 'p1', 'p2'], after: [null, 'p1', 'p2'] },
    { id: 'x', before: ['p3'], after: ['p0', 'p3'] },
  ]);
});

test('reordering an assigned player and adding a backup to an empty position retain explicit rank semantics', () => {
  const group = fixture();
  assert.deepEqual(planDepthPlayerMove(group, ids, { slotId: 'qb', index: 2, playerId: 'p2' }, { slotId: 'qb', index: 0 }).changes[0].after, ['p2', 'p0', 'p1']);
  assert.deepEqual(planDepthPlayerMove(group, ids, { playerId: 'p4' }, { slotId: 'y', index: 1 }).changes[0].after, [null, 'p4']);
  assert.deepEqual(planDepthPlayerMove(group, ids, { playerId: 'p1' }, { slotId: 'qb', index: 0 }).changes[0].after, ['p1', 'p0', 'p2']);
  assert.deepEqual(planDepthPlayerMove(group, ids, { slotId: 'qb', index: 1, playerId: 'p1' }, { slotId: 'qb', index: 1 }).changes, []);
});

test('stale or missing sources, duplicate starters and full destination ranks are rejected without data changes', () => {
  const group = fixture(), before = JSON.stringify(group);
  assert.equal(planDepthPlayerMove(group, ids, { slotId: 'qb', index: 1, playerId: 'p2' }, { slotId: 'x', index: 0 }).error, 'changedRetry');
  assert.equal(planDepthPlayerMove(group, ids, { playerId: 'gone' }, { slotId: 'x', index: 0 }).error, 'changedRetry');
  group.slots[2].playerIds = ['p1']; // A cross-trained reserve is starting elsewhere.
  assert.equal(planDepthPlayerMove(group, ids, { slotId: 'qb', index: 1, playerId: 'p1' }, { slotId: 'x', index: 0 }).error, 'starterTaken');
  group.slots[2].playerIds = [];
  assert.equal(JSON.stringify(group), before);
  group.slots[1].playerIds = Array.from({ length: DEPTH_LIMITS.ranks }, (_, i) => `p${i + 3}`);
  assert.equal(planDepthPlayerMove(group, ids, { slotId: 'qb', index: 1, playerId: 'p1' }, { slotId: 'x', index: 1 }).error, 'rankLimit');
  group.slots[1].playerIds = ['p3', 'p1'];
  assert.equal(planDepthPlayerMove(group, ids, { slotId: 'qb', index: 1, playerId: 'p1' }, { slotId: 'x', index: 1 }).error, 'duplicate');
});

function host(t) {
  const win = new Window(); t.after(() => win.happyDOM.abort());
  const root = win.document.body, group = fixture();
  const state = { book: 'a', groupId: 'g', editable: true, writes: 0, fail: false,
    data: { roster: [...ids].map(id => ({ id, name: id, number: '', position: '' })), depthChart: { groups: [group] } } };
  const view = createDepthChartView({ root, getData: () => state.data, getWorkspaceId: () => state.book,
    getSelectedId: () => state.groupId, canEdit: () => state.editable,
    commit(mutate) { if (state.fail) return false; mutate(state.data); state.writes++; } });
  view.refresh();
  const q = selector => { const node = root.querySelector(selector); assert.ok(node, selector); return node; };
  const click = selector => q(selector).click();
  const choose = id => { q('[data-formation-player]').value = id; q('[data-formation-player]').dispatchEvent(new win.Event('change', { bubbles: true })); };
  const transfer = new win.DataTransfer();
  const dragEvent = type => { const event = new win.Event(type, { bubbles: true, cancelable: true }); Object.defineProperty(event, 'dataTransfer', { value: transfer }); return event; };
  const begin = selector => q(selector).dispatchEvent(dragEvent('dragstart'));
  const drop = selector => { q(selector).dispatchEvent(dragEvent('dragover')); q(selector).dispatchEvent(dragEvent('drop')); };
  return { win, root, group, state, view, q, click, choose, begin, drop, dragEvent };
}

test('desktop formation drag transfers both positions in one save and one undo restores both', t => {
  const f = host(t), before = structuredClone(f.group.slots);
  f.begin('[data-depth-chart=inspect][data-depth-source=p0]');
  assert.equal(f.state.writes, 0, 'drag start is only a preview');
  f.drop('[data-depth-drop-slot=x][data-depth-chart=inspect]');
  assert.deepEqual(f.group.slots[0].playerIds, [null, 'p1', 'p2']);
  assert.deepEqual(f.group.slots[1].playerIds, ['p0', 'p3']);
  assert.equal(f.state.writes, 1);
  f.q('[data-depth-drop-slot=x]').dispatchEvent(f.dragEvent('drop'));
  assert.equal(f.state.writes, 1, 'a late duplicate drop cannot repeat the transaction');
  f.click('[data-depth-chart=undo-ranks]');
  assert.deepEqual(f.group.slots, before);
  assert.equal(f.state.writes, 2);
});

test('table drags reorder backups and roster drag assigns an unbound player without a dialog', t => {
  const f = host(t);
  f.click('[data-mode=table]');
  f.begin('[data-depth-source=p2][data-source-slot=qb]');
  f.drop('[data-depth-drop-slot=qb][data-depth-drop-index="1"]');
  assert.deepEqual(f.group.slots[0].playerIds, ['p0', 'p2', 'p1']);
  f.choose('p4');
  f.begin('[data-depth-chart=pick-player]');
  f.drop('[data-depth-drop-slot=y][data-depth-drop-index="1"]');
  assert.deepEqual(f.group.slots[2].playerIds, [null, 'p4']);
  assert.equal(f.q('dialog').open, false);
  assert.equal(f.state.writes, 2);
});

test('dragging a filtered backup marker moves the visible backup, never the hidden starter', t => {
  const f = host(t);
  f.choose('p1');
  const marker = f.q('[data-depth-chart=inspect][data-slot=qb]');
  assert.equal(marker.dataset.depthSource, 'p1'); assert.equal(marker.dataset.sourceIndex, '1');
  f.begin('[data-depth-chart=inspect][data-slot=qb]');
  f.drop('[data-depth-drop-slot=x][data-depth-chart=inspect]');
  assert.deepEqual(f.group.slots[0].playerIds, ['p0', 'p2']);
  assert.deepEqual(f.group.slots[1].playerIds, ['p1', 'p3']);
});

test('explicit pick and place supplies a touch and keyboard button path, with cancel and Escape preserving data', t => {
  const f = host(t), before = JSON.stringify(f.group);
  f.choose('p4'); f.click('[data-depth-chart=pick-player]');
  assert.match(f.q('.depth-status').textContent, /p4/);
  f.click('[data-depth-chart=cancel-assignment]');
  assert.equal(JSON.stringify(f.group), before);
  f.click('[data-depth-chart=pick-player]');
  f.root.dispatchEvent(new f.win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  assert.equal(f.root.classList.contains('depth-assigning'), false);
  f.click('[data-depth-chart=pick-player]');
  f.click('[data-depth-chart=inspect][data-slot=y]');
  assert.deepEqual(f.group.slots[2].playerIds, ['p4']);
  f.click('[data-depth-chart=undo-ranks]');
  f.click('[data-mode=table]');
  f.click('[data-depth-chart=pick-player]');
  f.click('[data-depth-chart=place-player][data-slot=y][data-index="1"]');
  assert.deepEqual(f.group.slots[2].playerIds, [null, 'p4']);
  assert.equal(f.state.writes, 3);
});

test('canceled drags, changed lineups, different workspaces and revoked permissions cannot write', t => {
  const f = host(t), source = '[data-depth-chart=inspect][data-depth-source=p0]', target = '[data-depth-drop-slot=x][data-depth-chart=inspect]';
  f.begin(source); f.root.dispatchEvent(f.dragEvent('dragend')); f.drop(target);
  assert.equal(f.state.writes, 0);
  f.begin(source); f.root.dispatchEvent(new f.win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); f.drop(target);
  assert.equal(f.state.writes, 0, 'Escape invalidates the pending drag before any late drop');
  f.begin(source); f.group.slots[1].playerIds = ['p5']; f.drop(target);
  assert.equal(f.state.writes, 0); assert.deepEqual(f.group.slots[1].playerIds, ['p5']);
  f.begin(source); f.state.book = 'b'; f.drop(target);
  assert.equal(f.state.writes, 0);
  f.begin(source); f.state.editable = false; f.drop(target);
  assert.equal(f.state.writes, 0);
  assert.equal(f.root.querySelector('[draggable=true]'), null);
});

test('a failed drop preserves the source and retries successfully; later changes prevent undo overwrite', t => {
  const f = host(t), before = structuredClone(f.group.slots);
  f.state.fail = true;
  f.begin('[data-depth-chart=inspect][data-depth-source=p0]');
  f.drop('[data-depth-drop-slot=x][data-depth-chart=inspect]');
  assert.deepEqual(f.group.slots, before); assert.match(f.q('.depth-status').textContent, /保存/);
  f.state.fail = false;
  f.begin('[data-depth-chart=inspect][data-depth-source=p0]');
  f.drop('[data-depth-drop-slot=x][data-depth-chart=inspect]');
  f.group.slots[0].playerIds = ['p6', 'p1', 'p2'];
  f.click('[data-depth-chart=undo-ranks]');
  assert.deepEqual(f.group.slots[0].playerIds, ['p6', 'p1', 'p2']);
  assert.deepEqual(f.group.slots[1].playerIds, ['p0', 'p3']);
  assert.equal(f.state.writes, 1);
});

test('directory starter transfer matches a formation drag with one commit and one undo', t => {
  const f = host(t), before = structuredClone(f.group.slots);
  f.choose('p0'); f.click('[data-depth-chart=pick-player]');
  f.click('[data-depth-chart=inspect][data-slot=x]');
  assert.deepEqual(f.group.slots.map(slot => slot.playerIds), [[null, 'p1', 'p2'], ['p0', 'p3'], []]);
  assert.equal(f.state.writes, 1);
  f.click('[data-depth-chart=undo-ranks]');
  assert.deepEqual(f.group.slots, before);
  assert.equal(f.state.writes, 2);
  f.choose('p4'); f.click('[data-depth-chart=pick-player]');
  f.state.book = 'other'; f.view.refresh();
  assert.equal(f.root.classList.contains('depth-assigning'), false);
  f.click('[data-depth-chart=inspect][data-slot=x]');
  assert.equal(f.state.writes, 2);
});

test('filling an open starter preserves every reserve rank through save, reload and undo', t => {
  const f = host(t);
  const reserves = Array.from({ length: DEPTH_LIMITS.ranks - 1 }, (_, i) => `p${i + 5}`);
  f.group.slots[0].playerIds = [null, ...reserves];
  f.view.refresh(); f.choose('p4'); f.click('[data-depth-chart=pick-player]');
  f.click('[data-depth-chart=inspect][data-slot=qb]');
  const persisted = JSON.stringify(f.state.data.depthChart);
  f.state.data.depthChart = validateDepthChart(JSON.parse(persisted), ids);
  f.view.refresh();
  assert.deepEqual(f.state.data.depthChart.groups[0].slots[0].playerIds, ['p4', ...reserves]);
  f.click('[data-depth-chart=undo-ranks]');
  assert.deepEqual(f.state.data.depthChart.groups[0].slots[0].playerIds, [null, ...reserves]);
  assert.equal(f.state.writes, 2);
});

test('moving a rank using buttons identifies the exact reserve assignment and fills its open target', t => {
  const f = host(t);
  f.group.slots[1].playerIds = ['p3', null, 'p5'];
  f.group.slots[2].playerIds = [null, 'p1']; // The same reserve trains at two positions.
  const before = structuredClone(f.group.slots);
  f.click('[data-mode=table]');
  f.click('[data-depth-chart=pick-rank][data-source-slot=qb][data-source-index="1"]');
  assert.equal(f.win.document.activeElement.dataset.depthChart, 'place-player');
  f.click('[data-depth-chart=place-player][data-slot=x][data-index="1"]');
  assert.deepEqual(f.group.slots.map(slot => slot.playerIds), [['p0', 'p2'], ['p3', 'p1', 'p5'], [null, 'p1']]);
  f.click('[data-depth-chart=undo-ranks]');
  assert.deepEqual(f.group.slots, before);
  assert.equal(f.state.writes, 2);
});

test('directory assignments preserve cross-training and use an existing destination reserve when transferring a starter', () => {
  const group = fixture();
  const backupPlan = planDepthPlayerMove(group, ids, { playerId: 'p0' }, { slotId: 'x', index: 1 });
  assert.deepEqual(backupPlan.changes, [{ id: 'x', before: ['p3'], after: ['p3', 'p0'] }]);
  group.slots[1].playerIds = backupPlan.changes[0].after;
  const move = target => planDepthPlayerMove(group, ids, target, { slotId: 'x', index: 0 });
  const transfer = move({ playerId: 'p0' });
  assert.deepEqual(transfer, move({ playerId: 'p0', slotId: 'qb', index: 0 }));
  assert.deepEqual(transfer.changes.map(change => change.after), [[null, 'p1', 'p2'], ['p0', 'p3']]);
});

test('rank insertion stops at an open rank and never fills an empty starter when adding a reserve', () => {
  const group = fixture();
  group.slots[0].playerIds = ['p0', 'p1', null, 'p2'];
  const into = (index, playerId) => planDepthPlayerMove(group, ids, { playerId }, { slotId: 'qb', index });
  assert.deepEqual(into(0, 'p4').changes[0].after, ['p4', 'p0', 'p1', 'p2']);
  assert.deepEqual(into(2, 'p0').changes[0].after, [null, 'p1', 'p0', 'p2']);
  group.slots[0].playerIds = [null, ...Array.from({ length: DEPTH_LIMITS.ranks - 1 }, (_, i) => `p${i + 5}`)];
  assert.equal(into(DEPTH_LIMITS.ranks, 'p4').error, 'rankLimit');
  group.slots[0].playerIds[1] = null;
  const ranks = into(DEPTH_LIMITS.ranks, 'p4').changes[0].after;
  assert.equal(ranks[0], null);
  assert.equal(ranks.length, DEPTH_LIMITS.ranks);
  assert.equal(ranks.at(-1), 'p4');
});
