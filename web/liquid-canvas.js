// Capability fallback for browsers with WebGL disabled. No device-speed heuristics.
// Flowing metallic ribbons and layered edge samples keep the same live material.
export function createCanvasMetal(parent) {
  const doc=parent.ownerDocument,win=doc.defaultView,canvas=doc.createElement('canvas'),ctx=canvas.getContext('2d');
  if(!ctx)throw new Error('Canvas material unavailable');
  parent.prepend(canvas);
  return {canvasElement:canvas,setFrame(frame){
    const w=win.innerWidth,h=win.innerHeight,dpr=Math.max(1,win.devicePixelRatio||1),t=frame/1000;
    if(canvas.width!==Math.round(w*dpr))canvas.width=Math.round(w*dpr);
    if(canvas.height!==Math.round(h*dpr))canvas.height=Math.round(h*dpr);
    ctx.setTransform(dpr,0,0,dpr,0,0);ctx.fillStyle='#100e1d';ctx.fillRect(0,0,w,h);
    const span=Math.max(w,h),drift=Math.sin(t*.15)*span*.12;
    ctx.save();ctx.translate(w*.5+drift,h*.5);ctx.rotate(-.48+Math.sin(t*.07)*.1);
    for(let i=-3;i<5;i++){
      const x=i*span*.24,band=span*.25;
      const g=ctx.createLinearGradient(x-band*.3,0,x+band,0);
      for(const [stop,color]of [[0,'#21162f'],[.2,'#4d3d61'],[.38,'#bfb4ca'],[.44,'#f4f0f5'],[.48,'#93809e'],[.53,'#201a2d'],[.72,'#13101e'],[.86,'#52425b'],[.96,'#cbc0ba'],[1,'#362840']])g.addColorStop(stop,color);
      ctx.fillStyle=g;ctx.beginPath();
      const wobble=(y)=>Math.sin(y/span*3.6+t*.28+i*.7)*span*.14+Math.sin(y/span*6-t*.19)*span*.045;
      for(let y=-span*1.6;y<=span*1.6;y+=12){const bx=x+wobble(y);if(y===-span*1.6)ctx.moveTo(bx,y);else ctx.lineTo(bx,y);}
      for(let y=span*1.6;y>=-span*1.6;y-=12)ctx.lineTo(x+band+wobble(y),y);
      ctx.closePath();ctx.fill();
    }
    ctx.restore();
    const glow=ctx.createRadialGradient(w*.28,h*.22,0,w*.28,h*.22,span*.8);glow.addColorStop(0,'#c9c5e21a');glow.addColorStop(.45,'#72628d00');glow.addColorStop(1,'#080710a0');ctx.fillStyle=glow;ctx.fillRect(0,0,w,h);
  },dispose(){canvas.remove();}};
}

export function createCanvasLensPainter(source,doc=document){
  let state;
  return {begin(value){state=value;},paint(ctx,rect,{radius=20,gold=false,current=false,dpr=1}={}){
    const w=rect.width,h=rect.height,cw=Math.round(w*dpr),ch=Math.round(h*dpr);
    if(ctx.canvas.width!==cw)ctx.canvas.width=cw;if(ctx.canvas.height!==ch)ctx.canvas.height=ch;
    ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,w,h);ctx.save();ctx.beginPath();ctx.roundRect(0,0,w,h,Math.min(radius,w/2,h/2));ctx.clip();
    ctx.fillStyle=gold?'#d4a743':current?'#241d2b':'#151020';ctx.fillRect(0,0,w,h);
    // Sampling coordinates stay aligned as panels scroll and drawers slide.
    ctx.globalAlpha=gold?.32:.24;
    // Whole-scene placement avoids clipping samples at viewport edges.
    ctx.drawImage(source,-rect.left,-rect.top,state.width,state.height);ctx.globalAlpha=1;
    const rim=ctx.createLinearGradient(0,0,w,h);
    for(const [stop,color]of [[0,'#ffffffd9'],[.15,'#e1ceff70'],[.32,'#a89acb12'],[.5,'#fff7c980'],[.66,'#9979cb22'],[.84,'#e3d7ff8f'],[1,'#ffffffb0']])rim.addColorStop(stop,color);
    const thick=Math.min(7,h*.10);ctx.strokeStyle=rim;ctx.lineWidth=thick;ctx.beginPath();ctx.roundRect(thick*.4,thick*.4,w-thick*.8,h-thick*.8,Math.max(1,radius-thick*.4));ctx.globalAlpha=.22;ctx.stroke();ctx.globalAlpha=1;
    const shine=ctx.createLinearGradient(0,0,w,h);shine.addColorStop(0,'#fff5');shine.addColorStop(.16,'#fff0');shine.addColorStop(.75,'#b294db00');shine.addColorStop(1,'#ddd0f326');ctx.fillStyle=shine;ctx.fillRect(0,0,w,h);
    const px=state.pointer[0]-rect.left,py=state.pointer[1]-rect.top,spot=ctx.createRadialGradient(px,py,0,px,py,180);spot.addColorStop(0,'#eee1ff20');spot.addColorStop(1,'#eee1ff00');ctx.fillStyle=spot;ctx.fillRect(0,0,w,h);
    const age=state.time-state.pulse[2];if(age>=0&&age<2){ctx.strokeStyle=`rgba(255,239,204,${(1-age/2)*.2})`;ctx.lineWidth=12;ctx.beginPath();ctx.arc(state.pulse[0]-rect.left,state.pulse[1]-rect.top,age*160,0,Math.PI*2);ctx.stroke();}
    if(gold){ctx.globalCompositeOperation='screen';ctx.fillStyle='#f6b82f55';ctx.fillRect(0,0,w,h);ctx.globalCompositeOperation='source-over';}
    ctx.lineWidth=1.2;ctx.strokeStyle=rim;ctx.beginPath();ctx.roundRect(.7,.7,w-1.4,h-1.4,Math.max(1,radius-.7));ctx.stroke();ctx.restore();
  },dispose(){state=null;}};
}
