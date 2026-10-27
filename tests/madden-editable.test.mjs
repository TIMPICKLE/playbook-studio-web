import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Window } from 'happy-dom';
import { EDITABLE_TRACES } from '../web/data/madden-editable.js';
import { makeMaddenPlay, filterCatalog } from '../web/madden-model.js';
import { validatePlay, starterWorkspace, encodeWorkspace, decodeWorkspace, movePlayer, mirrorPlay, animatedPlayer, STORAGE_KEY } from '../web/model.js';
import { handleApi } from '../server/api.mjs';
import { database } from './helpers/db.mjs';
const entries = Object.values(EDITABLE_TRACES);
const audit = JSON.parse(readFileSync(new URL('../docs/madden-conversion-audit.json', import.meta.url)));
const catalog = JSON.parse(readFileSync(new URL('../web/data/huddle-catalog.json', import.meta.url)));

test('all source-backed traces retain independent editable geometry across move, mirror and backup', () => {
  assert.equal(entries.length, audit.summary.editableTotal);
  for (const team of ['eagles','ravens']) assert.equal(filterCatalog(catalog,{team,editableOnly:true}).length,audit.summary.editableByTeam[team]);
  for (const entry of entries) {
    assert.equal(catalog.plays.find(p=>p.id===entry.id).image,entry.image);
    const play = validatePlay(makeMaddenPlay(entry)), other = makeMaddenPlay(entry);
    assert.ok(!play.reference); assert.equal(play.players.length,11); assert.equal(new Set(play.players.map(p=>p.label)).size,11);
    assert.equal(play.diagramSource.catalogId, entry.id); assert.notEqual(play.players[0].id,other.players[0].id);
    const owner = play.players.find(p=>p.id===play.routes.find(r=>r.kind==='route'&&!r.optional).playerId);
    assert.notDeepEqual(animatedPlayer(play,owner,2),{x:owner.x,y:owner.y});
    const routes = play.routes.filter(r=>r.playerId===owner.id), before = routes.map(r=>structuredClone(r.points));
    movePlayer(play, owner.id, owner.x+2,owner.y+1);
    routes.forEach((r,i)=>r.points.forEach((point,j)=>{assert.ok(Math.abs(point.x-before[i][j].x-2)<.001);assert.ok(Math.abs(point.y-before[i][j].y-1)<.001);}));
    validatePlay(play); validatePlay(mirrorPlay(play));
    const data=starterWorkspace();data.plays.push(play);
    assert.deepEqual(decodeWorkspace(encodeWorkspace(data)).plays.at(-1),play);
    assert.throws(()=>validatePlay({...play,diagramSource:{...play.diagramSource,image:'../bad.jpg'}}));
    assert.throws(()=>validatePlay({...play,diagramSource:{...play.diagramSource,traceVersion:999}}));
  }
});

test('the cloud saves the full reviewed batch of editable plays and source attribution without image-mode restrictions', async t=>{
  const db=database(t),user={userId:'traced-coach',email:'trace@example.com',displayName:'Trace Coach'};
  const data=starterWorkspace();data.plays.push(...entries.map(makeMaddenPlay));
  const response=await handleApi(new Request('https://playbook.test/api/workspaces',{method:'POST',headers:{Origin:'https://playbook.test','Content-Type':'application/json'},body:JSON.stringify({title:'Editable batch',data})}),{DB:db},user);
  assert.equal(response.status,201); const record=await response.json();
  const read=await handleApi(new Request(`https://playbook.test/api/workspaces/${record.id}`),{DB:db},user);
  const saved=await read.json();assert.equal(saved.data.plays.filter(p=>p.diagramSource).length,entries.length);
  assert.deepEqual(saved.data.plays.at(-1),data.plays.at(-1));
});

test('an existing original gets an editable copy; drag, mirror, playback and source comparison remain available',async()=>{
  const win=new Window({url:'http://localhost:3000/',width:1440,height:1000});
  win.document.body.innerHTML=readFileSync(new URL('../web/index.html',import.meta.url),'utf8').split('<body>')[1].split('</body>')[0];
  const source=entries[0], data=starterWorkspace();
  const original=makeMaddenPlay(catalog.plays[0]);
  original.title=source.name;original.reference={provider:'huddle.gg',catalogId:source.id,team:source.team,game:source.game,sourceUrl:source.sourceUrl,image:source.image};original.notes='My coaching note';
  data.plays.unshift(original); win.localStorage.setItem(STORAGE_KEY,encodeWorkspace(data));
  const names=['window','document','navigator','localStorage','location','Image','Blob','requestAnimationFrame','cancelAnimationFrame','fetch'];
  const previous=Object.fromEntries(names.map(n=>[n,Object.getOwnPropertyDescriptor(globalThis,n)]));
  for(const n of names)Object.defineProperty(globalThis,n,{configurable:true,value:n==='fetch'?async()=>new Response(JSON.stringify(catalog)):['requestAnimationFrame','cancelAnimationFrame'].includes(n)?win[n].bind(win):win[n]});
  try {
    await import(`../web/app.js?traced=${Date.now()}`);
    const $=s=>win.document.querySelector(s),click=a=>$(`[data-action="${a}"]`).click();
    click('convert-reference');
    let saved=decodeWorkspace(win.localStorage.getItem(STORAGE_KEY));
    assert.equal(saved.plays.length,10);assert.deepEqual(saved.plays[0],original);
    const copy=saved.plays.at(-1);assert.ok(copy.diagramSource);assert.match(copy.notes,/My coaching note/);
    assert.equal(win.document.querySelectorAll('#field [data-player]').length,11);assert.equal($('[data-action="play"]').disabled,false);
    const svg=$('#field svg');svg.getBoundingClientRect=()=>({left:0,top:0,width:1000,height:800});
    const player=$('#field [data-player]');
    const dispatch=(type,x,y,node=$('#field'))=>node.dispatchEvent(new win.PointerEvent(type,{bubbles:true,button:0,clientX:x,clientY:y,pointerId:1}));
    dispatch('pointerdown',400,500,player);dispatch('pointermove',420,510);dispatch('pointerup',420,510);
    saved=decodeWorkspace(win.localStorage.getItem(STORAGE_KEY));assert.notEqual(saved.plays.at(-1).players[0].x,copy.players[0].x);
    click('undo');click('mirror');click('undo');click('play');click('play');click('reset');
    click('compare-source');assert.equal($('.source-comparison').getAttribute('src'),'./'+source.image);click('close-modal');
    click('madden-library');await new Promise(r=>setTimeout(r,30));
    assert.equal(win.document.querySelectorAll('.madden-card').length,Math.min(30,audit.summary.editableByTeam.eagles));
    // The original can now be on a later page as the library grows.
    const search=$('#madden-search');search.value=source.name;search.dispatchEvent(new win.Event('input',{bubbles:true}));
    const card=$(`[data-madden-card="${source.id}"]`);assert.ok(card);assert.equal(card.querySelector('[data-madden="add"]').disabled,true);
    search.value='';search.dispatchEvent(new win.Event('input',{bubbles:true}));
    const next=[...win.document.querySelectorAll('.madden-card')].find(node=>!node.querySelector('[data-madden="add"]').disabled);
    assert.ok(next);next.querySelector('[data-madden="add"]').click();
    assert.match($('.madden-result-bar').textContent,/可编辑/);
    click('madden-library'); // editor controls can reopen the same persistent panel
    $('[data-madden="close"]').click();
    saved=decodeWorkspace(win.localStorage.getItem(STORAGE_KEY));assert.equal(saved.plays.filter(p=>p.diagramSource).length,2);
    assert.deepEqual(saved.plays[0],original);
  } finally { await win.happyDOM.close();for(const [n,d] of Object.entries(previous)){if(d)Object.defineProperty(globalThis,n,d);else delete globalThis[n];} }
});
