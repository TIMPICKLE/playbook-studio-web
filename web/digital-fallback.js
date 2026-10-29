import { animatedPlayer } from './model.js';
import { project } from './field.js';
import { projectWorldPoint } from './digital-projection.js';

const NS='http://www.w3.org/2000/svg';
const node=(doc,tag,attrs={})=>{const n=doc.createElementNS(NS,tag);for(const [k,v]of Object.entries(attrs))n.setAttribute(k,String(v));return n;};
const unit=v=>{const n=Math.hypot(...v);return v.map(x=>x/n);};
const dot=(a,b)=>a.reduce((sum,n,i)=>sum+n*b[i],0);
const light=unit([-.6,-.7,1.2]),view=unit([0,-.64,.77]),half=unit(light.map((v,i)=>v+view[i]));
const rgb=hex=>/^#[\da-f]{6}$/i.test(hex||'')?[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)):[176,144,218];
const mix=(a,b,t)=>a.map((v,i)=>v*(1-t)+b[i]*t);
const color=(base,normal,metal=false)=>{
  const diffuse=Math.max(0,dot(normal,light));
  const gloss=Math.pow(Math.max(0,dot(normal,half)),metal?34:22)*(metal?.48:.24);
  return `rgb(${base.map(v=>Math.round(Math.min(255,v*(.47+diffuse*.58)+255*gloss))).join(',')})`;
};
const shapePoints=shape=>{
  if(shape==='triangle')return [[0,1],[-.866,-.5],[.866,-.5]];
  if(shape==='square')return Array.from({length:16},(_,i)=>{
    const a=i/16*Math.PI*2,x=Math.cos(a),y=Math.sin(a),s=1/Math.max(Math.abs(x),Math.abs(y));
    return [x*(.82*s+.18),y*(.82*s+.18)];
  });
  return Array.from({length:28},(_,i)=>[Math.cos(i/28*Math.PI*2),Math.sin(i/28*Math.PI*2)]);
};
// Real world-space surface vertices, projected by the same perspective camera as
// WebGL. This renderer is a labelled vector fallback, not a hardware render claim.
export function fallbackMesh(shape='circle') {
  const outline=shapePoints(shape);
  const profile=shape==='circle'
    ?[[22,0],[24,2],[24,4],[20,7],[17,9],[13,15],[10,26],[12,31],[16,34],[17,38],[15,43],[10,47],[0,50]]
    :[[22,0],[23,2],[23,4],[19,7],[17,10],[14,14],[13,31],[16,34],[16,39],[13,42],[0,42]];
  const faces=[];
  for(let b=0;b<profile.length-1;b++)for(let i=0;i<outline.length;i++){
    const [r0,z0]=profile[b],[r1,z1]=profile[b+1],a=outline[i],c=outline[(i+1)%outline.length];
    const radial=unit([a[0]+c[0],a[1]+c[1],0]);
    const normal=unit([radial[0]*(z1-z0),radial[1]*(z1-z0),r0-r1]);
    const material=b===1||b===3?'metal':b===0?'foot':'body';
    faces.push({vertices:[[r0*a[0],r0*a[1],z0],[r0*c[0],r0*c[1],z0],[r1*c[0],r1*c[1],z1],[r1*a[0],r1*a[1],z1]],normal,material});
  }
  return faces;
}
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
  function makePlayer(p,lightTheme){
    const group=node(doc,'g',{'data-vector-player':p.id});
    const shadow=node(doc,'path',{fill:'url(#digital-fallback-shadow)'}),ring=node(doc,'path',{fill:'none',stroke:'#b4b8be','stroke-width':1.5,opacity:0});
    group.append(shadow,ring);
    const body=rgb(lightTheme?'#737578':'#86888c');
    const tint=mix(body,rgb(p.color),.18),gold=rgb(p.side==='defense'?'#c5c6c8':'#aaaeb4');
    const faces=fallbackMesh(p.shape).map(face=>{
      const base=face.material==='metal'?gold:face.material==='foot'?rgb('#414243'):tint;
      const fill=color(base,face.normal,face.material==='metal');
      const path=node(doc,'path',{fill,stroke:fill,'stroke-width':.4,'stroke-linejoin':'round'});
      group.append(path);return {...face,path};
    });
    const label=node(doc,'text',{'text-anchor':'middle','dominant-baseline':'central',fill:'#eeeff0',stroke:'#212223','stroke-width':.85,'paint-order':'stroke','font-family':'Arial,sans-serif','font-weight':700,'letter-spacing':-.3});label.textContent=p.label;group.append(label);overlay.append(group);
    return {group,shadow,ring,faces,label,key:null,shape:p.shape,color:p.color,labelText:p.label,side:p.side,lightTheme,bounds:null,depth:0};
  }
  function draw({play,settings={},time=0,selected,hoveredId=null,draggingId=null,animated=true}){
    if(disposed||!overlay)return;
    const live=new Set(play.players.map(p=>p.id));
    for(const [id,item]of players)if(!live.has(id)){disposeItem(item);players.delete(id);}
    for(const p of play.players){
      let item=players.get(p.id);const lightTheme=settings.fieldTheme==='light';
      if(item&&(item.shape!==p.shape||item.color!==p.color||item.side!==p.side||item.labelText!==p.label||item.lightTheme!==lightTheme)){disposeItem(item);players.delete(p.id);item=null;}
      if(!item){item=makePlayer(p,lightTheme);players.set(p.id,item);}
      const at=project(animatedPlayer(play,p,time));
      const lift=animated?(draggingId===p.id?5:hoveredId===p.id?1.5:0):0;
      const active=selected?.type==='player'&&selected.id===p.id;
      const key=`${at.x},${at.y},${lift},${active}`;if(item.key===key)continue;item.key=key;
      const projected=[];
      for(const face of item.faces){
        const pts=face.vertices.map(v=>point(at,v,lift));projected.push(...pts);
        face.depth=pts.reduce((s,p)=>s+p.depth,0)/pts.length;face.path.setAttribute('d',pathOf(pts));
      }
      // Painter order resolves convex bands and preserves the material silhouette.
      item.faces.sort((a,b)=>b.depth-a.depth).forEach(face=>item.group.append(face.path));
      const ellipse=Array.from({length:32},(_,i)=>{const a=i/32*Math.PI*2;return point(at,[Math.cos(a)*32+3,Math.sin(a)*30-4,.1]);});
      item.shadow.setAttribute('d',pathOf(ellipse));
      item.ring.setAttribute('d',pathOf(Array.from({length:40},(_,i)=>{const a=i/40*Math.PI*2;return point(at,[Math.cos(a)*29,Math.sin(a)*29,.2]);})));
      item.ring.setAttribute('opacity',active?.9:0);
      const head=point(at,[0,-9,p.shape==='circle'?38:34],lift);
      item.label.setAttribute('x',head.x);item.label.setAttribute('y',head.y);item.label.setAttribute('font-size',Math.max(6,(p.label.length>3?9:11)*head.scale));item.group.append(item.label);
      const center=point(at,[0,0,0]);item.depth=center.depth;
      item.bounds={left:Math.min(...projected.map(p=>p.x))-4,right:Math.max(...projected.map(p=>p.x))+4,top:Math.min(...projected.map(p=>p.y))-4,bottom:Math.max(...projected.map(p=>p.y))+4};
    }
    [...players.values()].sort((a,b)=>b.depth-a.depth).forEach(item=>overlay.append(item.group));
  }
  return {kind:'vector',fullScene:false,mount,draw,refreshBackground(){},capture(){return null;},
    pick(clientX,clientY){
      if(!stage)return null;const b=stage.getBoundingClientRect(),x=(clientX-b.left)*1000/(b.width||1000),y=(clientY-b.top)*800/(b.height||800);
      for(const [id,item]of [...players].sort((a,b)=>a[1].depth-b[1].depth)){const box=item.bounds;if(box&&x>=box.left&&x<=box.right&&y>=box.top&&y<=box.bottom)return {type:'player',id};}
      return null;
    },
    destroy(){if(disposed)return;disposed=true;overlay?.remove();svg?.classList.remove('digital-fallback-ready');stage?.classList.remove('is-fallback');players.clear();overlay=null;svg=null;stage=null;}
  };
}
