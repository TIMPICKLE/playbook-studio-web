import test from 'node:test';
import assert from 'node:assert/strict';
import { loadEvaluationCases, evaluationPlay, assertEvaluationResult, runEvaluationCase, runEvaluation, evaluationProvenance } from '../scripts/eval-board-assistant.mjs';
import { buildAssistantEdit } from '../web/assistant-edit.js';

const catalog = { plays: [] };
test('evaluation corpus contains bilingual cases and every supported operation category', async () => {
  const cases = await loadEvaluationCases();
  assert.equal(cases.length, 50);
  assert.equal(new Set(cases.map(row => row.id)).size, cases.length);
  assert.ok(cases.some(row => row.locale === 'en') && cases.some(row => row.locale === 'zh-CN'));
  for (const kind of ['route','block','motion','move_player','pass','zone','timing','remove_route','annotate']) {
    assert.ok(cases.some(row => row.expect.operations?.some(op => op.kind === kind)), kind);
  }
  assert.ok(cases.every(row => row.instruction && row.expect.kind));
});

test('evaluation assertions detect wrong geometry even when the model claims the expected intent', () => {
  const before = evaluationPlay();
  const operation = {kind:'route',playerId:'x',concept:'dig',depthYards:12,breakTo:'inside'};
  const after = buildAssistantEdit(before, [], operation, 'en').play;
  after.routes.find(route => route.playerId === 'x').points[1].y = 59;
  const failures = assertEvaluationResult({expect:{kind:'edit',operations:[{...operation,depthYards:[11,13]}]}},
    {kind:'edit',operations:[operation]}, {before,after,catalog});
  assert.ok(failures.includes('rendered route break depth is outside expected yards'));
});

test('follow-up evaluations pass actual earlier edits and route IDs into a separate invocation', async () => {
  const cases = await loadEvaluationCases();
  const scenario = cases.find(row => row.id === 'followup-depth-zh');
  let calls = 0;
  const outcome = await runEvaluationCase(scenario, {catalog, model:{provider:'test',model:'mock'}, invoke:async input => {
    calls++;
    let depthYards = 10;
    let routeId;
    if (calls === 2) {
      assert.equal(input.previous.length, 1);
      const preceding = input.previous[0];
      assert.equal(preceding.operations[0].depthYards, 10);
      routeId = preceding.routeIds[0];
      assert.ok(input.board.routes.some(route => route.id === routeId));
      depthYards = preceding.operations[0].depthYards + 2;
    }
    return {kind:'edit',summary:'Measured dig',operations:[{kind:'route',playerId:'x',routeId,concept:'dig',depthYards,breakTo:'inside'}],modelCalls:2,toolsUsed:['read_board','resolve_player'],repairs:0};
  }});
  assert.equal(calls, 2);
  assert.equal(outcome.passed, true, JSON.stringify(outcome.turns.flatMap(turn => turn.failures)));
});


test('the Chinese depth follow-up starts at eight yards so its first ten-yard edit is meaningful', async () => {
  const scenario = (await loadEvaluationCases()).find(row => row.id === 'followup-depth-zh');
  assert.equal(scenario.setup, 'followup-depth');
  const play = evaluationPlay(scenario.setup);
  assert.equal((67 - play.routes.find(route => route.playerId === 'x').points[1].y) / 2, 8);
});

test('evaluation fingerprints exact source and fixture bytes while reporting Git dirtiness explicitly', async () => {
  const cases = (await loadEvaluationCases()).slice(0, 1);
  const provenance = await evaluationProvenance(cases);
  assert.match(provenance.sourceSha256, /^[a-f0-9]{64}$/);
  assert.match(provenance.fixtureSha256, /^[a-f0-9]{64}$/);
  assert.match(provenance.selectedCasesSha256, /^[a-f0-9]{64}$/);
  assert.ok(provenance.worktreeDirty === null || typeof provenance.worktreeDirty === 'boolean');
  assert.ok(provenance.files.some(file => file.path === 'web/assistant-harness.js'));
});

test('provider requests and tool errors are counted separately from model repairs', async () => {
  const scenario = (await loadEvaluationCases()).find(row => row.id === 'ambiguous-dt-zh');
  const report = await runEvaluation([scenario], {catalog,model:{provider:'test',model:'mock'},invoke:async input => {
    input.onEvent({type:'tool',name:'resolve_player',summary:'{"error":"Missing anchor"}'});
    return {kind:'clarify',message:'Which tackle?',modelCalls:1,providerCalls:2,toolsUsed:['resolve_player'],repairs:0};
  }});
  assert.equal(report.providerCalls, 2);
  assert.equal(report.toolErrors, 1);
  assert.equal(report.repairs, 0);
  assert.equal(report.passed, 1);
});
