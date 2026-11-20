import { animationLength, clamp, clone, createAnimationSampler } from './model.js';
import { getPlayLeague } from './game-formats.js';
import { routeDepthYards } from './field-metrics.js';

function describePlayers(players, roster) {
  const rosterById = new Map(roster.map(member => [member.id, member]));
  const labels = players.map(player => {
    const member = rosterById.get(player.rosterId);
    return [player.label || member?.position, member?.number && `#${member.number}`, member?.name || player.name]
      .filter(Boolean).join(' · ') || '—';
  });
  const totals = new Map();
  for (const label of labels) totals.set(label, (totals.get(label) || 0) + 1);
  const seen = new Map();
  return players.map((player, index) => {
    const label = labels[index];
    const number = (seen.get(label) || 0) + 1;
    seen.set(label, number);
    return { ...player, displayLabel: totals.get(label) > 1 ? `${label} · ${number}` : label };
  });
}

// A third selection asks the coach which of the two slots to replace.
export function selectFilmFocus(ids, id, replaceId) {
  if (ids.includes(id)) return { ids: ids.filter(selected => selected !== id), needsReplacement: false };
  if (ids.length < 2) return { ids: [...ids, id], needsReplacement: false };
  if (ids.includes(replaceId)) {
    return { ids: ids.map(selected => selected === replaceId ? id : selected), needsReplacement: false };
  }
  return { ids, needsReplacement: true };
}

function ballAt(play, time, positions, canPass, animation) {
  const { holderId, receiverId, passAt, arriveAt } = play.ball;
  if (!positions.has(holderId)) return { ball: null, phase: 'none', holderId: null };
  if (!canPass || time < passAt) return { ball: positions.get(holderId), phase: 'held', holderId };
  if (time === passAt) return { ball: positions.get(holderId), phase: 'release', holderId };
  if (time < arriveAt) return { ball: animation.ballAt(time), phase: 'flight', holderId: null };
  return { ball: positions.get(receiverId), phase: time === arriveAt ? 'arrival' : 'received', holderId: receiverId };
}

// Sample backwards from this exact instant so the focus trail does not depend
// on a previous displayed frame, playback speed or direction of scrubbing.
function recentTrail(animation, player, time, position) {
  const trail = [position];
  const lookback = Math.min(.24, time);
  let remaining = 4; // diagram units, roughly two designed yards on the calibrated field
  for (let step = 1; step <= 4 && lookback > 0; step++) {
    const earlier = animation.playerAt(player, time - lookback * step / 4);
    const last = trail.at(-1);
    const dx = earlier.x - last.x, dy = earlier.y - last.y;
    const distance = Math.hypot(dx, dy);
    if (!distance) continue;
    if (distance >= remaining) {
      trail.push({ x: last.x + dx * remaining / distance, y: last.y + dy * remaining / distance });
      break;
    }
    trail.push(earlier);
    remaining -= distance;
  }
  return trail.reverse();
}

function compareDepth(focus, calibrated) {
  if (focus.length !== 2) return null;
  const [a, b] = focus;
  const difference = b.position.y - a.position.y;
  const gapYards = calibrated ? Number(Math.abs(a.depthYards - b.depthYards).toFixed(1)) : null;
  const same = calibrated
    ? gapYards === 0 || Number(a.depthYards.toFixed(1)) === Number(b.depthYards.toFixed(1))
    : Math.abs(difference) < 1e-6;
  if (same) return { deeperId: null, shallowerId: null, gapYards: calibrated ? 0 : null };
  return {
    deeperId: difference > 0 ? a.id : b.id,
    shallowerId: difference > 0 ? b.id : a.id,
    gapYards,
  };
}

// The regular rehearsal's optional event controls only need authored timing.
// They can call this selector without cloning the diagram or preparing curves.
export function getFilmTimeline(play, actorIds = null) {
  const reference = Boolean(play.reference);
  const ids = actorIds ?? new Set(reference ? [] : (play.players || []).map(player => player.id));
  const routes = play.routes || [];
  const { holderId, receiverId, passAt, arriveAt } = play.ball || {};
  const canPass = !reference && holderId !== receiverId && ids.has(holderId) && ids.has(receiverId)
    && Number.isFinite(passAt) && passAt >= 0 && Number.isFinite(arriveAt) && arriveAt > passAt;
  const hasMotion = !reference && (canPass || routes.some(route =>
    !route.optional && route.kind !== 'pass' && ids.has(route.playerId)
      && (route.blockTargets?.some(id => ids.has(id))
        || route.points.some(point => point.x !== route.points[0].x || point.y !== route.points[0].y))));
  const duration = hasMotion
    ? animationLength({ routes, ball: { arriveAt: Number.isFinite(arriveAt) ? arriveAt : 0 } })
    : 0;
  const events = reference ? [] : [{ id: 'start', time: 0 }];
  if (canPass) events.push({ id: 'release', time: passAt }, { id: 'arrival', time: arriveAt });
  if (hasMotion) events.push({ id: 'end', time: duration });
  return { hasMotion, duration, events, canPass };
}

export function createFilmModel(source, { roster = [] } = {}) {
  // All precomputed geometry belongs to one revision of the play. Editing,
  // cloud updates and undo can change the editor's own objects in place.
  const play = clone(source);
  play.routes ??= [];
  play.ball ??= { holderId: '', receiverId: '', passAt: 0, arriveAt: 0 };
  const reference = Boolean(play.reference);
  const players = describePlayers(reference ? [] : play.players, roster);
  const byId = new Map(players.map(player => [player.id, player]));
  const { hasMotion, duration, events, canPass } = getFilmTimeline(play, byId);
  const calibrated = !reference && getPlayLeague(play) === 11;
  const animation = createAnimationSampler(play);
  const origins = new Map(players.map(player => [player.id, animation.playerAt(player, 0)]));
  let geometry;

  function frameAt(requestedTime, focusIds = []) {
    const time = Number.isFinite(requestedTime) ? clamp(requestedTime, 0, duration) : 0;
    if (geometry?.time !== time) {
      const positions = time === 0 ? origins : new Map(players.map(player => [player.id, animation.playerAt(player, time)]));
      geometry = { time, positions, ...ballAt(play, time, positions, canPass, animation) };
    }
    const focus = [];
    for (const id of new Set(focusIds)) {
      const player = byId.get(id);
      if (!player) continue;
      const position = geometry.positions.get(id);
      focus.push({
        id, position, origin: origins.get(id), trail: recentTrail(animation, player, time, position),
        depthYards: calibrated ? routeDepthYards(position.y) : null,
      });
      if (focus.length === 2) break;
    }
    return { ...geometry, focus, comparison: compareDepth(focus, calibrated) };
  }
  return { play, players, duration, events, hasMotion, calibrated, reference, frameAt };
}

const preciseSeconds = new Intl.NumberFormat('en', {minimumFractionDigits: 1, maximumFractionDigits: 12, useGrouping: false});

// Freeze-frame labels retain the authored event time. The moving clock stays readable.
export function formatFilmTime(time, exact = false) {
  return exact ? preciseSeconds.format(time) : time.toFixed(1);
}
