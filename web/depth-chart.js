import { t } from './i18n.js';
import { createDepthMoveFeedback, depthSurface, describeDepthMove } from './depth-chart-motion.js';
import { escapeHTML as e } from './model.js';
import { bindDepthTemplate, createDepthSlot, DEPTH_LIMITS, planDepthPlayerMove } from './depth-model.js';
import { renderDepthFormation, depthRankActions, depthDragSource, depthPlayerPicker } from './depth-formation.js';

const views = {
  field: ['depth.viewFormation', 'depth.formationTitle'],
  table: ['depth.viewRanks', 'depth.positions'],
  starters: ['depth.viewStarters', 'depth.lineup'],
};
const rankLabel = index => index ? t('depth.backup', { rank: index }) : t('depth.starter');
const playerLabel = player => [player.number && `#${player.number}`, player.name, player.position].filter(Boolean).join(' · ');

function playerChip(player, move = null) {
  if (!player) return `<span class="depth-open">${t('depth.vacant')}</span>`;
  const name = `${player.number ? `<b class="depth-jersey">#${e(player.number)}</b>` : ''}<span data-depth-label="${e(player.id)}">${e(player.name)}</span>`;
  if (!move) return `<span class="depth-athlete">${name}</span>`;
  const { slot, index } = move;
  const label = t('depth.moveAssignment', { name: player.name, label: slot.label, rank: rankLabel(index) });
  return `<button type="button" class="depth-athlete roster-text" data-depth-chart="pick-rank" aria-label="${e(label)}" title="${e(label)}"
    ${depthDragSource(player.id, slot.id, index)}>${name}</button>`;
}

function slotRow(slot, players, editable, groupId, assigning) {
  const backups = slot.playerIds.slice(1);
  const drop = index => editable ? `data-depth-drop-slot="${e(slot.id)}" data-depth-drop-index="${index}"` : '';
  const place = (index, label) => `<button type="button" class="roster-text" data-depth-chart="place-player" data-slot="${e(slot.id)}" data-index="${index}"
    aria-label="${e(slot.label)} · ${e(label)}">${e(label)}</button>`;
  function rank(index) {
    const chip = playerChip(players.get(slot.playerIds[index]), editable && !assigning ? { slot, index } : null);
    if (!assigning) return chip + depthRankActions(slot, index, groupId, editable);
    return chip + place(index, index ? t('depth.placeAtBackup', { rank: index }) : t('depth.placeStarter'));
  }
  const append = Math.max(1, slot.playerIds.length);
  return `<tr>
    <th scope="row" class="depth-position">${e(slot.label)}</th>
    <td class="depth-starter" ${drop(0)}><span class="depth-mobile-label" aria-hidden="true">${t('depth.starter')}</span>${rank(0)}</td>
    <td class="depth-backups"><span class="depth-mobile-label" aria-hidden="true">${t('depth.backups')}</span>${backups.length
      ? `<ol>${backups.map((_, i) => `<li ${drop(i + 1)}><span class="depth-rank" aria-hidden="true">${i + 1}</span>${rank(i + 1)}</li>`).join('')}</ol>`
      : `<span class="depth-muted">${t('depth.noBackups')}</span>`}
      ${editable ? `<span class="depth-backup-drop" ${drop(append)}>${assigning ? place(append, t('depth.placeBackup')) : t('depth.dropBackup')}</span>` : ''}<div data-depth-feedback="${e(slot.id)}"></div></td>
    ${editable ? `<td class="depth-edit-cell"><button type="button" class="roster-text" data-depth-chart="edit" data-slot="${e(slot.id)}" aria-label="${e(t('depth.editLabel', { label: slot.label }))}">${t('depth.edit')}</button></td>` : ''}
  </tr>`;
}

function starterList(slots, players, editable, assigning) {
  return `<ul class="depth-lineup" aria-labelledby="depth-heading">${slots.map(slot => {
    const player = players.get(slot.playerIds[0]);
    const content = `<strong>${e(slot.label)}</strong>${playerChip(player)}`;
    return `<li>${editable ? `<button type="button" data-depth-chart="${assigning ? 'place-player' : 'edit'}" data-slot="${e(slot.id)}" data-index="0" data-depth-drop-slot="${e(slot.id)}" data-depth-drop-index="0" ${depthDragSource(player?.id, slot.id, 0)}
      aria-label="${e(assigning ? t('depth.assignToRole', { label: slot.label }) : t('depth.quickEdit', { label: slot.label, player: player ? playerLabel(player) : t('depth.vacant') }))}">${content}</button>`
      : `<div>${content}</div>`}</li>`;
  }).join('')}</ul>`;
}

function depthTable(slots, players, editable, groupId, assigning) {
  return `<table aria-labelledby="depth-heading"><thead><tr><th scope="col">${t('modal.position')}</th>
    <th scope="col">${t('depth.starter')}</th><th scope="col">${t('depth.backups')}</th>${editable ? `<th scope="col">${t('roster.actions')}</th>` : ''}</tr></thead>
    <tbody>${slots.map(slot => slotRow(slot, players, editable, groupId, assigning)).join('')}</tbody></table>`;
}

export function createDepthChartView({ root, getData, getWorkspaceId, getSelectedId, canEdit, commit, onChange, sessionStore = new Map() }) {
  let draft = null;
  let mode = 'field', selectedSlotId = null, playerId = '', previousGroup, workspace = getWorkspaceId();
  let selectionByGroup = new Map(), lastRankChange = null, feedbackSlotId = null;
  let dragging = null, assignment = null;
  function remember() {
    if (previousGroup) selectionByGroup.set(previousGroup, selectedSlotId);
    sessionStore.set(workspace, { mode, playerId, selectionByGroup: new Map(selectionByGroup) });
  }
  function restore() {
    const saved = sessionStore.get(workspace);
    mode = Object.hasOwn(views, saved?.mode) ? saved.mode : 'field';
    playerId = saved?.playerId || '';
    selectionByGroup = new Map(saved?.selectionByGroup || []);
    previousGroup = null; selectedSlotId = null;
  }
  restore();
  root.innerHTML = `<p class="depth-status" role="status"></p><div class="depth-sheet"></div>
    <dialog class="roster-dialog depth-dialog" aria-labelledby="depth-editor-title"></dialog>`;
  const sheet = root.querySelector('.depth-sheet');
  const motion = createDepthMoveFeedback(sheet);
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
    motion.cancel();
    // Preserve the live receipt while replacing the sheet that currently hosts it.
    if (notice.parentElement !== root) root.insertBefore(notice, sheet);
    if (workspace !== getWorkspaceId()) {
      remember(); workspace = getWorkspaceId(); restore(); lastRankChange = null;
    }
    const current = group();
    const editable = canEdit();
    const roster = getData().roster;
    const players = new Map(roster.map(player => [player.id, player]));
    if (draft) {
      const error = errorForDraft();
      dialog.querySelector('[type="submit"]').disabled = Boolean(error) || !!draft.removing;
      const confirm = dialog.querySelector('[data-depth-chart="confirm-remove"]');
      if (confirm) confirm.disabled = Boolean(error);
      if (error) alert(error);
    }
    if (!current) { previousGroup = null; sheet.replaceChildren(); notice.textContent = ''; return; }
    if (lastRankChange && (lastRankChange.groupId !== current.id || !lastRankChange.changes.every(change => current.slots.some(slot => slot.id === change.id && JSON.stringify(slot.playerIds) === JSON.stringify(change.after))))) {
      lastRankChange = null; notice.textContent = '';
    }
    if (assignment && (!editable || !stampMatches(assignment))) assignment = null;
    const slots = current.slots;
    if (!players.has(playerId)) playerId = '';
    if (current.id !== previousGroup) {
      if (previousGroup) selectionByGroup.set(previousGroup, selectedSlotId);
      selectedSlotId = selectionByGroup.get(current.id);
    }
    if (!slots.some(slot => slot.id === selectedSlotId)) {
      selectedSlotId = (slots.find(slot => playerId && slot.playerIds.includes(playerId)) || slots[0])?.id;
    }
    previousGroup = current.id;
    let body;
    if (!slots.length) body = `<p class="depth-empty">${t('depth.noSlots')}</p>`;
    else if (mode === 'field') body = renderDepthFormation(current, players, selectedSlotId, editable, playerId, !!assignment);
    else if (mode === 'table') body = depthPlayerPicker(players, playerId, editable, !!assignment) + depthTable(slots, players, editable, current.id, !!assignment);
    else body = depthPlayerPicker(players, playerId, editable, !!assignment) + starterList(slots, players, editable, !!assignment);
    sheet.innerHTML = `<section class="depth-panel" aria-labelledby="depth-heading">
      <div class="depth-heading"><div class="depth-heading-title"><h3 id="depth-heading">${t(views[mode][1])}</h3>
        <p>${t('depth.filled', { filled: slots.filter(slot => players.has(slot.playerIds[0])).length, total: slots.length })}</p></div>
        ${slots.length ? `<div class="depth-view-picker" role="group" aria-label="${t('depth.viewLabel')}">
        ${Object.entries(views).map(([key, labels]) => `<button type="button" data-depth-chart="mode" data-mode="${key}" aria-controls="depth-assignments" aria-pressed="${key === mode}">${t(labels[0])}</button>`).join('')}</div>` : ''}
        ${editable ? `<button type="button" class="roster-secondary" data-depth-chart="add" ${slots.length >= DEPTH_LIMITS.slots ? 'disabled' : ''}>${t('depth.add')}</button>` : ''}</div>
      ${!roster.length ? `<p class="depth-hint">${t('depth.noRoster')}</p>` : ''}
      ${editable && roster.length ? `<p class="depth-transfer-hint">${t('depth.dragHint')}</p>` : ''}
      <div id="depth-assignments">${body}</div>
      </section>`;
    const picker = sheet.querySelector('[data-formation-player]');
    if (picker) picker.value = playerId;
    remember();
    placeFeedback();
    root.classList.toggle('depth-assigning', !!assignment);
  }

  function placeFeedback() {
    const host = [...sheet.querySelectorAll('[data-depth-feedback]')].find(item => item.dataset.depthFeedback === feedbackSlotId);
    if (host) host.append(notice);
    else if (notice.parentElement !== root) root.insertBefore(notice, sheet);
  }

  function rankFeedback(message, undo = false, error = false, slotId = null) {
    feedbackSlotId = slotId;
    notice.textContent = message;
    notice.dataset.state = error ? 'error' : 'saved';
    if (undo) {
      const button = root.ownerDocument.createElement('button');
      button.type = 'button'; button.className = 'roster-text';
      button.dataset.depthChart = 'undo-ranks'; button.textContent = t('depth.undoChange');
      notice.append(' ', button);
    }
    placeFeedback();
  }

  function quickRank(button) {
    if (draft) return;
    if (!['quick-promote', 'quick-up', 'quick-down'].includes(button.dataset.depthChart)) return;
    if (!canEdit()) { refresh(); rankFeedback(t('roster.permissionChanged'), false, true); return; }
    const current = group(), slot = current?.slots.find(item => item.id === button.dataset.slot);
    if (!slot || button.dataset.group !== current.id || button.dataset.ranks !== JSON.stringify(slot.playerIds)) {
      refresh(); rankFeedback(t('depth.changedRetry'), false, true); return;
    }
    const index = slot.playerIds.indexOf(button.dataset.player);
    if (index < 1 || !getData().roster.some(player => player.id === button.dataset.player)) {
      refresh(); rankFeedback(t('depth.changedRetry'), false, true); return;
    }
    const action = button.dataset.depthChart;
    const targetIndex = action === 'quick-promote' ? 0 : action === 'quick-up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= slot.playerIds.length || (action === 'quick-up' && targetIndex === 0)) return;
    const other = targetIndex === 0 && current.slots.find(item => item.id !== slot.id && item.playerIds[0] === slot.playerIds[index]);
    if (other) { rankFeedback(t('depth.starterTaken', { label: other.label, name: getData().roster.find(player => player.id === slot.playerIds[index])?.name || '' }), false, true, slot.id); return; }
    const before = [...slot.playerIds], after = [...before];
    [after[index], after[targetIndex]] = [after[targetIndex], after[index]];
    const surface = depthSurface(button);
    applyRanks([{ id: slot.id, before, after }], { playerId: button.dataset.player, slotId: slot.id, surface }, slot.id, surface, action);
  }

  function commitRanks(changes) {
    return commit(data => {
      const current = data.depthChart.groups.find(item => item.id === getSelectedId());
      for (const change of changes) current.slots.find(item => item.id === change.id).playerIds = [...change.after];
    });
  }

  function moveMessage(move, undone) {
    const place = point => {
      const slot = group().slots.find(item => item.id === point.slotId);
      return slot ? `${slot.label} · ${rankLabel(point.index)}` : t('roster.directory');
    };
    const name = getData().roster.find(player => player.id === move.playerId)?.name || '';
    return t(undone ? 'depth.moveUndone' : 'depth.moveDone', { name, from: place(move.from), to: place(move.to) });
  }

  function applyRanks(changes, source, slotId, surface, action) {
    if (!changes.length) return false;
    const move = describeDepthMove(changes, source, slotId, surface);
    const before = motion.capture(move);
    if (commitRanks(changes) === false) { rankFeedback(t('roster.saveFailed'), false, true, slotId); return false; }
    lastRankChange = { workspace: getWorkspaceId(), groupId: group().id, move,
      changes: changes.map(change => ({ id: change.id, before: [...change.before], after: [...change.after] })) };
    selectedSlotId = slotId;
    assignment = null;
    onChange?.(); refresh();
    rankFeedback(moveMessage(move, false), true, false, slotId);
    motion.present(move, before, action);
    return true;
  }

  const ranksSnapshot = current => JSON.stringify(current?.slots.map(slot => [slot.id, slot.playerIds]));
  const stamp = source => ({ source, workspace: getWorkspaceId(), groupId: group()?.id, ranks: ranksSnapshot(group()) });
  function stampMatches(value) {
    return value.workspace === getWorkspaceId() && value.groupId === getSelectedId() && value.ranks === ranksSnapshot(group());
  }

  function placePlayer(value, slotId, index, target) {
    if (draft || !value) return;
    if (!canEdit() || !stampMatches(value)) {
      assignment = null; refresh(); rankFeedback(t(canEdit() ? 'depth.changedRetry' : 'roster.permissionChanged'), false, true); return;
    }
    const plan = planDepthPlayerMove(group(), new Set(getData().roster.map(player => player.id)), value.source, { slotId, index });
    if (plan.error) {
      rankFeedback(t('depth.' + plan.error, { label: plan.label || '', name: getData().roster.find(player => player.id === value.source.playerId)?.name || '' }), false, true, slotId); return;
    }
    if (!plan.changes.length) { assignment = null; refresh(); return; }
    applyRanks(plan.changes, value.source, slotId, depthSurface(target));
  }

  function clearDropTargets() {
    for (const element of root.querySelectorAll('.depth-drop-active')) element.classList.remove('depth-drop-active');
    root.classList.remove('depth-dragging');
  }

  function sourceFrom(element) {
    const { depthSource: playerId, sourceSlot: slotId, sourceIndex } = element.dataset;
    return { playerId, slotId, index: Number(sourceIndex), surface: depthSurface(element) };
  }

  function dragStart(event) {
    const element = event.target.closest('[data-depth-source]');
    if (!element || !canEdit() || draft || !event.dataTransfer) return;
    dragging = stamp(sourceFrom(element));
    event.dataTransfer.setData('application/x-playbook-depth-player', JSON.stringify(dragging));
    event.dataTransfer.effectAllowed = 'move';
    root.classList.add('depth-dragging');
  }

  function dragOver(event) {
    const target = event.target.closest('[data-depth-drop-slot]');
    if (!dragging || !target || !canEdit()) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    for (const element of root.querySelectorAll('.depth-drop-active')) element.classList.remove('depth-drop-active');
    target.classList.add('depth-drop-active');
  }

  function drop(event) {
    const target = event.target.closest('[data-depth-drop-slot]');
    if (!target || !dragging) return;
    event.preventDefault();
    const value = dragging; dragging = null; clearDropTargets();
    placePlayer(value, target.dataset.depthDropSlot, Number(target.dataset.depthDropIndex), target);
  }

  function dragEnd() { dragging = null; clearDropTargets(); }

  function keydown(event) {
    if (event.key !== 'Escape' || (!assignment && !dragging) || draft) return;
    event.preventDefault(); assignment = null; dragging = null; clearDropTargets(); refresh(); rankFeedback(t('depth.assignmentCanceled'));
  }

  function undoRanks() {
    if (draft) return;
    const change = lastRankChange;
    const current = group();
    const changed = change?.changes;
    const restoredStarters = current?.slots.map(slot => (changed?.find(item => item.id === slot.id)?.before || slot.playerIds)[0]).filter(Boolean) || [];
    if (!canEdit() || !change || change.workspace !== getWorkspaceId() || current?.id !== change.groupId
      || !changed.every(item => current.slots.some(slot => slot.id === item.id && JSON.stringify(slot.playerIds) === JSON.stringify(item.after)))
      || changed.some(item => item.before.some(id => id && !getData().roster.some(player => player.id === id)))
      || new Set(restoredStarters).size !== restoredStarters.length) {
      lastRankChange = null; refresh(); rankFeedback(t('depth.undoChanged'), false, true); return;
    }
    const move = { playerId: change.move.playerId, from: change.move.to, to: change.move.from };
    const before = motion.capture(move);
    const slotId = move.to.slotId || move.from.slotId;
    const ok = commitRanks(changed.map(item => ({ ...item, after: item.before })));
    if (ok === false) { rankFeedback(t('roster.saveFailed'), true, true, slotId); return; }
    selectedSlotId = slotId;
    lastRankChange = null; onChange?.(); refresh();
    rankFeedback(moveMessage(move, true), false, false, slotId);
    motion.present(move, before);
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
      ${slot ? `<section class="roster-confirm" hidden><p>${e(t('depth.confirmRemove', { label: slot.label }))}</p><div><button type="button" class="roster-secondary" data-depth-chart="keep">${t('modal.cancel')}</button><button type="button" class="roster-remove" data-depth-chart="confirm-remove">${t('depth.remove')}</button></div></section>` : ''}
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
      if (!before || !draft.removing) return;
    } else {
      if (draft.removing) return;
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
    lastRankChange = null;
    notice.textContent = t('depth.updated');
  }

  function click(event) {
    const button = event.target.closest('[data-depth-chart]');
    if (!button || button.disabled) return;
    const action = button.dataset.depthChart;
    if (action.startsWith('quick-')) { quickRank(button); return; }
    if (action === 'undo-ranks') { undoRanks(); return; }
    if (action === 'pick-player' || action === 'pick-rank') {
      if (!canEdit() || draft || !getData().roster.some(player => player.id === button.dataset.depthSource)) return;
      assignment = stamp(sourceFrom(button));
      refresh(); rankFeedback(t('depth.assignmentReady', { name: getData().roster.find(player => player.id === assignment.source.playerId).name }));
      sheet.querySelector('button[data-depth-chart="place-player"], button[data-depth-chart="inspect"][data-depth-drop-slot]')?.focus({ preventScroll: true }); return;
    }
    if (action === 'cancel-assignment') { assignment = null; refresh(); rankFeedback(t('depth.assignmentCanceled')); return; }
    if (action === 'place-player') { placePlayer(assignment, button.dataset.slot, Number(button.dataset.index), button); return; }
    if (action === 'mode' && Object.hasOwn(views, button.dataset.mode)) {
      mode = button.dataset.mode;
      refresh();
      sheet.querySelector(`[data-mode="${mode}"]`)?.focus({ preventScroll: true });
      return;
    }
    if (action === 'inspect') {
      if (assignment) { placePlayer(assignment, button.dataset.slot, 0, button); return; }
      selectedSlotId = button.dataset.slot;
      refresh();
      [...sheet.querySelectorAll('[data-depth-chart="inspect"]')].find(el => el.dataset.slot === selectedSlotId)?.focus({ preventScroll: true });
      return;
    }
    if (action === 'add' || action === 'edit') { open(button.dataset.slot); return; }
    if (!draft) return;
    if (action === 'close') { close(draft.before?.id); return; }
    if (action === 'keep') {
      draft.removing = false; dialog.querySelector('.roster-confirm').hidden = true;
      dialog.querySelector('[type="submit"]').disabled = Boolean(errorForDraft());
      dialog.querySelector('[data-depth-chart="remove"]').focus(); return;
    }
    const blocked = errorForDraft();
    if (blocked) { alert(blocked); return; }
    if (action === 'remove') {
      draft.removing = true; dialog.querySelector('.roster-confirm').hidden = false;
      dialog.querySelector('[type="submit"]').disabled = true;
      dialog.querySelector('[data-depth-chart="keep"]').focus(); return;
    }
    if (action === 'confirm-remove') { save(true); return; }
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
      assignment = null;
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
  function cancel(event) {
    event.preventDefault();
    if (draft?.removing) { dialog.querySelector('[data-depth-chart="keep"]').click(); return; }
    if (draft) close(draft.before?.id);
  }
  root.addEventListener('click', click);
  root.addEventListener('change', change);
  root.addEventListener('dragstart', dragStart);
  root.addEventListener('dragover', dragOver);
  root.addEventListener('drop', drop);
  root.addEventListener('dragend', dragEnd);
  root.addEventListener('keydown', keydown);
  dialog.addEventListener('submit', submit);
  dialog.addEventListener('cancel', cancel);
  return {
    refresh, isEditing: () => Boolean(draft),
    destroy() {
      motion.cancel();
      remember();
      root.removeEventListener('click', click);
      root.removeEventListener('change', change);
      root.removeEventListener('dragstart', dragStart);
      root.removeEventListener('dragover', dragOver);
      root.removeEventListener('drop', drop);
      root.removeEventListener('dragend', dragEnd);
      root.removeEventListener('keydown', keydown);
      if (draft) dialog.close();
      draft = null;
      root.replaceChildren();
    }
  };
}
