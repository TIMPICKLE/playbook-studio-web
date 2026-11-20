import { t } from './i18n.js';

export function mountFilmAssistant(dialog, assistant) {
  if (!assistant) return null;
  const doc = dialog.ownerDocument;
  const trigger = doc.createElement('button');
  trigger.type = 'button';
  trigger.className = 'film-control film-assistant-toggle';
  trigger.dataset.filmAssistantToggle = '';
  trigger.innerHTML = '<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M5 4.5h14a2 2 0 0 1 2 2V15a2 2 0 0 1-2 2h-8l-5.5 4v-4H5a2 2 0 0 1-2-2V6.5a2 2 0 0 1 2-2Z"/><path d="M7 9h10m-10 4h6"/></svg>';
  trigger.append(t('film.assistant'));
  const rail = doc.createElement('div');
  rail.id = 'film-assistant-panel';
  rail.className = 'film-assistant-panel';
  rail.hidden = true;
  trigger.setAttribute('aria-controls', rail.id);
  trigger.setAttribute('aria-expanded', 'false');
  dialog.querySelector('.film-actions').prepend(trigger);
  dialog.querySelector('.film-transport').after(rail);
  const release = assistant.presentIn(rail, {
    trigger,
    guide: t('film.assistantGuide'),
    examples: [
      {label:t('film.assistantRelease'), prompt:t('film.assistantReleasePrompt')},
      {label:t('film.assistantCompare'), prompt:t('film.assistantComparePrompt')},
    ],
    onOpenChange(open) {
      if (rail.hidden === !open) return;
      rail.hidden = !open;
      trigger.setAttribute('aria-expanded', String(open));
      dialog.toggleAttribute('data-film-assistant-open', open);
    },
  });
  function dismiss() {
    if (rail.hidden) return false;
    assistant.close();
    return true;
  }
  trigger.addEventListener('click', () => { if (!dismiss()) assistant.open(); });
  return {dismiss, release};
}
