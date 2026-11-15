import en from './locales/onboarding.en.js';
import zh from './locales/onboarding.zh-CN.js';

export const onboardingLabels = locale => locale === 'en' ? en : zh;
function visible(node, win) {
  if (!node?.isConnected || node.closest('[hidden],[inert]')) return false;
  const style = win.getComputedStyle(node), rect = node.getBoundingClientRect();
  return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
}
export function onboardingSteps(context, doc = document) {
  const copy = onboardingLabels(context.locale), win = doc.defaultView;
  const find = (...selectors) => () => selectors.flatMap(selector => [...doc.querySelectorAll(selector)]).find(node => visible(node,win)) || null;
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
    step('tools',context.reference ? context.readOnly ? 'readonlyLibrary' : 'library' : context.readOnly ? 'rehearsal' : 'tools',context.reference ? find('#app .top-actions [data-action="madden-library"]','#app [data-action="madden-library"]') : find('#app .stage-dock'),'top'),
    step('properties',isVisible('#app .inspector') ? context.readOnly ? 'readonlyProperties' : 'properties' : 'propertiesMenu',find('#app .inspector','#app [data-action="inspector-panel"]'),'left'),
    step('assistant',context.readOnly ? 'readonlyAssistant' : 'assistant',find('.board-ai [data-ba="open"]'),'left'),
    step('export','export',find('#app .top-actions [data-action="export"]'),'bottom'),
  ];
  if (context.id === 'analysis') return [
    step('matchup','matchup',find('#ai-matchup-root [data-ai-field="offense"]'),'right'),
    step('brief','brief',find('#ai-matchup-root [data-local-brief]'),'bottom'),
    step('knowledge','knowledge',find('#ai-matchup-root .ai-knowledge'),'top'),
    step('model','model',find('#ai-matchup-root [data-ai-field="provider"]'),'right'),
  ];
  if (context.id === 'roster') return [
    step('tabs','rosterTabs',find('#roster-root .roster-tabs')),
    step('personnel','personnel',find('#roster-root .personnel-controls')),
    step('depth',isVisible('#roster-root .roster-chart-root') ? context.readOnly ? 'readonlyDepth' : 'depth' : 'directory',find('#roster-root .roster-chart-root','#roster-root .roster-tools')),
  ];
  if (context.id === 'empty') return [step('new','newBook',find('.cloud-empty [data-cloud-action="new"]'))];
  return [];
}
