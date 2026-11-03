import { resolveBoardPlayer } from './assistant-edit.js';

const string = { type: 'string' };
const object = properties => ({ type: 'object', properties, additionalProperties: false });
const noArgs = object({});
const fields = object({
  name: string, role: string, number: string,
  side: { type: 'string', enum: ['offense', 'defense'] },
  relativeToId: string,
  relation: { type: 'string', enum: ['in_front', 'nearest', 'left_of', 'right_of'] },
});
const filters = object({ concepts: { type: 'array', items: string, maxItems: 8 },
  formation: string, team: { type: 'string', enum: ['eagles', 'ravens'] }, editableOnly: { type: 'boolean' } });

function validArgs(schema, value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return Object.entries(value).every(([key, item]) => {
    const prop = Object.hasOwn(schema.properties, key) && schema.properties[key];
    if (!prop) return false;
    if (prop.type === 'array') return Array.isArray(item) && item.length <= prop.maxItems &&
      item.every(s => typeof s === 'string' && s.length <= 100);
    return typeof item === prop.type && (typeof item !== 'string' || item.length <= 150) &&
      (!prop.enum || prop.enum.includes(item));
  });
}

export function createBoardTools(input, searchCatalog) {
  const resolved = new Set();
  const candidates = new Map();
  let searched = false;
  // A registry entry owns its schema, description and implementation together.
  const registry = {
    read_board: { schema: noArgs, description: 'Read the current diagram, marker IDs, positions, sides, selection and existing primary routes.',
      run: () => input.board },
    resolve_player: { schema: fields, description: 'Find the exact marker by label/role, explicit roster name, number or side. For relative positioning pass relation and relativeToId of a resolved anchor. Returns found, missing or ambiguous. Resolve every edit actor and block target before editing.',
      run(args) {
        if (args.relativeToId && !resolved.has(args.relativeToId)) return { error: 'Resolve the anchor first.' };
        const result = resolveBoardPlayer(input.board.players, args);
        if (result.status === 'found' && result.candidates.length === 1) resolved.add(result.candidates[0].id);
        return result;
      } },
    search_madden: { schema: filters, description: 'Search actual Madden catalog by English play concepts (OR), formation, team and editability. Choose football concepts based on the coach request. Inspect returned evidence; revise filters and search again if needed.',
      async run(args) {
        const rows = await searchCatalog(args, { language: input.locale });
        searched = true;
        for (const row of rows) candidates.set(row.id, row);
        return { candidates: rows };
      } },
  };
  const definitions = Object.entries(registry).map(([name, tool]) => ({ type: 'function',
    function: { name, description: tool.description, parameters: tool.schema } }));
  return { definitions, resolved, candidates, didSearch: () => searched,
    async run(name, args) {
      const tool = Object.hasOwn(registry, name) && registry[name];
      if (!tool || !validArgs(tool.schema, args)) return { error: 'Unknown tool or invalid parameters; consult the tool schema.' };
      return tool.run(args);
    } };
}
