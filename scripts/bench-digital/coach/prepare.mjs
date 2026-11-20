import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { cp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { prepareStyleCases } from './style-cases.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../..');
const args = process.argv.slice(2);
const mounted = args[0] === '--mount';
const requested = mounted ? args[1] : args[0];
if (!requested || args.length !== (mounted ? 2 : 1)) {
  throw Error('Usage: node scripts/bench-digital/coach/prepare.mjs [--mount] <new-output-directory>');
}
const destination = resolve(requested);
const relativePath = relative(root, destination);
if (relativePath !== '..' && !relativePath.startsWith('..' + sep) && !isAbsolute(relativePath)) throw Error('Choose a directory outside the source checkout.');
await mkdir(destination, { recursive: true });
if ((await readdir(destination)).length) throw Error('Choose an empty destination to avoid overwriting an existing preview.');

const dist = mounted ? destination : join(destination, 'dist');
await cp(join(root, 'web'), dist, { recursive: true });
const fingerprint = createHash('sha256');
async function hashSnapshot(directory) {
  const entries = await readdir(directory,{withFileTypes:true});
  for(const entry of entries.sort((a,b)=>a.name<b.name?-1:a.name>b.name?1:0)){
    const location = join(directory,entry.name);
    if(entry.isDirectory()) await hashSnapshot(location);
    else fingerprint.update(relative(dist,location)).update('\0').update(await readFile(location));
  }
}
await hashSnapshot(dist);
const fixture = await readFile(join(root, 'scripts/bench-digital/mesh.json'));
const driver = await readFile(join(here, 'page.js'));
const pointerTrial = await readFile(join(here, 'pointer-trial.js'));
const clock = await readFile(join(here,'clock.js'));
const clockPage = await readFile(join(here,'clock-page.js'));
const profile = await readFile(join(here,'profile.js'));
const styleDriver=await readFile(join(here,'style-stage.js'));
const entryDriver=await readFile(join(here,'entry-seed.js'));
await writeFile(join(dist, 'film-bench-scene.json'), fixture);
await writeFile(join(dist, 'film-bench.js'), driver);
await writeFile(join(dist, 'pointer-trial.js'), pointerTrial);
await writeFile(join(dist,'film-clock.js'),clock);
await writeFile(join(dist,'film-clock-page.js'),clockPage);
await writeFile(join(dist,'film-profile.js'),profile);
await writeFile(join(dist,'film-entry-seed.js'),entryDriver);
await writeFile(join(dist,'film-entry.html'),'<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>普通入口测量</title><body><button type="button" disabled>准备演练样本</button><pre id="film-bench-result" role="status">保持前台</pre><script type="module" src="./film-entry-seed.js"></script></body></html>');
await writeFile(join(dist,'film-clock.html'),`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>空白页面刷新时钟</title><main><h1>空白页面刷新时钟</h1><button type="button" disabled>开始测量</button> <a hidden download="coach-film-bare-raf.json">下载逐帧数据</a><pre id="film-bench-result" role="status">已就绪 · 三轮各 15 秒，保持此标签前台</pre></main><script type="module" src="./film-clock-page.js"></script></html>`);
await writeFile(join(dist,'film-profile.html'),`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>同页逐段测量</title><main><button type="button" disabled>开始逐段测量</button> <a hidden download="coach-film-paired-profile.json">下载完整数据</a><pre id="film-bench-result" role="status">保持前台</pre></main><script type="module" src="./film-profile.js"></script></html>`);
await writeFile(join(dist, 'film-bench-build.json'), JSON.stringify({
  checkoutHead: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding:'utf8' }).trim(),
  sourceSha256: fingerprint.digest('hex'),
  fixtureSha256: createHash('sha256').update(fixture).digest('hex'),
  driverSha256: createHash('sha256').update(driver).digest('hex'),
  pointerTrialSha256:createHash('sha256').update(pointerTrial).digest('hex'),
  clockSha256:createHash('sha256').update(clock).update(clockPage).digest('hex'),
  profileSha256:createHash('sha256').update(profile).digest('hex'),
  freshStyleDriverSha256:createHash('sha256').update(styleDriver).digest('hex'),
  normalEntryDriverSha256:createHash('sha256').update(entryDriver).digest('hex'),
}));
// The benchmark can share a preview origin with the editor. Keep the primary workspace
// and tutorial preferences of that editor intact even when a run is interrupted.
async function replaceOnce(file, from, to) {
  const path = join(dist, file);
  const source = await readFile(path, 'utf8');
  if (source.split(from).length !== 2) throw Error('Cannot isolate ' + file);
  await writeFile(path, source.replace(from, to));
}
await replaceOnce('model.js', "'playbook-studio:v1'", "'coach-film-bench:workspace'");
await replaceOnce('onboarding.js', "'playbook-studio:onboarding:v1'", "'coach-film-bench:onboarding'");
await replaceOnce('visual-mode.js', "'playbook-visual-mode'", "'coach-film-bench:visual-mode'");
// Keep the entry module byte-for-byte intact, while the dedicated QA scope
// uses the browser's network handling instead of installing release caches.
await writeFile(join(dist,'sw.js'),'// Isolated benchmark scope. Requests use the network.\n');
const index = await readFile(join(dist, 'index.html'), 'utf8');
await writeFile(join(dist, 'film-bench.html'), index.replace('src="./app.js"', 'src="./film-bench.js"'));
await prepareStyleCases(dist,index,styleDriver);
const observerHook=`if(sessionStorage.getItem('coach-film-normal-entry:'+new URL('.',location.href).pathname)!==null){addEventListener('load',()=>{document.fonts.ready.then(()=>setTimeout(()=>{import('./film-bench.js?normal-entry')},0))},{once:true})}`;
await writeFile(join(dist,'film-entry-observe.js'),observerHook);
await writeFile(join(dist,'index.html'),index.replace('</body>','<script defer src="./film-entry-observe.js"></script>\n</body>'));
if (!mounted) {
  await mkdir(join(destination, '.openai'));
  await writeFile(join(destination, '.openai/hosting.json'), JSON.stringify({static:{directory:'dist'}}));
}
console.log('Prepared', dist, '/film-bench.html?run=1#editor');
