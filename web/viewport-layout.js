import { COMPACT_WIDTH } from './workspace-panels.js';

// Full editor renders replace the scroll containers. Restore the view only after
// boardLayout.mount() has reapplied the zoom and size, otherwise the browser
// clamps the saved pitch offsets against its temporary unzoomed dimensions.
export function captureEditorScroll({doc=document,samePlay=false}={}) {
  const selectors=['.sidebar','.play-list','.inspector-panel','.inspector'];
  if(samePlay)selectors.push('.main','.pitch-viewport');
  const positions=selectors.flatMap(selector=>{
    const node=doc.querySelector(selector);
    return node?[{selector,left:node.scrollLeft,top:node.scrollTop}]:[];
  });
  const page=doc.scrollingElement||doc.documentElement;
  const pagePosition=samePlay&&page?{left:page.scrollLeft,top:page.scrollTop}:null;
  function restore(node,position){
    if(!node)return;
    // The digital theme inherits html { scroll-behavior:smooth }. Property
    // assignments use that behavior and leave a delayed page scroll running
    // after the render. Restore both axes atomically and cancel that animation.
    if(typeof node.scrollTo==='function')node.scrollTo({left:position.left,top:position.top,behavior:'instant'});
    else {node.scrollLeft=position.left;node.scrollTop=position.top;}
  }
  return ()=>{
    for(const position of positions)restore(doc.querySelector(position.selector),position);
    // Restore the outer page last: nested scrollers and their size are settled.
    if(pagePosition)restore(doc.scrollingElement||doc.documentElement,pagePosition);
  };
}

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
