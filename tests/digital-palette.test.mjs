import assert from 'node:assert/strict';
import test from 'node:test';
import { Window } from 'happy-dom';
import sharp from 'sharp';
import { fieldSVG } from '../web/field.js';
import { pngFrameSVG } from '../web/digital-export.js';
import { puckPalette } from '../web/digital-puck.js';
import { starterWorkspace } from '../web/model.js';

// Four sRGB levels of green dominance catches the former pale green and
// forest washes without counting neutral antialiasing as a green surface.
async function measureSurface(svg) {
  const { data } = await sharp(Buffer.from(svg)).resize(250, 200).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let green = 0, opaque = 0, channelSum = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 240) continue;
    opaque++;
    channelSum += data[i] + data[i + 1] + data[i + 2];
    if (data[i + 1] >= Math.max(data[i], data[i + 2]) + 4) green++;
  }
  assert.ok(opaque >= 49000, 'the full board was painted');
  return { greenFraction: green / opaque, meanChannel: channelSum / (opaque * 3) };
}

test('both digital fields, compatibility PNGs and card thumbnails have no large green wash', async t => {
  const win = new Window();
  t.after(() => win.happyDOM.abort());
  const play = starterWorkspace().plays[0];
  for (const fieldTheme of ['dark', 'light']) {
    const settings = { visualMode: 'digital', fieldTheme };
    const samples = {
      field: fieldSVG(play, settings),
      png: pngFrameSVG(win.document, play, {settings, time:2.15, rehearsal:true, animated:true}),
      thumbnail: fieldSVG(play, settings, {thumbnail:true})
    };
    for (const [name, svg] of Object.entries(samples)) {
      const { greenFraction, meanChannel } = await measureSurface(svg);
      assert.ok(greenFraction < .03, `${fieldTheme} ${name}: ${(greenFraction * 100).toFixed(1)}% green pixels`);
      assert.ok(fieldTheme === 'light' ? meanChannel > 170 : meanChannel < 100, `${name} paints the requested ${fieldTheme} theme`);
    }
  }
});

test('custom green play markings and team bands survive both themes and the compatibility PNG', async t => {
  const win = new Window(), doc = win.document;
  t.after(() => win.happyDOM.abort());
  const play = starterWorkspace().plays[0];
  const color = '#13a75c', route = play.routes[0], player = play.players.find(p => p.id === route.playerId);
  player.color = route.color = color;
  assert.equal(puckPalette(player).band, color);
  for (const fieldTheme of ['dark', 'light']) {
    const settings = {visualMode:'digital', fieldTheme};
    for (const xml of [fieldSVG(play, settings), pngFrameSVG(doc, play, {settings, time:0, animated:false})]) {
      doc.body.innerHTML = xml;
      assert.equal(doc.querySelector(`[data-route="${route.id}"] .route-stroke`).getAttribute('stroke'), color);
      assert.ok(doc.querySelector(`[data-player="${player.id}"] [fill="${color}"]`));
    }
  }
});
