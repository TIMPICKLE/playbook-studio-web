import test from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { readFileSync } from 'node:fs';

function readWeb(rel) {
  return readFileSync(new URL(`../web/${rel}`, import.meta.url), 'utf8');
}

test('mobile-studio.css is loaded after component-layout.css and cached by sw.js', () => {
  const html = readWeb('index.html');
  const compIdx = html.indexOf('./component-layout.css');
  const mobileIdx = html.indexOf('./mobile-studio.css');
  assert.ok(compIdx > 0, 'component-layout.css should be linked in index.html');
  assert.ok(mobileIdx > compIdx, 'mobile-studio.css must load after component-layout.css');

  const sw = readWeb('sw.js');
  assert.ok(sw.includes("'./mobile-studio.css'"), 'sw.js must precache ./mobile-studio.css');

  const css = readWeb('mobile-studio.css');
  assert.ok(css.includes('.stage-dock .draw-tools'), 'mobile-studio.css defines horizontal draw-tools rail');
  assert.ok(css.includes('scroll-snap-type: x proximity'), 'draw-tools uses smooth scroll-snap on phone');
  assert.ok(css.includes('.sheet-handle'), 'bottom sheet drag handle is styled');
  assert.ok(css.includes('[data-has-selection]'), 'compact-nav selection dot indicator is styled');
});

test('mobile gestures, quick inspector entry, AI tab transition, and pinch-to-zoom work cleanly on phone', async t => {
  const win = new Window({ url: 'http://localhost:3000/local.html', width: 390, height: 844 });
  win.document.body.innerHTML = readWeb('index.html').split('<body>')[1].split('</body>')[0];
  const names = ['window', 'document', 'navigator', 'localStorage', 'location', 'Image', 'Blob', 'requestAnimationFrame', 'cancelAnimationFrame'];
  const previous = Object.fromEntries(names.map(n => [n, Object.getOwnPropertyDescriptor(globalThis, n)]));
  for (const n of names) {
    Object.defineProperty(globalThis, n, {
      configurable: true,
      value: ['requestAnimationFrame', 'cancelAnimationFrame'].includes(n) ? win[n].bind(win) : win[n],
    });
  }
  const doc = win.document;
  const q = s => doc.querySelector(s);
  const pointer = (node, type, x, y, { id = 1, primary = true } = {}) =>
    node.dispatchEvent(new win.PointerEvent(type, {
      bubbles: true, cancelable: true, button: 0,
      pointerId: id, pointerType: 'touch', isPrimary: primary, clientX: x, clientY: y,
    }));

  try {
    await import(`../web/app.js?mobileUx=${Date.now()}`);

    await t.test('swipe left dismisses sidebar drawer; short swipe keeps it open', () => {
      q('.compact-nav [data-action="sidebar"]').click();
      assert.equal(q('.workspace').classList.contains('sidebar-open'), true);

      // Short swipe (-24px) must not dismiss
      const sidebar = q('.sidebar');
      pointer(sidebar, 'pointerdown', 240, 220);
      pointer(sidebar, 'pointermove', 216, 222);
      pointer(sidebar, 'pointerup', 216, 222);
      assert.equal(q('.workspace').classList.contains('sidebar-open'), true);

      // Full left swipe (-96px) dismisses cleanly and clears inline styles
      pointer(sidebar, 'pointerdown', 240, 220);
      pointer(sidebar, 'pointermove', 144, 224);
      pointer(sidebar, 'pointerup', 144, 224);
      assert.equal(q('.workspace').classList.contains('sidebar-open'), false);
      assert.equal(sidebar.style.transform, '');
    });

    await t.test('swipe down from bottom sheet header dismisses inspector; scrolled content does not', () => {
      q('.compact-nav [data-action="inspector-panel"]').click();
      assert.equal(q('.workspace').classList.contains('inspector-open'), true);
      assert.ok(q('.inspector-panel .sheet-handle'), 'sheet handle should exist in inspector panel header');

      // When inspector content is scrolled down, dragging inside content should NOT dismiss
      const inspector = q('.inspector-panel .inspector');
      inspector.scrollTop = 120;
      pointer(inspector, 'pointerdown', 180, 420);
      pointer(inspector, 'pointermove', 182, 540);
      pointer(inspector, 'pointerup', 182, 540);
      assert.equal(q('.workspace').classList.contains('inspector-open'), true);

      // Dragging down from panel heading dismisses even when content is scrolled
      const heading = q('.inspector-panel .panel-heading');
      pointer(heading, 'pointerdown', 180, 260);
      pointer(heading, 'pointermove', 182, 360);
      pointer(heading, 'pointerup', 182, 360);
      assert.equal(q('.workspace').classList.contains('inspector-open'), false);
    });

    await t.test('switching to AI Assistant tab from mobile inspector closes sheet so assistant is visible', () => {
      q('.compact-nav [data-action="inspector-panel"]').click();
      assert.equal(doc.body.classList.contains('compact-panel-open'), true);

      const aiTab = q('[data-action="assistant-task"]');
      assert.ok(aiTab, 'assistant-task button should exist');
      aiTab.click();

      assert.equal(doc.body.classList.contains('compact-panel-open'), false, 'compact-panel-open must be removed so docked AI panel is not hidden');
      assert.equal(q('.workspace').classList.contains('inspector-open'), false);
      const aiPanel = q('.board-ai .ba-panel');
      assert.ok(aiPanel && !aiPanel.hidden, 'board assistant panel should be open and unhidden');

      // Close assistant cleanly
      q('.board-ai [data-ba="close"]')?.click();
    });

    await t.test('selecting a player exposes quick Properties button in field context and toggles compact-nav selection dot', () => {
      const nav = q('.compact-nav');
      assert.equal(nav.hasAttribute('data-has-selection'), false);

      const svg = q('#field .pitch-svg');
      svg.getBoundingClientRect = () => ({ left: 0, top: 0, width: 1000, height: 800 });
      svg.getScreenCTM = () => ({ inverse: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }) });

      pointer(q('#field [data-player]'), 'pointerdown', 300, 400);
      pointer(q('#field'), 'pointerup', 300, 400);

      assert.equal(nav.hasAttribute('data-has-selection'), true, 'compact-nav should show selection indicator');
      const quickProps = q('#field-context [data-action="inspector-panel"]');
      assert.ok(quickProps, 'field-context should include compact quick Properties trigger');

      quickProps.click();
      assert.equal(q('.workspace').classList.contains('inspector-open'), true);
      q('.inspector-panel .panel-close').click();
      q('[data-action="clear-selection"]').click();
      assert.equal(nav.hasAttribute('data-has-selection'), false);
    });

    await t.test('two-finger pinch on empty pitch zooms smoothly within 100-300%', () => {
      const viewport = q('.pitch-viewport');
      viewport.getBoundingClientRect = () => ({ left: 0, top: 0, width: 370, height: 320 });
      assert.equal(q('#board-zoom-value').textContent, '100%');

      // Two fingers start 100px apart on empty viewport, then spread to 180px apart (1.8x)
      pointer(viewport, 'pointerdown', 120, 160, { id: 10, primary: true });
      pointer(viewport, 'pointerdown', 220, 160, { id: 11, primary: false });
      pointer(viewport, 'pointermove', 80, 160, { id: 10, primary: true });
      pointer(viewport, 'pointermove', 260, 160, { id: 11, primary: false });
      pointer(viewport, 'pointerup', 80, 160, { id: 10, primary: true });
      pointer(viewport, 'pointerup', 260, 160, { id: 11, primary: false });

      assert.equal(q('#board-zoom-value').textContent, '180%');

      // Reset to 100% via fit
      q('[data-board-action="fit"]').click();
      assert.equal(q('#board-zoom-value').textContent, '100%');
    });
  } finally {
    await win.happyDOM.abort();
    for (const n of names) {
      if (previous[n]) Object.defineProperty(globalThis, n, previous[n]);
      else delete globalThis[n];
    }
  }
});
