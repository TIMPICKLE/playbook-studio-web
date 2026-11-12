let pending;

export function loadMaddenCatalog() {
  if (!pending) {
    pending = fetch(new URL('./data/huddle-catalog.json', import.meta.url))
      .then(async response => {
        if (!response.ok) throw new Error('catalog-load');
        const catalog = await response.json();
        if (catalog.schemaVersion !== 1 || !catalog.plays?.length || !Array.isArray(catalog.teams) || !catalog.teams.length) throw new Error('catalog-invalid');
        return catalog;
      }).catch(error => {
        pending = undefined;
        throw error;
      });
  }
  return pending;
}
