import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Window } from 'happy-dom';
import { starterWorkspace } from '../web/model.js';
import { orientDefense } from '../web/matchup-model.js';
import { authorizedKnowledgePack } from '../web/analysis-evidence.js';
import { buildMatchup } from '../server/matchup.mjs';
import { runMatchupAgent } from '../server/matchup-agent.mjs';

// Happy DOM's media-list matcher incorrectly treats comma-separated queries as
// a single query. Resolve each media branch independently, then test the actual
// shipped declarations and cascade. This checks CSS contracts, not pixel layout.
function activeStyles(window, rules) {
  return [...rules].map(rule => {
    if (rule.type === 1) return rule.cssText;
    if (rule.type === 4 && rule.conditionText.split(',').some(query => window.matchMedia(query.trim()).matches)) return activeStyles(window, rule.cssRules);
    return '';
  }).join('\n');
}

test('phone and portrait tablet retain knowledge placement, readable inputs and touch targets after the mobile merge', async () => {
  const html = readFileSync(new URL('../web/index.html', import.meta.url), 'utf8');
  const styles = [...html.matchAll(/<link\s+rel="stylesheet"\s+href="\.\/([^"]+)"/g)].map(match => readFileSync(new URL('../web/' + match[1], import.meta.url), 'utf8')).join('\n');
  for (const width of [390, 834, 1440]) {
    const window = new Window({ width, height: 1000 });
    try {
      window.document.documentElement.dataset.visualMode = 'traditional';
      const sheet = window.document.createElement('style'); sheet.textContent = styles; window.document.head.append(sheet);
      sheet.textContent = activeStyles(window, sheet.sheet.cssRules);
      window.document.body.innerHTML = '<main class="ai-page"><div class="ai-layout"><section class="ai-knowledge"><label class="ai-knowledge-search"><input></label><label class="ai-field"><select><option>Cover 2 Read</option></select></label><button class="ai-export-button">Export</button><div class="ai-library-source"><button>Remove</button></div><div class="ai-evidence"><button>Evidence</button></div></section></div></main>';
      const style = selector => window.getComputedStyle(window.document.querySelector(selector));
      assert.equal(style('.ai-knowledge').gridArea, 'knowledge');
      const areas = style('.ai-layout').gridTemplateAreas;
      assert.ok(areas.includes('knowledge'), `Knowledge section has no grid area at ${width}px`);
      if (width <= 900) {
        assert.equal(areas, "'board' 'setup' 'knowledge' 'results'");
        for (const control of ['.ai-knowledge-search input', '.ai-field select']) assert.ok(parseFloat(style(control).fontSize) >= 16, `${control} is unreadable at ${width}px`);
        for (const control of ['.ai-knowledge-search input', '.ai-export-button', '.ai-library-source button', '.ai-evidence button']) assert.ok(parseFloat(style(control).minHeight) >= 44, `${control} has a small touch target at ${width}px`);
      } else assert.ok(areas.includes('setup board results'));
    } finally { await window.happyDOM.abort(); }
  }
});

test('the editor dark theme cannot turn essential analysis reading text pale on light surfaces', async () => {
  const html = readFileSync(new URL('../web/index.html', import.meta.url), 'utf8');
  const styles = [...html.matchAll(/<link\s+rel="stylesheet"\s+href="\.\/([^"]+)"/g)].map(match => readFileSync(new URL('../web/' + match[1], import.meta.url), 'utf8')).join('\n');
  const luminance = css => {
    const hex = /^#([a-f0-9]{3}|[a-f0-9]{6})$/i.exec(css);
    const channels = hex ? (hex[1].length === 3 ? [...hex[1]].map(value => value + value) : hex[1].match(/../g)).map(value => Number.parseInt(value, 16)) : css.match(/[\d.]+/g)?.slice(0, 3).map(Number);
    assert.equal(channels?.length, 3, 'Expected resolved RGB colour: ' + css);
    const linear = channels.map(channel => { const srgb = channel / 255; return srgb <= 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4; });
    return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
  };
  for (const mode of ['traditional', 'digital']) {
    const window = new Window({ width: 1440, height: 1000 });
    try {
      window.document.documentElement.dataset.visualMode = mode;
      const sheet = window.document.createElement('style'); sheet.textContent = styles; window.document.head.append(sheet);
      sheet.textContent = activeStyles(window, sheet.sheet.cssRules);
      window.document.body.innerHTML = '<div id="ai-matchup-root"><main class="ai-page"><header class="ai-page-header"><h1>Read the matchup</h1></header><section class="ai-panel ai-setup"><label class="ai-field"><span>Defensive coverage</span><input value="Cover 2 Read"></label></section><section class="ai-result-card"><div class="ai-result-title"><h2>Conditional scenarios</h2></div><div class="ai-scenario"><div class="ai-scenario-grid"><p>Read the flat defender under the selected assumption.</p></div></div></section></main></div>';
      for (const selector of ['.ai-page-header h1', '.ai-field>span', '.ai-result-title h2', '.ai-scenario-grid p']) {
        const node = window.document.querySelector(selector), foreground = luminance(window.getComputedStyle(node).color);
        let surface = node, background;
        while (surface) {
          const value = window.getComputedStyle(surface).backgroundColor;
          if (value && value !== 'rgba(0, 0, 0, 0)' && value !== 'transparent') { background = luminance(value); break; }
          surface = surface.parentElement;
        }
        background ??= 1;
        const ratio = (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05);
        assert.ok(ratio >= 4.5, `${mode} theme makes ${selector} unreadable (${ratio.toFixed(2)}:1)`);
      }
    } finally { await window.happyDOM.abort(); }
  }
});

test('knowledge request budget is measured in UTF-8 bytes for real Chinese passages', () => {
  const raw = { format: 'playbook-studio-knowledge', version: 1, sources: [{ id: 'team:qa', title: '球队安装笔记' }], cards: Array.from({ length: 4 }, (_, index) => ({ id: 'q' + index, sourceId: 'team:qa', title: '阅读提示', content: '防守'.repeat(1500) })) };
  assert.ok(raw.cards.length <= 6);
  assert.ok(raw.cards.every(card => card.content.length <= 4000));
  assert.throws(() => authorizedKnowledgePack(raw), /32 KB/);
});

test('explicitly mirrored input and presentation mirroring produce the same evidence without mutating a saved play', () => {
  const workspace = starterWorkspace(), offense = workspace.plays.find(play => play.book === 'offense'), defense = workspace.plays.find(play => play.book === 'defense');
  const before = JSON.stringify({ offense, defense });
  const presentation = buildMatchup(offense, defense, { mirrorDefense: true, coverage: 'cover3_spot' });
  const explicit = buildMatchup(offense, orientDefense(defense, true), { coverage: 'cover3_spot' });
  assert.deepEqual(presentation.intersections, explicit.intersections);
  assert.deepEqual(presentation.defense, explicit.defense);
  assert.deepEqual(presentation.facts.counts, explicit.facts.counts);
  assert.equal(JSON.stringify({ offense, defense }), before);
});

test('a plausible model report citing only coaching knowledge remains limited without diagram grounding', async t => {
  const workspace = starterWorkspace(), matchup = buildMatchup(workspace.plays.find(play => play.book === 'offense'), workspace.plays.find(play => play.book === 'defense'), { coverage: 'cover3_spot', knowledgeQuery: 'Hank curl flat' });
  const knowledgeId = matchup.knowledge.find(card => card.coverages.includes('cover3_spot')).evidenceId;
  const previous = globalThis.fetch; t.after(() => { globalThis.fetch = previous; });
  let count = 0;
  globalThis.fetch = async () => new Response(JSON.stringify({ choices: [{ message: ++count === 1 ? { content: null, tool_calls: [{ id: 'qa_context', type: 'function', function: { name: 'get_matchup_context', arguments: '{}' } }] } : { content: JSON.stringify({ summary: 'Conditional coaching principle', scenarios: [1, 2].map(index => ({ title: `Read ${index}`, condition: 'If the flat defender widens', observation: 'Watch the flat defender', possibility: 'An inside window may develop', action: 'Confirm the actual install', limitations: 'Timing and individual assignments are unknown', evidenceIds: [knowledgeId] })), missingInfo: [] }) } }] }), { headers: { 'Content-Type': 'application/json' } });
  const result = await runMatchupAgent(matchup, { model: { provider: 'deepseek', model: 'qa-synthetic', apiKey: 'qa-fake-key' } }, {}, new AbortController().signal);
  assert.equal(count, 2);
  assert.equal(result.status, 'limited');
  assert.equal(result.grounding.entailmentVerified, false);
  assert.ok(result.scenarios.every(scenario => scenario.grounding.diagramReferences === 0 && scenario.grounding.principleReferences === 1));
});
