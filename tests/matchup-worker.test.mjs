import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

test('actual LangGraph agent runs in a Worker isolate with a synthetic model', () => {
  const env = { ...process.env };
  for (const name of Object.keys(env)) if (/^(LANGSMITH_|LANGCHAIN_|OTEL_|OPENAI_API_KEY)/.test(name)) delete env[name];
  const result = spawnSync(process.execPath, ['scripts/verify-matchup-worker.mjs'], { encoding: 'utf8', env, timeout: 30000 });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /Worker agent graph, tool call and final validation passed/);
});
