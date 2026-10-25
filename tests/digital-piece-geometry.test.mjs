import test from 'node:test';
import assert from 'node:assert/strict';
import {createPieceGeometries,PIECE_HEIGHT} from '../web/digital-piece-geometry.js';
import {createBoardCamera} from '../web/digital-projection.js';
import * as THREE from '../web/vendor/three-0.186.0/three.module.js';

test('the digital player is a standing solid piece, not a low extruded disc',()=>{
  for(const shape of ['circle','square','triangle']){
    const geometries=createPieceGeometries(shape),box=new THREE.Box3();
    for(const geometry of Object.values(geometries)){geometry.computeBoundingBox();box.union(geometry.boundingBox);}
    assert.ok(box.max.z>=50&&box.max.z<=51);
    assert.ok(box.max.z-box.min.z>1.1*(box.max.x-box.min.x),'height exceeds base width');
    assert.ok(Math.abs(box.max.z-PIECE_HEIGHT)<.01);
    assert.ok(geometries.body.attributes.normal.count>0);
    Object.values(geometries).forEach(g=>g.dispose());
  }
});

test('piece head projects above its base under the actual perspective camera',()=>{
  const camera=createBoardCamera(THREE);
  for(const [x,y] of [[70,100],[500,400],[930,740]]){
    const foot=new THREE.Vector3(x,800-y,0).project(camera),head=new THREE.Vector3(x,800-y,PIECE_HEIGHT).project(camera);
    assert.ok(head.y>foot.y,'the visible figure rises in screen space');
    assert.ok((head.y-foot.y)*400>12,'the height has an unmistakable silhouette');
  }
});
