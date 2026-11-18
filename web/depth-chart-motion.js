import { animate, reducedMotion } from './motion.js';

// The field can show the same assignment on the pitch and in the selected
// role's detail. Keep the interaction on the surface the coach used.
export const depthSurface = node => node?.closest('.df-detail') ? 'detail' : 'main';

export function describeDepthMove(changes, source, targetSlot, targetSurface) {
  const playerId = source.playerId;
  const destination = changes.find(change => change.id === targetSlot);
  const origin = source.slotId
    ? changes.find(change => change.id === source.slotId)
    : changes.find(change => change.id !== targetSlot && change.before.includes(playerId) && !change.after.includes(playerId))
      || (destination?.before.includes(playerId) ? destination : null);
  return {
    playerId,
    from: { slotId: origin?.id, index: origin?.before.indexOf(playerId), surface: source.surface },
    to: { slotId: targetSlot, index: destination.after.indexOf(playerId), surface: targetSurface },
  };
}

export function createDepthMoveFeedback(sheet) {
  const win = sheet.ownerDocument.defaultView;
  let animation;
  function cancel() {
    animation?.cancel();
    animation = null;
  }
  function rankNode(place, playerId, label = false) {
    if (!place.slotId) {
      const picker = sheet.querySelector('[data-depth-chart="pick-player"]');
      return picker?.dataset.depthSource === playerId ? (label ? picker.querySelector('[data-depth-label]') : picker) : null;
    }
    const slot = `[data-depth-drop-slot="${win.CSS.escape(place.slotId)}"]`;
    const selector = label ? `${slot} [data-depth-label="${win.CSS.escape(playerId)}"]` : slot;
    const nodes = [...sheet.querySelectorAll(selector)];
    const matching = label ? nodes : nodes.filter(node => node.dataset.depthDropIndex === String(place.index)
      || (node.matches('.df-node') && node.dataset.sourceIndex === String(place.index)));
    // Moving a filtered backup restores the marker's regular starter label.
    // Its old rank is gone, but the same position is still on the field.
    const fieldSlot = !label && place.surface === 'main' && nodes.find(node => node.matches('.df-node'));
    return matching.find(node => depthSurface(node) === place.surface) || fieldSlot || matching[0];
  }

  function capture(move) {
    let bounds;
    if (!reducedMotion(win)) {
      const origin = rankNode(move.from, move.playerId, true);
      if (origin) bounds = origin.getBoundingClientRect();
    }
    // A re-render can temporarily shorten the document when the inline
    // receipt moves. Preserve scroll on both the page and its containers.
    const scrollers = [];
    for (let node = sheet.parentElement; node; node = node.parentElement) {
      if (node.scrollTop || node.scrollLeft) scrollers.push([node, node.scrollLeft, node.scrollTop]);
    }
    return { bounds, scrollers, x: win.scrollX, y: win.scrollY };
  }

  function present(move, before, action) {
    const { playerId, from, to } = move;
    const origin = rankNode(from, playerId);
    const destination = rankNode(to, playerId);
    const name = rankNode(to, playerId, true);
    if (origin) origin.dataset.depthMove = 'from';
    if (destination) destination.dataset.depthMove = 'to';

    // A promoted player may no longer have their previous "move up" action.
    const nextAction = action && [...(destination?.querySelectorAll('[data-depth-chart]') || [])]
      .find(button => button.dataset.depthChart === action && button.dataset.player === playerId);
    const focus = nextAction || name?.closest('button') || destination?.closest('button')
      || destination?.querySelector('button') || destination?.closest('.df-detail')?.querySelector('[data-depth-chart="edit"]')
      || sheet.querySelector('[data-formation-player]');
    focus?.focus({ preventScroll: true });
    for (const [node, left, top] of before.scrollers) {
      if (node.scrollLeft !== left) node.scrollLeft = left;
      if (node.scrollTop !== top) node.scrollTop = top;
    }
    if (win.scrollX !== before.x || win.scrollY !== before.y) {
      win.scrollTo({ left: before.x, top: before.y, behavior: 'instant' });
    }
    if (!name?.animate || reducedMotion(win)) return;
    const start = before.bounds, end = name.getBoundingClientRect();
    const visible = rect => rect?.width && rect.height && rect.bottom > 0 && rect.top < win.innerHeight
      && rect.right > 0 && rect.left < win.innerWidth;
    if (!visible(end)) return;
    if (visible(start)) {
      const x = start.left - end.left, y = start.top - end.top;
      if (Math.abs(x) + Math.abs(y) < 1) return;
      animation = animate(name, [{ translate: `${x}px ${y}px` }, { translate: '0 0' }]);
    } else {
      animation = animate(name, [{ opacity: .4 }, { opacity: 1 }]);
    }
  }

  return { capture, present, cancel };
}
