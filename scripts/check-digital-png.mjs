// node scripts/check-digital-png.mjs [output-directory]
// Exercises the SVG supplied to the platform PNG encoder, using CPU rasterization.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import { Window } from 'happy-dom';
import { starterWorkspace, formationPlayers } from '../web/model.js';
import { pngFrameSVG } from '../web/digital-export.js';

const output = process.argv[2];
if (output) await mkdir(output, { recursive: true });
const play = starterWorkspace().plays[0];
play.players.push(...formationPlayers('4–3', 11, 'defense'));
const qb = play.players.find(player => player.id === play.ball.holderId);
const receiver = play.players.find(player => player.id === play.ball.receiverId);
play.routes.push({
  id: 'flight', kind: 'pass', playerId: qb.id, points: [{x: qb.x, y: qb.y}, {x: receiver.x, y: receiver.y}],
  delay: 2, duration: 1, color: '#dddddd', endCap: 'arrow', smooth: false, optional: false,
});

const modes = [
  { visualMode: 'traditional', fieldTheme: 'dark', animated: false },
  { visualMode: 'digital', fieldTheme: 'dark', animated: true },
  { visualMode: 'digital', fieldTheme: 'light', animated: false },
];
const render = xml => sharp(Buffer.from(xml)).resize(2000, 1600).png().toBuffer();
const win = new Window(), doc = win.document;
try {
  const samples = [];
  for (const { visualMode, fieldTheme, animated } of modes) {
    const settings = { visualMode, fieldTheme };
    for (const [state, time] of [['snap', 0], ['release', 2.15], ['catch', 3.15]]) {
      const xml = pngFrameSVG(doc, play, { settings, time, animated, rehearsal: true });
      doc.body.innerHTML = xml;
      const root = doc.querySelector('svg'), ball = root.querySelector('#export-ball');
      assert.equal(root.querySelectorAll('[data-player]').length, 22);
      assert.equal(root.querySelectorAll('.route-stroke').length, 11);
      if (visualMode === 'digital') assert.equal(root.querySelector('[data-ball-cue]')?.dataset.ballCue, state);

      const png = await render(xml), meta = await sharp(png).metadata();
      assert.equal(meta.width, 2000);
      assert.equal(meta.height, 1600);
      const [, x, y] = ball.getAttribute('transform').match(/translate\(([\d.]+) ([\d.]+)\)/);
      const crop = {left: Math.round(2 * Number(x)) - 28, top: Math.round(2 * Number(y)) - 28, width: 56, height: 56};
      const pixels = image => sharp(image).extract(crop).removeAlpha().raw().toBuffer();
      // Identical frames with and without the football must differ at its expected location.
      ball.remove();
      const withBall = await pixels(png), withoutBall = await pixels(await render(root.outerHTML));
      let changed = 0;
      for (let i = 0; i < withBall.length; i += 3) {
        if ([0, 1, 2].some(channel => Math.abs(withBall[i + channel] - withoutBall[i + channel]) > 20)) changed++;
      }
      assert.ok(changed > 75, `Football missing at ${state} in ${visualMode}/${fieldTheme}`);
      samples.push({ visualMode, fieldTheme, state, time, width: meta.width, height: meta.height, changedBallPixels: changed });
      if (output) await writeFile(join(output, `${visualMode}-${fieldTheme}-${state}.png`), png);
    }
  }
  console.table(samples);
} finally {
  await win.happyDOM.abort();
}
