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
      // These reviewed originals show only four visible assignments; the remaining
      // player is movable but does not acquire an invented fifth route.
      const stationaryPlayer = ['eagles-435b4fe699a13e3c036f','ravens-ae97fd6e39071c3ae0e5','ravens-3e40d279a11e7ef5628d','ravens-e7dac016716007ed60bd','eagles-a0fd05ba219769c9a861','eagles-04c50ebab4c15cdc2083','eagles-23b54c7b8a3a7d5c2922','eagles-70a79aa21ebd643e7fa1','ravens-69c8818e1a9a93acefb3','ravens-dce160819cf177f952dd','ravens-518ace0c313870800942','eagles-66c2f2f176cfa7911cdb','eagles-56621ebf973cc126f119','eagles-b00013dc3380c2f5b538','ravens-099d020a044bf7878ca6','ravens-038f3e33d95bffdc7117','eagles-d31f27b2c587abbe115d','eagles-2d1026ef8db01bde4845','ravens-3f10fa0d8eae78615dfe','eagles-5596a944605fa28088c3'].includes(entry.id);
      // These source-reviewed RPO and passing diagrams visibly leave some players without drawn assignments.
      const newReviewedCounts = {"2":["eagles-03f685866fbd383bc829","eagles-9e5d03f848beb9a8b5d6"],"3":["eagles-8755fc0eb674e740b2b4","eagles-df9069d0dbb8be1233b9","eagles-3ca52b31d86f8c74d9bb","eagles-7f2f27ac3deb707e1081","ravens-65afa7c49574e9e524a6","ravens-eb4d77f026a8ffc25ba0","ravens-636067413ed2435181ac","eagles-5984fc46f848cfde5c82","eagles-2e363249bee3171e5465","eagles-704398da5fb27d258802","eagles-1139f5bdcf456adb9818","eagles-59a70d7a55b50d7fdde0","eagles-fa3dc488e9a2b58c0fde","eagles-cb4a6ea45f17ce46278c","eagles-8a0ffaa7362d4678123e","eagles-e5bfc403eb676efff532","ravens-4dd367bd99e69ac5d767","ravens-223479aab3a9f655bb4c","eagles-dc44ea12e54af99f3ee0","ravens-2f2e327d6e209600c188"],"4":["eagles-02156f5cb9ff4d9aa313","eagles-0fabe6e8cb236a6796ca","eagles-aceaf231614fd7035675","ravens-c16355db578dfdffac98","eagles-5bb72ee4536a4bcca838","eagles-94be657905499cbe2995","eagles-49d5a6730ff350c0d628","eagles-86757f6a9e50cc4f6a97","eagles-271231362540fd2d4430","eagles-874f7338ead39106abe0","ravens-e300b494b947b7d685b0","ravens-d0d2239f81294b029d65","ravens-f52b2e2f1cc8a1dc67b9","eagles-2e870d9a77663474b216","eagles-53ad7f8769e86be6eb32","ravens-6ef9a5e51d6e1384f08f","eagles-be8a8c89b20e2ba5b19c","eagles-af73e0a2270d64e340b1","ravens-7df9d61977d2027d69ca","ravens-4915dc91c7bfe2887afe","ravens-ddedef4576a502960255","ravens-b6cfc2a1e130f10b84e3","ravens-ea3dba2846df4af15b80","ravens-2d1daea16f2abdf55cbc","ravens-797b7b598de9d931fc8a","ravens-0744f02296246bb27bf3","eagles-c5d8d9a5f04bef2a0eb7","ravens-06b0c037b78ab6b7a88d","ravens-ff9ce8fd25d8a9a4f9b8","ravens-c0b16f640125507d1c01","eagles-eb9a32953a50b39ce8d6","ravens-f2166f60357f1ed691f2","eagles-389103a7c85a9ab6f347","eagles-77a30b3029a8926c5d83","eagles-9e36e0db9d6628ad03a9","eagles-b41772df26ea0133006f","eagles-07f253809e94b487a0c3","ravens-1459b8ff656886b77dd3","ravens-c98872a3224e1adab735","ravens-fe9a7838e6d44c9d75b8","ravens-33488314ef4fcf5ff7fa"]};
      const expectedReviewedCount = [2,3,4].find(n=>newReviewedCounts[n].includes(entry.id));
      if (expectedReviewedCount) assert.equal(play.routes.length,expectedReviewedCount);
      else if (stationaryPlayer) assert.equal(play.routes.length,4);
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
