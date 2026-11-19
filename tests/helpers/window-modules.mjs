const web = new URL('../../web/', import.meta.url).href;

// Node shares its ESM cache across Happy DOM windows. Scope the editor's own
// imports to the same test window as their parent, as a real document would.
export async function resolve(specifier, context, nextResolve) {
  const result = await nextResolve(specifier, context);
  if (!context.parentURL?.startsWith(web) || !result.url.startsWith(web)) return result;
  const windowId = new URL(context.parentURL).searchParams.get('test-window');
  if (!windowId) return result;
  const url = new URL(result.url);
  url.searchParams.set('test-window', windowId);
  return { ...result, url: url.href };
}
