import test from 'node:test';
import assert from 'node:assert/strict';
import { setLocale } from '../web/i18n.js';
import { starterWorkspace } from '../web/model.js';
import { fieldSVG } from '../web/field.js';
import { passwordField, readableError } from '../web/ui.js';

test('field and shared UI labels follow the locale without changing user content', () => {
  const savedStorage = globalThis.localStorage;
  const storage = new Map();
  globalThis.localStorage = { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) };
  try {
    const play = starterWorkspace().plays[0];
    play.players[0].label = '<用户>';
    setLocale('en');
    const english = fieldSVG(play);
    assert.match(english, /Line of scrimmage/);
    assert.match(english, /Play drawing area/);
    assert.ok(english.includes('&lt;用户&gt;'));
    assert.ok(!english.includes('<用户>'));
    assert.match(passwordField('pw', 'Password'), /Show Password/);
    assert.match(readableError(new TypeError('offline')), /Cannot connect/);
    setLocale('zh-CN');
    assert.match(fieldSVG(play), /争球线/);
    assert.match(passwordField('pw', '密码'), /显示密码/);
    assert.match(readableError(new TypeError('offline')), /无法连接服务器/);
  } finally {
    if (savedStorage === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = savedStorage;
  }
});
