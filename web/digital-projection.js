import * as THREE from './vendor/three-0.186.0/three.module.js';

// An oblique orthographic view with an inverse ground-plane scale. This keeps
// z=0 exactly registered with the SVG while real thickness projects upwards.
// The outer board transform can therefore move field, paths and chips together.
export const BOARD_VIEW_ANGLE = Math.PI / 5;
export const BOARD_DEPTH_OFFSET = Math.sin(BOARD_VIEW_ANGLE);
export function createBoardCamera() {
  const camera = new THREE.OrthographicCamera(-500, 500, 400, -400, .1, 2000);
  camera.position.set(500, 400 - 1000 * Math.sin(BOARD_VIEW_ANGLE), 1000 * Math.cos(BOARD_VIEW_ANGLE));
  camera.lookAt(500, 400, 0);
  camera.updateMatrixWorld();
  return camera;
}
export function createBoardSpace() {
  const space = new THREE.Group();
  space.scale.y = 1 / Math.cos(BOARD_VIEW_ANGLE);
  space.position.y = 400 * (1 - space.scale.y);
  return space;
}
export function boardWorldPoint(x, y, z = 0) {
  return new THREE.Vector3(x, 400 + (400 - y) / Math.cos(BOARD_VIEW_ANGLE), z);
}
