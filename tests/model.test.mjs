import test from 'node:test';
import assert from 'node:assert/strict';
import { starterWorkspace, makePlay, formationPlayers, mirrorPlay, movePlayer, addRoute, pointAlong, sampledRoute, animatedPlayer, animatedBall, encodeWorkspace, decodeWorkspace, History, clone, escapeHTML } from '../web/model.js';
import { fieldSVG, routePath } from '../web/field.js';

test('all starter plays roundtrip through the actual backup validation', () => {
  const w = starterWorkspace(); assert.deepEqual(decodeWorkspace(encodeWorkspace(w)), w);
  assert.equal(w.plays.length, 8); assert.equal(new Set(w.plays.map(p => p.book)).size, 3);
});
test('mirror transforms all geometry and two mirrors restore the play', () => {
  const p = starterWorkspace().plays[0]; p.zones.push({ id: 'zone', x: 27, y: 38, rx: 10, ry: 8, color: '#88bfff', label: 'HOOK' }); p.annotations.push({ id: 'text', x: 22, y: 34, text: 'Read 1' });
  const m = mirrorPlay(p); assert.equal(m.players[0].x, 100 - p.players[0].x); assert.equal(m.routes[0].points[1].x, 100 - p.routes[0].points[1].x); assert.equal(m.zones[0].x, 73); assert.equal(m.annotations[0].x, 78); assert.deepEqual(mirrorPlay(m), p); assert.equal(p.zones[0].x, 27);
});
test('moving a player translates every attached node and preserves other players', () => {
  const p = makePlay(); addRoute(p, 'Y', [[64, 56], [25, 55]]); const owner = p.players.find(p => p.label === 'Y'), before = clone(p), id = owner.id;
  movePlayer(p, id, owner.x + 3, owner.y - 8);
  const r = p.routes[0]; r.points.forEach((v, i) => { assert.equal(v.x, before.routes[0].points[i].x + 3); assert.equal(v.y, before.routes[0].points[i].y - 8); });
  assert.deepEqual(p.players.find(p => p.label === 'QB'), before.players.find(p => p.label === 'QB'));
  assert.deepEqual(r.points[0], { x: owner.x, y: owner.y });
});
test('boundary dragging stops the whole route without clipping or changing its shape', () => {
  const p = makePlay(); addRoute(p, 'X', [[13, 25], [85, 25]]); const owner = p.players.find(p => p.label === 'X'); movePlayer(p, owner.id, 90, 95);
  assert.equal(p.routes[0].points.at(-1).x, 100); assert.equal(p.routes[0].points.at(-1).x - p.routes[0].points[0].x, 72); assert.equal(owner.y, 95);
  assert.ok(p.routes[0].points.every(v => v.x >= 0 && v.x <= 100 && v.y >= 0 && v.y <= 100));
});
test('all supported league sizes produce the requested number of usable positions', () => {
  for (const side of ['offense', 'defense']) for (const count of [6, 7, 8, 9, 11, 12]) {
    const players = formationPlayers(side === 'offense' ? 'Gun Trips' : '4–3', count, side);
    assert.equal(players.length, count); assert.equal(new Set(players.map(p => p.id)).size, count);
    if (side === 'offense') assert.ok(players.some(p => p.label === 'QB'));
  }
});
test('route playback honors delay and duration, excluding optional branches', () => {
  const p = makePlay(); addRoute(p, 'X', [[13, 25]], 'route', { delay: 1, duration: 2 }); addRoute(p, 'X', [[40, 10]], 'route', { optional: true });
  const owner = p.players.find(p => p.label === 'X'); assert.deepEqual(animatedPlayer(p, owner, 0), { x: 13, y: 67 }); assert.deepEqual(animatedPlayer(p, owner, 2), { x: 13, y: 46 }); assert.deepEqual(animatedPlayer(p, owner, 10), { x: 13, y: 25 });
});
test('smooth route drawing and animation share cubic geometry, retaining endpoints', () => {
  const p = makePlay(); addRoute(p, 'RB', [[65, 61], [90, 50]], 'route', { smooth: true }); const r = p.routes[0], samples = sampledRoute(r);
  assert.ok(routePath(r).includes(' C')); assert.equal(samples.length, 33); assert.deepEqual(samples[0], r.points[0]); assert.deepEqual(samples.at(-1), r.points.at(-1));
  assert.deepEqual(pointAlong(samples, 0), r.points[0]); assert.deepEqual(pointAlong(samples, 1), r.points.at(-1));
});
test('ball follows holder, interpolates to the catch and then follows receiver', () => {
  const p = starterWorkspace().plays[0], qb = p.players.find(v => v.id === p.ball.holderId), receiver = p.players.find(v => v.id === p.ball.receiverId);
  assert.deepEqual(animatedBall(p, 0), animatedPlayer(p, qb, 0));
  assert.deepEqual(animatedBall(p, p.ball.passAt), animatedPlayer(p, qb, p.ball.passAt));
  assert.deepEqual(animatedBall(p, p.ball.arriveAt), animatedPlayer(p, receiver, p.ball.arriveAt));
  assert.deepEqual(animatedBall(p, 5), animatedPlayer(p, receiver, 5));
});
test('empty and zero-length routes have stable interpolation', () => {
  assert.deepEqual(pointAlong([], .5), { x: 50, y: 50 }); assert.deepEqual(pointAlong([{ x: 2, y: 3 }, { x: 2, y: 3 }], .4), { x: 2, y: 3 });
});
test('history restores edits, supports redo and clears stale redo after a new edit', () => {
  const h = new History(2), a = { title: 'A' }, b = { title: 'B' }, c = { title: 'C' };
  h.record(a); assert.deepEqual(h.undo(b), a); assert.deepEqual(h.redo(a), b); h.record(b); assert.deepEqual(h.undo(c), b); h.record(a); assert.equal(h.redo(a), null);
  h.record(b); h.record(c); assert.equal(h.past.length, 2);
});
test('import rejects foreign formats, invalid geometry and broken player references', () => {
  const w = starterWorkspace(); const bad = clone(w); bad.plays[0].routes[0].points[0].x = -1;
  assert.throws(() => decodeWorkspace(encodeWorkspace(bad)), /超出范围/);
  const ref = clone(w); ref.plays[0].routes[0].playerId = 'missing'; assert.throws(() => decodeWorkspace(encodeWorkspace(ref)), /不存在/);
  const start = clone(w); start.plays[0].routes[0].points[0].x += 5; assert.throws(() => decodeWorkspace(encodeWorkspace(start)), /起点/);
  assert.throws(() => decodeWorkspace('{"format":"other","version":1}'), /不是支持/);
});
test('import rejects duplicate IDs, invalid colors and reverse pass timing', () => {
  const w = starterWorkspace(), a = clone(w); a.plays[0].players[1].id = a.plays[0].players[0].id; assert.throws(() => decodeWorkspace(encodeWorkspace(a)), /重复/);
  const b = clone(w); b.plays[0].routes[0].color = 'red;url(javascript:alert(1))'; assert.throws(() => decodeWorkspace(encodeWorkspace(b)), /颜色/);
  const c = clone(w); c.plays[0].ball.arriveAt = 1; c.plays[0].ball.passAt = 3; assert.throws(() => decodeWorkspace(encodeWorkspace(c)), /晚于/);
});
test('user strings are escaped in rendered SVG and cannot create active elements', () => {
  const p = makePlay(); p.players[0].label = '<script>'; p.annotations.push({ id: 'note', x: 20, y: 20, text: '<script>alert(1)</script><image href="x"/>' });
  const svg = fieldSVG(p); assert.ok(!svg.includes('<script>')); assert.ok(!svg.includes('<image href')); assert.ok(svg.includes('&lt;script&gt;')); assert.equal(escapeHTML('"<&'), '&quot;&lt;&amp;');
});
test('several diagrams use scoped marker references for export and printing', () => {
  const p = starterWorkspace().plays[0], a = fieldSVG(p, {}, { prefix: 'first', print: true }), b = fieldSVG(p, {}, { prefix: 'second', print: true });
  assert.ok(a.includes('url(#first-r0-arrow)')); assert.ok(b.includes('url(#second-r0-arrow)')); assert.ok(!a.includes('data-point='));
});
