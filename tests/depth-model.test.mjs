import test from 'node:test';
import assert from 'node:assert/strict';
import { clone, decodeWorkspace, encodeWorkspace, prepareWorkspaceAppend, starterWorkspace } from '../web/model.js';
import { clearDepthPlayer, copyDepthGroup, createDepthGroup, createDepthSlot, defaultDepthChart, DEPTH_LIMITS } from '../web/depth-model.js';
import { mergeWorkspaces } from '../web/sync.js';

const roundtrip = data => decodeWorkspace(encodeWorkspace(data));

test('old books get stable blank templates, and deleted groups stay deleted', () => {
  const old = starterWorkspace();
  delete old.depthChart;
  const chart = roundtrip(old).depthChart;
  assert.deepEqual(chart, roundtrip(old).depthChart);
  assert.equal(chart.groups.length, 8);
  assert.equal(chart.groups.filter(group => group.unit === 'special').length, 5);
  for (const group of chart.groups) {
    assert.equal(group.slots.length, 11);
    assert.ok(group.slots.every(slot => !slot.playerIds.length));
  }
  old.depthChart = { groups: [] };
  assert.deepEqual(roundtrip(old).depthChart, { groups: [] });
  const demo = starterWorkspace({ demoDepth: true });
  assert.deepEqual(roundtrip(demo), demo);
  const lineup = demo.depthChart.groups[0];
  const [starter, backup] = lineup.slots[0].playerIds;
  assert.ok(starter && backup && !lineup.slots.some(slot => slot.playerIds[0] === backup));
});

test('open starting spots, cross-training and cloned personnel packages retain rank and stable IDs', () => {
  const data = starterWorkspace(), [a, b] = data.roster;
  const group = createDepthGroup('', 'Two-minute', 'offense');
  const qb = createDepthSlot('QB'), x = createDepthSlot('X');
  group.notes = 'No huddle';
  group.slots.push(qb, x);
  qb.playerIds = [a.id, null, b.id];
  x.playerIds = [b.id, a.id];
  const copy = copyDepthGroup(group, 'Goal line');
  data.depthChart = { groups: [group, copy] };
  data.roster[0].name = 'Renamed';
  assert.deepEqual(roundtrip(data), data);
  assert.notEqual(copy.id, group.id);
  assert.notEqual(copy.slots[0].id, qb.id);
  copy.slots[0].playerIds.pop();
  assert.equal(qb.playerIds.length, 3);
  clearDepthPlayer(data.depthChart, a.id);
  data.roster.shift();
  assert.deepEqual(roundtrip(data), data);
  assert.deepEqual(qb.playerIds, [null, null, b.id]);
  assert.deepEqual(x.playerIds, [b.id, null]);
});

test('backup validation rejects ambiguous roles, duplicate starters, dangling assignments and excessive depth', () => {
  const original = starterWorkspace(), [a] = original.roster;
  const invalid = change => {
    const data = clone(original);
    change(data.depthChart.groups[0], data);
    assert.throws(() => roundtrip(data));
  };
  invalid(g => { g.slots[0].playerIds = [a.id]; g.slots[1].playerIds = [a.id]; });
  invalid(g => { g.slots[0].playerIds = [null, a.id, a.id]; });
  invalid(g => { g.slots[0].playerIds = [null, 'removed']; });
  invalid(g => { g.slots[0].playerIds = Array(DEPTH_LIMITS.ranks + 1).fill(null); });
  invalid(g => { g.slots[1].label = g.slots[0].label.toLowerCase(); });
  invalid((g, data) => { data.depthChart.groups.push(copyDepthGroup(g, g.name.toUpperCase())); });
  invalid(g => { g.name = ' '; });
});

test('append remaps roster links on plays, formations and lineup ranks, and keeps both named groups', () => {
  const target = starterWorkspace(), imported = starterWorkspace({ demoDepth: true });
  const athlete = imported.roster[0];
  const marker = imported.plays[0].players[0];
  marker.rosterId = athlete.id;
  marker.name = athlete.name;
  imported.formations.push({ id: 'old-form', name: 'Test', book: 'offense', players: [clone(marker)] });
  const oldIncoming = clone(imported), oldTarget = clone(target);
  const added = prepareWorkspaceAppend(target, imported);
  assert.deepEqual(target, oldTarget);
  assert.deepEqual(imported, oldIncoming);
  const chart = added.depthChart;
  const linked = added.roster[0].id;
  assert.notEqual(linked, athlete.id);
  assert.equal(added.plays[0].players[0].rosterId, linked);
  assert.equal(added.formations[0].players[0].rosterId, linked);
  assert.equal(chart.groups.length, target.depthChart.groups.length);
  assert.equal(chart.groups[0].slots[0].playerIds[0], linked);
  const combined = { ...target, depthChart: chart, plays: [...target.plays, ...added.plays], formations: added.formations, roster: [...target.roster, ...added.roster] };
  assert.deepEqual(roundtrip(combined), combined);
  const more = prepareWorkspaceAppend(combined, imported);
  assert.equal(more.depthChart.groups.length, chart.groups.length + 1);
  assert.equal(more.depthChart.groups.at(-1).name, 'Spread (2)');
  assert.deepEqual(more.depthChart.groups[0], chart.groups[0]);
});

test('append respects the group limit and empty templates do not multiply', () => {
  const source = starterWorkspace(), full = starterWorkspace();
  source.depthChart.groups.push(createDepthGroup('', 'New'));
  while (full.depthChart.groups.length < DEPTH_LIMITS.groups) {
    full.depthChart.groups.push(createDepthGroup('', 'Group ' + full.depthChart.groups.length));
  }
  assert.equal(prepareWorkspaceAppend(full, source), null);
  source.depthChart = defaultDepthChart();
  assert.deepEqual(prepareWorkspaceAppend(full, source).depthChart, full.depthChart);
});

test('unlinked legacy diagram names and missing roster IDs remain readable snapshots', () => {
  const data = starterWorkspace(), [first, second, linked] = data.plays[0].players;
  first.name = 'Former player';
  first.rosterId = 'removed';
  second.name = data.roster[0].name;
  linked.rosterId = data.roster[0].id;
  linked.name = 'Previous name';
  const result = roundtrip(data).plays[0].players;
  assert.equal(result[0].name, first.name);
  assert.equal(result[0].rosterId, undefined);
  assert.equal(result[1].rosterId, undefined);
  assert.equal(result[2].name, data.roster[0].name);
});

test('independent position edits merge, while two coaches changing the same ranks surface a conflict', () => {
  const base = starterWorkspace(), local = clone(base), remote = clone(base);
  local.depthChart.groups[0].slots[0].playerIds = [base.roster[0].id];
  remote.depthChart.groups[0].slots[1].playerIds = [base.roster[1].id];
  const merged = mergeWorkspaces(base, local, remote);
  assert.deepEqual(merged.conflicts, []);
  const positions = roundtrip(merged.data).depthChart.groups[0].slots;
  assert.deepEqual(positions[0].playerIds, [base.roster[0].id]);
  assert.deepEqual(positions[1].playerIds, [base.roster[1].id]);
  remote.depthChart.groups[0].slots[0].playerIds = [base.roster[2].id];
  assert.ok(mergeWorkspaces(base, local, remote).conflicts.length);
});

test('legacy name-only selections migrate only when a roster name matches exactly once', () => {
  const old = starterWorkspace();
  delete old.depthChart;
  const [unique, duplicate, sameName] = old.roster;
  sameName.name = duplicate.name;
  const [known, ambiguous, unknown, orphan] = old.plays[0].players;
  known.name = unique.name;
  ambiguous.name = duplicate.name;
  unknown.name = 'Former';
  orphan.name = unique.name;
  orphan.rosterId = 'gone';
  const migrated = roundtrip(old);
  const [linked, duplicateSnapshot, retired, orphanSnapshot] = migrated.plays[0].players;
  assert.equal(linked.rosterId, unique.id);
  assert.equal(duplicateSnapshot.rosterId, undefined);
  assert.equal(duplicateSnapshot.name, duplicate.name);
  assert.equal(retired.rosterId, undefined);
  assert.equal(orphanSnapshot.rosterId, undefined);
  delete linked.rosterId;
  assert.equal(roundtrip(migrated).plays[0].players[0].rosterId, undefined);
});
