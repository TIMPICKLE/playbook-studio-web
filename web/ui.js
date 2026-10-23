import { escapeHTML as e } from './model.js';
export const arrowIcon = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M4 12h15m-6-6 6 6-6 6"/></svg>';
export function feedback(message, type = 'error', root = document) {
  const box = root.querySelector('.form-feedback');
  if (!box) return;
  box.hidden = false; box.dataset.type = type; box.textContent = message;
  if (type === 'error') box.setAttribute('role', 'alert'); else box.setAttribute('role', 'status');
}
export function resetFeedback(root = document) { const box = root.querySelector('.form-feedback'); if (box) { box.hidden = true; box.textContent = ''; } }
export const feedbackBox = () => '<div class="form-feedback" role="alert" aria-live="polite" hidden></div>';
export function passwordField(id, label, autocomplete = 'current-password', help = '') {
  return `<label class="form-field" for="${id}"><span>${e(label)}</span></label><div class="password-input"><input type="password" id="${id}" autocomplete="${autocomplete}" required minlength="8" maxlength="128" aria-describedby="${id}-help"><button type="button" data-cloud-action="toggle-password" data-target="${id}" aria-label="显示${e(label)}" aria-pressed="false">显示</button></div><small class="field-help" id="${id}-help">${e(help)}</small>`;
}
export function readableError(error) {
  if (error.name === 'TimeoutError' || error.name === 'AbortError') return '连接超时，请检查网络后重试。你的更改仍保留在本机。';
  if (error instanceof TypeError) return '无法连接服务器，请检查网络后重试。';
  return error.message || '操作未完成，请稍后重试。';
}
