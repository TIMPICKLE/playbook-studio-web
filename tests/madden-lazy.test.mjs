import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createEditableTraceLoader, EditableTraceNotLoadedError } from '../web/madden-traces.js';
import { TRACE_SHARDS } from '../web/data/madden-trace-index.js';
import { TRACE_EVIDENCE } from '../web/data/madden-trace-evidence.js';
import { TEAM_TRACE_ALIASES } from '../web/data/madden-team-trace-aliases.js';
import { EDITABLE_TRACES } from '../web/data/madden-editable.js';
import { searchMaddenCatalog, resolveMaddenResults } from '../web/assistant-search.js';
import { makeMaddenPlay, getEditableEntry, hasEditableTrace, loadEditableEntries } from '../web/madden-model.js';
import { prepareEditorActions } from '../web/editor-actions.js';
import { starterWorkspace, validatePlay } from '../web/model.js';

const catalog = JSON.parse(readFileSync(new URL('../web/data/huddle-catalog.json',import.meta.url),'utf8'));
const root = fileURLToPath(new URL('../',import.meta.url));
const evidence = trace => {
  const endpoints = trace.routes.filter(route => route.kind === 'route' && !route.optional)
    .map(route => `${route.owner} ${route.points[0].join(',')}→${route.points.at(-1).join(',')}`);
  return `Editable trace: primary route start→finish (source px; right +x, downfield −y, LOS y=${trace.coordinateSystem.lineOfScrimmageY}): ${endpoints.join('; ')}.`;
};

test('the editor static module graph excludes every full Madden geometry shard',()=>{
  const seen = new Set(), visit = url => {
    if (seen.has(url.pathname)) return;
    seen.add(url.pathname);
    const source = readFileSync(url,'utf8');
    const imports = /(?:^|\n)\s*(?:import|export)\s+(?:(?:[^\n]+?)\s+from\s+)?['"]([^'"]+)['"]/g;
    for (const match of source.matchAll(imports)) if (match[1].startsWith('.') && /\.js$/.test(match[1])) visit(new URL(match[1],url));
  };
  visit(new URL('../web/app.js',import.meta.url));
  assert.equal([...seen].filter(path => /\/data\/madden-editable(?:-[^/]+)?\.js$/.test(path)).length,0);
  assert.ok(seen.has(fileURLToPath(new URL('../web/data/madden-trace-index.js',import.meta.url))));
  const heavy = ['seed','batch','80','oct28','continued','final'].reduce((sum,name)=>sum+statSync(new URL(`../web/data/madden-editable-${name}.js`,import.meta.url)).size,0);
  const light = ['index','evidence'].reduce((sum,name)=>sum+statSync(new URL(`../web/data/madden-trace-${name}.js`,import.meta.url)).size,0);
  assert.ok(light < heavy / 5,'metadata stays substantially smaller than full route geometry');
});

test('cold search preserves editable flags and exact geometry evidence without loading geometry',()=>{
  const entry = catalog.plays.find(row=>hasEditableTrace(row.id));
  assert.throws(()=>getEditableEntry(entry.id),EditableTraceNotLoadedError);
  const candidates = searchMaddenCatalog(catalog,{concepts:['mesh'],editableOnly:true});
  assert.ok(candidates.length);
  for (const candidate of candidates) {
    assert.equal(candidate.editable,true);
    const canonical = TEAM_TRACE_ALIASES[candidate.id] || candidate.id;
    assert.ok(candidate.evidence.startsWith(evidence(EDITABLE_TRACES[canonical])));
    assert.throws(()=>getEditableEntry(candidate.id),EditableTraceNotLoadedError);
  }
  const cards = resolveMaddenResults(catalog,candidates.map(candidate=>({id:candidate.id,reason:'Inspect these recorded routes.'})));
  assert.equal(cards.length,5);
  assert.ok(cards.every(card=>card.editable));
  assert.throws(()=>makeMaddenPlay(entry),EditableTraceNotLoadedError,'unloaded geometry must never silently become an image-only import');
});

test('concurrent canonical and alias loads share a shard, and failed loads remain retryable',async()=>{
  const a = {id:'a',players:[],routes:[]}, b = {id:'b',players:[],routes:[]};
  let calls=0, release;
  const loader=createEditableTraceLoader({index:{a:'one',b:'one'},aliases:{alias:'a'},loadShard:()=>{
    calls++;
    if (calls===1) throw new Error('temporary download failure');
    return new Promise(resolve=>{release=resolve;});
  }});
  assert.equal(loader.has('alias'),true);assert.equal(loader.has('missing'),false);assert.equal(loader.get('missing'),null);
  assert.throws(()=>loader.get('alias'),EditableTraceNotLoadedError);
  await assert.rejects(loader.load('a'),/temporary download failure/);
  const pending=loader.loadMany(['a','alias','b']);
  await Promise.resolve();
  assert.equal(calls,2);
  release({a,b});
  const values=await pending;
  assert.deepEqual(values,[a,a,b]);assert.equal(loader.get('alias'),a);
  await loader.loadMany(['a','b']);assert.equal(calls,2,'cached imports do not fetch a shard again');
});

test('invalid shard data never partially populates the cache and can be retried',async()=>{
  let calls=0;
  const a={id:'a',players:[],routes:[]}, b={id:'b',players:[],routes:[]};
  const loader=createEditableTraceLoader({index:{a:'one',b:'one'},aliases:{},loadShard:async()=>++calls===1?{a}:{a,b}});
  await assert.rejects(loader.load('a'),/Invalid Madden geometry shard/);
  assert.throws(()=>loader.get('a'),EditableTraceNotLoadedError);
  assert.equal(await loader.load('b'),b);assert.equal(loader.get('a'),a);
});

test('generated shard metadata and lazy geometry preserve every canonical trace and team alias',async()=>{
  execFileSync(process.execPath,['scripts/build-madden-trace-index.mjs','--check'],{cwd:root});
  assert.deepEqual(Object.keys(TRACE_SHARDS).sort(),Object.keys(EDITABLE_TRACES).sort());
  const loader=createEditableTraceLoader();
  const ids=[...Object.keys(EDITABLE_TRACES),...Object.keys(TEAM_TRACE_ALIASES)];
  await loader.loadMany(ids);
  for (const id of ids) {
    const canonical=TEAM_TRACE_ALIASES[id] || id;
    assert.deepEqual(loader.get(id),EDITABLE_TRACES[canonical],id);
    assert.equal(TRACE_EVIDENCE[canonical],evidence(EDITABLE_TRACES[canonical]),id);
  }
});

test('imports load before the synchronous deterministic preview and preserve undo-owned workspace data',async()=>{
  const entry=catalog.plays.find(row=>hasEditableTrace(row.id)),data=starterWorkspace(),before=structuredClone(data);
  const context={data,selectedId:data.plays[0].id,catalogRows:[entry]},actions=[{kind:'catalog_import',catalogId:entry.id}];
  assert.throws(()=>prepareEditorActions(context,actions),EditableTraceNotLoadedError);
  await loadEditableEntries([entry.id]);
  const first=prepareEditorActions(context,actions),second=prepareEditorActions(context,actions);
  assert.deepEqual(first,second);
  assert.deepEqual(data,before);
  const imported=validatePlay(first.data.plays.at(-1));
  assert.equal(imported.diagramSource.catalogId,entry.id);assert.equal(imported.players.length,11);
  const image=catalog.plays.find(row=>!hasEditableTrace(row.id));
  assert.ok(makeMaddenPlay(image).reference);
});
