// tsParticles is self-hosted and loaded only when decorative motion is enabled.
const KEY = 'playbook-visual-effects';
const modes = new Set(['full', 'lite', 'off']);
let instance, loading, generation = 0, initialized = false, sessionMode, startQueue = Promise.resolve();
const mq = query => window.matchMedia?.(query);
export function preference() {
  if (sessionMode) return sessionMode;
  try { const value = localStorage.getItem(KEY); return modes.has(value) ? value : 'full'; } catch { return 'full'; }
}
export function effectiveMode(value = preference(), reduced = !!mq('(prefers-reduced-motion: reduce)')?.matches) {
  return reduced ? 'off' : modes.has(value) ? value : 'full';
}
export function effectsControl() {
  const selected = preference();
  return `<details class="effects-menu"><summary aria-label="视觉效果设置"><svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="m12 3 2.4 6.6L21 12l-6.6 2.4L12 21l-2.4-6.6L3 12l6.6-2.4Z"/><path d="m20 2 .6 1.4L22 4l-1.4.6L20 6l-.6-1.4L18 4l1.4-.6Z"/></svg><span>视觉效果</span></summary><div class="effects-panel"><strong>工作台视觉效果</strong><div role="group" aria-label="动效强度">${[['full','完整动效','流动粒子 · 鼠标互动'],['lite','轻量动效','少量粒子 · 降低耗电'],['off','关闭动效','静态玻璃 · 专注战术']].map(([value,label,desc])=>`<button type="button" data-effects-mode="${value}" aria-pressed="${value===selected}"><span class="effect-radio" aria-hidden="true"></span><span>${label}<small>${desc}</small></span></button>`).join('')}</div><p class="effects-note">${effectiveMode()==='off'&&selected!=='off'?'已跟随系统“减少动态效果”设置。':'只影响这台设备，不修改共享战术。'}</p></div></details>`;
}
export function particleOptions(mode, compact = false) {
  const lite = mode === 'lite';
  return {
    fullScreen: { enable: false }, autoPlay: true, fpsLimit: lite ? 30 : 60,
    detectRetina: false, pauseOnBlur: true, pauseOnOutsideViewport: true,
    interactivity: { detectsOn: 'window', events: { onHover: { enable: !lite && !compact, mode: 'repulse' }, resize: { enable: true } }, modes: { repulse: { distance: 115, duration: .8, speed: .35 } } },
    particles: {
      number: { value: lite ? 28 : compact ? 42 : 90, density: { enable: false } },
      color: { value: ['#c2a1f4', '#ffdc42', '#9a70dc'] },
      shape: { type: 'circle' }, size: { value: { min: 1, max: compact ? 2.2 : 3.4 } },
      opacity: { value: { min: .16, max: .7 }, animation: { enable: true, speed: .45, sync: false } },
      links: { enable: !lite && !compact, distance: 125, color: '#b68be9', opacity: .13, width: .6 },
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
async function applyMode() {
  const ticket = ++generation, mode = effectiveMode();
  document.documentElement.dataset.effects = mode;
  document.querySelectorAll('[data-effects-mode]').forEach(n => n.setAttribute('aria-pressed', n.dataset.effectsMode === preference()));
  document.querySelectorAll('.effects-note').forEach(n => { n.textContent = mode === 'off' && preference() !== 'off' ? '已跟随系统“减少动态效果”设置。' : '只影响这台设备，不修改共享战术。'; });
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
    const engine = await loadLibrary();
    if (ticket !== generation) return;
    await window.loadSlim(engine);
    if (ticket !== generation) return;
    const container = await engine.load({ id: 'ambient-particles', options: particleOptions(mode, !!mq('(max-width: 720px)')?.matches) });
    if (ticket !== generation) { container?.destroy(); return; }
    instance = container;
    if (document.hidden) instance?.pause();
  } catch { /* Static lighting is the safe fallback; never block the editor. */ } });
  return startQueue;
}
export function setEffectsMode(mode) {
  if (!modes.has(mode)) return;
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
  mq('(max-width: 720px)')?.addEventListener('change', applyMode);
  document.addEventListener('visibilitychange', () => {
    document.documentElement.classList.toggle('page-hidden', document.hidden);
    if (document.hidden) instance?.pause(); else if (effectiveMode() !== 'off') instance?.play();
  });
  window.addEventListener('storage', event => { if (event.key === KEY) { sessionMode = undefined; applyMode(); } });
  applyMode();
}
