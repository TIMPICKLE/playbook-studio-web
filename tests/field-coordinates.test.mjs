import test from 'node:test';
import assert from 'node:assert/strict';
import { clientPointToField, fieldCoordinates } from '../web/field-coordinates.js';

function screenPoint(point,matrix) {
  const x=18+point.x*9.64,y=20+point.y*7.6;
  return {clientX:matrix.a*x+matrix.c*y+matrix.e,clientY:matrix.b*x+matrix.d*y+matrix.f};
}
function inverse(m) {
  const det=m.a*m.d-m.b*m.c;
  return {a:m.d/det,b:-m.b/det,c:-m.c/det,d:m.a/det,e:(m.c*m.f-m.d*m.e)/det,f:(m.b*m.e-m.a*m.f)/det};
}
function near(actual,expected) {
  assert.ok(Math.abs(actual.x-expected.x)<1e-9,`x: ${actual.x} ≈ ${expected.x}`);
  assert.ok(Math.abs(actual.y-expected.y)<1e-9,`y: ${actual.y} ≈ ${expected.y}`);
}

test('field input follows 2x zoom, 2.5D shear and scrolled screen translation together',()=>{
  const matrix={a:2,b:0,c:-.28,d:1.72,e:140,f:-360};
  let inverseCalls=0;
  const svg={getScreenCTM:()=>({inverse(){inverseCalls++;return inverse(matrix);}}),getBoundingClientRect(){throw new Error('Bounding box must not replace an invertible CTM');}};
  for(const point of [{x:0,y:0},{x:62,y:38},{x:100,y:100}])near(fieldCoordinates(svg,screenPoint(point,matrix)),point);
  assert.equal(inverseCalls,3);
  const start={x:62,y:38},end={x:64,y:40};
  const a=fieldCoordinates(svg,screenPoint(start,matrix)),b=fieldCoordinates(svg,screenPoint(end,matrix));
  near({x:b.x-a.x,y:b.y-a.y},{x:2,y:2});
});

test('local conversion clamps points outside the playable field',()=>{
  const identity={a:1,b:0,c:0,d:1,e:0,f:0};
  assert.deepEqual(clientPointToField({x:-500,y:-400},identity),{x:0,y:0});
  assert.deepEqual(clientPointToField({x:5000,y:4000},identity),{x:100,y:100});
});

test('non-matrix SVG environments retain ordinary zoomed rectangular coordinates',()=>{
  const point={x:42,y:75},matrix={a:2,b:0,c:0,d:2,e:130,f:-300};
  const box={left:130,top:-300,width:2000,height:1600};
  const event=screenPoint(point,matrix);
  near(fieldCoordinates({getBoundingClientRect:()=>box},event),point);
  near(fieldCoordinates({getScreenCTM:()=>null,getBoundingClientRect:()=>box},event),point);
  near(fieldCoordinates({getScreenCTM:()=>({inverse(){throw new Error('singular');}}),getBoundingClientRect:()=>box},event),point);
});

test('perspective input reverses camera projection with zoom and scroll',async()=>{
  const {projectBoardPoint}=await import('../web/digital-projection.js');
  for(const zoom of [1,1.5,3]){
    const rect={left:-233,top:-391,width:1000*zoom,height:800*zoom};
    const svg={closest:()=>({getBoundingClientRect:()=>rect}),getScreenCTM(){throw new Error('Perspective must use the untransformed stage');}};
    for(const point of [{x:12,y:18},{x:50,y:50},{x:89,y:85}]){
      const screen=projectBoardPoint(18+point.x*9.64,20+point.y*7.6);
      near(fieldCoordinates(svg,{clientX:rect.left+screen.x*zoom,clientY:rect.top+screen.y*zoom}),point);
    }
  }
});
