import { t } from './i18n.js';
import { clone, escapeHTML as e } from './model.js';
import { DEPTH_LIMITS, DEPTH_TEMPLATES, createDepthGroup, copyDepthGroup } from './depth-model.js';

const units = ['offense', 'defense', 'special'];
const unitName = unit => t(`personnel.${unit}`);

export function createPersonnelGroups({ root, getData, getWorkspaceId, canEdit, commit, onSelect }) {
  const q = selector => root.querySelector(selector);
  const groups = () => getData().depthChart.groups;
  let unit = 'offense', workspace = getWorkspaceId(), draft = null;
  const selected = new Map();
  const getSelectedId = () => selected.get(unit) || null;
  root.innerHTML = `<div class="personnel-controls"></div><p class="personnel-notice" role="status"></p>
    <dialog class="roster-dialog personnel-dialog" aria-labelledby="personnel-form-title"></dialog>`;
  const controls = q('.personnel-controls'), dialog = q('dialog'), notice = q('[role=status]');

  function refresh() {
    if (workspace !== getWorkspaceId()) {
      workspace = getWorkspaceId(); selected.clear(); unit = 'offense'; notice.textContent = '';
    }
    const entries = groups(), choices = entries.filter(group => group.unit === unit);
    const current = choices.find(group => group.id === getSelectedId()) || choices[0];
    selected.set(unit, current?.id);
    const editable = canEdit(), full = entries.length >= DEPTH_LIMITS.groups;
    controls.innerHTML = `<div class="personnel-units" role="group" aria-label="${t('personnel.units')}">${units.map(key =>
      `<button type="button" data-personnel-unit="${key}" aria-pressed="${key === unit}">${unitName(key)}</button>`
    ).join('')}</div>
    <div class="personnel-toolbar">${current ? `<label class="personnel-picker">${t('personnel.group')}
      <select data-personnel-group>${choices.map(group => `<option value="${e(group.id)}" ${group.id === current.id ? 'selected' : ''}>${e(group.name)}</option>`).join('')}</select></label>`
      : `<p class="personnel-empty">${e(t('personnel.noGroups', { unit: unitName(unit) }))}</p>`}
      ${editable ? `<div class="personnel-actions"><button type="button" class="roster-secondary" data-personnel-action="new" ${full ? 'disabled' : ''}>${t('personnel.new')}</button>
        ${current ? `<details class="personnel-more"><summary>${t('personnel.manage')}</summary><div>
          <button type="button" data-personnel-action="edit">${t('personnel.edit')}</button>
          <button type="button" data-personnel-action="copy" ${full ? 'disabled' : ''}>${t('personnel.copy')}</button>
          <button type="button" data-personnel-action="remove">${t('personnel.remove')}</button></div></details>` : ''}</div>` : ''}
    </div>${editable && full ? `<p class="personnel-note">${t('personnel.limit', { count: DEPTH_LIMITS.groups })}</p>` : ''}
    ${current?.notes ? `<p class="personnel-note"><strong>${t('personnel.instructions')}</strong> ${e(current.notes)}</p>` : ''}`;
    if (draft) {
      const message = blocked();
      q('[type=submit]').disabled = !!message;
      if (message) q('[role=alert]').textContent = message;
    }
  }

  function blocked() {
    if (draft.book !== getWorkspaceId()) return t('roster.workspaceChanged');
    if (!canEdit()) return t('roster.permissionChanged');
    if (draft.before && !groups().some(group => group.id === draft.before.id && group.unit === draft.unit)) return t('roster.conflict');
    return '';
  }

  function open(action) {
    if (!canEdit() || draft) return;
    const current = groups().find(group => group.id === getSelectedId());
    if (action !== 'new' && !current) return;
    if ((action === 'new' || action === 'copy') && groups().length >= DEPTH_LIMITS.groups) return;
    draft = { action, book: workspace, unit, before: current && action !== 'new' ? clone(current) : null };
    const name = action === 'copy' ? t('personnel.copyName', { name: current.name }).slice(0, DEPTH_LIMITS.name) : current?.name;
    const options = DEPTH_TEMPLATES.filter(template => template.unit === unit);
    const isRemoval = action === 'remove';
    dialog.innerHTML = `<form><h2 id="personnel-form-title">${t(`personnel.${action}`)}</h2>
      ${isRemoval ? `<p>${e(t('personnel.removePrompt', { name: current.name }))}</p>` : `
      <div class="roster-fields">
        <label>${t('personnel.name')}<input name="name" value="${e(action === 'new' ? '' : name)}" maxlength="${DEPTH_LIMITS.name}" required></label>
        ${action === 'new' ? `<label>${t('personnel.layout')}<select name="template">
          ${options.map(template => `<option value="${e(template.id)}">${e(template.name)}</option>`).join('')}
          <option value="">${t('personnel.blank')}</option></select></label>` : ''}
        ${action === 'copy' ? `<label>${t('personnel.destination')}<select name="unit">${units.map(key =>
          `<option value="${key}" ${key === unit ? 'selected' : ''}>${unitName(key)}</option>`).join('')}</select></label>
          <p class="personnel-hint">${e(t('personnel.copyHint', { name: current.name }))}</p>` : ''}
        <label>${t('personnel.instructions')}<textarea name="notes" rows="2" maxlength="${DEPTH_LIMITS.notes}" placeholder="${t('personnel.notePlaceholder')}">${e(action === 'new' ? '' : current.notes)}</textarea></label>
      </div>`}
      <p class="roster-error" role="alert"></p><div class="roster-dialog-actions">
        <button type="button" class="roster-secondary" data-personnel-action="cancel">${t('modal.cancel')}</button>
        <button type="submit" class="${isRemoval ? 'personnel-danger' : 'roster-primary'}">${t(isRemoval ? 'personnel.remove' : 'roster.save')}</button>
      </div></form>`;
    q('details')?.removeAttribute('open');
    dialog.showModal();
    q(isRemoval ? '[data-personnel-action=cancel]' : '[name=name]').focus();
  }

  function close() {
    const action = draft.action;
    draft = null;
    dialog.close();
    dialog.replaceChildren();
    refresh();
    (q(action === 'new' ? '[data-personnel-action=new]' : 'summary') || q('[data-personnel-group]') || q('[aria-pressed=true]'))?.focus();
  }

  function save(event) {
    if (event.target !== q('form')) return;
    event.stopPropagation(); event.preventDefault();
    if (!draft) return;
    const error = q('[role=alert]'), message = blocked();
    if (message) { error.textContent = message; return; }
    const { action, before } = draft;
    const current = before && groups().find(group => group.id === before.id);
    const name = q('[name=name]')?.value.trim(), notes = q('[name=notes]')?.value.trim();
    const template = q('[name=template]')?.value;
    const targetUnit = q('[name=unit]')?.value || draft.unit;
    const creating = action === 'new' || action === 'copy';
    if (creating && groups().length >= DEPTH_LIMITS.groups) { error.textContent = t('personnel.limit', { count: DEPTH_LIMITS.groups }); return; }
    if (action !== 'remove') {
      if (!name) { error.textContent = t('personnel.required'); q('[name=name]').focus(); return; }
      const nextName = action === 'edit' && name === before.name ? current.name : name;
      if (groups().some(group => group.unit === targetUnit && (creating || group.id !== current.id) && group.name.toLowerCase() === nextName.toLowerCase())) {
        error.textContent = t('personnel.duplicate'); q('[name=name]').focus(); return;
      }
    }
    // Keep edits to other fields/positions that arrived while this form was open.
    if ((action === 'remove' && JSON.stringify(before) !== JSON.stringify(current))
        || (action === 'edit' && ((name !== before.name && current.name !== before.name) || (notes !== before.notes && current.notes !== before.notes)))) {
      error.textContent = t('roster.conflict'); return;
    }
    let nextId = current?.id;
    const saved = commit(data => {
      const entries = data.depthChart.groups;
      if (creating) {
        const group = action === 'new' ? createDepthGroup(template, name, draft.unit) : copyDepthGroup(current, name);
        group.unit = targetUnit;
        group.notes = action === 'copy' && notes === before.notes ? current.notes : notes;
        entries.push(group); nextId = group.id;
      } else if (action === 'remove') {
        data.depthChart.groups = entries.filter(group => group.id !== current.id);
        nextId = null;
      } else {
        const group = entries.find(entry => entry.id === current.id);
        if (name !== before.name) group.name = name;
        if (notes !== before.notes) group.notes = notes;
      }
    });
    if (saved === false) { error.textContent = t('roster.saveFailed'); return; }
    unit = targetUnit;
    selected.set(unit, nextId);
    close();
    onSelect(getSelectedId());
    notice.textContent = t(action === 'remove' ? 'personnel.removed' : 'personnel.saved');
  }

  function click(event) {
    const unitButton = event.target.closest('[data-personnel-unit]');
    if (!draft && unitButton && units.includes(unitButton.dataset.personnelUnit)) {
      unit = unitButton.dataset.personnelUnit; notice.textContent = '';
      refresh(); q('[aria-pressed=true]').focus(); onSelect(getSelectedId()); return;
    }
    const button = event.target.closest('[data-personnel-action]');
    if (!button || button.disabled) return;
    if (button.dataset.personnelAction === 'cancel') { if (draft) close(); }
    else open(button.dataset.personnelAction);
  }

  function change(event) {
    if (!draft && event.target.matches('[data-personnel-group]')) {
      selected.set(unit, event.target.value); notice.textContent = '';
      refresh(); q('[data-personnel-group]').focus(); onSelect(getSelectedId());
    }
  }

  function cancel(event) {
    if (event.target === dialog && draft) { event.preventDefault(); close(); }
  }

  root.addEventListener('click', click);
  root.addEventListener('change', change);
  root.addEventListener('submit', save);
  dialog.addEventListener('cancel', cancel);
  refresh();
  return {
    refresh, getSelectedId, isEditing: () => !!draft,
    destroy() {
      if (dialog.open) dialog.close();
      draft = null;
      root.removeEventListener('click', click);
      root.removeEventListener('change', change);
      root.removeEventListener('submit', save);
      dialog.removeEventListener('cancel', cancel);
      root.replaceChildren();
    }
  };
}
