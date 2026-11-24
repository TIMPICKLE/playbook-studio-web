import en from './locales/onboarding.en.js';
import zh from './locales/onboarding.zh-CN.js';
import { isOnboardingTargetVisible } from './onboarding.js';

export const onboardingLabels = locale => locale === 'en' ? en : zh;
export function onboardingSteps(context, doc = document) {
  const copy = onboardingLabels(context.locale);
  const find = (...selectors) => () => selectors.flatMap(selector => [...doc.querySelectorAll(selector)]).find(node => isOnboardingTargetVisible(node)) || null;
  const step = (id, key, element, side = 'bottom') => ({id,title:copy[key][0],description:copy[key][1],element,side});
  const isVisible = selector => !!find(selector)();
  if (context.id === 'home') return [
    step('editor','homeEditor',find('.studio-choice-editor')),
    step('roster','homeRoster',find('.studio-choice-roster')),
    step('analysis','homeAnalysis',find('.studio-choice-ai')),
  ];
  if (context.id === 'editor') return [
    step('plays',isVisible('#app .play-list') ? context.readOnly ? 'readonlyPlays' : 'plays' : 'playsMenu',find('#app .play-list','#app [data-action="sidebar"]'),'right'),
    step('field',context.reference ? 'referenceField' : context.readOnly ? 'readonlyField' : 'field',find('#field'),'right'),
    step('tools',context.reference ? (context.readOnly ? 'readonlyLibrary' : 'library') : context.readOnly ? 'rehearsal' : context.touch ? 'toolsTouch' : 'tools',context.reference ? find('#app .top-actions [data-action="madden-library"]','#app [data-action="madden-library"]') : find('#app .stage-dock'),'top'),
    ...(!context.reference ? [step('coachFilm','coachFilm',find('#app .coach-film-entry'),'bottom')] : []),
    step('properties',isVisible('#app .inspector') ? context.readOnly ? 'readonlyProperties' : 'properties' : 'propertiesMenu',find('#app .inspector','#app [data-action="inspector-panel"]'),'left'),
    step('assistant',context.readOnly ? 'readonlyAssistant' : context.serverAiConfigured ? 'assistantReady' : 'assistant',find('.board-ai [data-ba="open"]','#app .task-panel-tabs [data-action="assistant-task"]'),'left'),
    step('export',isVisible('#app .top-actions [data-action="export"]') ? (context.cloud ? 'exportCloud' : 'export') : (context.cloud ? 'moreMenuCloud' : 'moreMenuLocal'),find('#app .top-actions [data-action="export"]','#app .play-more-menu > summary'),'bottom'),
  ];
  if (context.id === 'analysis') return [
    step('matchup','matchup',find('#ai-matchup-root [data-ai-field="offense"]'),'right'),
    step('brief','brief',find('#ai-matchup-root [data-local-brief]'),'bottom'),
    step('knowledge','knowledge',find('#ai-matchup-root .ai-knowledge'),'top'),
    step('model',context.serverAiConfigured ? 'modelReady' : 'model',find('#ai-matchup-root [data-ai-field="provider"]'),'right'),
  ];
  if (context.id === 'roster') return [
    step('tabs','rosterTabs',find('#roster-root .roster-tabs')),
    step('personnel','personnel',find('#roster-root .personnel-controls')),
    step('depth',isVisible('#roster-root .roster-chart-root') ? context.readOnly ? 'readonlyDepth' : 'depth' : 'directory',find('#roster-root .roster-chart-root','#roster-root .roster-tools')),
  ];
  if (context.id === 'empty') return [step('new','newBook',find('.cloud-empty [data-cloud-action="new"]'))];
  return [];
}
