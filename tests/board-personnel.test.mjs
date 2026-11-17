import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Window } from 'happy-dom';
import { linkRosterPlayer, personnelMatches, personnelAssignments } from '../web/board-personnel.js';
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

test('a complete personnel plan releases an explicitly vacant role before a starter moves to another role', () => {
  const roster = [{ id: 'a', name: 'Alex' }, { id: 'b', name: 'Blake' }];
  const qb = { id: 'qb', label: 'QB', side: 'offense', rosterId: 'a', name: 'Alex' };
  const x = { id: 'x', label: 'X', side: 'offense', rosterId: 'b', name: 'Blake' };
  const play = { book: 'offense', players: [qb, x] };
  const group = { unit: 'offense', slots: [{ label: 'QB', playerIds: [null, 'b'] }, { label: 'X', playerIds: ['a'] }] };
  assert.deepEqual(personnelMatches(play, group, roster), [], 'legacy partial matcher cannot make a cross-role release');
  const assignments = personnelAssignments(play, group, roster);
  assert.equal(assignments.length, 2);
  assert.equal(assignments[0].player, null);
  for (const { marker, player } of assignments) linkRosterPlayer(marker, player);
  assert.equal(qb.rosterId, undefined); assert.equal(qb.name, '');
  assert.equal(x.rosterId, 'a'); assert.equal(x.name, 'Alex');
});

test('unmapped, opposing, malformed and ambiguous empty roles never release a board player', () => {
  const roster = [{ id: 'a', name: 'Alex' }];
  const player = (id, label, side = 'offense') => ({ id, label, side, rosterId: 'a' });
  const plan = (players, slots) => personnelAssignments({ book: 'offense', players }, { unit: 'offense', slots }, roster);
  assert.deepEqual(plan([player('qb', 'QB')], [{ label: 'X', playerIds: [] }]), []);
  assert.deepEqual(plan([player('one', 'QB'), player('two', 'QB')], [{ label: 'QB', playerIds: [] }]), []);
  assert.deepEqual(plan([player('qb', 'QB')], [{ label: 'QB', playerIds: [] }, { label: 'qb', playerIds: [null] }]), []);
  assert.deepEqual(plan([player('qb', 'QB', 'defense')], [{ label: 'QB', playerIds: [] }]), []);
  assert.deepEqual(plan([player('qb', 'QB')], [{ label: 'QB', playerIds: ['deleted-roster-id'] }]), []);
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
  assert.match(q('#personnel-preview').textContent, /10 \/ 11/);
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

  const beforeMirror=geometry(board());
  click('[data-action=mirror]');
  const mirrored=geometry(board());
  assert.notDeepEqual(mirrored,beforeMirror);

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
  win.confirm = () => { throw Error('Roster deletion must use the native dialog confirmation'); };
  click('[data-roster=remove]');
  assert.equal(board().players.find(p => p.label === 'QB').rosterId,quarterback.id,'opening confirmation does not mutate the roster');
  click('[data-roster=confirm-remove]');
  const former = board().players.find(p => p.label === 'QB');
  assert.equal(former.name, 'New QB');
  assert.equal(former.rosterId, undefined);
  const qbDepth = data().depthChart.groups[0].slots.find(slot => slot.label === 'QB');
  const originalQB = seed.depthChart.groups[0].slots.find(slot => slot.label === 'QB');
  assert.deepEqual(qbDepth.playerIds, [null, ...originalQB.playerIds.slice(1)]);

  click('[data-workspace-mode=editor]');
  assert.equal(q('[data-action=undo]').disabled,false,'a roster change preserves diagram history');
  click('[data-action=undo]');
  assert.deepEqual(geometry(board()),beforeMirror,'undo restores the previous diagram');
  assert.equal(board().players.find(p => p.label === 'QB').name,'New QB');
  assert.equal(board().players.find(p => p.label === 'QB').rosterId,undefined,'undo cannot restore a removed roster binding');
  assert.ok(!data().roster.some(player=>player.id===quarterback.id));
  assert.deepEqual(data().depthChart.groups[0].slots.find(slot=>slot.label==='QB').playerIds,qbDepth.playerIds);
  click('[data-action=redo]');
  assert.deepEqual(geometry(board()),mirrored,'redo still reapplies the diagram operation');
  assert.equal(board().players.find(p=>p.label==='QB').rosterId,undefined);
  assert.ok(!data().roster.some(player=>player.id===quarterback.id));
});
