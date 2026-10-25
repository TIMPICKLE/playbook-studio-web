import { clamp } from './model.js';
import { screenToBoard } from './digital-projection.js';

// The inverse screen matrix includes SVG viewBox scaling, CSS projection and
// scrolling. A bounding rectangle loses the shear/rotation terms of a 2.5D view.
export function clientPointToField(point,inverse) {
  const x=inverse.a*point.x+inverse.c*point.y+inverse.e;
  const y=inverse.b*point.x+inverse.d*point.y+inverse.f;
  return {x:clamp((x-18)/9.64),y:clamp((y-20)/7.6)};
}

export function fieldCoordinates(svg,event) {
  const stage=svg.closest?.('.pitch-stage.is-perspective');
  if(stage){const rect=stage.getBoundingClientRect();const point=screenToBoard({x:clamp(event.clientX,rect.left,rect.left+rect.width),y:clamp(event.clientY,rect.top,rect.top+rect.height)},rect);if(point)return {x:clamp((point.x-18)/9.64),y:clamp((point.y-20)/7.6)};}

  try {
    const inverse=svg.getScreenCTM?.()?.inverse();
    if(inverse&&['a','b','c','d','e','f'].every(key=>Number.isFinite(inverse[key]))) {
      return clientPointToField({x:event.clientX,y:event.clientY},inverse);
    }
  } catch { /* Detached/hidden SVGs may not expose an invertible screen matrix. */ }
  const box=svg.getBoundingClientRect();
  return clientPointToField({x:event.clientX,y:event.clientY},{a:1000/(box.width||1000),b:0,c:0,d:800/(box.height||800),e:-box.left*1000/(box.width||1000),f:-box.top*800/(box.height||800)});
}
