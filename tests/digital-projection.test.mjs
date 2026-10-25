import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../web/vendor/three-0.186.0/three.module.js';
import { BOARD_CAMERA, BOARD_HOMOGRAPHY, createBoardCamera, boardWorldPoint, projectWorldPoint, projectBoardPoint, unprojectBoardPoint, screenToBoard, boardCSSMatrix } from '../web/digital-projection.js';

const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-7, `${actual} should equal ${expected}`);
const pixel = (world, camera) => { const p = new THREE.Vector3(world.x, world.y, world.z).project(camera); return { x: (p.x + 1) * 500, y: (1 - p.y) * 400 }; };

test('pure projection matches the actual Three PerspectiveCamera at ground and raised chip heights', () => {
  const camera = createBoardCamera(THREE);
  assert.equal(camera.isPerspectiveCamera, true);
  assert.equal(camera.aspect, BOARD_CAMERA.aspect);
  for (const x of [0, 180, 500, 840, 1000]) for (const y of [0, 160, 400, 660, 800]) for (const z of [-24, 0, 25, 50]) {
    const expected = pixel(boardWorldPoint(x, y, z), camera), actual = projectBoardPoint(x, y, z);
    near(actual.x, expected.x); near(actual.y, expected.y);
  }
});

test('perspective is visible, keeps the board frame in view, and gives raised pieces real parallax', () => {
  const back = projectBoardPoint(0, 0), front = projectBoardPoint(0, 800);
  assert.ok(front.x < back.x - 100, 'near edge is visibly wider than far edge');
  for (const x of [-18, 1018]) for (const y of [-18, 818]) for (const z of [-24, 0]) {
    const p = projectBoardPoint(x, y, z); assert.ok(p.x > 35 && p.x < 965); assert.ok(p.y > 35 && p.y < 765);
  }
  const base = projectBoardPoint(800, 700), head = projectBoardPoint(800, 700, 50);
  assert.ok(head.y < base.y - 15, 'piece height appears above its ground anchor');
  assert.ok(head.x > base.x, 'perspective parallax is not an orthographic fake');
});

test('ground homography and inverse agree with the renderer across the entire board', () => {
  const h = BOARD_HOMOGRAPHY;
  for (const x of [-15, 0, 18, 130, 500, 982, 1000]) for (const y of [0, 20, 180, 400, 780, 800, 818]) {
    const d = h[6] * x + h[7] * y + h[8];
    const css = { x: (h[0] * x + h[1] * y + h[2]) / d, y: (h[3] * x + h[4] * y + h[5]) / d };
    const render = projectBoardPoint(x, y); near(css.x, render.x); near(css.y, render.y);
    const original = unprojectBoardPoint(css.x, css.y); near(original.x, x); near(original.y, y);
  }
});

test('CSS matrix3d stays aligned after responsive sizing and 100–300% zoom', () => {
  for (const [width, height] of [[420, 336], [1000, 800], [1800, 1440], [3000, 2400], [700, 490]]) {
    const m = boardCSSMatrix(width, height).slice(9, -1).split(',').map(Number);
    assert.equal(m.length, 16);
    for (const [x, y] of [[0, 0], [1000, 0], [1000, 800], [0, 800], [327, 612]]) {
      const localX = x * width / 1000, localY = y * height / 800;
      const w = m[3] * localX + m[7] * localY + m[15];
      const projected = projectBoardPoint(x, y);
      near((m[0] * localX + m[4] * localY + m[12]) / w, projected.x * width / 1000);
      near((m[1] * localX + m[5] * localY + m[13]) / w, projected.y * height / 800);
    }
  }
});

test('pointer unprojection accounts for board zoom and simultaneous page/board scrolling', () => {
  for (const rect of [{left:250,top:400,width:600,height:480},{left:-312,top:-219,width:1800,height:1440},{left:28,top:80,width:390,height:312}]) {
    for (const [x,y] of [[18,20],[200,380],[500,400],[982,780]]) {
      const p=projectBoardPoint(x,y), client={x:rect.left+p.x*rect.width/1000,y:rect.top+p.y*rect.height/800};
      const actual=screenToBoard(client,rect);near(actual.x,x);near(actual.y,y);
    }
  }
  assert.equal(screenToBoard({x:0,y:0},{left:0,top:0,width:0,height:0}),null);
  assert.equal(projectWorldPoint({x:0,y:0,z:5000}),null);
  assert.equal(unprojectBoardPoint(NaN,10),null);
});
