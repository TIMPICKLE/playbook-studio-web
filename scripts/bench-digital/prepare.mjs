import { cp, mkdir, realpath } from 'node:fs/promises';
import { resolve, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';

const [source, output] = process.argv.slice(2);
if (!source || !output) throw Error('Usage: node scripts/bench-digital/prepare.mjs <checkout/web> <empty QA folder>');
const src = await realpath(source);
const dest = resolve(output);
const rel = relative(src, dest);
if (!rel || (!rel.startsWith('..') && !isAbsolute(rel))) throw Error('Choose a destination outside the application source.');
await mkdir(dest, { recursive:true });
await cp(src, resolve(dest, 'web'), { recursive:true });
for (const file of ['local.html','browser.js','sample.js','mesh.json']) {
  await cp(fileURLToPath(new URL(file,import.meta.url)), resolve(dest,file));
}
