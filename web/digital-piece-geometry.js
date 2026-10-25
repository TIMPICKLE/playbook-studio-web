import * as THREE from './vendor/three-0.186.0/three.module.js';

export const PIECE_HEIGHT = 50.3;
export function pieceFootprint(shapeName='circle',radius=17.5) {
  const shape=new THREE.Shape();
  if(shapeName==='square'){
    const half=radius*.88,r=4;
    shape.moveTo(-half+r,-half);shape.lineTo(half-r,-half);shape.quadraticCurveTo(half,-half,half,-half+r);
    shape.lineTo(half,half-r);shape.quadraticCurveTo(half,half,half-r,half);shape.lineTo(-half+r,half);
    shape.quadraticCurveTo(-half,half,-half,half-r);shape.lineTo(-half,-half+r);shape.quadraticCurveTo(-half,-half,-half+r,-half);
  }else if(shapeName==='triangle'){
    const r=radius*1.1;
    shape.moveTo(-2,r);shape.quadraticCurveTo(0,r+2,2,r);shape.lineTo(r,-r*.61);
    shape.quadraticCurveTo(r+2,-r*.78,r-2,-r*.78);shape.lineTo(-r+2,-r*.78);
    shape.quadraticCurveTo(-r-2,-r*.78,-r,-r*.61);shape.closePath();
  }else shape.absarc(0,0,radius,0,Math.PI*2,false);
  return shape;
}
export function createPieceGeometries(shapeName='circle') {
  const base=new THREE.ExtrudeGeometry(pieceFootprint(shapeName),{depth:3.8,steps:1,bevelEnabled:true,bevelSize:.85,bevelThickness:.8,bevelSegments:5,curveSegments:48});
  base.translate(0,0,1);
  const profile=[[0,4.7],[14.7,4.7],[15.1,6.1],[13.1,8.3],[10.5,12],[8.3,18],[8.1,23.7],[10.3,27],[10.3,28.5],[0,28.5]];
  const body=new THREE.LatheGeometry(profile.map(([r,h])=>new THREE.Vector2(r,h)),64);body.rotateX(Math.PI/2);
  const collar=new THREE.CylinderGeometry(10.7,10.7,1.2,64);collar.rotateX(Math.PI/2);collar.translate(0,0,29);
  const head=new THREE.SphereGeometry(11.8,48,32);head.translate(0,0,38.5);
  const core=new THREE.SphereGeometry(8.2,32,20);core.translate(0,0,38.5);
  const signal=new THREE.TorusGeometry(14.2,.65,12,64);signal.translate(0,0,6.4);
  return {base,body,collar,head,core,signal};
}

export function roundedRectangle(x,y,width,height,radius) {
  const shape=new THREE.Shape(),r=Math.min(radius,width/2,height/2);
  shape.moveTo(x+r,y);shape.lineTo(x+width-r,y);shape.quadraticCurveTo(x+width,y,x+width,y+r);
  shape.lineTo(x+width,y+height-r);shape.quadraticCurveTo(x+width,y+height,x+width-r,y+height);
  shape.lineTo(x+r,y+height);shape.quadraticCurveTo(x,y+height,x,y+height-r);
  shape.lineTo(x,y+r);shape.quadraticCurveTo(x,y,x+r,y);return shape;
}
