import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { BUILTIN_KNOWLEDGE_PACK, KNOWLEDGE_LIMITS, mergeKnowledgePacks, parseKnowledgeText, retrieveKnowledge, safeSourceUrl, validateKnowledgePack } from '../web/knowledge-base.js';

const clone = value => JSON.parse(JSON.stringify(value));
function fixture() {
  return { format: 'playbook-studio-knowledge', version: 1,
    sources: [{ id: 'team:pdf:abc123', title: 'Team installation', kind: 'team', revision: 'sha256-document-v1', documentName: 'installation.pdf' }],
    cards: [
      { id: 'install:parent', sourceId: 'team:pdf:abc123', title: 'Our passing rules', content: 'Read the release before the exchange.', tags: ['teaminstall'], coverages: [], appliesWhen: ['Our installation is confirmed'], exceptions: ['Check the weekly adjustment'], page: 4, regionId: 'page4:heading', bbox: [0.1, 0.1, 0.9, 0.3], figures: [] },
      { id: 'install:wheel', sourceId: 'team:pdf:abc123', parentId: 'install:parent', title: 'Zebra wheel exchange', content: 'Zebra: the nickel carries the wheel according to this installation.', tags: ['zebra', 'wheel'], coverages: ['cover3_match'], appliesWhen: ['This team has installed Zebra'], exceptions: ['Other teams may use different rules'], readKey: 'Nickel release', coachingCue: 'Confirm Zebra before the snap', page: 4, regionId: 'page4:body', bbox: [0.1, 0.35, 0.9, 0.65], figures: [{ id: 'figure4:wheel', caption: 'Wheel adjustment', page: 4, regionId: 'page4:figure', imageRef: 'figures/page4-wheel.png' }] },
      { id: 'install:unrelated', sourceId: 'team:pdf:abc123', title: 'Special teams', content: 'Punt alignment.', tags: ['punt'], coverages: [], page: 4, figures: [] },
    ] };
}

test('curated rules have provenance, exceptions and stable legacy evidence IDs', () => {
  assert.ok(BUILTIN_KNOWLEDGE_PACK.cards.length >= 10 && BUILTIN_KNOWLEDGE_PACK.cards.length <= 14);
  assert.ok(Object.isFrozen(BUILTIN_KNOWLEDGE_PACK.cards));
  for (const card of BUILTIN_KNOWLEDGE_PACK.cards) {
    const source = BUILTIN_KNOWLEDGE_PACK.sources.find(source => source.id === card.sourceId);
    assert.ok(safeSourceUrl(source.url));
    assert.equal(source.kind, 'publisher');
    assert.ok(source.contentHash);
    assert.ok(card.appliesWhen.length && card.exceptions.length && card.readKey && card.coachingCue);
  }
  const hank = retrieveKnowledge({ query: 'Hank hook flat', coverage: 'cover3_spot' });
  assert.ok(hank.some(card => card.evidenceId === 'knowledge:cover3.hook_flat'));
  assert.ok(retrieveKnowledge({ query: 'Cover 3 match assignment', coverage: 'cover3_match' }).some(card => card.evidenceId === 'knowledge:cover3.match'));
});

test('bilingual domain aliases retrieve the same conditional concepts', () => {
  for (const query of ['mesh shallow cross man', '浅交叉 盯人']) {
    const result = retrieveKnowledge({ query, coverage: 'man' });
    assert.equal(result[0].id, 'mesh.man');
    assert.ok(result.some(card => card.id === 'mesh.traffic'));
  }
  assert.ok(retrieveKnowledge({ query: '四强侧 洪水 wheel', coverage: 'cover3_spot' }).some(card => card.id === 'fourstrong.flood'));
  assert.ok(!retrieveKnowledge({ query: '四强侧 洪水 wheel', coverage: 'cover3_match' }).some(card => card.id === 'fourstrong.flood'));
  assert.equal(retrieveKnowledge({ query: 'nonsensewordzzzzz', coverage: 'unknown' }).length, 0);
  assert.equal(retrieveKnowledge({ query: '', coverage: 'unknown' }).length, 0);
});

test('coverage filters never promote Cover 2 Read or Cover 3 Match as a different coverage', () => {
  const spot = retrieveKnowledge({ query: 'Cover 3 Match Hank Hook Flat', coverage: 'cover3_spot' });
  assert.ok(spot.every(card => !card.coverages.length || card.coverages.includes('cover3_spot')));
  assert.ok(!spot.some(card => card.id === 'cover3.match'));
  const cover2 = retrieveKnowledge({ query: 'Cover 2 read press smash', coverage: 'cover2' });
  assert.ok(cover2.some(card => card.id === 'cover2.variant'));
  assert.ok(!cover2.some(card => card.id === 'cover2.read' || card.id === 'cover2.press'));
  const read = retrieveKnowledge({ query: 'Cover 2 read press smash', coverage: 'cover2_read' });
  assert.ok(read.some(card => card.id === 'cover2.read'));
  assert.ok(read.every(card => !card.coverages.length || card.coverages.includes('cover2_read')));
});

test('unconfirmed coverage remains explicitly conditional and rankings expose no confidence score', () => {
  const results = retrieveKnowledge({ query: 'Hank hook flat', coverage: 'unknown' });
  const hank = results.find(card => card.id === 'cover3.hook_flat');
  assert.equal(hank.applicability, 'conditional');
  assert.match(hank.matchReasons.join(' '), /覆盖未确认/);
  for (const card of results) for (const field of ['score', 'rank', 'probability', 'confidence']) assert.equal(card[field], undefined);
});

test('English retrieval localizes curated wording without changing identity or imported text', () => {
  const zh = retrieveKnowledge({ query: 'mesh man', coverage: 'man' })[0];
  const en = retrieveKnowledge({ query: 'mesh man', coverage: 'man', locale: 'en' })[0];
  assert.equal(zh.evidenceId, en.evidenceId);
  assert.equal(zh.source.contentHash, en.source.contentHash);
  assert.match(en.title, /Mesh/);
  assert.match(en.content, /confirmed man coverage/);
  assert.doesNotMatch(en.content, /[\u3400-\u9fff]/u);
  const imported = retrieveKnowledge({ query: 'zebra', coverage: 'cover3_match', packs: [fixture()], locale: 'en' }).find(card => card.id === 'install:wheel');
  assert.equal(imported.content, fixture().cards[1].content);
});

test('normalization preserves page, region and text-to-figure links without claiming image interpretation', () => {
  const pack = validateKnowledgePack(fixture());
  assert.deepEqual(pack.cards[1].bbox, [0.1, 0.35, 0.9, 0.65]);
  assert.equal(pack.cards[1].page, 4);
  assert.equal(pack.cards[1].regionId, 'page4:body');
  assert.equal(pack.cards[1].figures[0].id, 'figure4:wheel');
  assert.equal(pack.cards[1].figures[0].imageRef, 'figures/page4-wheel.png');
  const result = retrieveKnowledge({ query: 'zebra', coverage: 'cover3_match', packs: [pack] });
  const child = result.find(card => card.id === 'install:wheel');
  assert.equal(child.source.id, 'team:pdf:abc123');
  assert.equal(child.source.documentName, 'installation.pdf');
  assert.equal(child.source.revision, 'sha256-document-v1');
  assert.equal(child.evidenceId, 'knowledge:team:team%3Apdf%3Aabc123:install%3Awheel');
  assert.equal(child.imageRead, undefined);
});

test('only an explicit same-source parent is expanded, never another card on the same page', () => {
  const results = retrieveKnowledge({ query: 'zebra', coverage: 'cover3_match', packs: [fixture()] });
  assert.equal(results[0].id, 'install:wheel');
  assert.equal(results[1].id, 'install:parent');
  assert.match(results[1].matchReasons[0], /显式父卡片/);
  assert.ok(!results.some(card => card.id === 'install:unrelated'));
  const withoutParent = fixture(); delete withoutParent.cards[1].parentId;
  assert.equal(retrieveKnowledge({ query: 'zebra', coverage: 'cover3_match', packs: [withoutParent] }).length, 1);
});

test('invalid, foreign or cyclic parent relationships are rejected', () => {
  for (const mutate of [
    pack => { pack.cards[1].parentId = 'missing'; },
    pack => { pack.cards[0].parentId = 'install:wheel'; },
    pack => { pack.cards[1].parentId = 'install:wheel'; },
    pack => { pack.sources.push({ id: 'other', title: 'Other source' }); pack.cards[0].sourceId = 'other'; },
  ]) { const pack = fixture(); mutate(pack); assert.throws(() => validateKnowledgePack(pack), /父卡片/); }
  const incompatibleParent = fixture(); incompatibleParent.cards[0].coverages = ['cover2'];
  assert.ok(!retrieveKnowledge({ query: 'zebra', coverage: 'cover3_match', packs: [incompatibleParent] }).some(card => card.id === 'install:parent'));
});

test('retrieval budgets complete parent chains atomically and its wire subset always validates', () => {
  const pack = fixture();
  pack.cards = [
    ...Array.from({ length: 5 }, (_, i) => ({ ...pack.cards[0], id: `single${i}`, title: 'Zebra independent', content: 'Zebra Zebra Zebra', tags: ['zebra'], parentId: undefined })),
    { ...pack.cards[0], id: 'context', title: 'Foundation', content: 'Installed rule context', parentId: undefined },
    { ...pack.cards[1], id: 'child', parentId: 'context', title: 'Limited detail', content: 'The rule mentions Zebra', tags: [] },
  ];
  const result = retrieveKnowledge({ query: 'Zebra', coverage: 'cover3_match', packs: [pack] });
  assert.equal(result.length, 5);
  assert.ok(!result.some(card => card.id === 'child'));
  assert.doesNotThrow(() => validateKnowledgePack({ ...pack, cards: result }));
  const deep = fixture(); deep.cards[0].id = 'grandparent';
  deep.cards[2] = { ...deep.cards[0], id: 'parent', parentId: 'grandparent' };
  deep.cards[1].parentId = 'parent';
  const chain = retrieveKnowledge({ query: 'zebra', coverage: 'cover3_match', packs: [deep] });
  assert.deepEqual(chain.map(card => card.id), ['install:wheel', 'parent', 'grandparent']);
  assert.doesNotThrow(() => validateKnowledgePack({ ...deep, cards: chain }));
  assert.equal(retrieveKnowledge({ query: 'zebra', coverage: 'cover3_match', packs: [deep], limit: 2 }).length, 0);
});

test('external imports cannot impersonate curated publishers or collide with built-in evidence IDs', () => {
  const pack = fixture(); pack.sources[0].kind = 'publisher'; pack.sources[0].url = 'https://blogs.usafootball.com/blog/7736/teaching-the-quarterback-to-read-hank';
  pack.cards = [{ ...pack.cards[0], id: 'cover3.hook_flat', content: 'Zebra team-specific instruction' }];
  const normalized = validateKnowledgePack(pack);
  assert.equal(normalized.sources[0].kind, 'team');
  const retrieved = retrieveKnowledge({ query: 'zebra', packs: [normalized] })[0];
  assert.notEqual(retrieved.evidenceId, 'knowledge:cover3.hook_flat');
  assert.match(retrieved.evidenceId, /^knowledge:team:/);
  const reserved = fixture(); reserved.sources[0].id = 'publisher.fake';
  assert.throws(() => validateKnowledgePack(reserved), /命名空间/);
});

test('source fingerprints remain stable and change when card contents change', () => {
  const raw = fixture(), first = validateKnowledgePack(raw), repeated = validateKnowledgePack(first);
  assert.equal(first.sources[0].contentHash, repeated.sources[0].contentHash);
  raw.cards[1].content += ' Additional installation detail.';
  assert.notEqual(validateKnowledgePack(raw).sources[0].contentHash, first.sources[0].contentHash);
  assert.equal(first.sources[0].revision, 'sha256-document-v1');
});

test('merging deduplicates identical packs and rejects content or source-version collisions', () => {
  const pack = fixture();
  assert.equal(mergeKnowledgePacks([pack, clone(pack)]).cards.length, 3);
  const changed = clone(pack); changed.cards[1].content += ' Changed';
  assert.throws(() => mergeKnowledgePacks([pack, changed]), /不同内容/);
  const revision = clone(pack); revision.sources[0].revision = 'v2';
  assert.throws(() => mergeKnowledgePacks([pack, revision]), /不同来源版本/);
  const other = parseKnowledgeText('Independent note', { name: 'other.txt' });
  assert.equal(mergeKnowledgePacks([pack, other]).sources.length, 2);
  assert.equal(mergeKnowledgePacks([]).cards.length, 0);
});

test('native JSON and Markdown imports retain authorship and split large notes deterministically', () => {
  assert.deepEqual(parseKnowledgeText(JSON.stringify(fixture()), { name: 'pack.json' }), validateKnowledgePack(fixture()));
  const text = '# First rule\n\nZebra keeps the wheel.\n\n# Second rule\n\n' + 'Long note. '.repeat(700);
  const first = parseKnowledgeText(text, { name: 'install.md' }), again = parseKnowledgeText(text, { name: 'install.md' });
  assert.deepEqual(first, again);
  assert.equal(first.sources[0].kind, 'team');
  assert.ok(first.cards.length > 2);
  assert.equal(first.cards[0].title, 'First rule');
  assert.ok(first.cards.every(card => card.content.length <= KNOWLEDGE_LIMITS.contentChars));
  assert.ok(first.cards.every(card => card.page === undefined && card.figures.length === 0));
  assert.match(parseKnowledgeText('[Team note]\nRead the wheel.', { name: 'note.txt' }).cards[0].content, /Team note/);
});

test('text imports are content-versioned and report empty or malformed input honestly', () => {
  const one = parseKnowledgeText('One rule', { name: 'note.txt' }), two = parseKnowledgeText('Two rules', { name: 'note.txt' });
  assert.notEqual(one.sources[0].id, two.sources[0].id);
  assert.notEqual(one.sources[0].revision, two.sources[0].revision);
  assert.throws(() => parseKnowledgeText('   '), /没有可导入/);
  assert.throws(() => parseKnowledgeText('# Heading only'), /正文/);
  assert.throws(() => parseKnowledgeText('broken JSON', { name: 'rules.json' }), /JSON/);
  assert.throws(() => parseKnowledgeText('{"something":1}', { name: 'rules.json' }), /格式或版本/);
});

test('hard validation bounds reject oversized, duplicate or malformed provenance', () => {
  assert.throws(() => parseKnowledgeText('x'.repeat(KNOWLEDGE_LIMITS.importBytes + 1)), /1 MB/);
  assert.throws(() => parseKnowledgeText('字'.repeat(400000)), /1 MB/);
  for (const mutate of [
    pack => { pack.cards[0].content = 'x'.repeat(4001); },
    pack => { pack.cards = Array.from({ length: 401 }, (_, i) => ({ ...pack.cards[0], id: `c${i}` })); },
    pack => { pack.cards.push(clone(pack.cards[0])); },
    pack => { pack.sources.push(clone(pack.sources[0])); },
    pack => { pack.cards[0].page = 0; },
    pack => { pack.cards[0].bbox = [0.5, 0.1, 0.2, 0.9]; },
    pack => { pack.cards[0].bbox = [0, 0, 2, 1]; },
    pack => { pack.cards[0].coverages = ['cover4']; },
    pack => { pack.cards[0].coverages = ['unknown']; },
    pack => { pack.cards[0].figures = [{ id: 'bad', imageRef: 'javascript:alert(1)' }]; },
  ]) { const pack = fixture(); mutate(pack); assert.throws(() => validateKnowledgePack(pack), /知识库/); }
});

test('source navigation permits only HTTPS URLs without credentials', () => {
  assert.equal(safeSourceUrl('https://example.com/paper#page=4'), 'https://example.com/paper#page=4');
  for (const value of ['http://example.com', 'javascript:alert(1)', 'data:text/html,x', 'https://user:pass@example.com', 'https://example.com/\nattack', '//example.com']) assert.equal(safeSourceUrl(value), '');
  const pack = fixture(); pack.sources[0].url = 'javascript:alert(1)';
  assert.throws(() => validateKnowledgePack(pack), /HTTPS/);
});

test('retrieval obeys both card and UTF-8 context budgets without mutating packs', () => {
  const pack = fixture(); pack.cards = Array.from({ length: 8 }, (_, i) => ({ ...pack.cards[0], id: `wide${i}`, title: `Zebra ${i}`, content: '斑马'.repeat(1900), parentId: undefined, tags: ['zebra'] }));
  const before = JSON.stringify(pack);
  const result = retrieveKnowledge({ query: 'zebra', packs: [pack] });
  assert.ok(result.length > 0 && result.length <= 6);
  assert.ok(new TextEncoder().encode(JSON.stringify(result)).byteLength <= KNOWLEDGE_LIMITS.retrievedBytes);
  assert.equal(JSON.stringify(pack), before);
  assert.equal(retrieveKnowledge({ query: 'zebra', packs: [pack], limit: 1 }).length, 1);
  assert.equal(retrieveKnowledge({ query: 'zebra', limit: 0 }).length, 0);
  assert.throws(() => retrieveKnowledge({ query: 'zebra', limit: 7 }), /6 张/);
  assert.throws(() => retrieveKnowledge({ query: {}, packs: [pack] }), /问题须为文本/);
});

test('validated packs are deeply immutable and raw changes never reuse a stale retrieval index', () => {
  const raw = fixture(), normalized = validateKnowledgePack(raw);
  assert.ok(Object.isFrozen(normalized) && Object.isFrozen(normalized.sources) && Object.isFrozen(normalized.cards));
  assert.ok(Object.isFrozen(normalized.cards[1].figures[0]));
  assert.throws(() => { normalized.cards[1].content = 'Changed'; }, TypeError);
  assert.throws(() => { normalized.cards[1].tags.push('changed'); }, TypeError);
  const options = { query: 'zebra', coverage: 'cover3_match' };
  assert.deepEqual(retrieveKnowledge({ ...options, packs: [raw] }), retrieveKnowledge({ ...options, packs: [normalized] }));
  raw.cards[1].title = 'Kestrel install'; raw.cards[1].content = 'Kestrel is the new exchange'; raw.cards[1].tags = ['kestrel'];
  assert.ok(!retrieveKnowledge({ ...options, packs: [raw] }).some(card => card.id === 'install:wheel'));
  assert.ok(retrieveKnowledge({ ...options, packs: [normalized] }).some(card => card.id === 'install:wheel'));
  assert.ok(retrieveKnowledge({ ...options, query: 'kestrel', packs: [raw] }).some(card => card.id === 'install:wheel'));
  const fakeFrozen = Object.freeze({ ...fixture(), format: 'wrong-format' });
  assert.throws(() => validateKnowledgePack(fakeFrozen), /格式或版本/);
});

test('discarding an imported pack releases its compiled retrieval index for garbage collection', () => {
  const moduleUrl = new URL('../web/knowledge-base.js', import.meta.url).href;
  const code = `
    import { validateKnowledgePack, retrieveKnowledge } from ${JSON.stringify(moduleUrl)};
    const references = [];
    for (let i = 0; i < 20; i++) {
      const pack = validateKnowledgePack({format:'playbook-studio-knowledge',version:1,sources:[{id:'team:'+i,title:'Private team notes'}],cards:[{id:'card',sourceId:'team:'+i,title:'Zebra',content:'Zebra installation '+i,tags:['zebra'],coverages:[],appliesWhen:[],exceptions:[],figures:[]}]});
      retrieveKnowledge({query:'zebra',packs:[pack]});
      references.push(new WeakRef(pack));
    }
    for (let i = 0; i < 5; i++) { await new Promise(setImmediate); global.gc(); }
    const collected = references.filter(reference => !reference.deref()).length;
    if (collected < 10) throw new Error('Discarded packs retained: '+collected);
    console.log('Imported pack indexes released');
  `;
  const result = spawnSync(process.execPath, ['--expose-gc', '--input-type=module', '-e', code], { encoding: 'utf8', timeout: 10000 });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /indexes released/);
});
