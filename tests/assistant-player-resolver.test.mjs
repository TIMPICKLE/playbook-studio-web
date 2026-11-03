import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveBoardPlayer } from '../web/assistant-edit.js';

const players = [
  ...['LT', 'LG', 'C', 'RG', 'RT'].map((label, i) => ({ id: label, label, side: 'offense', x: 40 + i * 5, y: 50 })),
  { id: 'one', label: 'FS', position: 'FS', name: 'Avery Smith', number: '12', side: 'defense', x: 30, y: 25 },
  { id: 'two', label: 'SS', position: 'SS', name: 'Avery Jones', number: '31', side: 'defense', x: 70, y: 25 },
  { id: 'mike', label: 'M', position: 'MLB', name: 'Mike Green', side: 'defense', x: 50, y: 35 },
  { id: 'wide', label: 'X', position: 'WR', side: 'offense', x: 10, y: 48 },
  { id: 'slot', label: 'Y', position: 'WR', side: 'offense', x: 25, y: 48 },
];

test('partial names and decorated numbers retain ambiguity until a unique marker is selected', () => {
  assert.equal(resolveBoardPlayer(players, { name: 'Avery' }).status, 'ambiguous');
  assert.equal(resolveBoardPlayer(players, { name: 'Avery', selectMany: true }).status, 'ambiguous');
  assert.equal(resolveBoardPlayer(players, { name: 'Smith' }).candidates[0].id, 'one');
  assert.equal(resolveBoardPlayer(players, { name: 'Avery Smith', number: '#12' }).candidates[0].id, 'one');
  assert.equal(resolveBoardPlayer(players, { number: '12号' }).candidates[0].id, 'one');
});

test('position groups include all offensive linemen and safeties but avoid confusing safety with linebacker', () => {
  assert.equal(resolveBoardPlayer(players, { role: 'OL', side: 'offense' }).candidates.length, 5);
  assert.deepEqual(resolveBoardPlayer(players, { role: '安全卫' }).candidates.map(p => p.id), ['one', 'two']);
  assert.deepEqual(resolveBoardPlayer(players, { role: 'LB' }).candidates.map(p => p.id), ['mike']);
});

test('inside and outside compare players on the same side of the center axis', () => {
  assert.equal(resolveBoardPlayer(players, { role: 'WR', relativeToId: 'slot', relation: 'outside_of' }).candidates[0].id, 'wide');
  assert.equal(resolveBoardPlayer(players, { role: 'WR', relativeToId: 'wide', relation: 'inside_of' }).candidates[0].id, 'slot');
});

test('receiver numbering and formation side use the center axis and do not guess ties', () => {
  assert.equal(resolveBoardPlayer(players, { role: 'WR', selectMany: true }).status, 'found');
  assert.equal(resolveBoardPlayer(players, { role: 'WR', relation: 'receiver_number', receiverNumber: 2, fieldSide: 'left' }).candidates[0].id, 'slot');
  assert.deepEqual(resolveBoardPlayer(players, { role: 'WR', relation: 'strong_side', selectMany: true }).candidates.map(p => p.id), ['wide', 'slot']);
  const balanced = [...players, { id: 'right1', label: 'Z', position: 'WR', side: 'offense', x: 80, y: 48 },
    { id: 'right2', label: 'H', position: 'WR', side: 'offense', x: 70, y: 48 }];
  assert.equal(resolveBoardPlayer(balanced, { role: 'WR', relation: 'strong_side' }).status, 'ambiguous');
  assert.equal(resolveBoardPlayer(players, { role: 'WR', relation: 'receiver_number', receiverNumber: 1 }).status, 'invalid');
});
