export default {
  viewProcess: 'View process', traceTool: 'Tool', traceValidation: 'Validation repair', traceResult: 'Result',
  clearMode: 'Clear mode', apply: 'Apply', repreview: 'Preview again', discard: 'Discard', rehearse: 'Preview rehearsal', discarded: 'Preview discarded.', pendingTitle: 'Pending changes', revert: 'Undo last step', reverted: 'Last step removed. Earlier changes are still pending.', resolveFirst: 'Apply or discard the playbook change above before sending another instruction.', expand: 'Show preview', handoff: 'Analyze matchup',
  toolProgress: {read_editor:'Reading editor state…',list_capabilities:'Checking available features…',get_command_schema:'Checking action parameters…',preview_actions:'Preparing action preview…',read_board:'Reading the board…', resolve_player:'Finding', resolve_players:'Finding players', search_madden:'Searching the Madden library…', build_preview:'Preparing the preview…'},
  title: 'Board assistant', open: 'Open AI board assistant', close: 'Collapse assistant', settings: 'Model settings', move: 'Move panel',
  guide: 'Edit a play, adjust the view, or start rehearsal.', edit: 'Add a defensive front', search: 'Find a Madden play', editExample: 'Add a complete 4-3 defense to this diagram while retaining the offense and its routes.',
  searchExample: 'Find Madden offensive plays to attack Cover 3.', prompt: 'Describe what to edit, rehearse, view or export…', send: 'Send', cancel: 'Cancel request',
  mic: 'Dictate instruction', micStop: 'Stop dictation', micUnavailable: 'Dictation is unavailable in this browser. Type your instruction.', listening: 'Listening…',
  micDenied: 'Microphone access is off. Type your instruction.', micError: 'No speech received. Try again or type your instruction.', micBusy: 'Finish dictation before sending.',
  provider: 'Provider', model: 'Model ID', key: 'API key', keyHint: 'Your instruction and relevant play data are sent to your model provider. The key stays on this page.',
  protocol: 'API format', customProvider: 'Other compatible service', customUrlRequired: 'Enter the custom service URL.',
  customCloudHint: 'Use an HTTPS base URL or full API endpoint. An administrator must allow the host for cloud requests.',
  customBrowserHint: 'Use an HTTPS base URL or full API endpoint. Your browser calls this service directly; the service must allow CORS.',
  done: 'Done', configure: 'Enter a model ID and API key, then send your instruction.', loading: 'Working on your instruction…', error: 'Could not complete the request. Try again.',
  empty: 'No matching plays. Try a formation or route concept.', matches: 'Madden play matches', added: 'Added', add: 'Add to playbook',
  editable: 'Editable', reference: 'Image', undo: 'Undo play edit', undone: 'Play edit undone.', undoExpired: 'The play has changed. Use Undo in the editor.',
  clarified: 'Add a clarification…', readonly: 'Read-only playbook. You can inspect, search and adjust the view.', addFailed: 'Could not add this play. Check your current playbook.',
  change: 'Board updated.', changed: 'Switched play.', reason: 'Why it matches', original: 'Original command', followup: 'Clarification requested', answer: 'Your answer', guideSearch: 'Inspect a play, adjust the view, or search the library.'
};
