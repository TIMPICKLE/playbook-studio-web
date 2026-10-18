import test from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { readFileSync } from 'node:fs';
import { STORAGE_KEY, decodeWorkspace, encodeWorkspace } from '../web/model.js';

test('DOM integration: edit, route drawing, undo, formation, playback, import UI and print layouts', async t => {
  const win = new Window({ url: 'http://localhost:3000/', width: 1440, height: 1000 });
  win.document.body.innerHTML = readFileSync(new URL('../web/index.html', import.meta.url), 'utf8').split('<body>')[1].split('</body>')[0];
  const names = ['window', 'document', 'navigator', 'localStorage', 'location', 'Image', 'Blob', 'requestAnimationFrame', 'cancelAnimationFrame'];
  const previous = Object.fromEntries(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  for (const name of names) Object.defineProperty(globalThis, name, { configurable: true, value: typeof win[name] === 'function' && ['requestAnimationFrame', 'cancelAnimationFrame'].includes(name) ? win[name].bind(win) : win[name] });
  await import(`../web/app.js?test=${Date.now()}`);
  const doc = win.document, query = s => doc.querySelector(s), click = action => { const node = query(`[data-action="${action}"]`); assert.ok(node, `action exists: ${action}`); node.click(); };
  const change = (selector, value) => { const node = query(selector); assert.ok(node, selector); node.value = value; node.dispatchEvent(new win.Event('change', { bubbles: true })); };
  const pointer = (node, type, x = 700, y = 400) => node.dispatchEvent(new win.PointerEvent(type, { bubbles: true, button: 0, clientX: x, clientY: y, pointerId: 1 }));
  const geometry = () => { const svg = query('#field svg'); svg.getBoundingClientRect = () => ({ x: 0, y: 0, left: 0, top: 0, right: 1000, bottom: 800, width: 1000, height: 800 }); };
  try {
    await t.test('seed UI renders actual starter plays and an editable pitch', () => { assert.match(query('h1').textContent, /Mesh/); assert.equal(doc.querySelectorAll('.play-card').length, 5); assert.equal(doc.querySelectorAll('#field [data-player]').length, 11); assert.ok(query('#field svg[role="application"]')); });
    await t.test('editing persists a validated backup and undo restores the name', () => { change('[data-prop="title"]', 'Integration Test'); assert.match(query('h1').textContent, /Integration Test/); assert.equal(decodeWorkspace(win.localStorage.getItem(STORAGE_KEY)).plays[0].title, 'Integration Test'); click('undo'); assert.match(query('h1').textContent, /Mesh/); click('redo'); assert.match(query('h1').textContent, /Integration Test/); });
    await t.test('route pointer sequence creates an editable route with correct origin', () => {
      geometry(); const player = query('#field [data-player]'); pointer(player, 'pointerdown', 400, 500); click('tool:route'); geometry(); pointer(query('#field'), 'pointerdown', 480, 430); geometry(); pointer(query('#field'), 'pointerdown', 580, 350); click('finish-route');
      assert.ok(query('[data-prop="duration"]')); assert.ok(query('#field [data-point]'));
      const data = decodeWorkspace(win.localStorage.getItem(STORAGE_KEY)), route = data.plays[0].routes.at(-1), owner = data.plays[0].players.find(p => p.id === route.playerId); assert.deepEqual(route.points[0], { x: owner.x, y: owner.y }); assert.equal(route.points.length, 3); assert.ok(query('[data-action="undo"]').disabled === false);
    });
    await t.test('player drag moves all attached geometry as one unit', () => {
      click('clear-selection'); geometry(); const before = decodeWorkspace(win.localStorage.getItem(STORAGE_KEY)), player = query('#field [data-player]'); pointer(player, 'pointerdown', 400, 500); geometry(); pointer(query('#field'), 'pointermove', 419.28, 515.2); pointer(query('#field'), 'pointerup', 419.28, 515.2);
      const after = decodeWorkspace(win.localStorage.getItem(STORAGE_KEY)); assert.ok(Math.abs(after.plays[0].players[0].x - before.plays[0].players[0].x - 2) < 1e-6);
      assert.ok(Math.abs(after.plays[0].players[0].y - before.plays[0].players[0].y - 2) < 1e-6); click('clear-selection');
    });
    await t.test('double mirror restores persisted geometry', () => { const before = decodeWorkspace(win.localStorage.getItem(STORAGE_KEY)); click('mirror'); click('mirror'); const after = decodeWorkspace(win.localStorage.getItem(STORAGE_KEY)); assert.ok(Math.abs(after.plays[0].players[0].x - before.plays[0].players[0].x) < 1e-9); });
    await t.test('new play creation honors league size and filtering', () => { click('new'); change('#new-count', '7'); query('#new-title').value = '7 Man Demo'; click('create-play'); assert.match(query('h1').textContent, /7 Man Demo/); assert.equal(doc.querySelectorAll('#field [data-player]').length, 7); assert.equal(decodeWorkspace(win.localStorage.getItem(STORAGE_KEY)).plays.length, 9); });
    await t.test('custom formation can be saved and applied without carrying routes', () => { click('save-formation'); query('#formation-name').value = 'My 7 Man'; click('confirm-formation'); assert.ok(query('#apply-formation').textContent.includes('My 7 Man')); change('#apply-formation', 'builtin:Gun Doubles'); assert.equal(doc.querySelectorAll('#field [data-player]').length, 7); assert.equal(doc.querySelectorAll('#field [data-route]').length, 0); });
    await t.test('playback controls toggle, timeline scrubbing moves real player nodes', () => { click('book:offense'); const first = query('.play-card'); first.click(); const before = query('#field [data-player]').getAttribute('transform'); click('play'); assert.ok(query('[aria-label="暂停战术"]')); click('play'); query('#timeline').value = '4'; query('#timeline').dispatchEvent(new win.Event('input', { bubbles: true })); assert.equal(query('#timeline').value, '4'); assert.match(query('#time-label').textContent, /4.0/); assert.notEqual(query('#field [data-player]').getAttribute('transform'), before); click('reset'); assert.match(query('#time-label').textContent, /0.0/); assert.equal(query('#field [data-player]').getAttribute('transform'), before); });
    await t.test('print previews provide playbook, wristband and call-sheet content', () => { click('print'); assert.ok(query('.print-preview .print-card')); change('#print-scope', 'all'); change('#print-layout', 'wristband'); assert.equal(doc.querySelectorAll('#print-root .print-card').length, 9); assert.equal(doc.querySelectorAll('#print-root .print-page').length, 1); change('#print-layout', 'callsheet'); assert.equal(doc.querySelectorAll('#print-root tbody tr').length, 9); click('close-modal'); });
    await t.test('roster and team edits persist, exports expose all actual options', () => { click('team'); query('#team-name').value = 'Test Team'; click('roster-add'); const row = query('#roster-rows').lastElementChild; row.querySelector('[data-roster-field="name"]').value = 'New Player'; row.querySelector('[data-roster-field="number"]').value = '88'; row.querySelector('[data-roster-field="position"]').value = 'TE'; click('save-team'); const data = decodeWorkspace(win.localStorage.getItem(STORAGE_KEY)); assert.equal(data.team.name, 'Test Team'); assert.equal(data.roster.at(-1).name, 'New Player'); click('export'); for (const a of ['download-svg', 'download-png', 'download-json', 'download-play']) assert.ok(query(`[data-action="${a}"]`)); click('close-modal'); });
    await t.test('deleting an entire play is recoverable through undo', () => { const before = decodeWorkspace(win.localStorage.getItem(STORAGE_KEY)).plays.length; click('delete-play'); click('confirm-delete'); assert.equal(decodeWorkspace(win.localStorage.getItem(STORAGE_KEY)).plays.length, before - 1); click('undo'); assert.equal(decodeWorkspace(win.localStorage.getItem(STORAGE_KEY)).plays.length, before); });
    await t.test('validated JSON import appends without discarding prior plays and undo restores all data', async () => {
      const before = decodeWorkspace(win.localStorage.getItem(STORAGE_KEY));
      const incoming = { ...before, plays: [before.plays[0]], formations: [], roster: [] }, raw = encodeWorkspace(incoming), input = query('#import-input');
      Object.defineProperty(input, 'files', { configurable: true, value: [{ size: raw.length, text: async () => raw }] }); input.dispatchEvent(new win.Event('change', { bubbles: true })); await Promise.resolve(); await Promise.resolve();
      assert.ok(query('[data-action="confirm-import"]')); click('confirm-import');
      const after = decodeWorkspace(win.localStorage.getItem(STORAGE_KEY)); assert.equal(after.plays.length, before.plays.length + 1); assert.deepEqual(after.plays.slice(0, before.plays.length), before.plays); assert.notEqual(after.plays.at(-1).id, before.plays[0].id); click('undo'); assert.deepEqual(decodeWorkspace(win.localStorage.getItem(STORAGE_KEY)), before);
    });
    await t.test('unsupported imports fail before modifying persisted workspace', async () => {
      const before = win.localStorage.getItem(STORAGE_KEY), input = query('#import-input'), raw = '{"format":"playmaker-x","data":{}}';
      Object.defineProperty(input, 'files', { configurable: true, value: [{ size: raw.length, text: async () => raw }] }); input.dispatchEvent(new win.Event('change', { bubbles: true })); await Promise.resolve(); await Promise.resolve();
      assert.match(query('#toast').textContent, /导入失败/); assert.equal(win.localStorage.getItem(STORAGE_KEY), before); assert.ok(!query('[data-action="confirm-import"]'));
    });
    await t.test('one-click 4–3 adds all 11 defenders, preserves offense, avoids duplicates and supports undo', () => {
      const before = decodeWorkspace(win.localStorage.getItem(STORAGE_KEY)), selected = before.plays.find(p => query('h1').textContent.includes(p.title));
      assert.equal(before.settings.league, 7);
      const button = query('[data-action="add-defense-43"]'); assert.ok(button); assert.match(button.textContent, /添加.*4–3/);
      click('add-defense-43');
      const after = decodeWorkspace(win.localStorage.getItem(STORAGE_KEY)), play = after.plays.find(p => p.id === selected.id), defenders = play.players.filter(p => p.side === 'defense');
      assert.equal(defenders.length, 11);
      assert.deepEqual(defenders.map(p => p.label), ['DE', 'DT', 'DT', 'DE', 'W', 'M', 'S', 'CB', 'CB', 'SS', 'FS']);
      assert.deepEqual(play.players.filter(p => p.side === 'offense'), selected.players); assert.deepEqual(play.routes, selected.routes); assert.deepEqual(play.ball, selected.ball);
      assert.match(query('[data-action="add-defense-43"]').textContent, /重设/);
      click('add-defense-43'); const reset = decodeWorkspace(win.localStorage.getItem(STORAGE_KEY)).plays.find(p => p.id === selected.id);
      assert.equal(reset.players.filter(p => p.side === 'defense').length, 11); assert.deepEqual(reset.players.filter(p => p.side === 'offense'), selected.players);
      click('undo'); assert.deepEqual(decodeWorkspace(win.localStorage.getItem(STORAGE_KEY)), after);
      click('undo'); assert.deepEqual(decodeWorkspace(win.localStorage.getItem(STORAGE_KEY)), before);
    });
    await t.test('formation replacement asks before clearing routes, cancel preserves data, and undo restores the confirmed change', () => {
      click('book:offense'); query('.play-card').click(); query('[data-action="clear-selection"]')?.click();
      const before = decodeWorkspace(win.localStorage.getItem(STORAGE_KEY));
      change('#apply-formation', 'builtin:I Formation');
      assert.ok(query('[data-action="confirm-apply-formation"]'));
      assert.match(query('.modal-body').textContent, /清除.*路线/);
      click('close-modal'); assert.deepEqual(decodeWorkspace(win.localStorage.getItem(STORAGE_KEY)), before);
      change('#apply-formation', 'builtin:I Formation'); click('confirm-apply-formation');
      assert.equal(decodeWorkspace(win.localStorage.getItem(STORAGE_KEY)).plays[0].routes.length, 0);
      click('undo'); assert.deepEqual(decodeWorkspace(win.localStorage.getItem(STORAGE_KEY)), before);
    });
    await t.test('unfinished route prompts before changing tools; keep and discard choices follow user intent', () => {
      query('[data-action="clear-selection"]')?.click(); geometry(); pointer(query('#field [data-player]'), 'pointerdown', 400, 500); click('tool:route'); geometry(); pointer(query('#field'), 'pointerdown', 500, 350);
      assert.ok(query('.drawing-steps')); assert.match(query('.drawing-steps').textContent, /完成并保存/);
      click('tool:select'); assert.match(query('.modal h2').textContent, /还没有完成/);
      click('keep-drawing'); assert.ok(query('[data-action="finish-route"]'));
      click('tool:select'); click('discard-draft'); assert.equal(query('[data-action="finish-route"]'), null);
      assert.equal(query('[data-action="tool:select"]').getAttribute('aria-pressed'), 'true');
    });
    await t.test('empty play names show an inline error and keep the dialog open without creating data', () => {
      const before = win.localStorage.getItem(STORAGE_KEY); click('new'); query('#new-title').value = '  '; click('create-play');
      assert.ok(query('.modal')); assert.match(query('.form-feedback').textContent, /名字/); assert.equal(win.localStorage.getItem(STORAGE_KEY), before); click('close-modal');
    });
    await t.test('resetting existing defenders removes only their routes and repairs ball references', () => {
      const before = decodeWorkspace(win.localStorage.getItem(STORAGE_KEY));
      click('add-player:defense'); const first = decodeWorkspace(win.localStorage.getItem(STORAGE_KEY)).plays[0].players.at(-1);
      click('tool:route'); geometry(); pointer(query('#field'), 'pointerdown', 500, 300); click('finish-route'); click('clear-selection');
      click('add-player:defense'); const second = decodeWorkspace(win.localStorage.getItem(STORAGE_KEY)).plays[0].players.at(-1); click('clear-selection');
      change('[data-ball="holderId"]', first.id); change('[data-ball="receiverId"]', second.id);
      const withDefenders = decodeWorkspace(win.localStorage.getItem(STORAGE_KEY));
      click('add-defense-43'); assert.match(query('.modal-body').textContent,/清除.*路线/); click('confirm-defense-43'); const after = decodeWorkspace(win.localStorage.getItem(STORAGE_KEY)), play = after.plays[0];
      assert.equal(play.players.filter(p => p.side === 'defense').length, 11);
      assert.deepEqual(play.routes, before.plays[0].routes);
      assert.equal(play.ball.holderId, play.players.find(p => p.label === 'QB').id); assert.equal(play.ball.receiverId, '');
      assert.ok(play.routes.every(r => play.players.some(p => p.id === r.playerId)));
      click('undo'); assert.deepEqual(decodeWorkspace(win.localStorage.getItem(STORAGE_KEY)), withDefenders);
    });
    await t.test('editing a property keeps the inspector and the next field mounted, so changing focus does not swallow the next click', () => {
      query('[data-action="clear-selection"]')?.click();const inspector=query('.inspector'), name=query('[data-prop="title"]'), next=query('[data-prop="category"]');
      change('[data-prop="title"]','Stable inspector');assert.equal(query('.inspector'),inspector);assert.equal(query('[data-prop="title"]'),name);assert.equal(query('[data-prop="category"]'),next);assert.match(query('h1').textContent,/Stable inspector/);click('undo');
    });
    await t.test('drag batches pointer samples, preserves SVG nodes during movement, and commits the final position once', async () => {
      click('edit-mode');query('[data-action="clear-selection"]')?.click();geometry();const before=win.localStorage.getItem(STORAGE_KEY);
      pointer(query('#field [data-player]'),'pointerdown',400,500);geometry();const svg=query('#field svg'), player=query('#field [data-player]'), start=player.getAttribute('transform');
      for(let i=1;i<=20;i++)pointer(query('#field'),'pointermove',400+i,500+i);
      await new Promise(resolve=>win.requestAnimationFrame(resolve));
      assert.equal(query('#field svg'),svg);assert.equal(query('#field [data-player]'),player);assert.notEqual(player.getAttribute('transform'),start);assert.equal(win.localStorage.getItem(STORAGE_KEY),before);
      pointer(query('#field'),'pointerup',420,520);assert.notEqual(win.localStorage.getItem(STORAGE_KEY),before);click('undo');assert.deepEqual(decodeWorkspace(win.localStorage.getItem(STORAGE_KEY)),decodeWorkspace(before));
    });
    await t.test('live route preview never persists ghost points; backstep and same-tool clicks preserve the draft and HUD clicks reach their button', async () => {
      geometry();pointer(query('#field [data-player]'),'pointerdown',400,500);pointer(query('#field'),'pointerup',400,500);click('tool:route');geometry();
      const before=win.localStorage.getItem(STORAGE_KEY), svg=query('#field svg');pointer(query('#field'),'pointermove',650,300);
      await new Promise(resolve=>win.requestAnimationFrame(resolve));
      assert.equal(query('#field svg'),svg);assert.match(query('.draft-preview').getAttribute('d'),/ L/);assert.equal(query('.draft-cursor').getAttribute('visibility'),'visible');assert.equal(win.localStorage.getItem(STORAGE_KEY),before);
      pointer(query('#field'),'pointerdown',500,350);pointer(query('#field'),'pointerdown',600,250);click('tool:route');assert.match(query('.context-player').textContent,/2 个路线点/);
      click('undo-point');assert.match(query('.context-player').textContent,/1 个路线点/);assert.equal(win.localStorage.getItem(STORAGE_KEY),before);
      const finish=query('[data-action="finish-route"]');pointer(finish,'pointerdown',500,350);finish.click();assert.ok(query('[data-prop="duration"]'));const saved=decodeWorkspace(win.localStorage.getItem(STORAGE_KEY)).plays[0],route=saved.routes.at(-1);assert.equal(route.points.length,2);assert.equal(route.optional,false);assert.equal(saved.routes.filter(r=>r.playerId===route.playerId&&!r.optional&&['route','motion'].includes(r.kind)).length,1);click('undo');
    });
    await t.test('pausing and scrubbing keep the same player nodes; returning to edit restores initial positions without changing saved data', () => {
      query('[data-action="clear-selection"]')?.click();const before=win.localStorage.getItem(STORAGE_KEY);click('play');const svg=query('#field svg'), player=query('#field [data-player]');click('play');assert.equal(query('#field svg'),svg);assert.equal(query('#field [data-player]'),player);
      query('#timeline').value='2.5';query('#timeline').dispatchEvent(new win.Event('input',{bubbles:true}));assert.equal(query('#field svg'),svg);assert.equal(query('[data-action="rehearse-mode"]').getAttribute('aria-pressed'),'true');assert.match(query('#playback-phase').textContent,/传球中/);
      click('edit-mode');assert.equal(query('[data-action="edit-mode"]').getAttribute('aria-pressed'),'true');assert.match(query('#time-label').textContent,/0.0/);assert.equal(win.localStorage.getItem(STORAGE_KEY),before);
    });
  } finally { await win.happyDOM.abort(); for (const name of names) { const desc = previous[name]; if (desc) Object.defineProperty(globalThis, name, desc); else delete globalThis[name]; } }
});
