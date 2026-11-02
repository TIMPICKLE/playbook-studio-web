import { fieldSVG } from './field.js';
import { t } from './i18n.js';
import { starterWorkspace, escapeHTML as e } from './model.js';

let editorPreview;

function rosterArt() {
  return ['10 WR', '12 QB', '54 LB'].map(label => {
    const [number, position] = label.split(' ');
    return `<span class="home-player-chip"><b>${number}</b><small>${position}</small></span>`;
  }).join('');
}

function choice(kind, action, title, description, link, art) {
  return `<article class="studio-choice studio-choice-${kind}">
    <div class="choice-art choice-art-${kind}" inert aria-hidden="true">${art}</div>
    <div class="choice-body">
      <h2 id="home-${kind}-title">${t(title)}</h2>
      <p id="home-${kind}-description">${t(description)}</p>
      <button type="button" class="choice-link" data-cloud-action="${action}"
        aria-labelledby="home-${kind}-title" aria-describedby="home-${kind}-description">${t(link)} <b aria-hidden="true">→</b></button>
    </div>
  </article>`;
}

export function studioHome({ user, bookCount = 0, cloudUrl } = {}) {
  editorPreview ??= fieldSVG(starterWorkspace().plays[0], { showGrid: false }, { thumbnail: true, prefix: 'home-editor' });
  const account = user
    ? `<span>${t('cloud.hello')}${e(user.name || user.username || t('cloud.player'))}</span><button type="button" data-cloud-action="logout">${t(user.authMode === 'password' ? 'cloud.signOut' : 'cloud.switchAccount')}</button>`
    : cloudUrl ? `<a class="home-cloud-link" href="${e(cloudUrl)}" target="_top">${t('cloud.demoTeamSignIn')}</a>` : '';
  const overview = user ? t('cloud.homeDescription') : t('cloud.demoIntro');
  const foot = user
    ? bookCount ? t('cloud.homeBookCount', { count: bookCount }) : t('cloud.noBooksIntro')
    : `<a href="./landing.html">${t('cloud.demoGuide')}</a>`;
  return `<div class="studio-home">
    <header class="studio-home-header">
      <div class="studio-home-brand"><img class="brand-icon" src="./assets/brand/playbook-studio-icon.svg" alt="" width="48" height="26"><span>Playbook<small>Studio</small></span></div>
      <div class="studio-home-account">${account}</div>
    </header>
    <main class="studio-home-main">
      <div class="studio-home-intro">
        ${user ? '' : `<span class="home-demo-badge">${t('cloud.demoBadge')}</span>`}
        <h1>${t(user ? 'cloud.homeTitle' : 'cloud.demoTitle')}</h1><p>${overview}</p>
      </div>
      <div class="studio-home-cards">
        ${choice('editor', 'enter-editor', 'cloud.editBook', 'cloud.editDescription', 'cloud.enterBook', editorPreview)}
        ${choice('roster', 'enter-roster', 'roster.title', 'roster.cardDescription', 'roster.open', rosterArt())}
        ${choice('ai', 'enter-analysis', 'cloud.aiAnalysis', user ? 'cloud.aiDescription' : 'cloud.demoAiDescription', 'cloud.startAnalysis',
          `<div class="choice-orbit orbit-one"></div><div class="choice-orbit orbit-two"></div><div class="choice-node node-offense">O</div><div class="choice-node node-defense">D</div><div class="choice-ai-label">${t('cloud.ifThen')}</div>`)}
      </div>
      <div class="studio-home-foot">${foot}</div>
    </main>
  </div>`;
}
