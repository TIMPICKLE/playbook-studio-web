import * as THREE from './vendor/three-0.186.0/three.module.js';
import { MeshTransmissionMaterial } from './vendor/pmndrs-vanilla-1.25.0/MeshTransmissionMaterial.js';
import { animatedPlayer, COLORS } from './model.js';
import { project } from './field.js';
import { createBoardCamera, createBoardSpace } from './digital-projection.js';

// A single orthographic scene shares the editor's exact 1000 × 800 coordinate space.
// The SVG remains the input/accessibility layer. Only the chip bodies are replaced.
export function createDigitalMaterials(doc = document) {
  const win=doc.defaultView, canvas=doc.createElement('canvas');
  const renderer=new THREE.WebGLRenderer({canvas,alpha:true,antialias:true,preserveDrawingBuffer:true});
  renderer.setPixelRatio(Math.max(2,win.devicePixelRatio||1));renderer.setSize(1000,800,false);
  renderer.setClearColor(0x000000,0);renderer.outputColorSpace=THREE.SRGBColorSpace;
  renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=.96;
  renderer.debug.onShaderError=()=>{throw new Error('Glass shader could not compile');};
  canvas.style.cssText='display:block;width:100%;height:100%;pointer-events:none';
  const scene=new THREE.Scene(), camera=createBoardCamera(), board=createBoardSpace();
  scene.add(board);
  const ambient=new THREE.HemisphereLight('#f2edf8','#211b2c',.8);scene.add(ambient);
  const key=new THREE.DirectionalLight('#fff5e6',2.2);key.position.set(170,850,900);scene.add(key);
  const rim=new THREE.DirectionalLight('#e5dcf6',.7);rim.position.set(900,160,500);scene.add(rim);

  // Procedural studio softboxes: stable highlights without an external HDR asset.
  const envCanvas=doc.createElement('canvas');envCanvas.width=1024;envCanvas.height=512;
  const ec=envCanvas.getContext('2d');
  if(!ec){renderer.dispose();throw new Error('Canvas material unavailable');}
  ec.fillStyle='#17131d';ec.fillRect(0,0,1024,512);
  // Two broad neutral softboxes and a thin edge card. No rainbow light bars.
  for(const [x,y,w,h,color] of [[120,70,240,230,'#e7e1d8'],[665,130,115,260,'#a99fb9'],[455,100,22,290,'#bdb5ca']]){
    const g=ec.createLinearGradient(x-35,0,x+w+35,0);g.addColorStop(0,'#17131d');g.addColorStop(.2,color);g.addColorStop(.8,color);g.addColorStop(1,'#17131d');
    ec.fillStyle=g;ec.fillRect(x-35,y,w+70,h);
  }
  const environment=new THREE.CanvasTexture(envCanvas);environment.mapping=THREE.EquirectangularReflectionMapping;environment.colorSpace=THREE.SRGBColorSpace;
  const pmrem=new THREE.PMREMGenerator(renderer), environmentTarget=pmrem.fromEquirectangular(environment);
  scene.environment=environmentTarget.texture;environment.dispose();pmrem.dispose();
  const textureCanvas=doc.createElement('canvas');textureCanvas.width=2000;textureCanvas.height=1600;
  const textureContext=textureCanvas.getContext('2d'), fieldTexture=new THREE.CanvasTexture(textureCanvas);
  fieldTexture.colorSpace=THREE.SRGBColorSpace;
  const backdrop=new THREE.Mesh(new THREE.PlaneGeometry(1000,800),new THREE.MeshBasicMaterial({map:fieldTexture,toneMapped:false}));
  backdrop.position.set(500,400,-.1);board.add(backdrop);
  const target=new THREE.WebGLRenderTarget(2000,1600,{type:THREE.HalfFloatType,depthBuffer:true});
  const shadowCanvas=doc.createElement('canvas');shadowCanvas.width=128;shadowCanvas.height=128;
  const sc=shadowCanvas.getContext('2d'), sg=sc.createRadialGradient(64,64,17,64,64,60);
  sg.addColorStop(0,'#000b');sg.addColorStop(.42,'#0007');sg.addColorStop(1,'#0000');sc.fillStyle=sg;sc.fillRect(0,0,128,128);
  const shadowTexture=new THREE.CanvasTexture(shadowCanvas);
  const shapes=new Map(), players=new Map();
  let svg=null, foreign=null, disposed=false, snapshotGeneration=0, pendingImages=new Set(), lost=false;
  const lose=event=>{event.preventDefault();lost=true;};canvas.addEventListener('webglcontextlost',lose);

  function geometry(shapeName,part='base'){
    const id=`${shapeName}:${part}`;if(shapes.has(id))return shapes.get(id);
    const s=new THREE.Shape();
    // The chamfer and softened corners are part of the silhouette, not a stack
    // of independently scaled discs. Circle/square/triangle retain their roles.
    if(shapeName==='square'){
      s.moveTo(-10,-15);s.lineTo(10,-15);s.quadraticCurveTo(15,-15,15,-10);s.lineTo(15,10);s.quadraticCurveTo(15,15,10,15);s.lineTo(-10,15);s.quadraticCurveTo(-15,15,-15,10);s.lineTo(-15,-10);s.quadraticCurveTo(-15,-15,-10,-15);
    }else if(shapeName==='triangle'){
      s.moveTo(-1.5,18);s.quadraticCurveTo(0,20,1.5,18);s.lineTo(17,-11);s.quadraticCurveTo(18.5,-14,15,-14);s.lineTo(-15,-14);s.quadraticCurveTo(-18.5,-14,-17,-11);s.closePath();
    }else s.absarc(0,0,17,0,Math.PI*2,false);
    const glass=part==='glass',inlay=part==='inlay';
    const g=new THREE.ExtrudeGeometry(s,{depth:inlay?.1:glass?2.7:1.6,bevelEnabled:!inlay,bevelSegments:8,steps:1,bevelSize:glass?.75:.4,bevelThickness:glass?.75:.35,curveSegments:64});
    const scale=inlay?.94:glass?.95:1;g.scale(scale,scale,1);
    shapes.set(id,g);return g;
  }
  function removePlayer(item){
    board.remove(item.group,item.shadow);item.group.traverse(n=>{if(n.material)n.material.dispose();});item.shadow.material.dispose();item.shadow.geometry.dispose();
  }
  function makePlayer(p,now,light){
    const group=new THREE.Group();
    const metal=new THREE.MeshPhysicalMaterial({color:p.side==='defense'?'#aaa5b5':'#baa17a',metalness:.88,roughness:.3,clearcoat:.3,clearcoatRoughness:.2,envMapIntensity:.8});
    const base=new THREE.Mesh(geometry(p.shape),metal);base.position.z=.5;group.add(base);
    const sourceColor=light&&p.color===COLORS.offense?'#8666ae':p.color;
    const faceColor=new THREE.Color(sourceColor).lerp(new THREE.Color('#21162d'),.55);
    const insert=new THREE.Mesh(geometry(p.shape,'inlay'),new THREE.MeshPhysicalMaterial({color:faceColor,metalness:.08,roughness:.35,clearcoat:.15,envMapIntensity:.45}));
    insert.position.z=2.5;group.add(insert);
    const glass=new MeshTransmissionMaterial({samples:8,_transmission:.85,roughness:.11,thickness:4.8,chromaticAberration:.0015,anisotropicBlur:.015,distortion:0,temporalDistortion:0,attenuationColor:new THREE.Color('#d8cbe8'),attenuationDistance:32,buffer:target.texture});
    glass.color.set('#eae5f2');glass.ior=1.46;glass.clearcoat=.35;glass.clearcoatRoughness=.16;glass.envMapIntensity=.7;
    const cap=new THREE.Mesh(geometry(p.shape,'glass'),glass);cap.position.z=2.9;group.add(cap);
    const shadow=new THREE.Mesh(new THREE.PlaneGeometry(54,54),new THREE.MeshBasicMaterial({map:shadowTexture,transparent:true,opacity:.62,depthWrite:false,toneMapped:false}));
    shadow.position.z=.01;board.add(shadow,group);
    return {group,base,insert,cap,shadow,born:now,shape:p.shape,color:p.color,side:p.side,light,lift:0};
  }
  function mount(next,play,settings){
    svg?.classList.remove('digital-ready');foreign?.remove();svg=next;
    foreign=doc.createElementNS('http://www.w3.org/2000/svg','foreignObject');
    for(const [key,value]of Object.entries({x:0,y:0,width:1000,height:800,'class':'digital-board-surface','pointer-events':'none','aria-hidden':'true'}))foreign.setAttribute(key,value);
    foreign.append(canvas);svg.insertBefore(foreign,svg.querySelector('#pitch-players'));
    textureContext.fillStyle=settings.fieldTheme==='light'?'#f4effb':'#24163b';textureContext.fillRect(0,0,2000,1600);fieldTexture.needsUpdate=true;
    refreshBackground();
  }
  function refreshBackground(){
    if(!svg||disposed)return;
    const generation=++snapshotGeneration, clone=svg.cloneNode(true);
    clone.querySelectorAll('.digital-board-surface,.digital-decoration,[data-player],#pitch-ball,.point-handle,.draft-layer').forEach(n=>n.remove());
    clone.removeAttribute('class');clone.setAttribute('width','2000');clone.setAttribute('height','1600');
    const url=URL.createObjectURL(new Blob([new win.XMLSerializer().serializeToString(clone)],{type:'image/svg+xml'}));
    const image=new win.Image();pendingImages.add(url);
    const finish=()=>{URL.revokeObjectURL(url);pendingImages.delete(url);};
    image.onload=()=>{if(!disposed&&generation===snapshotGeneration){textureContext.clearRect(0,0,2000,1600);textureContext.drawImage(image,0,0,2000,1600);fieldTexture.needsUpdate=true;}finish();};
    image.onerror=finish;image.src=url;
  }
  function draw({play,settings,time,materialTime=0,selected,draggingId=null,hoveredId=null,animated=true,pointer=[.3,.2]}){
    if(disposed||lost)throw new Error('The 3D context is unavailable');
    const light=settings.fieldTheme==='light', live=new Set(play.players.map(p=>p.id));
    for(const [id,item]of players)if(!live.has(id)){removePlayer(item);players.delete(id);}
    for(const p of play.players){
      let item=players.get(p.id);
      if(item&&(item.shape!==p.shape||item.color!==p.color||item.side!==p.side||item.light!==light)){removePlayer(item);players.delete(p.id);item=null;}
      if(!item){item=makePlayer(p,materialTime,light);players.set(p.id,item);}
      const at=project(animatedPlayer(play,p,time));
      const lift=draggingId===p.id?3.5:hoveredId===p.id?.7:0;
      item.lift=animated?item.lift+(lift-item.lift)*.22:0;
      const age=animated?Math.min(1,(materialTime-item.born)/.24):1, scale=.92+.08*(1-(1-age)**3);
      item.group.scale.setScalar(scale);item.group.position.set(at.x,800-at.y,item.lift);
      // All chips share the board's camera. They never wobble independently.
      item.group.rotation.set(0,0,0);
      item.shadow.position.set(at.x+1+item.lift*.2,800-at.y-1-item.lift*.35,.01);
      item.shadow.scale.setScalar(1+item.lift*.045);item.shadow.material.opacity=.62-item.lift*.045;
      item.cap.material.time=materialTime;
      item.base.material.emissive.set(selected?.type==='player'&&selected.id===p.id?'#282016':'#000000');
    }
    key.position.x=170+(animated?(pointer[0]-.5)*35:0);
    // First capture the field, routes, metal bases and colored inserts. Then render
    // glass against that buffer on a transparent canvas, leaving SVG hit targets intact.
    backdrop.visible=true;for(const item of players.values())item.cap.visible=false;
    renderer.setRenderTarget(target);renderer.clear();renderer.render(scene,camera);
    backdrop.visible=false;for(const item of players.values())item.cap.visible=true;
    renderer.setRenderTarget(null);renderer.clear();renderer.render(scene,camera);
    svg?.classList.add('digital-ready');canvas.dataset.renderer='three';
  }
  return {mount,refreshBackground,draw,capture:()=>canvas.toDataURL('image/png'),
    destroy(){if(disposed)return;disposed=true;snapshotGeneration++;svg?.classList.remove('digital-ready');foreign?.remove();
      canvas.removeEventListener('webglcontextlost',lose);for(const url of pendingImages)URL.revokeObjectURL(url);pendingImages.clear();
      for(const item of players.values())removePlayer(item);players.clear();for(const g of shapes.values())g.dispose();shapes.clear();
      scene.remove(board);backdrop.geometry.dispose();backdrop.material.dispose();fieldTexture.dispose();shadowTexture.dispose();target.dispose();environmentTarget.dispose();renderer.dispose();renderer.forceContextLoss();
    }};
}
