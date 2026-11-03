// Each view keeps its first attempt even when a player repeats a published drill.
const views = ['pov', 'field', 'mixed'];
const validAnswer = answer => answer && typeof answer.correct === 'boolean' && typeof answer.hinted === 'boolean' && Array.isArray(answer.ids);

export function trainingProgress(getScope, storage = () => globalThis.localStorage) {
  const cache = new Map();
  let persistent = true;
  const key = (source, drill) => 'playbook:training:v1:' + JSON.stringify([getScope(), source, drill.id, drill.revision]);
  function read(source, drill) {
    const id = key(source, drill);
    try {
      const raw = storage()?.getItem(id);
      if (raw && persistent) {
        const item = JSON.parse(raw);
        if (Number.isInteger(item?.attempts) && validAnswer(item.last) && item.first && views.includes(item.last.view)) cache.set(id, item);
      }
    } catch { /* A blocked or damaged entry should never block a practice round. */ }
    return cache.get(id) || { attempts: 0, first: {}, last: null };
  }
  function record(source, drill, answer) {
    const prev = read(source, drill);
    const next = { attempts: prev.attempts + 1, first: { ...prev.first, [answer.view]: prev.first[answer.view] || answer }, last: answer };
    const id = key(source, drill);
    cache.set(id, next);
    try {
      const store = storage();
      if (!store) persistent = false;
      else store.setItem(id, JSON.stringify(next));
    } catch { persistent = false; }
    return next;
  }
  return { read, record, isPersistent: () => persistent };
}

export function trainingResult(answer) {
  if (!answer) return 'never';
  if (!answer.correct) return 'wrongResult';
  return answer.hinted ? 'correctHinted' : 'okResult';
}
