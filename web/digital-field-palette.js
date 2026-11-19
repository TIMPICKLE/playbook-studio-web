// Board-space colours are literal sRGB so they survive SVG serialization,
// the Three.js texture upload and a standalone PNG without the editor CSS.
const DARK = Object.freeze({
  top: '#343a43', middle: '#282e36', bottom: '#1d2128', edge: '#14171b',
  major: '#69727f', minor: '#454c56', hash: '#535c68', yard: '#b7bec8',
  los: '#e4e7eb', ink: '#f3f4f6', focus: '#d8dde4',
  innerRim: '#929ba7', outerRim: '#535c68', frame: '#89929d', plinth: '#252a32',
  stageLit: '#303741', stageMid: '#1c2026', stageShade: '#14171b',
});
const LIGHT = Object.freeze({
  top: '#edf0f3', middle: '#e0e3e8', bottom: '#d3d8de', edge: '#afb6bf',
  major: '#929ba6', minor: '#b7bec7', hash: '#a5aeb9', yard: '#4a5059',
  los: '#3f4752', ink: '#303741', focus: '#414b58',
  innerRim: '#f3f4f6', outerRim: '#98a1ac', frame: '#a6afb9', plinth: '#69737f',
  stageLit: '#949da8', stageMid: '#747e8b', stageShade: '#626c78',
});

export const digitalFieldPalette = theme => theme === 'light' ? LIGHT : DARK;

export const DIGITAL_FIELD_LIGHT = Object.freeze({
  sky: '#f4f5f7', ground: '#454b53', key: '#fffdf9', fill: '#d9e1eb',
});

// The surround and the vector plinth use the same colours as the 3D board.
// Build the two CSS declarations once; the mounted editor picks one on render.
function chrome(p) {
  return `--field-stage-lit:${p.stageLit};--field-stage-mid:${p.stageMid};--field-stage-shade:${p.stageShade};--field-frame:${p.frame};--field-plinth:${p.plinth};--field-edge:${p.edge};--field-rim:${p.outerRim}`;
}
const darkChrome = chrome(DARK), lightChrome = chrome(LIGHT);
export const digitalFieldChrome = theme => theme === 'light' ? lightChrome : darkChrome;
