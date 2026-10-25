import * as THREE from './vendor/three-0.186.0/three.module.js';
import { MeshTransmissionMaterial } from './vendor/pmndrs-vanilla-1.25.0/MeshTransmissionMaterial.js';
import { animatedPlayer, animatedBall, COLORS } from './model.js';
import { project } from './field.js';
import { createBoardCamera } from './digital-projection.js';
import { createPieceGeometries, roundedRectangle } from './digital-piece-geometry.js';

// The field, raised frame, pieces, shadows and ball occupy one real perspective
// scene. The separate projected SVG is retained only for accessible editing.
export function createDigitalMaterials(doc=document) {
  const win=doc.defaultView,canvas=doc.createElement('canvas');
  canvas.className='digital-scene-canvas';canvas.setAttribute('aria-hidden','true');
  canvas.style.cssText='position:absolute;inset:0;display:block;width:100%;height:100%;pointer-events:none';
  const renderer=new THREE.WebGLRenderer({canvas,alpha:true,antialias:true,preserveDrawingBuffer:true});
  renderer.setPixelRatio(Math.max(2,win.devicePixelRatio||1));renderer.setSize(1000,800,false);
  renderer.setClearColor(0x000000,0);renderer.outputColorSpace=THREE.SRGBColorSpace;
  renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.05;
  renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFShadowMap;
  renderer.debug.onShaderError=()=>{throw new Error('The 3D material shader could not compile');};
  const scene=new THREE.Scene(),camera=createBoardCamera(THREE),board=new THREE.Group();scene.add(board);
  const ambient=new THREE.HemisphereLight('#e9e5f0','#272131',1.15);scene.add(ambient);
  const key=new THREE.DirectionalLight('#fff2da',3.2);key.position.set(-180,-180,1150);key.target.position.set(500,400,0);scene.add(key,key.target);
  key.castShadow=true;key.shadow.mapSize.set(2048,2048);Object.assign(key.shadow.camera,{left:-800,right:800,top:760,bottom:-760,near:50,far:2400});key.shadow.camera.updateProjectionMatrix();
  key.shadow.bias=-.00015;key.shadow.normalBias=.5;key.shadow.radius=3;
  const fill=new THREE.DirectionalLight('#bdb3db',1.15);fill.position.set(1100,850,700);scene.add(fill);
  const envCanvas=doc.createElement('canvas');envCanvas.width=1024;envCanvas.height=512;
  const ec=envCanvas.getContext('2d');if(!ec){renderer.dispose();throw new Error('Canvas material unavailable');}
  ec.fillStyle='#211c2a';ec.fillRect(0,0,1024,512);
  for(const [x,y,w,h,color]of [[90,65,250,280,'#f0e9df'],[630,100,125,310,'#c2b9d5'],[460,120,20,260,'#e7dfec']]){
    const g=ec.createLinearGradient(x-35,0,x+w+35,0);g.addColorStop(0,'#211c2a');g.addColorStop(.2,color);g.addColorStop(.8,color);g.addColorStop(1,'#211c2a');ec.fillStyle=g;ec.fillRect(x-35,y,w+70,h);
  }
  const env=new THREE.CanvasTexture(envCanvas);env.mapping=THREE.EquirectangularReflectionMapping;env.colorSpace=THREE.SRGBColorSpace;
  const pmrem=new THREE.PMREMGenerator(renderer),environmentTarget=pmrem.fromEquirectangular(env);scene.environment=environmentTarget.texture;env.dispose();pmrem.dispose();
  const textureCanvas=doc.createElement('canvas');textureCanvas.width=2000;textureCanvas.height=1600;
  const textureContext=textureCanvas.getContext('2d');if(!textureContext){environmentTarget.dispose();renderer.dispose();throw new Error('Field canvas unavailable');}
  const fieldTexture=new THREE.CanvasTexture(textureCanvas);fieldTexture.colorSpace=THREE.SRGBColorSpace;fieldTexture.anisotropy=renderer.capabilities.getMaxAnisotropy();
  const surface=new THREE.Mesh(new THREE.PlaneGeometry(1000,800),new THREE.MeshStandardMaterial({map:fieldTexture,roughness:.89,metalness:.03,envMapIntensity:.18}));
  surface.position.set(500,400,.1);surface.receiveShadow=true;board.add(surface);
  const plinthGeometry=new THREE.ExtrudeGeometry(roundedRectangle(-13,-13,1026,826,25),{depth:22,bevelEnabled:true,bevelSize:3,bevelThickness:3,bevelSegments:5,steps:1,curveSegments:20});
  plinthGeometry.translate(0,0,-28);
  const plinth=new THREE.Mesh(plinthGeometry,new THREE.MeshPhysicalMaterial({color:'#211b2d',metalness:.32,roughness:.35,clearcoat:.25,envMapIntensity:.65}));plinth.castShadow=true;plinth.receiveShadow=true;board.add(plinth);
  const frameShape=roundedRectangle(-9,-9,1018,818,20);frameShape.holes.push(roundedRectangle(-.5,-.5,1001,801,12));
  const frame=new THREE.Mesh(new THREE.ExtrudeGeometry(frameShape,{depth:1.5,bevelEnabled:true,bevelSize:.65,bevelThickness:.65,bevelSegments:3,steps:1,curveSegments:20}),new THREE.MeshStandardMaterial({color:'#ac9575',metalness:.8,roughness:.36,envMapIntensity:.8}));frame.position.z=-1;frame.receiveShadow=true;board.add(frame);
  const ground=new THREE.Mesh(new THREE.PlaneGeometry(1900,1600),new THREE.ShadowMaterial({color:'#050308',opacity:.33}));ground.position.set(500,400,-34);ground.receiveShadow=true;scene.add(ground);
  const target=new THREE.WebGLRenderTarget(2000,1600,{type:THREE.HalfFloatType,depthBuffer:true});
  const sharedGeometry=new Map(),players=new Map(),pickMeshes=[];
  const shadowCanvas=doc.createElement('canvas');shadowCanvas.width=128;shadowCanvas.height=128;const sc=shadowCanvas.getContext('2d');
  const sg=sc.createRadialGradient(64,64,13,64,64,62);sg.addColorStop(0,'#0009');sg.addColorStop(.45,'#0005');sg.addColorStop(1,'#0000');sc.fillStyle=sg;sc.fillRect(0,0,128,128);
  const shadowTexture=new THREE.CanvasTexture(shadowCanvas);
  const ball=new THREE.Group(),ballLeather=new THREE.MeshStandardMaterial({color:'#9f613d',roughness:.64,metalness:.02});
  const football=new THREE.Mesh(new THREE.SphereGeometry(7,32,20),ballLeather);football.scale.set(1.5,.7,.7);football.castShadow=true;ball.add(football);
  const white=new THREE.MeshStandardMaterial({color:'#eee7d9',roughness:.7});
  for(const x of [-5.3,5.3]){const band=new THREE.Mesh(new THREE.TorusGeometry(4.3,.55,8,32),white);band.rotation.y=Math.PI/2;band.position.x=x;ball.add(band);}board.add(ball);
  const raycaster=new THREE.Raycaster(),pointerNdc=new THREE.Vector2();
  let svg=null,stage=null,disposed=false,lost=false,snapshotGeneration=0,pendingImage=null,backgroundDirty=false,lastTextureTime=-1,lastTextureMaterial=-1,lastTheme=null;
  const lose=event=>{event.preventDefault();lost=true;};canvas.addEventListener('webglcontextlost',lose);

  function geometries(shape){if(!sharedGeometry.has(shape))sharedGeometry.set(shape,createPieceGeometries(shape));return sharedGeometry.get(shape);}
  function labelTexture(label,dark){
    const c=doc.createElement('canvas');c.width=512;c.height=256;const cx=c.getContext('2d');
    cx.textAlign='center';cx.textBaseline='middle';cx.font=`700 ${label.length>3?100:132}px Arial, sans-serif`;cx.fillStyle=dark?'#261d30':'#fff6df';cx.fillText(label,256,139,480);
    const texture=new THREE.CanvasTexture(c);texture.colorSpace=THREE.SRGBColorSpace;return texture;
  }
  function makePlayer(p,now){
    const group=new THREE.Group(),geo=geometries(p.shape),defense=p.side==='defense';
    const metal=new THREE.MeshPhysicalMaterial({color:defense?'#a7a4b2':'#bda17a',metalness:.83,roughness:.27,clearcoat:.2,envMapIntensity:.9});
    const bodyColor=new THREE.Color(defense?'#b6b1c2':'#48314e');
    if(p.color!==COLORS.offense&&p.color!==COLORS.defense)bodyColor.lerp(new THREE.Color(p.color),.26);
    const ceramic=new THREE.MeshPhysicalMaterial({color:bodyColor,roughness:.25,metalness:.12,clearcoat:.8,clearcoatRoughness:.2,envMapIntensity:.75});
    const glass=new MeshTransmissionMaterial({samples:8,_transmission:.72,roughness:.095,thickness:13,chromaticAberration:.001,anisotropicBlur:.01,distortion:0,temporalDistortion:0,buffer:target.texture});
    glass.color.set(defense?'#e7e2ef':'#b9a6cf');glass.attenuationColor.set(defense?'#e8dff4':'#7c658e');glass.attenuationDistance=40;glass.ior=1.45;glass.clearcoat=.5;glass.clearcoatRoughness=.13;glass.envMapIntensity=.8;
    const materials={base:metal,body:ceramic,collar:metal,head:glass,core:new THREE.MeshStandardMaterial({color:defense?'#cecad5':'#594363',roughness:.36,metalness:.15}),signal:new THREE.MeshStandardMaterial({color:p.color,roughness:.38,metalness:.2})};
    let head;
    for(const [name,g]of Object.entries(geo)){
      const mesh=new THREE.Mesh(g,materials[name]);mesh.castShadow=name!=='head';mesh.receiveShadow=true;mesh.userData.playerId=p.id;group.add(mesh);pickMeshes.push(mesh);if(name==='head')head=mesh;
    }
    const labelMap=labelTexture(p.label,defense),label=new THREE.Sprite(new THREE.SpriteMaterial({map:labelMap,transparent:true,depthWrite:false,toneMapped:false}));
    label.scale.set(23,11.5,1);const view=camera.position.clone().sub(new THREE.Vector3(500,400,0)).normalize();label.position.copy(view.multiplyScalar(12.1)).add(new THREE.Vector3(0,0,38.5));label.renderOrder=5;group.add(label);
    let nameLabel=null,nameMap=null;
    if(p.name){nameMap=labelTexture(p.name,false);nameLabel=new THREE.Sprite(new THREE.SpriteMaterial({map:nameMap,transparent:true,depthWrite:false,toneMapped:false}));nameLabel.scale.set(42,21,1);nameLabel.position.set(0,-35,5);nameLabel.renderOrder=4;group.add(nameLabel);}
    const shadow=new THREE.Mesh(new THREE.PlaneGeometry(58,58),new THREE.MeshBasicMaterial({map:shadowTexture,transparent:true,opacity:.6,depthWrite:false,toneMapped:false}));shadow.position.z=.22;
    const ring=new THREE.Mesh(new THREE.TorusGeometry(24,1.05,8,64),new THREE.MeshBasicMaterial({color:'#e9cf94',toneMapped:false,transparent:true,opacity:.9}));ring.position.z=.35;ring.visible=false;
    board.add(group,shadow,ring);
    return {group,head,label,nameLabel,shadow,ring,labelMap,nameMap,born:now,lift:0,shape:p.shape,color:p.color,side:p.side,labelText:p.label,name:p.name};
  }
  function removePlayer(item){
    board.remove(item.group,item.shadow,item.ring);const materials=new Set();item.group.traverse(n=>{if(n.material)materials.add(n.material);const index=pickMeshes.indexOf(n);if(index>=0)pickMeshes.splice(index,1);});materials.forEach(m=>m.dispose());item.labelMap.dispose();item.nameMap?.dispose();
    item.shadow.geometry.dispose();item.shadow.material.dispose();item.ring.geometry.dispose();item.ring.material.dispose();
  }
  function mount(next,play,settings){
    svg?.classList.remove('digital-ready');stage?.classList.remove('is-three');svg=next;stage=svg.closest('.pitch-stage');
    if(!stage)throw new Error('3D board stage is unavailable');
    stage.prepend(canvas);stage.classList.add('is-three');snapshotGeneration++;
    textureContext.fillStyle=settings.fieldTheme==='light'?'#f4effb':'#24163b';textureContext.fillRect(0,0,2000,1600);fieldTexture.needsUpdate=true;lastTheme=settings.fieldTheme;
    lastTextureTime=-1;lastTextureMaterial=-1;refreshBackground();
  }
  function refreshBackground(){
    if(!svg||disposed)return;if(pendingImage){backgroundDirty=true;return;}backgroundDirty=false;
    const generation=++snapshotGeneration,clone=svg.cloneNode(true);
    clone.querySelectorAll('.digital-scene-canvas,[data-player],#pitch-ball,.point-handle,.draft-layer').forEach(n=>n.remove());
    clone.removeAttribute('class');clone.removeAttribute('style');clone.setAttribute('width','2000');clone.setAttribute('height','1600');
    const url=URL.createObjectURL(new Blob([new win.XMLSerializer().serializeToString(clone)],{type:'image/svg+xml'}));pendingImage=url;
    const image=new win.Image();
    const finish=()=>{URL.revokeObjectURL(url);if(pendingImage===url)pendingImage=null;};
    image.onload=()=>{if(!disposed&&generation===snapshotGeneration){textureContext.clearRect(0,0,2000,1600);textureContext.drawImage(image,0,0,2000,1600);fieldTexture.needsUpdate=true;}finish();};image.onerror=finish;image.src=url;
  }
  function draw({play,settings,time,materialTime=0,selected,draggingId=null,hoveredId=null,animated=true}){
    if(disposed||lost)throw new Error('The 3D context is unavailable');
    const live=new Set(play.players.map(p=>p.id));for(const [id,item]of players)if(!live.has(id)){removePlayer(item);players.delete(id);}
    for(const p of play.players){
      let item=players.get(p.id);if(item&&(item.shape!==p.shape||item.color!==p.color||item.side!==p.side||item.labelText!==p.label||item.name!==p.name)){removePlayer(item);players.delete(p.id);item=null;}
      if(!item){item=makePlayer(p,materialTime);players.set(p.id,item);}
      const at=project(animatedPlayer(play,p,time)),lift=draggingId===p.id?7:hoveredId===p.id?1.5:0;
      item.lift=animated?item.lift+(lift-item.lift)*.24:0;item.group.position.set(at.x,800-at.y,item.lift);
      const age=animated?Math.min(1,Math.max(0,(materialTime-item.born)/.22)):1;item.group.scale.setScalar(.96+.04*(1-(1-age)**3));
      item.shadow.position.set(at.x+1,800-at.y-1,.22);item.shadow.scale.setScalar(1+item.lift*.025);item.shadow.material.opacity=.6-item.lift*.025;
      item.ring.position.set(at.x,800-at.y,.35);item.ring.visible=selected?.type==='player'&&selected.id===p.id||hoveredId===p.id;item.ring.material.opacity=selected?.id===p.id?.9:.35;
      if(item.nameLabel){item.nameLabel.visible=!!settings.showNames;item.nameLabel.material.color.set(settings.fieldTheme==='light'?'#6c5188':'#ffffff');}
      item.head.material.time=materialTime;
    }
    const ballPoint=animatedBall(play,time);ball.visible=!!ballPoint;
    if(ballPoint){const at=project(ballPoint),flight=play.ball?.receiverId&&time>=play.ball.passAt&&time<=play.ball.arriveAt,progress=flight?(time-play.ball.passAt)/Math.max(.01,play.ball.arriveAt-play.ball.passAt):0;ball.position.set(at.x+14,800-at.y-8,flight?24+Math.sin(progress*Math.PI)*55:23);ball.rotation.set(0,flight?progress*Math.PI*7:0,-.35);}
    if(backgroundDirty||lastTheme!==settings.fieldTheme||Math.abs(time-lastTextureTime)>.066||animated&&materialTime-lastTextureMaterial>.12){lastTextureTime=time;lastTextureMaterial=materialTime;lastTheme=settings.fieldTheme;refreshBackground();}
    // Refraction samples the actual 3D field and opaque chess-piece silhouettes.
    for(const item of players.values()){item.head.visible=false;item.label.visible=false;}
    renderer.setRenderTarget(target);renderer.clear();renderer.render(scene,camera);
    for(const item of players.values()){item.head.visible=true;item.label.visible=true;}
    renderer.setRenderTarget(null);renderer.clear();renderer.render(scene,camera);
    svg?.classList.add('digital-ready');stage?.classList.add('is-three');canvas.dataset.renderer='three-perspective';
  }
  return {fullScene:true,mount,refreshBackground,draw,capture:()=>canvas.toDataURL('image/png'),
    pick(clientX,clientY){if(!stage||disposed||lost)return null;const rect=stage.getBoundingClientRect();if(!rect.width||!rect.height)return null;pointerNdc.set((clientX-rect.left)/rect.width*2-1,1-(clientY-rect.top)/rect.height*2);camera.updateMatrixWorld();scene.updateMatrixWorld(true);raycaster.setFromCamera(pointerNdc,camera);const hit=raycaster.intersectObjects(pickMeshes,false)[0];return hit?{type:'player',id:hit.object.userData.playerId}:null;},
    destroy(){if(disposed)return;disposed=true;snapshotGeneration++;svg?.classList.remove('digital-ready');stage?.classList.remove('is-three');canvas.remove();canvas.removeEventListener('webglcontextlost',lose);if(pendingImage)URL.revokeObjectURL(pendingImage);
      for(const item of players.values())removePlayer(item);players.clear();for(const pieces of sharedGeometry.values())for(const g of Object.values(pieces))g.dispose();sharedGeometry.clear();
      for(const mesh of [surface,plinth,frame,ground]){mesh.geometry.dispose();mesh.material.dispose();}ball.traverse(n=>n.geometry?.dispose());ballLeather.dispose();white.dispose();fieldTexture.dispose();shadowTexture.dispose();target.dispose();environmentTarget.dispose();key.shadow.map?.dispose();renderer.dispose();renderer.forceContextLoss();
    }};
}
