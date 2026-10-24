import { COMPACT_WIDTH } from './workspace-panels.js';
// Match the side panels to the real sticky header, including wrapped toolbars.
// Observe the host so replacing the cloud toolbar never leaves an old observer.
export function initViewportLayout() {
  const root = document.querySelector('#cloud-root');
  if (!root) return () => {};
  let header;
  function measureViewport() {
    const viewport = window.visualViewport, style = document.documentElement.style;
    const height = Math.round(viewport?.height || window.innerHeight), top = Math.round(viewport?.offsetTop || 0);
    for (const [key, value] of [['--visible-height', `${height}px`], ['--visible-top', `${top}px`]]) if (style.getPropertyValue(key) !== value) style.setProperty(key, value);
  }
  function measure() {
    const sticky = !!header && window.innerWidth > COMPACT_WIDTH && !root.querySelector('.cloud-empty');
    if (root.classList.contains('sticky-cloud-header') !== sticky) root.classList.toggle('sticky-cloud-header', sticky);
    const height = sticky ? Math.ceil(header.getBoundingClientRect().height) : 0;
    const style = document.documentElement.style;
    if (style.getPropertyValue('--cloud-height') !== `${height}px`) style.setProperty('--cloud-height', `${height}px`);
  }
  const sizes = typeof window.ResizeObserver === 'function' ? new window.ResizeObserver(measure) : null;
  function observeHeader() {
    const next = root.querySelector('.cloud-bar');
    if (next !== header) {
      sizes?.disconnect();
      header = next;
      if (header) sizes?.observe(header);
    }
    measure();
  }
  const changes = new window.MutationObserver(observeHeader);
  changes.observe(root, { childList: true });
  const onResize = () => { measure(); measureViewport(); };
  window.addEventListener('resize', onResize);
  window.visualViewport?.addEventListener('resize', measureViewport);
  window.visualViewport?.addEventListener('scroll', measureViewport);
  observeHeader();
  measureViewport();
  return () => {
    changes.disconnect(); sizes?.disconnect();
    window.removeEventListener('resize', onResize);
    window.visualViewport?.removeEventListener('resize', measureViewport);
    window.visualViewport?.removeEventListener('scroll', measureViewport);
  };
}
