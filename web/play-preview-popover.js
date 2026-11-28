import { fieldSVG } from './field.js';
import { escapeHTML as e } from './model.js';
import { reducedMotion } from './motion.js';

const MAX_CACHE = 24;

function playSignature(play) {
  return JSON.stringify(play.reference
    ? [play.id, play.title, play.reference.image]
    : [play.id, play.players, play.routes, play.zones, play.annotations, play.ball]);
}

// Desktop-only progressive enhancement: shows a crisp tactical diagram beside
// the sidebar when hovering an inactive play card, without switching the play.
export function createPlayPreviewPopover({ getPlay, formatMeta, delay = 220, win = window } = {}) {
  const doc = win?.document;
  const cache = new Map();
  let popover = null;
  let activeList = null;
  let pendingTimer = 0;
  let shownId = '';
  let cleanups = [];

  const isDesktopPointer = () => {
    if (!win) return false;
    const width = win.innerWidth || 0;
    const fine = !!win.matchMedia?.('(hover: hover) and (pointer: fine)').matches;
    return fine && width > 1180;
  };

  function ensurePopover() {
    if (popover?.isConnected || !doc?.body) return popover;
    popover = doc.createElement('div');
    popover.className = 'play-preview-popover';
    popover.setAttribute('aria-hidden', 'true');
    popover.hidden = true;
    doc.body.append(popover);
    return popover;
  }

  function renderSVG(play) {
    const key = playSignature(play);
    if (cache.has(key)) {
      const hit = cache.get(key);
      cache.delete(key);
      cache.set(key, hit);
      return hit;
    }
    const markup = fieldSVG(play, { fieldTheme: 'dark', showGrid: true }, { thumbnail: true, prefix: 'play-hover' });
    cache.set(key, markup);
    if (cache.size > MAX_CACHE) {
      const oldest = cache.keys().next().value;
      cache.delete(oldest);
    }
    return markup;
  }

  function cancelPending() {
    if (pendingTimer) {
      win.clearTimeout(pendingTimer);
      pendingTimer = 0;
    }
  }

  function hide() {
    cancelPending();
    shownId = '';
    if (popover) {
      popover.classList.remove('is-visible');
      popover.hidden = true;
    }
  }

  function showForCard(card) {
    if (!card || !isDesktopPointer() || !doc) return;
    if (card.classList.contains('active')) { hide(); return; }
    if (doc.body.classList.contains('madden-open') || doc.querySelector('#coach-film-room[open], .modal-backdrop')) {
      hide();
      return;
    }
    const action = card.dataset.action || '';
    if (!action.startsWith('choose:')) return;
    const id = action.slice('choose:'.length);
    const play = getPlay?.(id);
    if (!play) return;

    const el = ensurePopover();
    if (!el) return;
    const meta = formatMeta ? formatMeta(play) : {
      badge: play.formation || '',
      stats: `${(play.players || []).length} · ${(play.routes || []).length}`,
    };

    if (shownId !== play.id) {
      el.innerHTML = `<div class="play-preview-art">${renderSVG(play)}</div><div class="play-preview-meta"><div class="play-preview-title"><strong>${e(play.title)}</strong>${meta.badge ? `<span>${e(meta.badge)}</span>` : ''}</div><small>${e(meta.stats)}</small></div>`;
      shownId = play.id;
    }

    const sidebar = card.closest('.sidebar');
    const anchorRect = (sidebar || card).getBoundingClientRect?.();
    const cardRect = card.getBoundingClientRect?.();
    const vw = win.innerWidth || 1440;
    const vh = win.innerHeight || 900;
    const cardWidth = 312;
    const cardHeight = 258;
    const left = Math.min(vw - cardWidth - 16, Math.max(16, (anchorRect?.right || 260) + 12));
    const rawTop = (cardRect?.top ?? 120) - 24;
    const top = Math.max(68, Math.min(vh - cardHeight - 16, rawTop));

    el.style.left = `${Math.round(left)}px`;
    el.style.top = `${Math.round(top)}px`;
    el.dataset.reduced = String(reducedMotion(win));
    el.hidden = false;
    el.classList.add('is-visible');
  }

  function detach() {
    cancelPending();
    cleanups.forEach(fn => fn());
    cleanups = [];
    activeList = null;
  }

  function mount(list) {
    if (activeList === list) return;
    detach();
    hide();
    activeList = list;
    if (!list || !doc) return;

    const on = (target, event, handler, options) => {
      if (!target?.addEventListener) return;
      target.addEventListener(event, handler, options);
      cleanups.push(() => target.removeEventListener(event, handler, options));
    };

    on(list, 'pointerover', event => {
      if (event.pointerType && event.pointerType !== 'mouse') return;
      if (!isDesktopPointer()) return;
      const card = event.target.closest?.('.play-card[data-action^="choose:"]');
      if (!card || !list.contains(card) || card.classList.contains('active')) {
        hide();
        return;
      }
      cancelPending();
      if (shownId) {
        showForCard(card);
      } else {
        pendingTimer = win.setTimeout(() => {
          pendingTimer = 0;
          if (card.isConnected) showForCard(card);
        }, delay);
      }
    });

    on(list, 'pointerout', event => {
      const next = event.relatedTarget?.closest?.('.play-card[data-action^="choose:"]');
      if (!next || !list.contains(next)) hide();
    });

    on(list, 'pointerdown', hide);
    on(list, 'scroll', hide, { passive: true });
    const sidebar = list.closest?.('.sidebar');
    if (sidebar && sidebar !== list) on(sidebar, 'scroll', hide, { passive: true });
    on(doc, 'keydown', event => { if (event.key === 'Escape') hide(); });
    on(win, 'blur', hide);
  }

  function destroy() {
    detach();
    hide();
    popover?.remove();
    popover = null;
    cache.clear();
  }

  return { mount, hide, destroy };
}
