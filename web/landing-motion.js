import { fieldSVG, updateAnimation } from './field.js';
import { starterWorkspace } from './model.js';
import { composeMatchup } from './ai-matchup.js';
import { reducedMotion } from './motion.js';

const STORY_STAGES = ['formation', 'routes', 'rehearsal', 'matchup', 'team'];
const OVERLAY_COLORS = { offense: '#e8ecf2', defense: '#e59275' };
const REHEARSAL_DURATION = 2.4;

export function initLandingMotion(doc = document) {
  const win = doc.defaultView;
  if (!win || !doc.body?.classList.contains('entry-page')) return { destroy() {} };

  const reduced = () => reducedMotion(win);
  const cleanups = [];
  const on = (target, event, handler, options) => {
    if (!target?.addEventListener) return;
    target.addEventListener(event, handler, options);
    cleanups.push(() => target.removeEventListener(event, handler, options));
  };

  if (!reduced()) doc.documentElement.classList.add('landing-motion-ready');

  /* ------------------------------------------------------------------------
     1. Sticky Header Frosted Elevation & Section Anchor Highlight
     ------------------------------------------------------------------------ */
  const header = doc.querySelector('.entry-header');
  const syncHeader = () => {
    if (!header) return;
    header.classList.toggle('is-scrolled', (win.scrollY || 0) > 24);
  };
  syncHeader();
  on(win, 'scroll', syncHeader, { passive: true });

  const navLinks = [...doc.querySelectorAll('.entry-nav a[href^="#"]')];
  if (navLinks.length && typeof win.IntersectionObserver === 'function') {
    const sections = navLinks
      .map(link => ({ link, target: doc.querySelector(link.getAttribute('href')) }))
      .filter(entry => entry.target);
    const navObserver = new win.IntersectionObserver(entries => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        for (const item of sections) {
          item.link.classList.toggle('is-current', item.target === entry.target);
        }
      }
    }, { rootMargin: '-30% 0px -55% 0px', threshold: 0.05 });
    for (const item of sections) navObserver.observe(item.target);
    cleanups.push(() => navObserver.disconnect());
  }

  /* ------------------------------------------------------------------------
     2. Subtle Hero Layered Parallax (Desktop Fine-Pointer Only)
     ------------------------------------------------------------------------ */
  const hero = doc.querySelector('.entry-hero');
  const finePointer = () => !!win.matchMedia?.('(hover: hover) and (pointer: fine)').matches && (win.innerWidth || 0) > 720;
  let parallaxFrame = 0;
  const updateScrollParallax = () => {
    parallaxFrame = 0;
    if (!hero || reduced() || !finePointer()) {
      hero?.style.setProperty('--hero-scroll', '0px');
      return;
    }
    const clamped = Math.max(0, Math.min(260, win.scrollY || 0));
    hero.style.setProperty('--hero-scroll', `${clamped.toFixed(1)}px`);
  };
  const queueParallax = () => {
    if (!parallaxFrame && typeof win.requestAnimationFrame === 'function') {
      parallaxFrame = win.requestAnimationFrame(updateScrollParallax);
    }
  };
  updateScrollParallax();
  on(win, 'scroll', queueParallax, { passive: true });
  on(hero, 'pointermove', event => {
    if (reduced() || !finePointer()) return;
    const rect = hero.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const nx = ((event.clientX - rect.left) / rect.width - 0.5) * 2;
    const ny = ((event.clientY - rect.top) / rect.height - 0.5) * 2;
    hero.style.setProperty('--hero-px', nx.toFixed(3));
    hero.style.setProperty('--hero-py', ny.toFixed(3));
  }, { passive: true });
  on(hero, 'pointerleave', () => {
    hero?.style.setProperty('--hero-px', '0');
    hero?.style.setProperty('--hero-py', '0');
  });

  /* ------------------------------------------------------------------------
     3. Scroll Reveal (IntersectionObserver, once: true + Immediate Viewport Sync)
     ------------------------------------------------------------------------ */
  const revealNodes = [...doc.querySelectorAll('[data-reveal]')];
  if (revealNodes.length) {
    if (reduced() || typeof win.IntersectionObserver !== 'function') {
      revealNodes.forEach(node => node.classList.add('is-revealed'));
    } else {
      const pending = new Set(revealNodes);
      const revealNode = node => {
        node.classList.add('is-revealed');
        pending.delete(node);
        revealObserver.unobserve(node);
      };
      const revealObserver = new win.IntersectionObserver(entries => {
        for (const entry of entries) {
          if (entry.isIntersecting) revealNode(entry.target);
        }
      }, { rootMargin: '0px 0px -4% 0px', threshold: 0.01 });
      revealNodes.forEach(node => revealObserver.observe(node));
      cleanups.push(() => revealObserver.disconnect());

      const revealVisibleNow = () => {
        if (!pending.size) return;
        const vh = win.innerHeight || 900;
        for (const node of [...pending]) {
          const rect = node.getBoundingClientRect?.();
          if (rect && rect.height > 0 && rect.top < vh * 0.96 && rect.bottom > 0) {
            revealNode(node);
          }
        }
      };
      revealVisibleNow();
      on(win, 'scroll', revealVisibleNow, { passive: true });
      on(win, 'resize', revealVisibleNow, { passive: true });
    }
  }

  /* ------------------------------------------------------------------------
     4. Scrollytelling · Live Tactical Stage Driven by fieldSVG + updateAnimation
     ------------------------------------------------------------------------ */
  const stageWrap = doc.querySelector('.story-stage-wrap');
  const stageCanvas = doc.querySelector('#story-stage-canvas');
  const stageCaption = doc.querySelector('#story-stage-caption');
  const stageClock = doc.querySelector('#story-clock');
  const replayButton = doc.querySelector('#story-replay');
  const aiCallout = doc.querySelector('#story-ai-callout');
  const teamBar = doc.querySelector('#story-team-bar');
  const stepButtons = [...doc.querySelectorAll('[data-story-step]')];
  const progressDots = [...doc.querySelectorAll('.story-progress-dots span')];

  let activeStep = -1;
  let currentBoardKind = '';
  let rafId = 0;
  let rehearsalStart = 0;
  let stageVisible = true;

  const stopRehearsal = () => {
    if (rafId && typeof win.cancelAnimationFrame === 'function') {
      win.cancelAnimationFrame(rafId);
    }
    rafId = 0;
  };

  if (stageWrap && stageCanvas && stepButtons.length) {
    const workspace = starterWorkspace();
    const meshPlay = workspace.plays[0];
    const cover3Play = workspace.plays.find(play => play.title.includes('Cover 3')) || workspace.plays[5];
    const matchupPlay = meshPlay && cover3Play
      ? composeMatchup(meshPlay, cover3Play, false, OVERLAY_COLORS)
      : meshPlay;

    const renderStageBoard = kind => {
      if (currentBoardKind === kind && stageCanvas.querySelector('svg')) return;
      currentBoardKind = kind;
      const play = kind === 'matchup' ? matchupPlay : meshPlay;
      stageCanvas.innerHTML = fieldSVG(
        play,
        { fieldTheme: 'dark', showGrid: true },
        { thumbnail: true, prefix: 'story', time: 0 }
      );
    };

    const setClock = seconds => {
      if (stageClock) stageClock.textContent = `${seconds.toFixed(1)}s`;
    };

    const runRehearsal = (reset = true) => {
      stopRehearsal();
      const svg = stageCanvas.querySelector('svg');
      if (!svg || !meshPlay) return;
      if (reduced()) {
        updateAnimation(svg, meshPlay, 1.6, 'story');
        setClock(1.6);
        return;
      }
      if (reset) rehearsalStart = 0;
      const tick = stamp => {
        if (!stageVisible || activeStep !== 2) {
          rafId = 0;
          return;
        }
        if (!rehearsalStart) rehearsalStart = stamp;
        const elapsed = ((stamp - rehearsalStart) / 1000) % (REHEARSAL_DURATION + 0.65);
        const simTime = Math.min(REHEARSAL_DURATION, elapsed);
        updateAnimation(svg, meshPlay, simTime, 'story');
        setClock(simTime);
        rafId = win.requestAnimationFrame(tick);
      };
      if (typeof win.requestAnimationFrame === 'function') {
        rafId = win.requestAnimationFrame(tick);
      } else {
        updateAnimation(svg, meshPlay, 1.4, 'story');
        setClock(1.4);
      }
    };

    const activateStep = index => {
      const clamped = Math.max(0, Math.min(STORY_STAGES.length - 1, Number(index) || 0));
      if (clamped === activeStep) return;
      activeStep = clamped;
      const stageName = STORY_STAGES[clamped];
      stageWrap.dataset.stage = stageName;

      stepButtons.forEach((btn, i) => {
        const active = i === clamped;
        btn.classList.toggle('is-active', active);
        btn.setAttribute('aria-current', active ? 'step' : 'false');
      });

      progressDots.forEach((dot, i) => {
        dot.classList.toggle('is-active', i === clamped);
        dot.classList.toggle('is-done', i < clamped);
      });

      const activeBtn = stepButtons[clamped];
      const captionKey = activeBtn?.dataset.storyCaptionKey;
      const captionNode = captionKey ? doc.querySelector(`[data-story-caption-source="${captionKey}"]`) : null;
      if (stageCaption && captionNode) stageCaption.textContent = captionNode.textContent;

      stopRehearsal();
      if (stageName === 'matchup') {
        renderStageBoard('matchup');
        setClock(1.8);
      } else {
        renderStageBoard('mesh');
        const svg = stageCanvas.querySelector('svg');
        if (stageName === 'rehearsal') {
          runRehearsal(true);
        } else if (stageName === 'team') {
          if (svg) updateAnimation(svg, meshPlay, 1.5, 'story');
          setClock(1.5);
        } else {
          if (svg) updateAnimation(svg, meshPlay, 0, 'story');
          setClock(0);
        }
      }

      if (replayButton) replayButton.hidden = stageName !== 'rehearsal';
      if (aiCallout) aiCallout.hidden = stageName !== 'matchup';
      if (teamBar) teamBar.hidden = stageName !== 'team';
    };

    stepButtons.forEach((btn, index) => {
      on(btn, 'click', () => activateStep(index));
    });
    on(replayButton, 'click', () => {
      if (activeStep === 2) runRehearsal(true);
    });

    if (typeof win.IntersectionObserver === 'function') {
      const stepObserver = new win.IntersectionObserver(entries => {
        let best = null;
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          if (!best || entry.intersectionRatio > best.intersectionRatio) best = entry;
        }
        if (best) activateStep(Number(best.target.dataset.storyStep));
      }, { rootMargin: '-34% 0px -42% 0px', threshold: [0.15, 0.4, 0.65] });
      stepButtons.forEach(btn => stepObserver.observe(btn));
      cleanups.push(() => stepObserver.disconnect());

      const stageVisibility = new win.IntersectionObserver(entries => {
        stageVisible = !!entries[0]?.isIntersecting;
        if (!stageVisible) stopRehearsal();
        else if (activeStep === 2) runRehearsal(false);
      }, { threshold: 0.05 });
      stageVisibility.observe(stageWrap);
      cleanups.push(() => stageVisibility.disconnect());
    }

    on(doc, 'visibilitychange', () => {
      if (doc.hidden) stopRehearsal();
      else if (activeStep === 2 && stageVisible) runRehearsal(false);
    });

    activateStep(0);
  }

  /* ------------------------------------------------------------------------
     5. Horizontal Workflow Gallery (Snap + Arrows + Non-Trapping Wheel Rail)
     ------------------------------------------------------------------------ */
  const track = doc.querySelector('.scenes-track');
  const prevBtn = doc.querySelector('[data-scenes-dir="prev"]');
  const nextBtn = doc.querySelector('[data-scenes-dir="next"]');
  const meterFill = doc.querySelector('.scenes-meter-fill');

  if (track) {
    const syncGallery = () => {
      const max = Math.max(0, track.scrollWidth - track.clientWidth);
      const ratio = max > 0 ? Math.min(1, Math.max(0, track.scrollLeft / max)) : 1;
      if (prevBtn) prevBtn.disabled = track.scrollLeft <= 4;
      if (nextBtn) nextBtn.disabled = max <= 4 || track.scrollLeft >= max - 4;
      if (meterFill) meterFill.style.setProperty('--scenes-progress', `${Math.round(24 + ratio * 76)}%`);
    };

    const stepScroll = dir => {
      const card = track.querySelector('.scene-card');
      const delta = ((card?.clientWidth || 340) + 18) * dir;
      track.scrollBy?.({ left: delta, behavior: reduced() ? 'auto' : 'smooth' });
    };

    on(prevBtn, 'click', () => stepScroll(-1));
    on(nextBtn, 'click', () => stepScroll(1));
    on(track, 'scroll', syncGallery, { passive: true });
    on(win, 'resize', syncGallery, { passive: true });

    // Gentle wheel-to-horizontal mapping that releases vertical scroll cleanly at edges.
    on(track, 'wheel', event => {
      if (track.scrollWidth <= track.clientWidth + 4) return;
      if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
      const atStart = track.scrollLeft <= 1 && event.deltaY < 0;
      const atEnd = track.scrollLeft + track.clientWidth >= track.scrollWidth - 1 && event.deltaY > 0;
      if (atStart || atEnd) return;
      track.scrollLeft += event.deltaY;
      event.preventDefault();
    }, { passive: false });

    syncGallery();
  }

  return {
    destroy() {
      stopRehearsal();
      if (parallaxFrame && typeof win.cancelAnimationFrame === 'function') {
        win.cancelAnimationFrame(parallaxFrame);
      }
      cleanups.forEach(fn => fn());
    },
  };
}

if (typeof document !== 'undefined' && document.body?.classList.contains('entry-page')) {
  initLandingMotion(document);
}
