import test from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { readFileSync } from 'node:fs';
import { starterWorkspace } from '../web/model.js';
import { setLocale } from '../web/i18n.js';
import { createMaddenLibrary } from '../web/madden.js';
import { createMatchupView, localizedAnalysisError } from '../web/ai-matchup.js';

test('English Madden library and matchup use locale resources and submit selected locale', async () => {
  const win = new Window({ url: 'https://playbook.test/', width: 1440, height: 900 });
  const names = ['document', 'window', 'localStorage', 'fetch'];
  const previous = Object.fromEntries(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  const catalog = JSON.parse(readFileSync(new URL('../web/data/huddle-catalog.json', import.meta.url)));
  for (const name of names) Object.defineProperty(globalThis, name, { configurable: true, value: name === 'fetch' ? async () => new Response(JSON.stringify(catalog), { headers: { 'Content-Type': 'application/json' } }) : win[name] });
  win.document.body.innerHTML = '<main id="madden-root" hidden></main><main id="ai-root" hidden></main>';
  try {
    setLocale('en');
    const library = createMaddenLibrary({ canEdit: () => true, getPlays: () => [], onImport: () => ({ ok: true }) });
    await library.open();
    assert.match(win.document.querySelector('.madden-panel').textContent, /play library/i);
    assert.match(win.document.querySelector('#madden-count').textContent, /editable plays/);
    assert.equal(win.document.querySelector('#madden-search').getAttribute('aria-label'), 'Search Madden plays');
    library.close();
    let submitted;
    const data = starterWorkspace();
    const root = win.document.querySelector('#ai-root');
    const view = createMatchupView({ root, getData: () => data, getCurrent: () => ({ id: 'book', title: 'Team', revision: 1 }), isDirty: () => false, request: async (_url, options) => { submitted = options.body; return { scenarios: [{ title: 'Scenario', condition: 'If', observation: 'Watch', possibility: 'Possible', evidenceIds: [] }], evidence: [], warnings: [] }; } });
    view.show(true);
    assert.match(root.textContent, /Choose matchup/);
    for (const [field, value] of [['model', 'fake'], ['apiKey', 'key']]) { const input = root.querySelector(`[data-ai-field="${field}"]`); input.value = value; input.dispatchEvent(new win.Event('input', { bubbles: true })); }
    root.querySelector('[data-ai-action="analyze"]').click();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(submitted.locale, 'en');
    assert.match(localizedAnalysisError(new Error('模型服务拒绝了 API Key 或账号权限，请检查配置')), /rejected the API key/);
    assert.match(localizedAnalysisError(new Error('未知错误')), /Analysis failed/);
    assert.equal(localizedAnalysisError(new Error('Network unavailable')), 'Network unavailable');
    assert.match(root.textContent, /Possible scenarios/);
  } finally {
    setLocale('zh-CN');
    await win.happyDOM.abort();
    for (const name of names) { if (previous[name]) Object.defineProperty(globalThis, name, previous[name]); else delete globalThis[name]; }
  }
});
