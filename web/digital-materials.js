import * as THREE from './vendor/three-0.186.0/three.module.js';
import { FOCUS_RADIUS, PIECE_HEIGHT, focusInk, puckPalette } from './digital-puck.js';
import { animatedPlayer, animatedBall } from './model.js';
import { project } from './field.js';
import { createBoardCamera } from './digital-projection.js';
import { createPieceGeometries, roundedRectangle } from './digital-piece-geometry.js';

// The field, raised frame, pieces, shadows and ball occupy one real perspective
// scene. The separate projected SVG is retained only for accessible editing.
export function createDigitalMaterials(doc=document,{invalidate=()=>{}}={}) {
  const win=doc.defaultView,canvas=doc.createElement('canvas');
  canvas.className='digital-scene-canvas';canvas.setAttribute('aria-hidden','true');
  canvas.style.cssText='position:absolute;inset:0;display:block;width:100%;height:100%;pointer-events:none';
  const renderer=new THREE.WebGLRenderer({canvas,alpha:true,antialias:true,preserveDrawingBuffer:true});
  renderer.setPixelRatio(1);renderer.setSize(1000,800,false);
  renderer.setClearColor(0x000000,0);renderer.outputColorSpace=THREE.SRGBColorSpace;
  renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.05;
  renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFShadowMap;
  renderer.debug.onShaderError=()=>{throw new Error('The 3D material shader could not compile');};
  const scene=new THREE.Scene(),camera=createBoardCamera(THREE),board=new THREE.Group();scene.add(board);
  const ambient=new THREE.HemisphereLight('#f8f2df','#32433c',1.10);scene.add(ambient);
  const key=new THREE.DirectionalLight('#fff8e9',2.25);key.position.set(-180,-180,1150);key.target.position.set(500,400,0);scene.add(key,key.target);
  key.castShadow=true;key.shadow.mapSize.set(2048,2048);Object.assign(key.shadow.camera,{left:-800,right:800,top:760,bottom:-760,near:50,far:2400});key.shadow.camera.updateProjectionMatrix();
  key.shadow.bias=-.00015;key.shadow.normalBias=.5;key.shadow.radius=3;
  const fill=new THREE.DirectionalLight('#c1d5d1',.68);fill.position.set(1100,850,700);scene.add(fill);
  const envCanvas=doc.createElement('canvas');envCanvas.width=1024;envCanvas.height=512;
  const ec=envCanvas.getContext('2d');if(!ec){renderer.dispose();throw new Error('Canvas material unavailable');}
  ec.fillStyle='#222324';ec.fillRect(0,0,1024,512);
  for(const [x,y,w,h,color]of [[90,65,250,280,'#e6e7e9'],[630,100,125,310,'#c5c7c9'],[460,120,20,260,'#e5e5e6']]){
    const g=ec.createLinearGradient(x-35,0,x+w+35,0);g.addColorStop(0,'#222324');g.addColorStop(.2,color);g.addColorStop(.8,color);g.addColorStop(1,'#222324');ec.fillStyle=g;ec.fillRect(x-35,y,w+70,h);
  }
  const env=new THREE.CanvasTexture(envCanvas);env.mapping=THREE.EquirectangularReflectionMapping;env.colorSpace=THREE.SRGBColorSpace;
  const pmrem=new THREE.PMREMGenerator(renderer),environmentTarget=pmrem.fromEquirectangular(env);scene.environment=environmentTarget.texture;env.dispose();pmrem.dispose();
  let textureCanvas=doc.createElement('canvas');textureCanvas.width=2000;textureCanvas.height=1600;
  let textureContext=textureCanvas.getContext('2d');
  let stagingCanvas=doc.createElement('canvas');stagingCanvas.width=2000;stagingCanvas.height=1600;
  let stagingContext=stagingCanvas.getContext('2d');
  if(!textureContext||!stagingContext){environmentTarget.dispose();renderer.dispose();throw new Error('Field canvas unavailable');}
  const fieldTexture=new THREE.CanvasTexture(textureCanvas);fieldTexture.colorSpace=THREE.SRGBColorSpace;fieldTexture.anisotropy=renderer.capabilities.getMaxAnisotropy();
  const surface=new THREE.Mesh(new THREE.PlaneGeometry(1000,800),new THREE.MeshStandardMaterial({map:fieldTexture,roughness:.96,metalness:0,envMapIntensity:.12}));
  surface.position.set(500,400,.1);surface.receiveShadow=true;board.add(surface);
  const plinthGeometry=new THREE.ExtrudeGeometry(roundedRectangle(-11,-11,1022,822,20),{depth:12,bevelEnabled:true,bevelSize:3,bevelThickness:3,bevelSegments:5,steps:1,curveSegments:20});
  plinthGeometry.translate(0,0,-17);
  const plinth=new THREE.Mesh(plinthGeometry,new THREE.MeshStandardMaterial({color:'#26312f',metalness:.45,roughness:.54,envMapIntensity:.65}));plinth.castShadow=true;plinth.receiveShadow=true;board.add(plinth);
  const frameShape=roundedRectangle(-9,-9,1018,818,20);frameShape.holes.push(roundedRectangle(-.5,-.5,1001,801,12));
  const frame=new THREE.Mesh(new THREE.ExtrudeGeometry(frameShape,{depth:1.5,bevelEnabled:true,bevelSize:.65,bevelThickness:.65,bevelSegments:3,steps:1,curveSegments:20}),new THREE.MeshStandardMaterial({color:'#787f74',metalness:.76,roughness:.46,envMapIntensity:.65}));frame.position.z=-1;frame.receiveShadow=true;board.add(frame);
  const ground=new THREE.Mesh(new THREE.PlaneGeometry(1900,1600),new THREE.ShadowMaterial({color:'#050506',opacity:.26}));ground.position.set(500,400,-21);ground.receiveShadow=true;scene.add(ground);
  const labelGeometry=new THREE.PlaneGeometry(1,1);
  const shadowGeometry=new THREE.PlaneGeometry(57,55);
  const focusGeometry=new THREE.TorusGeometry(FOCUS_RADIUS,.95,6,64,Math.PI*1.82);
  focusGeometry.rotateZ(Math.PI*.59);
  const sharedGeometry=new Map(),players=new Map(),pickMeshes=[];
  const shadowCanvas=doc.createElement('canvas');shadowCanvas.width=128;shadowCanvas.height=128;const sc=shadowCanvas.getContext('2d');
  const sg=sc.createRadialGradient(64,64,13,64,64,62);sg.addColorStop(0,'#0009');sg.addColorStop(.45,'#0005');sg.addColorStop(1,'#0000');sc.fillStyle=sg;sc.fillRect(0,0,128,128);
  const shadowTexture=new THREE.CanvasTexture(shadowCanvas);
  const ball=new THREE.Group(),ballLeather=new THREE.MeshStandardMaterial({color:'#9f613d',roughness:.64,metalness:.02});
  const football=new THREE.Mesh(new THREE.SphereGeometry(7,32,20),ballLeather);football.scale.set(1.5,.7,.7);football.castShadow=true;ball.add(football);
  const white=new THREE.MeshStandardMaterial({color:'#e2e3e5',roughness:.7});
  for(const x of [-5.3,5.3]){const band=new THREE.Mesh(new THREE.TorusGeometry(4.3,.55,8,32),white);band.rotation.y=Math.PI/2;band.position.x=x;ball.add(band);}board.add(ball);
  const raycaster=new THREE.Raycaster(),pointerNdc=new THREE.Vector2();
  let svg=null,stage=null,disposed=false,lost=false,snapshotGeneration=0,pendingImage=null,backgroundDirty=false,backgroundError=null,lastTextureTime=-1,lastTheme=null,mountedPlayId=null,texturePlayId=null,presentedPlayId=null;
  let textureGeneration=0,presentedTextureGeneration=0;
  let resolution=1,resolutionDirty=true,lastDrawView=null;
  const markResolutionDirty=()=>{resolutionDirty=true;invalidate();};
  function setResolution(next){
    resolution=next;renderer.setPixelRatio(next);renderer.setSize(1000,800,false);
  }
  function resizeRenderer(){
    if(!stage||disposed||!resolutionDirty)return;
    resolutionDirty=false;
    // At least 1000px wide for crisp labels; avoid rendering more pixels than
    // the displayed board needs, with a 2x cap on high-density screens.
    const next=Math.min(2,Math.max(1,(stage.clientWidth||1000)*(win.devicePixelRatio||1)/1000));
    if(Math.abs(next-resolution)<.01)return;
    setResolution(next);
  }
  // Resize during draw so clearing the canvas and presenting the next complete
  // frame happen together, rather than flashing a blank board between frames.
  const resizeObserver=typeof win.ResizeObserver==='function'?new win.ResizeObserver(markResolutionDirty):null;
  win.addEventListener('resize',markResolutionDirty);
  const lose=event=>{event.preventDefault();lost=true;invalidate();};canvas.addEventListener('webglcontextlost',lose);
  const ready=()=>!disposed&&!lost&&!!svg?.classList.contains('digital-ready');

  function geometries(shape){if(!sharedGeometry.has(shape))sharedGeometry.set(shape,createPieceGeometries(shape));return sharedGeometry.get(shape);}
  function labelTexture(label,ink) {
    const c=doc.createElement('canvas');c.width=512;c.height=256;
    const cx=c.getContext('2d');
    cx.textAlign='center';cx.textBaseline='middle';cx.font='700 218px Arial, sans-serif';
    cx.fillStyle=ink;cx.fillText(label,256,137,474);
    const texture=new THREE.CanvasTexture(c);texture.colorSpace=THREE.SRGBColorSpace;
    texture.anisotropy=renderer.capabilities.getMaxAnisotropy();return texture;
  }
  function makePlayer(p,now) {
    const group=new THREE.Group(),palette=puckPalette(p);
    const finish={
      foot:{metalness:0,roughness:.94},rim:{metalness:.74,roughness:.43},
      band:{metalness:.07,roughness:.55},face:{metalness:.04,roughness:.78},
    };
    for(const [name,geometry] of Object.entries(geometries(p.shape))) {
      const mat=new THREE.MeshStandardMaterial({color:palette[name],...finish[name],envMapIntensity:.48});
      const mesh=new THREE.Mesh(geometry,mat);
      mesh.name=name;mesh.castShadow=true;mesh.receiveShadow=true;mesh.userData.playerId=p.id;
      group.add(mesh);pickMeshes.push(mesh);
    }
    // Print the identifier on the puck. A coplanar decal stays centered on its
    // face at the near and far edges of the perspective board.
    const labelMap=labelTexture(p.label,palette.ink);
    const label=new THREE.Mesh(labelGeometry,new THREE.MeshBasicMaterial({map:labelMap,transparent:true,depthWrite:false,toneMapped:false}));
    label.name='puck-label';label.scale.set(p.shape==='triangle'?26:33,25,1);
    label.position.set(0,p.shape==='triangle'?-2:0,PIECE_HEIGHT+.12);group.add(label);
    let nameLabel=null,nameMap=null;
    if(p.name){nameMap=labelTexture(p.name,'#ffffff');nameLabel=new THREE.Sprite(new THREE.SpriteMaterial({map:nameMap,transparent:true,depthWrite:false,toneMapped:false}));nameLabel.scale.set(42,18,1);nameLabel.position.set(0,-32,3);nameLabel.renderOrder=4;group.add(nameLabel);}
    const shadow=new THREE.Mesh(shadowGeometry,new THREE.MeshBasicMaterial({map:shadowTexture,transparent:true,opacity:.6,depthWrite:false,toneMapped:false}));shadow.position.z=.22;
    const ring=new THREE.Mesh(focusGeometry,new THREE.MeshBasicMaterial({color:'#ccd3c7',toneMapped:false,transparent:true,opacity:.9}));ring.position.z=.35;ring.visible=false;ring.name='puck-focus';
    board.add(group,shadow,ring);
    return {group,nameLabel,shadow,ring,labelMap,nameMap,born:now,lift:0,shape:p.shape,color:p.color,side:p.side,labelText:p.label,name:p.name};
  }
  function removePlayer(item){
    board.remove(item.group,item.shadow,item.ring);const materials=new Set();item.group.traverse(n=>{if(n.material)materials.add(n.material);const index=pickMeshes.indexOf(n);if(index>=0)pickMeshes.splice(index,1);});materials.forEach(m=>m.dispose());item.labelMap.dispose();item.nameMap?.dispose();
    item.shadow.material.dispose();item.ring.material.dispose();
  }
  function mount(next,play,settings){
    const nextStage=next.closest('.pitch-stage');if(!nextStage)throw new Error('3D board stage is unavailable');
    if(svg!==next)svg?.classList.remove('digital-ready');
    if(stage!==nextStage){resizeObserver?.disconnect();stage?.classList.remove('is-three');}
    svg=next;stage=nextStage;mountedPlayId=play.id;
    resolutionDirty=true;resizeObserver?.observe(stage);
    if(canvas.parentElement!==stage)stage.prepend(canvas);
    stage.classList.add('is-three');
    // A remount must retain the complete last frame until its replacement is
    // decoded. Removing ready or filling the live texture exposes a flat/blank
    // board for a frame whenever the inspector changes a route.
    svg.classList.toggle('digital-ready',presentedPlayId===mountedPlayId&&texturePlayId===mountedPlayId);
    snapshotGeneration++;
    if(pendingImage){pendingImage.image.onload=null;pendingImage.image.onerror=null;URL.revokeObjectURL(pendingImage.url);pendingImage=null;}
    lastTheme=settings.fieldTheme;
    lastTextureTime=-1;refreshBackground();
  }
  function refreshBackground(){
    if(!svg||disposed)return;if(pendingImage){backgroundDirty=true;return;}backgroundDirty=false;
    const generation=++snapshotGeneration,playId=mountedPlayId,clone=svg.cloneNode(true);
    clone.querySelectorAll('.digital-scene-canvas,[data-player],#pitch-ball,.point-handle,.draft-layer').forEach(n=>n.remove());
    clone.removeAttribute('class');clone.removeAttribute('style');clone.setAttribute('width','2000');clone.setAttribute('height','1600');
    const url=URL.createObjectURL(new Blob([new win.XMLSerializer().serializeToString(clone)],{type:'image/svg+xml'})),image=new win.Image(),job={url,image};pendingImage=job;
    const finish=()=>{
      URL.revokeObjectURL(url);if(pendingImage!==job)return;pendingImage=null;
      // Coalesce fast edits and begin the newest snapshot immediately, even
      // when animation is paused or the next frame has not arrived yet.
      if(backgroundDirty&&!disposed)refreshBackground();
      invalidate();
    };
    const fail=error=>{
      if(disposed||pendingImage!==job||generation!==snapshotGeneration)return;
      // Preserve the complete texture for recovery, but never present/export old
      // routes as the current edit after decoding has explicitly failed.
      backgroundError=error;texturePlayId=null;
      svg.classList.remove('digital-ready');canvas.style.visibility='hidden';
      win.console.warn('3D field texture update failed:',error);
    };
    image.onload=()=>{
      try{
        if(!disposed&&pendingImage===job&&generation===snapshotGeneration){
          // Draw to the spare canvas first. Failed decodes/draws leave the live
          // GPU texture untouched; a complete image is swapped in atomically.
          stagingContext.clearRect(0,0,2000,1600);stagingContext.drawImage(image,0,0,2000,1600);
          [textureCanvas,stagingCanvas]=[stagingCanvas,textureCanvas];[textureContext,stagingContext]=[stagingContext,textureContext];
          fieldTexture.image=textureCanvas;fieldTexture.needsUpdate=true;texturePlayId=playId;backgroundError=null;textureGeneration=generation;
        }
      }catch(error){fail(error);}
      finally{finish();}
    };
    image.onerror=()=>{fail(new Error('The 3D field image could not be decoded'));finish();};image.src=url;
  }
  function draw(view,{refreshTexture=false}={}){
    if(disposed||lost)throw new Error('The 3D context is unavailable');
    lastDrawView=view;
    const {play,settings,time,materialTime=0,selected,draggingId=null,hoveredId=null,animated=true,rehearsal=false,playing=false,presentationMask}=view;
    let moving=false;
    const hiddenPlayers=new Set(presentationMask?.playerIds||[]);
    resizeRenderer();
    const live=new Set(play.players.map(p=>p.id));for(const [id,item]of players)if(!live.has(id)){removePlayer(item);players.delete(id);}
    for(const p of play.players){
      let item=players.get(p.id);if(item&&(item.shape!==p.shape||item.color!==p.color||item.side!==p.side||item.labelText!==p.label||item.name!==p.name)){removePlayer(item);players.delete(p.id);item=null;}
      if(!item){item=makePlayer(p,rehearsal?-Infinity:materialTime);players.set(p.id,item);}
      item.group.visible=!hiddenPlayers.has(p.id);item.shadow.visible=item.group.visible;
      const at=project(animatedPlayer(play,p,time)),lift=draggingId===p.id?7:hoveredId===p.id?1.5:0;
      const liftDelta=lift-item.lift;
      if(!animated)item.lift=0;
      else if(Math.abs(liftDelta)<.015)item.lift=lift;
      else{item.lift+=liftDelta*.24;moving=true;}
      item.group.position.set(at.x,800-at.y,item.lift);
      const age=animated&&!rehearsal?Math.min(1,Math.max(0,(materialTime-item.born)/.22)):1;
      if(age<1)moving=true;
      item.group.scale.setScalar(.96+.04*(1-(1-age)**3));
      item.shadow.position.set(at.x+1,800-at.y-1,.22);item.shadow.scale.setScalar(1+item.lift*.025);item.shadow.material.opacity=.6-item.lift*.025;
      const active=selected?.type==='player'&&selected.id===p.id || selected?.type==='players'&&selected.ids?.includes(p.id);
      item.ring.position.set(at.x,800-at.y,.35);item.ring.visible=item.group.visible&&(active||hoveredId===p.id);item.ring.material.opacity=active?.9:.35;
      item.ring.material.color.set(focusInk(settings.fieldTheme));
      if(item.nameLabel){item.nameLabel.visible=!!settings.showNames;item.nameLabel.material.color.set(settings.fieldTheme==='light'?'#696c70':'#ffffff');}
    }
    const ballPoint=animatedBall(play,time);ball.visible=!!ballPoint&&!presentationMask?.ball;
    if(ballPoint){const at=project(ballPoint),flight=play.ball?.receiverId&&time>=play.ball.passAt&&time<=play.ball.arriveAt,progress=flight?(time-play.ball.passAt)/Math.max(.01,play.ball.arriveAt-play.ball.passAt):0;ball.position.set(at.x+14,800-at.y-8,flight?10+Math.sin(progress*Math.PI)*55:10);ball.rotation.set(0,animated&&flight?progress*Math.PI*7:0,-.35);}
    // Scrubbing and the final playback frame must present their exact field.
    // A running timeline can reuse the texture between brief sample intervals.
    const timelineChanged=playing?Math.abs(time-lastTextureTime)>.066:time!==lastTextureTime;
    if(refreshTexture||!backgroundError&&(lastTheme!==settings.fieldTheme||timelineChanged)){
      lastTextureTime=time;lastTheme=settings.fieldTheme;refreshBackground();
    }
    renderer.render(scene,camera);
    presentedPlayId=play.id;presentedTextureGeneration=textureGeneration;svg?.classList.toggle('digital-ready',texturePlayId===play.id);canvas.style.visibility=ready()?'visible':'hidden';stage?.classList.add('is-three');canvas.dataset.renderer='three-perspective';
    return moving;
  }
  function capture(){
    if(!ready())return null;
    if(resolution>=2||!lastDrawView)return canvas.toDataURL('image/png');
    const previous=resolution,view=lastDrawView,pendingResize=resolutionDirty;
    resolutionDirty=false;setResolution(2);
    try{draw(view);return canvas.toDataURL('image/png');}
    finally{setResolution(previous);draw(view);resolutionDirty=pendingResize;}
  }
  return {fullScene:true,mount,refreshBackground,draw,get status(){return backgroundError?'unavailable':ready()?'ready':'loading';},
    get backgroundReady(){return ready()&&!pendingImage&&!backgroundDirty&&!backgroundError&&presentedTextureGeneration===snapshotGeneration;},capture,
    pick(clientX,clientY){if(!ready())return null;const rect=stage.getBoundingClientRect();if(!rect.width||!rect.height)return null;pointerNdc.set((clientX-rect.left)/rect.width*2-1,1-(clientY-rect.top)/rect.height*2);camera.updateMatrixWorld();scene.updateMatrixWorld(true);raycaster.setFromCamera(pointerNdc,camera);const hit=raycaster.intersectObjects(pickMeshes,false).find(({object})=>object.parent.visible);return hit?{type:'player',id:hit.object.userData.playerId}:null;},
    destroy(){if(disposed)return;disposed=true;snapshotGeneration++;resizeObserver?.disconnect();win.removeEventListener('resize',markResolutionDirty);svg?.classList.remove('digital-ready');stage?.classList.remove('is-three');canvas.remove();canvas.removeEventListener('webglcontextlost',lose);if(pendingImage){pendingImage.image.onload=null;pendingImage.image.onerror=null;URL.revokeObjectURL(pendingImage.url);pendingImage=null;}
      for(const item of players.values())removePlayer(item);players.clear();for(const pieces of sharedGeometry.values())for(const g of Object.values(pieces))g.dispose();sharedGeometry.clear();
      for(const mesh of [surface,plinth,frame,ground]){mesh.geometry.dispose();mesh.material.dispose();}ball.traverse(n=>n.geometry?.dispose());ballLeather.dispose();white.dispose();fieldTexture.dispose();shadowTexture.dispose();shadowGeometry.dispose();focusGeometry.dispose();labelGeometry.dispose();environmentTarget.dispose();key.shadow.map?.dispose();renderer.dispose();renderer.forceContextLoss();
    }};
}
