import { resolveBoardPlayer } from './assistant-edit.js';
import { proposeEdit } from './assistant-proposal.js';
import { previewEditTool, previewActionsTool, parseBoardOperations, controlFilmParameters } from './assistant-schema.js';
import { FILM_COMMAND_SCHEMAS, pendingFilmDecision, validateFilmCommand } from './coach-film-commands.js';
import { EDITOR_PLAY_COMMANDS } from './editor-play-commands.js';
import { parseEditorActions, prepareEditorActions, getEditorOverview, usesLivePlayback } from './editor-actions.js';
import { editorCapabilities, editorCommandSchema } from './editor-capabilities.js';
import { loadEditableEntries } from './madden-model.js';
import { conversationContext } from './assistant-session.js';
import { FLAG5_FORMATIONS, defaultFormation, formationOptions, getPlayLeague, isFlag5Play } from './game-formats.js';

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

export function createBoardTools(input, searchCatalog, film) {
  // Players this conversation already worked with, and the coach's selection,
  // are host-verified against the current board. Requiring the model to look
  // them up again only turned a follow-up without a subject into an error.
  const resolved = new Set(conversationContext(input).known);
  const candidates = new Map();
  let searched = false;
  let similarRanks = null;
  let boardRead = false;
  const routeIds = new Set();
  const previews = new Map();
  const actionPreviews = new Map();
  let editorRead = false;
  let filmObserved = false;
  let filmState = null;
  const filmSchemas = new Map(FILM_COMMAND_SCHEMAS.map(schema => ['film_' + schema.properties.operation.const, schema]));
  function capabilities() {
    const result = editorCapabilities(input);
    if (film) for (const [id, schema] of filmSchemas) {
      const operation = schema.properties.operation.const;
      const available = filmState?.available && (filmState.available[operation] === true || (operation === 'lesson' && filmState.lessonOnRequest === true));
      result.push({id, lane:'film', description:schema.description, available:available ?? null});
    }
    return result;
  }
  async function observeFilm(call) {
    try {
      const state = await call();
      if (!state || typeof state !== 'object' || Array.isArray(state)) throw Error('No film state was returned.');
      filmObserved = true;
      if (state.available && typeof state.available === 'object') filmState = state;
      return state;
    } catch (error) {
      if (error?.awaitingFilmHost) throw error;
      filmObserved = true;
      return {error: error?.message || 'Film control failed.', ...(error?.code ? {code:error.code} : {}), ...(error?.details ? {details:error.details} : {})};
    }
  }
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
        for (const id of op.playerIds || []) if (!exists(id,'player')) throw new Error('The referenced editor object does not exist.');
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
      run() {editorRead = true;return {...(input.editor?.data ? getEditorOverview(input.editor.data,input.board.playId) : {}), capabilities:capabilities(), view:input.editor?.view || {}};}},
    list_capabilities: {schema:object({category:string}),description:'Discover registered commands. Categories: play, workspace, local, interaction, film. Film commands run on the open editor through control_film. Read read_film for device, current scene and lesson availability.',
      async run(args) {
        if (film && args.category === 'film') {
          const scene = await observeFilm(() => film.read());
          if (scene.error) return scene;
        }
        return {capabilities:capabilities().filter(command => !args.category || command.lane === args.category)};
      }},
    get_command_schema: {schema:object({command:string}),description:'Get the authoritative parameter schema for a discovered editor command.',
      run(args) {const schema=(film && filmSchemas.get(args.command)) || editorCommandSchema(args.command);return schema ? {command:args.command,schema} : {error:'Unknown editor command. Consult list_capabilities.'};}},
    ...(film ? {
      read_film: {schema:noArgs, description:'Read the film source, events and availability. A committed play can provide the live scene, time, theme, ball, focus, comparison, reference and lesson. A staged preview provides its own planned events and players for inspection. Check source, open and available before reporting an action.',
        run:() => observeFilm(() => film.read())},
      control_film: {schema:controlFilmParameters,description:'Perform a requested film or lesson action on this device and return its actual updated state or a structured error. Call again for another step. Use exact event IDs and real player IDs. Save a lesson only on an explicit request.',
        run(args) {
          if (!args || typeof args !== 'object' || !Object.hasOwn(args,'command') || Object.keys(args).length !== 1) throw Error('Supply one film command.');
          return observeFilm(() => film.execute(validateFilmCommand(args.command)));
        }},
    } : {}),
    preview_actions: {schema:previewActionsTool.function.parameters,description:previewActionsTool.function.description,
      async run(args) {
        if (!editorRead) throw new Error('Read the editor context before preparing editor actions.');
        const actions=parseEditorActions(args.actions);
        if (input.board.source === 'staged' && actions.some(usesLivePlayback)) return pendingFilmDecision(input.locale);
        if (!input.editor?.data) throw new Error('Workspace context is unavailable.');
        if (actions.some(action => action.kind === 'catalog_import' && !candidates.has(action.catalogId))) throw new Error('Search the catalog and choose a returned catalog ID before importing.');
        const catalogRows=actions.some(action => action.kind === 'catalog_import') ? input.editor.catalogRows || (await input.editor.loadCatalog?.())?.plays : undefined;
        await loadEditableEntries(actions.filter(action => action.kind === 'catalog_import').map(action => action.catalogId));
        const plan=prepareEditorActions({...input.editor,selectedId:input.board.playId,catalogRows},actions,{locale:input.locale});
        const evidence={lane:plan.lane,changes:plan.changes,summary:plan.summary,selectedId:plan.selectedId};
        actionPreviews.set(JSON.stringify(actions),evidence);
        return evidence;
      }},
    read_board: { schema: noArgs, description: 'Read the current diagram, player format, IDs, positions, sides, selection, routes and editing capabilities. In 5v5 flag use formation_apply for the current side or opponents_set for the opposing side. The dedicated 4-3 operation always adds eleven tackle defenders.',
      run: () => { boardRead = true; for (const route of input.board.routes) if (route.id) routeIds.add(route.id); const {play, ...board} = input.board;
        const diagram = play || board, count = getPlayLeague(diagram), flag5 = isFlag5Play(diagram), editable = !diagram.reference;
        const opposingSide = diagram.book === 'defense' ? 'offense' : 'defense';
        return {...board, playersPerSide:count, gameFormat:flag5 ? 'flag5' : 'unspecified', capabilities: {
          defenseFormations: editable ? (flag5 ? [...FLAG5_FORMATIONS.defense] : ['4-3']) : [],
          defenseFormationCommand: flag5 ? (diagram.book === 'defense' ? 'formation_apply' : 'opponents_set') : 'defense_formation',
          defenseFormationModes: flag5 ? [] : ['add', 'reset'], defensePlayerCount: flag5 ? 5 : 11, requiresEmptyDefenseForAdd: true, assignsCoverage: false,
          currentSideFormations: editable ? formationOptions(diagram.book, count) : [],
          formationCommand:'formation_apply', opponentsCommand:'opponents_set', opponentsCount:count, defaultOpponentFormation:defaultFormation(opposingSide, count),
          ...(flag5 ? { flag5Formations:FLAG5_FORMATIONS, tackleDefense:{command:'defense_formation',formation:'4-3',count:11},
            addOpponents:{kind:'opponents_set',enabled:true,count:5},
            formatNote:'Flag templates describe alignment only. Use formation_apply for your current side; opponents_set adds the default opposing formation. The center can receive. Do not default to blocking, tackling or kicking; competition rushing, QB-run and field rules remain unconfirmed.' } : {})}}; } },
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
    getSimilarRanks: () => similarRanks, assertReferences, didReadEditor:()=>editorRead, didObserveFilm:()=>filmObserved,
    getActionPreview: actions => actionPreviews.get(JSON.stringify(actions)),
    getPreview: operations => previews.get(JSON.stringify(operations)),
    async run(name, args) {
      const tool = Object.hasOwn(registry, name) && registry[name];
      if (!tool || !allowed.includes(name) || (!['preview_edit','preview_actions','control_film'].includes(name) && !validArgs(tool.schema, args))) return { error: 'Unknown tool or invalid parameters; consult the tool schema.' };
      try { return await tool.run(args); }
      catch (error) { if (error?.awaitingFilmHost) throw error;return {error:error instanceof Error ? error.message : 'Tool failed.'}; }
    } };
}
