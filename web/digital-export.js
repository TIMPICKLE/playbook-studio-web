const SVG_NS='http://www.w3.org/2000/svg';

export function pngExportDescription({reference=false,digital=false,ready=false}={}) {
  if(reference)return '2000 × 1120 · 原图分辨率';
  if(digital&&!ready)return '2000 × 1600 · 兼容视图导出平面图';
  return `2000 × 1600 · ${digital?'当前 3D 视图':'平面战术图'}`;
}

// A full-scene capture already includes the camera, field, routes, pieces and
// labels. It must not be projected a second time or overlaid with SVG players.
export function composeDigitalExport(root,capture) {
  const doc=root.ownerDocument;
  if(capture.fullScene && capture.image) {
    const image=doc.createElementNS(SVG_NS,'image');
    image.setAttribute('href',capture.image);
    image.setAttribute('width','1000');image.setAttribute('height','800');
    image.setAttribute('x','0');image.setAttribute('y','0');
    image.setAttribute('data-digital-scene','');
    root.replaceChildren(image);
    root.removeAttribute('class');root.removeAttribute('style');root.removeAttribute('transform');
    root.setAttribute('viewBox','0 0 1000 800');
    root.setAttribute('width','1000');root.setAttribute('height','800');
    return root;
  }
  // The compatibility renderer uses perspective vector pieces on screen. Its
  // export is deliberately a portable flat play diagram, as stated in the UI.
  // Keep the current playback geometry and feedback supplied by the caller.
  const players=root.querySelector('#export-players');
  if(capture.decoration) {
    const decoration=doc.createElementNS(SVG_NS,'g');
    decoration.innerHTML=capture.decoration;root.insertBefore(decoration,players);
  }
  return root;
}
