import { SEED_TRACES } from './madden-editable-seed.js';
import { BATCH_TRACES } from './madden-editable-batch.js';
import { EXPANDED_TRACES } from './madden-editable-80.js';
import { REVIEWED_OCT28_TRACES } from './madden-editable-oct28.js';
import { CONTINUED_TRACES } from './madden-editable-continued.js';
import { FINAL_TRACES } from './madden-editable-final.js';
export const EDITABLE_TRACES = { ...SEED_TRACES, ...BATCH_TRACES, ...EXPANDED_TRACES, ...REVIEWED_OCT28_TRACES, ...CONTINUED_TRACES, ...FINAL_TRACES };
