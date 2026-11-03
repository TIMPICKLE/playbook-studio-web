import { array, choice, fail, id, text, uid, unique } from './model-values.js';

export const DEPTH_LIMITS = { groups: 32, slots: 40, ranks: 10, name: 80, label: 30, notes: 1000 };
const offense = ['QB', 'H', 'X', 'Y', 'F', 'Z', 'LT', 'LG', 'C', 'RG', 'RT'];
const defense = ['WDE', 'DT', 'NT', 'SDE', 'Mike', 'Sam', 'LCB', 'RCB', 'WS', 'SS', 'FS'];
export const DEPTH_TEMPLATES = [
  { id: 'spread', unit: 'offense', name: 'Spread', labels: offense },
  { id: 'bunch', unit: 'offense', name: 'Bunch', labels: offense },
  { id: '4-2-5', unit: 'defense', name: '4-2-5', labels: defense },
  { id: 'kickoff', unit: 'special', name: 'Kickoff', labels: ['L1', 'L2 Contain', 'L3', 'L4', 'L5', 'K', 'R5', 'R4', 'R3', 'R2 Contain', 'R1'] },
  { id: 'kickoff-return', unit: 'special', name: 'Kickoff Return', labels: ['LT', 'LG', 'C', 'RG', 'RT', 'LE', 'LUB', 'RUB', 'RE', 'LR', 'RR'] },
  { id: 'punt', unit: 'special', name: 'Punt', labels: ['X', 'LT Contain', 'LG', 'C', 'RG', 'RT Contain', 'Z', 'TB', 'RB', 'PP', 'P'] },
  { id: 'punt-return', unit: 'special', name: 'Punt Return', labels: [...defense.slice(0, -1), 'Returner'] },
  { id: 'field-goal', unit: 'special', name: 'Field Goal', labels: ['LW', 'LE', 'LT', 'LG', 'C', 'RG', 'RT', 'RE', 'RW', 'Holder', 'Kicker'] },
];

const findTemplate = id => DEPTH_TEMPLATES.find(template => template.id === id);
export const createDepthSlot = (label, templateRole = null) => ({ id: uid(), label, templateRole, playerIds: [] });

export function createDepthGroup(templateId, name, unit = 'offense') {
  const template = findTemplate(templateId);
  return { id: uid(), name: name ?? template?.name ?? '', unit: template?.unit ?? unit, templateId: template?.id ?? null, notes: '', slots: (template?.labels ?? []).map(label => createDepthSlot(label, label)) };
}

// When a coach chooses a diagram, keep existing role bindings when possible,
// then place remaining positions by exact label. Lineups never change here.
export function bindDepthTemplate(group, templateId) {
  const template = findTemplate(templateId);
  const available = new Set(template?.labels);
  group.templateId = template?.id ?? null;
  for (const slot of group.slots) {
    if (!available.delete(slot.templateRole)) slot.templateRole = null;
  }
  for (const slot of group.slots) {
    if (slot.templateRole) continue;
    const match = [...available].find(role => normalizedName(role) === normalizedName(slot.label));
    if (match) { slot.templateRole = match; available.delete(match); }
  }
}

export function copyDepthGroup(group, name) {
  return { ...group, id: uid(), name, slots: group.slots.map(slot => ({ ...slot, id: uid(), playerIds: [...slot.playerIds] })) };
}

// Deterministic IDs let independent clients migrate and merge the same legacy book.
export function defaultDepthChart() {
  const groups = DEPTH_TEMPLATES.map(template => ({
    id: template.id, name: template.name, unit: template.unit, templateId: template.id, notes: '',
    slots: template.labels.map((label, index) => ({ id: `${template.id}-${index + 1}`, label, templateRole: label, playerIds: [] })),
  }));
  return { groups };
}

const requiredText = (value, limit, field) => text(value, limit, field).trim() || fail(`${field}不能为空`);
const normalizedName = value => value.trim().toLowerCase();
function ensureDistinct(values, field) {
  if (new Set(values).size !== values.length) fail(`${field}不能重复`);
}

export function validateDepthChart(chart, rosterIds) {
  if (chart === undefined) return defaultDepthChart();
  const groups = unique(array(chart?.groups, DEPTH_LIMITS.groups, '人员组').map(group => {
    // v1 charts used these deterministic IDs for presets. Older custom copies
    // only have random IDs, and Spread and Bunch share the same role labels.
    const template = findTemplate(group.templateId === undefined ? group.id : group.templateId);
    if (group.templateId != null && !template) fail('阵型图模板无效');
    const legacyRoles = new Map(group.templateId === undefined && template
      ? template.labels.map((label, index) => [`${template.id}-${index + 1}`, label]) : []);
    const starters = [];
    const slots = unique(array(group.slots, DEPTH_LIMITS.slots, '位置').map(slot => {
      const playerIds = array(slot.playerIds, DEPTH_LIMITS.ranks, '位置深度').map(playerId => {
        if (playerId === null) return null;
        if (!rosterIds.has(id(playerId)) || !playerId) fail('位置关联的名单球员不存在');
        return playerId;
      });
      ensureDistinct(playerIds.filter(Boolean), '同一位置的球员');
      if (playerIds[0]) starters.push(playerIds[0]);
      const templateRole = slot.templateRole === undefined ? legacyRoles.get(slot.id) ?? null : slot.templateRole;
      if (templateRole !== null && !template?.labels.includes(templateRole)) fail('阵型图位置无效');
      return { id: requiredText(slot.id, 100, '位置 ID'), label: requiredText(slot.label, DEPTH_LIMITS.label, '位置名称'), templateRole, playerIds };
    }), '位置');
    ensureDistinct(starters, '同组首发球员');
    ensureDistinct(slots.map(slot => normalizedName(slot.label)), '位置名称');
    ensureDistinct(slots.map(slot => slot.templateRole).filter(Boolean), '阵型图位置');
    const validated = {
      id: requiredText(group.id, 100, '人员组 ID'), name: requiredText(group.name, DEPTH_LIMITS.name, '人员组名称'),
      unit: choice(group.unit, ['offense', 'defense', 'special'], '分组'), templateId: template?.id ?? null, notes: text(group.notes ?? '', DEPTH_LIMITS.notes, '人员组备注'), slots,
    };
    // An old append retained the preset group ID but regenerated its position
    // IDs. The scheme is known, so any remaining exact role labels can be placed.
    if (group.templateId === undefined && template) bindDepthTemplate(validated, template.id);
    return validated;
  }), '人员组');
  ensureDistinct(groups.map(group => `${group.unit}/${normalizedName(group.name)}`), '同组名称');
  return { groups };
}

export function clearDepthPlayer(chart, playerId) {
  for (const group of chart.groups) {
    for (const slot of group.slots) {
      slot.playerIds = slot.playerIds.map(value => value === playerId ? null : value);
    }
  }
}

function isUnusedTemplate(group) {
  const template = DEPTH_TEMPLATES.find(t => t.id === group.id);
  return template && group.templateId === template.id && group.unit === template.unit && group.name === template.name && !group.notes
    && group.slots.length === template.labels.length
    && group.slots.every((slot, i) => slot.label === template.labels[i] && slot.templateRole === template.labels[i] && !slot.playerIds.some(Boolean));
}

export function appendDepthGroups(current, imported, rosterIds) {
  const groups = [...current.groups];
  for (const group of imported.groups) {
    if (isUnusedTemplate(group)) continue;
    const blank = groups.findIndex(g => g.id === group.id && isUnusedTemplate(g));
    const otherNames = new Set(groups.filter((g, index) => g.unit === group.unit && index !== blank).map(g => normalizedName(g.name)));
    let name = group.name;
    for (let n = 2; otherNames.has(normalizedName(name)); n++) {
      const suffix = ` (${n})`;
      name = group.name.slice(0, DEPTH_LIMITS.name - suffix.length) + suffix;
    }
    const copy = copyDepthGroup(group, name);
    for (const slot of copy.slots) slot.playerIds = slot.playerIds.map(playerId => rosterIds.get(playerId) ?? null);
    if (blank !== -1) {
      copy.id = groups[blank].id;
      groups[blank] = copy;
    } else {
      if (groups.length >= DEPTH_LIMITS.groups) return null;
      groups.push(copy);
    }
  }
  return { groups };
}
