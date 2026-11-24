export const COMPACT_WIDTH = 1180;
export const TOUCH_COMPACT_WIDTH = 1400;
export function isCompactWorkspace(win = window) {
  return win.innerWidth <= COMPACT_WIDTH
    || (win.innerWidth <= TOUCH_COMPACT_WIDTH && !!win.matchMedia?.('(any-pointer: coarse)').matches);
}
export function createWorkspacePanels() {
  let active = null, returnFocus = null;
  let compact = isCompactWorkspace();
  let swipe = null;
  const panel = name => document.querySelector(name === 'plays' ? '.sidebar' : '.inspector-panel');
  function clearSwipeStyles(node) {
    if (!node) return;
    node.style.transition = '';
    node.style.transform = '';
    node.classList.remove('is-swiping');
  }
  function mount() {
    const opened = compact && !!active;
    document.body.classList.toggle('compact-panel-open', opened);
    const workspace = document.querySelector('.workspace');
    workspace?.classList.toggle('sidebar-open', compact && active === 'plays');
    workspace?.classList.toggle('inspector-open', compact && active === 'properties');
    for (const name of ['plays', 'properties']) {
      const node = panel(name); if (!node) continue;
      clearSwipeStyles(node);
      node.inert = compact && active !== name;
      if (compact && active === name) { node.setAttribute('role', 'dialog'); node.setAttribute('aria-modal', 'true'); }
      else { node.removeAttribute('role'); node.removeAttribute('aria-modal'); }
    }
    const main = document.querySelector('#main-content'); if (main) main.inert = compact && active === 'plays';
    for (const node of document.querySelectorAll('#cloud-root,.topbar,.play-header,.canvas-section,.board-width-resizer,.app-footer,.compact-nav,.locale-control,.board-ai.ba-floating')) node.inert = opened;
    for (const node of document.querySelectorAll('[data-action="sidebar"]')) node.setAttribute('aria-expanded', String(compact && active === 'plays'));
    for (const node of document.querySelectorAll('[data-action="inspector-panel"]')) node.setAttribute('aria-expanded', String(compact && active === 'properties'));
    document.querySelector('.compact-nav [data-action="panel-field"]')?.setAttribute('aria-pressed', String(!active));
    if (opened && !panel(active)?.contains(document.activeElement)) panel(active)?.querySelector('.panel-close')?.focus({ preventScroll: true });
  }
  function close({ focus = true } = {}) {
    swipe = null;
    const prior = active; active = null; mount();
    if (focus && prior) {
      const fallback = document.querySelector(compact ? `.compact-nav [data-action="${prior === 'plays' ? 'sidebar' : 'inspector-panel'}"]` : '#main-content');
      (returnFocus?.isConnected && !returnFocus.closest('[inert]') ? returnFocus : fallback)?.focus({ preventScroll: true });
    }
  }
  function toggle(name) {
    if (!compact) return;
    if (active === name) { close(); return; }
    returnFocus = document.activeElement;
    active = name; mount();
  }
  function updateLayout() {
    const next = isCompactWorkspace();
    if (next !== compact) { compact = next; close({ focus: false }); }
    else mount();
  }

  // Native-feeling touch swipe-to-dismiss for mobile drawers and bottom sheets.
  document.addEventListener('pointerdown', event => {
    if (!compact || !active || event.pointerType !== 'touch' || event.isPrimary === false) return;
    const node = panel(active);
    if (!node || !node.contains(event.target)) return;
    if (event.target.closest('input[type="range"],select,textarea,input')) return;
    const isPhoneSheet = active === 'properties' && window.innerWidth <= 600;
    const scroller = active === 'properties' ? node.querySelector('.inspector') : node.querySelector('.play-list') || node;
    const startedOnHeader = !!event.target.closest('.panel-heading,.sheet-handle');
    swipe = {
      name: active,
      node,
      isPhoneSheet,
      scroller,
      startedOnHeader,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      axis: null,
      offset: 0,
    };
  }, { passive: true });

  document.addEventListener('pointermove', event => {
    if (!swipe || event.pointerId !== swipe.pointerId) return;
    const dx = event.clientX - swipe.startX;
    const dy = event.clientY - swipe.startY;
    if (!swipe.axis) {
      if (Math.hypot(dx, dy) < 10) return;
      if (swipe.isPhoneSheet) {
        const atTop = swipe.startedOnHeader || !swipe.scroller || swipe.scroller.scrollTop <= 1;
        if (atTop && dy > 0 && Math.abs(dy) > Math.abs(dx) * 1.15) swipe.axis = 'y';
        else { swipe = null; return; }
      } else if (swipe.name === 'plays') {
        if (dx < 0 && Math.abs(dx) > Math.abs(dy) * 1.2) swipe.axis = 'x-left';
        else { swipe = null; return; }
      } else {
        if (dx > 0 && Math.abs(dx) > Math.abs(dy) * 1.2) swipe.axis = 'x-right';
        else { swipe = null; return; }
      }
      swipe.node.classList.add('is-swiping');
      swipe.node.style.transition = 'none';
    }
    if (swipe.axis === 'y') {
      swipe.offset = Math.max(0, dy);
      swipe.node.style.transform = `translateY(${Math.round(swipe.offset)}px)`;
    } else if (swipe.axis === 'x-left') {
      swipe.offset = Math.min(0, dx);
      swipe.node.style.transform = `translateX(${Math.round(swipe.offset)}px)`;
    } else if (swipe.axis === 'x-right') {
      swipe.offset = Math.max(0, dx);
      swipe.node.style.transform = `translateX(${Math.round(swipe.offset)}px)`;
    }
  }, { passive: true });

  function endSwipe(event, cancelled = false) {
    if (!swipe || (event && event.pointerId !== swipe.pointerId)) return;
    const currentSwipe = swipe;
    swipe = null;
    clearSwipeStyles(currentSwipe.node);
    if (cancelled || !currentSwipe.axis) return;
    const threshold = currentSwipe.isPhoneSheet ? 64 : 56;
    if (Math.abs(currentSwipe.offset) >= threshold) close();
  }
  document.addEventListener('pointerup', event => endSwipe(event, false), { passive: true });
  document.addEventListener('pointercancel', event => endSwipe(event, true), { passive: true });

  window.addEventListener('resize', updateLayout);
  window.matchMedia?.('(any-pointer: coarse)').addEventListener?.('change', updateLayout);
  document.addEventListener('keydown', event => {
    if (!compact || !active || document.querySelector('.modal,.madden-panel')) return;
    if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); close(); return; }
    if (event.key !== 'Tab') return;
    const controls = [...panel(active).querySelectorAll('a[href],button,input,select,textarea,[tabindex]')].filter(n => !n.disabled && n.tabIndex >= 0 && !n.closest('[hidden],[inert]'));
    const first = controls[0], last = controls.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  }, { capture: true });
  return { mount, toggle, close, get active() { return active; } };
}
