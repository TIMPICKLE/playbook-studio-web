import { build } from 'esbuild';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// The Pages build runs without node_modules. Commit the generated ESM alongside
// the other offline assets and regenerate it after updating the lockfile.
const root = fileURLToPath(new URL('../', import.meta.url));
const result = await build({
  absWorkingDir: root,
  stdin: { contents: "export { Annotation, StateGraph, START, END } from '@langchain/langgraph/web';", resolveDir: root },
  outfile: 'web/vendor/assistant-langgraph.js',
  platform: 'browser',
  format: 'esm',
  target: 'es2022',
  bundle: true,
  minify: true,
  metafile: true,
  legalComments: 'linked',
  define: { 'process.env.NODE_ENV': '"production"' },
});
const packages = new Set();
for (const input of Object.keys(result.metafile.inputs)) {
  const match = input.match(/^(.*node_modules\/(?:@[^/]+\/)?[^/]+)/);
  if (match) packages.add(match[1]);
}
const notices = [];
for (const dir of [...packages].sort()) {
  const full = path.join(root, dir);
  const info = JSON.parse(await readFile(path.join(full, 'package.json'), 'utf8'));
  const licenses = (await readdir(full)).filter(name => /^(licen[cs]e|notice|copying)(\.|$)/i.test(name)).sort();
  notices.push(info.name + '@' + info.version + ' (' + info.license + ')');
  for (const name of licenses) notices.push(await readFile(path.join(full, name), 'utf8'));
}
await writeFile(path.join(root, 'web/vendor/assistant-langgraph.NOTICES.txt'), notices.join('\n\n') + '\n');
