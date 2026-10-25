// The digital view has one real perspective camera. This module stays free of
// Three.js so pointer coordinates and the traditional editor never load WebGL.
export const BOARD_WIDTH = 1000;
export const BOARD_HEIGHT = 800;
export const BOARD_ELEVATION = 50 * Math.PI / 180;
export const BOARD_DISTANCE = 1450;
const sin = Math.sin(BOARD_ELEVATION), cos = Math.cos(BOARD_ELEVATION);
export const BOARD_CAMERA = Object.freeze({
  fov: 42, aspect: BOARD_WIDTH / BOARD_HEIGHT, near: .1, far: 4000,
  position: Object.freeze([500, 400 - BOARD_DISTANCE * cos, BOARD_DISTANCE * sin]),
  target: Object.freeze([500, 400, 0]),
});
const focal = BOARD_HEIGHT / (2 * Math.tan(BOARD_CAMERA.fov * Math.PI / 360));
const planeDepth = BOARD_DISTANCE + 400 * cos;

// Row-major 3×3 homography, normalized to h33 = 1. It maps the unprojected
// 1000×800 SVG plane into the same 1000×800 image rendered by the Three camera.
export const BOARD_HOMOGRAPHY = Object.freeze([
  focal / planeDepth, -500 * cos / planeDepth, 500 - 500 * focal / planeDepth,
  0, (focal * sin - 400 * cos) / planeDepth, 400 - 400 * focal * sin / planeDepth,
  0, -cos / planeDepth, 1,
]);

export function createBoardCamera(THREE) {
  const c = BOARD_CAMERA;
  const camera = new THREE.PerspectiveCamera(c.fov, c.aspect, c.near, c.far);
  camera.position.set(...c.position);
  camera.lookAt(...c.target);
  camera.updateMatrixWorld();
  return camera;
}

export function boardWorldPoint(x, y, z = 0) {
  return { x, y: BOARD_HEIGHT - y, z };
}

export function projectWorldPoint({ x, y, z = 0 }) {
  const dy = y - 400;
  const depth = BOARD_DISTANCE + dy * cos - z * sin;
  if (!Number.isFinite(depth) || depth <= BOARD_CAMERA.near) return null;
  const scale = focal / depth;
  return { x: 500 + (x - 500) * scale, y: 400 - (dy * sin + z * cos) * scale, scale, depth };
}

export function projectBoardPoint(x, y, z = 0) {
  return projectWorldPoint(boardWorldPoint(x, y, z));
}

// Inverse ray/ground intersection expressed analytically. Deliberately return
// out-of-field coordinates: the caller decides whether to clamp drawing input.
export function unprojectBoardPoint(x, y) {
  const denominator = focal * sin + (y - 400) * cos;
  if (!Number.isFinite(x) || !Number.isFinite(y) || Math.abs(denominator) < 1e-9) return null;
  const boardY = ((y - 400) * planeDepth + 400 * focal * sin) / denominator;
  const depth = planeDepth - boardY * cos;
  if (depth <= BOARD_CAMERA.near) return null;
  return { x: 500 + (x - 500) * depth / focal, y: boardY };
}

// stageRect must describe the untransformed canvas/stage, not the SVG's already
// projected bounding box. This automatically accounts for page and board scroll.
export function screenToBoard({ x, y }, stageRect) {
  if (!stageRect || !(stageRect.width > 0) || !(stageRect.height > 0)) return null;
  return unprojectBoardPoint((x - stageRect.left) * BOARD_WIDTH / stageRect.width,
    (y - stageRect.top) * BOARD_HEIGHT / stageRect.height);
}

// CSS column-major 4×4 matrix. The SVG's transform-origin must be 0 0 and its
// untransformed dimensions must equal the canvas dimensions. No outer skew or
// perspective is needed; applying another board transform would double-project.
export function boardCSSMatrix(width = BOARD_WIDTH, height = BOARD_HEIGHT) {
  const sx = width / BOARD_WIDTH, sy = height / BOARD_HEIGHT, h = BOARD_HOMOGRAPHY;
  if (!(sx > 0) || !(sy > 0)) return 'none';
  return `matrix3d(${[
    h[0], sy * h[3] / sx, 0, h[6] / sx,
    sx * h[1] / sy, h[4], 0, h[7] / sy,
    0, 0, 1, 0,
    sx * h[2], sy * h[5], 0, h[8],
  ].join(',')})`;
}
