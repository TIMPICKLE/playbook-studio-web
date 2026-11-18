import { t } from './i18n.js';
import { escapeHTML as e } from './model.js';
import { formationLayout } from './depth-formation-layout.js';

function playerName(player) {
  return player ? [player.number && `#${player.number}`, player.name].filter(Boolean).join(' ') : t('depth.vacant');
}

export function depthDragSource(playerId, slotId = '', index = 0) {
  return playerId ? `draggable="true" data-depth-source="${e(playerId)}" data-source-slot="${e(slotId)}" data-source-index="${index}"` : '';
}

export function depthPlayerPicker(players, playerId = '', editable = false, assigning = false) {
  const player = players.get(playerId);
  return players.size ? `<div class="df-find"><label><span>${t('formationDetail.find')}</span>
    <select data-formation-player aria-label="${t('formationDetail.find')}"><option value="">${t('formationDetail.allPlayers')}</option>${[...players.values()].map(p =>
      `<option value="${e(p.id)}" ${p.id === playerId ? 'selected' : ''}>${e(playerName(p))}${p.position ? ' · ' + e(p.position) : ''}</option>`
    ).join('')}</select></label>
    ${editable && player ? `<button type="button" class="roster-secondary depth-assign-player" data-depth-chart="pick-player" ${depthDragSource(player.id)}><span data-depth-label="${e(player.id)}">${e(t('depth.assignPlayer', { name: playerName(player) }))}</span></button>` : ''}
    ${assigning ? `<button type="button" class="roster-text" data-depth-chart="cancel-assignment">${t('modal.cancel')}</button>` : ''}
  </div>` : '';
}

export function depthRankActions(slot, index, groupId, editable) {
  if (!editable || !index || !slot.playerIds[index]) return '';
  const attrs = `data-slot="${e(slot.id)}" data-group="${e(groupId)}" data-player="${e(slot.playerIds[index])}" data-ranks="${e(JSON.stringify(slot.playerIds))}"`;
  return `<span class="depth-inline-actions">
    <button type="button" data-depth-chart="quick-promote" ${attrs} aria-label="${e(t('depth.promoteNamed', { label: slot.label, rank: index }))}">${t('depth.promote')}</button>
    ${index > 1 ? `<button type="button" data-depth-chart="quick-up" ${attrs} aria-label="${e(t('depth.upNamed', { label: slot.label, rank: index }))}">↑</button>` : ''}
    ${index + 1 < slot.playerIds.length ? `<button type="button" data-depth-chart="quick-down" ${attrs} aria-label="${e(t('depth.downNamed', { label: slot.label, rank: index }))}">↓</button>` : ''}
  </span>`;
}

function roleButton(slot, players, selected, playerId, style = '', editable = false, assigning = false) {
  const starter = players.get(slot.playerIds[0]);
  const name = playerName(starter);
  const ranks = slot.playerIds.slice(1).map((id, index) => `${t('depth.backup', { rank: index + 1 })} ${playerName(players.get(id))}`);
  const description = [slot.label, `${t('depth.starter')} ${name}`, ...ranks].join(' · ');
  const match = playerId ? slot.playerIds.indexOf(playerId) : -1;
  const matchLabel = match > 0 ? t('depth.backup', { rank: match }) : t('depth.starter');
  const visiblePlayer = match >= 0 ? players.get(playerId) : starter;
  const label = visiblePlayer ? `data-depth-label="${e(visiblePlayer.id)}"` : '';
  return `<button type="button" class="df-node" data-depth-chart="inspect" data-slot="${e(slot.id)}"
    ${match >= 0 ? `data-formation-rank="${match}"` : ''} data-filled="${Boolean(starter)}" aria-pressed="${selected}" aria-controls="depth-formation-detail"
    aria-label="${e(assigning ? t('depth.assignToRole', { label: slot.label }) : description)}" title="${e(description)}" ${style}
    ${editable ? `data-depth-drop-slot="${e(slot.id)}" data-depth-drop-index="0" ${depthDragSource(match >= 0 ? playerId : starter?.id, slot.id, match >= 0 ? match : 0)}` : ''}>
    <span class="df-role">${e(slot.label)}</span><span class="df-name" ${label}>${e(playerName(visiblePlayer))}</span>
    <span class="df-found-rank"${match < 0 ? ' aria-hidden="true"' : ''}>${match < 0 ? '' : matchLabel}</span></button>`;
}

function pitchMarker(marker, markers, players, selected, playerId, editable, assigning) {
  // Wide splits can display longer names. Adjacent linemen share the row.
  const { x, y, slot } = marker;
  const nearby = markers.filter(other => other !== marker && Math.abs(other.y - y) < 15);
  const width = Math.min(2 * x, 2 * (100 - x), ...nearby.map(other => Math.abs(other.x - x))) - 1;
  const style = `style="--df-x:${x}%;--df-y:${y}%;--df-width:${width}%"`;
  return roleButton(slot, players, selected === slot.id, playerId, style, editable, assigning);
}

function selectedRole(slot, players, editable, groupId) {
  const ids = slot.playerIds.length ? slot.playerIds : [null];
  return `<section class="df-detail" id="depth-formation-detail" aria-label="${e(t('formationDetail.roleRanks', { role: slot.label }))}">
    <div class="df-detail-head"><h4>${e(slot.label)}</h4>
      ${editable ? `<button type="button" class="roster-text" data-depth-chart="edit" data-slot="${e(slot.id)}"
         aria-label="${e(t('depth.editLabel', { label: slot.label }))}">${t('depth.edit')}</button>` : ''}</div>
    <dl class="df-ranks">${ids.map((id, rank) => `<div><dt>${rank ? t('depth.backup', { rank }) : t('depth.starter')}</dt>
      <dd ${editable ? `data-depth-drop-slot="${e(slot.id)}" data-depth-drop-index="${rank}"` : ''}><span ${id ? `data-depth-label="${e(id)}"` : ''} ${editable ? depthDragSource(id, slot.id, rank) : ''}>${e(playerName(players.get(id)))}</span>${depthRankActions(slot, rank, groupId, editable)}</dd></div>`).join('')}</dl>
    <div data-depth-feedback="${e(slot.id)}"></div>
    ${ids.length === 1 ? `<p class="df-no-backups">${t('depth.noBackups')}</p>` : ''}</section>`;
}

export function renderDepthFormation(group, players, selectedSlotId, editable, playerId = '', assigning = false) {
  if (!group.slots.length) return `<p class="depth-empty">${t('depth.noSlots')}</p>`;
  const { templateId, markers, unmapped } = formationLayout(group);
  const selected = group.slots.find(slot => slot.id === selectedSlotId) || group.slots[0];
  const groupName = e(group.name);
  const player = players.get(playerId);
  const matches = player ? group.slots.filter(slot => slot.playerIds.includes(playerId)).length : 0;
  return `<div class="df-formation">
    ${depthPlayerPicker(players, playerId, editable, assigning)}
    <p data-formation-results role="status">${player ? e(t(matches ? 'formationDetail.matches' : 'formationDetail.noMatch', { name: playerName(player), count: matches })) : ''}</p>
    ${markers.length ? `<figure class="df-card">
      <figcaption class="df-caption">
        <div><strong>${groupName}</strong><span>${t(`personnel.${group.unit}`)}</span></div>
        <span class="df-legend"><i></i>${t('formationDetail.assigned')} <i class="df-open-dot"></i>${t('depth.vacant')}</span>
      </figcaption>
      <div class="df-pitch" role="group" aria-label="${e(t('formationDetail.pitch', { group: group.name }))}">
        <div class="df-hashes" aria-hidden="true"></div>
        ${markers.map(marker => pitchMarker(marker, markers, players, selected.id, playerId, editable, assigning)).join('')}
      </div>
      <p class="df-instruction">${t(assigning ? 'depth.selectTarget' : player && matches ? 'formationDetail.filterHint' : 'formationDetail.selectRole')} <span class="df-portrait-hint">${t('formationDetail.rotated')}</span></p>
      ${templateId === 'punt-return' ? `<p class="df-note">${t('formationDetail.returnNote')}</p>` : ''}
    </figure>` : `<p class="df-unplaced-hint">${t('formationDetail.noLayout')}</p>`}
    ${unmapped.length ? `<section class="df-extra"><h4>${t('formationDetail.unplaced')}</h4><div class="df-extra-roles">
      ${unmapped.map(slot => roleButton(slot, players, slot.id === selected.id, playerId, '', editable, assigning)).join('')}</div></section>` : ''}
    ${selectedRole(selected, players, editable, group.id)}
  </div>`;
}
