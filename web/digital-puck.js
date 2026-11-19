// World units shared by the perspective GPU scene and the lightweight SVG renderer.
export const PIECE_HEIGHT = 10;
export const PUCK_RADIUS = 21;
export const FOCUS_RADIUS = 26;
export const focusInk = theme => theme === 'light' ? '#435748' : '#ccd3c7';

export function puckPalette(player) {
  const defense = player.side === 'defense';
  return {
    foot: '#273432',
    rim: '#a8aaa0',
    band: player.color,
    face: defense ? '#303b3b' : '#e8e1cb',
    ink: defense ? '#fff9e8' : '#192723',
  };
}

// Return counter-clockwise perimeter points. Quadratic corners retain the
// distinct silhouettes when two opposing players share a custom team color.
function roundedCorners(vertices, trim) {
  const outline = [];
  vertices.forEach(([x,y],i) => {
    const prev = vertices[(i + vertices.length - 1) % vertices.length];
    const next = vertices[(i + 1) % vertices.length];
    const first = [x + (prev[0]-x)*trim, y + (prev[1]-y)*trim];
    const last = [x + (next[0]-x)*trim, y + (next[1]-y)*trim];
    for (let step=0; step<=4; step++) {
      const t=step/4, u=1-t;
      outline.push([u*u*first[0]+2*u*t*x+t*t*last[0], u*u*first[1]+2*u*t*y+t*t*last[1]]);
    }
  });
  return outline;
}

export function puckOutline(shape) {
  if (shape === 'square') return roundedCorners([[.88,.88],[-.88,.88],[-.88,-.88],[.88,-.88]], .16);
  if (shape === 'triangle') return roundedCorners([[0,1.20],[-1.08,-.77],[1.08,-.77]], .10);
  return Array.from({length:32}, (_,i) => [Math.cos(i*Math.PI/16),Math.sin(i*Math.PI/16)]);
}

// A rubber foot, colored enamel band and narrow metal lip enclose a flat face.
// One polygon caps the face in the vector renderer, avoiding radial hairlines.
const profile = [
  [.90,0], [.97,1.2,'foot'], [1,2.4,'rim'], [1,6.3,'band'],
  [.96,8.2,'band'], [.90,9.2,'rim'], [.85,PIECE_HEIGHT,'face'],
];
export function puckFaces(shape) {
  const outline = puckOutline(shape);
  const ring = ([radius,z]) => outline.map(([x,y]) => [x*radius*PUCK_RADIUS,y*radius*PUCK_RADIUS,z]);
  let lower = ring(profile[0]);
  const faces = [{vertices:[...lower].reverse(),normal:[0,0,-1],material:'foot'}];
  for (const layer of profile.slice(1)) {
    const upper = ring(layer);
    for (let i=0; i<outline.length; i++) {
      const j=(i+1)%outline.length, a=lower[i], b=lower[j], c=upper[i];
      const dx=b[0]-a[0], dy=b[1]-a[1], dz=c[2]-a[2];
      const normal=[dy*dz,-dx*dz,dx*(c[1]-a[1])-dy*(c[0]-a[0])];
      const length=Math.hypot(...normal);
      faces.push({vertices:[a,b,upper[j],c], normal:normal.map(n=>n/length), material:layer[2]});
    }
    lower=upper;
  }
  faces.push({vertices:lower,normal:[0,0,1],material:'face'});
  return faces;
}
