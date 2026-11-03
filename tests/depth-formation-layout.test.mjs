import test from 'node:test';
import assert from 'node:assert/strict';
import { DEPTH_TEMPLATES } from '../web/depth-model.js';
import { formationLayout } from '../web/depth-formation-layout.js';

const templateGroup = id => ({
  templateId: id,
  slots: DEPTH_TEMPLATES.find(item => item.id === id).labels.map(label => ({
    id: label, label, templateRole: label, playerIds: [],
  })),
});
const positions = id => Object.fromEntries(formationLayout(templateGroup(id)).markers.map(point => [point.slot.id, point]));

test('each preset role occupies a distinct field position even when no player is assigned', () => {
  for (const template of DEPTH_TEMPLATES) {
    const { markers, unmapped } = formationLayout(templateGroup(template.id));
    assert.equal(markers.length, 11, template.id);
    assert.deepEqual(unmapped, [], template.id);
    assert.equal(new Set(markers.map(({ x, y }) => `${x}:${y}`)).size, markers.length, template.id);
    for (const point of markers) assert.ok(point.x > 0 && point.x < 100 && point.y > 0 && point.y < 100);
  }
});

test('Spread and Bunch use their own receiver spacing and opposite backfield offsets', () => {
  const spread = positions('spread'), bunch = positions('bunch');
  assert.ok(spread.X.x < spread.Y.x && spread.Y.x < spread.LT.x);
  assert.equal(spread.Y.y, spread.C.y);
  assert.equal(spread.QB.x, spread.C.x);
  assert.ok(spread.H.x > spread.QB.x && spread.QB.y > spread.C.y);
  assert.ok(bunch.X.x > spread.X.x && bunch.Y.x > bunch.RT.x);
  assert.ok(bunch.Y.x < bunch.F.x && bunch.F.x < bunch.Z.x);
  assert.ok(bunch.F.y < bunch.Y.y && bunch.Y.y === bunch.Z.y);
  assert.ok(bunch.H.x < bunch.QB.x && bunch.H.y === bunch.QB.y);
});

test('defense and the kicking units follow the depth and direction of their respective sheets', () => {
  const defense = positions('4-2-5'), kickoff = positions('kickoff');
  assert.ok(defense.FS.y < defense.Mike.y && defense.Mike.y < defense.WS.y && defense.WS.y < defense.WDE.y);
  assert.ok(defense.LCB.x < defense.WDE.x && defense.RCB.x > defense.SDE.x);
  assert.equal(new Set(Object.values(kickoff).map(p => p.y)).size, 1);
  assert.ok(kickoff.L1.x < kickoff.K.x && kickoff.K.x < kickoff.R1.x);
  const receive = positions('kickoff-return'), punt = positions('punt');
  assert.ok(receive.C.y < receive.LUB.y && receive.LUB.y < receive.LR.y);
  assert.ok(punt.C.y < punt.TB.y && punt.TB.y < punt.PP.y && punt.PP.y < punt.P.y);
  assert.equal(punt.P.x, punt.C.x);
  const ret = positions('punt-return'), fg = positions('field-goal');
  assert.ok(ret.LCB.y < ret.Returner.y && ret.LCB.x < ret.Returner.x && ret.Returner.x < ret.RCB.x);
  assert.ok(fg.C.y < fg.Holder.y && fg.Holder.y < fg.Kicker.y && fg.Holder.x > fg.Kicker.x);
});

test('a renamed role keeps its anchor and unmatched or custom roles stay outside the formation', () => {
  const group = templateGroup('bunch');
  const wideout = group.slots.find(s => s.id === 'X');
  wideout.label = 'Wide left';
  group.slots.reverse();
  const extra = { id: 'extra', label: 'X', templateRole: null, playerIds: ['first'] };
  group.slots.push(extra);
  const { markers, unmapped } = formationLayout(group);
  const anchor = markers.find(p => p.slot.id === wideout.id);
  assert.equal(anchor.slot.label, 'Wide left');
  assert.equal(anchor.x, positions('bunch').X.x);
  assert.deepEqual(unmapped, [extra]);
  assert.deepEqual(formationLayout({ ...group, templateId: null }), {
    templateId: null, markers: [], unmapped: group.slots,
  });
});
