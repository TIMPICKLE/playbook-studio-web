import { t } from './i18n.js';
// Device-local layout preferences. This module never edits the shared playbook.
export const BOARD_LAYOUT_KEY = 'playbook-studio-board-layout-v1';
const bound = (n, min, max) => Math.round(Math.min(max, Math.max(min, n)));
const heightMin = 280, heightMax = 1400;

export function createBoardLayout({ notify = () => {}, hasDraft = () => false } = {}) {
  const q = selector => document.querySelector(selector);
  let prefs = {}, expanded = false, zoom = 1, gesture = null, frame = null, pending = null;
  let smallScreen = window.innerWidth <= 600, dimensionsOpen = !smallScreen;
  try {
    const saved = JSON.parse(localStorage.getItem(BOARD_LAYOUT_KEY));
    if (Number.isFinite(saved?.height)) prefs.height = bound(saved.height, heightMin, heightMax);
    if (Number.isFinite(saved?.expandedHeight)) prefs.expandedHeight = bound(saved.expandedHeight, heightMin, heightMax);
    if (Number.isFinite(saved?.inspector)) prefs.inspector = bound(saved.inspector, 220, 480);
  } catch { /* A denied or invalid preference must not block the editor. */ }

  const defaultHeight = () => window.innerWidth <= 720
    ? bound(Math.min((window.innerWidth - 28) * .8, window.innerHeight * .7), heightMin, 600)
    : window.innerWidth <= 1180
      ? bound(Math.min((window.innerWidth - 36) * .8, window.innerHeight * .5), heightMin, 760)
      : bound(window.innerHeight * .62, 420, 820);
  const height = () => expanded
    ? prefs.expandedHeight ?? bound((window.innerWidth - 48) * .8, heightMin, 1100)
    : prefs.height ?? defaultHeight();
  const setHeight = value => { prefs[expanded ? 'expandedHeight' : 'height'] = bound(value, heightMin, heightMax); };
  const maxInspector = () => bound((q('.editor-layout')?.clientWidth || window.innerWidth) * .4, 220, 480);
  const inspector = () => bound(prefs.inspector ?? 250, 220, maxInspector());
  function persist() {
    try { localStorage.setItem(BOARD_LAYOUT_KEY, JSON.stringify(prefs)); }
    catch { notify(t("controls.size_adjusted_but_browser_storage_is_unavailable_default")); }
  }
  function apply() {
    const workspace = q('.workspace');
    if (!workspace) return;
    workspace.classList.toggle('board-expanded', expanded);
    const dimensions = q('.board-advanced'); if (dimensions && dimensions.open !== dimensionsOpen) dimensions.open = dimensionsOpen;
    workspace.style.setProperty('--board-height', `${height()}px`);
    workspace.style.setProperty('--inspector-width', `${inspector()}px`);
    const viewport = q('.pitch-viewport'), ratio = workspace.classList.contains('reference-play') ? 1000 / 560 : 1.25;
    const inset = viewport ? window.getComputedStyle(viewport) : null;
    const horizontal = (parseFloat(inset?.paddingLeft) || 0) + (parseFloat(inset?.paddingRight) || 0);
    const vertical = (parseFloat(inset?.paddingTop) || 0) + (parseFloat(inset?.paddingBottom) || 0);
    const baseWidth = Math.min((viewport?.clientWidth || window.innerWidth - 32) - horizontal, ((viewport?.clientHeight || height()) - vertical) * ratio);
    workspace.style.setProperty('--pitch-width', `${Math.floor(baseWidth * zoom)}px`);
    workspace.classList.toggle('pitch-zoomed', zoom > 1);
    if (q('#board-zoom-value')) q('#board-zoom-value').textContent = `${Math.round(zoom * 100)}%`;
    for (const node of document.querySelectorAll('[data-board-action="zoom-in"]')) node.disabled = zoom >= 3;
    for (const node of document.querySelectorAll('[data-board-action="zoom-out"]')) node.disabled = zoom <= 1;
    const slider = q('#board-height');
    if (slider) slider.value = height();
    if (q('#board-size-value')) q('#board-size-value').textContent = `${height()} px`;
    for (const handle of document.querySelectorAll('[data-board-resize]')) {
      const vertical = handle.dataset.boardResize === 'height';
      handle.setAttribute('aria-valuenow', vertical ? height() : inspector());
      handle.setAttribute('aria-valuemax', vertical ? heightMax : maxInspector());
      handle.setAttribute('aria-valuetext', vertical ? `画板高度 ${height()} 像素` : `属性栏宽度 ${inspector()} 像素`);
    }
    const toggle = q('[data-board-action="expand"]');
    if (toggle) {
      toggle.setAttribute('aria-pressed', String(expanded));
      toggle.querySelector('span').textContent = expanded ? t("controls.exit_expanded_view") : t("controls.expand_board");
      toggle.title = expanded ? t("controls.exit_expanded_view_esc") : t("controls.expand_board_and_collapse_side_panels");
    }
  }
  function flush() {
    if (frame !== null) window.cancelAnimationFrame(frame);
    frame = null;
    if (!gesture || !pending) return;
    if (gesture.axis === 'height') setHeight(gesture.height + pending.y - gesture.y);
    else prefs.inspector = bound(gesture.width - (pending.x - gesture.x), 220, maxInspector());
    pending = null;
    apply();
  }
  function finish(cancel = false) {
    if (!gesture) return;
    const previous = gesture;
    if (cancel) { if (frame !== null) window.cancelAnimationFrame(frame); frame = null; pending = null; prefs = previous.prefs; }
    else flush();
    gesture = null;
    if (previous.handle.hasPointerCapture?.(previous.pointerId)) previous.handle.releasePointerCapture(previous.pointerId);
    document.body.classList.remove('board-resizing', 'board-resizing-width');
    apply();
    if (!cancel) persist();
  }

  document.addEventListener('pointerdown', event => {
    const handle = event.target.closest('[data-board-resize]');
    if (!handle || event.button !== 0 || gesture) return;
    event.preventDefault();
    handle.focus({ preventScroll: true });
    gesture = { axis: handle.dataset.boardResize, x: event.clientX, y: event.clientY,
      height: height(), width: inspector(), prefs: { ...prefs }, pointerId: event.pointerId, handle };
    handle.setPointerCapture?.(event.pointerId);
    document.body.classList.add('board-resizing');
    document.body.classList.toggle('board-resizing-width', gesture.axis === 'width');
  });
  document.addEventListener('pointermove', event => {
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    pending = { x: event.clientX, y: event.clientY };
    if (frame === null) frame = window.requestAnimationFrame(flush);
  });
  document.addEventListener('pointerup', event => {
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    pending = { x: event.clientX, y: event.clientY };
    finish();
  });
  document.addEventListener('pointercancel', event => { if (event.pointerId === gesture?.pointerId) finish(true); });
  document.addEventListener('lostpointercapture', event => { if (event.pointerId === gesture?.pointerId) finish(true); });
  window.addEventListener('blur', () => finish(true));
  window.addEventListener('resize', () => {
    const next = window.innerWidth <= 600;
    if (next !== smallScreen) { smallScreen = next; dimensionsOpen = !next; }
    finish(true); apply();
  });
  document.addEventListener('toggle', event => { if (event.target.matches?.('.board-advanced')) dimensionsOpen = event.target.open; }, { capture: true });
  document.addEventListener('playbook:effects-changed', apply);

  document.addEventListener('input', event => {
    if (event.target.id !== 'board-height') return;
    setHeight(Number(event.target.value));
    apply();
  });
  document.addEventListener('change', event => { if (event.target.id === 'board-height') persist(); });
  document.addEventListener('click', event => {
    const action = event.target.closest('[data-board-action]')?.dataset.boardAction;
    if (!action) return;
    finish(true);
    if (action === 'expand') expanded = !expanded;
    if (action === 'zoom-in') zoom = Math.min(3, zoom + .25);
    if (action === 'zoom-out') zoom = Math.max(1, zoom - .25);
    if (action === 'fit' || action === 'reset') { zoom = 1; q('.pitch-viewport')?.scrollTo?.(0, 0); }
    if (action === 'reset') { prefs = {}; expanded = false; persist(); notify(t("controls.restored_default_board_size_and_side_panels")); }
    apply();
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && (gesture || (expanded && !hasDraft() && !q('.modal')))) {
      event.preventDefault(); event.stopImmediatePropagation();
      if (gesture) finish(true); else { expanded = false; apply(); }
      return;
    }
    const handle = event.target.closest('[data-board-resize]');
    if (handle && ['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End'].includes(event.key)) {
      event.preventDefault(); event.stopImmediatePropagation();
      const step = event.shiftKey ? 80 : 20;
      if (handle.dataset.boardResize === 'height') {
        setHeight(event.key === 'Home' ? heightMin : event.key === 'End' ? heightMax
          : height() + (['ArrowUp','ArrowLeft'].includes(event.key) ? -step : step));
      } else {
        prefs.inspector = event.key === 'Home' ? maxInspector() : event.key === 'End' ? 220
          : bound(inspector() + (['ArrowLeft','ArrowUp'].includes(event.key) ? step : -step), 220, maxInspector());
      }
      apply(); persist();
    } else if (event.target.closest('.board-size-controls,[data-board-resize]')) {
      // Let native buttons/range controls work without triggering play/draw shortcuts.
      event.stopImmediatePropagation();
    }
  });
  return { mount: apply };
}

export function boardSizeControls() {
  return `<div class="board-size-controls" aria-label="${t("controls.board_size")}">
    <div class="board-zoom-controls" role="group" aria-label="${t("controls.field_zoom")}"><button type="button" data-board-action="zoom-out" aria-label="${t("controls.zoom_out")}">−</button><output id="board-zoom-value" aria-live="polite">100%</output><button type="button" data-board-action="zoom-in" aria-label="${t("controls.zoom_in")}">＋</button><button type="button" data-board-action="fit">${t("controls.fit_to_screen")}</button></div>
    <details class="board-advanced"><summary>${t("controls.size")}</summary><div class="board-dimensions"><label for="board-height">${t("controls.board_height")}</label><input id="board-height" type="range" min="280" max="1400" step="1" aria-describedby="board-size-help"><output id="board-size-value" for="board-height"></output>
    <div class="board-size-actions"><button type="button" data-board-action="expand" aria-pressed="false"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M8 3H3v5M16 3h5v5M21 16v5h-5M8 21H3v-5"/></svg><span>${t("controls.expand_board")}</span></button><button type="button" data-board-action="reset" title="${t("controls.restore_default_board_size_and_layout")}">${t("controls.reset_board")}</button></div>
    </div></details>
    <span class="touch-board-help">${t("controls.with_select_drag_empty_space_to_pan_and_drag_players_to_")}</span><span id="board-size-help" class="sr-only">${t("controls.drag_the_bottom_edge_to_resize_height_on_desktop_drag_th")}</span>
  </div>`;
}

export const boardHeightHandle = `<div class="board-height-resizer" data-board-resize="height" role="separator" tabindex="0" aria-label="${t("controls.adjust_board_height")}" aria-orientation="horizontal" aria-controls="field" aria-valuemin="280" aria-valuemax="1400" title="${t("controls.drag_vertically_to_resize_use_arrow_keys_for_precision_a")}"><span aria-hidden="true"></span><small>${t("controls.drag_to_adjust_height")}</small><span aria-hidden="true"></span></div>`;
export const boardWidthHandle = `<div class="board-width-resizer" data-board-resize="width" role="separator" tabindex="0" aria-label="${t("controls.adjust_board_and_inspector_width")}" aria-orientation="vertical" aria-controls="field" aria-valuemin="220" aria-valuemax="480" title="${t("controls.drag_horizontally_to_resize_use_arrow_keys_for_precision")}"><span aria-hidden="true"></span></div>`;
