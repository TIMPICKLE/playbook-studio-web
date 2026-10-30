import test from 'node:test';
import assert from 'node:assert/strict';
import { localizeMatchupAnnotations } from '../server/matchup-locale.mjs';

test('localizes generated annotations while preserving user labels and evidence IDs', () => {
  const evidence = [{ id: 'offense:player:1', type: 'player', label: '小明 · 站位' }, { id: 'defense:zone:1', type: 'zone', label: '我的区域 · 防守区域' }];
  const warnings = ['图上重叠不代表同一时刻到达；演示时长不是实战时序。'];
  const out = localizeMatchupAnnotations(evidence, warnings, 'en');
  assert.equal(out.evidence[0].label, '小明 · position');
  assert.equal(out.evidence[1].label, '我的区域 · defensive zone');
  assert.equal(out.evidence[0].id, evidence[0].id);
  assert.match(out.warnings[0], /overlap/);
  assert.equal(evidence[0].label, '小明 · 站位');
  assert.equal(localizeMatchupAnnotations(evidence, warnings, 'zh-CN').warnings[0], warnings[0]);
});
