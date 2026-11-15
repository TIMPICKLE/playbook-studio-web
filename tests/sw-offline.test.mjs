import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import vm from 'node:vm';

test('the service worker installs the editor shell and caches geometry only after a successful request',async()=>{
  const handlers={},stored=new Map(),installed=[];
  const origin='https://playbook.test',base=origin+'/editor/';
  const key=request=>new URL(typeof request==='string'?request:request.url,base).href;
  const cache={
    async addAll(files){installed.push(...files);},
    async put(request,response){stored.set(key(request),response);},
  };
  const caches={
    async open(){return cache;},
    async keys(){return [];},
    async match(request){return stored.get(key(request))?.clone();},
  };
  let online=true;
  const self={location:{origin},addEventListener(name,handler){handlers[name]=handler;},async skipWaiting(){}};
  vm.runInNewContext(readFileSync(new URL('../web/sw.js',import.meta.url),'utf8'),{
    self,caches,URL,Response,
    fetch:async()=>{if(!online)throw Error('offline');return new Response('export const geometry = true;');},
  });
  let install;
  handlers.install({waitUntil(promise){install=promise;}});
  await install;
  assert.ok(installed.includes('./madden-traces.js'));
  assert.ok(installed.includes('./editor-dialog.css'));
  assert.ok(installed.includes('./component-layout.css'));
  assert.ok(!installed.some(name=>/madden-editable(?:-[^/]+)?\.js$/.test(name)), 'install must not eagerly download geometry');
  for(const name of installed) assert.ok(existsSync(new URL('../web/'+name,import.meta.url)),`precache asset exists: ${name}`);
  const request=async file=>{
    let response;
    const writes=[];
    handlers.fetch({request:new Request(base+file),respondWith(promise){response=promise;},waitUntil(promise){writes.push(promise);}});
    const result=await response;
    await Promise.all(writes);
    return result;
  };
  const loaded=await request('data/madden-editable-seed.js');
  assert.equal(await loaded.text(),'export const geometry = true;');
  online=false;
  const cached=await request('data/madden-editable-seed.js');
  assert.equal(await cached.text(),'export const geometry = true;');
  const missing=await request('data/madden-editable-final.js');
  assert.equal(missing.type,'error','an unvisited shard is unavailable offline rather than an unrelated HTML response');
});
