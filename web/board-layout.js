import { t } from './i18n.js';
import { isCompactWorkspace } from './workspace-panels.js';
// Device-local layout preferences. This module never edits the shared playbook.
export const BOARD_LAYOUT_KEY = 'playbook-studio-board-layout-v1';
const bound = (n, min, max) => Math.round(Math.min(max, Math.max(min, n)));
const compactHeightMin = 200, heightMax = 1400;
const heightMin = () => isCompactWorkspace() ? compactHeightMin : 280;
const dimensionsMode = () => window.innerWidth <= 600 || (isCompactWorkspace() && window.innerHeight <= 500)
  ? `popover-${window.innerWidth > window.innerHeight ? 'landscape' : 'portrait'}` : 'inline';

export function createBoardLayout({ notify = () => {}, hasDraft = () => false,onChange=()=>{} } = {}) {
  const q = selector => document.querySelector(selector);
  let prefs = {}, expanded = false, zoom = 1, gesture = null, frame = null, pending = null;
  const touchPointers = new Map();
  let pinch = null;
  let dimensionsLayout = dimensionsMode(), dimensionsOpen = dimensionsLayout === 'inline';
  try {
    const saved = JSON.parse(localStorage.getItem(BOARD_LAYOUT_KEY));
    if (Number.isFinite(saved?.height)) prefs.height = bound(saved.height, compactHeightMin, heightMax);
    if (Number.isFinite(saved?.expandedHeight)) prefs.expandedHeight = bound(saved.expandedHeight, compactHeightMin, heightMax);
    if (Number.isFinite(saved?.inspector)) prefs.inspector = bound(saved.inspector, 220, 480);
  } catch { /* A denied or invalid preference must not block the editor. */ }

  const defaultHeight = () => {
    const field=q('#field'), top=field ? field.getBoundingClientRect().top+(window.scrollY||0) : 0;
    const dock=q('.stage-dock')?.getBoundingClientRect().height||56;
    const compact=q('.compact-nav')?.getBoundingClientRect().height||0;
    if (isCompactWorkspace() && window.innerWidth > 600 && window.innerHeight <= 500) {
      // Short landscape gives the board its own column. Its tools live beside
      // it, so their stacked height must not be subtracted from the board.
      const navigation=q('.workspace-nav')?.getBoundingClientRect().bottom || 53;
      const chrome=navigation+(window.scrollY||0);
      const mode=q('.editor-mode')?.getBoundingClientRect().height || 44;
      return bound(window.innerHeight-chrome-compact-mode-16,heightMin(),820);
    }
    // Size the initial pitch around real controls, rather than making the
    // coach scroll to discover drawing/transport controls below a tall pitch.
    const available=window.innerHeight-top-Math.max(56,dock)-compact-48;
    const preferred=window.innerWidth<=720 ? Math.min((window.innerWidth-28)*.8,window.innerHeight*.7)
      : isCompactWorkspace()?Math.min((window.innerWidth-36)*.8,window.innerHeight*.5):window.innerHeight*.62;
    return bound(Math.min(preferred,available),heightMin(),820);
  };
  const height = () => bound(expanded
    ? prefs.expandedHeight ?? bound((window.innerWidth - 48) * .8, heightMin(), 1100)
    : prefs.height ?? defaultHeight(),heightMin(),heightMax);
  const setHeight = value => { prefs[expanded ? 'expandedHeight' : 'height'] = bound(value, heightMin(), heightMax); };
  const maxInspector = () => bound((q('.editor-layout')?.clientWidth || window.innerWidth) * .4, 220, 480);
  const inspector = () => bound(prefs.inspector ?? 320, 220, maxInspector());
  function persist() {
    try { localStorage.setItem(BOARD_LAYOUT_KEY, JSON.stringify(prefs)); }
    catch { notify(t("controls.size_adjusted_but_browser_storage_is_unavailable_default")); }
  }
  const getState = () => ({zoom, expanded, height:height(), inspectorWidth:inspector(), panX:q('.pitch-viewport')?.scrollLeft || 0, panY:q('.pitch-viewport')?.scrollTop || 0});
  function setState(next = {}) {
    finish(true);
    if (next.reset) { prefs = {}; expanded = false; zoom = 1; dimensionsOpen = dimensionsLayout === 'inline'; }
    if (next.expanded != null) expanded = !!next.expanded;
    if (next.zoom != null) zoom = Math.min(3, Math.max(1, next.zoom));
    if (next.fit) zoom = 1;
    if (next.height != null) setHeight(next.height);
    if (next.inspectorWidth != null) prefs.inspector = bound(next.inspectorWidth, 220, maxInspector());
    apply();
    const viewport=q('.pitch-viewport');
    if(viewport) {
      if(next.fit || next.reset) {viewport.scrollLeft=0;viewport.scrollTop=0;}
      if(next.panX != null) viewport.scrollLeft=Math.min(Math.max(0,viewport.scrollWidth-viewport.clientWidth),Math.max(0,next.panX));
      if(next.panY != null) viewport.scrollTop=Math.min(Math.max(0,viewport.scrollHeight-viewport.clientHeight),Math.max(0,next.panY));
    }
    persist();
    return getState();
  }
  function apply() {
    const workspace = q('.workspace');
    if (!workspace) return;
    const nextDimensionsLayout = dimensionsMode();
    if (nextDimensionsLayout !== dimensionsLayout) {
      dimensionsLayout = nextDimensionsLayout; dimensionsOpen = dimensionsLayout === 'inline';
    }
    workspace.classList.toggle('board-expanded', expanded);
    const navigation=q('.workspace-nav')?.getBoundingClientRect();
    workspace.style.setProperty('--workspace-document-top',`${Math.max(0,(navigation?.bottom||0)+(window.scrollY||0))}px`);
    workspace.style.setProperty('--compact-nav-height',`${q('.compact-nav')?.getBoundingClientRect().height||0}px`);
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
    if (slider) { slider.min=heightMin(); slider.value = height(); }
    if (q('#board-size-value')) q('#board-size-value').textContent = `${height()} px`;
    for (const handle of document.querySelectorAll('[data-board-resize]')) {
      const vertical = handle.dataset.boardResize === 'height';
      handle.setAttribute('aria-valuenow', vertical ? height() : inspector());
      handle.setAttribute('aria-valuemin', vertical ? heightMin() : 220);
      handle.setAttribute('aria-valuemax', vertical ? heightMax : maxInspector());
      handle.setAttribute('aria-valuetext', vertical ? `画板高度 ${height()} 像素` : `属性栏宽度 ${inspector()} 像素`);
    }
    const toggle = q('[data-board-action="expand"]');
    if (toggle) {
      toggle.setAttribute('aria-pressed', String(expanded));
      toggle.querySelector('span').textContent = expanded ? t("controls.exit_expanded_view") : t("controls.expand_board");
      toggle.title = expanded ? t("controls.exit_expanded_view_esc") : t("controls.expand_board_and_collapse_side_panels");
    }
    onChange(getState());
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
    if (event.pointerType === 'touch' && event.target.closest?.('.pitch-viewport')) {
      const onInteractive = !!event.target.closest?.('[data-player],[data-route],[data-zone],[data-annotation],.point-handle');
      if (!onInteractive && !document.querySelector('.field-wrap.is-dragging') && !hasDraft()) {
        touchPointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
        if (touchPointers.size === 2) {
          const [a, b] = [...touchPointers.values()];
          const dist = Math.hypot(b.x - a.x, b.y - a.y);
          const viewport = q('.pitch-viewport');
          if (dist >= 16 && viewport) {
            const rect = viewport.getBoundingClientRect();
            pinch = {
              startDist: dist,
              startZoom: zoom,
              ratioX: (viewport.scrollLeft + (a.x + b.x) / 2 - rect.left) / Math.max(1, viewport.scrollWidth),
              ratioY: (viewport.scrollTop + (a.y + b.y) / 2 - rect.top) / Math.max(1, viewport.scrollHeight),
            };
          }
        }
      }
    }
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
    if (event.pointerType === 'touch' && touchPointers.has(event.pointerId)) {
      touchPointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (pinch && touchPointers.size === 2) {
        if (document.querySelector('.field-wrap.is-dragging') || hasDraft()) {
          pinch = null;
        } else {
          const [a, b] = [...touchPointers.values()];
          const dist = Math.hypot(b.x - a.x, b.y - a.y);
          const nextZoom = Math.min(3, Math.max(1, Math.round(pinch.startZoom * (dist / pinch.startDist) * 100) / 100));
          if (Math.abs(nextZoom - zoom) >= 0.02) {
            zoom = nextZoom;
            apply();
            const viewport = q('.pitch-viewport');
            if (viewport) {
              const rect = viewport.getBoundingClientRect();
              const midX = (a.x + b.x) / 2 - rect.left;
              const midY = (a.y + b.y) / 2 - rect.top;
              viewport.scrollLeft = Math.max(0, Math.min(viewport.scrollWidth - viewport.clientWidth, pinch.ratioX * viewport.scrollWidth - midX));
              viewport.scrollTop = Math.max(0, Math.min(viewport.scrollHeight - viewport.clientHeight, pinch.ratioY * viewport.scrollHeight - midY));
            }
          }
        }
      }
    }
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    pending = { x: event.clientX, y: event.clientY };
    if (frame === null) frame = window.requestAnimationFrame(flush);
  });
  function clearTouchPointer(pointerId) {
    if (touchPointers.delete(pointerId) && touchPointers.size < 2) pinch = null;
  }
  document.addEventListener('pointerup', event => {
    clearTouchPointer(event.pointerId);
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    pending = { x: event.clientX, y: event.clientY };
    finish();
  });
  document.addEventListener('pointercancel', event => { clearTouchPointer(event.pointerId); if (event.pointerId === gesture?.pointerId) finish(true); });
  document.addEventListener('lostpointercapture', event => { clearTouchPointer(event.pointerId); if (event.pointerId === gesture?.pointerId) finish(true); });
  window.addEventListener('blur', () => { touchPointers.clear(); pinch = null; finish(true); });
  window.addEventListener('resize', () => {
    finish(true); apply();
  });
  document.addEventListener('toggle', event => {
    if (event.target === q('.board-advanced')) dimensionsOpen = event.target.open;
  }, { capture: true });
  document.addEventListener('playbook:effects-changed', apply);

  document.addEventListener('input', event => {
    if (event.target.id !== 'board-height') return;
    setHeight(Number(event.target.value));
    apply();
  });
  document.addEventListener('change', event => { if (event.target.id === 'board-height') persist(); });
  document.addEventListener('click', event => {
    const dimensions = q('.board-advanced');
    if (dimensionsLayout !== 'inline' && dimensions?.open && !dimensions.contains(event.target)) {
      dimensionsOpen = false; dimensions.open = false;
    }
    const action = event.target.closest('[data-board-action]')?.dataset.boardAction;
    if (!action) return;
    if (action === 'expand') setState({expanded:!expanded});
    if (action === 'zoom-in') setState({zoom:zoom + .25});
    if (action === 'zoom-out') setState({zoom:zoom - .25});
    if (action === 'fit') setState({fit:true});
    if (action === 'reset') { setState({reset:true,fit:true}); notify(t("controls.restored_default_board_size_and_side_panels")); }
  });
  document.addEventListener('keydown', event => {
    const dimensions = q('.board-advanced');
    if (event.key === 'Escape' && dimensionsLayout !== 'inline' && dimensions?.open) {
      event.preventDefault(); event.stopImmediatePropagation();
      dimensionsOpen = false; dimensions.open = false; dimensions.querySelector('summary')?.focus({preventScroll:true});
      return;
    }
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
        setHeight(event.key === 'Home' ? heightMin() : event.key === 'End' ? heightMax
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
  return { mount: apply, getState, setState };
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
