import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../web/vendor/three-0.186.0/three.module.js';
import {createBoardCamera,createBoardSpace,boardWorldPoint,BOARD_DEPTH_OFFSET} from '../web/digital-projection.js';

function pixel(point,camera){const ndc=point.clone().project(camera);return {x:(ndc.x+1)*500,y:(1-ndc.y)*400};}
function near(actual,expected){assert.ok(Math.abs(actual-expected)<1e-8,`${actual} should equal ${expected}`);}

test('oblique Three camera keeps every ground point registered with the SVG',()=>{
  const camera=createBoardCamera(),space=createBoardSpace();space.updateMatrixWorld(true);
  for(const x of [0,180,500,840,1000])for(const y of [0,160,400,660,800]){
    const world=space.localToWorld(new THREE.Vector3(x,800-y,0));
    const explicit=boardWorldPoint(x,y);near(world.x,explicit.x);near(world.y,explicit.y);
    const projected=pixel(world,camera);near(projected.x,x);near(projected.y,y);
  }
});

test('real chip height produces upward depth without horizontal position drift',()=>{
  const camera=createBoardCamera();
  for(const [x,y] of [[0,0],[500,400],[1000,800],[128,630]])for(const z of [0,3.5,6.35,10]){
    const projected=pixel(boardWorldPoint(x,y,z),camera);
    near(projected.x,x);near(projected.y,y-z*BOARD_DEPTH_OFFSET);
  }
});
