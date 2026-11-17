// Explicit development-only harness. Never copied by prepare-web or production builds.
import {mkdir,copyFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const destination=new URL('../public/editor/acceptance/',import.meta.url);
await mkdir(destination,{recursive:true});
await copyFile(new URL('./acceptance-harness.html',import.meta.url),new URL('index.html',destination));
await copyFile(new URL('./acceptance-performance.js',import.meta.url),new URL('acceptance-performance.js',destination));
if(process.argv.includes('--baseline')){
  const baseline=new URL('../public/editor/acceptance-baseline/',import.meta.url);
  await mkdir(baseline,{recursive:true});
  const archive=execFileSync('git',['archive','--format=tar','2239aec7b1bb0ec5c924b004a3641df448e7c884','web'],{cwd:new URL('..',import.meta.url),maxBuffer:64*1024*1024});
  execFileSync('tar',['-xf','-','--strip-components=1','-C',fileURLToPath(baseline)],{input:archive});
  await copyFile(new URL('index.html',baseline),new URL('local.html',baseline));
}
console.log('Development acceptance: /editor/acceptance/index.html');
