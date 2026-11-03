import { array, choice, fail, text, unique } from './model-values.js';
import { orientDefense } from './matchup-model.js';

export const MAX_DRILLS = 100;
const string = (value, length, name) => text(value ?? '', length, name);
function time(value, fallback) {
  const seconds = value ?? fallback;
  if (!Number.isFinite(seconds) || seconds < 0 || seconds > 20) fail('练习时刻超出范围');
  return seconds;
}

function normalizeTargets(values) {
  const ids = array(values, 40, '训练目标').map(key => text(key, 102, '目标 ID'));
  if (ids.some(key => !key) || new Set(ids).size !== ids.length) fail('训练目标为空或重复');
  return ids;
}

export function normalizeDrill(value) {
  if (!value || typeof value !== 'object' || !string(value.id, 100, '练习 ID').trim()) fail('练习缺少 ID');
  const targetIds = normalizeTargets(value.targetIds ?? []);
  const alternativeTargetIds = array(value.alternativeTargetIds ?? [], 5, '备选答案').map(normalizeTargets);
  const revision = value.revision ?? 0;
  if (!Number.isSafeInteger(revision) || revision < 0) fail('练习版本无效');
  const losY = value.losY ?? 67;
  if (!Number.isFinite(losY) || losY < 0 || losY > 100) fail('开球线超出范围');
  return {
    id: value.id, title: string(value.title, 120, '练习标题'), role: string(value.role, 15, '训练位置'),
    playId: string(value.playId, 100, '来源战术'), defensePlayId: string(value.defensePlayId, 100, '防守战术'), mirrorDefense: value.mirrorDefense === true,
    cameraId: string(value.cameraId, 102, '观察球员'), targetIds, alternativeTargetIds,
    question: string(value.question, 400, '题目'), hint: string(value.hint, 500, '提示'), explanation: string(value.explanation, 1200, '解析'),
    freezeAt: time(value.freezeAt, 0), snapAt: time(value.snapAt, 0), replayUntil: time(value.replayUntil, 2), losY,
    facing: choice(value.facing ?? 'up', ['up', 'down'], '朝向'), revision,
    status: choice(value.status ?? 'draft', ['draft', 'published', 'needsReview'], '练习状态'), sourceFingerprint: string(value.sourceFingerprint, 48, '发布校验标记'),
  };
}

// The primary play supplies ball timing. A second source contributes only its defensive actors.
export function trainingScene(drill, plays) {
  const primary = plays.find(play => play.id === drill.playId);
  if (!primary || primary.reference || !primary.players.length) return null;
  if (!drill.defensePlayId) return primary;
  const source = plays.find(play => play.id === drill.defensePlayId);
  if (!source || source.id === primary.id || source.reference) return null;
  const defense = orientDefense(source, drill.mirrorDefense);
  const attack = primary.players.filter(player => player.side === 'offense');
  const opponents = defense.players.filter(player => player.side === 'defense');
  if (!attack.length || !opponents.length) return null;
  const primaryIds = new Set(attack.map(player => player.id));
  const defenseIds = new Set(opponents.map(player => player.id));
  const secondaryId = id => 'd:' + id;
  if (opponents.some(player => primaryIds.has(secondaryId(player.id)))) return null;
  const ball = { ...primary.ball };
  if (!primaryIds.has(ball.holderId)) ball.holderId = attack.find(player => player.label === 'QB')?.id ?? attack[0].id;
  if (!primaryIds.has(ball.receiverId)) ball.receiverId = '';
  return {
    ...primary, ball, zones: [], annotations: [],
    players: [...attack, ...opponents.map(player => ({ ...player, id: secondaryId(player.id) }))],
    routes: [
      ...primary.routes.filter(route => primaryIds.has(route.playerId)),
      ...defense.routes.filter(route => defenseIds.has(route.playerId) && route.kind !== 'pass')
        .map(route => ({ ...route, id: secondaryId(route.id), playerId: secondaryId(route.playerId) })),
    ],
  };
}

// A synchronous change detector for a published exercise, independent of unrelated book edits.
function fingerprint(drill, scene) {
  const fields = [
    scene.players.map(p => [p.id, p.label, p.side, p.x, p.y]),
    scene.routes.filter(r => !r.optional).map(r => [r.playerId, r.kind, r.delay, r.duration, r.smooth, r.points.map(p => [p.x, p.y])]),
    [scene.ball.holderId, scene.ball.receiverId, scene.ball.passAt, scene.ball.arriveAt],
    drill.role, drill.cameraId, [...drill.targetIds].sort(), drill.question, drill.hint, drill.explanation,
    drill.facing, drill.freezeAt, drill.snapAt, drill.replayUntil, drill.losY,
  ];
  if (drill.alternativeTargetIds?.length) fields.push(drill.alternativeTargetIds.map(ids => [...ids].sort()));
  const contents = JSON.stringify(fields);
  let hash = 0x811c9dc5;
  for (let i = 0; i < contents.length; i++) hash = Math.imul(hash ^ contents.charCodeAt(i), 0x01000193);
  return contents.length.toString(36) + '-' + (hash >>> 0).toString(36);
}

function canPublish(drill, scene) {
  const camera = scene?.players.find(player => player.id === drill.cameraId);
  if (!camera || !drill.targetIds.length || ![drill.title, drill.role, drill.question, drill.explanation].every(value => value.trim())) return false;
  const groups = [drill.targetIds, ...(drill.alternativeTargetIds || [])];
  const opponents = new Set(scene.players.filter(player => player.side !== camera.side).map(player => player.id));
  const distinct = new Set(groups.map(ids => JSON.stringify([...ids].sort())));
  return distinct.size === groups.length && groups.every(ids => ids.length === drill.targetIds.length && ids.every(id => opponents.has(id)))
    && drill.freezeAt <= drill.snapAt && drill.snapAt < drill.replayUntil;
}

export function publishDrill(value, plays) {
  const drill = normalizeDrill(value);
  const scene = trainingScene(drill, plays);
  if (!canPublish(drill, scene)) fail('请检查攻防站位、观察人、对方目标、时刻及题目解析');
  return { ...drill, status: 'published', revision: drill.revision + 1, sourceFingerprint: fingerprint(drill, scene) };
}

export function drillStatus(drill, plays) {
  if (drill.status !== 'published') return drill.status || 'draft';
  const scene = trainingScene(drill, plays);
  return drill.revision > 0 && canPublish(drill, scene) && drill.sourceFingerprint === fingerprint(drill, scene) ? 'published' : 'needsReview';
}

export function validateDrills(value, plays) {
  return unique(array(value === undefined ? [] : value, MAX_DRILLS, '练习').map(normalizeDrill), '练习')
    .map(drill => ({ ...drill, status: drillStatus(drill, plays) }));
}

// Explain the closest coach-approved read; never combine targets from different reads.
export function feedbackTargets(drill, ids) {
  const selected = new Set(ids);
  let closest = drill.targetIds, best = -1;
  for (const group of [drill.targetIds, ...(drill.alternativeTargetIds || [])]) {
    const hits = group.filter(id => selected.has(id)).length;
    if (hits > best) { closest = group; best = hits; }
  }
  return closest;
}

export function correctSelection(drill, ids) {
  const chosen = new Set(ids);
  const answer = feedbackTargets(drill, chosen);
  return answer.length > 0 && chosen.size === answer.length && answer.every(id => chosen.has(id));
}
