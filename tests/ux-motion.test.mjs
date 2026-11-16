import test from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { animate, reducedMotion } from '../web/motion.js';

test('functional feedback remains available with flat rendering and no decoration', async () => {
  const win = new Window(), names = ['window','document'];
  const previous = Object.fromEntries(names.map(name => [name,Object.getOwnPropertyDescriptor(globalThis,name)]));
  for (const name of names) Object.defineProperty(globalThis,name,{configurable:true,value:win[name]});
  let reduced = false, played = 0;
  win.matchMedia = () => ({matches:reduced});
  win.document.documentElement.dataset.visualMode = 'traditional';
  win.document.documentElement.dataset.effects = 'off';
  const node = win.document.createElement('div');
  node.animate = (_frames,options) => { played++; return {options}; };
  try {
    assert.equal(reducedMotion(),false);
    assert.equal(animate(node,[{opacity:0},{opacity:1}]).options.duration,180);
    win.document.documentElement.dataset.visualMode = 'digital';
    assert.equal(animate(node,[{opacity:0},{opacity:1}],{duration:220}).options.duration,220);
    assert.equal(played,2);
    reduced = true;
    assert.equal(reducedMotion(),true);
    assert.equal(animate(node,[{opacity:0},{opacity:1}]),null);
    assert.equal(played,2,'reduced motion never starts a functional transition');
    assert.equal(animate(null,[]),null);
    assert.equal(animate({},[]),null);
  } finally {
    await win.happyDOM.abort();
    for (const name of names) { if (previous[name]) Object.defineProperty(globalThis,name,previous[name]); else delete globalThis[name]; }
  }
});

test('turning decoration off preserves in-flight functional work; system reduction finishes it', async () => {
  const win = new Window(), names = ['window','document','localStorage'];
  const previous = Object.fromEntries(names.map(name => [name,Object.getOwnPropertyDescriptor(globalThis,name)]));
  for (const name of names) Object.defineProperty(globalThis,name,{configurable:true,value:name === 'localStorage' ? win.localStorage : win[name]});
  let reduced = false, finished = 0;
  win.matchMedia = () => ({matches:reduced});
  win.document.getAnimations = () => [{finish(){finished++;}}];
  try {
    const effects = await import(`../web/effects.js?ux-motion=${Date.now()}`);
    await effects.setEffectsMode('traditional');
    assert.equal(win.document.documentElement.dataset.effects,'off');
    assert.equal(win.document.documentElement.dataset.motion,'full');
    assert.equal(finished,0,'flat mode does not finish a route or task animation');
    reduced = true;
    await effects.setEffectsMode('traditional');
    assert.equal(win.document.documentElement.dataset.motion,'reduced');
    assert.equal(finished,1);
  } finally {
    await win.happyDOM.abort();
    for (const name of names) { if (previous[name]) Object.defineProperty(globalThis,name,previous[name]); else delete globalThis[name]; }
  }
});
