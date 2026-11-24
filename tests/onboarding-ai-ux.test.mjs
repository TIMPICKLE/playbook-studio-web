import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Window } from 'happy-dom';
import { createBoardAssistant } from '../web/board-assistant.js';
import { createMatchupView } from '../web/ai-matchup.js';
import { clearModelCredential } from '../web/model-connection.js';
import { getLocale, setLocale } from '../web/i18n.js';
import { STORAGE_KEY, encodeWorkspace, starterWorkspace } from '../web/model.js';
import zhAssistant from '../web/locales/board-assistant.zh-CN.js';
import enAssistant from '../web/locales/board-assistant.en.js';

function withGlobals(win, names, run) {
  const previous = Object.fromEntries(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  for (const name of names) {
    Object.defineProperty(globalThis, name, {
      configurable: true,
      value: name === 'window' ? win : ['getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame'].includes(name) ? win[name].bind(win) : win[name],
    });
  }
  const prevLocale = getLocale();
  return Promise.resolve().then(run).finally(() => {
    try { setLocale(prevLocale); } catch { /* restore locale when storage is active */ }
    for (const [name, descriptor] of Object.entries(previous)) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  });
}

test('board-assistant zh-CN and en locale bundles have identical top-level keys', () => {
  assert.deepEqual(Object.keys(zhAssistant).sort(), Object.keys(enAssistant).sort());
  for (const nested of ['turnStates', 'runStates', 'toolProgress']) {
    assert.deepEqual(Object.keys(zhAssistant[nested]).sort(), Object.keys(enAssistant[nested]).sort());
  }
});

test('ready banner reflects unconfigured, user API key, and serverConfigured states', async () => {
  const win = new Window({ url: 'https://playbook.test/local.html' });
  const host = win.document.createElement('div');
  win.document.body.append(host);
  const context = { scope: 'book/a', title: 'Mesh', readOnly: false, serverConfigured: false };
  await withGlobals(win, ['localStorage'], async () => {
    setLocale('zh-CN');
    clearModelCredential();
    const assistant = createBoardAssistant({ host, getContext: () => context, onRequest: async () => ({ kind: 'answer', message: 'ok' }) });
    const q = selector => win.document.querySelector(selector);
    const input = (selector, value) => {
      const node = q(selector);
      node.value = value;
      node.dispatchEvent(new win.Event(node.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
    };
    try {
      assistant.open();
      const banner = q('.ba-ready-banner');
      const statusText = q('[data-ba-ready-text]');
      const actionBtn = q('[data-ba-ready-btn]');
      assert.ok(banner, '.ba-ready-banner should exist');
      assert.equal(banner.dataset.state, 'setup');
      assert.equal(statusText.textContent, zhAssistant.readyUnconfigured);
      assert.equal(actionBtn.textContent, zhAssistant.configureAction);
      assert.equal(assistant.isServerConfigured(), false);

      // Clicking banner action opens model config
      actionBtn.click();
      assert.equal(q('.ba-config').hidden, false);

      // Entering an API key flips banner to ready with provider + model info
      input('[data-ba-key]', 'sk-test-ready-key');
      assert.equal(banner.dataset.state, 'ready');
      assert.match(statusText.textContent, /模型已就绪.*OpenAI.*gpt-6\.1-terra/);
      assert.equal(actionBtn.textContent, zhAssistant.editConfigAction);

      // Clearing key drops back to setup; serverConfigured flips to ready with readyServer copy
      input('[data-ba-key]', '');
      assert.equal(banner.dataset.state, 'setup');
      assert.equal(statusText.textContent, zhAssistant.readyUnconfigured);

      context.serverConfigured = true;
      assistant.refresh();
      assert.equal(assistant.isServerConfigured(), true);
      assert.equal(banner.dataset.state, 'ready');
      assert.equal(statusText.textContent, zhAssistant.readyServer);
      assert.equal(actionBtn.textContent, zhAssistant.editConfigAction);

      setLocale('en');
      assistant.refresh();
      assert.equal(statusText.textContent, enAssistant.readyServer);
      assert.equal(actionBtn.textContent, enAssistant.editConfigAction);
    } finally {
      clearModelCredential();
      assistant.destroy();
      await win.happyDOM.abort();
    }
  });
});

test('safety strip and model hint render cleanly in zh-CN and en', async () => {
  const win = new Window({ url: 'https://playbook.test/local.html' });
  const host = win.document.createElement('div');
  win.document.body.append(host);
  const context = { scope: 'book/a', title: 'Mesh', readOnly: false };
  await withGlobals(win, ['localStorage'], async () => {
    setLocale('zh-CN');
    clearModelCredential();
    const assistant = createBoardAssistant({ host, getContext: () => context, onRequest: async () => ({ kind: 'answer', message: 'ok' }) });
    const q = selector => win.document.querySelector(selector);
    const items = () => [...win.document.querySelectorAll('.ba-safety-strip li')].map(node => node.textContent);
    try {
      assistant.open();
      assert.deepEqual(items(), [zhAssistant.safetyPreview, zhAssistant.safetyIterate, zhAssistant.safetyUndo]);
      assert.equal(q('.ba-model-hint').textContent, zhAssistant.modelHint);

      setLocale('en');
      assistant.refresh();
      assert.deepEqual(items(), [enAssistant.safetyPreview, enAssistant.safetyIterate, enAssistant.safetyUndo]);
      assert.equal(q('.ba-model-hint').textContent, enAssistant.modelHint);
    } finally {
      assistant.destroy();
      await win.happyDOM.abort();
    }
  });
});

test('route-edit example pill populates prompt in edit mode and is hidden when readOnly', async () => {
  const win = new Window({ url: 'https://playbook.test/local.html' });
  const host = win.document.createElement('div');
  win.document.body.append(host);
  const context = { scope: 'book/a', title: 'Mesh', readOnly: false };
  const requests = [];
  await withGlobals(win, ['localStorage'], async () => {
    setLocale('zh-CN');
    clearModelCredential();
    const assistant = createBoardAssistant({
      host,
      getContext: () => context,
      onRequest: async request => { requests.push(request); return { kind: 'answer', message: 'ok' }; },
    });
    const q = selector => win.document.querySelector(selector);
    try {
      assistant.open();
      const routeEditBtn = q('[data-ba="route-edit"]');
      assert.ok(routeEditBtn, 'route-edit pill should exist');
      assert.equal(routeEditBtn.hidden, false);
      assert.equal(routeEditBtn.textContent, zhAssistant.routeEdit);

      routeEditBtn.click();
      assert.equal(q('[data-ba-prompt]').value, zhAssistant.routeEditExample);
      assert.equal(win.document.activeElement, q('[data-ba-prompt]'));
      assert.equal(q('[data-ba="clear-mode"]').hidden, false);

      // Verify readOnly hides both edit and route-edit pills while keeping search visible
      context.readOnly = true;
      assistant.refresh();
      assert.equal(q('[data-ba="edit"]').hidden, true);
      assert.equal(routeEditBtn.hidden, true);
      assert.equal(q('[data-ba="search"]').hidden, false);
    } finally {
      assistant.destroy();
      await win.happyDOM.abort();
    }
  });
});

test('ai-matchup renders model ID guidance hint below the model input in zh-CN and en', async () => {
  const win = new Window({ url: 'https://playbook.test/editor/', width: 1024, height: 900 });
  win.document.body.innerHTML = '<div id="root"></div>';
  const root = win.document.querySelector('#root');
  const data = starterWorkspace();
  const record = { id: 'book', title: 'Team', revision: 1 };
  await withGlobals(win, ['window', 'document', 'localStorage'], async () => {
    setLocale('zh-CN');
    const view = createMatchupView({
      root, demo: false, getCurrent: () => record, getData: () => data, isDirty: () => false,
      request: async () => ({ status: 'limited', summary: 'ok', scenarios: [], warnings: [], evidence: [] }),
    });
    try {
      view.onData(data, record);
      view.show(true);
      const hintZh = root.querySelector('[data-ai-field="model"] + .ai-model-hint');
      assert.ok(hintZh, '.ai-model-hint should appear directly after model input');
      assert.match(hintZh.textContent, /deepseek-chat.*gpt-4o/);

      setLocale('en');
      view.show(true);
      const hintEn = root.querySelector('[data-ai-field="model"] + .ai-model-hint');
      assert.ok(hintEn);
      assert.match(hintEn.textContent, /active model ID.*deepseek-chat.*gpt-4o/i);
    } finally {
      view.show(false);
      await win.happyDOM.abort();
    }
  });
});

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate, message = 'expected condition') {
  const deadline = Date.now() + 5000;
  while (!predicate() && Date.now() < deadline) await pause(20);
  assert.ok(predicate(), message);
}

test('app renders mobile replay-onboarding inside .play-more-menu and closes AI panel on replay', { timeout: 20000 }, async () => {
  const win = new Window({ url: 'http://localhost:3000/local.html#editor', width: 390, height: 844 });
  win.document.body.innerHTML = readFileSync(new URL('../web/index.html', import.meta.url), 'utf8').split('<body>')[1].split('</body>')[0];
  win.localStorage.setItem(STORAGE_KEY, encodeWorkspace(starterWorkspace()));
  win.localStorage.setItem('playbook-studio:onboarding:v1', JSON.stringify({ dismissed: true, completed: [] }));
  win.HTMLElement.prototype.getBoundingClientRect = function () {
    if (this.classList.contains('inspector-panel')) return { left: 0, top: 0, x: 0, y: 0, width: 0, height: 0, right: 0, bottom: 0 };
    return { left: 24, top: 120, x: 24, y: 120, width: 200, height: 100, right: 224, bottom: 220 };
  };
  const names = [
    'window', 'document', 'navigator', 'localStorage', 'location', 'history', 'Image', 'Blob',
    'HTMLElement', 'SVGElement', 'Node', 'MutationObserver', 'ResizeObserver', 'DOMRect', 'DOMPoint',
    'Element', 'HTMLButtonElement', 'MouseEvent', 'ShadowRoot', 'getComputedStyle',
    'requestAnimationFrame', 'cancelAnimationFrame',
  ];
  await withGlobals(win, names, async () => {
    const q = selector => win.document.querySelector(selector);
    try {
      await import(`../web/app.js?onboarding-ai-ux=${Date.now()}`);
      const replayBtn = q('.play-more-menu .play-more-panel [data-action="replay-onboarding"]');
      assert.ok(replayBtn, 'mobile replay-onboarding button must render inside .play-more-menu');
      assert.ok(replayBtn.textContent.trim().length > 0);

      // Open the AI panel and menu, then trigger mobile replay-onboarding: both menu & AI panel close and tour launches
      q('[data-ba="open"]').click();
      assert.equal(q('.ba-panel').hidden, false);
      const moreMenu = q('.play-more-menu');
      moreMenu.open = true;
      replayBtn.click();
      assert.equal(moreMenu.open, false);
      assert.equal(q('.ba-panel').hidden, true);
      await until(() => q('.onboarding-popover'), 'mobile replay-onboarding starts the onboarding tour');
      q('.driver-popover-close-btn')?.click();
      await until(() => !q('.onboarding-popover'), 'closing popover dismisses the tour');

      // Also verify top-bar replayTour closes an open AI panel and starts the tour instead of showing busy toast
      q('[data-ba="open"]').click();
      assert.equal(q('.ba-panel').hidden, false);
      q('[data-onboarding="replay"]').click();
      assert.equal(q('.ba-panel').hidden, true);
      await until(() => q('.onboarding-popover'), 'top-bar replay closes AI panel and starts tour');
      q('.driver-popover-close-btn')?.click();
      await until(() => !q('.onboarding-popover'), 'closing popover dismisses the replayed tour');
    } finally {
      q('.driver-popover-close-btn')?.click();
      win.dispatchEvent(new win.Event('pagehide'));
      await pause(30);
      await win.happyDOM.abort();
    }
  });
});
