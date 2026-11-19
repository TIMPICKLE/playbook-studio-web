import { t } from './i18n.js';
import { fieldSVG, updateAnimation } from './field.js';
import { createRouteFeedback } from './digital-routes.js';
const SVG_NS='http://www.w3.org/2000/svg';

export function pngExportDescription({reference=false,digital=false,ready=false}={}) {
  if(reference)return t('export.source_resolution');
  if(digital&&!ready)return t('export.fallback_flat');
  return `2000 × 1600 · ${t(digital ? 'export.current_3d' : 'export.flat_board')}`;
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

// The model, clock and view are captured when the user requests the PNG. A slow
// GPU decode or a later play selection must not change the exported instant.
export function pngFrameSVG(doc, play, view, capture = null) {
  if (capture?.fullScene && capture.image) {
    const svg = doc.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('xmlns', SVG_NS);
    return composeDigitalExport(svg, capture).outerHTML;
  }
  const template = doc.createElement('template');
  template.innerHTML = fieldSVG(play, view.settings, { prefix: 'export', time: view.time });
  const root = template.content.firstElementChild;

  updateAnimation(root, play, view.time, 'export');
  if (view.settings.visualMode === 'digital') {
    createRouteFeedback(root, play, 'export').update({ ...view, play });
  }
  return root.outerHTML;
}
