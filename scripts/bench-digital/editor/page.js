import { starterWorkspace, encodeWorkspace, STORAGE_KEY } from './model.js';
import { VISUAL_MODE_KEY } from './visual-mode.js';
import { ONBOARDING_STORAGE_KEY } from './onboarding.js';
import { stepClock, mountMeter, measureEditor } from './bench-sample.js';

const query = new URLSearchParams(location.search);
const step = query.get('clock') === 'step' ? stepClock(window) : null;
const meter = globalThis.__editorBench = mountMeter(window);
// Compare the fallback consistently, even on machines with a working GPU.
const getContext = HTMLCanvasElement.prototype.getContext;
HTMLCanvasElement.prototype.getContext = function (kind, ...args) {
  return ['webgl', 'experimental-webgl', 'webgl2'].includes(kind) ? null : getContext.call(this, kind, ...args);
};
const panel = document.createElement('details');
panel.open = true;
panel.style.cssText = 'position:fixed;right:4px;top:4px;width:min(400px,45vw);max-height:55vh;overflow:auto;background:#fff;color:#111;font:12px monospace;padding:6px;z-index:2147483647';
panel.innerHTML = '<summary>完整编辑器时间轴验收</summary><button disabled>运行测量</button><pre style="white-space:pre-wrap">正在启动</pre><details><summary>逐次测量数据</summary><pre class="raw" style="white-space:pre-wrap"></pre></details>';
document.body.append(panel);
const btn = panel.querySelector('button'), out = panel.querySelector('pre');
const json = name => fetch(name, { cache: 'no-store' }).then(r => r.json());
try {
  const [manifest, { play }] = await Promise.all([json('./snapshot.json'), json('./bench-mesh.json')]);
  const workspace = starterWorkspace();
  workspace.plays = [play];
  localStorage.setItem(STORAGE_KEY, encodeWorkspace(workspace));
  localStorage.setItem(VISUAL_MODE_KEY, 'digital');
  localStorage.setItem(ONBOARDING_STORAGE_KEY, JSON.stringify({ dismissed: true, completed: [] }));
  await import('./app.js');
  const $ = name => document.querySelector(name);
  async function ready(selector) {
    for (let i = 0; i < 200 && !$(selector); i++) { step?.(); await new Promise(resolve => setTimeout(resolve, 40)); }
    if (!$(selector)) throw Error('Editor did not mount ' + selector);
  }
  await ready('#timeline');
  $('[data-action="rehearse-mode"]').click();
  await ready('.digital-fallback-ready');
  if (document.fonts) await document.fonts.ready;
  const bounds = $('.pitch-stage').getBoundingClientRect();
  const context = { stageSize: [bounds.width, bounds.height], devicePixelRatio, svgViewBox: $('.pitch-svg').getAttribute('viewBox'), ...manifest, clock: step ? 'stepped' : 'native-rAF', scene: play.title, players: play.players.length,
    renderer: 'vector', effects: document.documentElement.dataset.effects, viewport: [innerWidth, innerHeight], userAgent: navigator.userAgent };
  out.textContent = JSON.stringify(context, null, 1);
  btn.disabled = false;
  btn.onclick = async () => {
    btn.disabled = true;
    try {
      const result = await measureEditor({ win: window, meter, step, rounds: 3, samples: query.has('quick') ? 6 : 16,
        onProgress: text => { out.textContent = text; } });
      const { raw, ...summary } = result;
      out.textContent = JSON.stringify({ context, ...summary }, null, 1);
      panel.querySelector('.raw').textContent = JSON.stringify(raw);
      window.editorBenchResult = { context, ...result };
    } catch (error) { out.textContent = 'ERROR ' + error.stack; }
    finally { btn.disabled = false; }
  };
  if (query.has('run')) btn.click();
} catch (error) { out.textContent = 'ERROR ' + error.stack; }
