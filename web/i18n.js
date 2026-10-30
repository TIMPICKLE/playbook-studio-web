import supportZh from './locales/support.zh-CN.js';
import supportEn from './locales/support.en.js';
import zh from './locales/zh-CN.js';
import en from './locales/en.js';
import cloudZh from './locales/cloud.zh-CN.js';
import cloudEn from './locales/cloud.en.js';
import extraZh from './locales/madden-ai.zh-CN.js';
import extraEn from './locales/madden-ai.en.js';

export const LOCALE_KEY = 'playbook-studio.locale';
export const LOCALES = ['zh-CN', 'en'];
const messages = { 'zh-CN': { ...zh, ...cloudZh, ...extraZh, ...supportZh }, en: { ...en, ...cloudEn, ...extraEn, ...supportEn } };
let locale = 'zh-CN';
try { const saved = globalThis.localStorage?.getItem(LOCALE_KEY); if (LOCALES.includes(saved)) locale = saved; } catch { /* storage may be unavailable */ }
export function getLocale() { return locale; }
export function setLocale(next) {
  if (!LOCALES.includes(next)) throw new RangeError(`Unsupported locale: ${next}`);
  // If persistence fails, do not claim the language switch succeeded.
  globalThis.localStorage.setItem(LOCALE_KEY, next);
  locale = next;
  return locale;
}
export function t(key, params = {}) {
  const value = messages[locale][key] ?? messages['zh-CN'][key] ?? key;
  return String(value).replace(/\{(\w+)\}/g, (match, name) => Object.hasOwn(params, name) ? String(params[name]) : match);
}
