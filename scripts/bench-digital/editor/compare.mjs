// Compare two saved browser summaries or two complete Node result files.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [baselineFile, candidateFile] = process.argv.slice(2);
if (!baselineFile || !candidateFile) throw Error('Usage: node scripts/bench-digital/editor/compare.mjs <baseline.json> <candidate.json>');
const [base, candidate] = await Promise.all([baselineFile, candidateFile].map(async path => JSON.parse(await readFile(path, 'utf8'))));
const context = report => report.context || report.manifest;
for (const key of ['fixtureSHA256', 'viewport', 'devicePixelRatio', 'svgViewBox', 'stageSize', 'renderer', 'effects', 'clock']) {
  if (context(base)[key] !== undefined && context(candidate)[key] !== undefined) assert.deepEqual(context(base)[key], context(candidate)[key], key);
}
for (const key of ['environment', 'rounds', 'samplesPerRound', 'poseChecks', 'poses']) assert.deepEqual(base[key], candidate[key], key);
if (base.stageSizes && candidate.stageSizes) assert.deepEqual(base.stageSizes, candidate.stageSizes, 'stage sizes');
const endpoints = result => result.ends.map(({ time, pose, round, variant }) => [round, variant, time, pose]);
assert.deepEqual(endpoints(base), endpoints(candidate), 'final player, ball, clock, and playback phase by round');
for (const type of ['single', 'burst12']) {
  assert.equal(candidate[type].inputs, base[type].inputs, type + ' input count');
  assert.equal(candidate[type].draws, candidate[type].samples, type + ' must present the latest value once per frame');
  const { p50, p95 } = base[type].toLayoutMs, next = candidate[type].toLayoutMs;
  console.log(type, JSON.stringify({ inputs: base[type].inputs, draws: [base[type].draws, candidate[type].draws],
    toLayoutP50Ms: [p50, next.p50], toLayoutP95Ms: [p95, next.p95], poseChecks: candidate.poseChecks }));
}
