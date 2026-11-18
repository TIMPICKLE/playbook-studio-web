import test from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { makePlay, preparePlayerTranslation } from '../web/model.js';
import { prepareWaypointMove } from '../web/editor-play-commands.js';
import { bindGestureGeometry, fieldSVG } from '../web/field.js';

function diagram(t) {
  const win = new Window();
  t.after(() => win.happyDOM.abort());
  const play = makePlay({ formation: 'Gun Trips' });
  const [holder, receiver, blocker, idle] = play.players;
  play.ball.holderId = holder.id;
  play.ball.receiverId = receiver.id;
  play.ball.passAt = 0;
  const point = p => ({ x: p.x, y: p.y });
  const line = (id, owner, kind, end, extra = {}) => ({
    id, playerId: owner.id, kind, color: owner.color, smooth: false, optional: false,
    delay: 0, duration: 2, endCap: 'arrow', points: [point(owner), ...end], ...extra
  });
  play.routes = [
    line('pass', holder, 'pass', [point(receiver)]),
    line('cut', receiver, 'route', [{ x: 38, y: 28 }, { x: 42, y: 18 }], { smooth: true }),
    line('contact', blocker, 'block', [point(receiver), point(idle)], { blockTargets: [receiver.id, idle.id], stagedBlock: true, endCap: 'bar' }),
    line('idle', idle, 'route', [{ x: idle.x, y: 25 }])
  ];
  play.zones = [{ id: 'zone', x: 30, y: 40, rx: 5, ry: 7, label: 'Zone', color: '#aaaaff' }];
  play.annotations = [{ id: 'note', x: 40, y: 48, text: 'Outside' }];
  const render = () => {
    const template = win.document.createElement('template');
    template.innerHTML = fieldSVG(play, {}, { selected: { type: 'route', id: 'contact' } });
    return template.content.firstElementChild;
  };
  const svg = render(), writes = [];
  for (const node of svg.querySelectorAll('*')) {
    const set = node.setAttribute.bind(node);
    node.setAttribute = (name, value) => { writes.push(node); set(name, value); };
  }
  return { play, holder, receiver, svg, writes, render };
}

test('dragging a receiver or group updates just its markers, attached paths, linked blocking geometry and moving ball', t => {
  for (const group of [false, true]) {
    const { play, holder, receiver, svg, writes, render } = diagram(t);
    const ids = group ? [holder.id, receiver.id] : [receiver.id];
    const paint = bindGestureGeometry(svg, play, group ? { type: 'players', ids } : { type: 'player', id: receiver.id });
    const move = preparePlayerTranslation(play, ids);
    move(3, -2);
    assert.equal(paint(), true, 'route geometry invalidates the digital turf texture');
    assert.equal(svg.outerHTML, render().outerHTML, 'both hit paths, staged handles and the ball match the full renderer');
    for (const node of writes) {
      const route = node.closest('[data-route]')?.dataset.route;
      const expected = ids.includes(node.dataset.player) || node.dataset.routeId === 'contact' ||
        ['cut', 'contact', ...(group ? ['pass'] : [])].includes(route) || (group && node.id === 'pitch-ball');
      assert.ok(expected, `unexpected write to ${node.outerHTML}`);
    }
    assert.ok(writes.some(node => node.dataset.routeId === 'contact'), 'dependent hit and visible handles track moved targets');
    assert.equal(writes.some(node => node.id === 'pitch-ball'), group);
    writes.length = 0;
    assert.equal(paint(), false);
    assert.equal(writes.length, 0, 'the same pointer position performs no SVG writes');
    move(-1, 2);
    paint();
    assert.equal(svg.outerHTML, render().outerHTML, 'direction reversal uses the original coordinates');
  }
});

test('editing a staged waypoint detaches its targets and updates its route and affected handles', t => {
  const { play, svg, writes, render } = diagram(t);
  const waypoint = prepareWaypointMove(play, 'contact', 1);
  const paint = bindGestureGeometry(svg, play, { type: 'point', routeId: 'contact', waypoint });
  waypoint.move({ x: 47, y: 41 });
  paint();
  assert.equal(svg.outerHTML, render().outerHTML);
  assert.ok(writes.length > 0);
  assert.ok(writes.every(node => node.dataset.routeId === 'contact' || node.closest('[data-route]')?.dataset.route === 'contact'));
});

test('a moving zone or note only writes its own changed coordinates', t => {
  for (const [type, id] of [['zone', 'zone'], ['annotation', 'note']]) {
    const { svg, play, writes, render } = diagram(t);
    const paint = bindGestureGeometry(svg, play, { type, id });
    const target = type === 'zone' ? play.zones[0] : play.annotations[0];
    target.x += 3;
    target.y -= 2;
    assert.equal(paint(), true);
    assert.equal(svg.outerHTML, render().outerHTML);
    assert.equal(writes.length, type === 'zone' ? 4 : 2);
    assert.ok(writes.every(node => node.closest(`[data-${type}]`)?.dataset[type] === id));
  }
});

test('isolated player and ball meshes can move without baking another field texture', t => {
  for (const immediatePass of [false, true]) {
    const { play, holder, receiver, render } = diagram(t);
    play.routes = [];
    play.ball.passAt = immediatePass ? 0 : 1;
    const svg = render();
    for (const player of [receiver, holder]) {
      const paint = bindGestureGeometry(svg, play, { type: 'player', id: player.id });
      preparePlayerTranslation(play, [player.id])(2, -1);
      assert.equal(paint(), immediatePass && player === holder, 'only an immediate throw moves a visible trail at design time');
      assert.equal(svg.outerHTML, render().outerHTML);
    }
  }
});
