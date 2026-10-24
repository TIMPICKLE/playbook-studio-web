export const COMPACT_WIDTH = 1180;
export function createWorkspacePanels() {
  let active = null, returnFocus = null;
  let compact = window.innerWidth <= COMPACT_WIDTH;
  const panel = name => document.querySelector(name === 'plays' ? '.sidebar' : '.inspector-panel');
  function mount() {
    const opened = compact && !!active;
    document.body.classList.toggle('compact-panel-open', opened);
    const workspace = document.querySelector('.workspace');
    workspace?.classList.toggle('sidebar-open', compact && active === 'plays');
    workspace?.classList.toggle('inspector-open', compact && active === 'properties');
    for (const name of ['plays', 'properties']) {
      const node = panel(name); if (!node) continue;
      node.inert = compact && active !== name;
      if (compact && active === name) { node.setAttribute('role', 'dialog'); node.setAttribute('aria-modal', 'true'); }
      else { node.removeAttribute('role'); node.removeAttribute('aria-modal'); }
    }
    const main = document.querySelector('#main-content'); if (main) main.inert = compact && active === 'plays';
    for (const node of document.querySelectorAll('#cloud-root,.topbar,.play-header,.canvas-section,.board-width-resizer,.app-footer,.compact-nav')) node.inert = opened;
    for (const node of document.querySelectorAll('[data-action="sidebar"]')) node.setAttribute('aria-expanded', String(compact && active === 'plays'));
    for (const node of document.querySelectorAll('[data-action="inspector-panel"]')) node.setAttribute('aria-expanded', String(compact && active === 'properties'));
    document.querySelector('.compact-nav [data-action="panel-field"]')?.setAttribute('aria-pressed', String(!active));
    if (opened && !panel(active)?.contains(document.activeElement)) panel(active)?.querySelector('.panel-close')?.focus({ preventScroll: true });
  }
  function close({ focus = true } = {}) {
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
  window.addEventListener('resize', () => {
    const next = window.innerWidth <= COMPACT_WIDTH;
    if (next !== compact) { compact = next; close({ focus: false }); }
    else mount();
  });
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
