import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { transform, version as esbuildVersion } from 'esbuild';

// Keep the static editor self-contained: this is a build-time download only.
// Source and license are immutable versioned npm artifacts, verified before use.
const version = '2.3.0';
const sources = {
  source: {
    url: `https://unpkg.com/d3-interpolate-path@${version}/build/d3-interpolate-path.mjs`,
    sha256: 'eccf65c427bfcdc526638710fc868fcc206fd29eb585acc0b43f832f4d8edc14',
  },
  license: {
    url: `https://unpkg.com/d3-interpolate-path@${version}/LICENSE`,
    sha256: '1597f3f5aed68aa69adeb7bec49a311d338de88c1d1668f9acd481dcae18e90f',
  },
};
if (esbuildVersion !== '0.28.0') {
  throw new Error(`Reproducible vendor build requires esbuild 0.28.0; found ${esbuildVersion}`);
}
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
async function download({ url, sha256: expected }) {
  const response = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!response.ok) throw new Error(`Download failed (${response.status}): ${url}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const actual = sha256(bytes);
  if (actual !== expected) throw new Error(`Source checksum mismatch for ${url}: ${actual}`);
  return bytes.toString('utf8');
}

const [source, license] = await Promise.all([download(sources.source), download(sources.license)]);
const { code } = await transform(source, {
  format: 'esm', target: 'es2020', minify: true, legalComments: 'none',
});
const root = new URL('../', import.meta.url);
const output = new URL(`web/vendor/d3-interpolate-path-${version}.js`, root);
const licenseOutput = new URL(`web/vendor/d3-interpolate-path-${version}.LICENSE.txt`, root);
const header = `/*! d3-interpolate-path ${version} | Copyright 2016 Peter Beshai | BSD-3-Clause\n * Source SHA256: ${sources.source.sha256}\n * See d3-interpolate-path-${version}.LICENSE.txt; rebuild: node scripts/bundle-route-morph.mjs\n */\n`;
await mkdir(new URL('web/vendor/', root), { recursive: true });
await writeFile(output, header + code);
await writeFile(licenseOutput, license);
console.log(`${output.pathname}: ${Buffer.byteLength(header + code)} bytes, SHA256 ${sha256(header + code)}`);
console.log(`${licenseOutput.pathname}: SHA256 ${sha256(license)}`);
