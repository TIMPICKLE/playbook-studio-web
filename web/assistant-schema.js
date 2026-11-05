import { z } from './vendor/assistant-zod.js';

const id = z.string().min(1).max(100);
const routeId = id.optional();
const waypoint = z.strictObject({ x: z.number().min(0).max(100), y: z.number().min(0).max(100) });
const conceptBreaks = {
  slant: 'inside', out: 'outside', in: 'inside', dig: 'inside', curl: 'straight', comeback: 'outside',
  hitch: 'straight', post: 'inside', corner: 'outside', go: 'straight', fade: 'outside', seam: 'straight',
  flat: 'outside', wheel: 'outside', drag: 'inside', screen: null,
};
export const ROUTE_CONCEPTS = Object.keys(conceptBreaks);
export const routeBreak = operation => operation.breakTo ?? conceptBreaks[operation.concept] ?? 'inside';
const conflictingBreak = operation => operation.breakTo != null && operation.concept !== 'screen' &&
  Object.hasOwn(conceptBreaks, operation.concept) && conceptBreaks[operation.concept] !== operation.breakTo;
const direction = z.enum(['left', 'right']);
const semanticRoute = z.strictObject({ kind: z.literal('route'), playerId: id, routeId,
  concept: z.enum(ROUTE_CONCEPTS), depthYards: z.number().positive().max(40),
  breakTo: z.enum(['inside','outside']).optional().describe('Optional. Slant, in, dig, post and drag break inside. Out, corner, fade, flat, wheel and comeback break outside. Omit for go, seam, curl and hitch. Screen accepts either direction.'),
}).refine(operation => !conflictingBreak(operation), {path:['breakTo'], message:'Route break direction conflicts with its concept.'});
const pointRoute = z.strictObject({ kind: z.literal('route'), playerId: id, routeId, points: z.array(waypoint).min(1).max(32) });
const targetBlock = z.strictObject({ kind: z.literal('block'), playerId: id, routeId, targetIds: z.array(id).min(1).max(6) });
const groupBlock = z.strictObject({ kind: z.literal('block'), playerIds: z.array(id).min(1).max(11), scheme: z.enum(['zone','gap','pass_pro']), direction });
const lateralYards = z.number().min(-53.333333).max(53.333333).describe('Lateral yards. Positive moves right and negative moves left in the offense perspective.');
const forwardYards = z.number().min(-30).max(30).describe('Forward yards in the offense direction. Positive moves upfield (decreasing canvas y), negative moves backward (increasing canvas y).');
const offset = z.union([
  z.strictObject({ kind: z.literal('move_player'), playerId: id, dxYards: lateralYards, dyYards: forwardYards.optional() }),
  z.strictObject({ kind: z.literal('move_player'), playerId: id, dxYards: lateralYards.optional(), dyYards: forwardYards }),
]);
const alignment = z.strictObject({ kind: z.literal('move_player'), playerId: id, alignment: z.enum(['wide','slot','tight','off']) });

export const BoardOperationSchema = z.union([
  semanticRoute, pointRoute, targetBlock, groupBlock,
  z.strictObject({ kind: z.literal('motion'), playerId: id, routeId, type: z.enum(['jet','orbit','across','shift']), toward: direction }),
  offset, alignment,
  z.strictObject({ kind: z.literal('pass'), receiverId: id, routeId, throwAt: z.number().min(0).max(10), arriveAt: z.number().positive().max(15) }),
  z.strictObject({ kind: z.literal('zone'), preset: z.enum(['deep_third','deep_half','flat','hook_curl','curl_flat','middle_hole']), side: z.enum(['left','middle','right']), playerId: id.optional() }),
  z.strictObject({ kind: z.literal('timing'), playerId: id, routeId, delay: z.number().min(0).max(10), duration: z.number().min(.2).max(10) }),
  z.strictObject({ kind: z.literal('remove_route'), playerId: id, routeId }),
  z.strictObject({ kind: z.literal('annotate'), nearId: id, text: z.string().trim().min(1).max(200) }),
]);
export const BoardOperationsSchema = z.array(BoardOperationSchema).min(1).max(20);
const context = z.strictObject({ instruction: z.string().max(2000).optional(), coverage: z.enum(['unknown','cover3_spot','cover3_match','cover2','man']).optional(), defensePlayId: id.optional() });
export const BoardResultSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('edit'), summary: z.string().max(500).optional(), operations: BoardOperationsSchema }),
  z.strictObject({ kind: z.literal('search'), matches: z.array(z.strictObject({ id, reason: z.string().trim().min(1).max(450) })).max(4) }),
  z.strictObject({ kind: z.literal('answer'), message: z.string().trim().min(1).max(1500), highlights: z.array(id).max(32).optional() }),
  z.strictObject({ kind: z.literal('clarify'), message: z.string().trim().min(1).max(420) }),
  z.strictObject({ kind: z.literal('handoff'), message: z.string().trim().min(1).max(420), playId: id, context: context.optional() }),
]);
export const PreviewEditSchema = z.strictObject({ operations: BoardOperationsSchema });
export const SubmitResultSchema = z.strictObject({ result: BoardResultSchema });
const toJSON = schema => { const { $schema, ...json } = z.toJSONSchema(schema, { io: 'input', target: 'draft-7' }); return json; };
export const submitResultTool = { type: 'function', function: { name: 'submit_result', description: 'Submit the final grounded result. For edits, preview the complete operation group first and inspect its actual effects. This ends the current request.', parameters: toJSON(SubmitResultSchema) } };
export const previewEditTool = { type: 'function', function: { name: 'preview_edit', description: 'Simulate the complete operation group against the current diagram with full play validation, without saving. Inspect actual depth, breaks, boundary adjustments, target order and changed IDs before submitting. Inside and outside are relative to the offensive center, or the field midpoint when there is no unique center. Treat clipped geometry as an approximation.', parameters: toJSON(PreviewEditSchema) } };

function operationError(operations) {
  if (!Array.isArray(operations) || !operations.length || operations.length > 20) return 'Expected 1–20 operations.';
  for (const operation of operations) {
    if (BoardOperationSchema.safeParse(operation).success) continue;
    if (operation?.kind === 'route' && ['inside', 'outside'].includes(operation.breakTo) && conflictingBreak(operation))
      return 'Route break direction conflicts with its concept.';
    const names = { route: operation?.points ? 'Invalid route waypoints.' : 'Invalid route concept or depth.',
      block: operation?.playerIds ? 'Invalid blocking scheme.' : 'Invalid block targets.', motion: 'Invalid motion.',
      move_player: operation?.alignment ? 'Invalid alignment.' : 'Invalid movement.', pass: 'Invalid pass timing.',
      zone: 'Invalid zone.', timing: 'Invalid timing.', annotate: 'Invalid annotation.' };
    return names[operation?.kind] || 'Invalid operation.';
  }
  return 'Invalid operation.';
}
export function parseBoardOperations(value) {
  const parsed = BoardOperationsSchema.safeParse(value);
  if (!parsed.success) throw new Error(operationError(value));
  return parsed.data;
}
export function parseBoardResult(value) {
  // Existing callers may still replay saved single-operation results.
  const normalized = value?.kind === 'edit' && value.operation && !value.operations
    ? { kind:'edit', summary:value.summary, operations:[value.operation] } : value;
  if (normalized?.kind === 'edit') parseBoardOperations(normalized.operations);
  const parsed = BoardResultSchema.safeParse(normalized);
  if (!parsed.success) throw new Error('Invalid result format.');
  return parsed.data;
}
