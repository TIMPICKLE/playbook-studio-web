import { resolveBoardPlayer } from './assistant-edit.js';
import { proposeEdit } from './assistant-proposal.js';
import { previewEditTool, parseBoardOperations } from './assistant-schema.js';

const string = { type: 'string' };
const object = properties => ({ type: 'object', properties, additionalProperties: false });
const noArgs = object({});
const fields = object({
  name: string, role: string, number: string,
  side: { type: 'string', enum: ['offense', 'defense'] },
  relativeToId: string, selectMany: {type:'boolean'}, receiverNumber: {type:'number'}, fieldSide: {type:'string',enum:['left','right']},
  relation: { type: 'string', enum: ['in_front', 'nearest', 'left_of', 'right_of', 'outside_of', 'inside_of', 'over', 'strong_side', 'weak_side', 'receiver_number'] },
});
const filters = object({ concepts: { type: 'array', items: string, maxItems: 8 },
  formation: string, tags: { type: 'array', items: string, maxItems: 8 }, similarToCurrent: {type:'boolean'}, team: string, editableOnly: { type: 'boolean' } });

function validValue(schema, value) {
  if (schema.type === 'object') return value && typeof value === 'object' && !Array.isArray(value) &&
    Object.entries(value).every(([key, item]) => Object.hasOwn(schema.properties, key) && validValue(schema.properties[key], item));
  if (schema.type === 'array') return Array.isArray(value) && value.length <= schema.maxItems && value.every(item =>
    typeof schema.items === 'string' ? typeof item === schema.items && item.length <= 100 : validValue(schema.items, item));
  return typeof value === schema.type && (typeof value !== 'string' || value.length <= 150) && (!schema.enum || schema.enum.includes(value));
}
const validArgs = (schema, value) => !!validValue(schema, value);

export function createBoardTools(input, searchCatalog) {
  const resolved = new Set();
  const candidates = new Map();
  let searched = false;
  let similarRanks = null;
  let boardRead = false;
  const routeIds = new Set();
  const previews = new Map();
  function assertReferences(operations) {
    for (const op of operations) {
      const ids = [op.playerId, op.receiverId, op.nearId, ...(op.playerIds || []), ...(op.targetIds || [])].filter(id => id != null);
      if (!ids.every(id => resolved.has(id))) throw new Error('Resolve every referenced player before previewing or submitting.');
      const ownerId = op.kind === 'pass' ? input.board.ball?.holderId : op.playerId;
      if (op.routeId && (!routeIds.has(op.routeId) || !input.board.routes.some(route => route.id === op.routeId && route.playerId === ownerId)))
        throw new Error('The selected route does not belong to this player.');
    }
  }
  // A registry entry owns its schema, description and implementation together.
  const registry = {
    read_board: { schema: noArgs, description: 'Read the current diagram, marker IDs, positions, sides, selection and existing primary routes.',
      run: () => { boardRead = true; for (const route of input.board.routes) if (route.id) routeIds.add(route.id); const {play, ...board} = input.board; return board; } },
    resolve_player: { schema: fields, description: 'Find the exact marker by label/role, explicit roster name, number or side. For relative positioning pass relation and relativeToId of a resolved anchor. Returns found, missing or ambiguous. Resolve every edit actor and block target before editing.',
      run(args) {
        if (args.relativeToId && !resolved.has(args.relativeToId)) return { error: 'Resolve the anchor first.' };
        const result = resolveBoardPlayer(input.board.players, args);
        if (result.status === 'found') for (const player of result.candidates) resolved.add(player.id);
        return result;
      } },
    resolve_players: { schema: object({ selectors: { type: 'array', items: fields, maxItems: 20 } }),
      description: 'Resolve up to 20 selectors in one call. Set selectMany for explicit groups like OL. Left and right are the offense perspective.',
      run(args) {
        return { results: (args.selectors || []).map(selector => registry.resolve_player.run(selector)) };
      } },
    preview_edit: { schema: previewEditTool.function.parameters, description: previewEditTool.function.description,
      run(args) {
        const operations = parseBoardOperations(args.operations);
        assertReferences(operations);
        const proposal = proposeEdit(input.board.play || input.board, operations, {locale:input.locale});
        const evidence = {summary:proposal.summary, effects:proposal.effects, changes:proposal.changes,
          routeIds:proposal.routeIds, playerIds:proposal.playerIds, zoneIds:proposal.zoneIds, annotationIds:proposal.annotationIds, removed:proposal.removed};
        previews.set(JSON.stringify(operations), evidence);
        return evidence;
      } },
    search_madden: { schema: filters, description: 'Search the Madden catalog by English play-name concepts (OR), approximate geometry tags, formation, team and editability. For a football concept, provide both concepts and tags to find name and geometry matches. Tags are approximate and available only for editable diagrams. Inspect evidence and refine filters if needed. Set similarToCurrent to rank editable plays by the current board.',
      async run(args) {
        const rows = await searchCatalog(args, { language: input.locale, board: input.board });
        searched = true;
        similarRanks = args.similarToCurrent ? new Map(rows.map((row, index) => [row.id, index])) : null;
        for (const row of rows) candidates.set(row.id, row);
        return { candidates: rows };
      } },
  };
  const allowed = input.board.book === 'defense' || input.mode === 'edit' ? ['read_board', 'resolve_player', 'resolve_players', 'preview_edit'] : input.mode === 'search' ? ['search_madden'] : Object.keys(registry);
  const definitions = Object.entries(registry).filter(([name]) => allowed.includes(name)).map(([name, tool]) => ({ type: 'function',
    function: { name, description: tool.description, parameters: tool.schema } }));
  return { definitions, resolved, routeIds, candidates, didSearch: () => searched, didReadBoard: () => boardRead,
    getSimilarRanks: () => similarRanks, assertReferences,
    getPreview: operations => previews.get(JSON.stringify(operations)),
    async run(name, args) {
      const tool = Object.hasOwn(registry, name) && registry[name];
      if (!tool || !allowed.includes(name) || (name !== 'preview_edit' && !validArgs(tool.schema, args))) return { error: 'Unknown tool or invalid parameters; consult the tool schema.' };
      try { return await tool.run(args); }
      catch (error) { return {error:error instanceof Error ? error.message : 'Tool failed.'}; }
    } };
}
