import { z } from './vendor/assistant-zod.js';
import { EDITOR_PLAY_COMMANDS } from './editor-play-commands.js';
import { EDITOR_ACTIONS } from './editor-actions.js';
import { BoardOperationSchema } from './assistant-schema.js';

const semantic = {
  defense_formation: 'Add or explicitly reset a complete local 4-3 defense.',
  route: 'Generate a measured route concept or waypoints.', block: 'Assign ordered blocks or a blocking scheme.',
  motion: 'Generate pre-snap motion.', move_player: 'Move or align a marker.', pass: 'Create a timed pass.',
  zone: 'Draw a named coverage zone.', timing: 'Adjust assignment timing.', remove_route: 'Remove an assignment.', annotate: 'Place a note by a player.',
};
const entries = registry => Object.values(registry);
export function editorCapabilities(input) {
  const hasWorkspace = !!input.editor?.data;
  return [
    ...Object.entries(semantic).map(([id, description]) => ({id, description, lane:'play', undoable:true,...(id === 'defense_formation' ? {uiBindings:['add-defense-43']} : {})})),
    ...entries(EDITOR_PLAY_COMMANDS).map(command => ({...command,lane:'play'})),
    ...entries(EDITOR_ACTIONS),
  ].map(({schema, ...command}) => {
    let unavailable = '';
    if (input.editor?.readOnly && (command.lane === 'play' || command.lane === 'workspace' || command.id === 'history_action')) unavailable = 'This workspace is read-only.';
    if (input.board.reference && command.lane === 'play' && command.id !== 'play_update') unavailable = 'A reference image has no editable geometry.';
    if (!hasWorkspace && command.lane === 'workspace') unavailable = 'Workspace context is unavailable.';
    return {...command, available:!unavailable, ...(unavailable ? {reason:unavailable} : {})};
  });
}
export function editorCommandSchema(id) {
  const command = [...entries(EDITOR_PLAY_COMMANDS),...entries(EDITOR_ACTIONS)].find(item => item.id === id);
  if (!command && !semantic[id]) return null;
  const {$schema, ...schema} = z.toJSONSchema(command?.schema || BoardOperationSchema,{io:'input',target:'draft-7'});
  if (!command) {
    const flatten = value => value.anyOf ? value.anyOf.flatMap(flatten) : [value];
    const branches=flatten(schema).filter(value => value.properties?.kind?.const === id);
    return branches.length === 1 ? branches[0] : {anyOf:branches};
  }
  return schema;
}
