import { build } from 'esbuild';
import { readFile, writeFile } from 'node:fs/promises';

// The static editor shares the same Zod contracts as the Worker and tests.
const root = new URL('../', import.meta.url);
await build({
  absWorkingDir: root.pathname,
  stdin: { contents: "export { z } from 'zod';", resolveDir: root.pathname },
  outfile: 'web/vendor/assistant-zod.js',
  bundle: true, platform: 'browser', format: 'esm', target: 'es2022', minify: true,
  legalComments: 'linked',
});
const license = await readFile(new URL('node_modules/zod/LICENSE', root), 'utf8');
await writeFile(new URL('web/vendor/assistant-zod.NOTICES.txt', root), 'zod (MIT)\n\n' + license.trimEnd() + '\n');
