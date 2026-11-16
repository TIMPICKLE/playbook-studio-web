import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Window } from 'happy-dom';
import { STORAGE_KEY, starterWorkspace, encodeWorkspace, decodeWorkspace } from '../web/model.js';

let instance = 0;
async function editor({ raw, locale = 'zh-CN' } = {}) {
  const win = new Window({ url: 'http://localhost:3000/', width: 1440, height: 1000 });
  win.document.body.innerHTML = readFileSync(new URL('../web/index.html', import.meta.url), 'utf8').split('<body>')[1].split('</body>')[0];
  if (raw) win.localStorage.setItem(STORAGE_KEY, raw);
  const names = ['window', 'document', 'navigator', 'localStorage', 'location', 'history', 'Image', 'Blob', 'requestAnimationFrame', 'cancelAnimationFrame'];
  const previous = Object.fromEntries(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  for (const name of names) Object.defineProperty(globalThis, name, { configurable: true, value: ['requestAnimationFrame', 'cancelAnimationFrame'].includes(name) ? win[name].bind(win) : win[name] });
  const { setLocale } = await import('../web/i18n.js');
  setLocale(locale);
  await import(`../web/app.js?flag5-ui=${++instance}`);
  const q = selector => win.document.querySelector(selector);
  const click = action => { const node = q(`[data-action="${action}"]`); assert.ok(node, `Action exists: ${action}`); node.click(); };
  const change = (selector, value) => { const node = q(selector); assert.ok(node, selector); node.value = String(value); node.dispatchEvent(new win.Event('change', { bubbles: true })); };
  const saved = () => decodeWorkspace(win.localStorage.getItem(STORAGE_KEY));
  const current = () => saved().plays.find(play => q('h1').textContent.includes(play.title));
  const pointer = (node, type, x, y) => node.dispatchEvent(new win.PointerEvent(type, { bubbles: true, button: 0, clientX: x, clientY: y, pointerId: 1 }));
  const geometry = () => { q('#field .pitch-svg').getBoundingClientRect = () => ({ x: 0, y: 0, left: 0, top: 0, right: 1000, bottom: 800, width: 1000, height: 800 }); };
  q('[data-cloud-action="enter-editor"]').click();
  return { win, q, click, change, saved, current, pointer, geometry,
    async close() {
      await win.happyDOM.abort();
      for (const name of names) { const descriptor = previous[name]; if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name]; }
    },
  };
}
const countSide = (play, side) => play.players.filter(player => player.side === side).length;

test('5v5 flag UI carries its format through creation, opponents, formations, rehearsal and mixed playbooks', { timeout: 30000 }, async t => {
  const initial = starterWorkspace();
  // Exercise an existing play written before per-play league metadata existed.
  delete initial.plays[0].league;
  const legacyId = initial.plays[0].id;
  const host = await editor({ raw: encodeWorkspace(initial) });
  const { win, q, click, change, saved, current, pointer, geometry } = host;
  let flagId, customId, raw;
  try {
    await t.test('five-player selection offers flag formations and changes with the selected unit', () => {
      click('new');
      assert.match(q('#new-count option[value="5"]').textContent, /5.*腰旗/);
      change('#new-count', 5);
      assert.ok([...q('#new-formation').options].every(option => option.value.startsWith('Flag 5 ')));
      assert.ok([...q('#new-formation').options].some(option => option.value === 'Flag 5 Spread'));
      assert.equal(q('#new-format-note').hidden, false);
      change('#new-book', 'defense');
      assert.deepEqual([...q('#new-formation').options].map(option => option.value), ['Flag 5 Zone', 'Flag 5 Man']);
      assert.equal(q('#new-formation').value, 'Flag 5 Zone');
      q('#new-title').value = 'Flag defense integration';
      click('create-play');
      const play = current();
      assert.equal(play.league, 5);
      assert.equal(countSide(play, 'defense'), 5);
      assert.deepEqual(new Set(play.players.map(player => player.label)), new Set(['R', 'LCB', 'RCB', 'S', 'DB']));
      const defenders = structuredClone(play.players);
      click('opponents');
      assert.equal(countSide(current(), 'offense'), 5);
      assert.deepEqual(current().players.filter(player => player.side === 'defense'), defenders);
      click('opponents');
      assert.deepEqual(current().players, defenders);
    });

    await t.test('five-player offense and a formation change preserve the five opposing markers', () => {
      click('new');
      assert.equal(q('#new-count').value, '5');
      change('#new-book', 'offense');
      change('#new-formation', 'Flag 5 Trips');
      q('#new-title').value = 'Flag offense integration';
      click('create-play');
      const play = current(); flagId = play.id;
      assert.equal(play.league, 5);
      assert.equal(play.players.length, 5);
      assert.deepEqual(new Set(play.players.map(player => player.label)), new Set(['C', 'QB', 'X', 'Y', 'Z']));
      assert.equal(play.routes.length, 0, 'flag formations do not preset blocking');
      assert.match(q('[data-play-format]').textContent, /5.*腰旗/);
      assert.equal(q('[data-action="add-defense-43"]'), null, 'the flag menu offers matching five-player opponents');
      click('opponents');
      const paired = current(), defenders = structuredClone(paired.players.filter(player => player.side === 'defense'));
      assert.equal(countSide(paired, 'offense'), 5); assert.equal(defenders.length, 5);
      change('#apply-formation', 'builtin:Flag 5 Bunch');
      assert.equal(current().formation, 'Flag 5 Bunch');
      assert.equal(countSide(current(), 'offense'), 5);
      assert.deepEqual(current().players.filter(player => player.side === 'defense'), defenders);
      click('undo');
      assert.deepEqual(current(), paired, 'formation changes undo as a complete operation');
    });

    await t.test('the center can receive a drawn route, rehearse, print and export as a five-player play', async () => {
      const center = current().players.find(player => player.label === 'C');
      q(`#field [data-player="${center.id}"]`).dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      click('tool:route');
      geometry(); pointer(q('#field'), 'pointerdown', 500, 410);
      geometry(); pointer(q('#field'), 'pointerdown', 650, 320);
      click('finish-route');
      const route = current().routes.find(route => route.playerId === center.id);
      assert.ok(route); assert.equal(route.kind, 'route'); assert.equal(route.points.length, 3);
      click('clear-selection');
      change('[data-ball="receiverId"]', center.id);
      assert.equal(current().ball.receiverId, center.id);
      const marker = q(`#field [data-player="${center.id}"]`), before = marker.getAttribute('transform');
      q('#timeline').value = '3'; q('#timeline').dispatchEvent(new win.Event('input', { bubbles: true }));
      assert.notEqual(q(`#field [data-player="${center.id}"]`).getAttribute('transform'), before);
      assert.equal(q('#field .pitch-svg').querySelectorAll('[data-player]').length, 10);
      click('edit-mode');
      click('print');
      assert.equal(q('#print-root').querySelectorAll('.print-card').length, 1);
      assert.equal(q('#print-root').querySelectorAll('[data-player]').length, 10);
      click('close-modal');
      const originalCreate = URL.createObjectURL, originalRevoke = URL.revokeObjectURL;
      const originalClick = win.HTMLAnchorElement.prototype.click;
      let exported;
      URL.createObjectURL = blob => { exported = blob; return 'blob:flag5-export'; };
      URL.revokeObjectURL = () => {};
      win.HTMLAnchorElement.prototype.click = () => {};
      try {
        click('export'); click('download-play');
        const exportedWorkspace = decodeWorkspace(await exported.text());
        assert.equal(exportedWorkspace.plays.length, 1);
        assert.equal(exportedWorkspace.plays[0].league, 5);
        assert.deepEqual(exportedWorkspace.plays[0], current());
        click('close-modal');
      } finally { URL.createObjectURL = originalCreate; URL.revokeObjectURL = originalRevoke; win.HTMLAnchorElement.prototype.click = originalClick; }
    });

    await t.test('saved flag templates can create fresh five-player plays', () => {
      click('opponents');
      click('save-formation'); q('#formation-name').value = 'Flag custom integration'; click('confirm-formation');
      const template = saved().formations.find(formation => formation.name === 'Flag custom integration');
      assert.equal(template.league, 5);
      assert.equal(template.players.length, 5);
      click('new');
      assert.ok(q(`#new-formation option[value="custom:${template.id}"]`));
      change('#new-formation', `custom:${template.id}`);
      q('#new-title').value = 'Flag custom recreated'; click('create-play');
      const play = current(); customId = play.id;
      assert.equal(play.league, 5); assert.equal(play.players.length, 5); assert.equal(play.routes.length, 0);
      assert.notEqual(play.players[0].id, template.players[0].id);
      assert.equal(saved().settings.league, 5);
    });

    await t.test('a five-player default does not resize an existing eleven-player play', () => {
      click(`choose:${legacyId}`);
      const before = current(); assert.equal(countSide(before, 'offense'), 11);
      assert.equal(saved().settings.league, 5);
      click('opponents');
      assert.equal(countSide(current(), 'defense'), 11);
      assert.deepEqual(current().players.filter(player => player.side === 'offense'), before.players);
      const defenders = structuredClone(current().players.filter(player => player.side === 'defense'));
      change('#apply-formation', 'builtin:Gun Doubles'); click('confirm-apply-formation');
      assert.equal(countSide(current(), 'offense'), 11);
      assert.deepEqual(current().players.filter(player => player.side === 'defense'), defenders);
      assert.equal(saved().settings.league, 5);
      assert.equal(saved().plays.find(play => play.id === flagId).league, 5);
    });

    await t.test('an eleven-player default does not resize a saved flag play', () => {
      click('new'); change('#new-count', 11); q('#new-title').value = 'New tackle integration'; click('create-play');
      assert.equal(saved().settings.league, 11);
      click(`choose:${customId}`); click('opponents');
      assert.equal(countSide(current(), 'offense'), 5); assert.equal(countSide(current(), 'defense'), 5);
      assert.ok([...q('#apply-formation').options].filter(option => option.value.startsWith('builtin:')).every(option => option.value.startsWith('builtin:Flag 5 ')));
      raw = win.localStorage.getItem(STORAGE_KEY);
      assert.equal(decodeWorkspace(raw).plays.find(play => play.id === customId).league, 5);
    });
  } finally { await host.close(); }

  await t.test('refresh restores the flag format and English exposes the same five-player choices', async () => {
    const fresh = await editor({ raw, locale: 'en' });
    try {
      fresh.click(`choose:${customId}`);
      assert.equal(fresh.current().league, 5);
      assert.equal(countSide(fresh.current(), 'defense'), 5);
      assert.match(fresh.q('[data-play-format]').textContent, /5v5 flag football/);
      fresh.click('opponents'); fresh.click('opponents');
      assert.equal(countSide(fresh.current(), 'defense'), 5, 'reloaded flag metadata controls opponent size');
      fresh.click('new');
      assert.match(fresh.q('#new-count option[value="5"]').textContent, /5v5 flag football/);
      fresh.change('#new-count', 5); fresh.change('#new-book', 'defense');
      assert.deepEqual([...fresh.q('#new-formation').options].map(option => option.value), ['Flag 5 Zone', 'Flag 5 Man']);
      assert.match(fresh.q('#new-format-note').textContent, /center can receive/i);
    } finally { await fresh.close(); }
  });
});
