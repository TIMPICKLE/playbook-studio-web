import * as THREE from './vendor/three-0.186.0/three.module.js';
import { MeshTransmissionMaterial } from './vendor/pmndrs-vanilla-1.25.0/MeshTransmissionMaterial.js';
import { animatedPlayer, COLORS } from './model.js';
import { project } from './field.js';

// A single orthographic scene shares the editor's exact 1000 × 800 coordinate space.
// The SVG remains the input/accessibility layer. Only the chip bodies are replaced.
export function createDigitalMaterials(doc = document) {
  const win=doc.defaultView, canvas=doc.createElement('canvas');
  const renderer=new THREE.WebGLRenderer({canvas,alpha:true,antialias:true,preserveDrawingBuffer:true});
  renderer.setPixelRatio(Math.max(2,win.devicePixelRatio||1));renderer.setSize(1000,800,false);
  renderer.setClearColor(0x000000,0);renderer.outputColorSpace=THREE.SRGBColorSpace;
  renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.25;
  renderer.debug.onShaderError=()=>{throw new Error('Glass shader could not compile');};
  canvas.style.cssText='display:block;width:100%;height:100%;pointer-events:none';
  const scene=new THREE.Scene(), camera=new THREE.OrthographicCamera(-500,500,400,-400,.1,2000);
  camera.position.set(500,400,1000);camera.lookAt(500,400,0);
  const ambient=new THREE.HemisphereLight('#f2e6ff','#302038',2.4);scene.add(ambient);
  const key=new THREE.DirectionalLight('#fff1d5',4.5);key.position.set(150,850,700);scene.add(key);
  const rim=new THREE.DirectionalLight('#b4a3ff',3);rim.position.set(900,200,400);scene.add(rim);

  // Procedural studio softboxes: stable highlights without an external HDR asset.
  const envCanvas=doc.createElement('canvas');envCanvas.width=1024;envCanvas.height=512;
  const ec=envCanvas.getContext('2d');
  if(!ec){renderer.dispose();throw new Error('Canvas material unavailable');}
  ec.fillStyle='#242035';ec.fillRect(0,0,1024,512);
  for(const [x,width,color] of [[40,85,'#fff6e4'],[240,25,'#fff'],[390,190,'#b8a6e1'],[680,75,'#fff9ee'],[900,42,'#e4dcff']]){
    const g=ec.createLinearGradient(x-30,0,x+width+30,0);g.addColorStop(0,'#242035');g.addColorStop(.2,color);g.addColorStop(.8,color);g.addColorStop(1,'#242035');
    ec.fillStyle=g;ec.fillRect(x-30,50,width+60,350);
  }
  const environment=new THREE.CanvasTexture(envCanvas);environment.mapping=THREE.EquirectangularReflectionMapping;environment.colorSpace=THREE.SRGBColorSpace;
  const pmrem=new THREE.PMREMGenerator(renderer), environmentTarget=pmrem.fromEquirectangular(environment);
  scene.environment=environmentTarget.texture;environment.dispose();pmrem.dispose();
  const textureCanvas=doc.createElement('canvas');textureCanvas.width=2000;textureCanvas.height=1600;
  const textureContext=textureCanvas.getContext('2d'), fieldTexture=new THREE.CanvasTexture(textureCanvas);
  fieldTexture.colorSpace=THREE.SRGBColorSpace;
  const backdrop=new THREE.Mesh(new THREE.PlaneGeometry(1000,800),new THREE.MeshBasicMaterial({map:fieldTexture,toneMapped:false}));
  backdrop.position.set(500,400,-4);scene.add(backdrop);
  const target=new THREE.WebGLRenderTarget(2000,1600,{type:THREE.HalfFloatType,depthBuffer:true});
  const shadowCanvas=doc.createElement('canvas');shadowCanvas.width=128;shadowCanvas.height=128;
  const sc=shadowCanvas.getContext('2d'), sg=sc.createRadialGradient(64,64,22,64,64,62);
  sg.addColorStop(0,'#0009');sg.addColorStop(.5,'#0004');sg.addColorStop(1,'#0000');sc.fillStyle=sg;sc.fillRect(0,0,128,128);
  const shadowTexture=new THREE.CanvasTexture(shadowCanvas);
  const shapes=new Map(), players=new Map();
  let svg=null, foreign=null, disposed=false, snapshotGeneration=0, pendingImages=new Set(), lost=false;
  const lose=event=>{event.preventDefault();lost=true;};canvas.addEventListener('webglcontextlost',lose);

  function geometry(shapeName,cap=false){
    const id=`${shapeName}:${cap}`;if(shapes.has(id))return shapes.get(id);
    const s=new THREE.Shape();
    if(shapeName==='square'){
      s.moveTo(-10,-15);s.lineTo(10,-15);s.quadraticCurveTo(15,-15,15,-10);s.lineTo(15,10);s.quadraticCurveTo(15,15,10,15);s.lineTo(-10,15);s.quadraticCurveTo(-15,15,-15,10);s.lineTo(-15,-10);s.quadraticCurveTo(-15,-15,-10,-15);
    }else if(shapeName==='triangle'){s.moveTo(0,20);s.lineTo(-20,-14);s.lineTo(20,-14);s.closePath();}
    else s.absarc(0,0,17,0,Math.PI*2,false);
    const g=new THREE.ExtrudeGeometry(s,{depth:cap?3:2.5,bevelEnabled:true,bevelSegments:5,steps:1,bevelSize:cap?2:1.4,bevelThickness:cap?2.8:1.5,curveSegments:48});
    if(cap)g.scale(.92,.92,1);
    shapes.set(id,g);return g;
  }
  function removePlayer(item){
    scene.remove(item.group,item.shadow);item.group.traverse(n=>{if(n.material)n.material.dispose();});item.shadow.material.dispose();item.shadow.geometry.dispose();
  }
  function makePlayer(p,now,light){
    const group=new THREE.Group(), metal=new THREE.MeshPhysicalMaterial({color:p.side==='defense'?'#d0c9e7':'#e8c171',metalness:.96,roughness:.2,clearcoat:1,clearcoatRoughness:.12,envMapIntensity:1.4});
    const base=new THREE.Mesh(geometry(p.shape),metal);base.position.z=3;group.add(base);
    const color=light&&p.color===COLORS.offense?'#7044ae':p.color;
    const insert=new THREE.Mesh(geometry(p.shape),new THREE.MeshPhysicalMaterial({color,metalness:.3,roughness:.26,clearcoat:1,envMapIntensity:.7}));
    insert.scale.set(.76,.76,.55);insert.position.z=7;group.add(insert);
    const glass=new MeshTransmissionMaterial({samples:8,_transmission:1,roughness:.045,thickness:11,chromaticAberration:.045,anisotropicBlur:.025,distortion:.035,distortionScale:.025,temporalDistortion:.12,buffer:target.texture});
    glass.ior=1.45;glass.clearcoat=1;glass.clearcoatRoughness=.05;glass.envMapIntensity=1.8;
    const cap=new THREE.Mesh(geometry(p.shape,true),glass);cap.position.z=9;group.add(cap);
    const shadow=new THREE.Mesh(new THREE.PlaneGeometry(66,66),new THREE.MeshBasicMaterial({map:shadowTexture,transparent:true,opacity:.7,depthWrite:false,toneMapped:false}));
    shadow.position.z=-1;scene.add(shadow,group);
    return {group,base,insert,cap,shadow,born:now,shape:p.shape,color:p.color,light,lift:0};
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
      if(item&&(item.shape!==p.shape||item.color!==p.color||item.light!==light)){removePlayer(item);players.delete(p.id);item=null;}
      if(!item){item=makePlayer(p,materialTime,light);players.set(p.id,item);}
      const at=project(animatedPlayer(play,p,time));
      const lift=draggingId===p.id?7:hoveredId===p.id?2:0;
      item.lift=animated?item.lift+(lift-item.lift)*.22:0;
      const age=animated?Math.min(1,(materialTime-item.born)/.4):1, scale=.72+.28*(1-(1-age)**3);
      item.group.scale.setScalar(scale);item.group.position.set(at.x,800-at.y,item.lift);
      item.group.rotation.x=animated?(pointer[1]-.5)*.08:0;item.group.rotation.y=animated?(pointer[0]-.5)*.08:0;
      item.shadow.position.set(at.x+1+item.lift*.2,800-at.y-3-item.lift*.45,-1);
      item.shadow.scale.setScalar(1+item.lift*.035);item.shadow.material.opacity=.7-item.lift*.035;
      item.cap.material.time=materialTime;
      item.base.material.emissive.set(selected?.type==='player'&&selected.id===p.id?'#66451c':'#000000');
    }
    key.position.x=150+(animated?Math.sin(materialTime*.45)*110+pointer[0]*80:0);
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
      backdrop.geometry.dispose();backdrop.material.dispose();fieldTexture.dispose();shadowTexture.dispose();target.dispose();environmentTarget.dispose();renderer.dispose();renderer.forceContextLoss();
    }};
}
