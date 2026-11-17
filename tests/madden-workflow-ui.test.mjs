import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Window } from 'happy-dom';
import { createMaddenLibrary } from '../web/madden.js';
import { filterCatalog, hasEditableTrace } from '../web/madden-model.js';

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

test('desktop preview keeps keyboard navigation on visible controls and restores its list launcher', async t => {
  const f = await fixture(t);
  const launcher = f.q('.madden-card [data-madden=preview]');
  launcher.click();
  const back = f.q('.madden-detail [data-madden=back]');
  assert.equal(f.win.document.activeElement,back);
  assert.ok(f.q('#madden-search').closest('[inert]'),'the covered list must leave the accessibility and keyboard navigation tree');
  const last = f.q('.madden-detail > a');
  last.focus();
  const forward = new f.win.KeyboardEvent('keydown',{key:'Tab',bubbles:true,cancelable:true});
  last.dispatchEvent(forward);
  assert.equal(forward.defaultPrevented,true,'desktop preview must not focus the covered list or background editor');
  assert.equal(f.win.document.activeElement,back);
  const reverse = new f.win.KeyboardEvent('keydown',{key:'Tab',shiftKey:true,bubbles:true,cancelable:true});
  back.dispatchEvent(reverse);
  assert.equal(reverse.defaultPrevented,true);
  assert.equal(f.win.document.activeElement,last);
  last.dispatchEvent(new f.win.KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));
  assert.equal(f.q('.madden-detail'),null);
  assert.equal(f.q('#madden-search').closest('[inert]'),null,'returning restores list controls');
  assert.equal(f.win.document.activeElement,launcher,'Escape restores the preview launcher without changing the selected team');
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

test('formation and name filters intersect across teams and an empty result can recover without losing its scope', async t => {
  const f=await fixture(t);
  f.q('[data-madden=scope][data-scope=all]').click();
  const entry=catalog.plays.find(play=>hasEditableTrace(play.id));
  const set=(selector,value)=>{f.q(selector).value=value;f.q(selector).dispatchEvent(new f.win.Event('change',{bubbles:true}));};
  const groupNode=f.q('#madden-group'),formationNode=f.q('#madden-formation'),searchNode=f.q('#madden-search');
  groupNode.focus();
  set('#madden-group',entry.group);
  assert.equal(f.q('#madden-group'),groupNode);assert.equal(f.win.document.activeElement,groupNode);
  formationNode.focus();
  set('#madden-formation',`${entry.group} ${entry.formation}`);
  assert.equal(f.q('#madden-formation'),formationNode);assert.equal(f.win.document.activeElement,formationNode);
  searchNode.focus();
  f.input('#madden-search',entry.name.toUpperCase());
  assert.equal(f.q('#madden-search'),searchNode);assert.equal(f.win.document.activeElement,searchNode);
  const visible=[...f.win.document.querySelectorAll('[data-madden-card]')].map(card=>card.dataset.maddenCard);
  assert.ok(visible.includes(entry.id));
  for(const id of visible){
    const row=catalog.plays.find(play=>play.id===id);
    assert.equal(row.group,entry.group);assert.equal(row.formation,entry.formation);
    assert.ok(row.name.toLowerCase().includes(entry.name.toLowerCase()));
  }
  f.input('#madden-search','NO_SUCH_PLAY_XYZ');
  assert.equal(f.win.document.querySelectorAll('[data-madden-card]').length,0);
  assert.ok(f.q('.madden-empty [data-madden=clear]'));
  f.q('.madden-empty [data-madden=clear]').click();
  assert.equal(f.q('#madden-search').value,'');assert.equal(f.q('#madden-group').value,'');assert.equal(f.q('#madden-formation').value,'');
  assert.equal(f.q('[data-madden=scope][data-scope=all]').getAttribute('aria-pressed'),'true');
  assert.equal(f.q('#madden-editable-only').checked,true);
  assert.equal(f.win.document.querySelectorAll('[data-madden-card]').length,30);
  assert.equal(f.q('[data-madden=prev]').disabled,true,'recovering from no results returns to the first result page');
});
