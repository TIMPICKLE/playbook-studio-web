import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import * as runtime from '@langchain/langgraph';
import { requestBoardAssistant, DEFAULT_BOARD_MODEL } from '../web/assistant-provider.js';
import { makePlay, formationPlayers, validatePlay } from '../web/model.js';
import { assistantPlayers, buildAssistantEdit } from '../web/assistant-edit.js';
import { hasEditableTrace } from '../web/madden-model.js';

const corpusURL = new URL('../evals/board-assistant/cases.json', import.meta.url);
const catalogURL = new URL('../web/data/huddle-catalog.json', import.meta.url);
export const loadEvaluationCases = async () => JSON.parse(await readFile(corpusURL, 'utf8')).cases;

// Stable IDs make assertions independent of generated editor IDs. All names are synthetic.
export function evaluationPlay(setup) {
  const play = makePlay({ title: 'Evaluation · Gun Doubles', formation: 'Gun Doubles' });
  play.id = 'eval-play';
  play.notes = '';
  for (const player of play.players) player.id = player.label.toLowerCase();
  const defense = formationPlayers('4–3', 11, 'defense');
  const defenseIds = ['de-left', 'dt-front', 'dt-right', 'de-right', 'avery', 'mike', 'sam', 'cb-left', 'cb-right', 'ss', 'fs'];
  for (const [index, player] of defense.entries()) {
    player.id = defenseIds[index];
    if (player.id === 'dt-front') player.x = 50;
    if (player.id === 'mike') { player.label = 'MLB'; player.name = 'Mike Johnson'; }
    if (player.id === 'avery') { player.label = 'WLB'; player.name = 'Avery Smith'; }
    if (player.id === 'sam') player.label = 'SAM';
    if (setup === 'duplicate-avery' && player.id === 'mike') player.name = 'Avery Jones';
  }
  play.players.push(...defense);
  const names = { qb: 'Casey Smith', x: 'Alex Chen', y: 'Jordan Lee', z: '王建明', h: '王建华' };
  for (const player of play.players) if (names[player.id]) player.name = names[player.id];
  play.ball = { holderId: 'qb', receiverId: '', passAt: 2, arriveAt: 3 };
  const seeded = buildAssistantEdit(play, [], [
    { kind: 'route', playerId: 'x', concept: 'dig', depthYards: setup === 'followup-depth' ? 8 : 10, breakTo: 'inside' },
    { kind: 'route', playerId: 'y', concept: 'out', depthYards: 6, breakTo: 'outside' },
    { kind: 'route', playerId: 'z', concept: 'post', depthYards: 10, breakTo: 'inside' },
  ], 'en').play;
  for (const route of seeded.routes) route.id = 'route-' + route.playerId;
  return validatePlay(seeded);
}

const sha256 = value => createHash('sha256').update(value).digest('hex');
const sourcePaths = [
  'scripts/eval-board-assistant.mjs', 'package-lock.json',
  'web/assistant-provider.js', 'web/assistant-harness.js', 'web/assistant-tools.js',
  'web/assistant-schema.js', 'web/assistant-proposal.js', 'web/assistant-edit.js',
  'web/assistant-operations.js', 'web/assistant-search.js', 'web/madden-model.js',
  'web/madden-concepts.js', 'web/model.js', 'web/model-values.js',
  'web/locales/assistant-provider.js', 'web/locales/assistant-edit.js',
  'web/data/huddle-catalog.json', 'web/data/madden-search-tags.js',
  'web/data/madden-editable.js', 'web/vendor/assistant-zod.js', 'web/vendor/assistant-langgraph.js',
];
export async function evaluationProvenance(cases) {
  const repositoryRoot = new URL('../', import.meta.url);
  const files = await Promise.all(sourcePaths.sort().map(async name => ({path:name,sha256:sha256(await readFile(new URL(name, repositoryRoot)))})));
  const fixtureSha256 = sha256(await readFile(corpusURL));
  let codeCommit = null, worktreeDirty = null, dirtyPaths = [];
  try {
    codeCommit = execFileSync('git', ['rev-parse', 'HEAD'], {cwd:repositoryRoot,encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim();
    const status = execFileSync('git', ['status', '--porcelain', '--untracked-files=all'], {cwd:repositoryRoot,encoding:'utf8',stdio:['ignore','pipe','ignore']}).trimEnd();
    worktreeDirty = status.length > 0;
    dirtyPaths = status ? status.split('\n').map(line => line.slice(3)) : [];
  } catch { /* The byte fingerprints remain valid outside a Git checkout. */ }
  return {fingerprintVersion:1,codeCommit,worktreeDirty,dirtyPaths,sourceSha256:sha256(JSON.stringify(files)),fixtureSha256,
    selectedCasesSha256:sha256(JSON.stringify(cases)),files};
}
function toolErrorCount(events) {
  return events.filter(event => {
    if (event.type === 'tool_error') return true;
    if (event.type !== 'tool') return false;
    try { return !!JSON.parse(event.summary)?.error; } catch { return false; }
  }).length;
}

const inRange = (value, expected) => typeof value === 'number' && value >= expected[0] && value <= expected[1];
const operationList = result => result.operations || (result.operation ? [result.operation] : []);
function matchesOperation(actual, expected) {
  return Object.entries(expected).every(([key, value]) => {
    if (key === 'textIncludes') return typeof actual.text === 'string' && actual.text.includes(value);
    if (key === 'depthYards' || key === 'dxYards' || key === 'dyYards' || key === 'throwAt' || key === 'arriveAt' || key === 'delay' || key === 'duration') return inRange(actual[key], value);
    if (key === 'concept' && Array.isArray(value)) return value.includes(actual[key]);
    if (key === 'playerIds') return Array.isArray(actual.playerIds) && value.length === actual.playerIds.length && value.every(id => actual.playerIds.includes(id));
    if (key === 'targetIds') return JSON.stringify(actual[key]) === JSON.stringify(value);
    return actual[key] === value;
  });
}

export function assertEvaluationResult(testCase, result, { before, after, previousRouteIds = [], catalog } = {}) {
  const expected = testCase.expect;
  const failures = [];
  const check = (condition, text) => { if (!condition) failures.push(text); };
  check(result.kind === expected.kind, `expected ${expected.kind}, received ${result.kind}`);
  if (result.kind !== expected.kind) return failures;
  const operations = operationList(result);
  if (expected.operationCount != null) check(operations.length === expected.operationCount, `expected ${expected.operationCount} operations`);
  for (const operation of expected.operations || []) {
    let found = operations.some(actual => matchesOperation(actual, operation));
    if (!found && operation.playerIds) {
      // A group may be expressed as several equivalent per-player operations.
      const { playerIds, ...single } = operation;
      found = playerIds.every(playerId => operations.some(actual => matchesOperation(actual, { ...single, playerId })));
    }
    check(found, `operation mismatch: ${JSON.stringify(operation)}`);
  }
  if (result.kind === 'edit' && after) {
    const changed = after.routes.filter(route => JSON.stringify(before.routes.find(old => old.id === route.id)) !== JSON.stringify(route));
    if (expected.sameRouteIds) check(changed.length > 0 && changed.every(route => previousRouteIds.includes(route.id)), 'follow-up must change the previously applied route IDs');
    for (const op of expected.operations || []) {
      if (op.kind === 'route' && op.depthYards && ['dig', 'out', 'in', 'go', 'seam', 'post', 'corner'].includes(Array.isArray(op.concept) ? op.concept[0] : op.concept)) {
        const route = after.routes.find(route => route.playerId === op.playerId && route.kind === 'route' && !route.optional);
        const point = route?.points[1];
        check(point && inRange((67 - point.y) / 2, op.depthYards), 'rendered route break depth is outside expected yards');
        if (point && ['dig', 'in'].includes(op.concept)) {
          const end = route.points.at(-1);
          check(point.x < 50 ? end.x > point.x : end.x < point.x, 'rendered dig must break inside');
        }
      }
      if (op.kind === 'timing') {
        const old = before.routes.find(route => route.playerId === op.playerId && !route.optional && route.kind === 'route');
        const route = after.routes.find(route => route.id === old?.id);
        check(route && JSON.stringify(route.points) === JSON.stringify(old.points), 'timing must preserve route geometry');
      }
      if (op.kind === 'remove_route') check(!after.routes.some(route => route.playerId === op.playerId && !route.optional && route.kind === 'route') && after.players.some(player => player.id === op.playerId), 'remove route must retain the player');
      if (op.kind === 'motion') {
        const motion = after.routes.find(route => route.playerId === op.playerId && route.kind === 'motion' && !route.optional);
        check(!!motion, 'motion route missing');
        const following = after.routes.find(route => route.playerId === op.playerId && route.kind === 'route' && !route.optional);
        if (motion && following) check(JSON.stringify(following.points[0]) === JSON.stringify(motion.points.at(-1)) && following.delay >= motion.delay + motion.duration, 'post-motion route must start at motion end and wait');
      }
    }
  }
  if (result.kind === 'search') {
    const matches = result.matches || [];
    check(matches.length >= (expected.minMatches || 0) && matches.length <= (expected.maxMatches ?? 4), 'unexpected recommendation count');
    check(new Set(matches.map(match => match.id)).size === matches.length, 'duplicate recommendations');
    check(matches.every(match => catalog?.plays.some(play => play.id === match.id) && typeof match.reason === 'string' && match.reason.trim()), 'recommendations must reference catalog rows with reasons');
    if (expected.editableOnly) check(matches.every(match => hasEditableTrace(match.id)), 'recommendations include an image-only play');
  }
  if (expected.usedTool) check(result.toolsUsed?.includes(expected.usedTool), `expected tool ${expected.usedTool}`);
  if (expected.highlight) check(result.highlights?.includes(expected.highlight), `expected highlight ${expected.highlight}`);
  if (expected.messageAny) check(expected.messageAny.some(term => String(result.message).toLowerCase().includes(term.toLowerCase())), 'answer lacks expected qualification or subject');
  if (expected.playId) check(result.playId === expected.playId, 'handoff did not retain the current play ID');
  return failures;
}

export async function runEvaluationCase(testCase, { model, catalog, invoke = requestBoardAssistant } = {}) {
  let play = evaluationPlay(testCase.setup);
  let previous = [], previousRouteIds = [];
  const turns = [];
  const started = performance.now();
  for (const [index, turn] of (testCase.turns || [testCase]).entries()) {
    const events = [];
    const before = play;
    const turnStarted = performance.now();
    try {
      const result = await invoke({ instruction: turn.instruction, mode: testCase.mode, locale: testCase.locale,
        board: { ...play, play, playId: play.id, players: assistantPlayers(play, []), selectedPlayerId: 'x' }, previous,
        model, runtime, loadCatalog: async () => catalog, onEvent: event => events.push(event) });
      let change;
      if (result.kind === 'edit') change = buildAssistantEdit(play, [], operationList(result), testCase.locale);
      const failures = assertEvaluationResult({ ...testCase, expect: turn.expect }, result,
        { before, after: change?.play, previousRouteIds, catalog });
      const routeIds = change?.routeIds || (change?.routeId ? [change.routeId] : []);
      turns.push({ turn: index + 1, instruction: turn.instruction, passed: !failures.length, failures,
        result, modelCalls: result.modelCalls || 0, providerCalls: result.providerCalls ?? events.filter(event => event.type === 'provider_call').length,
        toolCalls: result.toolsUsed?.length || 0, toolErrors: toolErrorCount(events),
        repairs: result.repairs ?? events.filter(event => event.type === 'validation_error').length,
        durationMs: Math.round(performance.now() - turnStarted), events });
      previous = [...previous, { instruction: turn.instruction, kind: result.kind,
        summary: result.summary || result.message || change?.summary || '', operations: operationList(result),
        routeIds, playerIds: [...new Set(operationList(result).flatMap(op => [op.playerId, ...(op.playerIds || [])].filter(Boolean)))] }].slice(-5);
      if (change) { play = change.play; previousRouteIds = routeIds; }
      if (failures.length) break;
    } catch (error) {
      turns.push({ turn: index + 1, instruction: turn.instruction, passed: false, failures: [error.message],
        modelCalls: events.filter(event => event.type === 'model_step').length,
        providerCalls: events.filter(event => event.type === 'provider_call').length, toolErrors: toolErrorCount(events),
        toolCalls: events.filter(event => event.type === 'tool').length,
        repairs: events.filter(event => event.type === 'validation_error').length,
        durationMs: Math.round(performance.now() - turnStarted), events });
      break;
    }
  }
  return { id: testCase.id, category: testCase.category, locale: testCase.locale, passed: turns.every(turn => turn.passed),
    durationMs: Math.round(performance.now() - started), turns };
}

export async function runEvaluation(cases, options) {
  const provenance = await evaluationProvenance(cases);
  const outcomes = new Array(cases.length);
  let next = 0;
  const concurrency = options.concurrency ?? 1;
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 4) throw new Error('Concurrency must be an integer from 1 to 4');
  async function worker() {
    while (next < cases.length) {
      const index = next++;
      const outcome = await runEvaluationCase(cases[index], options);
      outcomes[index] = outcome;
      options.onCase?.(outcome);
    }
  }
  await Promise.all(Array.from({length: Math.min(concurrency, cases.length)}, worker));
  const turns = outcomes.flatMap(outcome => outcome.turns);
  const passed = outcomes.filter(outcome => outcome.passed).length;
  const categories = Object.fromEntries([...new Set(cases.map(testCase => testCase.category))].map(category => {
    const rows = outcomes.filter(outcome => outcome.category === category);
    return [category, { total: rows.length, passed: rows.filter(row => row.passed).length }];
  }));
  return { generatedAt: new Date().toISOString(), provenance, provider: options.model.provider, model: options.model.model,
    cases: outcomes.length, passed, passRate: outcomes.length ? passed / outcomes.length : 0,
    modelCalls: turns.reduce((total, turn) => total + turn.modelCalls, 0),
    providerCalls: turns.reduce((total, turn) => total + turn.providerCalls, 0),
    toolErrors: turns.reduce((total, turn) => total + turn.toolErrors, 0),
    toolCalls: turns.reduce((total, turn) => total + turn.toolCalls, 0),
    repairs: turns.reduce((total, turn) => total + turn.repairs, 0),
    durationMs: outcomes.reduce((total, outcome) => total + outcome.durationMs, 0), categories, outcomes };
}

function parseArguments(args) {
  const options = { run: false, list: false, model: process.env.BOARD_ASSISTANT_MODEL || DEFAULT_BOARD_MODEL,
    provider: process.env.BOARD_ASSISTANT_PROVIDER || 'openai', concurrency: 1, limit: Infinity, pattern: '', out: '' };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--run') options.run = true;
    else if (arg === '--list') options.list = true;
    else if (['--model', '--provider', '--limit', '--case', '--out', '--concurrency'].includes(arg)) {
      if (!args[i + 1]) throw new Error('Missing value for ' + arg);
      const key = arg === '--case' ? 'pattern' : arg.slice(2);
      options[key] = args[++i];
    } else throw new Error('Unknown argument ' + arg);
  }
  options.concurrency = Number(options.concurrency);
  if (!Number.isInteger(options.concurrency) || options.concurrency < 1 || options.concurrency > 4) throw new Error('--concurrency must be an integer from 1 to 4');
  options.limit = Number(options.limit);
  if (!(options.limit > 0)) throw new Error('--limit must be positive');
  return options;
}
async function main() {
  const options = parseArguments(process.argv.slice(2));
  const cases = (await loadEvaluationCases()).filter(testCase => !options.pattern || testCase.id.includes(options.pattern)).slice(0, options.limit);
  if (!cases.length) throw new Error('No evaluation cases selected');
  if (options.list || !options.run) {
    process.stdout.write(JSON.stringify(cases.map(({ id, category, locale, instruction, expect }) => ({ id, category, locale, instruction, expect })), null, 2) + '\n');
    return;
  }
  const apiKey = process.env.BOARD_ASSISTANT_API_KEY || process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('Set BOARD_ASSISTANT_API_KEY or OPENAI_API_KEY before --run. No requests were sent.');
  const catalog = JSON.parse(await readFile(catalogURL, 'utf8'));
  const report = await runEvaluation(cases, { concurrency: options.concurrency, model: { provider: options.provider, model: options.model, apiKey }, catalog,
    onCase(outcome) { process.stderr.write(`${outcome.passed ? 'PASS' : 'FAIL'} ${outcome.id}\n`); } });
  if (options.out) {
    const target = path.resolve(options.out);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, JSON.stringify(report, null, 2) + '\n');
  }
  process.stdout.write(JSON.stringify({ provider: report.provider, model: report.model, cases: report.cases, passed: report.passed,
    passRate: report.passRate, modelCalls: report.modelCalls, providerCalls: report.providerCalls, toolCalls: report.toolCalls,
    toolErrors: report.toolErrors, repairs: report.repairs, provenance: report.provenance,
    durationMs: report.durationMs, categories: report.categories }, null, 2) + '\n');
  if (report.passed !== report.cases) process.exitCode = 1;
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main().catch(error => {
  process.stderr.write(error.message + '\n');
  process.exitCode = 1;
});
