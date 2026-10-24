// Small DOM patcher for the library. No transitions or whole-panel remounts.
const key = (node, index) => node.nodeType !== 1 ? `text:${index}` : `${node.tagName}:${node.id || node.dataset.maddenCard || (node.dataset.madden ? node.dataset.madden + ':' + (node.dataset.id || '') : (typeof node.className === 'string' ? node.className.split(' ')[0] : '') || index)}`;
export function reconcileHTML(root, html) {
  const template = document.createElement('template'); template.innerHTML = html;
  patch(root, template.content);
}
function patch(parent, source) {
  const old = [...parent.childNodes], wanted = [...source.childNodes];
  const keyed = new Map(old.map((node, i) => [key(node, i), node]));
  const retained = new Set();
  wanted.forEach((next, i) => {
    let node = keyed.get(key(next, i));
    if (!node || node.nodeType !== next.nodeType || node.nodeName !== next.nodeName) node = next.cloneNode(true);
    else if (node.nodeType === 3) { if (node.textContent !== next.textContent) node.textContent = next.textContent; }
    else if (node.nodeType === 1) {
      for (const a of [...node.attributes]) if (!next.hasAttribute(a.name)) node.removeAttribute(a.name);
      for (const a of [...next.attributes]) if (node.getAttribute(a.name) !== a.value) node.setAttribute(a.name, a.value);
      // These slots are managed separately after the shell is patched.
      if (!node.matches('.madden-detail-slot,.madden-result-bar,.madden-results')) patch(node, next);
      if (node.tagName === 'INPUT' && node.type === 'checkbox') node.checked = next.checked;
      if (node.tagName === 'INPUT' && node.value !== next.value) node.value = next.value;
    }
    retained.add(node);
    if (parent.childNodes[i] !== node) parent.insertBefore(node, parent.childNodes[i] || null);
  });
  for (const node of old) if (!retained.has(node)) node.remove();
}
