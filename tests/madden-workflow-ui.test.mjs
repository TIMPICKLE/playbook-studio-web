import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Window } from 'happy-dom';
import { createMaddenLibrary } from '../web/madden.js';
import { filterCatalog } from '../web/madden-model.js';

const catalog = JSON.parse(readFileSync(new URL('../web/data/huddle-catalog.json', import.meta.url)));
async function fixture(t, onImport = () => ({ok:true})) {
  const win = new Window({url:'https://playbook.test/local.html',width:1440,height:900});
  win.document.body.innerHTML = '<button id="opener">Library</button><div id="madden-root" hidden></div>';
  const names = ['window','document','fetch'];
  const prior = Object.fromEntries(names.map(name => [name,Object.getOwnPropertyDescriptor(globalThis,name)]));
  for (const name of names) Object.defineProperty(globalThis,name,{configurable:true,value:name === 'fetch' ? async () => new Response(JSON.stringify(catalog)) : win[name]});
  const plays = [], q = selector => win.document.querySelector(selector);
  const library = createMaddenLibrary({canEdit:()=>true,getPlays:()=>plays,onImport});
  t.after(async () => {
    library.close(); await win.happyDOM.abort();
    for (const name of names) { if (prior[name]) Object.defineProperty(globalThis,name,prior[name]); else delete globalThis[name]; }
  });
  await library.open();
  const input = (selector,value) => { q(selector).value=value; q(selector).dispatchEvent(new win.Event('input',{bubbles:true})); };
  return {win,q,library,plays,input};
}

test('an explicit all-team scope searches names and team metadata without changing default callers', () => {
  assert.ok(filterCatalog(catalog).every(play => play.team === 'eagles'));
  const all = filterCatalog(catalog,{team:'',query:'mesh'});
  assert.ok(new Set(all.map(play => play.team)).size > 1);
  assert.ok(all.every(play => play.name.toLowerCase().includes('mesh')));
  const ravens = filterCatalog(catalog,{team:'',query:'Baltimore'});
  assert.ok(ravens.length > 0); assert.ok(ravens.every(play => play.team === 'ravens'));
});

test('search scope is explicit and team lookup leaves the play query intact', async t => {
  const f = await fixture(t);
  f.input('#madden-search','mesh');
  f.q('[data-madden=scope][data-scope=all]').click();
  assert.equal(f.q('[data-madden=scope][data-scope=all]').getAttribute('aria-pressed'),'true');
  assert.equal(f.q('#madden-search').value,'mesh');
  assert.match(f.q('.madden-active-scope').textContent,/全部球队/);
  const expected = filterCatalog(catalog,{team:'',query:'mesh',editableOnly:true});
  assert.equal(f.win.document.querySelectorAll('.madden-card').length,Math.min(30,expected.length));
  assert.match(f.q('.madden-card-body small').textContent,/Eagles|Ravens|49ers|Bengals|Bills|Chiefs|Cowboys|Dolphins|Lions|Packers|Rams|Seahawks|Texans/);
  f.input('#madden-team-search','Baltimore');
  const visible = [...f.win.document.querySelectorAll('[data-madden=team]')].filter(button => !button.hidden);
  assert.deepEqual(visible.map(button => button.dataset.id),['ravens']);
  visible[0].click();
  assert.equal(f.q('[data-madden=scope][data-scope=team]').getAttribute('aria-pressed'),'true');
  assert.equal(f.q('#madden-search').value,'mesh');
  assert.match(f.q('.madden-active-scope').textContent,/Ravens/);
  f.input('#madden-team-search','no-team-xyz');
  assert.equal(f.q('.madden-team-empty').hidden,false);
  f.q('[data-madden=clear-teams]').click();
  assert.equal(f.q('#madden-team-search').value,'');
  assert.equal(f.q('.madden-team-empty').hidden,true);
});

test('preview and reopening restore filters, page and both scroll containers', async t => {
  const f = await fixture(t);
  f.q('[data-madden=scope][data-scope=all]').click();
  f.q('[data-madden=next]').click();
  const firstId = f.q('.madden-card').dataset.maddenCard;
  f.q('.madden-results').scrollTop=430;
  f.q('.madden-panel').scrollTop=120;
  f.q('.madden-card [data-madden=preview]').click();
  f.q('.madden-detail [data-madden=back]').click();
  assert.equal(f.q('.madden-results').scrollTop,430);
  assert.equal(f.q('.madden-panel').scrollTop,120);
  f.library.close(); await f.library.open();
  assert.equal(f.q('[data-madden=scope][data-scope=all]').getAttribute('aria-pressed'),'true');
  assert.equal(f.q('.madden-card').dataset.maddenCard,firstId);
  assert.equal(f.q('.madden-results').scrollTop,430);
  assert.equal(f.q('.madden-panel').scrollTop,120);
});

test('failed additions offer a direct retry and successful feedback survives browsing', async t => {
  let attempts=0,undoable=false;
  const f = await fixture(t,() => {
    attempts++;
    if (attempts === 1) throw Error('offline');
    undoable=true;
    return {ok:true,canUndo:()=>undoable,undo:()=>{undoable=false;},view:()=>{}};
  });
  const settle = async () => { for (let i=0;i<20 && f.q('.madden-panel').getAttribute('aria-busy') === 'true';i++) await new Promise(resolve=>setImmediate(resolve)); };
  f.q('.madden-card [data-madden=add]').click(); await settle();
  assert.equal(f.q('.madden-result-bar').dataset.type,'error');
  assert.ok(f.q('[data-madden=retry-add]'));
  f.q('[data-madden=retry-add]').click(); await settle();
  assert.equal(attempts,2); assert.equal(f.q('.madden-result-bar').dataset.type,'success');
  f.input('#madden-search','mesh');
  f.q('[data-madden=scope][data-scope=all]').click();
  assert.equal(f.q('.madden-result-bar').dataset.type,'success');
  assert.ok(f.q('[data-madden=undo-result]')); assert.ok(f.q('[data-madden=view-result]'));
});

test('changing a filter during loading cannot expose unlocked add or drag controls', async t => {
  let finish;
  const pending=new Promise(resolve=>{finish=resolve;});
  const f=await fixture(t,()=>pending);
  f.q('.madden-card [data-madden=add]').click();
  f.input('#madden-search','mesh');
  assert.equal(f.q('.madden-panel').getAttribute('aria-busy'),'true');
  for (const card of f.win.document.querySelectorAll('.madden-card')) {
    assert.equal(card.getAttribute('draggable'),'false');
    assert.equal(card.querySelector('[data-madden=add]').disabled,true);
  }
  finish({ok:true});
  for(let i=0;i<20 && f.q('.madden-panel').getAttribute('aria-busy') === 'true';i++) await new Promise(resolve=>setImmediate(resolve));
  assert.equal(f.q('.madden-result-bar').dataset.type,'success');
});
