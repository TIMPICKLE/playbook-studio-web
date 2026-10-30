import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Window } from 'happy-dom';
import zh from '../web/locales/landing.zh-CN.js';
import en from '../web/locales/landing.en.js';

test('landing language resources cover every static label and matching interpolation tokens', async () => {
  assert.deepEqual(Object.keys(en).sort(), Object.keys(zh).sort());
  for (const key of Object.keys(zh)) assert.deepEqual([...zh[key].matchAll(/\{(\w+)\}/g)].map(x => x[1]).sort(), [...en[key].matchAll(/\{(\w+)\}/g)].map(x => x[1]).sort(), key);
  const html = await readFile(new URL('../web/landing.html', import.meta.url), 'utf8');
  for (const [, key] of html.matchAll(/data-landing(?:-aria)?="([^"]+)"/g)) assert.ok(zh[key] && en[key], key);
});

test('landing renders the persisted English locale and translated migration feedback', async () => {
  const win = new Window({ url: 'https://playbook.test/' });
  win.document.write(await readFile(new URL('../web/landing.html', import.meta.url), 'utf8'));
  win.localStorage.setItem('playbook-studio.locale', 'en');
  const names = ['window', 'document', 'location', 'localStorage'];
  const old = Object.fromEntries(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  for (const name of names) Object.defineProperty(globalThis, name, { configurable: true, value: win[name] });
  try {
    const { setLocale } = await import('../web/i18n.js');
    setLocale('en');
    await import('../web/migrate.js');
    assert.equal(win.document.documentElement.lang, 'en');
    assert.equal(win.document.querySelector('[data-landing="openCloud"]').textContent, 'Open the cloud app');
    assert.equal(win.document.querySelector('#entry-language').value, 'en');
    win.document.querySelector('#export-local').click();
    assert.equal(win.document.querySelector('#migration-status').textContent, en.noLocal);
  } finally {
    await win.happyDOM.abort();
    for (const name of names) old[name] ? Object.defineProperty(globalThis, name, old[name]) : delete globalThis[name];
  }
});
