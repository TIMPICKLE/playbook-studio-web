import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Window } from 'happy-dom';
import { linkRosterPlayer, personnelMatches } from '../web/board-personnel.js';
import { decodeWorkspace, encodeWorkspace, starterWorkspace, STORAGE_KEY } from '../web/model.js';

test('personnel application skips ambiguous/opposing roles, backups and occupied unmatched players; swaps are safe', () => {
  const roster = ['a', 'b', 'c', 'd'].map(id => ({ id, name: 'Same name' }));
  const player = (label, id, rosterId, side = 'offense') => ({ label, id, rosterId, side });
  const play = { book: 'offense', players: [
    player('X', 'x', 'a'), player('Y', 'y', 'b'), player('TE', 'te1'), player('TE', 'te2'),
    player('QB', 'qb'), player('Z', 'z', 'c'), player('X', 'opp', null, 'defense'),
  ] };
  const slot = (label, ...playerIds) => ({ label, playerIds });
  const group = { unit: 'offense', slots: [slot('x', 'b'), slot('Y', 'a'), slot('TE', 'd'), slot('QB', 'c')] };
  const matches = personnelMatches(play, group, roster);
  assert.deepEqual(matches.map(({marker}) => marker.id), ['x','y']);
  for (const { marker, player: entry } of matches) linkRosterPlayer(marker, entry);
  assert.deepEqual(play.players.slice(0, 2).map(marker => marker.rosterId), ['b','a']);
  assert.deepEqual(personnelMatches(play, { unit: 'offense', slots: [slot('QB', null, 'd')] }, roster), []);
  assert.deepEqual(personnelMatches(play, { ...group, unit: 'defense' }, roster), []);
  assert.deepEqual(personnelMatches({ ...play, reference: {} }, group, roster), []);
  const returnGroup = { unit: 'special', slots: [slot('X', 'b')] };
  const special = { ...play, book: 'special', players: [player('X', 'returner', null, 'defense')] };
  assert.equal(personnelMatches(special, returnGroup, roster)[0].marker.id, 'returner');
  special.players.push(player('X', 'kicker-unit'));
  assert.equal(personnelMatches(special, returnGroup, roster)[0].marker.id, 'kicker-unit');
});

test('applying a group is one undoable edit; roster links follow renames and preserve the last name on removal', async t => {
  const win = new Window({ url: 'http://localhost:3000/#editor', width: 1440, height: 1000 });
  win.document.body.innerHTML = readFileSync(new URL('../web/index.html', import.meta.url), 'utf8').split('<body>')[1].split('</body>')[0];
  const globals = ['window', 'document', 'navigator', 'localStorage', 'location', 'history', 'Image', 'Blob', 'requestAnimationFrame', 'cancelAnimationFrame'];
  const old = Object.fromEntries(globals.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const key of globals) Object.defineProperty(globalThis, key, { configurable: true, value: typeof win[key] === 'function' && key.endsWith('AnimationFrame') ? win[key].bind(win) : win[key] });
  t.after(async () => {
    await win.happyDOM.abort();
    for (const key of globals) {
      if (old[key]) Object.defineProperty(globalThis, key, old[key]);
      else delete globalThis[key];
    }
  });
  const seed = starterWorkspace({ demoDepth: true });
  const quarterback = seed.roster[0];
  seed.roster[1].name = quarterback.name;
  win.localStorage.setItem(STORAGE_KEY, encodeWorkspace(seed));
  const q = selector => win.document.querySelector(selector);
  const click = selector => { assert.ok(q(selector), selector); q(selector).click(); };
  const change = (selector, value) => { q(selector).value = value; q(selector).dispatchEvent(new win.Event('change', { bubbles: true })); };
  const data = () => decodeWorkspace(win.localStorage.getItem(STORAGE_KEY));
  const board = () => data().plays[0];
  await import('../web/app.js?board-personnel');
  change('#personnel-group', 'spread');
  assert.match(q('#personnel-preview').textContent, /3 \/ 3/);
  click('[data-action=apply-personnel]');
  const assigned = board();
  assert.equal(assigned.players.find(p => p.label === 'QB').rosterId, quarterback.id);
  const geometry = play => {
    const copy = structuredClone(play);
    for (const marker of copy.players) { delete marker.name; delete marker.rosterId; }
    return copy;
  };
  assert.deepEqual(geometry(assigned), geometry(seed.plays[0]));
  click('[data-action=undo]');
  assert.deepEqual(board(), seed.plays[0]);
  click('[data-action=redo]');

  click('[data-cloud-action=home]');
  click('[data-cloud-action=enter-roster]');
  click('[data-roster-tab=directory]');
  const edit = `[data-roster=edit][data-id="${quarterback.id}"]`;
  click(edit);
  q('.roster-dialog input[name=name]').value = 'New QB';
  click('.roster-dialog button[type=submit]');
  assert.equal(board().players.find(p => p.label === 'QB').name, 'New QB');
  assert.equal(board().players.find(p => p.label === 'X').name, quarterback.name);
  click(edit);
  win.confirm = () => true;
  click('[data-roster=remove]');
  const former = board().players.find(p => p.label === 'QB');
  assert.equal(former.name, 'New QB');
  assert.equal(former.rosterId, undefined);
  const qbDepth = data().depthChart.groups[0].slots.find(slot => slot.label === 'QB');
  const originalQB = seed.depthChart.groups[0].slots.find(slot => slot.label === 'QB');
  assert.deepEqual(qbDepth.playerIds, [null, ...originalQB.playerIds.slice(1)]);
});
