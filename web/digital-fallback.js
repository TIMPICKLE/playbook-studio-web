import { animatedPlayer } from './model.js';
import { project } from './field.js';
import { BOARD_CAMERA, projectWorldPoint } from './digital-projection.js';
import { DRAG_LIFT, FOCUS_RADIUS, PIECE_HEIGHT, focusInk, puckFaces, puckPalette } from './digital-puck.js';

const NS='http://www.w3.org/2000/svg';
const node=(doc,tag,attrs={})=>{const n=doc.createElementNS(NS,tag);for(const [k,v]of Object.entries(attrs))n.setAttribute(k,String(v));return n;};
const unit=v=>{const n=Math.hypot(...v);return v.map(x=>x/n);};
const dot=(a,b)=>a.reduce((sum,n,i)=>sum+n*b[i],0);
const light=unit([-.6,-.7,1.2]),view=unit([0,-.64,.77]),half=unit(light.map((v,i)=>v+view[i]));
const rgb=hex=>/^#[\da-f]{6}$/i.test(hex||'')?[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)):[176,144,218];
const color=(base,normal,metal=false)=>{
  const diffuse=Math.round(Math.max(0,dot(normal,light))*8)/8;
  const gloss=Math.pow(Math.max(0,dot(normal,half)),metal?18:12)*(metal?.2:.08);
  const highlight=Math.round(gloss*12)/12;
  return `rgb(${base.map(v=>Math.round(Math.min(255,v*(.47+diffuse*.58)+255*highlight))).join(',')})`;
};
export { puckFaces as fallbackMesh } from './digital-puck.js';
const point=(at,vertex,lift=0)=>projectWorldPoint({x:at.x+vertex[0],y:800-at.y+vertex[1],z:vertex[2]+lift});
// Geometry is local to the projected ground anchor. Within an 8-unit camera
// cell only parallax changes the local outline. Keep the mesh, move its anchor,
// and update any faces that actually cross the silhouette inside the cell.
// The shared camera is fixed in board space; resizing/zooming scales the SVG
// viewBox. The full-field projection test includes the corners of these cells.
const CELL = 8;
const UNITS = 8; // one local SVG unit is 1/8 of a 1000×800 board pixel
const cellCenter = value => Math.round(value / CELL) * CELL;
function outline(rx, ry, start, sweep, dx=0, dy=0) {
  return Array.from({length:41}, (_,i) => {
    const a=start+sweep*i/40;
    return [Math.cos(a)*rx+dx, Math.sin(a)*ry+dy, .2];
  });
}
const shadowOutline = outline(28,27,0,2*Math.PI,1,-2);
const focusOutline = outline(FOCUS_RADIUS,FOCUS_RADIUS,Math.PI*.59,Math.PI*1.82);
function facing(face, at, lift) {
  const [nx,ny,nz]=face.normal, eye=BOARD_CAMERA.position;
  return nx*(eye[0]-at.x)+ny*(eye[1]-800+at.y)+nz*(eye[2]-lift)-face.plane;
}
function paintBatch(batch) {
  let d='';
  for(const face of batch.faces)if(face.visible)d+=face.path;
  if(batch.d!==d){
    batch.path.setAttribute('d',d);
    batch.d=d;
  }
}
function localPair(p, anchor) {
  const x=Math.round((p.x-anchor.x)*UNITS), y=Math.round((p.y-anchor.y)*UNITS);
  // SVG signed numbers delimit themselves, including between adjacent points.
  return `${x<0?'':' '}${x}${y<0?'':' '}${y}`;
}
function sampleGeometry(item, at, lift, cx, cy) {
  const cell={x:cx,y:cy}, anchor=point(cell,[0,0,0]), vertices=new Map();
  item.cell={x:cx,y:cy,lift};
  item.silhouette=[];
  let left=Infinity,right=-Infinity,top=Infinity,bottom=-Infinity;
  function pair(v) {
    if(!vertices.has(v)){
      const p=point(cell,v,lift), x=p.x-anchor.x, y=p.y-anchor.y;
      left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);
      vertices.set(v,localPair(p,anchor));
    }
    return vertices.get(v);
  }
  for(const batch of item.batches.values()){
    for(const face of batch.faces){
      const visibility=facing(face,cell,lift);
      // The visibility function is linear in the two ground coordinates.
      const spread=CELL/2*(Math.abs(face.normal[0])+Math.abs(face.normal[1]));
      const crosses=Math.abs(visibility)<=spread;
      face.visible=crosses ? facing(face,at,lift)>0 : visibility>0;
      if(crosses)item.silhouette.push({face,batch});
      if(face.visible||crosses)face.path='M'+face.vertices.map(pair).join('')+'Z';
    }
    paintBatch(batch);
  }
  item.bounds={left:left-4,right:right+4,top:top-4,bottom:bottom+4};
  const groundPath=outline=>'M'+outline.map(v=>localPair(point(cell,v),anchor)).join('');
  item.shadow.setAttribute('d',groundPath(shadowOutline)+'Z');
  item.ring.setAttribute('d',groundPath(focusOutline));
}
function updateSilhouette(item, at, lift) {
  if(!item.silhouette.length)return;
  const dirty=new Set();
  for(const {face,batch} of item.silhouette){
    const visible=facing(face,at,lift)>0;
    if(visible!==face.visible){face.visible=visible;dirty.add(batch);}
  }
  for(const batch of dirty)paintBatch(batch);
}
// Picking uses the exact projected mesh at the current pose, calculated only
// when the pointer reaches a candidate's conservative screen bounds.
function hitGeometry(item) {
  const faces=[],vertices=new Map();
  for(const batch of item.batches.values())for(const face of batch.faces){
    if(!face.visible)continue;
    faces.push(face.vertices.map(v=>{
      if(!vertices.has(v))vertices.set(v,point(item.at,v,item.lift));
      return vertices.get(v);
    }));
  }
  return faces;
}
export function createDigitalFallback(doc=document) {
  let svg=null,stage=null,overlay=null,disposed=false;
  const players=new Map();
  function disposeItem(item){item.group.remove();}
  function mount(next){
    if(disposed)return;
    const nextStage=next.closest('.pitch-stage');if(!nextStage)throw new Error('The perspective board stage is missing');
    if(svg!==next)svg?.classList.remove('digital-fallback-ready');
    if(stage!==nextStage)stage?.classList.remove('is-fallback');
    svg=next;stage=nextStage;
    if(!overlay){
      overlay=node(doc,'svg',{xmlns:NS,viewBox:'0 0 1000 800','class':'digital-token-overlay','aria-hidden':'true','data-renderer':'vector'});
      overlay.style.cssText='position:absolute;inset:0;width:100%;height:100%;overflow:visible;pointer-events:none;z-index:3';
      const defs=node(doc,'defs');
      const shadow=node(doc,'radialGradient',{id:'digital-fallback-shadow'});
      shadow.append(node(doc,'stop',{offset:0,'stop-color':'#090909','stop-opacity':.6}),node(doc,'stop',{offset:.6,'stop-color':'#090909','stop-opacity':.3}),node(doc,'stop',{offset:1,'stop-color':'#090909','stop-opacity':0}));
      defs.append(shadow);overlay.append(defs);
    }
    // Keep the last complete image and pick bounds until draw reconciles state.
    // Route edits can replace the source SVG without replacing any piece mesh.
    if(overlay.parentNode!==stage)stage.append(overlay);
    stage.classList.add('is-fallback');svg.classList.add('digital-fallback-ready');
  }
  function makePlayer(p){
    const group=node(doc,'g',{'data-vector-player':p.id});
    const geometry=node(doc,'g');
    const shadow=node(doc,'path',{fill:'url(#digital-fallback-shadow)'}),ring=node(doc,'path',{fill:'none',stroke:focusInk(),'stroke-width':1.6*UNITS,'stroke-linecap':'round',opacity:0});
    geometry.append(shadow,ring);group.append(geometry);
    const palette=puckPalette(p);
    const batches=new Map();
    // Only front-facing surfaces of this convex puck can contribute. Batching
    // equal shades keeps fixed DOM nodes even as a puck crosses the camera.
    for(const face of puckFaces(p.shape)){
      if(face.normal[2]<0)continue;
      const fill=color(rgb(palette[face.material]),face.normal,face.material==='rim');
      const key=face.material+fill;
      if(!batches.has(key)){
        const path=node(doc,'path',{fill,stroke:fill,'stroke-width':.28*UNITS,'stroke-linejoin':'round'});
        geometry.append(path);batches.set(key,{path,faces:[],d:null});
      }
      batches.get(key).faces.push({...face,plane:dot(face.normal,face.vertices[0])});
    }
    const label=node(doc,'text',{'text-anchor':'middle','dominant-baseline':'central',fill:palette.ink,'font-family':'Arial,sans-serif','font-weight':700,'letter-spacing':-.3,lengthAdjust:'spacingAndGlyphs'});label.textContent=p.label;group.append(label);overlay.append(group);
    return {group,geometry,shadow,ring,batches,label,cell:null,hidden:false,opacity:0,ringColor:focusInk(),shape:p.shape,color:p.color,labelText:p.label,side:p.side,bounds:null,depth:0};
  }
  function draw({play,settings={},time=0,selected,hoveredId=null,draggingId=null,animated=true,presentationMask}){
    if(disposed||!overlay)return;
    const hiddenPlayers=new Set(presentationMask?.playerIds||[]);
    const ringColor=focusInk(settings.fieldTheme);
    let orderDirty=false;
    const live=new Set(play.players.map(p=>p.id));
    for(const [id,item]of players)if(!live.has(id)){disposeItem(item);players.delete(id);}
    for(const p of play.players){
      let item=players.get(p.id);
      if(item&&(item.shape!==p.shape||item.color!==p.color||item.side!==p.side||item.labelText!==p.label)){disposeItem(item);players.delete(p.id);item=null;}
      if(!item){item=makePlayer(p);players.set(p.id,item);}
      const hidden=hiddenPlayers.has(p.id);
      if(item.hidden!==hidden){item.hidden=hidden;item.group.style.display=hidden?'none':'';}
      const at=project(animatedPlayer(play,p,time));
      const lift=animated&&draggingId===p.id?DRAG_LIFT:0;
      const active=selected?.type==='player'&&selected.id===p.id || selected?.type==='players'&&selected.ids?.includes(p.id);
      const hover=hoveredId===p.id;
      if(item.ringColor!==ringColor){item.ring.setAttribute('stroke',ringColor);item.ringColor=ringColor;}
      const opacity=active?.9:hover?.35:0;
      if(opacity!==item.opacity){item.ring.setAttribute('opacity',opacity);item.opacity=opacity;}
      if(item.at?.x===at.x&&item.at.y===at.y&&item.lift===lift)continue;
      item.at=at;item.lift=lift;item.hitFaces=null;
      const cx=cellCenter(at.x),cy=cellCenter(at.y),cell=item.cell;
      if(!cell||cell.x!==cx||cell.y!==cy||cell.lift!==lift)sampleGeometry(item,at,lift,cx,cy);
      else updateSilhouette(item,at,lift);
      const center=point(at,[0,0,0]);
      item.geometry.setAttribute('transform',`translate(${center.x} ${center.y}) scale(${1/UNITS})`);
      item.center=center;
      if(item.depth!==center.depth){item.depth=center.depth;orderDirty=true;}
      const labelAt=point(at,[0,p.shape==='triangle'?-2:0,PIECE_HEIGHT+.12],lift);
      item.label.setAttribute('x',labelAt.x);item.label.setAttribute('y',labelAt.y);
      item.label.setAttribute('font-size',15*labelAt.scale);
      if(p.label.length>2)item.label.setAttribute('textLength',(p.shape==='triangle'?24:29)*labelAt.scale);
    }
    if(orderDirty){
      let previous=overlay.firstElementChild; // retained gradient definitions
      for(const {group} of [...players.values()].sort((a,b)=>b.depth-a.depth)){
        if(previous.nextElementSibling!==group)overlay.insertBefore(group,previous.nextElementSibling);
        previous=group;
      }
    }
  }
  return {kind:'vector',fullScene:false,mount,draw,refreshBackground(){},capture(){return null;},
    pick(clientX,clientY){
      if(!stage)return null;const b=stage.getBoundingClientRect(),x=(clientX-b.left)*1000/(b.width||1000),y=(clientY-b.top)*800/(b.height||800);
      for(const [id,item] of [...players].sort((a,b)=>a[1].depth-b[1].depth)){
        const box=item.bounds;
        if(item.hidden||!box)continue;
        const localX=x-item.center.x,localY=y-item.center.y;
        if(localX<box.left||localX>box.right||localY<box.top||localY>box.bottom)continue;
        item.hitFaces??=hitGeometry(item);
        // Front faces project clockwise in SVG space. Checking their edges
        // prevents empty corners of a triangle from intercepting a route.
        const hit=item.hitFaces.some(face=>face.every((a,i)=>{
          const b=face[(i+1)%face.length];
          return (b.x-a.x)*(y-a.y)-(b.y-a.y)*(x-a.x)<=.01;
        }));
        if(hit)return {type:'player',id};
      }
      return null;
    },
    destroy(){if(disposed)return;disposed=true;overlay?.remove();svg?.classList.remove('digital-fallback-ready');stage?.classList.remove('is-fallback');players.clear();overlay=null;svg=null;stage=null;}
  };
}
