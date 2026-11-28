import test from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { starterWorkspace } from '../web/model.js';
import { createPlayPreviewPopover } from '../web/play-preview-popover.js';
import { createBoardAssistant } from '../web/board-assistant.js';
import baZh from '../web/locales/board-assistant.zh-CN.js';
import baEn from '../web/locales/board-assistant.en.js';

test('P2.2 board-assistant locales keep matching keys including curtain compare labels', () => {
  assert.deepEqual(Object.keys(baEn).sort(), Object.keys(baZh).sort());
  for (const key of ['compare', 'exitCompare', 'compareBefore', 'compareAfter', 'compareSlider']) {
    assert.ok(baZh[key] && baEn[key], `missing compare key: ${key}`);
  }
});

test('P2.2 Board Assistant renders Compare toggle pill and synchronizes aria-pressed state', async () => {
  const win = new Window({ url: 'https://playbook.test/editor/index.html' });
  const names = ['window', 'document', 'localStorage'];
  const old = Object.fromEntries(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  for (const name of names) Object.defineProperty(globalThis, name, { configurable: true, value: win[name] });

  try {
    let comparing = false;
    let rehearsed = 0;
    const host = win.document.createElement('div');
    win.document.body.append(host);
    const assistant = createBoardAssistant({
      host,
      getContext: () => ({ scope: 'ws-1:play-1', title: 'Mesh', readOnly: false }),
      onRequest: async () => ({
        kind: 'preview',
        message: 'Updated X route to Post.',
        summary: 'Updated X route to Post.',
        changes: ['X route → Post'],
        isVisible: () => true,
        apply: async () => ({ message: 'Applied' }),
        discard: () => { comparing = false; },
        rehearse: () => { comparing = false; rehearsed++; },
        compare: () => { comparing = !comparing; return comparing; },
        isComparing: () => comparing,
      }),
    });

    const q = selector => win.document.querySelector(selector);
    const type = (selector, value) => {
      q(selector).value = value;
      q(selector).dispatchEvent(new win.Event('input', { bubbles: true }));
    };
    q('[data-ba="open"]').click();
    q('[data-ba="settings"]').click();
    type('[data-ba-key]', 'test-key');
    q('[data-ba="done"]').click();
    type('[data-ba-prompt]', 'Change X to Post');
    q('[data-ba="send"]').click();
    await new Promise(resolve => setTimeout(resolve, 25));

    const compareBtn = q('[data-ba="compare"]');
    assert.ok(compareBtn, 'compare button renders alongside preview actions');
    assert.equal(compareBtn.getAttribute('aria-pressed'), 'false');

    compareBtn.click();
    const activeBtn = q('[data-ba="compare"]');
    assert.equal(comparing, true);
    assert.equal(activeBtn.getAttribute('aria-pressed'), 'true');

    q('[data-ba="rehearse"]').click();
    assert.equal(rehearsed, 1);
    assert.equal(comparing, false);
    assert.equal(q('[data-ba="compare"]').getAttribute('aria-pressed'), 'false');

    assistant.destroy();
  } finally {
    await win.happyDOM.abort();
    for (const name of names) {
      if (old[name]) Object.defineProperty(globalThis, name, old[name]);
      else delete globalThis[name];
    }
  }
});

test('P2.3 desktop play preview popover honors hover intent, skips active/mobile cards, and dismisses cleanly', async () => {
  const workspace = starterWorkspace();
  const [playA, playB, playC] = workspace.plays;

  const setupWindow = ({ width = 1440, fine = true } = {}) => {
    const win = new Window({ url: 'https://playbook.test/editor/index.html', width, height: 900 });
    win.matchMedia = query => ({ matches: fine && query.includes('hover: hover') });
    win.document.body.innerHTML = `<aside class="sidebar"><div class="play-list">
      <button class="play-card active" data-action="choose:${playA.id}"><strong>${playA.title}</strong></button>
      <button class="play-card" data-action="choose:${playB.id}"><strong>${playB.title}</strong></button>
      <button class="play-card" data-action="choose:${playC.id}"><strong>${playC.title}</strong></button>
    </div></aside>`;
    return win;
  };

  // Desktop fine-pointer flow
  const desktop = setupWindow({ width: 1440, fine: true });
  try {
    const popover = createPlayPreviewPopover({
      win: desktop,
      delay: 15,
      getPlay: id => workspace.plays.find(p => p.id === id),
      formatMeta: play => ({ badge: '11 人制', stats: `${play.formation} · ${play.routes.length} 路线` }),
    });
    const list = desktop.document.querySelector('.play-list');
    popover.mount(list);

    const cardA = list.querySelector(`[data-action="choose:${playA.id}"]`);
    const cardB = list.querySelector(`[data-action="choose:${playB.id}"]`);
    const cardC = list.querySelector(`[data-action="choose:${playC.id}"]`);

    // Hovering active play never shows popover
    cardA.dispatchEvent(new desktop.Event('pointerover', { bubbles: true }));
    await new Promise(resolve => setTimeout(resolve, 35));
    assert.equal(desktop.document.querySelector('.play-preview-popover'), null);

    // Hovering inactive playB shows popover after hover intent delay
    cardB.dispatchEvent(new desktop.Event('pointerover', { bubbles: true }));
    assert.equal(desktop.document.querySelector('.play-preview-popover'), null, 'waits for hover intent delay');
    await new Promise(resolve => setTimeout(resolve, 35));
    const el = desktop.document.querySelector('.play-preview-popover');
    assert.ok(el && el.hidden === false && el.classList.contains('is-visible'));
    assert.ok(el.querySelector('svg'), 'renders crisp tactical SVG');
    assert.ok(el.textContent.includes(playB.title));

    // Moving straight to cardC switches immediately while popover is open
    cardC.dispatchEvent(new desktop.Event('pointerover', { bubbles: true }));
    assert.ok(el.textContent.includes(playC.title));

    // Escape dismisses immediately
    desktop.document.dispatchEvent(new desktop.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    assert.equal(el.hidden, true);

    popover.destroy();
  } finally {
    await desktop.happyDOM.abort();
  }

  // Touch / compact viewport never shows hover popover
  const mobile = setupWindow({ width: 390, fine: false });
  try {
    const popover = createPlayPreviewPopover({
      win: mobile,
      delay: 10,
      getPlay: id => workspace.plays.find(p => p.id === id),
    });
    const list = mobile.document.querySelector('.play-list');
    popover.mount(list);
    list.querySelector(`[data-action="choose:${playB.id}"]`).dispatchEvent(new mobile.Event('pointerover', { bubbles: true }));
    await new Promise(resolve => setTimeout(resolve, 25));
    assert.equal(mobile.document.querySelector('.play-preview-popover'), null);
    popover.destroy();
  } finally {
    await mobile.happyDOM.abort();
  }
});
