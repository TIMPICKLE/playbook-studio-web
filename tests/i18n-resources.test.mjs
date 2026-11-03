import test from 'node:test';
import assert from 'node:assert/strict';

for (const prefix of ['', 'cloud.', 'roster.', 'depth-chart.', 'depth-formation.', 'personnel-groups.', 'madden-ai.', 'support.', 'landing.']) {
  test(`${prefix || 'editor'} language dictionaries have matching keys`, async () => {
    const zh = (await import(`../web/locales/${prefix}zh-CN.js`)).default;
    const en = (await import(`../web/locales/${prefix}en.js`)).default;
    assert.deepEqual(Object.keys(en).sort(), Object.keys(zh).sort());
  });
}

test('the player management tab preserves the DEPTH CHART name in every language', async () => {
  for (const locale of ['zh-CN', 'en']) {
    const { default: messages } = await import(`../web/locales/roster.${locale}.js`);
    assert.equal(messages['roster.depthTab'], 'DEPTH CHART');
  }
});
