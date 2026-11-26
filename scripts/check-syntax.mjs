// Checks JavaScript syntax for all first-party modules under web/ (excluding web/vendor/) and server/.
import { readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const targets = [];

function walk(relativeDir) {
  const fullDir = path.join(root, relativeDir);
  for (const entry of readdirSync(fullDir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const rel = path.posix.join(relativeDir, entry.name);
    if (entry.isDirectory()) {
      if (rel === 'web/vendor' || rel === 'web/data/huddle-art') continue;
      walk(rel);
    } else if (entry.isFile() && /\.(?:js|mjs)$/.test(entry.name)) {
      targets.push(rel);
    }
  }
}

walk('web');
walk('server');

for (const rel of targets) {
  execFileSync(process.execPath, ['--check', path.join(root, rel)], { stdio: 'inherit' });
}

console.log(`Syntax check passed (${targets.length} files).`);
