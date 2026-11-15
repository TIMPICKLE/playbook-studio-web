import { resolveBoardPlayer } from './assistant-edit.js';
import { proposeEdit } from './assistant-proposal.js';
import { previewEditTool, previewActionsTool, parseBoardOperations } from './assistant-schema.js';
import { EDITOR_PLAY_COMMANDS } from './editor-play-commands.js';
import { parseEditorActions, prepareEditorActions, getEditorOverview } from './editor-actions.js';
import { editorCapabilities, editorCommandSchema } from './editor-capabilities.js';

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
  const actionPreviews = new Map();
  let editorRead = false;
  const commandKinds = new Set(Object.values(EDITOR_PLAY_COMMANDS).map(command => command.id));
  const options = () => ({locale:input.locale,roster:input.editor?.data?.roster || [],formations:input.editor?.data?.formations || [],depthChart:input.editor?.data?.depthChart});
  function assertReferences(operations) {
    const aliases = new Map();
    const local = (id,type) => typeof id === 'string' && id.startsWith('$') && aliases.get(id.slice(1)) === type;
    const exists = (id,type) => local(id,type) || input.board[{player:'players',route:'routes',zone:'zones',annotation:'annotations'}[type]]?.some(item => item.id === id);
    for (const op of operations) {
      if (op.kind === 'defense_formation' && !boardRead) throw new Error('Read the current board before adding or resetting a defensive formation.');
      if (commandKinds.has(op.kind)) {
        if (!boardRead) throw new Error('Read the current board before preparing editor commands.');
        for (const [field,type] of [['playerId','player'],['routeId','route'],['zoneId','zone'],['annotationId','annotation']])
          if (op[field] && !exists(op[field],type)) throw new Error('The referenced editor object does not exist.');
        if (op.objectId && !exists(op.objectId,op.objectType)) throw new Error('The referenced editor object does not exist.');
        for (const id of [op.patch?.holderId,op.patch?.receiverId].filter(Boolean)) if (!exists(id,'player')) throw new Error('The referenced ball player does not exist.');
        if (op.as) {
          if (aliases.has(op.as)) throw new Error('Local object references must be unique.');
          aliases.set(op.as,{player_add:'player',route_add:'route',zone_add:'zone',annotation_add:'annotation'}[op.kind]);
        }
        continue;
      }
      const ids = [op.playerId, op.receiverId, op.nearId, ...(op.playerIds || []), ...(op.targetIds || [])].filter(id => id != null);
      if (!ids.every(id => resolved.has(id) || local(id,'player'))) throw new Error('Resolve every referenced player before previewing or submitting.');
      const ownerId = op.kind === 'pass' ? input.board.ball?.holderId : op.playerId;
      if (op.routeId && !local(op.routeId,'route') && (!routeIds.has(op.routeId) || !input.board.routes.some(route => route.id === op.routeId && route.playerId === ownerId)))
        throw new Error('The selected route does not belong to this player.');
    }
  }
  // A registry entry owns its schema, description and implementation together.
  const registry = {
    read_editor: {schema:noArgs,description:'Read available editor capabilities, real workspace play IDs, roster, saved formations, personnel groups and current view/playback state before using workspace or local actions.',
      run() {editorRead = true;return {...(input.editor?.data ? getEditorOverview(input.editor.data,input.board.playId) : {}), capabilities:editorCapabilities(input), view:input.editor?.view || {}};}},
    list_capabilities: {schema:object({category:string}),description:'Discover registered editor commands and availability. Categories: play, workspace, local, interaction. Geometry and metadata edits use preview_edit; other actions use preview_actions.',
      run(args) {return {capabilities:editorCapabilities(input).filter(command => !args.category || command.lane === args.category)};}},
    get_command_schema: {schema:object({command:string}),description:'Get the authoritative parameter schema for a discovered editor command.',
      run(args) {const schema=editorCommandSchema(args.command);return schema ? {command:args.command,schema} : {error:'Unknown editor command. Consult list_capabilities.'};}},
    preview_actions: {schema:previewActionsTool.function.parameters,description:previewActionsTool.function.description,
      async run(args) {
        if (!editorRead) throw new Error('Read the editor context before preparing editor actions.');
        const actions=parseEditorActions(args.actions);
        if (!input.editor?.data) throw new Error('Workspace context is unavailable.');
        if (actions.some(action => action.kind === 'catalog_import' && !candidates.has(action.catalogId))) throw new Error('Search the catalog and choose a returned catalog ID before importing.');
        const catalogRows=actions.some(action => action.kind === 'catalog_import') ? input.editor.catalogRows || (await input.editor.loadCatalog?.())?.plays : undefined;
        const plan=prepareEditorActions({...input.editor,selectedId:input.board.playId,catalogRows},actions,{locale:input.locale});
        const evidence={lane:plan.lane,changes:plan.changes,summary:plan.summary,selectedId:plan.selectedId};
        actionPreviews.set(JSON.stringify(actions),evidence);
        return evidence;
      }},
    read_board: { schema: noArgs, description: 'Read the current diagram, marker IDs, positions, sides, selection, existing primary routes and available editing capabilities. Local 4-3 defense can be added to an offensive diagram without searching Madden.',
      run: () => { boardRead = true; for (const route of input.board.routes) if (route.id) routeIds.add(route.id); const {play, ...board} = input.board;
        return {...board, capabilities: {defenseFormations: (play || board).reference ? [] : ['4-3'],
          defenseFormationModes: ['add', 'reset'], defensePlayerCount: 11, requiresEmptyDefenseForAdd: true, assignsCoverage: false}}; } },
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
        const proposal = proposeEdit(input.board.play || input.board, operations, options());
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
  // Mode is a preference, not a second capability/permission system. An editor
  // can search an offensive catalog while viewing defense, or edit a found play.
  const allowed = Object.keys(registry);
  const definitions = Object.entries(registry).filter(([name]) => allowed.includes(name)).map(([name, tool]) => ({ type: 'function',
    function: { name, description: tool.description, parameters: tool.schema } }));
  return { definitions, resolved, routeIds, candidates, didSearch: () => searched, didReadBoard: () => boardRead,
    getSimilarRanks: () => similarRanks, assertReferences, didReadEditor:()=>editorRead,
    getActionPreview: actions => actionPreviews.get(JSON.stringify(actions)),
    getPreview: operations => previews.get(JSON.stringify(operations)),
    async run(name, args) {
      const tool = Object.hasOwn(registry, name) && registry[name];
      if (!tool || !allowed.includes(name) || (!['preview_edit','preview_actions'].includes(name) && !validArgs(tool.schema, args))) return { error: 'Unknown tool or invalid parameters; consult the tool schema.' };
      try { return await tool.run(args); }
      catch (error) { return {error:error instanceof Error ? error.message : 'Tool failed.'}; }
    } };
}
