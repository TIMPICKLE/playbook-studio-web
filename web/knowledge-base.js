import { BUILTIN_KNOWLEDGE_PACK as builtinData } from './data/football-knowledge.js';

export const KNOWLEDGE_LIMITS = Object.freeze({ importBytes: 1_000_000, sources: 80, cards: 400, contentChars: 4000, queryChars: 2000, retrievedCards: 6, retrievedBytes: 24_000, figuresPerCard: 8 });
const encoder = new TextEncoder();
const bytes = value => encoder.encode(typeof value === 'string' ? value : JSON.stringify(value)).byteLength;
const invalid = message => { throw new TypeError(`知识库：${message}`); };
const object = value => value && typeof value === 'object' && !Array.isArray(value);
// Only immutable values produced by this module can bypass validation. Neither
// caller-controlled flags nor an arbitrary Object.freeze() establish trust.
const validatedPacks = new WeakSet();
const compiledIndexes = new WeakMap();
const clean = (value, max, name, required = false) => {
  if (value == null && !required) return '';
  if (typeof value !== 'string' || value.length > max || (required && !value.trim())) invalid(`${name}须为 ${max} 字以内的${required ? '非空' : ''}文本`);
  return value.trim();
};
const identifier = (value, name = 'ID') => {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/.test(value)) invalid(`${name}只允许 1–120 位英文字母、数字、点、冒号、下划线或连字符`);
  return value;
};
const strings = (value, name, max = 20, chars = 160) => {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > max) invalid(`${name}最多 ${max} 项`);
  return [...new Set(value.map(v => clean(v, chars, name, true)))];
};
const pageNumber = value => {
  if (!Number.isSafeInteger(value) || value < 1 || value > 100000) invalid('页码须为从 1 开始的整数');
  return value;
};
const COVERAGES = new Set(['unknown', 'cover3_spot', 'cover3_match', 'cover2', 'cover2_read', 'man']);

// Navigation only: this helper never downloads a source or an image.
export function safeSourceUrl(value) {
  if (typeof value !== 'string' || value.length > 2000 || /[\u0000-\u0020\u007f]/u.test(value)) return '';
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : '';
  } catch { return ''; }
}

// A deterministic content fingerprint, not a security or authenticity claim.
function fingerprint(value) {
  let hash = 0xcbf29ce484222325n;
  for (const byte of encoder.encode(JSON.stringify(value))) hash = BigInt.asUintN(64, (hash ^ BigInt(byte)) * 0x100000001b3n);
  return hash.toString(16).padStart(16, '0');
}
function freeze(value) {
  if (object(value) || Array.isArray(value)) { for (const item of Object.values(value)) freeze(item); Object.freeze(value); }
  return value;
}
function validated(pack) {
  freeze(pack);
  validatedPacks.add(pack);
  return pack;
}
function regionFields(raw) {
  const out = {};
  if (raw.page != null) out.page = pageNumber(raw.page);
  if (raw.regionId != null) out.regionId = identifier(raw.regionId, '区域 ID');
  if (raw.bbox != null) {
    if (!Array.isArray(raw.bbox) || raw.bbox.length !== 4 || raw.bbox.some(v => typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 1) || raw.bbox[0] >= raw.bbox[2] || raw.bbox[1] >= raw.bbox[3]) invalid('bbox 须为左上原点归一化坐标 [x0,y0,x1,y1]，且有正面积');
    out.bbox = [...raw.bbox];
  }
  return out;
}
function figures(raw) {
  if (raw == null) return [];
  if (!Array.isArray(raw) || raw.length > KNOWLEDGE_LIMITS.figuresPerCard) invalid('每张卡片最多关联 8 张图');
  const ids = new Set();
  return raw.map(figure => {
    if (!object(figure)) invalid('图示信息须为对象');
    const id = identifier(figure.id, '图示 ID');
    if (ids.has(id)) invalid('同一卡片的图示 ID 重复');
    ids.add(id);
    const caption = clean(figure.caption, 500, '图示说明');
    const imageRef = clean(figure.imageRef, 500, '图示引用');
    // References remain metadata. Do not accept inline executables or data URLs.
    if (imageRef && (/^[a-z][a-z0-9+.-]*:/i.test(imageRef) ? !safeSourceUrl(imageRef) : /[\u0000-\u001f]/u.test(imageRef))) invalid('图示引用须为 HTTPS 地址或文件引用');
    return { id, ...(caption ? { caption } : {}), ...regionFields(figure), ...(imageRef ? { imageRef } : {}) };
  });
}
function localized(raw) {
  if (!object(raw)) return undefined;
  const out = {};
  for (const locale of ['en', 'zh-CN']) {
    const item = raw[locale];
    if (!object(item)) continue;
    out[locale] = { title: clean(item.title, 180, '翻译标题', true), content: clean(item.content, KNOWLEDGE_LIMITS.contentChars, '翻译正文', true), appliesWhen: strings(item.appliesWhen, '翻译适用条件', 12, 350), exceptions: strings(item.exceptions, '翻译例外', 12, 350) };
    for (const field of ['readKey', 'coachingCue']) if (item[field] != null) out[locale][field] = clean(item[field], 500, field);
  }
  return Object.keys(out).length ? out : undefined;
}
function normalizePack(raw, allowPublisher = false) {
  if (typeof raw === 'string') {
    if (bytes(raw) > KNOWLEDGE_LIMITS.importBytes) invalid('导入文件须小于 1 MB');
    try { raw = JSON.parse(raw); } catch { invalid('JSON 格式不正确'); }
  }
  if (!object(raw) || bytes(raw) > KNOWLEDGE_LIMITS.importBytes) invalid('导入文件须为 1 MB 以内的知识库对象');
  if (raw.format !== 'playbook-studio-knowledge' || raw.version !== 1) invalid('不支持的知识库格式或版本');
  if (!Array.isArray(raw.sources) || raw.sources.length > KNOWLEDGE_LIMITS.sources || !Array.isArray(raw.cards) || raw.cards.length > KNOWLEDGE_LIMITS.cards) invalid('最多支持 80 个来源和 400 张卡片');
  if (raw.cards.length && !raw.sources.length) invalid('卡片必须关联来源');
  const sourceIds = new Set(), cardsByKey = new Map();
  const sources = raw.sources.map(source => {
    if (!object(source)) invalid('来源须为对象');
    const id = identifier(source.id, '来源 ID');
    if (!allowPublisher && /^(?:publisher[.:]|builtin[.:])/i.test(id)) invalid('导入来源不能使用内置来源命名空间');
    if (sourceIds.has(id)) invalid('来源 ID 重复');
    sourceIds.add(id);
    const url = source.url == null || source.url === '' ? '' : safeSourceUrl(source.url);
    if (source.url && !url) invalid('来源链接须为不含账号密码的 HTTPS 地址');
    const out = { id, title: clean(source.title, 180, '来源标题', true), kind: allowPublisher && source.kind === 'publisher' ? 'publisher' : 'team' };
    if (url) out.url = url;
    for (const field of ['revision', 'documentName']) { const value = clean(source[field], 240, field); if (value) out[field] = value; }
    return out;
  });
  const cards = raw.cards.map(rawCard => {
    if (!object(rawCard)) invalid('卡片须为对象');
    const id = identifier(rawCard.id, '卡片 ID'), sourceId = identifier(rawCard.sourceId, '卡片来源 ID');
    if (!sourceIds.has(sourceId)) invalid('卡片引用了不存在的来源');
    if (!allowPublisher && /^builtin[.:]/i.test(id)) invalid('导入卡片不能使用内置命名空间');
    const key = `${sourceId}\u0000${id}`;
    if (cardsByKey.has(key)) invalid('同一来源的卡片 ID 重复');
    const coverages = strings(rawCard.coverages, '覆盖类型', 5, 30);
    if (coverages.some(value => !COVERAGES.has(value)) || coverages.includes('unknown')) invalid('覆盖类型须为 cover3_spot、cover3_match、cover2、cover2_read 或 man；通用原则使用空数组');
    const out = { id, sourceId, title: clean(rawCard.title, 180, '卡片标题', true), content: clean(rawCard.content, KNOWLEDGE_LIMITS.contentChars, '卡片正文', true), tags: strings(rawCard.tags, '标签', 30, 80), coverages, appliesWhen: strings(rawCard.appliesWhen, '适用条件', 12, 350), exceptions: strings(rawCard.exceptions, '例外条件', 12, 350), ...regionFields(rawCard), figures: figures(rawCard.figures) };
    for (const field of ['readKey', 'coachingCue']) { const value = clean(rawCard[field], 500, field); if (value) out[field] = value; }
    if (rawCard.parentId != null) out.parentId = identifier(rawCard.parentId, '父卡片 ID');
    // Imported wording is retained as authored; built-in translations are curated.
    if (allowPublisher) { const translations = localized(rawCard.translations); if (translations) out.translations = translations; }
    cardsByKey.set(key, out);
    return out;
  });
  for (const item of cards) {
    if (!item.parentId) continue;
    const seen = new Set([item.id]); let next = item;
    while (next.parentId) {
      if (seen.has(next.parentId)) invalid('父卡片关联存在循环');
      seen.add(next.parentId);
      next = cardsByKey.get(`${item.sourceId}\u0000${next.parentId}`);
      if (!next) invalid('父卡片必须存在且属于同一来源');
    }
  }
  for (const source of sources) source.contentHash = fingerprint({ source, cards: cards.filter(card => card.sourceId === source.id) });
  return { format: 'playbook-studio-knowledge', version: 1, sources, cards };
}

export const BUILTIN_KNOWLEDGE_PACK = validated(normalizePack(builtinData, true));
const EMPTY_KNOWLEDGE_PACK = validated({ format: 'playbook-studio-knowledge', version: 1, sources: [], cards: [] });

// External imports are always team-authored material, regardless of a claimed
// publisher kind. A link does not establish editorial or coaching validation.
export function validateKnowledgePack(raw) {
  if (object(raw) && validatedPacks.has(raw)) return raw;
  return validated(normalizePack(raw));
}

export function parseKnowledgeText(raw, { name = 'team-notes.txt', title, url } = {}) {
  if (typeof raw !== 'string' || bytes(raw) > KNOWLEDGE_LIMITS.importBytes) invalid('导入文本须小于 1 MB');
  if (!raw.trim()) invalid('文件没有可导入的文本');
  if (/\.json$/i.test(name) || /^\s*\{/u.test(raw)) return validateKnowledgePack(raw);
  const sourceTitle = clean(title || name, 180, '来源标题', true);
  const sourceId = `team:text:${fingerprint({ name, raw })}`;
  const source = { id: sourceId, title: sourceTitle, kind: 'team', documentName: clean(name, 240, '文件名', true), revision: fingerprint(raw), ...(url ? { url } : {}) };
  const cards = []; let heading = sourceTitle, pending = [];
  const push = () => {
    const body = pending.join('\n').trim(); pending = [];
    if (!body) return;
    // Chunk paragraphs first; split exceptionally long paragraphs without loss.
    let chunk = '';
    const emit = () => { if (!chunk.trim()) return; const content = chunk.trim(), id = `text:${cards.length + 1}:${fingerprint({ heading, content })}`; cards.push({ id, sourceId, title: heading, content, tags: [], coverages: [], appliesWhen: [], exceptions: [], figures: [] }); chunk = ''; };
    for (const paragraph of body.split(/\n\s*\n/u)) {
      let rest = paragraph;
      while (rest.length > KNOWLEDGE_LIMITS.contentChars) { emit(); chunk = rest.slice(0, KNOWLEDGE_LIMITS.contentChars); emit(); rest = rest.slice(KNOWLEDGE_LIMITS.contentChars); }
      if (chunk && chunk.length + rest.length + 2 > KNOWLEDGE_LIMITS.contentChars) emit();
      chunk += (chunk ? '\n\n' : '') + rest;
    }
    emit();
  };
  for (const line of raw.replace(/\r\n?/g, '\n').split('\n')) {
    const match = /^#{1,6}\s+(.+)$/u.exec(line);
    if (match) { push(); heading = match[1].trim().slice(0, 180) || sourceTitle; }
    else pending.push(line);
  }
  push();
  if (!cards.length) invalid('文件没有可导入的正文');
  return validateKnowledgePack({ format: 'playbook-studio-knowledge', version: 1, sources: [source], cards });
}

export function mergeKnowledgePacks(packs) {
  if (!Array.isArray(packs) || packs.length > KNOWLEDGE_LIMITS.sources) invalid('知识库合并数量超出限制');
  if (!packs.length) return EMPTY_KNOWLEDGE_PACK;
  if (packs.length === 1) return validateKnowledgePack(packs[0]);
  const sources = new Map(), cards = new Map();
  for (const input of packs) {
    const pack = validateKnowledgePack(input);
    for (const source of pack.sources) {
      const { contentHash: _hash, ...plain } = source;
      if (sources.has(source.id) && JSON.stringify(sources.get(source.id)) !== JSON.stringify(plain)) invalid('同一来源 ID 对应不同来源版本，请使用新的来源 ID');
      sources.set(source.id, plain);
    }
    for (const card of pack.cards) {
      const key = `${card.sourceId}\u0000${card.id}`;
      if (cards.has(key) && JSON.stringify(cards.get(key)) !== JSON.stringify(card)) invalid('同一卡片 ID 对应不同内容，请使用新的卡片或来源 ID');
      cards.set(key, card);
    }
  }
  return validateKnowledgePack({ format: 'playbook-studio-knowledge', version: 1, sources: [...sources.values()], cards: [...cards.values()] });
}

const ALIASES = [
  ['cover3', /\bcover\s*3\b|\bc3\b|三深|三区|三分区/iu],
  ['cover2', /\bcover\s*2\b|\bc2\b|两深|双深|两分区/iu],
  ['man', /\bman(?:[ -]to[ -]man)?\b|盯人|人盯人/iu],
  ['match', /\bmatch\b|匹配|交接/iu], ['hank', /\bhank\b/iu],
  ['hook', /\bhook\b|钩区|勾区|勾型/iu], ['curl', /\bcurl\b|卷曲|回卷/iu],
  ['flat', /\bflat\b|平区|平传|外摆|外侧短区/iu],
  ['mesh', /\bmesh\b|浅交叉|交叉概念/iu], ['crossing', /\bcross(?:er|ing)?s?\b|交叉|横穿/iu],
  ['spacing', /\bspacing\b|间距|空间分布/iu], ['snag', /\bsnag\b/iu], ['hitch', /\bhitch\b|急停/iu],
  ['flood', /\bflood\b|洪水|多层拉伸/iu], ['fourstrong', /\b4\s*strong\b|\bfour\s*strong\b|四强侧|四人强侧/iu],
  ['wheel', /\bwheel\b|轮转路线|轮型|轮子/iu], ['post', /\bpost\b|内斜深|邮递/iu],
  ['out', /\bout\b|外切/iu], ['smash', /\bsmash\b/iu], ['fade', /\bfade\b|淡出/iu],
  ['pressure', /\bpressure\b|施压|压迫|压力/iu], ['blitz', /\bblitz\b|突袭|闪击/iu],
  ['protection', /\bprotect(?:ion)?\b|保护|阻挡/iu], ['release', /\brelease\b|释放|摆脱/iu],
  ['press', /\bpress\b|近身|贴身/iu], ['lowhole', /\blow[ -]?hole\b|低洞|中间协防/iu],
  ['assignment', /\bassignments?\b|责任|指派/iu], ['timing', /\btiming\b|时序|时机|节奏/iu],
  ['quarterback', /\bquarterback\b|\bqb\b|四分卫/iu], ['read', /\bread\b|阅读/iu],
];
function terms(value) {
  const normalized = String(value).normalize('NFKC').toLowerCase();
  const out = new Set(normalized.match(/[a-z][a-z0-9_]{1,39}/g) || []);
  for (const [alias, pattern] of ALIASES) if (pattern.test(normalized)) out.add(alias);
  // Chinese bigrams support team-specific vocabulary without an external model.
  for (const sequence of normalized.match(/[\u3400-\u9fff]+/gu) || []) for (let i = 0; i < sequence.length - 1; i++) out.add(sequence.slice(i, i + 2));
  return out;
}
function displayCard(card, locale) {
  const translation = card.translations?.[locale];
  const { translations: _translations, ...plain } = card;
  return translation ? { ...plain, ...translation } : plain;
}

function compiledKnowledge(imported) {
  const existing = compiledIndexes.get(imported);
  if (existing) return existing;
  const all = [BUILTIN_KNOWLEDGE_PACK, ...(imported.cards.length ? [imported] : [])].flatMap(pack => {
    const sources = new Map(pack.sources.map(source => [source.id, source]));
    return pack.cards.map(card => {
      const titleTerms = terms(card.title + ' ' + (card.translations?.en?.title || ''));
      const tagTerms = terms(card.tags.join(' '));
      const bodyTerms = terms(card.content + ' ' + (card.translations?.en?.content || ''));
      return { card, source: sources.get(card.sourceId), builtin: pack === BUILTIN_KNOWLEDGE_PACK, titleTerms, tagTerms, bodyTerms, documentTerms: new Set([...titleTerms, ...tagTerms, ...bodyTerms]) };
    });
  });
  const frequencies = new Map();
  for (const item of all) for (const term of item.documentTerms) frequencies.set(term, (frequencies.get(term) || 0) + 1);
  const result = { all, frequencies, allByKey: new Map(all.map(item => [`${item.card.sourceId}\u0000${item.card.id}`, item])) };
  // Weak keys keep discarded playbooks and document content collectible. No
  // content-addressed global cache retains private team installation text.
  compiledIndexes.set(imported, result);
  return result;
}

export function retrieveKnowledge({ query = '', coverage = 'unknown', packs = [], limit = 6, locale = 'zh-CN' } = {}) {
  if (typeof query !== 'string') invalid('检索问题须为文本');
  if (!COVERAGES.has(coverage)) invalid('不支持的覆盖类型');
  if (!Array.isArray(packs) || packs.length > KNOWLEDGE_LIMITS.sources) invalid('知识库数量超出限制');
  if (!Number.isInteger(limit) || limit < 0 || limit > KNOWLEDGE_LIMITS.retrievedCards) invalid('一次最多检索 6 张卡片');
  if (!limit) return [];
  const imported = packs.length ? mergeKnowledgePacks(packs) : EMPTY_KNOWLEDGE_PACK;
  const { all, frequencies, allByKey } = compiledKnowledge(imported);
  const q = terms(query.slice(0, KNOWLEDGE_LIMITS.queryChars));
  const eligible = item => coverage === 'unknown' || !item.card.coverages.length || item.card.coverages.includes(coverage);
  const candidates = all.filter(eligible).map(item => {
    const title = item.titleTerms, tags = item.tagTerms, body = item.bodyTerms;
    const matched = [...q].filter(term => title.has(term) || tags.has(term) || body.has(term));
    // Rare matching terms outrank broad terms. Scores are retrieval internals,
    // never probabilities, coaching confidence or output UI values.
    let rank = 0;
    for (const term of matched) {
      const frequency = frequencies.get(term) || 0;
      rank += Math.log(1 + all.length / (1 + frequency)) * (tags.has(term) ? 3 : title.has(term) ? 2 : 0.8);
    }
    if (coverage !== 'unknown' && item.card.coverages.includes(coverage)) rank += q.size ? 0.6 : 2;
    if (!matched.length && q.size) rank = 0;
    return { ...item, rank, matched };
  }).filter(item => item.rank > 0).sort((a, b) => b.rank - a.rank || a.card.sourceId.localeCompare(b.card.sourceId) || a.card.id.localeCompare(b.card.id));
  const chosen = [], seen = new Set();
  const outputCard = (item, parent = false) => {
    const card = displayCard(item.card, locale), conditional = coverage === 'unknown' && card.coverages.length > 0;
    const en = locale === 'en';
    const matchReasons = [parent ? (en ? 'Explicit parent context from the same source' : '同来源的显式父卡片上下文') : (en ? 'Relevant terms: ' : '相关词：') + item.matched.slice(0, 8).join(' / ')];
    if (conditional) matchReasons.push(en ? 'Coverage is unconfirmed; applicability remains conditional' : '覆盖未确认；适用性仍待核实');
    else if (card.coverages.length) matchReasons.push(en ? 'Coverage matches; other conditions remain unverified' : '覆盖类型一致；其余适用条件仍待核实');
    return { ...card, source: { ...item.source }, evidenceId: item.builtin ? `knowledge:${card.id}` : `knowledge:team:${encodeURIComponent(card.sourceId)}:${encodeURIComponent(card.id)}`, matchReasons, applicability: conditional ? 'conditional' : card.coverages.length ? 'coverage_matched' : 'general' };
  };
  for (const item of candidates) {
    const chain = []; let next = item, incompatible = false;
    while (next) {
      const key = `${next.card.sourceId}\u0000${next.card.id}`;
      if (!seen.has(key)) chain.push({ key, output: outputCard(next, next !== item) });
      if (!next.card.parentId) break;
      next = allByKey.get(`${next.card.sourceId}\u0000${next.card.parentId}`);
      if (!next || !eligible(next)) { incompatible = true; break; }
    }
    // A retrieved subset must remain a valid knowledge pack. Admit a child and
    // every required ancestor atomically, or omit the whole candidate.
    if (incompatible || chosen.length + chain.length > limit) continue;
    const expanded = [...chosen, ...chain.map(part => part.output)];
    if (bytes(expanded) > KNOWLEDGE_LIMITS.retrievedBytes) continue;
    for (const part of chain) { seen.add(part.key); chosen.push(part.output); }
    if (chosen.length >= limit) break;
  }
  return chosen;
}
