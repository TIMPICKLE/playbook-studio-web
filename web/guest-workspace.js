import { CLOUD_SITE } from './cloud.js';
import { studioHome } from './studio-home.js';
import { t } from './i18n.js';

const destinations = { home: 'home', 'enter-editor': 'editor', 'enter-roster': 'roster', 'enter-analysis': 'analysis', 'enter-training': 'training' };

export function startGuestWorkspace({ showEditor, showRoster, showAnalysis, showTraining, canLeave, onLeaveEditor, onEnter }) {
  const header = document.querySelector('#cloud-root');
  let current;
  function routeFromURL() {
    const hash = location.hash.slice(1);
    if (Object.values(destinations).includes(hash)) return hash;
    return /\/local(?:\.html)?\/?$/.test(location.pathname) ? 'editor' : 'home';
  }

  function open(mode, push = false, options = {}) {
    if (mode === current) return;
    if (current && !canLeave()) {
      if (!push) window.history.replaceState(null, '', '#' + current);
      return;
    }
    const previous = current;
    if (previous === 'editor') onLeaveEditor();
    current = mode;
    if (push) window.history.pushState(null, '', '#' + mode);
    header.hidden = mode === 'analysis' || mode === 'roster' || mode === 'training';
    if (mode === 'home') {
      header.innerHTML = studioHome({ cloudUrl: CLOUD_SITE + '/editor/' });
    } else if (mode === 'editor') {
      header.innerHTML = `<div class="cloud-local-entry"><button type="button" class="button subtle" data-cloud-action="home">${t('cloud.workspaceBack')}</button><span>${t('editor.local_offline_preview_changes_stay_in_this_browser')}</span></div>`;
    } else {
      header.replaceChildren();
    }
    showEditor(mode === 'editor');
    showAnalysis(mode === 'analysis');
    showRoster(mode === 'roster');
    showTraining?.(mode === 'training', options);
    if (mode !== 'editor') {
      const title = { home: 'cloud.demoTitle', roster: 'roster.title', analysis: 'cloud.aiAnalysis', training: 'trainingNav.title' }[mode];
      document.title = t(title) + ' · Playbook Studio';
    }
    if (previous) {
      const target = mode === 'home' ? header.querySelector(`[data-cloud-action="enter-${previous}"]`)
        : document.querySelector(mode === 'editor' ? '#main-content' : mode === 'analysis' ? '#ai-matchup-root h1' : mode === 'training' ? '#training-root h1' : '#roster-root h1');
      if (target) {
        if (target.tagName === 'H1') target.tabIndex = -1;
        target.focus({ preventScroll: true });
      }
      window.scrollTo(0, 0);
    }
    onEnter(mode);
  }

  document.addEventListener('click', event => {
    const button = event.target.closest('[data-cloud-action]');
    if (!button || !Object.hasOwn(destinations, button.dataset.cloudAction)) return;
    open(destinations[button.dataset.cloudAction], true, { role: button.dataset.trainingRole });
  });
  // Browser back/forward and bookmarked module links use the same view lifecycle.
  window.addEventListener('popstate', () => open(routeFromURL()));
  window.addEventListener('hashchange', () => open(routeFromURL()));
  open(routeFromURL());
  return (mode, options) => open(mode, true, options);
}
