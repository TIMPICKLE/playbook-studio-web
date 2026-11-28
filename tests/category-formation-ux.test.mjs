import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Window } from 'happy-dom';
import {
  BUILT_IN_FORMATIONS,
  LEAGUE_SIZES,
  TACKLE_UNIT_FORMATIONS,
  categoryOptions,
  defaultCategoryFor,
  defaultPersonnelFor,
  formationGroups,
  formationOptions,
  recommendedFormationForCategory,
} from '../web/game-formats.js';
import { STORAGE_KEY, decodeWorkspace, encodeWorkspace, makePlay, starterWorkspace, validatePlay } from '../web/model.js';
import { prepareEditorActions } from '../web/editor-actions.js';
import { runEditorPlayCommand } from '../web/editor-play-commands.js';

let instance = 0;
async function openEditor({ raw = encodeWorkspace(starterWorkspace()), locale = 'zh-CN' } = {}) {
  const win = new Window({ url: 'http://localhost:3000/', width: 1440, height: 1000 });
  win.document.body.innerHTML = readFileSync(new URL('../web/index.html', import.meta.url), 'utf8').split('<body>')[1].split('</body>')[0];
  if (raw) win.localStorage.setItem(STORAGE_KEY, raw);
  const names = ['window', 'document', 'navigator', 'localStorage', 'location', 'history', 'Image', 'Blob', 'requestAnimationFrame', 'cancelAnimationFrame'];
  const previous = Object.fromEntries(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  for (const name of names) {
    Object.defineProperty(globalThis, name, {
      configurable: true,
      value: ['requestAnimationFrame', 'cancelAnimationFrame'].includes(name) ? win[name].bind(win) : win[name],
    });
  }
  const { setLocale } = await import('../web/i18n.js');
  setLocale(locale);
  await import(`../web/app.js?cat-form-ux=${++instance}`);
  const q = selector => win.document.querySelector(selector);
  const qa = selector => [...win.document.querySelectorAll(selector)];
  const click = action => { const node = q(`[data-action="${action}"]`); assert.ok(node, `Action exists: ${action}`); node.click(); };
  const change = (selector, value) => {
    const node = q(selector);
    assert.ok(node, selector);
    node.value = String(value);
    node.dispatchEvent(new win.Event('change', { bubbles: true }));
  };
  const typeInput = (selector, value) => {
    const node = q(selector);
    assert.ok(node, selector);
    node.value = String(value);
    node.dispatchEvent(new win.Event('input', { bubbles: true }));
    node.dispatchEvent(new win.Event('change', { bubbles: true }));
  };
  const saved = () => decodeWorkspace(win.localStorage.getItem(STORAGE_KEY));
  const current = () => saved().plays.find(play => q('h1').textContent.includes(play.title));
  q('[data-cloud-action="enter-editor"]').click();
  return {
    win, q, qa, click, change, typeInput, saved, current,
    async close() {
      await win.happyDOM.abort();
      for (const name of names) {
        const descriptor = previous[name];
        if (descriptor) Object.defineProperty(globalThis, name, descriptor);
        else delete globalThis[name];
      }
    },
  };
}

test('unit-scoped formations, smart categories, personnel packages and ball holders validate across all league sizes', () => {
  assert.deepEqual(formationOptions('offense', 11), [...TACKLE_UNIT_FORMATIONS.offense]);
  assert.deepEqual(formationOptions('defense', 11), [...TACKLE_UNIT_FORMATIONS.defense]);
  assert.deepEqual(formationOptions('special', 11), [...TACKLE_UNIT_FORMATIONS.special]);
  assert.equal(formationGroups('offense', 11).length, 2);
  assert.equal(formationGroups('defense', 11).length, 2);
  assert.equal(formationGroups('special', 11).length, 1);

  assert.deepEqual(categoryOptions('offense', 'zh-CN'), ['传球', '跑球', 'RPO', '假跑真传']);
  assert.deepEqual(categoryOptions('defense', 'zh-CN'), ['区域防守', '盯人防守', '冲传']);
  assert.deepEqual(categoryOptions('special', 'zh-CN'), ['射门', '弃踢', '开球', '回攻']);
  assert.deepEqual(categoryOptions('offense', 'en'), ['Pass', 'Run', 'RPO', 'Play action']);

  for (const size of LEAGUE_SIZES) {
    for (const book of ['offense', 'defense', 'special']) {
      for (const formation of formationOptions(book, size)) {
        const play = makePlay({ title: `${book}-${formation}-${size}`, formation, book, count: size });
        assert.doesNotThrow(() => validatePlay(play));
        assert.equal(play.players.length, size);
      }
    }
  }

  // Authentic special-teams & offense starting ball holders + categories + personnel
  const punt = makePlay({ title: 'Punt Safe', formation: 'Punt', book: 'special', count: 11 });
  assert.equal(punt.category, '弃踢');
  assert.equal(punt.personnel, 'Punt Unit');
  assert.equal(punt.players.find(p => p.id === punt.ball.holderId)?.label, 'P');

  const kickoff = makePlay({ title: 'Kickoff Deep', formation: 'Kickoff', book: 'special', count: 11 });
  assert.equal(kickoff.category, '开球');
  assert.equal(kickoff.personnel, 'Kickoff Unit');
  assert.equal(kickoff.players.find(p => p.id === kickoff.ball.holderId)?.label, 'K');

  const kickReturn = makePlay({ title: 'Middle Return', formation: 'Kick Return', book: 'special', count: 11 });
  assert.equal(kickReturn.category, '回攻');
  assert.equal(kickReturn.personnel, 'Kick Return Unit');
  assert.equal(kickReturn.players.find(p => p.id === kickReturn.ball.holderId)?.label, 'LR');

  const empty = makePlay({ title: 'Empty Stick', formation: 'Gun Empty', book: 'offense', count: 11 });
  assert.equal(empty.category, '传球');
  assert.equal(empty.personnel, '10 personnel');

  const power = makePlay({ title: 'Power O', formation: 'I Formation', book: 'offense', count: 11 });
  assert.equal(power.category, '跑球');
  assert.equal(power.personnel, '21 personnel');

  const dime = makePlay({ title: 'Dime 2-Man', formation: 'Dime', book: 'defense', count: 11 });
  assert.equal(dime.category, '区域防守');
  assert.equal(dime.personnel, '4–1–6 Dime');
  assert.equal(dime.ball.holderId, '');

  // formation_apply updates auto personnel, while preserving custom coach personnel
  runEditorPlayCommand(empty, { kind: 'formation_apply', formation: 'I Formation', count: 11 });
  assert.equal(empty.personnel, '21 personnel');
  empty.personnel = 'Heavy Jumbo 22';
  runEditorPlayCommand(empty, { kind: 'formation_apply', formation: 'Pistol', count: 11 });
  assert.equal(empty.personnel, 'Heavy Jumbo 22');

  // prepareEditorActions honors explicit category and localized smart defaults
  const base = starterWorkspace();
  const planExplicit = prepareEditorActions(
    { data: base, selectedId: base.plays[0].id, readOnly: false },
    [{ kind: 'play_create', title: 'Goal Line Toss', book: 'offense', formation: 'Gun Trips', count: 11, category: '红区跑球' }],
    { locale: 'zh-CN' },
  );
  assert.equal(planExplicit.data.plays.at(-1).category, '红区跑球');

  const planEnglishRun = prepareEditorActions(
    { data: base, selectedId: base.plays[0].id, readOnly: false },
    [{ kind: 'play_create', title: 'Pistol Read', book: 'offense', formation: 'Pistol', count: 11 }],
    { locale: 'en' },
  );
  assert.equal(planEnglishRun.data.plays.at(-1).category, 'Run');
  assert.equal(planEnglishRun.data.plays.at(-1).personnel, '11 personnel');

  assert.equal(BUILT_IN_FORMATIONS.length >= 19, true);
  assert.equal(defaultCategoryFor('defense', 'Flag 5 Man', 'zh-CN'), '盯人防守');
  assert.equal(defaultPersonnelFor('offense', 'Flag 5 Spread', 5, 'en'), '5v5 Flag');
  assert.equal(recommendedFormationForCategory('offense', 11, 'RPO'), 'Pistol');
});

test('New Play modal bidirectional category-formation linkage, live preview and Inspector category presets', { timeout: 30000 }, async t => {
  const host = await openEditor();
  const { q, qa, click, change, typeInput, current } = host;
  try {
    await t.test('Inspector scopes formations to the play unit and applies 1-click category presets with undo', () => {
      const applyOptions = qa('#apply-formation option').filter(o => o.value.startsWith('builtin:')).map(o => o.value.slice(8));
      assert.deepEqual(applyOptions, [...TACKLE_UNIT_FORMATIONS.offense]);
      assert.match(q('#apply-formation option[value=""]').textContent, /当前阵型/);

      assert.equal(current().category, '传球');
      const runChip = q('.inspector [data-category-preset="跑球"]');
      assert.ok(runChip);
      runChip.click();
      assert.equal(current().category, '跑球');
      assert.equal(q('.inspector [data-category-preset="跑球"]').getAttribute('aria-pressed'), 'true');
      assert.equal(q('.inspector [data-prop="category"]').value, '跑球');

      click('undo');
      assert.equal(current().category, '传球');
      assert.equal(q('.inspector [data-category-preset="传球"]').getAttribute('aria-pressed'), 'true');
    });

    await t.test('clicking a category preset in New Play modal auto-recommends a matching formation and updates live SVG preview', () => {
      click('new');
      assert.ok(q('.new-play-grid'));
      assert.equal(q('#new-category').value, '传球');
      assert.equal(q('#new-formation').value, 'Gun Trips');
      assert.equal(q('#new-formation-preview svg').querySelectorAll('[data-player]').length, 11);

      // Clicking 跑球 before touching formation switches Gun Trips -> Singleback
      q('[data-new-category="跑球"]').click();
      assert.equal(q('#new-category').value, '跑球');
      assert.equal(q('#new-formation').value, 'Singleback');
      assert.equal(q('#new-preview-formation').textContent, 'Singleback');
      assert.equal(q('#new-preview-category').textContent, '跑球');

      // Picking I Formation via visual card updates personnel to 21 personnel and keeps 跑球
      q('[data-new-formation-pick="I Formation"]').click();
      assert.equal(q('#new-formation').value, 'I Formation');
      assert.equal(q('#new-preview-personnel').textContent, '21 personnel');
      assert.equal(q('#new-category').value, '跑球');

      q('#new-title').value = 'Iso Lead';
      click('create-play');
      const created = current();
      assert.equal(created.title, 'Iso Lead');
      assert.equal(created.category, '跑球');
      assert.equal(created.formation, 'I Formation');
      assert.equal(created.personnel, '21 personnel');
    });

    await t.test('picking a run formation first auto-syncs category, while manual overrides are respected in both directions', () => {
      click('new');
      assert.equal(q('#new-category').value, '传球');
      // Touch formation first -> category auto-updates to 跑球
      q('[data-new-formation-pick="Pistol"]').click();
      assert.equal(q('#new-formation').value, 'Pistol');
      assert.equal(q('#new-category').value, '跑球');

      // Now formation is touched: clicking 传球 changes category without clobbering Pistol!
      q('[data-new-category="传球"]').click();
      assert.equal(q('#new-category').value, '传球');
      assert.equal(q('#new-formation').value, 'Pistol');
      click('close-modal');

      // Touch custom category first -> changing formation does NOT clobber custom category
      click('new');
      typeInput('#new-category', '红区两分钟');
      q('[data-new-formation-pick="Gun Empty"]').click();
      assert.equal(q('#new-category').value, '红区两分钟');
      assert.equal(q('#new-formation').value, 'Gun Empty');
      assert.equal(q('#new-preview-personnel').textContent, '10 personnel');
      q('#new-title').value = 'Empty Redzone';
      click('create-play');
      assert.equal(current().category, '红区两分钟');
      assert.equal(current().formation, 'Gun Empty');
      assert.equal(current().personnel, '10 personnel');
    });

    await t.test('switching unit in New Play modal updates category presets, special-teams formations and preview ball holder', () => {
      click('new');
      change('#new-book', 'special');
      assert.deepEqual(qa('#new-category-presets [data-new-category]').map(b => b.dataset.newCategory), ['射门', '弃踢', '开球', '回攻']);
      assert.deepEqual(qa('#new-formation option').map(o => o.value), ['Field Goal', 'Punt', 'Kickoff', 'Kick Return']);

      q('[data-new-category="弃踢"]').click();
      assert.equal(q('#new-formation').value, 'Punt');
      assert.equal(q('#new-preview-personnel').textContent, 'Punt Unit');
      q('#new-title').value = 'Directional Punt';
      click('create-play');
      const created = current();
      assert.equal(created.book, 'special');
      assert.equal(created.category, '弃踢');
      assert.equal(created.formation, 'Punt');
      assert.equal(created.players.find(p => p.id === created.ball.holderId)?.label, 'P');
    });

    await t.test('active sidebar category filter pre-populates New Play modal category and recommended formation', () => {
      click('book:offense');
      change('#category-filter', '跑球');
      click('new');
      assert.equal(q('#new-category').value, '跑球');
      assert.equal(q('#new-formation').value, 'Singleback');
      click('close-modal');
    });
  } finally {
    await host.close();
  }
});
