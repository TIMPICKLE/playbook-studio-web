import test from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { createMatchupView } from '../web/ai-matchup.js';
import { starterWorkspace } from '../web/model.js';
import { KNOWLEDGE_STORAGE_PREFIX } from '../web/knowledge-store.js';
import { validateKnowledgePack } from '../web/knowledge-base.js';

const settle = async () => { for (let i = 0; i < 5; i++) await new Promise(resolve => setImmediate(resolve)); };
const report = title => ({ status: 'limited', summary: title, scenarios: [{ title, condition: 'If the defender widens', observation: 'Read the flat defender', possibility: 'An inside window may develop', limitations: 'Assignments and timing remain unconfirmed', evidenceIds: [] }], evidence: [], warnings: [] });

async function withView(run) {
  const win = new Window({ url: 'https://playbook.test/editor/', width: 390, height: 844 });
  const names = ['window', 'document', 'localStorage'];
  const previous = Object.fromEntries(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  let failWrites = false;
  const storage = { getItem: key => win.localStorage.getItem(key), setItem: (key, value) => { if (failWrites) throw new Error('Quota exceeded'); win.localStorage.setItem(key, value); } };
  for (const name of names) Object.defineProperty(globalThis, name, { configurable: true, value: name === 'window' ? win : name === 'localStorage' ? storage : win[name] });
  win.document.body.innerHTML = '<div id="root"></div>';
  const root = win.document.querySelector('#root'), data = starterWorkspace();
  const record = { id: 'functional-team', revision: 1, title: 'Functional team' };
  const calls = [];
  let respond = async () => report('Report from previous knowledge');
  const view = createMatchupView({ root, getData: () => data, getCurrent: () => record, isDirty: () => false,
    request: async (path, options) => { calls.push({ path, options }); return respond(path, options); } });
  const input = (field, value) => { const node = root.querySelector(`[data-ai-field="${field}"]`); node.value = value; node.dispatchEvent(new win.Event(node.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); };
  const analyze = () => root.querySelector('[data-ai-action="analyze"]').click();
  try {
    view.onData(data, record); view.show(true); input('apiKey', 'fake-test-key');
    await run({ win, root, view, calls, input, analyze, setResponder: fn => { respond = fn; }, setStorageFailure: value => { failWrites = value; } });
  } finally {
    view.destroy(); await win.happyDOM.abort();
    for (const name of names) { if (previous[name]) Object.defineProperty(globalThis, name, previous[name]); else delete globalThis[name]; }
  }
}

function delayedFile(name = 'mesh-install.txt') {
  let finish;
  const file = { name, size: 70, text: () => new Promise(resolve => { finish = resolve; }) };
  return { file, finish: raw => finish(raw) };
}

test('successful import invalidates a report generated while the file was being read', async () => {
  await withView(async ({ win, root, view, analyze }) => {
    const delayed = delayedFile(), pending = view.importKnowledgeFile(delayed.file);
    analyze(); await settle();
    assert.match(root.querySelector('.ai-scenario').textContent, /Report from previous knowledge/);
    delayed.finish('Mesh crossing team reminder: check the low-hole defender.'); await pending;
    assert.ok(JSON.parse(win.localStorage.getItem(KNOWLEDGE_STORAGE_PREFIX + 'functional-team')).cards.length);
    assert.ok(root.querySelector('.ai-scenario'), 'The adopted knowledge marks the previous report stale without erasing it');
    assert.match(root.querySelector('.ai-report-context').textContent,/输入已变化/);
    assert.equal(root.querySelector('.ai-model-waiting'), null);
    assert.equal(root.querySelector('[data-ai-action="analyze"]').disabled, false);
  });
});

test('successful import aborts a newer in-flight analysis and ignores its late response', async () => {
  await withView(async ({ root, view, analyze, calls, setResponder }) => {
    let finishReport;
    setResponder(() => new Promise(resolve => { finishReport = resolve; }));
    const delayed = delayedFile(), pending = view.importKnowledgeFile(delayed.file);
    analyze(); await settle();
    assert.equal(calls.length, 1);
    assert.equal(calls[0].options.signal.aborted, false);
    assert.ok(root.querySelector('.ai-model-waiting'));
    delayed.finish('Mesh crossing updated install; verify the low hole.'); await pending;
    const abortedAtKnowledgeAdoption = calls[0].options.signal.aborted;
    finishReport(report('Late stale report')); await settle();
    assert.equal(abortedAtKnowledgeAdoption, true);
    assert.equal(root.querySelector('.ai-scenario'), null);
    assert.equal(root.querySelector('.ai-model-waiting'), null);
    assert.equal(root.querySelector('[data-ai-action="cancel"]').hidden, true);
    assert.equal(root.querySelector('[data-ai-action="analyze"]').disabled, false);
  });
});

test('failed import preserves a report generated during the read because no new knowledge was adopted', async () => {
  await withView(async ({ win, root, view, analyze }) => {
    const delayed = delayedFile('invalid.json'), pending = view.importKnowledgeFile(delayed.file);
    analyze(); await settle();
    delayed.finish('{invalid'); await pending;
    assert.match(root.querySelector('.ai-scenario').textContent, /Report from previous knowledge/);
    assert.ok(root.querySelector('.ai-knowledge-error'));
    assert.equal(win.localStorage.getItem(KNOWLEDGE_STORAGE_PREFIX + 'functional-team'), null);
  });
});

test('failed persistence does not adopt a new pack or invalidate a newer report', async () => {
  await withView(async ({ win, root, view, analyze, setStorageFailure }) => {
    const delayed = delayedFile(), pending = view.importKnowledgeFile(delayed.file);
    analyze(); await settle();
    setStorageFailure(true);
    try { delayed.finish('Mesh crossing rule not saved to storage.'); await pending; }
    finally { setStorageFailure(false); }
    assert.match(root.querySelector('.ai-scenario').textContent, /Report from previous knowledge/);
    assert.match(root.querySelector('.ai-knowledge-error').textContent, /未保存/);
    assert.equal(root.querySelectorAll('[data-knowledge-delete]').length, 0);
    assert.equal(win.localStorage.getItem(KNOWLEDGE_STORAGE_PREFIX + 'functional-team'), null);
  });
});

test('local knowledge export round-trips the persisted source and card identities', async () => {
  await withView(async ({ win, root, view }) => {
    await view.importKnowledgeFile({ name: 'mesh.txt', size: 50, text: async () => 'Mesh crossing: check the low-hole defender.' });
    const before = JSON.parse(win.localStorage.getItem(KNOWLEDGE_STORAGE_PREFIX + 'functional-team'));
    const create = URL.createObjectURL, revoke = URL.revokeObjectURL;
    let captured, revoked;
    URL.createObjectURL = blob => { captured = blob; return 'blob:export-test'; };
    URL.revokeObjectURL = url => { revoked = url; };
    root.ownerDocument.addEventListener('click', event => { if (event.target.download) event.preventDefault(); });
    try { root.querySelector('[data-knowledge-action="export"]').click(); }
    finally { URL.createObjectURL = create; URL.revokeObjectURL = revoke; }
    assert.equal(revoked, 'blob:export-test');
    assert.equal(captured.type, 'application/json');
    const restored = validateKnowledgePack(JSON.parse(await captured.text()));
    assert.deepEqual(restored.sources.map(source => source.id), before.sources.map(source => source.id));
    assert.deepEqual(restored.cards.map(card => [card.sourceId, card.id, card.content]), before.cards.map(card => [card.sourceId, card.id, card.content]));
    assert.doesNotMatch(await captured.text(), /fake-test-key/);
  });
});

test('a model-cited local source opens its exact page and figure details without creating active HTML', async () => {
  await withView(async ({ root, view, analyze, input, setResponder }) => {
    const pack = { format: 'playbook-studio-knowledge', version: 1,
      sources: [{ id: 'team:signal', title: 'Team signal source', url: 'https://example.com/install' }],
      cards: [{ id: 'mesh-page', sourceId: 'team:signal', title: 'Mesh exact cobalt page', content: 'Cobalt mesh crossing rule <script>bad()</script>', tags: ['cobalt'], page: 4, regionId: 'p4-read', figures: [{ id: 'p4-fig', page: 4, regionId: 'p4-fig-region', caption: 'Cobalt read diagram' }] }] };
    await view.importKnowledgeFile({ name: 'install.json', size: JSON.stringify(pack).length, text: async () => JSON.stringify(pack) });
    input('knowledgeQuery', 'cobalt mesh exact');
    setResponder(async () => {
      const evidenceId = root.querySelector('[data-knowledge-card^="knowledge:team:"]').dataset.knowledgeCard;
      const knowledge = { ...pack.cards[0], source: { ...pack.sources[0], kind: 'team' }, evidenceId };
      return { ...report('Cobalt model read'), evidence: [{ id: evidenceId, type: 'knowledge', label: 'Exact cobalt source' }], knowledge: [knowledge], scenarios: [{ ...report('Cobalt model read').scenarios[0], evidenceIds: [evidenceId] }] };
    });
    analyze(); await settle();
    root.querySelector('[data-knowledge-evidence]').click();
    const inspector = root.querySelector('.ai-source-inspector');
    assert.ok(inspector);
    assert.match(inspector.textContent, /第 4 页/);
    assert.match(inspector.textContent, /p4-read/);
    assert.match(inspector.textContent, /Cobalt read diagram/);
    assert.match(inspector.textContent, /<script>bad\(\)<\/script>/);
    assert.equal(inspector.querySelector('script'), null);
    assert.equal(inspector.querySelector('a').href, 'https://example.com/install');
    root.querySelector('[data-knowledge-action="close"]').click();
    assert.equal(root.querySelector('.ai-source-inspector'), null);
    assert.match(root.querySelector('.ai-scenario').textContent, /Cobalt model read/);
  });
});
