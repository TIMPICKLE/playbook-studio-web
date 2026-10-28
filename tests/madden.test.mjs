import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Window } from 'happy-dom';
import { makeMaddenPlay, filterCatalog, MADDEN_DRAG_TYPE, hasEditableTrace } from '../web/madden-model.js';
import { validatePlay, starterWorkspace, encodeWorkspace, decodeWorkspace, STORAGE_KEY } from '../web/model.js';
import { fieldSVG } from '../web/field.js';
import { handleApi } from '../server/api.mjs';
import { database } from './helpers/db.mjs';

const catalog = JSON.parse(readFileSync(new URL('../web/data/huddle-catalog.json', import.meta.url)));
test('both complete team catalogs have unique identities and importable source metadata', () => {
  assert.deepEqual(catalog.teams.map(t => t.id), ['eagles', 'ravens']);
  assert.equal(new Set(catalog.plays.map(p => p.id)).size, catalog.plays.length);
  for (const team of catalog.teams) {
    const rows = catalog.plays.filter(p => p.team === team.id);
    assert.equal(rows.length, team.playCount);
    assert.equal(rows.length, team.formations.reduce((n, f) => n + f.playCount, 0));
    for (const f of team.formations) assert.ok(rows.some(p => p.sourceUrl.startsWith(f.url)));
  }
  for (const entry of catalog.plays) {
    const play = validatePlay(makeMaddenPlay(entry));
    assert.equal((play.diagramSource || play.reference).sourceUrl, entry.sourceUrl);
    if (hasEditableTrace(entry.id)) {
      assert.equal(play.players.length, 11);
      // These two originals show only four colored assignments; the remaining
      // player is movable but does not acquire an invented fifth route.
      const stationaryPlayer = ['eagles-435b4fe699a13e3c036f','ravens-ae97fd6e39071c3ae0e5'].includes(entry.id);
      if (stationaryPlayer) assert.equal(play.routes.length,4);
      else assert.ok(play.routes.length >= 5);
    }
    else { assert.equal(play.players.length, 0); assert.equal(play.routes.length, 0); }
  }
});
test('catalog filters intersect team, formation and case-insensitive multiword search', () => {
  const entry = catalog.plays.find(p => p.team === 'ravens' && p.group === 'Gun');
  const rows = filterCatalog(catalog, { team: 'ravens', group: entry.group, formation: `${entry.group} ${entry.formation}`, query: entry.name.toLowerCase() });
  assert.ok(rows.some(p => p.id === entry.id));
  assert.ok(rows.every(p => p.team === 'ravens' && p.formation === entry.formation));
  assert.deepEqual(filterCatalog(catalog, { query: 'does-not-exist-xyz' }), []);
});
test('reference diagrams roundtrip through backups without invented players and reject unsafe paths', () => {
  const data = starterWorkspace(), play = makeMaddenPlay(catalog.plays[0]);
  play.notes = 'Read the safety first'; data.plays.push(play);
  assert.deepEqual(decodeWorkspace(encodeWorkspace(data)).plays.at(-1), play);
  assert.match(fieldSVG(play), /<image href="\.\/data\/huddle-art\//);
  for (const image of ['../secret.jpg', 'https://example.org/image.jpg', 'data:image/svg+xml,bad', ['data/huddle-art/abcdef0123456789abcd.jpg']]) assert.throws(() => validatePlay({ ...play, reference: { ...play.reference, image } }));
  assert.throws(() => validatePlay({ ...play, reference: { ...play.reference, sourceUrl: 'https://huddle.gg.evil.test/a' } }));
  assert.throws(() => validatePlay({ ...play, reference: null }));
});
test('the cloud API persists imported diagrams and rejects invalid image metadata', async t => {
  const db = database(t), user = { userId: 'madden-coach', email: 'madden@example.com', displayName: 'Coach' };
  const call = (path, method = 'GET', body) => handleApi(new Request(`https://playbook.test/api${path}`, { method, headers: { Origin: 'https://playbook.test', 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) }), { DB: db }, user);
  const data = starterWorkspace(); data.plays.push(makeMaddenPlay(catalog.plays[0]));
  const created = await call('/workspaces', 'POST', { title: 'Madden Import', data }); assert.equal(created.status, 201);
  const workspace = await created.json();
  const read = await (await call(`/workspaces/${workspace.id}`)).json();
  assert.deepEqual(read.data.plays.at(-1), data.plays.at(-1));
  data.plays.at(-1).reference.image = 'https://example.org/tracker.jpg';
  assert.equal((await call(`/workspaces/${workspace.id}`, 'PUT', { data, revision: 1 })).status, 400);
});
test('Madden UI supports import by click and drag, duplicate prevention, undo, notes, printing, and reload', async t => {
  const win = new Window({ url: 'http://localhost:3000/', width: 1440, height: 1000 });
  win.document.body.innerHTML = readFileSync(new URL('../web/index.html', import.meta.url), 'utf8').split('<body>')[1].split('</body>')[0];
  const names = ['window','document','navigator','localStorage','location','Image','Blob','requestAnimationFrame','cancelAnimationFrame','fetch'];
  const previous = Object.fromEntries(names.map(n => [n, Object.getOwnPropertyDescriptor(globalThis,n)]));
  for (const n of names) Object.defineProperty(globalThis,n,{ configurable:true, value:n === 'fetch' ? async () => new Response(JSON.stringify(catalog), { headers:{'Content-Type':'application/json'} }) : ['requestAnimationFrame','cancelAnimationFrame'].includes(n) ? win[n].bind(win) : win[n] });
  try {
    await import(`../web/app.js?madden-test=${Date.now()}`);
    const doc = win.document, $ = s => doc.querySelector(s), click = action => $(`[data-action="${action}"]`).click();
    click('madden-library'); await new Promise(r => setTimeout(r, 50));
    assert.equal(doc.querySelectorAll('.madden-card').length, Math.min(30, filterCatalog(catalog, { team:'eagles', editableOnly:true }).length));
    $('#madden-editable-only').checked = false; $('#madden-editable-only').dispatchEvent(new win.Event('change', { bubbles:true }));
    assert.equal(doc.querySelectorAll('.madden-card').length, 30);
    const panel = $('.madden-panel'), search = $('#madden-search'), firstCard = $('.madden-card');
    const firstId = firstCard.dataset.maddenCard;
    $('[data-madden="team"][data-id="ravens"]').focus();
    $('[data-madden="team"][data-id="ravens"]').click();
    assert.equal($('.madden-panel'), panel); assert.equal($('#madden-search'), search);
    assert.equal(doc.activeElement.dataset.id, 'ravens');
    $('[data-madden="team"][data-id="eagles"]').click();
    const cardBefore = $('.madden-card');
    $('.madden-card [data-madden="add"]').click();
    assert.equal($('.madden-panel'), panel); assert.equal($('.madden-card'), cardBefore);
    assert.match($('.madden-result-bar').textContent, /已加入/);
    assert.ok($('[data-madden="undo-result"]')); assert.ok($('[data-madden="view-result"]'));
    $('[data-madden="undo-result"]').click();
    assert.equal(decodeWorkspace(win.localStorage.getItem(STORAGE_KEY)).plays.length, 8);
    assert.equal($('.madden-card [data-madden="add"]').disabled, false);
    assert.equal($('.madden-panel'), panel);
    // Repeated addition updates cards without removing them or replaying panel entry.
    for (let i=0;i<3;i++) {
      const card = doc.querySelectorAll('.madden-card')[i];
      card.querySelector('[data-madden="add"]').click();
      assert.equal(doc.querySelectorAll('.madden-card')[i], card);
      assert.equal($('.madden-panel'), panel);
    }
    $('[data-madden="undo-result"]').click();
    $('[data-madden="close"]').click(); click('undo'); click('undo');
    click('madden-library');

    $('.madden-card [data-madden="add"]').click();
    let data = decodeWorkspace(win.localStorage.getItem(STORAGE_KEY));
    assert.equal(data.plays.length, 9); assert.ok(data.plays.at(-1).reference); assert.ok($('.reference-play'));
    assert.equal($('.madden-card [data-madden="add"]').disabled, true);
    const card = doc.querySelectorAll('.madden-card')[1], transfer = new win.DataTransfer();
    const dragEvent = type => { const event = new win.Event(type, { bubbles:true, cancelable:true }); Object.defineProperty(event, 'dataTransfer', { value:transfer }); return event; };
    card.dispatchEvent(dragEvent('dragstart'));
    assert.equal(transfer.getData(MADDEN_DRAG_TYPE), card.dataset.maddenCard);
    $('.madden-drop-target').dispatchEvent(dragEvent('drop'));
    data = decodeWorkspace(win.localStorage.getItem(STORAGE_KEY)); assert.equal(data.plays.length,10);
    $('.madden-drop-target').dispatchEvent(dragEvent('drop'));
    assert.equal(decodeWorkspace(win.localStorage.getItem(STORAGE_KEY)).plays.length,10);
    $('[data-madden="close"]').click(); click('undo'); assert.equal(decodeWorkspace(win.localStorage.getItem(STORAGE_KEY)).plays.length,9);
    click('redo');
    $('[data-prop="notes"]').value = 'Watch the flat defender'; $('[data-prop="notes"]').dispatchEvent(new win.Event('change',{bubbles:true}));
    assert.equal(decodeWorkspace(win.localStorage.getItem(STORAGE_KEY)).plays.at(-1).notes,'Watch the flat defender');
    assert.ok($('#field image')); assert.equal($('[data-action="play"]').disabled,true);
    click('print'); assert.ok($('#print-root image')); click('close-modal');
    const saved = win.localStorage.getItem(STORAGE_KEY);
    await win.happyDOM.abort();
    await import(`../web/app.js?madden-reload=${Date.now()}`);
    const restored = decodeWorkspace(saved).plays.at(-1);
    assert.ok($(`[data-action="choose:${restored.id}"] image`));
  } finally {
    await win.happyDOM.close();
    for (const [n,descriptor] of Object.entries(previous)) { if(descriptor)Object.defineProperty(globalThis,n,descriptor);else delete globalThis[n]; }
  }
});
