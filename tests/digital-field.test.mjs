import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Window } from 'happy-dom';
import { fieldSVG, project } from '../web/field.js';
import { COLORS, makePlay } from '../web/model.js';

const play = makePlay();
function render(win, settings = {}, options = {}) {
  win.document.body.innerHTML = fieldSVG(play, { visualMode: 'digital', ...settings }, options);
  return win.document.querySelector('svg');
}

function rgb(hex) {
  return hex.slice(1).match(/../g).map(channel => parseInt(channel,16) / 255);
}

function luminance(channels) {
  const linear = channels.map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
  return linear[0] * .2126 + linear[1] * .7152 + linear[2] * .0722;
}

function contrast(foreground, background, opacity = 1) {
  const surface = rgb(background);
  const painted = rgb(foreground).map((value, i) => value * opacity + surface[i] * (1 - opacity));
  const a = luminance(painted), b = luminance(surface);
  return (Math.max(a,b) + .05) / (Math.min(a,b) + .05);
}

test('both enamel themes carry their own paint, grid hierarchy and calibrated scrimmage line into standalone SVG', async () => {
  const win = new Window();
  const themes = [];
  try {
    for (const fieldTheme of ['light', 'dark']) {
      const svg = render(win, { fieldTheme }, { prefix:'export' });
      const plate = svg.querySelector('.yard-lines');
      const paint = plate.querySelector('linearGradient');
      themes.push([...paint.children].map(stop => stop.getAttribute('stop-color')));
      assert.equal(svg.dataset.fieldSurface, 'enamel');
      assert.equal(plate.getAttribute('pointer-events'), 'none');
      assert.equal(plate.querySelector('rect[fill^="url"]').getAttribute('fill'), `url(#${paint.id})`);
      assert.equal(plate.querySelectorAll('[data-field-mark="major"]').length, 4);
      assert.equal(plate.querySelectorAll('[data-field-mark="minor"]').length, 5);
      const [los, major, minor] = ['los', 'major', 'minor'].map(kind => plate.querySelector(`[data-field-mark="${kind}"]`));
      const weight = node => Number(node.getAttribute('stroke-width'));
      assert.ok(weight(los) > weight(major) && weight(major) > weight(minor));
      assert.equal(los.getAttribute('d'), `M18 ${project({x:0,y:67}).y}H982`);
      for (const label of plate.querySelectorAll('text')) {
        for (const color of themes.at(-1)) {
          assert.ok(contrast(label.getAttribute('fill'), color) >= 4.5, `${fieldTheme} ${label.textContent} against ${color}`);
        }
      }
      assert.notEqual(los.getAttribute('stroke'), major.getAttribute('stroke'));
      assert.equal(plate.querySelector('[data-field-mark="hash"]').getAttribute('d').match(/M362 /g).length, 40);
      const serialized = new win.XMLSerializer().serializeToString(svg);
      assert.ok(serialized.includes(themes.at(-1)[0]));
      assert.doesNotMatch(plate.outerHTML, /var\(|currentColor/);
      assert.equal(svg.querySelectorAll('.player-hit').length, play.players.length);
    }
    assert.notDeepEqual(themes[0], themes[1]);
  } finally { await win.happyDOM.abort(); }
});

test('hiding the grid preserves the line of scrimmage, while flat, thumbnail and print retain their existing field', async () => {
  const win = new Window();
  try {
    const selected = {type:'player', id:play.players[0].id};
    const digital = render(win, { showGrid:false }, { selected });
    assert.equal(digital.querySelectorAll('[data-field-mark]').length, 1);
    assert.ok(digital.querySelector('[data-field-mark="los"]'));
    assert.ok(digital.querySelector('.selection-ring').hasAttribute('stroke-dasharray'));
    for (const options of [{ thumbnail:true }, { print:true }]) {
      assert.equal(fieldSVG(play, {visualMode:'digital'}, options), fieldSVG(play, {}, options));
    }
    const flat = render(win, { visualMode:'traditional' }, { selected });
    assert.equal(flat.querySelector('[data-field-mark]'), null);
    assert.equal(flat.querySelector('.selection-ring').hasAttribute('stroke-dasharray'), false);
  } finally { await win.happyDOM.abort(); }
});

test('on both enamel themes optional routes retain their line pattern, default marks remain readable and manual colors survive', async () => {
  const win = new Window();
  try {
    const subject = makePlay();
    const owner = subject.players[0];
    const routes = [
      {id:'defense', color:COLORS.defense, kind:'route'},
      {id:'pass', color:COLORS.pass, kind:'pass'},
      {id:'custom', color:'#c64f87', kind:'route'},
    ];
    subject.routes = routes.map(route => ({
      ...route, optional:true, points:[owner, {x:44,y:25}], playerId:owner.id, endCap:'arrow',
    }));
    subject.zones = [COLORS.zone, '#c64f87'].map((color, i) => ({
      id:'zone-'+i, label:'Z', x:30+i*30, y:30, rx:10, ry:7, color,
    }));
    for (const fieldTheme of ['light','dark']) {
      win.document.body.innerHTML = fieldSVG(subject,{visualMode:'digital',fieldTheme});
      const svg = win.document.querySelector('svg');
      const path = id => svg.querySelector(`[data-route="${id}"] .route-stroke`);
      for (const id of ['defense','pass']) {
        const stroke = path(id);
        for (const stop of svg.querySelectorAll('.yard-lines stop')) {
          const ratio = contrast(stroke.getAttribute('stroke'), stop.getAttribute('stop-color'), Number(stroke.getAttribute('opacity')));
          assert.ok(ratio >= 3, `${fieldTheme} ${id} contrast ${ratio}`);
        }
      }
      assert.equal(path('defense').getAttribute('stroke-dasharray'), '9 6');
      assert.equal(path('pass').getAttribute('stroke-dasharray'), '4 7');
      assert.equal(path('custom').getAttribute('stroke'), '#c64f87');
      assert.equal(path('custom').getAttribute('opacity'), '0.65');
      for (const [index, color] of [fieldTheme === 'light' ? '#235477' : COLORS.zone, '#c64f87'].entries()) {
        const zone = svg.querySelector(`[data-zone="zone-${index}"]`);
        assert.equal(zone.querySelector('ellipse').getAttribute('stroke'), color);
        assert.equal(zone.querySelector('text').getAttribute('fill'), color);
      }
    }
  } finally { await win.happyDOM.abort(); }
});

test('digital rehearsal presents the SVG stroke opacity used by texture and export while the flat view keeps its fade', async () => {
  const css = ['interaction.css','visual-mode.css'].map(file => readFileSync(new URL('../web/' + file,import.meta.url),'utf8')).join('\n');
  for (const [mode, opacity] of [['digital', .96], ['traditional', .35]]) {
    const win = new Window(), doc = win.document;
    try {
      doc.documentElement.dataset.visualMode = mode;
      doc.body.innerHTML = '<div id="field" class="is-rehearsal"><svg><path class="route-stroke" opacity="0.96"/></svg></div>';
      const style = doc.createElement('style');
      style.textContent = css;
      doc.head.append(style);
      const path = doc.querySelector('.route-stroke');
      // happy-dom only resolves CSS declarations for SVG; browsers also expose presentation attributes here.
      const resolved = win.getComputedStyle(path).opacity || path.getAttribute('opacity');
      assert.equal(Number(resolved), opacity);
    } finally { await win.happyDOM.abort(); }
  }
});
