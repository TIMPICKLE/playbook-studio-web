import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeWorkspace, encodeWorkspace, makePlay, prepareWorkspaceAppend, starterWorkspace } from '../web/model.js';
import { createDepthGroup, defaultDepthChart } from '../web/depth-model.js';
import { formationLayout } from '../web/depth-formation-layout.js';
import { linkRosterPlayer, personnelMatches } from '../web/board-personnel.js';

test('flag personnel templates match the five board roles and preserve geometry when starters are applied', () => {
  for (const [unit, formation, labels] of [
    ['offense', 'Flag 5 Spread', ['C', 'QB', 'X', 'Y', 'Z']],
    ['defense', 'Flag 5 Zone', ['R', 'LCB', 'RCB', 'S', 'DB']],
  ]) {
    const group = createDepthGroup(`flag5-${unit}`);
    assert.deepEqual(group.slots.map(slot => slot.label), labels);
    const roster = labels.map((label, index) => ({ id: `athlete-${index}`, name: label + ' starter' }));
    group.slots.forEach((slot, index) => { slot.playerIds = [roster[index].id]; });
    const play = makePlay({ book: unit, formation, count: 5 });
    const geometry = play.players.map(({ id, label, x, y, side }) => ({ id, label, x, y, side }));
    const matches = personnelMatches(play, group, roster);
    assert.equal(matches.length, 5);
    for (const { marker, player } of matches) linkRosterPlayer(marker, player);
    assert.deepEqual(play.players.map(({ id, label, x, y, side }) => ({ id, label, x, y, side })), geometry);
    assert.equal(new Set(play.players.map(marker => marker.rosterId)).size, 5);
    const layout = formationLayout(group);
    assert.equal(layout.markers.length, 5);
    assert.deepEqual(layout.unmapped, []);
    assert.equal(new Set(layout.markers.map(({ x, y }) => `${x}:${y}`)).size, 5);
  }
});

test('new flag depth charts use five-player units while existing tackle charts remain unchanged', () => {
  const original = defaultDepthChart();
  assert.equal(original.groups.length, 8);
  assert.ok(original.groups.every(group => group.slots.length === 11));
  const flag = defaultDepthChart(5);
  assert.deepEqual(flag.groups.map(group => group.templateId), ['flag5-offense', 'flag5-defense']);
  assert.ok(flag.groups.every(group => group.slots.length === 5));
  const data = starterWorkspace();
  data.settings.league = 5;
  assert.deepEqual(decodeWorkspace(encodeWorkspace(data)).depthChart, data.depthChart);
  delete data.depthChart;
  assert.deepEqual(decodeWorkspace(encodeWorkspace(data)).depthChart, flag);
});

test('flag assignments and layout bindings survive export and append without truncating other groups', () => {
  const incoming = starterWorkspace();
  incoming.settings.league = 5;
  incoming.depthChart = defaultDepthChart(5);
  const group = incoming.depthChart.groups[0];
  group.name = 'Flag game day';
  group.slots[0].playerIds = [incoming.roster[0].id, null, incoming.roster[1].id];
  const restored = decodeWorkspace(encodeWorkspace(incoming));
  assert.deepEqual(restored.depthChart, incoming.depthChart);
  const target = starterWorkspace();
  const before = structuredClone(target.depthChart);
  const appended = prepareWorkspaceAppend(target, incoming);
  assert.deepEqual(target.depthChart, before);
  assert.deepEqual(appended.depthChart.groups.slice(0, before.groups.length), before.groups);
  const added = appended.depthChart.groups.at(-1);
  assert.equal(added.templateId, 'flag5-offense');
  assert.equal(added.slots.length, 5);
  assert.notEqual(added.slots[0].playerIds[0], group.slots[0].playerIds[0]);
  assert.deepEqual(added.slots[0].playerIds, [appended.roster[0].id, null, appended.roster[1].id]);
  assert.equal(formationLayout(added).markers.length, 5);
});
