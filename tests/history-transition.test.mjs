import test from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { createDigitalBoard } from '../web/digital-board.js';
import { fieldSVG, routePath } from '../web/field.js';
import { starterWorkspace, movePlayer } from '../web/model.js';
import { captureHistoryFrame, presentHistoryFrame } from '../web/history-transition.js';

function fixture(t, play = starterWorkspace().plays[0]) {
  const win = new Window(), doc = win.document, callbacks = new Map();
  let id = 0;
  win.requestAnimationFrame = callback => { callbacks.set(++id, callback); return id; };
  win.cancelAnimationFrame = id => callbacks.delete(id);
  const pref = {matches:false, addEventListener(){}, removeEventListener(){}};
  win.matchMedia = () => pref;
  const step = time => {
    const pending = [...callbacks.values()]; callbacks.clear();
    for (const fn of pending) fn(time);
  };
  const paint = next => {
    const template = doc.createElement('template');
    template.innerHTML = fieldSVG(next);
    const svg = template.content.firstElementChild;
    const field = doc.createElement('div'), stage = doc.createElement('div');
    field.id = 'field'; stage.className = 'pitch-stage';
    stage.append(svg); field.append(stage); doc.body.replaceChildren(field);
    return svg;
  };
  let svg = paint(play), active;
  const replace = (next, options) => {
    const before = captureHistoryFrame(svg, play, active);
    active?.cancel();
    svg = paint(next);
    active = presentHistoryFrame(svg, next, before, options);
    play = next;
    return active;
  };
  t.after(() => { active?.cancel(); win.happyDOM.abort(); });
  return {win, replace, step, callbacks, pref, get svg(){return svg;}, get play(){return play;}};
}

test('Go/Post history morph changes only the visible route while the final hit area is already live', t => {
  const f = fixture(t), go = f.play, post = structuredClone(go);
  const route = post.routes[0], original = routePath(go.routes[0]);
  route.points = [route.points[0],{x:route.points[0].x,y:40},{x:42,y:17}];
  const final = routePath(route), active = f.replace(post);
  const path = active.layer.querySelector('[data-history-route] .route-stroke');
  const hit = f.svg.querySelector('.route-hit');
  assert.equal(active.shown.size,1);
  assert.equal(active.layer.getAttribute('aria-hidden'),'true');
  assert.equal(active.layer.querySelector('[tabindex],.route-hit,[data-route]'),null);
  assert.equal(path.getAttribute('d'),original);
  assert.equal(hit.getAttribute('d'),final);
  f.step(0); f.step(110);
  const middle = path.getAttribute('d');
  assert.notEqual(middle,original);assert.notEqual(middle,final);
  const reverse = f.replace(go);
  assert.equal(active.layer.isConnected,false);
  assert.equal(reverse.layer.querySelector('.route-stroke').getAttribute('d'),middle);
  assert.equal(f.svg.querySelector('.route-hit').getAttribute('d'),original);
  assert.equal(f.callbacks.size,1);
  reverse.cancel();
  assert.equal(f.svg.querySelector('[data-route]').style.opacity,'');
  assert.equal(f.callbacks.size,0);
});

test('a moved ball holder, attached route and ball travel together while other players stay untouched', t => {
  const play = starterWorkspace().plays[0];
  const actorId = play.routes[0].playerId;
  play.ball.holderId = actorId;
  const f = fixture(t, play), next = structuredClone(play);
  const player = next.players.find(p=>p.id===actorId);
  movePlayer(next,player.id,player.x+3,player.y+2);
  const active = f.replace(next), ghost = active.layer.querySelector('[data-history-player]');
  assert.deepEqual(active.mask.playerIds,[actorId]);
  assert.ok(active.mask.routeIds.includes(play.routes[0].id));
  assert.equal(active.mask.ball,true);
  assert.equal(active.layer.querySelectorAll('[data-history-player]').length,1);
  const real = f.svg.querySelector('[data-player="' + actorId + '"]');
  assert.notEqual(ghost.getAttribute('transform'),real.getAttribute('transform'));
  for (const node of f.svg.querySelectorAll('[data-player]')) if (node !== real) assert.equal(node.style.opacity,'');
  f.step(0); f.step(280);
  assert.equal(ghost.getAttribute('transform'),real.getAttribute('transform'));
  assert.equal(active.layer.querySelector('[data-history-ball]').getAttribute('transform'),f.svg.querySelector('#pitch-ball').getAttribute('transform'));
  active.unmask(); assert.equal(real.style.opacity,'');
});

test('remove, restore and remove again retain intermediate opacity and partial route length', t => {
  const f = fixture(t), original = f.play, missing = structuredClone(original);
  const id = missing.routes.shift().id;
  const removed = f.replace(missing), old = removed.layer.querySelector('[data-history-route]');
  assert.equal(f.svg.querySelector('[data-route="' + id + '"]'),null);
  const marker = old.querySelector('path').getAttribute('marker-end').slice(5,-1);
  assert.ok(removed.layer.querySelector('#' + marker));
  f.step(0); f.step(120);
  const alpha = old.getAttribute('opacity'), reverse = f.replace(original);
  assert.equal(reverse.layer.querySelector('[data-history-route]').getAttribute('opacity'),alpha);
  // Starting from a settled deletion exercises the normal draw-in path.
  const empty = fixture(t,missing), enter = empty.replace(original);
  empty.step(0);empty.step(110);
  const line = enter.layer.querySelector('.route-stroke'), offset = line.getAttribute('stroke-dashoffset');
  assert.ok(Number(offset)>0 && Number(offset)<1);
  const exit = empty.replace(missing);
  assert.equal(exit.layer.querySelector('.route-stroke').getAttribute('stroke-dashoffset'),offset);
  const reenter = empty.replace(original);
  assert.ok(Math.abs(Number(reenter.layer.querySelector('.route-stroke').getAttribute('stroke-dashoffset'))-Number(offset))<1e-12);
});

test('reduced motion, metadata-only history and a different play leave no presentation objects or frames', t => {
  const f = fixture(t);
  const name = structuredClone(f.play); name.title += ' updated';
  assert.equal(f.replace(name),null);
  f.pref.matches=true;
  const post=structuredClone(name); post.routes[0].points[1].x+=3;
  assert.equal(f.replace(post),null);
  assert.equal(f.svg.querySelector('[data-route]').style.opacity,'');
  f.pref.matches=false;
  const different=structuredClone(post);different.id='different';different.routes=[];
  assert.equal(f.replace(different),null);
  assert.equal(f.callbacks.size,0);
});

test('digital path movement waits for the masked field texture and then completes once', t => {
  const f=fixture(t), next=structuredClone(f.play);
  const original=routePath(f.play.routes[0]);
  next.routes[0].points[1].x+=5;
  let ready=false;
  const active=f.replace(next,{ready:()=>ready}), path=active.layer.querySelector('.route-stroke');
  f.step(0);f.step(70);
  assert.equal(path.getAttribute('d'),original);
  ready=true;f.step(80);f.step(190);
  assert.notEqual(path.getAttribute('d'),original);
  f.step(360);
  assert.equal(path.getAttribute('d'),routePath(next.routes[0]));
  assert.equal(f.callbacks.size,0);
});


test('digital fallback masks only the moved piece and its changed route, then restores the retained shapes', async t => {
  const f=fixture(t), next=structuredClone(f.play);
  const route=next.routes[0], actor=next.players.find(player=>player.id===route.playerId);
  movePlayer(next,actor.id,actor.x+5,actor.y-3);
  const active=f.replace(next), doc=f.svg.ownerDocument;
  doc.documentElement.dataset.visualMode='digital';
  doc.documentElement.dataset.effects='off';
  f.win.CanvasRenderingContext2D=class {};
  f.win.console.warn=()=>{};
  const state={play:next,settings:{},time:0,presentationMask:active.mask};
  const renderer=createDigitalBoard({doc,getState:()=>state,makeEngine:async()=>{throw Error('No WebGL context');}});
  try {
    await renderer.sync();
    const piece=doc.querySelector('[data-vector-player="' + actor.id + '"]');
    const decoration=doc.querySelector('[data-feedback-route="' + route.id + '"]');
    assert.equal(renderer.backgroundReady,true);
    assert.equal(piece.style.display,'none');
    assert.equal(decoration.style.display,'none');
    assert.equal(f.svg.querySelector('[data-player="' + actor.id + '"]').style.opacity,'0');
    assert.ok([...doc.querySelectorAll('[data-vector-player]')].filter(node=>node!==piece).every(node=>node.style.display===''));
    assert.ok(active.layer.querySelector('[data-history-player="' + actor.id + '"]'));
    active.cancel();state.presentationMask=null;
    await renderer.sync({contentChanged:true});
    assert.equal(doc.querySelector('[data-vector-player="' + actor.id + '"]'),piece);
    assert.equal(piece.style.display,'');
    assert.equal(doc.querySelector('[data-feedback-route="' + route.id + '"]').style.display,'');
    assert.equal(f.svg.querySelector('[data-player="' + actor.id + '"]').style.opacity,'');
    assert.equal(doc.querySelector('.history-transition'),null);
  } finally { renderer.destroy(); }
});
