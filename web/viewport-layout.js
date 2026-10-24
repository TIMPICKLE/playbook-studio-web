// Match the side panels to the real sticky header, including wrapped toolbars.
// Observe the host so replacing the cloud toolbar never leaves an old observer.
export function initViewportLayout() {
  const root = document.querySelector('#cloud-root');
  if (!root) return () => {};
  let header;
  function measure() {
    const sticky = !!header && window.innerWidth > 720 && !root.querySelector('.cloud-empty');
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
  window.addEventListener('resize', measure);
  observeHeader();
  return () => {
    changes.disconnect(); sizes?.disconnect();
    window.removeEventListener('resize', measure);
  };
}
