// Patch the editor shell without remounting its independently managed surfaces.
// Use only for the same play; switching plays keeps the full render boundary.
const managed = node => node.matches?.('.board-ai,.liquid-surface-canvas');
const controlKey = node => {
  const control = node.matches('label') ? node.querySelector('input,select,textarea') : node;
  return control?.id || (control?.hasAttribute('data-prop') ? `prop:${control.dataset.prop}` : '') ||
    (control?.hasAttribute('data-ball') ? `ball:${control.dataset.ball}` : '');
};
function key(node, index) {
  if (node.nodeType !== 1) return `${node.nodeType}:${index}`;
  return `${node.tagName}:${node.id || node.getAttribute('data-action') || controlKey(node) ||
    (typeof node.className === 'string' ? node.className.split(' ')[0] : '') || index}`;
}

export function patchEditorHTML(root, html) {
  const template = root.ownerDocument.createElement('template');
  template.innerHTML = html;
  patchChildren(root, template.content);
}

function patchChildren(parent, source) {
  const old = [...parent.childNodes].filter(node => !managed(node));
  const wanted = [...source.childNodes];
  const keyed = new Map();
  old.forEach((node, index) => {
    const id = key(node, index);
    if (!keyed.has(id)) keyed.set(id, []);
    keyed.get(id).push(node);
  });
  const retained = new Set();
  let cursor = old[0] || null;
  wanted.forEach((next, index) => {
    const candidates = keyed.get(key(next, index));
    let node = candidates?.shift();
    if (!node || node.nodeType !== next.nodeType || node.nodeName !== next.nodeName) node = next.cloneNode(true);
    else if (node.nodeType === 3) {
      if (node.textContent !== next.textContent) node.textContent = next.textContent;
    } else if (node.nodeType === 1) patchElement(node, next);
    retained.add(node);
    if (node !== cursor) parent.insertBefore(node, cursor);
    else cursor = cursor.nextSibling;
    while (cursor && managed(cursor)) cursor = cursor.nextSibling;
  });
  for (const node of old) if (!retained.has(node)) node.remove();
}

function patchElement(node, next) {
  // The field renderer and thumbnail observer own these subtrees. In particular,
  // never detach a live SVG/canvas merely because the shell template is empty.
  if (node.matches('.pitch-stage')) return;
  const focused = node === node.ownerDocument.activeElement;
  const contextChanged = node.matches('.inspector') && node.dataset.context !== next.dataset.context;
  const localChoice = node.id === 'personnel-group' ? node.value : null;
  const focusedValue = focused && ['INPUT','TEXTAREA'].includes(node.tagName) ? node.value : null;
  const selection = focusedValue !== null && typeof node.selectionStart === 'number'
    ? [node.selectionStart,node.selectionEnd,node.selectionDirection] : null;
  const open = node.tagName === 'DETAILS' && node.open;
  for (const attribute of [...node.attributes]) {
    if (!next.hasAttribute(attribute.name) && !(attribute.name === 'open' && open)) node.removeAttribute(attribute.name);
  }
  for (const attribute of next.attributes) {
    if (node.getAttribute(attribute.name) !== attribute.value) node.setAttribute(attribute.name, attribute.value);
  }
  if (contextChanged) node.replaceChildren(...next.childNodes);
  else if (!node.matches('.play-thumb')) patchChildren(node, next);
  if (node.tagName === 'INPUT') {
    if (['checkbox','radio'].includes(node.type)) node.checked = next.checked;
    else if (!focused && node.value !== next.value) node.value = next.value;
  } else if (node.tagName === 'TEXTAREA' && !focused && node.value !== next.value) node.value = next.value;
  else if (node.tagName === 'SELECT') {
    node.value = localChoice !== null && [...node.options].some(option => option.value === localChoice)
      ? localChoice : next.value;
  }
  if (focusedValue !== null) {
    if (node.value !== focusedValue) node.value = focusedValue;
    if (selection) node.setSelectionRange(...selection);
  }
}
