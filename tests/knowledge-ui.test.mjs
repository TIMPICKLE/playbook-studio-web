import test from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { createMatchupView } from '../web/ai-matchup.js';
import { starterWorkspace } from '../web/model.js';
import { createKnowledgeStore, KNOWLEDGE_STORAGE_PREFIX } from '../web/knowledge-store.js';
import { parseKnowledgeText } from '../web/knowledge-base.js';

const file = (raw, name = 'team-notes.md') => ({ name, size: new TextEncoder().encode(raw).byteLength, text: async () => raw });
const settle = async () => { for (let i = 0; i < 4; i++) await new Promise(resolve => setImmediate(resolve)); };

async function withView(run) {
  const win = new Window({ url: 'https://playbook.test/editor/', width: 390, height: 844 });
  const previous = Object.fromEntries(['window', 'document', 'localStorage'].map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  for (const name of Object.keys(previous)) Object.defineProperty(globalThis, name, { configurable: true, value: name === 'window' ? win : win[name] });
  win.document.body.innerHTML = '<div id="root"></div>';
  let record = { id: 'team-a', title: 'Team A', revision: 1 }, data = starterWorkspace();
  const calls = [], root = win.document.querySelector('#root');
  const view = createMatchupView({ root, getCurrent: () => record, getData: () => data, isDirty: () => false, request: async (url, options) => { calls.push({ url, options }); return { status: 'limited', summary: 'Conditional report', scenarios: [{ title: 'A read', condition: 'If', observation: 'Watch the flat', possibility: 'A window may open', limitations: 'Unknown timing', evidenceIds: [] }], warnings: [], evidence: [] }; } });
  const input = (field, value) => { const node = root.querySelector(`[data-ai-field="${field}"]`); node.value = value; node.dispatchEvent(new win.Event(node.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); };
  const switchWorkspace = (id, title = id) => { record = { id, title, revision: 1 }; view.onData(data, record); };
  try { view.onData(data, record); view.show(true); await run({ win, root, view, calls, input, switchWorkspace }); }
  finally { view.show(false); await win.happyDOM.abort(); for (const [name, descriptor] of Object.entries(previous)) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name]; } }
}

test('knowledge dictionaries have matching keys', async () => {
  const zh = (await import('../web/locales/analysis-knowledge.zh-CN.js')).default;
  const en = (await import('../web/locales/analysis-knowledge.en.js')).default;
  assert.deepEqual(Object.keys(en).sort(), Object.keys(zh).sort());
});

test('local brief and real reference retrieval work without a model key', async () => {
  await withView(async ({ root, input, calls }) => {
    assert.ok(root.querySelector('.ai-fact-grid'));
    assert.equal(root.querySelector('.ai-fact-grid strong').textContent, '11');
    assert.match(root.querySelector('.ai-coverage-note').textContent, /覆盖尚未确认/);
    input('coverage', 'cover2');
    assert.match(root.querySelector('.ai-coverage-note').textContent, /变体未确认/);
    input('coverage', 'cover2_read');
    assert.match(root.querySelector('.ai-coverage-note').textContent, /Read/);
    input('knowledgeQuery', 'Smash');
    assert.ok(root.querySelector('.ai-knowledge-card'));
    assert.match(root.querySelector('.ai-knowledge-list').textContent, /Read|Smash|smash/);
    assert.equal(calls.length, 0);
    assert.equal(root.querySelector('.ai-scenario'), null);
  });
});

test('imported references are isolated per playbook, escaped, and deleted durably', async () => {
  await withView(async ({ win, root, view, input, switchWorkspace }) => {
    const raw = '# Mesh team reminder\n\nMesh crossing: keep split spacing. <img src=x onerror=alert(1)>';
    await view.importKnowledgeFile(file(raw));
    input('knowledgeQuery', 'Mesh team reminder');
    assert.match(root.querySelector('.ai-knowledge-list').textContent, /未外部核验/);
    assert.equal(root.querySelector('.ai-knowledge-list img'), null);
    assert.equal(root.querySelectorAll('[data-knowledge-delete]').length, 1);
    assert.ok(win.localStorage.getItem(KNOWLEDGE_STORAGE_PREFIX + 'team-a'));
    switchWorkspace('team-b');
    assert.equal(root.querySelectorAll('[data-knowledge-delete]').length, 0);
    assert.doesNotMatch(root.querySelector('.ai-knowledge-list').textContent, /Mesh team reminder/);
    switchWorkspace('team-a');
    assert.equal(root.querySelectorAll('[data-knowledge-delete]').length, 1);
    root.querySelector('[data-knowledge-delete]').click();
    assert.equal(root.querySelectorAll('[data-knowledge-delete]').length, 0);
    assert.equal(JSON.parse(win.localStorage.getItem(KNOWLEDGE_STORAGE_PREFIX + 'team-a')).cards.length, 0);
    assert.match(root.querySelector('.ai-knowledge-notice').textContent, /已移除/);
  });
});

test('a delayed import cannot write into a different playbook or survive view closure', async () => {
  await withView(async ({ win, root, view, switchWorkspace }) => {
    let finish;
    const delayed = { name: 'late.txt', size: 40, text: () => new Promise(resolve => { finish = resolve; }) };
    const importing = view.importKnowledgeFile(delayed);
    switchWorkspace('team-b');
    finish('Mesh late reference that must be discarded.');
    await importing;
    assert.equal(root.querySelectorAll('[data-knowledge-delete]').length, 0);
    assert.equal(win.localStorage.getItem(KNOWLEDGE_STORAGE_PREFIX + 'team-a'), null);
    assert.equal(win.localStorage.getItem(KNOWLEDGE_STORAGE_PREFIX + 'team-b'), null);
    const closing = view.importKnowledgeFile(delayed);
    view.show(false); finish('Mesh closed reference that must be discarded.'); await closing;
    view.show(true);
    assert.equal(root.querySelectorAll('[data-knowledge-delete]').length, 0);
  });
});

test('model requests include only selected local passages and source metadata', async () => {
  await withView(async ({ root, view, input, calls }) => {
    const pack = { format: 'playbook-studio-knowledge', version: 1, sources: [{ id: 'team:mesh', title: 'Private install' }], cards: [
      { id: 'mesh-reminder', sourceId: 'team:mesh', title: 'Mesh crossing team reminder', content: 'Mesh crossing watch the low hole; team-specific signal cobaltmesh.', tags: ['mesh', 'cobaltmesh'], page: 2, regionId: 'figure-a', figures: [{ id: 'figure-a', caption: 'Mesh crossing diagram', page: 2 }] },
      { id: 'unrelated', sourceId: 'team:mesh', title: 'Xylophone inventory', content: 'Xylophone inventory unrelatedpassageforcheck', tags: [] },
    ] };
    await view.importKnowledgeFile(file(JSON.stringify(pack), 'install.json'));
    input('knowledgeQuery', 'cobaltmesh Mesh crossing'); input('model', 'test-model'); input('apiKey', 'test-private-key');
    root.querySelector('[data-ai-action="analyze"]').click(); await settle();
    assert.equal(calls.length, 1);
    const sent = calls[0].options.body;
    assert.equal(sent.knowledgePack.cards.length, 1);
    assert.equal(sent.knowledgePack.cards[0].page, 2);
    assert.equal(sent.knowledgePack.cards[0].figures[0].id, 'figure-a');
    assert.equal(sent.knowledgePack.sources[0].kind, 'team');
    assert.doesNotMatch(JSON.stringify(sent.knowledgePack), /unrelatedpassageforcheck|test-private-key/);
    assert.ok(root.querySelector('.ai-scenario'));
    root.querySelector('[data-knowledge-delete]').click();
    assert.equal(root.querySelector('.ai-scenario'), null);
  });
});

test('storage failures are explicit and corrupted data never enters retrieval', () => {
  const unavailable = createKnowledgeStore({ getItem() { throw new Error('denied'); }, setItem() { throw new Error('full'); } });
  assert.equal(unavailable.load('book').error, 'analysis.storageReadError');
  const pack = parseKnowledgeText('Mesh crossing team reminder.', { name: 'notes.txt' });
  assert.throws(() => unavailable.save('book', pack), /analysis.storageError/);
  const corrupt = createKnowledgeStore({ getItem() { return '{broken'; } });
  assert.equal(corrupt.load('book').error, 'analysis.storageCorrupt');
  assert.deepEqual(corrupt.load('book').pack.cards, []);
});
