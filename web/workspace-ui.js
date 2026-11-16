import { getLocale } from './i18n.js';
import { escapeHTML as e } from './model.js';

export function workspaceNavigation(active) {
  const en = getLocale() === 'en';
  return `<nav class="workspace-nav" aria-label="${en ? 'Workspaces' : '工作区'}"><button type="button" data-cloud-action="home" class="workspace-home" aria-label="${en?'Workspace home':'返回工作台'}" title="${en?'Workspace home':'返回工作台'}">←</button>${[
    ['editor', en ? 'Play editor' : '战术编辑'],
    ['analysis', en ? 'AI analysis' : 'AI 战局分析'],
    ['roster', en ? 'Players · DEPTH CHART' : '球员 · DEPTH CHART'],
  ].map(([id,label]) => `<button type="button" data-workspace-mode="${id}" aria-label="${e(label)}" ${active === id ? 'aria-current="page"' : ''}><span class="workspace-nav-label">${e(label)}</span>${id==='roster'?`<span class="workspace-nav-short" aria-hidden="true">${en?'Players':'球员'}</span>`:''}</button>`).join('')}</nav>`;
}

// Per-book UI sessions never become part of shared/backup football data.
export function createWorkspaceSessions() {
  const sessions = new Map();
  const key=scope=>`playbook-ui-session:v1:${scope}`;
  return {
    get(scope) {
      if(!sessions.has(scope)) {
        try {const value=JSON.parse(globalThis.localStorage?.getItem(key(scope))||'null');if(value&&typeof value==='object')sessions.set(scope,value);}catch{}
      }
      const value=sessions.get(scope);return value?structuredClone(value):null;
    },
    save(scope, value) {
      sessions.set(scope, structuredClone(value));
      try {globalThis.localStorage?.setItem(key(scope),JSON.stringify(value));}catch{}
    },
    clear(scope) { sessions.delete(scope);try{globalThis.localStorage?.removeItem(key(scope));}catch{} },
  };
}
