// Presentation-only orientation; it never mutates or saves the original play.
export function orientDefense(play, mirror = false) {
  if (!play || !mirror || play.reference) return play;
  return {
    ...play,
    players: play.players.map(p => ({ ...p, x: 100 - p.x })),
    routes: play.routes.map(r => ({ ...r, points: r.points.map(p => ({ ...p, x: 100 - p.x })) })),
    zones: play.zones.map(z => ({ ...z, x: 100 - z.x })),
    annotations: play.annotations.map(a => ({ ...a, x: 100 - a.x })),
  };
}

// Model connection settings are deliberately excluded: changing a key or
// transport does not change what an existing report describes.
export function matchupInputKey({ workspaceId, offense, defense, options, knowledge }) {
  const diagram = play => play && ({ id: play.id, title: play.title, league: play.league,
    formation: play.formation, personnel: play.personnel, reference: play.reference,
    players: play.players?.map(({ id, label, side, x, y }) => ({ id, label, side, x, y })),
    routes: play.routes, zones: play.zones, notes: options.includeNotes ? play.notes : undefined });
  return JSON.stringify({ workspaceId, offense: diagram(offense), defense: diagram(defense), options, knowledge });
}

// Follow-up reports are user-provided reference data, never executable edits or
// instructions. Keep only the fields the scenario reader understands and only
// evidence that is still part of this authorized matchup.
export function checkedMatchupFollowup(input, { offensePlayId, defensePlayId, revision, evidenceIds = [] } = {}) {
  if (input == null) return null;
  if (!input || typeof input !== 'object' || Array.isArray(input) ||
      typeof input.question !== 'string' || !input.question.trim() || input.question.length > 1200 ||
      input.offensePlayId !== offensePlayId || input.defensePlayId !== defensePlayId || input.revision !== revision ||
      !Number.isInteger(input.scenarioIndex) || input.scenarioIndex < 0 || input.scenarioIndex > 4 ||
      !input.previousReport || !Array.isArray(input.previousReport.scenarios) || !input.previousReport.scenarios.length || input.previousReport.scenarios.length > 5) {
    throw new Error('追问与当前战术或报告版本不一致，请重新分析');
  }
  const clean = (value, max) => typeof value === 'string' ? value.trim().slice(0, max) : '';
  const allowed = new Set(evidenceIds);
  const scenarios = input.previousReport.scenarios.map(item => ({
    title: clean(item?.title, 100), condition: clean(item?.condition, 600), observation: clean(item?.observation, 600),
    possibility: clean(item?.possibility, 900), action: clean(item?.action, 700), limitations: clean(item?.limitations, 700),
    evidenceIds: Array.isArray(item?.evidenceIds) ? item.evidenceIds.filter(id => typeof id === 'string' && allowed.has(id)).slice(0, 16) : [],
  }));
  if (!scenarios[input.scenarioIndex]?.title) throw new Error('追问的情景已不可用，请重新选择');
  return { question: clean(input.question, 1200), scenarioIndex: input.scenarioIndex,
    previousReport: { summary: clean(input.previousReport.summary, 1000), scenarios } };
}
