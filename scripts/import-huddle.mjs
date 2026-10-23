// Refresh the two public playbooks. No private APIs or authenticated content.
// Usage: node scripts/import-huddle.mjs [--metadata-only]
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { Window } from 'happy-dom';
import { fileURLToPath } from 'node:url';
import { packHuddleArt } from './huddle-art.mjs';
const run = promisify(execFile), root = new URL('../web/data/', import.meta.url);
const cache = '/tmp/playbook-huddle-cache';
await mkdir(root, { recursive: true });
await mkdir(new URL('huddle-art/', root), { recursive: true });
await mkdir(cache, { recursive: true });
const digest = value => createHash('sha256').update(value).digest('hex').slice(0, 20);
async function get(url) {
  const path = `${cache}/${digest(url)}`;
  try { return await readFile(path); } catch {}
  const { stdout } = await run('curl', ['--fail', '--location', '--silent', '--show-error', '--max-time', '40', '--retry', '2', url], { encoding: 'buffer', maxBuffer: 8e6 });
  await writeFile(path, stdout);
  return stdout;
}
async function html(url, parse) {
  const win = new Window();
  try { win.document.body.innerHTML = (await get(url)).toString(); return parse(win.document); }
  finally { await win.happyDOM.close(); }
}
async function pool(items, concurrency, fn) {
  let index = 0;
  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (index < items.length) { const i = index++; await fn(items[i], i); await new Promise(r => setTimeout(r, 100)); }
  }));
}
const teams = [], plays = [];
for (const [id, name, city] of [['eagles', 'Eagles', 'Philadelphia'], ['ravens', 'Ravens', 'Baltimore']]) {
  const sourceUrl = `https://huddle.gg/playbooks/${id}-off/`;
  const team = await html(sourceUrl, doc => {
    const game = /Madden\s+(\d+)/.exec(doc.body.textContent)?.[1];
    if (!game) throw new Error(`Missing game version: ${sourceUrl}`);
    const formations = [...doc.querySelectorAll('a.playbooks-list__link')].map(a => ({
      name: a.textContent.trim(), group: a.closest('ul').previousElementSibling.textContent.trim(), url: new URL(a.getAttribute('href'), sourceUrl).href,
    }));
    if (!formations.length) throw new Error(`Missing formations: ${sourceUrl}`);
    return { id, name, city, game: `Madden ${game}`, sourceUrl, formations };
  });
  teams.push(team);
  await pool(team.formations, 4, async f => {
    const rows = await html(f.url, doc => [...doc.querySelectorAll('a.play-tile2')].map(a => {
      const imageUrl = a.querySelector('img')?.getAttribute('src');
      if (!imageUrl || !imageUrl.startsWith('https://play-art.s3.amazonaws.com/')) throw new Error(`Unexpected play art: ${f.url}`);
      return { id: `${id}-${digest(new URL(a.getAttribute('href'), f.url).href)}`, team: id, name: a.querySelector('.play-tile2__info').textContent.trim(), group: f.group, formation: f.name, game: team.game, sourceUrl: new URL(a.getAttribute('href'), f.url).href, imageUrl, image: `data/huddle-art/${digest(imageUrl)}.jpg` };
    }));
    if (!rows.length) throw new Error(`Empty formation: ${f.url}`);
    f.playCount = rows.length; plays.push(...rows);
    console.log(`${name} · ${f.group} ${f.name}: ${rows.length}`);
  });
  team.playCount = plays.filter(p => p.team === id).length;
}
plays.sort((a,b) => a.team.localeCompare(b.team) || a.group.localeCompare(b.group) || a.formation.localeCompare(b.formation) || a.name.localeCompare(b.name));
if (new Set(plays.map(p => p.id)).size !== plays.length) throw new Error('Duplicate source play IDs');
const assets = [...new Map(plays.map(p => [p.image, p])).values()];
if (!process.argv.includes('--metadata-only')) await pool(assets, 12, async (p, i) => {
  const path = new URL(p.image.replace(/^data\//, ''), root);
  try { await access(path); return; } catch {}
  const bytes = await get(p.imageUrl);
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) throw new Error(`Not a JPEG: ${p.imageUrl}`);
  await writeFile(path, bytes);
  if (i % 50 === 0) console.log(`Images: ${i + 1}/${assets.length}`);
});
const catalog = { schemaVersion: 1, fetchedAt: new Date().toISOString(), source: 'Huddle.gg', note: 'Public play names, formations and original play-art images. Images retain source watermarks; no route coordinates or animation data are provided by the source.', teams, plays };
await writeFile(new URL('huddle-catalog.json', root), JSON.stringify(catalog, null, 2) + '\n');
if (!process.argv.includes('--metadata-only')) await packHuddleArt(plays);
console.log(JSON.stringify({ teams: teams.map(t => ({ name: t.name, game: t.game, formations: t.formations.length, plays: t.playCount })), uniqueImages: assets.length, path: fileURLToPath(root) }));
