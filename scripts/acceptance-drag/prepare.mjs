// Development-only. Run after prepare-web; a normal production build clears this directory.
import { execFileSync } from 'node:child_process';
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const baseline = 'd948017c37af82d534eb3836121d493164d7990a';
const root = new URL('../../', import.meta.url);
const destination = new URL('public/editor/acceptance-drag/', root);
const original = new URL('base/', destination);
const candidate = new URL('candidate/', destination);
await mkdir(original, { recursive: true });
const archive = execFileSync('git', ['archive', '--format=tar', baseline, 'web'], {
  cwd: root, maxBuffer: 64 * 1024 * 1024,
});
execFileSync('tar', ['-xf', '-', '--strip-components=1', '-C', fileURLToPath(original)], { input: archive });
await cp(new URL('web/', root), candidate, { recursive: true });

const { starterWorkspace, encodeWorkspace } = await import(new URL('model.js', original));
const { withDefense43 } = await import(new URL('defense-formation.js', original));
const data = starterWorkspace();
const play = withDefense43(data.plays[0]);
play.annotations.push({ id: 'benchmark-note', text: '11 v 11', x: 49, y: 15 });
play.zones.push({ id: 'benchmark-zone', x: 50, y: 30, rx: 8, ry: 8, label: 'DEEP', color: '#88bfff' });
play.routes.find(route => route.kind === 'block').blockTargets = [play.players.find(player => player.side === 'defense').id];
data.plays = [play];
const fixture = encodeWorkspace(data);

for (const directory of [original, candidate]) {
  await writeFile(new URL('fixture.json', directory), fixture);
  for (const name of ['sample.js', 'run.js']) {
    await cp(new URL(name, import.meta.url), new URL(name, directory));
  }
  const html = await readFile(new URL('index.html', directory), 'utf8');
  await writeFile(new URL('local.html', directory), html.replace('src="./app.js"', 'src="./run.js"'));
}
console.log('On the development preview open /editor/acceptance-drag/base/local.html#editor, then /editor/acceptance-drag/candidate/local.html#editor.');
