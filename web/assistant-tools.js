import { resolveBoardPlayer } from './assistant-edit.js';

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
  formation: string, tags: { type: 'array', items: string, maxItems: 8 }, similarToCurrent: {type:'boolean'}, team: { type: 'string', enum: ['eagles', 'ravens'] }, editableOnly: { type: 'boolean' } });

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
  // A registry entry owns its schema, description and implementation together.
  const registry = {
    read_board: { schema: noArgs, description: 'Read the current diagram, marker IDs, positions, sides, selection and existing primary routes.',
      run: () => { boardRead = true; for (const route of input.board.routes) if (route.id) routeIds.add(route.id); return input.board; } },
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
    search_madden: { schema: filters, description: 'Search the Madden catalog by English play-name concepts (OR), approximate geometry tags, formation, team and editability. For a football concept, provide both concepts and tags to find name and geometry matches. Tags are approximate and available only for editable diagrams. Inspect evidence and refine filters if needed. Set similarToCurrent to rank editable plays by the current board.',
      async run(args) {
        const rows = await searchCatalog(args, { language: input.locale, board: input.board });
        searched = true;
        similarRanks = args.similarToCurrent ? new Map(rows.map((row, index) => [row.id, index])) : null;
        for (const row of rows) candidates.set(row.id, row);
        return { candidates: rows };
      } },
  };
  const allowed = input.board.book === 'defense' || input.mode === 'edit' ? ['read_board', 'resolve_player', 'resolve_players'] : input.mode === 'search' ? ['search_madden'] : Object.keys(registry);
  const definitions = Object.entries(registry).filter(([name]) => allowed.includes(name)).map(([name, tool]) => ({ type: 'function',
    function: { name, description: tool.description, parameters: tool.schema } }));
  return { definitions, resolved, routeIds, candidates, didSearch: () => searched, didReadBoard: () => boardRead,
    getSimilarRanks: () => similarRanks,
    async run(name, args) {
      const tool = Object.hasOwn(registry, name) && registry[name];
      if (!tool || !allowed.includes(name) || !validArgs(tool.schema, args)) return { error: 'Unknown tool or invalid parameters; consult the tool schema.' };
      return tool.run(args);
    } };
}
