import { fieldSVG } from './field.js';

// Keep the complete list available to search and keyboard navigation, but only
// build the expensive SVGs near the scroll viewport.
export function createPlayThumbnails(win = window) {
  let observer = null, generation = 0, entries = new Map();

  function mount(list, plays) {
    generation++;
    observer?.disconnect();
    observer = null;
    entries = new Map();
    if (!list) return;

    const nodes = [...list.querySelectorAll('[data-thumbnail-index]')];
    for (const node of nodes) {
      const index = Number(node.dataset.thumbnailIndex), play = plays[index];
      if (play) entries.set(play.id, { node, play, index });
    }
    const render = ({ node, play, index }) => {
      node.innerHTML = fieldSVG(play, { showGrid: false }, { thumbnail: true, prefix: `thumb-${index}` });
    };
    if (typeof win.IntersectionObserver !== 'function') {
      entries.forEach(render);
      return;
    }
    const ticket = generation;
    observer = new win.IntersectionObserver(changes => {
      if (ticket !== generation) return;
      for (const change of changes) {
        const index = Number(change.target.dataset.thumbnailIndex), play = plays[index];
        const entry = play && entries.get(play.id);
        if (!entry || entry.node !== change.target) continue;
        if (change.isIntersecting) {
          if (!entry.node.firstElementChild) render(entry);
        } else if (entry.node.firstElementChild) {
          entry.node.replaceChildren();
        }
      }
    }, { root: list.closest('.sidebar'), rootMargin: '300px 0px' });
    entries.forEach(({ node }) => observer.observe(node));
  }

  function refresh(play) {
    const entry = entries.get(play.id);
    if (!entry) return;
    entry.play = play;
    if (entry.node.firstElementChild) entry.node.innerHTML = fieldSVG(play, { showGrid: false }, { thumbnail: true, prefix: `thumb-${entry.index}` });
  }

  return { mount, refresh, destroy() { generation++; observer?.disconnect(); observer = null; entries.clear(); } };
}
