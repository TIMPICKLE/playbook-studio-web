import { t } from './i18n.js';
import { escapeHTML as e } from './model.js';
import { formationLayout } from './depth-formation-layout.js';

function playerName(player) {
  return player ? [player.number && `#${player.number}`, player.name].filter(Boolean).join(' ') : t('depth.vacant');
}

function roleButton(slot, players, selected, playerId, style = '') {
  const starter = players.get(slot.playerIds[0]);
  const name = playerName(starter);
  const ranks = slot.playerIds.slice(1).map((id, index) => `${t('depth.backup', { rank: index + 1 })} ${playerName(players.get(id))}`);
  const description = [slot.label, `${t('depth.starter')} ${name}`, ...ranks].join(' · ');
  const match = playerId ? slot.playerIds.indexOf(playerId) : -1;
  const matchLabel = match > 0 ? t('depth.backup', { rank: match }) : t('depth.starter');
  const visibleName = match >= 0 ? playerName(players.get(playerId)) : name;
  return `<button type="button" class="df-node" data-depth-chart="inspect" data-slot="${e(slot.id)}"
    ${match >= 0 ? `data-formation-rank="${match}"` : ''} data-filled="${Boolean(starter)}" aria-pressed="${selected}" aria-controls="depth-formation-detail"
    aria-label="${e(description)}" title="${e(description)}" ${style}>
    <span class="df-role">${e(slot.label)}</span><span class="df-name">${e(visibleName)}</span>
    ${match < 0 ? '' : `<span class="df-found-rank">${matchLabel}</span>`}</button>`;
}

function pitchMarker(marker, markers, players, selected, playerId) {
  // Wide splits can display longer names. Adjacent linemen share the row.
  const { x, y, slot } = marker;
  const nearby = markers.filter(other => other !== marker && Math.abs(other.y - y) < 15);
  const width = Math.min(2 * x, 2 * (100 - x), ...nearby.map(other => Math.abs(other.x - x))) - 1;
  const style = `style="--df-x:${x}%;--df-y:${y}%;--df-width:${width}%"`;
  return roleButton(slot, players, selected === slot.id, playerId, style);
}

function selectedRole(slot, players, editable) {
  const ids = slot.playerIds.length ? slot.playerIds : [null];
  return `<section class="df-detail" id="depth-formation-detail" aria-label="${e(t('formationDetail.roleRanks', { role: slot.label }))}">
    <div class="df-detail-head"><h4>${e(slot.label)}</h4>
      ${editable ? `<button type="button" class="roster-text" data-depth-chart="edit" data-slot="${e(slot.id)}"
         aria-label="${e(t('depth.editLabel', { label: slot.label }))}">${t('depth.edit')}</button>` : ''}</div>
    <button type="button" class="roster-text df-train-role" data-cloud-action="enter-training" data-training-role="${e(slot.templateRole || slot.label)}">${e(t('trainingNav.practiceRole', { role: slot.label }))} →</button>
    <dl class="df-ranks">${ids.map((id, rank) => `<div><dt>${rank ? t('depth.backup', { rank }) : t('depth.starter')}</dt>
      <dd>${e(playerName(players.get(id)))}</dd></div>`).join('')}</dl>
    ${ids.length === 1 ? `<p class="df-no-backups">${t('depth.noBackups')}</p>` : ''}</section>`;
}

export function renderDepthFormation(group, players, selectedSlotId, editable, playerId = '') {
  if (!group.slots.length) return `<p class="depth-empty">${t('depth.noSlots')}</p>`;
  const { templateId, markers, unmapped } = formationLayout(group);
  const selected = group.slots.find(slot => slot.id === selectedSlotId) || group.slots[0];
  const groupName = e(group.name);
  const player = players.get(playerId);
  const matches = player ? group.slots.filter(slot => slot.playerIds.includes(playerId)).length : 0;
  return `<div class="df-formation">
    ${players.size ? `<div class="df-find"><label><span>${t('formationDetail.find')}</span>
      <select data-formation-player aria-label="${t('formationDetail.find')}"><option value="">${t('formationDetail.allPlayers')}</option>${[...players.values()].map(p =>
        `<option value="${e(p.id)}" ${p.id === playerId ? 'selected' : ''}>${e(playerName(p))}${p.position ? ' · ' + e(p.position) : ''}</option>`
      ).join('')}</select></label>
      <p data-formation-results role="status">${player ? e(t(matches ? 'formationDetail.matches' : 'formationDetail.noMatch', { name: playerName(player), count: matches })) : ''}</p></div>` : ''}
    ${markers.length ? `<figure class="df-card">
      <figcaption class="df-caption">
        <div><strong>${groupName}</strong><span>${t(`personnel.${group.unit}`)}</span></div>
        <span class="df-legend"><i></i>${t('formationDetail.assigned')} <i class="df-open-dot"></i>${t('depth.vacant')}</span>
      </figcaption>
      <div class="df-pitch" role="group" aria-label="${e(t('formationDetail.pitch', { group: group.name }))}">
        <div class="df-hashes" aria-hidden="true"></div>
        ${markers.map(marker => pitchMarker(marker, markers, players, selected.id, playerId)).join('')}
      </div>
      <p class="df-instruction">${t(player && matches ? 'formationDetail.filterHint' : 'formationDetail.selectRole')} <span class="df-portrait-hint">${t('formationDetail.rotated')}</span></p>
      ${templateId === 'punt-return' ? `<p class="df-note">${t('formationDetail.returnNote')}</p>` : ''}
    </figure>` : `<p class="df-unplaced-hint">${t('formationDetail.noLayout')}</p>`}
    ${unmapped.length ? `<section class="df-extra"><h4>${t('formationDetail.unplaced')}</h4><div class="df-extra-roles">
      ${unmapped.map(slot => roleButton(slot, players, slot.id === selected.id, playerId)).join('')}</div></section>` : ''}
    ${selectedRole(selected, players, editable)}
  </div>`;
}
