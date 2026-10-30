import test from 'node:test';
import assert from 'node:assert/strict';

for (const prefix of ['', 'cloud.', 'madden-ai.', 'support.', 'landing.']) {
  test(`${prefix || 'editor'} language dictionaries have matching keys`, async () => {
    const zh = (await import(`../web/locales/${prefix}zh-CN.js`)).default;
    const en = (await import(`../web/locales/${prefix}en.js`)).default;
    assert.deepEqual(Object.keys(en).sort(), Object.keys(zh).sort());
  });
}
