import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Window } from 'happy-dom';
import { starterWorkspace } from '../web/model.js';
import { createFilmModel } from '../web/coach-film-model.js';
import { createFilmField } from '../web/coach-film-field.js';
import { createMatchupView } from '../web/ai-matchup.js';

async function withLandingWindow({ reduced = false } = {}, fn) {
  const win = new Window({ url: 'https://playbook.test/landing.html' });
  win.matchMedia = query => ({ matches: reduced && query.includes('prefers-reduced-motion') });
  win.document.write(await readFile(new URL('../web/landing.html', import.meta.url), 'utf8'));
  const names = ['window', 'document', 'location', 'localStorage'];
  const old = Object.fromEntries(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  for (const name of names) Object.defineProperty(globalThis, name, { configurable: true, value: win[name] });
  try {
    return await fn(win);
  } finally {
    await win.happyDOM.abort();
    for (const name of names) {
      if (old[name]) Object.defineProperty(globalThis, name, old[name]);
      else delete globalThis[name];
    }
  }
}

test('P0 landing scrollytelling switches live SVG stages and honors reduced-motion', async () => {
  await withLandingWindow({ reduced: false }, async win => {
    const { initLandingMotion } = await import(`../web/landing-motion.js?full=${Date.now()}`);
    const controller = initLandingMotion(win.document);
    try {
      assert.ok(win.document.documentElement.classList.contains('landing-motion-ready'));
      const stage = win.document.querySelector('.story-stage-wrap');
      assert.equal(stage.dataset.stage, 'formation');
      assert.ok(win.document.querySelector('#story-stage-canvas svg'), 'live SVG board renders on step 0');

      win.document.querySelector('[data-story-step="3"]').click();
      assert.equal(stage.dataset.stage, 'matchup');
      assert.equal(win.document.querySelector('#story-ai-callout').hidden, false);
      assert.equal(win.document.querySelector('#story-team-bar').hidden, true);

      win.document.querySelector('[data-story-step="4"]').click();
      assert.equal(stage.dataset.stage, 'team');
      assert.equal(win.document.querySelector('#story-ai-callout').hidden, true);
      assert.equal(win.document.querySelector('#story-team-bar').hidden, false);

      Object.defineProperty(win, 'scrollY', { configurable: true, value: 80 });
      win.dispatchEvent(new win.Event('scroll'));
      assert.ok(win.document.querySelector('.entry-header').classList.contains('is-scrolled'));
    } finally {
      controller.destroy();
    }
  });

  await withLandingWindow({ reduced: true }, async win => {
    let rafCalls = 0;
    win.requestAnimationFrame = () => { rafCalls++; return 1; };
    const { initLandingMotion } = await import(`../web/landing-motion.js?reduced=${Date.now()}`);
    const controller = initLandingMotion(win.document);
    try {
      assert.equal(win.document.documentElement.classList.contains('landing-motion-ready'), false);
      const revealed = [...win.document.querySelectorAll('[data-reveal]')];
      assert.ok(revealed.length > 0 && revealed.every(node => node.classList.contains('is-revealed')));
      win.document.querySelector('[data-story-step="2"]').click();
      assert.equal(win.document.querySelector('#story-clock').textContent, '1.6s');
      assert.equal(rafCalls, 0, 'reduced motion freezes rehearsal on key frame without RAF loop');
    } finally {
      controller.destroy();
    }
  });
});

test('P1.1 Coach Film Room applies curtain-wipe reveal when unmasking routes and skips it under reducedMotion', async () => {
  const win = new Window();
  const host = win.document.createElement('div');
  win.document.body.append(host);
  const play = starterWorkspace().plays[0];
  const model = createFilmModel(play);
  const frame = model.frameAt(1.2, []);

  try {
    const field = createFilmField(host, { model, reducedMotion: false });
    field.render(frame, [], null, true);
    const plan = host.querySelector('[data-film-plan]');
    const rect = host.querySelector('.film-reveal-rect');
    assert.equal(plan.getAttribute('display'), 'none');
    assert.equal(rect.classList.contains('is-revealing'), false);

    field.render(frame, [], null, false);
    assert.equal(plan.getAttribute('display'), 'inline');
    assert.ok(plan.getAttribute('clip-path')?.startsWith('url(#'));
    assert.equal(rect.classList.contains('is-revealing'), true);

    field.setReducedMotion(true);
    assert.equal(plan.getAttribute('clip-path'), null);
    assert.equal(rect.classList.contains('is-revealing'), false);
    field.destroy();

    const reducedField = createFilmField(host, { model, reducedMotion: true });
    reducedField.render(frame, [], null, true);
    reducedField.render(frame, [], null, false);
    assert.equal(host.querySelector('[data-film-plan]').getAttribute('display'), 'inline');
    assert.equal(host.querySelector('[data-film-plan]').getAttribute('clip-path'), null);
    reducedField.destroy();
  } finally {
    await win.happyDOM.abort();
  }
});

test('P1.2 AI Matchup supports hover preview and click-toggle pinning on evidence pills', async () => {
  const win = new Window({ url: 'https://playbook.test/editor/index.html' });
  const root = win.document.createElement('div');
  win.document.body.append(root);
  const names = ['window', 'document', 'localStorage'];
  const old = Object.fromEntries(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  for (const name of names) Object.defineProperty(globalThis, name, { configurable: true, value: win[name] });

  try {
    const data = starterWorkspace();
    const offPlay = data.plays[0];
    const firstOffPlayer = offPlay.players.find(p => p.side === 'offense');
    const secondOffPlayer = offPlay.players.filter(p => p.side === 'offense')[1];
    const focusA = `offense:player:${firstOffPlayer.id}`;
    const focusB = `offense:player:${secondOffPlayer.id}`;

    const view = createMatchupView({
      root,
      getCurrent: () => ({ id: 'ws-1', title: 'Team Book', revision: 1, role: 'owner' }),
      getData: () => data,
      isDirty: () => false,
      request: async () => ({
        status: 'ok',
        summary: 'Mesh stresses Cover 3 underneath.',
        scenarios: [{
          title: 'Shallow cross',
          condition: 'LB widens',
          observation: 'Middle opens',
          possibility: 'Hit shallow crosser',
          evidenceIds: [focusA, focusB],
        }],
        evidence: [
          { id: focusA, label: firstOffPlayer.label },
          { id: focusB, label: secondOffPlayer.label },
        ],
      }),
    });

    view.show(true);
    root.querySelector('[data-ai-field="model"]').value = 'deepseek-chat';
    root.querySelector('[data-ai-field="model"]').dispatchEvent(new win.Event('input', { bubbles: true }));
    root.querySelector('[data-ai-field="apiKey"]').value = 'sk-test-key';
    root.querySelector('[data-ai-field="apiKey"]').dispatchEvent(new win.Event('input', { bubbles: true }));
    root.querySelector('[data-ai-action="analyze"]').click();
    await new Promise(resolve => setTimeout(resolve, 20));

    const pillA = root.querySelector(`[data-ai-focus="${focusA}"]`);
    const nodeA = root.querySelector(`.ai-board [data-player="${focusA}"]`);
    const nodeB = root.querySelector(`.ai-board [data-player="${focusB}"]`);
    assert.ok(pillA && nodeA && nodeB);

    // Hover previews single pill without pinning
    pillA.dispatchEvent(new win.Event('pointerover', { bubbles: true }));
    assert.equal(nodeA.classList.contains('ai-evidence-active'), true);
    assert.equal(nodeB.classList.contains('ai-evidence-active'), false);
    assert.equal(pillA.classList.contains('is-focus-active'), true);

    pillA.dispatchEvent(new win.Event('pointerout', { bubbles: true }));
    assert.equal(nodeB.classList.contains('ai-evidence-active'), true, 'restores scenario evidence set on leave');

    // Click pins, second click unpins
    pillA.click();
    assert.equal(nodeA.classList.contains('ai-evidence-active'), true);
    assert.equal(nodeB.classList.contains('ai-evidence-active'), false);
    pillA.click();
    assert.equal(nodeB.classList.contains('ai-evidence-active'), true);

    view.destroy();
  } finally {
    await win.happyDOM.abort();
    for (const name of names) {
      if (old[name]) Object.defineProperty(globalThis, name, old[name]);
      else delete globalThis[name];
    }
  }
});
