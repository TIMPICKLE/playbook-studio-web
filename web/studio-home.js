import { fieldSVG } from './field.js';
import { t, getLocale } from './i18n.js';
import { starterWorkspace, escapeHTML as e } from './model.js';
import { onboardingLabels } from './onboarding-steps.js';

let editorPreview;

function rosterArt() {
  return ['10 WR', '12 QB', '54 LB'].map(label => {
    const [number, position] = label.split(' ');
    return `<span class="home-player-chip"><b>${number}</b><small>${position}</small></span>`;
  }).join('');
}

function choice(kind, action, title, description, link, art, content = {}) {
  return `<article class="studio-choice studio-choice-${kind}">
    <div class="choice-art choice-art-${kind}" inert aria-hidden="true">${art}</div>
    <div class="choice-body">
      <h2 id="home-${kind}-title">${e(content.title ?? t(title))}</h2>
      <p id="home-${kind}-description">${e(content.description ?? t(description))}</p>
      <button type="button" class="choice-link" data-cloud-action="${action}"
        aria-label="${e(content.actionLabel ?? `${t(title)} · ${content.link ?? t(link)}`)}" aria-describedby="home-${kind}-description">${e(content.link ?? t(link))} <b aria-hidden="true">→</b></button>
    </div>
  </article>`;
}

/** Progress is supplied by the host from completed actions, never inferred from samples. */
export function firstTaskChecklist(progress, locale = getLocale()) {
  if (!progress || typeof progress !== 'object') return '';
  const copy = onboardingLabels(locale);
  const steps = [['createdPlay','firstTaskCreated'],['routeAdded','firstTaskRoute'],['rehearsed','firstTaskRehearsed'],['exported','firstTaskExported']];
  const completed = steps.filter(([key]) => progress[key] === true).length;
  return `<details class="home-first-task" data-onboarding-ui>
    <summary>${e(copy.firstTaskTitle)} <span>${completed} / ${steps.length} ${e(copy.taskProgress)}</span></summary>
    <p>${e(copy.firstTaskIntro)}</p><ol>${steps.map(([key,label]) => `<li data-first-task="${key}" data-complete="${progress[key] === true}"><span aria-hidden="true">${progress[key] === true ? '✓' : '○'}</span><span>${e(copy[label])}</span><small>${e(progress[key] === true ? copy.taskDone : copy.taskPending)}</small></li>`).join('')}</ol>
    <button type="button" data-cloud-action="enter-editor">${e(copy.taskStart)} →</button>
  </details>`;
}

export function studioHome({ user, bookCount = 0, cloudUrl, recentPlay, firstTask } = {}) {
  const copy = onboardingLabels(getLocale());
  const recent = recentPlay?.title ? {
    title: copy.continueEditing,
    description: [recentPlay.title, recentPlay.formation, recentPlay.league ? `${recentPlay.league} ${getLocale() === 'en' ? 'per side' : '人／每方'}` : ''].filter(Boolean).join(' · '),
    link: copy.continueEditing,
    actionLabel: `${copy.continueEditing}: ${recentPlay.title}`,
  } : {link:copy.openEditor};
  editorPreview ??= fieldSVG(starterWorkspace().plays[0], { showGrid: false }, { thumbnail: true, prefix: 'home-editor' });
  const preview = Array.isArray(recentPlay?.players) && Array.isArray(recentPlay?.routes)
    ? fieldSVG(recentPlay, {showGrid:false}, {thumbnail:true,prefix:'home-recent'}) : editorPreview;
  const account = user
    ? `<span>${t('cloud.hello')}${e(user.name || user.username || t('cloud.player'))}</span><button type="button" data-cloud-action="logout">${t(user.authMode === 'password' ? 'cloud.signOut' : 'cloud.switchAccount')}</button>`
    : cloudUrl ? `<a class="home-cloud-link" href="${e(cloudUrl)}" target="_top">${t('cloud.demoTeamSignIn')}</a>` : '';
  const overview = user ? t('cloud.homeDescription') : t('cloud.demoIntro');
  const foot = user
    ? bookCount ? t('cloud.homeBookCount', { count: bookCount }) : t('cloud.noBooksIntro')
    : `<a href="./landing.html">${t('cloud.demoGuide')}</a>`;
  return `<div class="studio-home">
    <header class="studio-home-header">
      <div class="studio-home-brand"><img class="brand-logo" src="./assets/brand/playbook-studio-logo-dark-transparent.svg" width="200" height="42" alt="Playbook Studio"></div>
      <div class="studio-home-account">${account}</div>
    </header>
    <main class="studio-home-main">
      <div class="studio-home-intro">
        ${user ? '' : `<span class="home-demo-badge">${t('cloud.demoBadge')}</span>`}
        <h1>${t(user ? 'cloud.homeTitle' : 'cloud.demoTitle')}</h1><p>${overview}</p>
      </div>
      <div class="studio-home-cards">
        ${choice('editor', 'enter-editor', 'cloud.editBook', 'cloud.editDescription', 'cloud.enterBook', preview, recent)}
        ${firstTaskChecklist(firstTask)}
        ${choice('roster', 'enter-roster', 'roster.title', 'roster.cardDescription', 'roster.open', rosterArt())}
        ${choice('ai', 'enter-analysis', 'cloud.aiAnalysis', user ? 'cloud.aiDescription' : 'cloud.demoAiDescription', 'cloud.startAnalysis',
          `<div class="choice-orbit orbit-one"></div><div class="choice-orbit orbit-two"></div><div class="choice-node node-offense">O</div><div class="choice-node node-defense">D</div><div class="choice-ai-label">${t('cloud.ifThen')}</div>`)}
      </div>
      <div class="studio-home-foot">${foot}</div>
    </main>
  </div>`;
}
