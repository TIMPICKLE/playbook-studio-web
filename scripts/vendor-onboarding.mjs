import { copyFile, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// Pages is prepared without node_modules; keep the pinned browser distribution
// and its license in the repository, with no runtime CDN dependency.
const root = fileURLToPath(new URL('../', import.meta.url));
const installed = path.join(root, 'node_modules/driver.js');
const pkg = JSON.parse(await readFile(path.join(installed, 'package.json'), 'utf8'));
if (pkg.version !== '1.14.0') throw new Error('Review the tour integration before upgrading Driver.js.');
for (const [source, target] of [
  ['dist/driver.js.mjs', 'driver-1.14.0.js'],
  ['dist/driver.css', 'driver-1.14.0.css'],
  ['license', 'driver-1.14.0.LICENSE.txt'],
]) await copyFile(path.join(installed, source), path.join(root, 'web/vendor', target));
