// Software painter for the same Three camera and animated football uniforms.
// SVG ellipses are the projected mesh ellipsoids; picks still use the solid 3D meshes.
import { Matrix4, Vector3, Vector4, Color } from './vendor/three-0.186.0/three.module.js';

const NS='http://www.w3.org/2000/svg';
const num=n=>Number(n.toFixed(2));
const sequence=(()=>{let i=0;return ()=>++i;})();
export function createProjectedPainter(doc,world){
  function element(name,attrs={},parent){
    const node=doc.createElementNS(NS,name);
    for(const [key,value] of Object.entries(attrs))node.setAttribute(key,value);
    parent?.append(node);return node;
  }
  const svg=element('svg',{'data-training-renderer':'projected'});
  const defs=element('defs',{},svg),uid='tp'+sequence()+'-',gradients=new Map();
  function gradient(key,stops,radial=false){
    const g=element(radial?'radialGradient':'linearGradient',radial?{id:uid+key,cx:'.34',cy:'.22',r:'.89'}:{id:uid+key,x1:0,y1:0,x2:0,y2:1},defs);
    for(const [offset,color] of stops)element('stop',{offset,'stop-color':color},g);
    return 'url(#'+uid+key+')';
  }
  const c=new Color();
  const shade=hex=>{
    if(!gradients.has(hex)){
      c.set('#'+hex);
      const lighter=c.clone().lerp(new Color('#fff3dc'),.13).getHexString();
      const darker=c.clone().multiplyScalar(.63).getHexString();
      gradients.set(hex,gradient('s'+hex,[[0,'#'+lighter],[.53,'#'+hex],[1,'#'+darker]],true));
    }
    return gradients.get(hex);
  };
  const sky=gradient('sky',[[0,'#8eabae'],[.72,'#d1e1db'],[1,'#e9e6cc']]);
  const grass=gradient('lawn',[[0,'#5e806d'],[.45,'#416653'],[1,'#294d41']]);
  const backdrop=element('g',{'aria-hidden':'true'},svg);
  element('rect',{x:0,y:0,width:'100%',height:'100%',fill:sky},backdrop);
  const lawn=element('rect',{width:'100%',height:'100%',fill:grass},backdrop);
  const stripes=element('path',{fill:'#7da48a',opacity:'.16'},backdrop);
  const chalk=element('path',{fill:'none',stroke:'#d3dfc8',opacity:'.75','stroke-width':1.2},backdrop);
  const scrimmage=element('path',{fill:'none',stroke:'#dac985',opacity:'.74','stroke-width':1.8},backdrop);
  const stands=element('path',{fill:'#647e77',stroke:'#94a69c','stroke-width':1.1},backdrop);
  const goal=element('path',{fill:'none',stroke:'#d1ac62','stroke-width':1.8,'stroke-linecap':'round'},backdrop);
  const contacts=element('g',{'pointer-events':'none'},svg);
  const layer=element('g',{'pointer-events':'none'},svg);
  const {markers,bodies,bodyParts,throwBall,losY}=world.projectionObjects;
  const figures=markers.map(rec=>{
    const group=element('g',{'data-pov-player':rec.p.id},layer);
    const pieces=Array.from({length:bodyParts},()=>element('ellipse',{},group));
    const shadow=element('ellipse',{fill:'#173d32',opacity:'.36'},contacts);
    const ring=element('ellipse',{fill:'none','stroke-width':2.5},contacts);
    return {rec,group,pieces,shadow,ring,order:''};
  });
  const ball=element('ellipse',{fill:'#965f40',stroke:'#e6c5a7','stroke-width':.7},layer);
  const vp=new Matrix4(),transform=new Matrix4(),model=new Matrix4(),v=new Vector3(),cc=new Color(),cv=new Vector4();
  const eyeSpace=new Vector3();
  let width=960,height=540,lastBackground='',lastGroups='';
  const projected=(x,y,z)=>{
    cv.set(x,y,z,1).applyMatrix4(vp);
    return {x:(.5+.5*cv.x/cv.w)*width,y:(.5-.5*cv.y/cv.w)*height,d:cv.w};
  };
  function point2(a){return num(a.x)+' '+num(a.y);}
  function pathSegment(a,b){
    const aa=new Vector3(...a).applyMatrix4(world.camera.matrixWorldInverse),bb=new Vector3(...b).applyMatrix4(world.camera.matrixWorldInverse);
    const near=-.14;
    if(aa.z>near&&bb.z>near)return '';
    if(aa.z>near)aa.lerp(bb,(near-aa.z)/(bb.z-aa.z));
    if(bb.z>near)bb.lerp(aa,(near-bb.z)/(aa.z-bb.z));
    const proj=q=>{q.applyMatrix4(world.camera.projectionMatrix);return{x:width*(q.x+1)*.5,y:height*(1-q.y)*.5};};
    return 'M'+point2(proj(aa))+'L'+point2(proj(bb));
  }
  function polygon(points){
    const poly=points.map(p=>new Vector3(...p).applyMatrix4(world.camera.matrixWorldInverse)),clipped=[];
    let a=poly.at(-1);
    for(const b of poly){
      if((a.z<-.14)!==(b.z<-.14))clipped.push(a.clone().lerp(b,(-.14-a.z)/(b.z-a.z)));
      if(b.z<=-.14)clipped.push(b);
      a=b;
    }
    if(clipped.length<3)return '';
    return clipped.map((p,i)=>{p.applyMatrix4(world.camera.projectionMatrix);return(i?'L':'M')+num((p.x+1)*width*.5)+' '+num((1-p.y)*height*.5);}).join('')+'Z';
  }
  function drawField(){
    const camera=world.camera,key=[width,height,camera.position.x,camera.position.z,camera.quaternion.y,camera.quaternion.w].join(',');
    if(key===lastBackground)return;lastBackground=key;
    // The horizon is invariant under yaw; use the actual pitch and vertical FOV.
    camera.getWorldDirection(v);const horizon=projected(camera.position.x+v.x*10000,camera.position.y,camera.position.z+v.z*10000);
    lawn.setAttribute('y',num(horizon.y));
    let paint='',lines='',seats='',goals='';
    for(let z=-50;z<=50;z+=5){
      if(z%10===0)paint+=polygon([[-26.6,0,z],[26.6,0,z],[26.6,0,z+5],[-26.6,0,z+5]]);
      lines+=pathSegment([-26.6,.02,z],[26.6,.02,z]);
      for(let n=1;n<=4;n++)for(const x of [-9,9])lines+=pathSegment([x-.2,.02,z+n],[x+.2,.02,z+n]);
    }
    for(const sign of [-1,1]){
      lines+=pathSegment([sign*26.6,.025,-50],[sign*26.6,.025,50]);
      for(let tier=2;tier>=0;tier--){
        const x=sign*(39+tier*2.8),z=sign*(59+tier*2.8),y=1.6+tier*1.08;
        seats+=polygon([[-46,y,z],[46,y,z],[46,y-1.2,z],[-46,y-1.2,z]]);
        seats+=polygon([[x,y,-56],[x,y,56],[x,y-1.2,56],[x,y-1.2,-56]]);
      }
      goals+=pathSegment([0,0,sign*51],[0,5.5,sign*51])+pathSegment([-3,5.5,sign*50.5],[3,5.5,sign*50.5]);
      for(const x of [-3,3])goals+=pathSegment([x,5.5,sign*50.5],[x,9.8,sign*50.5]);
    }
    stripes.setAttribute('d',paint);chalk.setAttribute('d',lines);stands.setAttribute('d',seats);goal.setAttribute('d',goals);
    if(Number.isFinite(losY)){const z=(losY-50)*.365;scrimmage.setAttribute('d',pathSegment([-26,.04,z],[26,.04,z]));}
  }
  function ellipse(node,index){
    bodies.getMatrixAt(index,model);transform.multiplyMatrices(vp,model);
    const m=transform.elements,d=m[15];
    if(d<.13){node.setAttribute('visibility','hidden');return d;}
    const x=(.5+.5*m[12]/d)*width,y=(.5-.5*m[13]/d)*height;
    let uu=0,vv=0,uv=0;
    for(const i of [0,4,8]){
      const u=width*.5*(m[i]*d-m[12]*m[i+3])/(d*d);
      const v=-height*.5*(m[i+1]*d-m[13]*m[i+3])/(d*d);
      uu+=u*u;vv+=v*v;uv+=u*v;
    }
    const center=(uu+vv)/2,spread=Math.hypot((uu-vv)/2,uv);
    node.removeAttribute('visibility');node.setAttribute('cx',num(x));node.setAttribute('cy',num(y));
    node.setAttribute('rx',num(Math.sqrt(Math.max(.01,center+spread))));node.setAttribute('ry',num(Math.sqrt(Math.max(.01,center-spread))));
    node.setAttribute('transform','rotate('+num(Math.atan2(2*uv,uu-vv)*90/Math.PI)+' '+num(x)+' '+num(y)+')');
    bodies.getColorAt(index,cc);node.setAttribute('fill',shade(cc.getHexString()));
    return d;
  }
  function draw(){
    vp.multiplyMatrices(world.camera.projectionMatrix,world.camera.matrixWorldInverse);drawField();
    const visible=[];
    for(const fig of figures){
      const {rec,group,shadow,ring}=fig;
      const foot=projected(rec.x,.035,rec.z);
      const center=projected(rec.x,1.12,rec.z);
      const show=foot.d>.15&&center.x>-width*.22&&center.x<width*1.22;
      group.style.display=shadow.style.display=show?'':'none';ring.style.display=show&&rec.ring.visible?'':'none';
      if(!show)continue;
      const scale=height/(2*Math.tan(world.camera.fov*Math.PI/360)*foot.d);
      for(const [el,rx,ry] of [[shadow,.47,.105],[ring,.66,.155]]){
        el.setAttribute('cx',num(foot.x));el.setAttribute('cy',num(foot.y));el.setAttribute('rx',num(rx*scale));el.setAttribute('ry',num(ry*scale));
      }
      if(rec.ring.visible)ring.setAttribute('stroke','#'+rec.ring.material.color.getHexString());
      visible.push([fig,center.d]);
      const ordered=fig.pieces.map((el,i)=>[i,ellipse(el,rec.index*bodyParts+i)]).sort((a,b)=>b[1]-a[1]||a[0]-b[0]).map(pair=>pair[0]);
      // The torso is a solid shape, not an overlay over the shoulder pads.
      const key=ordered.join(',');if(key!==fig.order){for(const i of ordered)group.append(fig.pieces[i]);fig.order=key;}
    }
    visible.sort((a,b)=>b[1]-a[1]);const key=visible.map(([fig])=>fig.rec.index).join(',');
    if(key!==lastGroups){lastGroups=key;for(const [fig]of visible)layer.append(fig.group);layer.append(ball);}
    const p=throwBall.position;
    eyeSpace.copy(p).applyMatrix4(world.camera.matrixWorldInverse);ball.style.display=throwBall.visible&&eyeSpace.z<-.13?'':'none';
    if(throwBall.visible&&eyeSpace.z<-.13){const point=projected(p.x,p.y,p.z);ball.setAttribute('cx',num(point.x));ball.setAttribute('cy',num(point.y));ball.setAttribute('rx',num(height*.11/point.d));ball.setAttribute('ry',num(height*.055/point.d));}
  }
  return {canvas:svg,render:draw,setSize(w,h){width=w;height=h;svg.setAttribute('viewBox','0 0 '+w+' '+h);},dispose(){}};
}
