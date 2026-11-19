import test from 'node:test';
import assert from 'node:assert/strict';
import {createPieceGeometries,PIECE_HEIGHT} from '../web/digital-piece-geometry.js';
import {createBoardCamera} from '../web/digital-projection.js';
import * as THREE from '../web/vendor/three-0.186.0/three.module.js';

test('every magnetic player shares the same low profile, with a color band and flat face',()=>{
  for(const shape of ['circle','square','triangle']){
    const geometries=createPieceGeometries(shape),box=new THREE.Box3();
    for(const geometry of Object.values(geometries)){geometry.computeBoundingBox();box.union(geometry.boundingBox);}
    assert.equal(box.min.z,0);
    assert.ok(box.max.z-box.min.z<.30*(box.max.x-box.min.x),'the diameter exceeds three times the height');
    assert.ok(Math.abs(box.max.z-PIECE_HEIGHT)<.01);
    assert.deepEqual(Object.keys(geometries).sort(),['band','face','foot','rim']);
    assert.ok(geometries.face.attributes.normal.count>0);
    Object.values(geometries).forEach(g=>g.dispose());
  }
});

test('the rim remains visible without obscuring the next formation row',()=>{
  const camera=createBoardCamera(THREE);
  for(const [x,y] of [[70,100],[500,400],[930,740]]){
    const foot=new THREE.Vector3(x,800-y,0).project(camera),head=new THREE.Vector3(x,800-y,PIECE_HEIGHT).project(camera);
    assert.ok(head.y>foot.y,'the visible figure rises in screen space');
    const rise=(head.y-foot.y)*400;assert.ok(rise>2&&rise<10,'the edge has measurable relief without the old tall silhouette');
  }
});
