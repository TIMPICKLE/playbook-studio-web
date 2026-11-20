// Only the flat token faces move to the GPU. The SVG above them remains the
// sole source of player labels, keyboard targets, routes and teaching cues.
const vertexSource = `#version 300 es
layout(location = 0) in vec2 center;
layout(location = 1) in vec3 fill;
layout(location = 2) in float shape;
uniform vec2 viewScale;
uniform vec2 viewCenter;
out vec2 localPoint;
out vec3 faceColor;
flat out int faceShape;
const vec2 corners[6] = vec2[6](
  vec2(-18., -18.), vec2(-18., 18.), vec2(18., -18.),
  vec2(18., -18.), vec2(-18., 18.), vec2(18., 18.)
);
void main() {
  localPoint = corners[gl_VertexID];
  faceColor = fill;
  faceShape = int(shape);
  gl_Position = vec4((center + localPoint - viewCenter) * viewScale, 0., 1.);
}`;

const fragmentSource = `#version 300 es
precision highp float;
precision highp int;
in vec2 localPoint;
in vec3 faceColor;
flat in int faceShape;
out vec4 outColor;
void main() {
  vec2 p = localPoint;
  float distanceToEdge = length(p) - 14.;
  if (faceShape == 1) {
    vec2 q = abs(p) - vec2(11.,10.);
    distanceToEdge = length(max(q, 0.)) + min(max(q.x, q.y), 0.) - 4.;
  } else if (faceShape == 2) {
    distanceToEdge = max(p.y - 14., (31. * abs(p.x) - 16. * p.y - 272.) / length(vec2(31.,16.)));
  }
  float aa = max(fwidth(distanceToEdge) * .5, .01);
  float coverage = 1. - smoothstep(.5 - aa, .5 + aa, distanceToEdge);
  float rim = .7 * smoothstep(-.5 - aa, -.5 + aa, distanceToEdge);
  vec3 ink = mix(faceColor, vec3(.522, .584, .616), rim);
  outColor = vec4(ink * coverage, coverage);
}`;

const components = 6; // center (2), sRGB (3), shape (1).

export function createFilmPlayerSurface(canvas, count, viewWidth, viewHeight) {
  const gl = canvas.getContext('webgl2', {
    alpha:true, antialias:false, depth:false, stencil:false, powerPreference:'low-power',
  });
  if (!gl || gl.isContextLost()) return null;
  const resources = [];
  function release() {
    while (resources.length) resources.pop()();
  }
  function shader(type, source) {
    const item = gl.createShader(type);
    if (!item) throw Error('Film shader allocation failed');
    resources.push(() => gl.deleteShader(item));
    gl.shaderSource(item, source);
    gl.compileShader(item);
    if (!gl.getShaderParameter(item, gl.COMPILE_STATUS)) throw Error('Film shader compilation failed');
    return item;
  }
  try {
    const program = gl.createProgram();
    if (!program) throw Error('Film program allocation failed');
    resources.push(() => gl.deleteProgram(program));
    gl.attachShader(program, shader(gl.VERTEX_SHADER, vertexSource));
    gl.attachShader(program, shader(gl.FRAGMENT_SHADER, fragmentSource));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw Error('Film program failed to link');
    const vao = gl.createVertexArray();
    if (!vao) throw Error('Film vertex array allocation failed');
    resources.push(() => gl.deleteVertexArray(vao));
    const buffer = gl.createBuffer();
    if (!buffer) throw Error('Film buffer allocation failed');
    resources.push(() => gl.deleteBuffer(buffer));
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    const attributes = new Float32Array(components * count);
    gl.bufferData(gl.ARRAY_BUFFER, attributes.byteLength, gl.DYNAMIC_DRAW);
    for (const [index, size, offset] of [[0, 2, 0], [1, 3, 2], [2, 1, 5]]) {
      gl.enableVertexAttribArray(index);
      gl.vertexAttribPointer(index, size, gl.FLOAT, false, components * 4, offset * 4);
      gl.vertexAttribDivisor(index, 1);
    }
    gl.useProgram(program);
    const scale = gl.getUniformLocation(program, 'viewScale');
    gl.uniform2f(gl.getUniformLocation(program, 'viewCenter'), viewWidth / 2, viewHeight / 2);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.clearColor(0, 0, 0, 0);
    let sized = false;
    return {
      setFace(index, shape, hex) {
        const at = index * components;
        const rgb = Number.parseInt(hex.slice(1), 16);
        attributes[at + 2] = (rgb >> 16 & 255) / 255;
        attributes[at + 3] = (rgb >> 8 & 255) / 255;
        attributes[at + 4] = (rgb & 255) / 255;
        attributes[at + 5] = shape === 'square' ? 1 : shape === 'triangle' ? 2 : 0;
      },
      setPosition(index, x, y) {
        attributes[index * components] = x;
        attributes[index * components + 1] = y;
      },
      resize(width, height, pixelRatio) {
        sized = width > 0 && height > 0;
        if (!sized) return;
        const ratio = Math.min(2, pixelRatio || 1);
        const w = Math.max(1, Math.round(width * ratio));
        const h = Math.max(1, Math.round(height * ratio));
        if (canvas.width !== w) canvas.width = w;
        if (canvas.height !== h) canvas.height = h;
        gl.viewport(0, 0, w, h);
        // Matches SVG's xMidYMid meet for every aspect ratio, including the
        // space on either side when projecting the board on a widescreen.
        const fit = Math.min(width / viewWidth, height / viewHeight);
        gl.uniform2f(scale, 2 * fit / width, -2 * fit / height);
      },
      draw() {
        if (!sized || gl.isContextLost()) return false;
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, attributes);
        gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, count);
        return true;
      },
      destroy(loseContext = false) {
        release();
        if (loseContext && !gl.isContextLost()) gl.getExtension('WEBGL_lose_context')?.loseContext();
      },
    };
  } catch {
    release();
    return null;
  }
}
