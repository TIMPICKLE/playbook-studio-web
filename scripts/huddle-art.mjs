// Checked, portable source bundles keep all original JPEGs in Git without a
// thousand individual upload operations. Build output contains normal JPEG files.
import { readFile, writeFile, mkdir, readdir, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { gunzipSync, gzipSync } from 'node:zlib';
const bundle = new URL('../vendor/huddle-art/', import.meta.url);
const images = new URL('../web/data/huddle-art/', import.meta.url);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const validName = name => /^[a-f0-9]{20}\.jpg$/.test(name);
export async function materializeHuddleArt() {
  const manifest = JSON.parse(await readFile(new URL('manifest.json', bundle), 'utf8'));
  if (manifest.format !== 'gzip-ustar-parts') throw new Error('Unsupported Huddle art bundle');
  let complete = true;
  for (const [name, expected] of Object.entries(manifest.images)) {
    if (!validName(name)) throw new Error('Invalid image filename');
    try { if (hash(await readFile(new URL(name, images))) !== expected) complete = false; } catch { complete = false; }
  }
  if (complete) return;
  const parts = [];
  for (const part of manifest.parts) {
    if (!/^art-\d{3}\.bin$/.test(part.name)) throw new Error('Invalid bundle filename');
    const bytes = await readFile(new URL(part.name, bundle));
    if (hash(bytes) !== part.sha256) throw new Error(`Corrupt bundle: ${part.name}`);
    parts.push(bytes);
  }
  const tar = gunzipSync(Buffer.concat(parts)), found = new Set();
  await mkdir(images, { recursive: true });
  for (let offset = 0; offset + 512 <= tar.length;) {
    const header = tar.subarray(offset, offset + 512); if (header.every(b => b === 0)) break;
    const name = header.subarray(0, 100).toString().replace(/\0.*$/s, '');
    const size = parseInt(header.subarray(124, 136).toString().replace(/\0.*$/s, '').trim(), 8);
    if (!validName(name) || !Number.isSafeInteger(size) || size < 4 || offset + 512 + size > tar.length || ![0, 48].includes(header[156])) throw new Error('Invalid image archive entry');
    const bytes = tar.subarray(offset + 512, offset + 512 + size);
    if (hash(bytes) !== manifest.images[name]) throw new Error(`Corrupt image: ${name}`);
    await writeFile(new URL(name, images), bytes); found.add(name);
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  if (found.size !== Object.keys(manifest.images).length) throw new Error('Incomplete image archive');
}
export async function packHuddleArt(plays) {
  const names = [...new Set(plays.map(p => p.image.split('/').at(-1)))].sort(), entries = [], checksums = {};
  const octal = (value, width) => value.toString(8).padStart(width - 1, '0') + '\0';
  for (const name of names) {
    if (!validName(name)) throw new Error('Invalid image filename');
    const bytes = await readFile(new URL(name, images)), header = Buffer.alloc(512);
    header.write(name); header.write(octal(420,8),100); header.write(octal(0,8),108); header.write(octal(0,8),116);
    header.write(octal(bytes.length,12),124); header.write(octal(0,12),136); header.fill(32,148,156); header[156]=48;
    header.write('ustar\0',257); header.write('00',263);
    header.write(header.reduce((a,b)=>a+b,0).toString(8).padStart(6,'0')+'\0 ',148);
    entries.push(header,bytes,Buffer.alloc((512-bytes.length%512)%512)); checksums[name]=hash(bytes);
  }
  entries.push(Buffer.alloc(1024));
  const packed=gzipSync(Buffer.concat(entries)), parts=[];
  await mkdir(bundle,{recursive:true});
  for(const name of await readdir(bundle)) if(/^art-\d{3}\.bin$/.test(name)) await rm(new URL(name,bundle));
  for(let offset=0,index=0;offset<packed.length;offset+=750000,index++) {
    const bytes=packed.subarray(offset,offset+750000),name=`art-${String(index).padStart(3,'0')}.bin`;
    await writeFile(new URL(name,bundle),bytes);parts.push({name,sha256:hash(bytes)});
  }
  await writeFile(new URL('manifest.json',bundle),JSON.stringify({format:'gzip-ustar-parts',parts,images:checksums},null,2)+'\n');
}
