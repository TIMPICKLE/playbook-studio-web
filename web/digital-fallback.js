import { animatedPlayer } from './model.js';
import { project } from './field.js';
import { BOARD_CAMERA, projectWorldPoint } from './digital-projection.js';
import { FOCUS_RADIUS, PIECE_HEIGHT, focusInk, puckFaces, puckPalette } from './digital-puck.js';

const NS='http://www.w3.org/2000/svg';
const node=(doc,tag,attrs={})=>{const n=doc.createElementNS(NS,tag);for(const [k,v]of Object.entries(attrs))n.setAttribute(k,String(v));return n;};
const unit=v=>{const n=Math.hypot(...v);return v.map(x=>x/n);};
const dot=(a,b)=>a.reduce((sum,n,i)=>sum+n*b[i],0);
const light=unit([-.6,-.7,1.2]),view=unit([0,-.64,.77]),half=unit(light.map((v,i)=>v+view[i]));
const rgb=hex=>/^#[\da-f]{6}$/i.test(hex||'')?[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)):[176,144,218];
const color=(base,normal,metal=false)=>{
  const diffuse=Math.round(Math.max(0,dot(normal,light))*8)/8;
  const gloss=Math.pow(Math.max(0,dot(normal,half)),metal?34:22)*(metal?.48:.24);
  const highlight=Math.round(gloss*12)/12;
  return `rgb(${base.map(v=>Math.round(Math.min(255,v*(.47+diffuse*.58)+255*highlight))).join(',')})`;
};
export { puckFaces as fallbackMesh } from './digital-puck.js';
const pathOf=points=>'M'+points.map(p=>`${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join('L')+'Z';
const point=(at,vertex,lift=0)=>projectWorldPoint({x:at.x+vertex[0],y:800-at.y+vertex[1],z:vertex[2]+lift});
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
    const shadow=node(doc,'path',{fill:'url(#digital-fallback-shadow)'}),ring=node(doc,'path',{fill:'none',stroke:'#ccd3c7','stroke-width':1.6,'stroke-linecap':'round',opacity:0});
    group.append(shadow,ring);
    const palette=puckPalette(p);
    const batches=new Map();
    // Only front-facing surfaces of this convex puck can contribute. Batching
    // equal shades keeps fixed DOM nodes even as a puck crosses the camera.
    for(const face of puckFaces(p.shape)){
      if(face.normal[2]<0)continue;
      const fill=color(rgb(palette[face.material]),face.normal,face.material==='rim');
      const key=face.material+fill;
      if(!batches.has(key)){
        const path=node(doc,'path',{fill,stroke:fill,'stroke-width':.28,'stroke-linejoin':'round'});
        group.append(path);batches.set(key,{path,faces:[],d:null});
      }
      batches.get(key).faces.push(face);
    }
    const label=node(doc,'text',{'text-anchor':'middle','dominant-baseline':'central',fill:palette.ink,'font-family':'Arial,sans-serif','font-weight':700,'letter-spacing':-.3,lengthAdjust:'spacingAndGlyphs'});label.textContent=p.label;group.append(label);overlay.append(group);
    return {group,shadow,ring,batches,label,key:null,hidden:false,opacity:0,ringColor:'#ccd3c7',shape:p.shape,color:p.color,labelText:p.label,side:p.side,bounds:null,depth:0};
  }
  function draw({play,settings={},time=0,selected,hoveredId=null,draggingId=null,animated=true,presentationMask}){
    if(disposed||!overlay)return;
    const hiddenPlayers=new Set(presentationMask?.playerIds||[]);
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
      const lift=animated?(draggingId===p.id?5:hoveredId===p.id?1.5:0):0;
      const active=selected?.type==='player'&&selected.id===p.id || selected?.type==='players'&&selected.ids?.includes(p.id);
      const hover=hoveredId===p.id;
      const ringColor=focusInk(settings.fieldTheme);
      if(item.ringColor!==ringColor){item.ring.setAttribute('stroke',ringColor);item.ringColor=ringColor;}
      const opacity=active?.9:hover?.35:0;
      if(opacity!==item.opacity){item.ring.setAttribute('opacity',opacity);item.opacity=opacity;}
      const key=`${at.x},${at.y},${lift}`;if(item.key===key)continue;item.key=key;
      orderDirty=true;
      const projected=new Map(),hitFaces=[],eye=[BOARD_CAMERA.position[0]-at.x,BOARD_CAMERA.position[1]-(800-at.y),BOARD_CAMERA.position[2]-lift];
      for(const batch of item.batches.values()){
        const paths=[];
        for(const face of batch.faces){
          if(dot(face.normal,eye)<=dot(face.normal,face.vertices[0]))continue;
          const pts=face.vertices.map(v=>{
            if(!projected.has(v))projected.set(v,point(at,v,lift));
            return projected.get(v);
          });
          paths.push(pathOf(pts));hitFaces.push(pts);
        }
        const d=paths.join('');
        if(batch.d!==d){batch.path.setAttribute('d',d);batch.d=d;}
      }
      const outline=(rx,ry,start,sweep,dx=0,dy=0)=>Array.from({length:41},(_,i)=>{
        const a=start+sweep*i/40;return point(at,[Math.cos(a)*rx+dx,Math.sin(a)*ry+dy,.2]);
      });
      item.shadow.setAttribute('d',pathOf(outline(28,27,0,2*Math.PI,1,-2)));
      item.ring.setAttribute('d',pathOf(outline(FOCUS_RADIUS,FOCUS_RADIUS,Math.PI*.59,Math.PI*1.82)).slice(0,-1));
      const labelAt=point(at,[0,p.shape==='triangle'?-2:0,PIECE_HEIGHT+.12],lift);
      item.label.setAttribute('x',labelAt.x);item.label.setAttribute('y',labelAt.y);
      item.label.setAttribute('font-size',15*labelAt.scale);
      if(p.label.length>2)item.label.setAttribute('textLength',(p.shape==='triangle'?24:29)*labelAt.scale);
      const center=point(at,[0,0,0]);item.depth=center.depth;
      item.hitFaces=hitFaces;
      const pts=[...projected.values()];
      item.bounds={left:Math.min(...pts.map(p=>p.x))-4,right:Math.max(...pts.map(p=>p.x))+4,top:Math.min(...pts.map(p=>p.y))-4,bottom:Math.max(...pts.map(p=>p.y))+4};
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
        if(item.hidden||!box||x<box.left||x>box.right||y<box.top||y>box.bottom)continue;
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
