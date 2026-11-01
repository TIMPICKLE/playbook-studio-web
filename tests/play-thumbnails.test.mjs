import test from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { clone, starterWorkspace } from '../web/model.js';
import { createPlayThumbnails } from '../web/play-thumbnails.js';

test('large play lists render nearby diagrams, release distant ones, and discard stale observations', async () => {
  const win = new Window(), doc = win.document, observers = [];
  win.IntersectionObserver = class {
    constructor(callback, options) { this.callback = callback; this.options = options; this.nodes = []; observers.push(this); }
    observe(node) { this.nodes.push(node); }
    disconnect() { this.disconnected = true; }
    change(node, isIntersecting) { this.callback([{ target: node, isIntersecting }]); }
  };
  const seed = starterWorkspace().plays[0];
  const plays = Array.from({ length: 200 }, (_, i) => ({ ...clone(seed), id: `play-${i}` }));
  doc.body.innerHTML = `<aside class="sidebar"><div class="play-list">${plays.map((_, i) => `<button><span class="play-thumb" data-thumbnail-index="${i}"></span></button>`).join('')}</div></aside>`;
  const list = doc.querySelector('.play-list'), thumbs = createPlayThumbnails(win);
  try {
    thumbs.mount(list, plays);
    const observer = observers[0];
    assert.equal(observer.nodes.length, 200);
    assert.equal(observer.options.root, doc.querySelector('.sidebar'));
    assert.equal(list.querySelectorAll('svg').length, 0);
    observer.change(observer.nodes[0], true); observer.change(observer.nodes[1], true);
    assert.equal(list.querySelectorAll('svg').length, 2);
    const oldLabel = plays[0].players[0].label;
    plays[0].players[0].label = 'QB2'; thumbs.refresh(plays[0]);
    assert.match(observer.nodes[0].textContent, /QB2/);
    assert.notEqual(plays[0].players[0].label, oldLabel);
    observer.change(observer.nodes[0], false);
    assert.equal(observer.nodes[0].childElementCount, 0);
    observer.change(observer.nodes[0], true);
    assert.match(observer.nodes[0].textContent, /QB2/);

    list.innerHTML = '<button><span data-thumbnail-index="0"></span></button>';
    thumbs.mount(list, [plays[1]]);
    assert.equal(observer.disconnected, true);
    observer.change(observer.nodes[0], true);
    assert.equal(list.querySelectorAll('svg').length, 0, 'a callback from an old list cannot populate the new list');
    observers[1].change(observers[1].nodes[0], true);
    assert.equal(list.querySelectorAll('svg').length, 1);
  } finally { thumbs.destroy(); await win.happyDOM.abort(); }
});

test('browsers without IntersectionObserver still render every diagram', async () => {
  const win = new Window(), doc = win.document;
  win.IntersectionObserver = undefined;
  doc.body.innerHTML = '<div class="play-list"><span data-thumbnail-index="0"></span><span data-thumbnail-index="1"></span></div>';
  const thumbs = createPlayThumbnails(win);
  try { thumbs.mount(doc.querySelector('.play-list'), starterWorkspace().plays.slice(0, 2)); assert.equal(doc.querySelectorAll('.play-list svg').length, 2); }
  finally { thumbs.destroy(); await win.happyDOM.abort(); }
});
