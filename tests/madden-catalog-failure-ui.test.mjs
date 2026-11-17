import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Window} from 'happy-dom';
import {createMaddenLibrary} from '../web/madden.js';

test('a failed catalog request keeps the library usable and retry loads real team controls without a page reload',async t=>{
  const catalog=JSON.parse(readFileSync(new URL('../web/data/huddle-catalog.json',import.meta.url)));
  const win=new Window({url:'https://playbook.test/local.html',width:1440,height:900});
  win.document.body.innerHTML='<button id="opener">Library</button><div id="madden-root" hidden></div>';
  const keys=['window','document','fetch'],old=Object.fromEntries(keys.map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  let calls=0;
  for(const key of keys)Object.defineProperty(globalThis,key,{configurable:true,value:key==='fetch'?async()=>++calls===1?new Response('offline',{status:503}):Response.json(catalog):win[key]});
  const q=selector=>win.document.querySelector(selector);
  const library=createMaddenLibrary({canEdit:()=>true,getPlays:()=>[],onImport:()=>({ok:true})});
  t.after(async()=>{library.close();await win.happyDOM.abort();for(const key of keys){if(old[key])Object.defineProperty(globalThis,key,old[key]);else delete globalThis[key];}});
  q('#opener').focus();await library.open();
  assert.equal(calls,1);assert.equal(q('#madden-root').hidden,false);assert.ok(q('[data-madden=retry]'));
  assert.equal(q('#madden-search'),null,'a failed catalog cannot expose empty import controls as a successful result');
  q('[data-madden=retry]').click();
  const deadline=Date.now()+2000;
  while(!q('#madden-search')&&Date.now()<deadline)await new Promise(resolve=>setImmediate(resolve));
  assert.equal(calls,2);assert.ok(q('#madden-search'));
  assert.equal(win.document.querySelectorAll('[data-madden=team]').length,catalog.teams.length);
  assert.ok(q('[data-madden-card]'));assert.equal(q('[data-madden=retry]'),null);
  q('[data-madden=close]').click();
  assert.equal(q('#madden-root').hidden,true);assert.equal(win.document.activeElement,q('#opener'));
});
