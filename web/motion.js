// Motion describes a change of context. Direct manipulation never waits for it.
export const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
export function animate(node, frames, options = {}) {
  if (!node?.animate || reducedMotion()) return null;
  return node.animate(frames, { duration: 240, easing: 'cubic-bezier(.22,1,.36,1)', ...options });
}
export function enterContext(node) {
  animate(node, [{ opacity: .35, translate: '0 7px' }, { opacity: 1, translate: '0 0' }]);
}
export function enterPlayers(field, ids) {
  let index = 0;
  for (const node of field?.querySelectorAll('[data-player]') || []) {
    if (!ids.has(node.dataset.player)) continue;
    // Animate the symbol inside the positioned group; leave its SVG transform intact.
    animate(node.querySelector('.player-symbol'), [
      { opacity: 0, transform: 'translateY(-18px) scale(.5)' },
      { opacity: 1, transform: 'translateY(1px) scale(1.1)', offset: .72 },
      { opacity: 1, transform: 'translateY(0) scale(1)' }
    ], { duration: 400, delay: index++ * 22, fill: 'backwards' });
  }
}
export function revealPlay(field) {
  enterContext(field);
  for (const path of field?.querySelectorAll('.route-stroke') || []) {
    if (path.hasAttribute('stroke-dasharray')) continue;
    animate(path, [{ strokeDasharray: '1 1', strokeDashoffset: 1 }, { strokeDasharray: '1 1', strokeDashoffset: 0 }], { duration: 420 });
  }
}
