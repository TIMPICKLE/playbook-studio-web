import { SEED_TRACES } from './madden-editable-seed.js';
import { BATCH_TRACES } from './madden-editable-batch.js';
import { EXPANDED_TRACES } from './madden-editable-80.js';
export const EDITABLE_TRACES = { ...SEED_TRACES, ...BATCH_TRACES, ...EXPANDED_TRACES };
