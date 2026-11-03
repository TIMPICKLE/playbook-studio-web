import catalog from '../web/data/huddle-catalog.json' with { type: 'json' };
import { searchMaddenCatalog } from '../web/assistant-search.js';

// Cloud requests always search this deployment's catalog.
export function searchServerMadden(args) {
  return searchMaddenCatalog(catalog, args);
}
