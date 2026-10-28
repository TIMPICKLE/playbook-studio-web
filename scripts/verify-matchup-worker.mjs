// Runs the actual agent in a local workerd isolate using a synthetic provider.
import { build } from 'esbuild';
import { Miniflare } from 'miniflare';
import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const source = `
  import { starterWorkspace } from './web/model.js';
  import { buildMatchup } from './server/matchup.mjs';
  import { runMatchupAgent } from './server/matchup-agent.mjs';
  export default { async fetch() {
    const plays = starterWorkspace().plays;
    const matchup = buildMatchup(plays.find(p => p.book === 'offense'), plays.find(p => p.book === 'defense'), { coverage: 'unknown' });
    let calls = 0;
    globalThis.fetch = async (_url, options) => {
      const request = JSON.parse(options.body); calls++;
      if (calls === 1) {
        if (request.tool_choice?.function?.name !== 'get_matchup_context') throw new Error('missing required tool');
        return new Response(JSON.stringify({ choices: [{ message: { content: null, tool_calls: [{ id: 'ctx', type: 'function', function: { name: 'get_matchup_context', arguments: '{}' } }] } }] }));
      }
      if (!request.messages.some(m => m.role === 'tool' && m.tool_call_id === 'ctx')) throw new Error('missing tool response');
      const content = JSON.stringify({ summary: 'synthetic', scenarios: [{ title: 'A', condition: 'if', observation: 'observe', possibility: 'possible', limitations: 'unknown', evidenceIds: [matchup.evidence[0].id] }], missingInfo: [] });
      return new Response(JSON.stringify({ choices: [{ message: { content } }] }));
    };
    const result = await runMatchupAgent(matchup, { model: { provider: 'deepseek', model: 'test-model', apiKey: 'fake-test-key' } }, {}, new AbortController().signal);
    return Response.json({ calls, execution: result.execution, status: result.status });
  } };
`;
let mf;
try {
  const bundled = await build({ stdin: { contents: source, resolveDir: projectRoot, sourcefile: 'worker-agent-poc.mjs' }, bundle: true, platform: 'node', format: 'esm', target: 'es2022', write: false, logLevel: 'silent' });
  mf = new Miniflare({ modules: true, script: bundled.outputFiles[0].text, compatibilityDate: '2026-05-15', compatibilityFlags: ['nodejs_compat'] });
  const response = await mf.dispatchFetch('https://agent-test.invalid/');
  const body = await response.json();
  if (response.status !== 200 || body.calls !== 2 || body.execution?.modelCalls !== 2 || body.execution?.toolCalls !== 1 || body.status !== 'limited') throw new Error('Worker returned an unexpected agent result');
  console.log('Worker agent graph, tool call and final validation passed.');
  await Promise.race([mf.dispose(), new Promise(resolve => setTimeout(resolve, 2000))]);
  process.exit(0);
} catch (error) {
  console.error('Worker agent verification failed:', error?.message || 'unknown error');
  if (mf) await Promise.race([mf.dispose(), new Promise(resolve => setTimeout(resolve, 2000))]);
  process.exit(1);
}
