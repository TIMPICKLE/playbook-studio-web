import { mkdir, readFile, readdir, writeFile, access } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { createInterface } from 'node:readline/promises';
import { pathToFileURL } from 'node:url';
import { createFilmModel } from '../web/coach-film-model.js';

const limitMs = 30_000;
const groups = [
  [['A', 'control'], ['B', 'film']],
  [['A', 'film'], ['B', 'control']],
  [['B', 'control'], ['A', 'film']],
  [['B', 'film'], ['A', 'control']],
];
const validControl = value => value === 'baseline' || value === 'events';

export function assignment(code, comparator = 'baseline') {
  if (!/^[CP][1-4]$/.test(code) || !validControl(comparator)) throw Error('编号须为 C1…C4 或 P1…P4，对照选 baseline 或 events。');
  return groups[Number(code.slice(1)) - 1].map(([task, mode]) => ({
    task, mode: mode === 'control' ? comparator : mode,
  }));
}

export async function answerKey(task) {
  if (task !== 'A' && task !== 'B') throw Error('未知题目');
  const file = new URL(`../samples/coach-film/pilot-${task.toLowerCase()}.json`, import.meta.url);
  const { data } = JSON.parse(await readFile(file, 'utf8'));
  const play = data.plays[0], model = createFilmModel(play);
  const release = model.events.find(event => event.id === 'release');
  const players = ['H', 'Y'].map(label => play.players.find(p => p.label === label));
  if (!release || players.some(p => !p)) throw Error(`题目 ${task} 缺少出手事件或指定球员。`);
  const { comparison } = model.frameAt(release.time, players.map(p => p.id));
  const deeper = players.find(p => p.id === comparison?.deeperId);
  if (!deeper || comparison.gapYards == null) throw Error(`题目 ${task} 无唯一可核对的纵深答案。`);
  return { time: release.time, deeper: deeper.label };
}

export function scoreTrial({ elapsedMs, frame, deeper, evidence, prompted }, key) {
  const timed = Number.isFinite(elapsedMs) && elapsedMs >= 0 && elapsedMs <= limitMs;
  const frameCorrect = Number.isFinite(frame) && Math.abs(frame - key.time) <= 0.1 + 1e-9;
  const answerCorrect = deeper === key.deeper;
  return { frameCorrect, answerCorrect, success: timed && frameCorrect && answerCorrect && evidence === true && prompted === false };
}

function median(numbers) {
  const sorted = [...numbers].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

export async function summarize(sessions, comparator) {
  const keys = { A: await answerKey('A'), B: await answerKey('B') };
  const seen = new Set(), gains = [], byRole = { C: { n: 0, film: 0 }, P: { n: 0, film: 0 } };
  let filmSuccess = 0, controlSuccess = 0;
  for (const session of sessions) {
    const { code, trials } = session;
    if (seen.has(code) || session.comparator !== comparator) throw Error('同一轮内编号重复或对照条件不一致。');
    const expected = assignment(code, comparator);
    if (!Array.isArray(trials) || trials.length !== 2 || trials.some((trial, i) =>
      trial.task !== expected[i].task || trial.mode !== expected[i].mode)) throw Error(`编号 ${code} 的题目或顺序有误。`);
    seen.add(code);
    const results = trials.map(trial => ({ ...trial, ...scoreTrial(trial, keys[trial.task]) }));
    const film = results.find(row => row.mode === 'film'), control = results.find(row => row.mode === comparator);
    byRole[code[0]].n++;
    if (film.success) { filmSuccess++; byRole[code[0]].film++; }
    if (control.success) controlSuccess++;
    if (film.success && control.success && control.elapsedMs > 0) gains.push((control.elapsedMs - film.elapsedMs) / control.elapsedMs);
  }
  const enoughPairs = gains.length >= 4;
  const pairedGain = enoughPairs ? median(gains) : null;
  const total = seen.size;
  const successGate = filmSuccess >= 6 && byRole.C.film >= 3 && byRole.P.film >= 3;
  const overControl = filmSuccess > controlSuccess || (filmSuccess === controlSuccess && pairedGain != null && pairedGain >= .25);
  return { total, filmSuccess, controlSuccess, byRole, pairs: gains.length, pairedGain,
    decision: total < 8 ? 'incomplete' : successGate && overControl ? 'passes-pilot-task' : 'review-before-expansion' };
}

async function ask(rl, question, parse) {
  while (true) {
    const answer = (await rl.question(question)).trim().toLowerCase();
    const parsed = parse(answer);
    if (parsed !== undefined) return parsed;
    console.log('请输入提示范围内的值。');
  }
}
function yesNo(value) {
  if (value === 'y') return true;
  if (value === 'n') return false;
}

async function run(code, target, comparator) {
  const order = assignment(code, comparator);
  const path = join(target, `${comparator}-${code}.json`);
  try { await access(path); throw Error('此编号已有一份记录。请选择本轮尚未使用的编号，或为新一轮选一个空目录。'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  // Validate the two authoritative tasks before starting either timer.
  await Promise.all(order.map(trial => answerKey(trial.task)));
  await mkdir(target, { recursive: true });
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const trials = [];
  try {
    console.log('主持人屏幕。请取得同意，分开参与者与此终端，按手册准备两套战术。');
    for (const { task, mode } of order) {
      console.log(`\nPlay ${task}  ·  ${mode}\nhttps://playbook-studio-tim.kind-wolf-6204.chatgpt.site/editor/local?filmPilot=${mode}#editor`);
      await rl.question('布阵页就绪，读完题目后按回车开始计时。');
      const start = performance.now();
      const deadline = setTimeout(() => console.log('\n30 秒已到。请结束任务并按回车。'), limitMs);
      try { await rl.question('停止操作并给出答案时，主持人按回车。'); }
      finally { clearTimeout(deadline); }
      const elapsedMs = Math.ceil(performance.now() - start);
      console.log(`耗时 ${(elapsedMs / 1000).toFixed(2)} 秒。请按实际观察登记。仅在试后读取精确停点。`);
      const frame = await ask(rl, '最终停点（秒，未停帧请直接回车）：', value => {
        if (!value) return null;
        const seconds = Number(value);
        return Number.isFinite(seconds) && seconds >= 0 && seconds <= 6 ? seconds : undefined;
      });
      const deeper = await ask(rl, '指出谁更深（H/Y，未作答直接回车）：', value =>
        ['', 'h', 'y'].includes(value) ? value.toUpperCase() || null : undefined);
      const evidence = await ask(rl, '参与者是否指出同一帧上沿进攻方向的判断依据？(y/n) ', yesNo);
      const prompted = await ask(rl, '主持人是否给过操作或答案提示？(y/n) ', yesNo);
      trials.push({ task, mode, elapsedMs, frame, deeper, evidence, prompted });
    }
    await writeFile(path, JSON.stringify({ code, comparator, trials }, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    console.log(`两次观察已保存在本机 ${path}`);
  } finally { rl.close(); }
}

async function main(args) {
  const [command, ...rest] = args;
  if (command === 'run' && rest.length >= 2 && rest.length <= 3) return run(rest[0], resolve(rest[1]), rest[2] || 'baseline');
  if (command === 'summary' && rest.length >= 1 && rest.length <= 2) {
    const comparator = rest[1] || 'baseline';
    if (!validControl(comparator)) throw Error('请选择 baseline 或 events。');
    const files = (await readdir(rest[0])).filter(name => new RegExp(`^${comparator}-[CP][1-4]\\.json$`).test(name));
    const sessions = await Promise.all(files.map(async name => JSON.parse(await readFile(join(rest[0], name), 'utf8'))));
    const result = await summarize(sessions, comparator);
    console.table([
      { condition: 'film', completed: result.filmSuccess, observed: result.total },
      { condition: comparator, completed: result.controlSuccess, observed: result.total },
      { condition: 'film · coaches', completed: result.byRole.C.film, observed: result.byRole.C.n },
      { condition: 'film · players', completed: result.byRole.P.film, observed: result.byRole.P.n },
    ]);
    console.log(`双臂成功配对 ${result.pairs}；用时中位缩短 ${result.pairedGain == null ? '待至少 4 对再报告' : (100 * result.pairedGain).toFixed(1) + '%'}。`);
    console.log({ incomplete: '试点未收齐 4 位教练和 4 位球员。', 'passes-pilot-task': '本轮解题门槛通过；请另查视觉辨识、误读与技术回归。', 'review-before-expansion': '本轮解题门槛未通过；请复盘失败样本。' }[result.decision]);
    return;
  }
  throw Error('用法：node scripts/coach-film-study.mjs run C1 <本机目录> [baseline|events]\n或：node scripts/coach-film-study.mjs summary <本机目录> [baseline|events]');
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main(process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 1; });
}
