import test from 'node:test';
import assert from 'node:assert/strict';
import { addRoute, animatedPlayer, clone, dynamicBlockRoute, formationPlayers, starterWorkspace, validatePlay } from '../web/model.js';
import { fieldSVG, routePath } from '../web/field.js';

test('block tracks moving targets and preserves old routes and removed targets', () => {
  const play = clone(starterWorkspace().plays[0]);
  play.players.push(...formationPlayers('4–3', 11, 'defense'));
  const c = play.players.find(p => p.label === 'C');
  const dt = play.players.find(p => p.label === 'DT');
  addRoute(play, 'DT', [[dt.x + 10, dt.y]], 'route', { duration: 4 });
  const block = { id: 'dynamic-block', playerId: c.id, kind: 'block', color: c.color,
    points: [{ x: c.x, y: c.y }, { x: dt.x, y: dt.y + 3 }], delay: 0, duration: 4,
    smooth: false, endCap: 'bar', optional: false, blockTargets: [dt.id] };
  play.routes = play.routes.filter(r => r.playerId !== c.id);
  play.routes.push(block);
  const validated = validatePlay(play);
  const persisted = JSON.parse(JSON.stringify(validated));
  assert.deepEqual(persisted.routes.at(-1).blockTargets, [dt.id]);
  const start = dynamicBlockRoute(validated, block, 0);
  const finish = dynamicBlockRoute(validated, block, 4);
  assert.notDeepEqual(start.points.at(-1), finish.points.at(-1));
  assert.deepEqual(animatedPlayer(validated, c, 4), finish.points.at(-1));
  assert.ok(fieldSVG(validated, {}, { time: 4 }).includes(routePath(finish)));
  const old = { ...block }; delete old.blockTargets;
  assert.equal(dynamicBlockRoute(validated, old, 4), old);
  const removed = { ...validated, players: validated.players.filter(p => p.id !== dt.id), routes: validated.routes.filter(r => r.playerId !== dt.id) };
  assert.deepEqual(dynamicBlockRoute(removed, block, 4).points.at(-1), block.points.at(-1));
  assert.doesNotThrow(() => validatePlay(removed));
});

test('motion endpoint may anchor the subsequent route', () => {
  const play = clone(starterWorkspace().plays[0]);
  const p = play.players.find(player => player.label === 'Z');
  play.routes = play.routes.filter(r => r.playerId !== p.id);
  const common = { playerId: p.id, color: p.color, smooth: false, endCap: 'arrow', optional: false };
  play.routes.push({ ...common, id: 'motion-z', kind: 'motion', points: [{x:p.x,y:p.y}, {x:45,y:p.y}], delay: 0, duration: 1 });
  play.routes.push({ ...common, id: 'route-z', kind: 'route', points: [{x:45,y:p.y}, {x:45,y:30}], delay: 1, duration: 3 });
  const validated = validatePlay(play);
  assert.deepEqual(animatedPlayer(validated, p, 1), { x: 45, y: p.y });
  assert.deepEqual(animatedPlayer(validated, p, 4), { x: 45, y: 30 });
});
