// Run from the repository checkout. Both trees are frozen before adding QA-only probes.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const [base, next, output] = process.argv.slice(2);
if (!base || !next || !output || base === 'WORKTREE') {
  throw Error('Usage: node scripts/bench-digital/prepare-editor.mjs <baseline-ref> <candidate-ref|WORKTREE> <new-output-dir>');
}
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
const repo = git('rev-parse', '--show-toplevel');
const here = fileURLToPath(new URL('.', import.meta.url));
const dest = resolve(output);
if (!relative(repo, dest).startsWith('..' + sep)) throw Error('Create the preview outside the checkout.');
await mkdir(dest, { recursive: true });
if ((await readdir(dest)).length) throw Error('Choose an empty destination to avoid mixing snapshots.');
const stage = await mkdtemp(join(tmpdir(), 'playbook-editor-bench-'));
const dist = join(dest, 'dist');
await mkdir(dist);
async function treeHash(root) {
  const hash = createHash('sha256');
  async function walk(dir) {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries.sort((a, b) => a.name < b.name ? -1 : 1)) {
      const p = join(dir, entry.name);
      if (entry.isDirectory()) { await walk(p); continue; }
      const digest = createHash('sha256').update(await readFile(p)).digest('hex');
      hash.update(relative(root, p) + '\0' + digest + '\n');
    }
  }
  await walk(root);
  return hash.digest('hex');
}
async function patch(file, from, to) {
  const js = await readFile(file, 'utf8');
  if (js.split(from).length !== 2) throw Error('Unexpected instrumentation target in ' + file + ' ' + from);
  await writeFile(file, js.replace(from, to));
}
try {
  const fixture = execFileSync('git', ['show', base + ':scripts/bench-digital/mesh.json']);
  const driverHash = createHash('sha256').update(await readFile(join(here, 'editor', 'page.js'))).update(await readFile(join(here, 'editor', 'sample.js'))).digest('hex');
  for (const [name, ref] of [['baseline', base], ['candidate', next]]) {
    const path = join(dist, name);
    const commit = git('rev-parse', '--verify', (ref === 'WORKTREE' ? 'HEAD' : ref) + '^{commit}');
    if (ref === 'WORKTREE') {
      const files = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', 'web/'], { encoding: 'utf8' });
      for (const file of files.split('\0').filter(Boolean)) {
        const target = join(path, relative('web', file));
        await mkdir(dirname(target), { recursive: true });
        try { await cp(join(repo, file), target); }
        catch (error) { if (error.code !== 'ENOENT') throw error; } // Locally deleted tracked path.
      }
    } else {
      const archive = join(stage, name + '.tar');
      execFileSync('git', ['archive', '--format=tar', '--output', archive, commit, 'web']);
      await mkdir(path);
      execFileSync('tar', ['xf', archive, '--strip-components=1', '-C', path]);
    }
    const snapshot = { variant: name, ref, commit, driverSHA256: driverHash, webSHA256: await treeHash(path),
      fixtureSHA256: createHash('sha256').update(fixture).digest('hex') };
    await writeFile(join(path, 'snapshot.json'), JSON.stringify(snapshot));
    await patch(join(path, 'model.js'), "'playbook-studio:v1'", "'bench-mesh-workspace-" + name + "'");
    await patch(join(path, 'visual-mode.js'), "'playbook-visual-mode'", "'bench-mesh-mode-" + name + "'");
    await patch(join(path, 'onboarding.js'), "'playbook-studio:onboarding:v1'", "'bench-mesh-onboarding-" + name + "'");
    await patch(join(path, 'app.js'), "if ('serviceWorker' in navigator", "if (false && 'serviceWorker' in navigator");
    await patch(join(path, 'digital-fallback.js'), 'function draw(', 'function draw(...args){return globalThis.__editorBench.draw(args[0],()=>measuredVectorDraw(...args));}\n  function measuredVectorDraw(');
    await writeFile(join(path, 'local.html'), (await readFile(join(path, 'index.html'), 'utf8')).replace('./app.js', './bench-page.js'));
    await writeFile(join(path, 'bench-mesh.json'), fixture);
    await cp(join(here, 'editor', 'page.js'), join(path, 'bench-page.js'));
    await cp(join(here, 'editor', 'sample.js'), join(path, 'bench-sample.js'));
    console.log(name, commit, snapshot.webSHA256);
  }
  await cp(join(here, 'editor', 'index.html'), join(dist, 'index.html'));
  await mkdir(join(dest, '.openai'));
  await writeFile(join(dest, '.openai', 'hosting.json'), '{"static":{"directory":"dist"}}');
} finally { await rm(stage, { recursive: true, force: true }); }
