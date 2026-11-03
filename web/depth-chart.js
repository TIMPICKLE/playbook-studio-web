import { t } from './i18n.js';
import { escapeHTML as e } from './model.js';
import { bindDepthTemplate, createDepthSlot, DEPTH_LIMITS } from './depth-model.js';
import { renderDepthFormation } from './depth-formation.js';

const views = {
  field: ['depth.viewFormation', 'depth.formationTitle'],
  table: ['depth.viewRanks', 'depth.positions'],
  starters: ['depth.viewStarters', 'depth.lineup'],
};
const rankLabel = index => index ? t('depth.backup', { rank: index }) : t('depth.starter');
const playerLabel = player => [player.number && `#${player.number}`, player.name, player.position].filter(Boolean).join(' · ');

function playerChip(player) {
  if (!player) return `<span class="depth-open">${t('depth.vacant')}</span>`;
  return `<span class="depth-athlete">${player.number ? `<b class="depth-jersey">#${e(player.number)}</b>` : ''}<span>${e(player.name)}</span></span>`;
}

function slotRow(slot, players, editable) {
  const backups = slot.playerIds.slice(1);
  return `<tr>
    <th scope="row" class="depth-position">${e(slot.label)}</th>
    <td class="depth-starter"><span class="depth-mobile-label" aria-hidden="true">${t('depth.starter')}</span>${playerChip(players.get(slot.playerIds[0]))}</td>
    <td class="depth-backups"><span class="depth-mobile-label" aria-hidden="true">${t('depth.backups')}</span>${backups.length
      ? `<ol>${backups.map((id, index) => `<li><span class="depth-rank" aria-hidden="true">${index + 1}</span>${playerChip(players.get(id))}</li>`).join('')}</ol>`
      : `<span class="depth-muted">${t('depth.noBackups')}</span>`}</td>
    ${editable ? `<td class="depth-edit-cell"><button type="button" class="roster-text" data-depth-chart="edit" data-slot="${e(slot.id)}" aria-label="${e(t('depth.editLabel', { label: slot.label }))}">${t('depth.edit')}</button></td>` : ''}
  </tr>`;
}

function starterList(slots, players, editable) {
  return `<ul class="depth-lineup" aria-labelledby="depth-heading">${slots.map(slot => {
    const player = players.get(slot.playerIds[0]);
    const content = `<strong>${e(slot.label)}</strong>${playerChip(player)}`;
    return `<li>${editable ? `<button type="button" data-depth-chart="edit" data-slot="${e(slot.id)}"
      aria-label="${e(t('depth.quickEdit', { label: slot.label, player: player ? playerLabel(player) : t('depth.vacant') }))}">${content}</button>`
      : `<div>${content}</div>`}</li>`;
  }).join('')}</ul>`;
}

function depthTable(slots, players, editable) {
  return `<table aria-labelledby="depth-heading"><thead><tr><th scope="col">${t('modal.position')}</th>
    <th scope="col">${t('depth.starter')}</th><th scope="col">${t('depth.backups')}</th>${editable ? `<th scope="col">${t('roster.actions')}</th>` : ''}</tr></thead>
    <tbody>${slots.map(slot => slotRow(slot, players, editable)).join('')}</tbody></table>`;
}

export function createDepthChartView({ root, getData, getWorkspaceId, getSelectedId, canEdit, commit, onChange }) {
  let draft = null;
  let mode = 'field', selectedSlotId = null, playerId = '', previousGroup, workspace = getWorkspaceId();
  root.innerHTML = `<div class="depth-sheet"></div><p class="depth-status" role="status"></p>
    <dialog class="roster-dialog depth-dialog" aria-labelledby="depth-editor-title"></dialog>`;
  const sheet = root.querySelector('.depth-sheet');
  const dialog = root.querySelector('.depth-dialog');
  const notice = root.querySelector('.depth-status');
  const group = () => getData().depthChart?.groups.find(item => item.id === getSelectedId());
  const alert = message => { dialog.querySelector('[role="alert"]').textContent = message; };
  const errorForDraft = () => {
    if (draft.workspace !== getWorkspaceId()) return t('roster.workspaceChanged');
    if (!canEdit()) return t('roster.permissionChanged');
    if (draft.groupId !== getSelectedId() || !group()) return t('roster.conflict');
    if (draft.before) {
      const slot = group().slots.find(item => item.id === draft.before.id);
      if (!slot || slot.label !== draft.before.label || JSON.stringify(slot.playerIds) !== JSON.stringify(draft.before.playerIds)) return t('roster.conflict');
    }
    return '';
  };

  function refresh() {
    const current = group();
    const editable = canEdit();
    const roster = getData().roster;
    const players = new Map(roster.map(player => [player.id, player]));
    if (draft) {
      const error = errorForDraft();
      dialog.querySelector('[type="submit"]').disabled = Boolean(error);
      if (error) alert(error);
    }
    if (workspace !== getWorkspaceId()) {
      workspace = getWorkspaceId();
      selectedSlotId = null;
      playerId = '';
      mode = 'field';
    }
    if (!current) { previousGroup = null; sheet.replaceChildren(); notice.textContent = ''; return; }
    const slots = current.slots;
    if (!players.has(playerId)) playerId = '';
    if (current.id !== previousGroup || !slots.some(slot => slot.id === selectedSlotId)) {
      selectedSlotId = (slots.find(slot => playerId && slot.playerIds.includes(playerId)) || slots[0])?.id;
    }
    previousGroup = current.id;
    let body;
    if (!slots.length) body = `<p class="depth-empty">${t('depth.noSlots')}</p>`;
    else if (mode === 'field') body = renderDepthFormation(current, players, selectedSlotId, editable, playerId);
    else if (mode === 'table') body = depthTable(slots, players, editable);
    else body = starterList(slots, players, editable);
    sheet.innerHTML = `<section class="depth-panel" aria-labelledby="depth-heading">
      <div class="depth-heading"><div class="depth-heading-title"><h3 id="depth-heading">${t(views[mode][1])}</h3>
        <p>${t('depth.filled', { filled: slots.filter(slot => players.has(slot.playerIds[0])).length, total: slots.length })}</p></div>
        ${slots.length ? `<div class="depth-view-picker" role="group" aria-label="${t('depth.viewLabel')}">
        ${Object.entries(views).map(([key, labels]) => `<button type="button" data-depth-chart="mode" data-mode="${key}" aria-controls="depth-assignments" aria-pressed="${key === mode}">${t(labels[0])}</button>`).join('')}</div>` : ''}
        ${editable ? `<button type="button" class="roster-secondary" data-depth-chart="add" ${slots.length >= DEPTH_LIMITS.slots ? 'disabled' : ''}>${t('depth.add')}</button>` : ''}</div>
      ${!roster.length ? `<p class="depth-hint">${t('depth.noRoster')}</p>` : ''}
      <div id="depth-assignments">${body}</div>
      </section>`;
    const picker = sheet.querySelector('[data-formation-player]');
    if (picker) picker.value = playerId;
  }

  function rankEditor() {
    const list = dialog.querySelector('.depth-ranks');
    const roster = getData().roster;
    const otherStarters = new Set(group()?.slots.filter(slot => slot.id !== draft.before?.id).map(slot => slot.playerIds[0]));
    list.innerHTML = draft.ranks.map((value, index) => {
      const title = (key) => e(t(key, { rank: index }));
      return `<div class="depth-rank-row"><label><span>${rankLabel(index)}</span>
        <select data-rank="${index}"><option value="">${t('depth.vacant')}</option>${roster.map(player => {
          const used = value !== player.id && (draft.ranks.includes(player.id) || (!index && otherStarters.has(player.id)));
          return `<option value="${e(player.id)}" ${used ? 'disabled' : ''}>${e(playerLabel(player))}</option>`;
        }).join('')}</select></label>
        ${index ? `<div class="depth-rank-tools"><button type="button" data-depth-chart="promote" data-index="${index}" aria-label="${title('depth.promoteHint')}" title="${title('depth.promoteHint')}" ${value ? '' : 'disabled'}>${t('depth.promote')}</button>
          ${index > 1 ? `<button type="button" data-depth-chart="up" data-index="${index}" aria-label="${title('depth.up')}" title="${title('depth.up')}">↑</button>` : ''}
          ${index + 1 < draft.ranks.length ? `<button type="button" data-depth-chart="down" data-index="${index}" aria-label="${title('depth.down')}" title="${title('depth.down')}">↓</button>` : ''}
          <button type="button" data-depth-chart="drop" data-index="${index}" aria-label="${title('depth.removeRank')}" title="${title('depth.removeRank')}">×</button></div>` : ''}</div>`;
    }).join('');
    list.querySelectorAll('[data-rank]').forEach((select, index) => { select.value = draft.ranks[index] || ''; });
    dialog.querySelector('[data-depth-chart="add-rank"]').disabled = draft.ranks.length >= DEPTH_LIMITS.ranks;
  }

  function open(id) {
    const current = group();
    if (!current || !canEdit() || draft) return;
    const slot = id ? current.slots.find(item => item.id === id) : null;
    if ((id && !slot) || (!id && current.slots.length >= DEPTH_LIMITS.slots)) return;
    draft = {
      groupId: current.id, workspace: getWorkspaceId(),
      before: slot ? { id, label: slot.label, playerIds: [...slot.playerIds] } : null,
      ranks: slot?.playerIds.length ? [...slot.playerIds] : [null]
    };
    notice.textContent = '';
    const heading = slot ? t('depth.editLabel', { label: slot.label }) : t('depth.add');
    dialog.innerHTML = `<form><h2 id="depth-editor-title">${e(heading)}</h2>
      <div class="roster-fields"><label>${t('depth.label')}<input name="label" value="${e(slot?.label)}" placeholder="${e(t('depth.labelHint'))}" maxlength="${DEPTH_LIMITS.label}" required></label>
        <fieldset class="depth-rank-fieldset"><legend>${t('depth.positions')}</legend><p>${t('depth.rankHint')}</p>
          <div class="depth-ranks"></div><button type="button" class="roster-secondary" data-depth-chart="add-rank">＋ ${t('depth.addRank')}</button>
        </fieldset></div><p class="depth-dialog-status" role="status"></p><p class="roster-error" role="alert"></p>
      <div class="roster-dialog-actions">${slot ? `<button type="button" class="roster-remove" data-depth-chart="remove">${t('depth.remove')}</button>` : ''}
      <button type="button" class="roster-secondary" data-depth-chart="close">${t('modal.cancel')}</button>
      <button type="submit" class="roster-primary">${t('roster.save')}</button></div></form>`;
    rankEditor();
    dialog.showModal();
    dialog.querySelector(slot ? '[data-rank="0"]' : '[name="label"]').focus();
  }

  function close(slotId) {
    draft = null;
    if (slotId) selectedSlotId = slotId;
    dialog.close();
    dialog.replaceChildren();
    refresh();
    const button = Array.from(sheet.querySelectorAll('[data-slot]')).find(el => el.dataset.slot === slotId);
    (button || sheet.querySelector('[data-depth-chart="add"]'))?.focus();
  }

  function assignedElsewhere(id) {
    if (!id) return '';
    const other = group().slots.find(slot => slot.id !== draft.before?.id && slot.playerIds[0] === id);
    return other && t('depth.starterTaken', { label: other.label, name: getData().roster.find(player => player.id === id)?.name || '' });
  }

  function save(remove = false) {
    if (!draft) return;
    const blocked = errorForDraft();
    if (blocked) { alert(blocked); return; }
    const current = group();
    const before = draft.before;
    const input = dialog.querySelector('[name="label"]');
    const label = input.value.trim();
    // Keep requested vacancies, including a starter awaiting assignment ahead of a backup.
    const playerIds = draft.ranks.length === 1 && draft.ranks[0] === null ? [] : [...draft.ranks];
    if (remove) {
      if (!before || !root.ownerDocument.defaultView.confirm(t('depth.confirmRemove', { label: before.label }))) return;
    } else {
      if (!label) { alert(t('depth.labelRequired')); input.focus(); return; }
      if (current.slots.some(slot => slot.id !== before?.id && slot.label.toLowerCase() === label.toLowerCase())) { alert(t('depth.labelTaken')); input.focus(); return; }
      const assigned = playerIds.filter(Boolean);
      if (assigned.some(id => !getData().roster.some(player => player.id === id))) { alert(t('depth.playerGone')); return; }
      if (new Set(assigned).size !== assigned.length) { alert(t('depth.duplicate')); return; }
      const starterError = assignedElsewhere(playerIds[0]);
      if (starterError) { alert(starterError); return; }
      if (!before && current.slots.length >= DEPTH_LIMITS.slots) { alert(t('depth.limit')); return; }
      if (before?.label === label && JSON.stringify(before.playerIds) === JSON.stringify(playerIds)) { close(before.id); return; }
    }
    const slot = before || createDepthSlot(label);
    const ok = commit(data => {
      const target = data.depthChart.groups.find(item => item.id === current.id);
      if (remove) target.slots = target.slots.filter(item => item.id !== slot.id);
      else if (before) Object.assign(target.slots.find(item => item.id === slot.id), { label, playerIds });
      else target.slots.push({ ...slot, label, playerIds });
      if (!remove && target.templateId && (!before || label !== before.label)) bindDepthTemplate(target, target.templateId);
    });
    if (ok === false) { alert(t('roster.saveFailed')); return; }
    onChange?.();
    close(remove ? null : slot.id);
    notice.textContent = t('depth.updated');
  }

  function click(event) {
    const button = event.target.closest('[data-depth-chart]');
    if (!button || button.disabled) return;
    const action = button.dataset.depthChart;
    if (action === 'mode' && Object.hasOwn(views, button.dataset.mode)) {
      mode = button.dataset.mode;
      refresh();
      sheet.querySelector(`[data-mode="${mode}"]`)?.focus({ preventScroll: true });
      return;
    }
    if (action === 'inspect') {
      selectedSlotId = button.dataset.slot;
      refresh();
      [...sheet.querySelectorAll('[data-depth-chart="inspect"]')].find(el => el.dataset.slot === selectedSlotId)?.focus({ preventScroll: true });
      return;
    }
    if (action === 'add' || action === 'edit') { open(button.dataset.slot); return; }
    if (!draft) return;
    if (action === 'close') { close(draft.before?.id); return; }
    const blocked = errorForDraft();
    if (blocked) { alert(blocked); return; }
    if (action === 'remove') { save(true); return; }
    const index = Number(button.dataset.index);
    const status = dialog.querySelector('.depth-dialog-status');
    status.textContent = '';
    alert('');
    let focusAt = index;
    if (action === 'add-rank') {
      if (draft.ranks.length >= DEPTH_LIMITS.ranks) return;
      draft.ranks.push(null);
      focusAt = draft.ranks.length - 1;
    } else if (action === 'drop') {
      draft.ranks.splice(index, 1);
      focusAt = Math.min(index, draft.ranks.length - 1);
    } else {
      if (action === 'promote') {
        const starterError = assignedElsewhere(draft.ranks[index]);
        if (starterError) { alert(starterError); return; }
        focusAt = 0;
        status.textContent = t('depth.promoted', { rank: index });
      } else if (action === 'up') focusAt = index - 1;
      else if (action === 'down') focusAt = index + 1;
      else return;
      [draft.ranks[index], draft.ranks[focusAt]] = [draft.ranks[focusAt], draft.ranks[index]];
    }
    rankEditor();
    dialog.querySelector(`[data-rank="${focusAt}"]`)?.focus();
  }

  function change(event) {
    if (event.target.matches('[data-formation-player]')) {
      playerId = event.target.value;
      selectedSlotId = group()?.slots.find(slot => playerId && slot.playerIds.includes(playerId))?.id;
      refresh();
      sheet.querySelector('[data-formation-player]')?.focus({ preventScroll: true });
      return;
    }
    const select = event.target.closest('[data-rank]');
    if (!select || !draft) return;
    const blocked = errorForDraft();
    if (blocked) { alert(blocked); return; }
    const index = Number(select.dataset.rank);
    draft.ranks[index] = select.value || null;
    alert('');
    rankEditor();
    dialog.querySelector(`[data-rank="${index}"]`).focus();
  }
  function submit(event) { event.preventDefault(); save(); }
  function cancel(event) { event.preventDefault(); if (draft) close(draft.before?.id); }
  root.addEventListener('click', click);
  root.addEventListener('change', change);
  dialog.addEventListener('submit', submit);
  dialog.addEventListener('cancel', cancel);
  return {
    refresh, isEditing: () => Boolean(draft),
    destroy() {
      root.removeEventListener('click', click);
      root.removeEventListener('change', change);
      if (draft) dialog.close();
      draft = null;
      root.replaceChildren();
    }
  };
}
