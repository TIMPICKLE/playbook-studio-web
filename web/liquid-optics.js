// Playbook's material compositor. Optical background: Paper Shaders Liquid Metal.
// Rounded-lens model informed by https://kube.io/blog/liquid-glass-css-svg/.
// It refracts the live material scene; interactive DOM is never rasterised.
export const lensVertex = `
attribute vec2 a_position;
varying vec2 v_uv;
void main(){v_uv=(a_position+1.0)*0.5;gl_Position=vec4(a_position,0.0,1.0);}`;
export const lensFragment = `
precision highp float;
varying vec2 v_uv;
uniform sampler2D u_scene;
uniform vec2 u_world;
uniform vec4 u_rect;
uniform vec2 u_pointer;
uniform vec3 u_pulse;
uniform float u_time,u_radius,u_gold,u_current;
float roundedBox(vec2 p,vec2 b,float r){vec2 q=abs(p)-b+r;return length(max(q,0.0))+min(max(q.x,q.y),0.0)-r;}
vec3 sampleScene(vec2 p){return texture2D(u_scene,clamp(vec2(p.x,1.0-p.y),0.001,0.999)).rgb;}
void main(){
  vec2 size=u_rect.zw, q=vec2(v_uv.x,1.0-v_uv.y)*size, p=q-size*.5;
  float radius=min(u_radius,min(size.x,size.y)*.5);
  float d=roundedBox(p,size*.5-vec2(.6),radius);
  float mask=1.0-smoothstep(-.7,.7,d);
  if(mask<.001){gl_FragColor=vec4(0.0);return;}
  vec2 n=normalize(vec2(roundedBox(p+vec2(.5,0.),size*.5,radius)-roundedBox(p-vec2(.5,0.),size*.5,radius),roundedBox(p+vec2(0.,.5),size*.5,radius)-roundedBox(p-vec2(0.,.5),size*.5,radius))+vec2(.00001));
  float bevel=min(24.0,min(size.x,size.y)*.30);
  float edge=clamp(-d/bevel,0.0,1.0), rim=pow(1.0-edge,1.4);
  float slope=pow(1.0-edge,3.0)/pow(max(.003,1.0-pow(1.0-edge,4.0)),.75);
  vec3 ray=refract(vec3(0.,0.,-1.),normalize(vec3(n*slope*.55,1.)),1.0/1.48);
  vec2 offset=-ray.xy/max(.18,abs(ray.z))*38.0;
  vec2 pointerDelta=u_rect.xy+q-u_pointer;
  float reach=exp(-dot(pointerDelta,pointerDelta)/48000.0);
  offset+=sin(q.yx*.027+u_time*1.6)*reach*3.4;
  float age=u_time-u_pulse.z, dist=length(u_rect.xy+q-u_pulse.xy);
  float wave=sin(dist*.08-age*10.0)*exp(-pow((dist-age*160.0)/70.0,2.0))*exp(-max(age,0.0)*1.8)*step(0.0,age);
  offset+=normalize(u_rect.xy+q-u_pulse.xy+vec2(.01))*wave*8.0;
  vec2 uv=(u_rect.xy+q+offset)/u_world, split=n*(rim*3.8+.3)/u_world;
  vec3 scene=vec3(sampleScene(uv+split).r,sampleScene(uv).g,sampleScene(uv-split).b);
  vec3 tint=mix(vec3(.061,.048,.105),vec3(.13,.09,.07),u_current*.5);
  vec3 color=mix(tint,scene,.27+rim*.38);
  vec2 light=normalize(vec2(-.6,-.8)+vec2(sin(u_time*.3),cos(u_time*.22))*.35);
  float shine=pow(max(0.0,dot(n,light)),7.0)*rim;
  float glint=pow(max(0.,1.0-abs(d+1.2)/1.6),2.0);
  vec3 spectral=.5+.5*cos(vec3(0.,2.1,4.2)+atan(n.y,n.x)*2.0+u_time*.4);
  color+=shine*vec3(.8,.82,1.0)+glint*(vec3(.30)+spectral*.20)+rim*reach*.14;
  color+=wave*.035;
  vec3 gold=mix(vec3(.69,.43,.13),vec3(1.0,.95,.65),clamp(scene.r*.88+rim*.22,0.,1.));
  gold+=shine*.45+glint*.25;
  color=mix(color,gold,u_gold);
  gl_FragColor=vec4(color,mask);
}`;

export function createLensPainter(source, doc = document) {
  const canvas=doc.createElement('canvas');
  const gl=canvas.getContext('webgl',{alpha:true,antialias:false,premultipliedAlpha:false,preserveDrawingBuffer:true});
  if(!gl)throw new Error('Glass renderer unavailable');
  const shaders=[];
  function compile(type,sourceText){const shader=gl.createShader(type);shaders.push(shader);gl.shaderSource(shader,sourceText);gl.compileShader(shader);if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS))throw new Error(gl.getShaderInfoLog(shader));return shader;}
  const program=gl.createProgram();
  try{gl.attachShader(program,compile(gl.VERTEX_SHADER,lensVertex));gl.attachShader(program,compile(gl.FRAGMENT_SHADER,lensFragment));gl.linkProgram(program);if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw new Error(gl.getProgramInfoLog(program));}
  catch(error){shaders.forEach(s=>gl.deleteShader(s));gl.deleteProgram(program);throw error;}
  gl.useProgram(program);
  const buffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]),gl.STATIC_DRAW);
  const location=gl.getAttribLocation(program,'a_position');gl.enableVertexAttribArray(location);gl.vertexAttribPointer(location,2,gl.FLOAT,false,0,0);
  const texture=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,texture);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,true);
  const uniforms=Object.fromEntries(['scene','world','rect','pointer','pulse','time','radius','gold','current'].map(key=>[key,gl.getUniformLocation(program,`u_${key}`)]));
  gl.uniform1i(uniforms.scene,0);
  let disposed=false;
  return {
    canvas,
    begin({width,height,time,pointer,pulse}){
      if(disposed||gl.isContextLost())throw new Error('Glass context lost');
      gl.bindTexture(gl.TEXTURE_2D,texture);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,source);
      gl.uniform2f(uniforms.world,width,height);gl.uniform1f(uniforms.time,time);gl.uniform2fv(uniforms.pointer,pointer);gl.uniform3fv(uniforms.pulse,pulse);
    },
    paint(ctx,rect,{radius=20,gold=false,current=false,dpr=1}={}){
      const w=Math.max(1,Math.round(rect.width*dpr)),h=Math.max(1,Math.round(rect.height*dpr));
      if(canvas.width!==w)canvas.width=w;if(canvas.height!==h)canvas.height=h;
      if(ctx.canvas.width!==w)ctx.canvas.width=w;if(ctx.canvas.height!==h)ctx.canvas.height=h;
      gl.viewport(0,0,w,h);gl.uniform4f(uniforms.rect,rect.left,rect.top,rect.width,rect.height);
      gl.uniform1f(uniforms.radius,radius);gl.uniform1f(uniforms.gold,Number(gold));gl.uniform1f(uniforms.current,Number(current));
      gl.clearColor(0,0,0,0);gl.clear(gl.COLOR_BUFFER_BIT);gl.drawArrays(gl.TRIANGLES,0,6);
      ctx.clearRect(0,0,w,h);ctx.drawImage(canvas,0,0);
    },
    dispose(){if(disposed)return;disposed=true;gl.deleteTexture(texture);gl.deleteBuffer(buffer);shaders.forEach(s=>gl.deleteShader(s));gl.deleteProgram(program);gl.getExtension('WEBGL_lose_context')?.loseContext();}
  };
}
