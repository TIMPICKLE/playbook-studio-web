import test from 'node:test';
import assert from 'node:assert/strict';
import { boardAssistantInput, requestBoardAssistant } from '../web/assistant-provider.js';
import { runBoardAssistant } from '../web/assistant-harness.js';
import * as runtime from '@langchain/langgraph';
import { handleApi } from '../server/api.mjs';
import { database } from './helpers/db.mjs';

const board = { playId: 'p1', players: [
  { id: 'c', label: 'C', name: 'Coach Example', side: 'offense', x: 50, y: 50 },
  { id: 'd', label: 'DT', side: 'defense', x: 50, y: 45 },
  { id: 'l', label: 'LB', name: 'Avery', side: 'defense', x: 48, y: 25 },
] };
const model = { provider: 'openai', apiKey: 'unit-test-key' };
const edit = { kind: 'edit', operation: { kind: 'block', playerId: 'c', targetIds: ['d', 'l'] } };
const invoke = (name, args, id = name) => ({ id, type: 'function', function: { name, arguments: JSON.stringify(args) } });
const resolve = (args, id) => invoke('resolve_player', args, id);
const calls = (...tool_calls) => ({ role: 'assistant', content: null, tool_calls });
const final = obj => ({ role: 'assistant', content: JSON.stringify(obj) });
const response = m => Response.json({ choices: [{ message: m }] });
const messageAfter = (messages, callId) => JSON.parse(messages.find(m => m.tool_call_id === callId).content);

function editModel(messages) {
  const results = messages.filter(m => m.role === 'tool');
  if (!results.length) return calls(resolve({ role: 'C' }, 'center'), resolve({ name: 'Avery', role: 'LB' }, 'backer'));
  if (results.length === 2) {
    const center = messageAfter(messages, 'center').candidates[0];
    return calls(resolve({ role: 'DT', relation: 'in_front', relativeToId: center.id }, 'tackle'));
  }
  return final(edit);
}

test('static browser LangGraph resolves a relative and named opponent through native multi-turn tools', async () => {
  let count = 0;
  const result = await requestBoardAssistant({ instruction: 'C blocks DT then Avery', board, model,
    fetchImpl: async(url, opts) => {
      count++;
      assert.equal(url, 'https://api.openai.com/v1/chat/completions');
      assert.equal(opts.headers.Authorization, 'Bearer unit-test-key');
      assert.doesNotMatch(opts.body, /Coach Example|unit-test-key/);
      const payload = JSON.parse(opts.body);
      assert.equal(payload.model, 'gpt-6.1-terra');
      assert.equal(payload.reasoning_effort, 'none');
      assert.ok(payload.tools.some(t => t.function.name === 'resolve_player'));
      return response(editModel(payload.messages));
    } });
  assert.deepEqual(result.operation, edit.operation);
  assert.deepEqual(result.toolsUsed, ['resolve_player', 'resolve_player', 'resolve_player']);
  assert.equal(count, 3);
});

test('the Terra compatibility setting is specific to the OpenAI model and endpoint', async () => {
  for (const [provider, modelId] of [['openai', 'another-model'], ['openrouter', 'gpt-6.1-terra']]) {
    await requestBoardAssistant({ instruction: 'Clarify', board, model: { ...model, provider, model: modelId },
      fetchImpl: async (_url, { body }) => {
        assert.equal('reasoning_effort' in JSON.parse(body), false);
        return response(final({ kind: 'clarify', message: 'Which player?' }));
      } });
  }
});

test('harness repairs an invented ID once, and bounds a model that repeatedly calls tools', async () => {
  const input = boardAssistantInput({ instruction: 'edit', board });
  let count = 0;
  await assert.rejects(runBoardAssistant({ input, runtime, callModel: async() => {count++; return final(edit);} }));
  assert.equal(count, 2);
  count = 0;
  await assert.rejects(runBoardAssistant({ input, runtime, callModel: async() => {count++; return calls(invoke('read_board', {}));} }), /上限/);
  assert.equal(count, 6);
});

test('a model can refine a zero-result catalog search before selecting a returned play', async () => {
  const input = boardAssistantInput({ instruction: 'Cover 3', board });
  const queries = [];
  const result = await runBoardAssistant({ input, runtime, searchCatalog: async args => {
    queries.push(args);
    return args.concepts.includes('flood') ? [{ id: 'flood', name: 'PA Flood' }] : [];
  }, callModel: async messages => {
    const tools = messages.filter(m => m.role === 'tool');
    if (!tools.length) return calls(invoke('search_madden', { concepts: ['no result'] }, 'first'));
    if (tools.length === 1 && !messageAfter(messages, 'first').candidates.length) return calls(invoke('search_madden', { concepts: ['flood'] }, 'refined'));
    return final({ kind: 'search', matches: [{ id: messageAfter(messages, 'refined').candidates[0].id, reason: 'Conditional sideline stretch.' }] });
  } });
  assert.deepEqual(queries, [{ concepts: ['no result'] }, { concepts: ['flood'] }]);
  assert.equal(result.matches[0].id, 'flood');
  assert.equal(result.modelCalls, 3);
});

test('worker enforces membership/revision and searches the packaged catalog independently of client candidates', async t => {
  const db = database(t), owner = { userId: 'coach', email: 'coach@example.com' }, viewer = { userId: 'player', email: 'player@example.com' };
  const post = async(path, user, body) => handleApi(new Request('https://test.local/api' + path, { method: 'POST',
    headers: { origin: 'https://test.local', 'content-type': 'application/json' }, body: JSON.stringify(body) }), { DB: db }, user);
  const book = await (await post('/workspaces', owner, { title: 'Board' })).json();
  const path = '/workspaces/' + book.id + '/board-assistant';
  const body = { board, instruction: 'find plays vs Cover 3', model: { ...model, model: 'test' }, revision: book.revision,
    candidates: [{ id: 'client-fake' }] };
  let count = 0, isEdit = false;
  t.mock.method(globalThis, 'fetch', async(_url, opts) => {
    count++;
    const { messages } = JSON.parse(opts.body);
    if (isEdit) return response(editModel(messages));
    if (messages.length === 2) return response(calls(invoke('search_madden', { concepts: ['flood'] }, 'find')));
    const row = messageAfter(messages, 'find').candidates[0];
    assert.match(row.name, /flood/i);
    assert.notEqual(row.id, 'client-fake');
    return response(final({ kind: 'search', matches: [{ id: row.id, reason: 'Sideline levels against a three-deep shell.' }] }));
  });
  assert.equal((await post(path, viewer, body)).status, 404);
  assert.equal((await post(path, owner, { ...body, revision: book.revision + 1 })).status, 409);
  assert.equal(count, 0);
  db.sql.prepare('INSERT INTO members(workspace_id,user_id,role,joined_at) VALUES(?,?,?,?)').run(book.id, viewer.userId, 'viewer', Date.now());
  assert.equal((await (await post(path, viewer, body)).json()).kind, 'search');
  isEdit = true;
  body.instruction = 'C blocks DT then Avery';
  assert.equal((await post(path, viewer, body)).status, 403);
  assert.deepEqual((await (await post(path, owner, body)).json()).operation, edit.operation);
});
