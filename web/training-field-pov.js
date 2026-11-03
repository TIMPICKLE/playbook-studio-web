// Loaded only when the training screen requests a player camera.
import * as THREE from './vendor/three-0.186.0/three.module.js';
import { createProjectedPainter } from './training-field-projected.js';
import { animatedBall, animatedPlayer } from './model.js';

const SX=.475, SZ=.365, eye=1.76, limit=100*Math.PI/180;
const worldX=x=>(x-50)*SX, worldZ=y=>(y-50)*SZ;
const clampYaw=y=>Math.max(-limit,Math.min(limit,y));
const fields={turf:'#355e50',light:'#426e5c',line:'#b4c9b9',seat:'#3d5454'};
function model(geometries,materials,geom,mat,color){
  if(!geometries.has(geom)){
    const g=geom==='ball'?new THREE.SphereGeometry(1,12,9):geom==='ring'?new THREE.TorusGeometry(.62,.045,6,32):new THREE.BoxGeometry();
    geometries.set(geom,g);
  }
  if(!materials.has(mat))materials.set(mat,new THREE.MeshStandardMaterial({color,roughness:.86}));
  return new THREE.Mesh(geometries.get(geom),materials.get(mat));
}

// Model coordinates represent a practice window; horizontal and vertical scales
// stay constant when switching POV, resizing the viewport, or starting a replay.
export function createTrainingWorld({play,cameraId,direction='up',losY}){
  const scene=new THREE.Scene(), camera=new THREE.PerspectiveCamera(53,1,.08,190);
  scene.background=new THREE.Color('#c9dbd9');scene.fog=new THREE.Fog('#c9dbd9',38,125);
  const hemi=new THREE.HemisphereLight('#f0f6ff','#828472',1.55);
  const sun=new THREE.DirectionalLight('#ffe0bd',1.85);sun.position.set(-26,40,10);scene.add(hemi,sun);
  const geos=new Map(),mats=new Map(), markers=[], markerById=new Map();
  function box(x,y,z,w,h,d,mat,color){
    const mesh=model(geos,mats,'box',mat,color);mesh.position.set(x,y,z);mesh.scale.set(w,h,d);scene.add(mesh);return mesh;
  }
  box(0,-.12,0,160,.2,260,'outfield','#536e60');
  box(0,-.043,0,54,.08,110,'turf',fields.turf);
  const lineSegments=[];
  function stripe(x1,z1,x2,z2){lineSegments.push(x1,.019,z1,x2,.019,z2);}
  for(let z=-50;z<=50;z+=5){
    if(z%10===0)box(0,.002,z+2.5,53.2,.009,4.98,'grass',fields.light);
    stripe(-26.5,z,26.5,z);
    for(let tick=1;tick<5&&z+tick<50;tick++)for(const x of [-9,9])stripe(x-.18,z+tick,x+.18,z+tick);
  }
  for(const x of [-26.6,26.6])box(x,.015,0,.14,.025,101,'chalk',fields.line);
  const lineGeo=new THREE.BufferGeometry();lineGeo.setAttribute('position',new THREE.Float32BufferAttribute(lineSegments,3));
  const lineMat=new THREE.LineBasicMaterial({color:fields.line});
  scene.add(new THREE.LineSegments(lineGeo,lineMat));
  if(Number.isFinite(losY)) box(0,.029,worldZ(losY),52,.014,.045,'scrimmage','#dbcf8a');

  // Low stands, a common horizon and both goals give the player a stable sense of direction.
  for(const sign of [-1,1]){
    for(let tier=0;tier<3;tier++){
      box(0,1+tier*1.08,sign*(59+tier*2.8),95,1.55,3.6,'seats',fields.seat);
      box(sign*(39+tier*2.8),.8+tier*1.08,0,3.4,1.25,112,'seats',fields.seat);
    }
    box(0,2.8,sign*51,.14,5.6,.14,'goal','#d6b266');
    box(0,5.5,sign*50.5,6,.14,.14,'goal','#d6b266');
    box(0,5.5,sign*50.75,.14,.14,.64,'goal','#d6b266');
    for(const x of [-3,3])box(x,7.65,sign*50.5,.13,4.4,.13,'goal','#d6b266');
  }

  const baseDir=direction==='down'?Math.PI:0;
  const owner=play.players.find(p=>p.id===cameraId);
  const white='#ede6d7', navy='#213d48', pants='#30464e', red='#a74735';
  const views=play.players.filter(p=>p.id!==cameraId);
  const geometry=new THREE.SphereGeometry(1,12,8);
  const jerseyMat=new THREE.MeshStandardMaterial({roughness:.61});
  const item=new THREE.Object3D(), rootTransform=new THREE.Object3D(), matrix=new THREE.Matrix4();
  const color=new THREE.Color(), bodyParts=17;
  const bodies=new THREE.InstancedMesh(geometry,jerseyMat,Math.max(1,views.length*bodyParts));
  bodies.count=views.length*bodyParts;bodies.instanceMatrix.setUsage(THREE.DynamicDrawUsage);bodies.frustumCulled=false;
  const parts=[];
  const rimGeo=new THREE.TorusGeometry(.66,.044,6,30),pickMat=new THREE.MeshBasicMaterial({color:'#ffe79d'}),rightMat=new THREE.MeshBasicMaterial({color:'#80fac0'}),wrongMat=new THREE.MeshBasicMaterial({color:'#ff998d'});
  const shadowGeo=new THREE.CircleGeometry(1,16),shadowMat=new THREE.MeshBasicMaterial({color:'#253f35',transparent:true,opacity:.38,depthWrite:false});
  const shadows=new THREE.InstancedMesh(shadowGeo,shadowMat,Math.max(1,views.length));shadows.count=views.length;shadows.frustumCulled=false;
  const throwBall=model(geos,mats,'ball','football','#774d38');throwBall.scale.set(.115,.088,.17);
  scene.add(bodies,shadows,throwBall);
  for(const [index,p] of views.entries()){
    const offense=p.side==='offense';
    const crouch=/^(C|LG|RG|LT|RT|G|T|OL|DE|DT|DL|LE|RE|NT)$/i.test(p.label);
    const heights=crouch ? .86 : 1;
    const body=offense?white:red, helmet=offense?navy:'#72362d', trim=offense?'#aaa977':'#e9c4a3';
    const yaw=(owner?.side===p.side?0:Math.PI)+baseDir;
    const locals=[];
    function part(x,y,z,w,h,d,shade,tilt=0){
      item.position.set(x,y*heights,z);item.rotation.set(0,0,tilt);item.scale.set(w,h*heights,d);item.updateMatrix();
      bodies.setColorAt(index*bodyParts+locals.length,color.set(shade));locals.push(item.matrix.clone());
    }
    part(0,1.13,0,.32,.32,.195,body);
    part(0,1.33,-.035,.394,.17,.218,body);
    part(0,.84,.015,.265,.17,.165,pants);
    part(0,1.68,-.075,.172,.172,.185,helmet);
    part(0,1.72,-.078,.026,.15,.187,trim);
    part(0,1.62,-.212,.121,.091,.055,'#363c3b');
    part(0,1.58,-.244,.131,.022,.042,trim);
    for(const sign of [-1,1]){
      part(sign*.30,1.22,0,.116,.195,.126,body,sign*.35);
      part(sign*.382,1.06,-.053,.072,.14,.079,'#b39079',-sign*.22);
      part(sign*.162,.58,.023,.15,.252,.155,pants,-sign*.21);
      part(sign*.223,.25,.02,.082,.165,.089,offense?'#d6e0d9':'#eee0ca',-sign*.15);
      part(sign*.24,.085,-.043,.105,.074,.174,navy);
    }
    parts.push({locals,yaw});
    const ring=new THREE.Mesh(rimGeo,pickMat);ring.rotation.x=-Math.PI/2;ring.visible=false;scene.add(ring);
    const rec={p,index,ring,height:heights,trim,highlight:null};markers.push(rec);markerById.set(p.id,rec);
  }
  const ray=new THREE.Raycaster(), p2=new THREE.Vector2(), v=new THREE.Vector3(), at=new THREE.Vector3();
  let yaw=0, camX=0,camZ=0,lastTime=NaN;
  function rotateCamera(){
    const angle=baseDir+yaw;
    camera.position.set(camX,eye,camZ);
    camera.lookAt(camX+Math.sin(angle),eye-.085,camZ-Math.cos(angle));
    camera.updateMatrixWorld();
  }
  function update(state){
    const time=state.time;
    if(time!==lastTime){
      lastTime=time;
      for(const rec of markers){
        const {p,index,ring}=rec,pos=animatedPlayer(play,p,time);
        const x=worldX(pos.x),z=worldZ(pos.y),{locals,yaw:bodyYaw}=parts[index];
        rec.x=x;rec.z=z;
        rootTransform.position.set(x,0,z);rootTransform.rotation.set(0,bodyYaw,0);rootTransform.updateMatrix();
        locals.forEach((local,i)=>bodies.setMatrixAt(index*bodyParts+i,matrix.multiplyMatrices(rootTransform.matrix,local)));
        ring.position.set(x,.065,z);
        item.position.set(x,.034,z);item.rotation.set(-Math.PI/2,0,0);item.scale.set(.49,.28,1);item.updateMatrix();shadows.setMatrixAt(index,item.matrix);
      }
      bodies.instanceMatrix.needsUpdate=true;shadows.instanceMatrix.needsUpdate=true;
      // A rushing/dropping player changes the aggregate bounds used for ray picking.
      bodies.boundingSphere=null;
      const point=owner?animatedPlayer(play,owner,time):{x:50,y:78};
      camX=worldX(point.x);camZ=worldZ(point.y);rotateCamera();
    }
    for(const rec of markers){
      const chosen=state.selectedIds.includes(rec.p.id), correct=state.revealed&&state.correctIds.includes(rec.p.id);
      const mat=correct?rightMat:state.revealed?wrongMat:pickMat;
      rec.ring.visible=chosen||correct;rec.ring.material=mat;
      const highlight=rec.ring.visible?mat.color:null;
      if(rec.highlight!==highlight){
        // Feet may be obscured by the offensive line; mark the visible helmet stripe as well.
        bodies.setColorAt(rec.index*bodyParts+4,highlight??color.set(rec.trim));
        bodies.instanceColor.needsUpdate=true;rec.highlight=highlight;
      }
    }
    const ballPos=state.revealed?animatedBall(play,time):null;
    throwBall.visible=Boolean(ballPos && Math.hypot(worldX(ballPos.x)-camX,worldZ(ballPos.y)-camZ)>.65);
    if(throwBall.visible)throwBall.position.set(worldX(ballPos.x),1,worldZ(ballPos.y));
    scene.updateMatrixWorld();
  }
  function firstHit(){
    const hit=ray.intersectObject(bodies,false)[0];
    return hit?.instanceId==null?null:markers[Math.floor(hit.instanceId/bodyParts)]?.p.id??null;
  }
  function pick(x,y){ray.setFromCamera(p2.set(x,y),camera);return firstHit();}
  function visibleIds(reachable=false){
    const visible=[];
    for(const [id,rec] of markerById){
      // Check helmet, torso and both shoulder pads, not just a single center ray.
      for(const [offset,h] of [[0,1.68],[0,1.33],[-.31,1.28],[.31,1.28]]){
        at.set(rec.x+offset,h*rec.height,rec.z);
        if(reachable){
          const angle=Math.atan2(at.x-camX,camZ-at.z)-baseDir;
          const relative=Math.atan2(Math.sin(angle),Math.cos(angle));
          const halfHFov=Math.atan(Math.tan(camera.fov*Math.PI/360)*camera.aspect);
          if(Math.abs(relative)>limit+halfHFov)continue;
        }else{
          v.copy(at).project(camera);
          if(Math.abs(v.x)>1||Math.abs(v.y)>1||v.z< -1||v.z>1)continue;
        }
        ray.set(camera.position,v.copy(at).sub(camera.position).normalize());
        if(firstHit()===id){visible.push(id);break;}
      }
    }
    return visible;
  }
  function dispose(){
    [...geos.values(),...mats.values(),geometry,jerseyMat,rimGeo,pickMat,rightMat,wrongMat,shadowGeo,shadowMat,lineGeo,lineMat,bodies,shadows].forEach(obj=>obj.dispose());scene.clear();
  }
  return {scene,camera,update,pick,visibleIds,dispose,projectionObjects:{markers,bodies,bodyParts,throwBall,losY},
    turn(delta){yaw=clampYaw(yaw+delta);rotateCamera();},
    resetLook(){yaw=0;rotateCamera();},
    resize(width,height){camera.aspect=width/height;camera.updateProjectionMatrix();}
  };
}

export function createTrainingPOV({stage,play,cameraId,direction,losY,words,onPick,onFail,softwareOnly=false}){
  const doc=stage.ownerDocument,win=doc.defaultView;
  const world=createTrainingWorld({play,cameraId,direction,losY});
  let renderer=null,kind='projected';
  if(!softwareOnly&&win.WebGL2RenderingContext){
    try{
      renderer=new THREE.WebGLRenderer({canvas:doc.createElement('canvas'),antialias:true,powerPreference:'low-power'});
      renderer.setPixelRatio(Math.min(win.devicePixelRatio||1,1.6));
      renderer.outputColorSpace=THREE.SRGBColorSpace;kind='gpu';
    }catch{/* GPU unavailable in some embedded previews. Use the same camera below. */}
  }
  if(!renderer)renderer=createProjectedPainter(doc,world);
  const canvas=renderer.domElement??renderer.canvas;
  canvas.style.cssText='width:100%;height:100%;min-height:inherit;display:block;touch-action:none;cursor:crosshair;overflow:hidden;';
  canvas.setAttribute('tabindex','0');canvas.setAttribute('role','group');canvas.setAttribute('aria-label',words.pov);
  canvas.setAttribute('data-training-renderer',kind);
  let last=null,drag=null,dead=false,width=0,height=0;
  function paint(){if(!dead&&last)renderer.render(world.scene,world.camera);}
  function resize(){
    if(dead)return;
    const w=stage.clientWidth||800, h=stage.clientHeight||450;
    if(w===width&&h===height)return;
    width=w;height=h;renderer.setSize(w,h,false);world.resize(w,h);paint();
  }
  function turn(delta){world.turn(delta);paint();}
  const start=e=>{
    if(e.button!==0||drag)return;
    canvas.focus({preventScroll:true});drag={id:e.pointerId,startX:e.clientX,startY:e.clientY,lastX:e.clientX,moved:false};canvas.setPointerCapture?.(e.pointerId);
  };
  const move=e=>{
    if(!drag||drag.id!==e.pointerId)return;
    if(Math.hypot(e.clientX-drag.startX,e.clientY-drag.startY)>4)drag.moved=true;
    if(drag.moved)turn((e.clientX-drag.lastX)*.006);
    drag.lastX=e.clientX;
  };
  const end=e=>{
    if(!drag||drag.id!==e.pointerId)return;
    const tap=!drag.moved&&Math.hypot(e.clientX-drag.startX,e.clientY-drag.startY)<=4;drag=null;
    if(!tap)return;
    const box=canvas.getBoundingClientRect();
    if(box.width&&box.height){
      const id=world.pick((e.clientX-box.left)/box.width*2-1,1-(e.clientY-box.top)/box.height*2);
      if(id)onPick(id);
    }
  };
  const cancel=()=>{drag=null;};
  const key=e=>{
    if(e.key==='ArrowLeft'||e.key==='ArrowRight'){e.preventDefault();turn(e.key==='ArrowLeft'?-.08:.08);}
    if(e.key==='Home'){e.preventDefault();world.resetLook();paint();}
  };
  const lost=e=>{e.preventDefault();onFail();};
  const handlers={pointerdown:start,pointermove:move,pointerup:end,pointercancel:cancel,lostpointercapture:cancel,keydown:key,webglcontextlost:lost};
  for(const [event,handler]of Object.entries(handlers))canvas.addEventListener(event,handler);
  const observer=win.ResizeObserver?new win.ResizeObserver(resize):null;
  if(observer)observer.observe(stage);else win.addEventListener('resize',resize);
  return {canvas,kind,resize,draw(state){last=state;world.update(state);paint();},
    resetLook(){world.resetLook();paint();},visibleIds:world.visibleIds,
    destroy(){dead=true;observer?.disconnect();win.removeEventListener('resize',resize);
      for(const [event,handler]of Object.entries(handlers))canvas.removeEventListener(event,handler);
      world.dispose();renderer.dispose();renderer.forceContextLoss?.();}
  };
}
