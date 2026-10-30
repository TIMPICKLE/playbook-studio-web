import { fieldSVG } from './field.js';
import { getLocale, setLocale } from './i18n.js';
import landingZh from './locales/landing.zh-CN.js';
import landingEn from './locales/landing.en.js';

const messages = { 'zh-CN': landingZh, en: landingEn };
const message = (key, params = {}) => (messages[getLocale()]?.[key] ?? landingZh[key] ?? key).replace(/\{(\w+)\}/g, (match, name) => Object.hasOwn(params, name) ? String(params[name]) : match);
const language = document.querySelector('#entry-language');
const applyLanguage = () => {
  const locale = getLocale();
  document.documentElement.lang = locale;
  document.title = message('title');
  document.querySelector('meta[name=description]')?.setAttribute('content', message('description'));
  document.querySelectorAll('[data-landing]').forEach(element => { element.textContent = message(element.dataset.landing); });
  document.querySelectorAll('[data-landing-aria]').forEach(element => { element.setAttribute('aria-label', message(element.dataset.landingAria)); });
  if (language) { language.value = locale; language.setAttribute('aria-label', message('language')); }
};
applyLanguage();
language?.addEventListener('change', () => {
  try { setLocale(language.value); location.reload(); }
  catch { language.value = getLocale(); const status = document.querySelector('#migration-status'); if (status) status.textContent = message('languageError'); }
});
import { starterWorkspace, STORAGE_KEY, decodeWorkspace, encodeWorkspace } from './model.js';
document.querySelector('#export-local')?.addEventListener('click', () => {
  const status = document.querySelector('#migration-status');
  try {
    const raw = localStorage.getItem(STORAGE_KEY); if (!raw) { status.textContent = message('noLocal'); return; }
    const data = decodeWorkspace(raw), url = URL.createObjectURL(new Blob([encodeWorkspace(data)], { type: 'application/json' })), a = document.createElement('a');
    a.href = url; a.download = 'local-playbook-for-cloud.json'; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 10000); status.textContent = message('exported', { count: data.plays.length });
  } catch { status.textContent = message('readError'); }
});

const demo = document.querySelector('#landing-preview');
if (demo) {
  const examples = starterWorkspace();
  const show = type => { const play = type === 'defense' ? examples.plays.find(p => p.title.includes('Cover 3')) : examples.plays[0]; demo.innerHTML = fieldSVG(play, {}, { thumbnail: true, prefix: 'gateway' }); document.querySelectorAll('[data-demo]').forEach(b => { b.classList.toggle('active',b.dataset.demo === type); b.setAttribute('aria-pressed',String(b.dataset.demo === type)); }); };
  show('offense'); document.querySelectorAll('[data-demo]').forEach(b => b.addEventListener('click',()=>show(b.dataset.demo)));
}
