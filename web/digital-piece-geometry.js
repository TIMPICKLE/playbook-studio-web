import * as THREE from './vendor/three-0.186.0/three.module.js';
import { puckFaces } from './digital-puck.js';
export { PIECE_HEIGHT } from './digital-puck.js';

export function createPieceGeometries(shape='circle') {
  const surfaces = new Map();
  for (const {vertices,normal,material} of puckFaces(shape)) {
    if (!surfaces.has(material)) surfaces.set(material, {positions:[],normals:[]});
    const {positions,normals}=surfaces.get(material);
    for (let i=1; i<vertices.length-1; i++) {
      positions.push(...vertices[0],...vertices[i],...vertices[i+1]);
      normals.push(...normal,...normal,...normal);
    }
  }
  return Object.fromEntries([...surfaces].map(([name,{positions,normals}]) => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
    geometry.setAttribute('normal',new THREE.Float32BufferAttribute(normals,3));
    return [name,geometry];
  }));
}
export function roundedRectangle(x,y,width,height,radius) {
  const shape=new THREE.Shape(),r=Math.min(radius,width/2,height/2);
  shape.moveTo(x+r,y);shape.lineTo(x+width-r,y);shape.quadraticCurveTo(x+width,y,x+width,y+r);
  shape.lineTo(x+width,y+height-r);shape.quadraticCurveTo(x+width,y+height,x+width-r,y+height);
  shape.lineTo(x+r,y+height);shape.quadraticCurveTo(x,y+height,x,y+height-r);
  shape.lineTo(x,y+r);shape.quadraticCurveTo(x,y,x+r,y);return shape;
}
