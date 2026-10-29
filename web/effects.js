import { initLiquidMaterials } from './liquid-materials.js';
import { VISUAL_MODE_KEY as KEY, deviceIsTraditional, resolveVisualMode } from './visual-mode.js';
const modes = new Set(['traditional', 'digital']);
let instance, loading, engineReady, generation = 0, initialized = false, sessionMode, startQueue = Promise.resolve();
const mq = query => window.matchMedia?.(query);
export function preference() {
  if (sessionMode) return sessionMode;
  try { const value = localStorage.getItem(KEY); return modes.has(value) ? value : 'traditional'; } catch { return 'traditional'; }
}
export function visualMode() { return resolveVisualMode(preference(), deviceIsTraditional()); }
export function effectiveMode(value = visualMode(), reduced = !!mq('(prefers-reduced-motion: reduce)')?.matches) {
  return value === 'digital' && !reduced && !deviceIsTraditional() ? 'full' : 'off';
}
function modeNote() {
  if (deviceIsTraditional()) return '手机和 iPad 固定使用传统模式，战术演练仍可正常播放。';
  if (visualMode() === 'digital' && effectiveMode() === 'off') return '已跟随系统减少动态效果；保留立体材质和战术演练。';
  return '只影响这台设备，不修改共享战术。';
}
export function effectsControl() {
  const selected = visualMode(), restricted = deviceIsTraditional();
  return `<details class="effects-menu"><summary aria-label="显示模式设置" title="切换平面编辑或立体演示"><svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="m12 3 2.4 6.6L21 12l-6.6 2.4L12 21l-2.4-6.6L3 12l6.6-2.4Z"/></svg><span>显示模式</span></summary><div class="effects-panel"><strong>战术板模式</strong><div role="group" aria-label="战术板模式">${[['traditional','传统模式','平面棋子 · 编辑最清晰'],['digital','数字化模式','立体棋子 · 适合投屏讲解']].map(([value,label,desc])=>`<button type="button" data-effects-mode="${value}" aria-pressed="${value===selected}" ${restricted && value==='digital'?'disabled aria-describedby="visual-mode-note"':''}><span class="effect-radio" aria-hidden="true"></span><span>${label}<small>${desc}</small></span></button>`).join('')}</div><p class="effects-note" id="visual-mode-note">${modeNote()}</p></div></details>`;
}
export function particleOptions(compact = false) {
  return {
    fullScreen: { enable: false }, autoPlay: true, fpsLimit: 60,
    detectRetina: false, pauseOnBlur: true, pauseOnOutsideViewport: true,
    interactivity: { detectsOn: 'window', events: { onHover: { enable: !compact, mode: 'repulse' }, resize: { enable: true } }, modes: { repulse: { distance: 115, duration: .8, speed: .35 } } },
    particles: {
      number: { value: compact ? 42 : 90, density: { enable: false } },
      color: { value: ['#c7cace', '#9a9fa7', '#a0a5ac'] },
      shape: { type: 'circle' }, size: { value: { min: 1, max: compact ? 2.2 : 3.4 } },
      opacity: { value: { min: .16, max: .7 }, animation: { enable: true, speed: .45, sync: false } },
      links: { enable: !compact, distance: 125, color: '#b5b9bf', opacity: .13, width: .6 },
      move: { enable: true, direction: 'top-right', speed: { min: .22, max: .75 }, random: true, straight: false, outModes: { default: 'out' } }
    }
  };
}
function loadLibrary() {
  if (window.tsParticles) return Promise.resolve(window.tsParticles);
  if (!loading) loading = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = new URL('./vendor/tsparticles.slim-4.4.0.min.js', import.meta.url).href;
    script.onload = () => resolve(window.tsParticles);
    script.onerror = () => { script.remove(); loading = null; reject(new Error('Particles unavailable')); };
    document.head.append(script);
  });
  return loading;
}
function prepareEngine() {
  // tsParticles 4 closes plugin registration after its first load(). Mode changes
  // reuse those plugins; registering them again would leave the layer empty.
  if (!engineReady) engineReady = loadLibrary().then(async engine => {
    await window.loadSlim(engine);
    return engine;
  }).catch(error => { engineReady = null; throw error; });
  return engineReady;
}
async function applyMode() {
  const ticket = ++generation, mode = effectiveMode();
  document.documentElement.dataset.visualMode = visualMode();
  document.documentElement.dataset.effects = mode;
  document.dispatchEvent(new window.CustomEvent('playbook:effects-changed',{detail:{mode, visualMode:visualMode()}}));
  document.querySelectorAll('[data-effects-mode]').forEach(n => n.setAttribute('aria-pressed', n.dataset.effectsMode === visualMode()));
  document.querySelectorAll('.effects-note').forEach(n => { n.textContent = modeNote(); });
  document.querySelectorAll('[data-effects-mode="digital"]').forEach(n => { n.disabled = deviceIsTraditional(); });
  instance?.destroy(); instance = null;
  document.querySelectorAll('.particle-burst,.press-wave').forEach(n => n.remove());
  if (mode === 'off') {
    // Finish pending UI animations immediately when the preference changes.
    document.getAnimations?.().forEach(animation => { try { animation.finish(); } catch { animation.cancel(); } });
    return;
  }
  // In non-canvas environments the complete interface still works without decoration.
  if (typeof window.CanvasRenderingContext2D === 'undefined') return;
  startQueue = startQueue.then(async () => { try {
    if (ticket !== generation) return;
    const engine = await prepareEngine();
    if (ticket !== generation) return;
    const container = await engine.load({ id: 'ambient-particles', options: particleOptions(!!mq('(max-width: 720px)')?.matches) });
    if (ticket !== generation) { container?.destroy(); return; }
    instance = container;
    if (document.hidden) instance?.pause();
  } catch { /* Static lighting is the safe fallback; never block the editor. */ } });
  return startQueue;
}
export function setEffectsMode(mode) {
  if (!modes.has(mode) || (mode === 'digital' && deviceIsTraditional())) return;
  sessionMode = mode;
  try { localStorage.setItem(KEY, mode); } catch { /* Session preference still applies below. */ }
  return applyMode();
}
// Kept separate from any shared-workspace setting: visual preferences are device-only.
export function burstAt(node, count = 7) {
  if (!node || effectiveMode() !== 'full' || document.hidden || !node.animate) return;
  const layer = document.querySelector('#action-particles');
  if (!layer || layer.childElementCount >= 70) return;
  const box = node.getBoundingClientRect();
  count = Math.min(count, 70 - layer.childElementCount);
  for (let i = 0; i < count; i++) {
    const dot = document.createElement('i'), angle = Math.PI * 2 * i / count, distance = 22 + Math.random() * 26;
    dot.className = 'particle-burst'; dot.style.left = `${box.x + box.width / 2}px`; dot.style.top = `${box.y + box.height / 2}px`;
    layer.append(dot);
    const animation = dot.animate([{ transform: 'translate(-50%,-50%) scale(.5)', opacity: .9 }, { transform: `translate(calc(-50% + ${Math.cos(angle)*distance}px),calc(-50% + ${Math.sin(angle)*distance}px)) scale(0)`, opacity: 0 }], { duration: 650, easing: 'cubic-bezier(.16,1,.3,1)' });
    animation.onfinish = animation.oncancel = () => dot.remove();
  }
}
export function initEffects() {
  if (initialized) return;
  initialized = true;
  const atmosphere = document.createElement('div');
  atmosphere.className = 'atmosphere'; atmosphere.setAttribute('aria-hidden','true');
  atmosphere.innerHTML = '<div class="stadium-light light-one"></div><div class="stadium-light light-two"></div><div id="ambient-particles"></div>';
  const actions = document.createElement('div'); actions.id = 'action-particles'; actions.setAttribute('aria-hidden','true');
  document.body.prepend(atmosphere); document.body.append(actions);
  document.addEventListener('click', event => {
    const modeButton = event.target.closest('[data-effects-mode]');
    if (modeButton) { setEffectsMode(modeButton.dataset.effectsMode); return; }
    for (const menu of document.querySelectorAll('.effects-menu[open]')) if (!menu.contains(event.target)) menu.open = false;
  });
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    const menu = document.querySelector('.effects-menu[open]');
    if (menu) { event.stopPropagation(); event.preventDefault(); menu.open = false; menu.querySelector('summary')?.focus(); }
  }, { capture: true });
  document.addEventListener('pointerdown', event => {
    if (effectiveMode() !== 'full') return;
    const button = event.target.closest('button,.button');
    if (!button || button.disabled || button.closest('svg') || !button.animate) return;
    const box = button.getBoundingClientRect(), wave = document.createElement('span');
    wave.className = 'press-wave'; wave.setAttribute('aria-hidden','true');
    wave.style.left = `${event.clientX-box.left}px`; wave.style.top = `${event.clientY-box.top}px`;
    button.classList.add('has-press-wave'); button.append(wave);
    const animation = wave.animate([{ transform:'translate(-50%,-50%) scale(0)', opacity:.25 },{ transform:'translate(-50%,-50%) scale(1)', opacity:0 }],{ duration:460,easing:'cubic-bezier(.22,1,.36,1)' });
    animation.onfinish = animation.oncancel = () => { wave.remove(); if (!button.querySelector('.press-wave')) button.classList.remove('has-press-wave'); };
  }, { passive: true });
  mq('(prefers-reduced-motion: reduce)')?.addEventListener('change', applyMode);
  for (const query of ['(pointer: coarse)', '(hover: none)']) mq(query)?.addEventListener('change', applyMode);
  document.addEventListener('visibilitychange', () => {
    document.documentElement.classList.toggle('page-hidden', document.hidden);
    if (document.hidden) instance?.pause(); else if (effectiveMode() !== 'off') instance?.play();
  });
  window.addEventListener('storage', event => { if (event.key === KEY) { sessionMode = undefined; applyMode(); } });
  applyMode();
  initLiquidMaterials();
}
