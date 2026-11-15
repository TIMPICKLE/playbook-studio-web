import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

// Reproducible source-byte accounting, not a browser performance benchmark.
// The editor is shipped as native ESM, so static imports describe its startup
// module graph. Service-worker install downloads are reported separately.
const root = fileURLToPath(new URL('../', import.meta.url));
const args = process.argv.slice(2);
const ref = args[0] === '--ref' ? args[1] : null;
if (args.length && (!ref || args.length !== 2)) throw Error('Usage: npm run audit:startup -- [--ref <commit>]');
const source = name => ref
  ? execFileSync('git', ['show', `${ref}:${name}`], {cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe'],maxBuffer:8*1024*1024})
  : readFileSync(path.join(root,name),'utf8');
const parse = (name,text) => ts.createSourceFile(name,text,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
const heavy = name => /\/madden-editable(?:-[^/]+)?\.js$/.test(name);
const graph = new Map();
function visit(name) {
  if (graph.has(name)) return;
  const text=source(name);
  graph.set(name,Buffer.byteLength(text));
  for (const statement of parse(name,text).statements) {
    if (!ts.isImportDeclaration(statement) && !ts.isExportDeclaration(statement)) continue;
    const specifier=statement.moduleSpecifier;
    if (!specifier || !ts.isStringLiteral(specifier) || !specifier.text.startsWith('.')) continue;
    const dependency=path.posix.normalize(path.posix.join(path.posix.dirname(name),specifier.text));
    if (dependency.endsWith('.js')) visit(dependency);
  }
}
visit('web/app.js');
let precache=[];
const worker=source('web/sw.js');
for (const statement of parse('web/sw.js',worker).statements) {
  if (!ts.isVariableStatement(statement)) continue;
  for (const declaration of statement.declarationList.declarations) {
    if (declaration.name.getText() === 'FILES' && ts.isArrayLiteralExpression(declaration.initializer))
      precache=declaration.initializer.elements.filter(ts.isStringLiteral).map(node=>path.posix.normalize('web/'+node.text));
  }
}
const list = entries => entries.map(([name,bytes])=>({path:name,bytes}));
const files=[...graph];
console.log(JSON.stringify({
  ref:ref || 'working-tree',
  measurement:'UTF-8 source bytes; excludes compression, HTTP cache, execution time and runtime imports',
  startup:{modules:files.length,bytes:files.reduce((sum,[,size])=>sum+size,0),geometry:list(files.filter(([name])=>heavy(name)))},
  serviceWorker:{precacheFiles:precache.length,geometry:precache.filter(heavy)},
  largestStartupModules:list(files.sort((a,b)=>b[1]-a[1]).slice(0,10)),
},null,2));
