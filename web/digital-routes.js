import { clamp, passFlightRoute, animatedBall, animatedPlayer } from './model.js';
import { project, routePath, motionPath } from './field.js';

const NS = 'http://www.w3.org/2000/svg';
const el = (doc, name, attrs = {}) => {
  const node = doc.createElementNS(NS, name);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  return node;
};
export function feedbackProgress(play, route, time) {
  const flight = route.kind === 'pass' && route.playerId === play.ball.holderId && play.ball.receiverId;
  const delay = flight ? play.ball.passAt : route.delay;
  const duration = flight ? play.ball.arriveAt - play.ball.passAt : route.duration;
  return { progress: clamp((time-delay)/Math.max(.01,duration),0,1), active: !route.optional && time >= delay && time < delay+duration,
    impact: route.kind === 'block' && !route.optional ? clamp(1-(time-delay-duration)/.55,0,1) * Number(time>=delay+duration) : 0 };
}
export function createRouteFeedback(svg, play) {
  const doc=svg.ownerDocument, layer=el(doc,'g',{'class':'digital-decoration','pointer-events':'none','aria-hidden':'true'});
  const defs=el(doc,'defs');
  const filter=el(doc,'filter',{id:'digital-route-glow',x:'-100%',y:'-100%',width:'300%',height:'300%'});
  filter.innerHTML='<feGaussianBlur stdDeviation="2.2" result="blur"/><feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>';
  defs.append(filter);layer.append(defs);
  const zones=new Map(), routes=new Map();
  for (const zone of play.zones) {
    const p=project(zone), id=`digital-zone-${zones.size}`, gradient=el(doc,'radialGradient',{id});
    gradient.innerHTML=`<stop offset="0" stop-color="${zone.color}" stop-opacity=".13"/><stop offset=".72" stop-color="${zone.color}" stop-opacity=".06"/><stop offset="1" stop-color="${zone.color}" stop-opacity="0"/>`;
    defs.append(gradient);
    const group=el(doc,'g',{transform:`translate(${p.x} ${p.y})`});
    group.append(el(doc,'ellipse',{rx:zone.rx*9.64,ry:zone.ry*7.6,fill:`url(#${id})`}));
    const contour=el(doc,'ellipse',{rx:zone.rx*9.64*.78,ry:zone.ry*7.6*.78,fill:'none',stroke:zone.color,'stroke-width':.8,opacity:.25});
    group.append(contour);zones.set(zone.id,{group,contour});layer.append(group);
  }
  for (const route of play.routes) {
    const d=route.kind==='motion'?motionPath(route):routePath(route);
    const group=el(doc,'g',{'data-feedback-route':route.id});
    const halo=el(doc,'path',{d,fill:'none',stroke:route.color,'stroke-width':route.kind==='block'?7:5,opacity:route.optional?.08:.18,filter:'url(#digital-route-glow)','stroke-linecap':'round'});
    if(route.optional||route.kind==='pass')halo.setAttribute('stroke-dasharray',route.kind==='pass'?'4 7':'9 6');
    const tracer=el(doc,'path',{d,fill:'none',stroke:route.kind==='pass'?'#fff0bd':'#ffffff','stroke-width':route.kind==='block'?4:3,pathLength:1,'stroke-dasharray':route.kind==='motion'?'.04 .96':'.08 .92','stroke-linecap':'round',filter:'url(#digital-route-glow)',opacity:0});
    const end=project(route.points.at(-1)), impact=el(doc,'circle',{cx:end.x,cy:end.y,r:12,fill:'none',stroke:route.color,'stroke-width':2,opacity:0});
    group.append(halo,tracer,impact);routes.set(route.id,{group,halo,tracer,impact});layer.append(group);
  }
  const trails=new Map();
  for(const p of play.players){const trail=el(doc,'path',{fill:'none',stroke:p.color,'stroke-width':4,'stroke-linecap':'round',opacity:0,filter:'url(#digital-route-glow)'});layer.append(trail);trails.set(p.id,trail);}
  const catchRing=el(doc,'circle',{r:15,fill:'none',stroke:'#ffe69c','stroke-width':2,opacity:0,filter:'url(#digital-route-glow)'});
  const ballTrail=el(doc,'path',{fill:'none',stroke:'#ffe7b1','stroke-width':3,'stroke-linecap':'round',opacity:0,filter:'url(#digital-route-glow)'});
  layer.append(ballTrail,catchRing);
  svg.insertBefore(layer,svg.querySelector('#pitch-players'));
  return {
    layer,
    update({play,time,selected,animated=true,materialTime=time,rehearsal=false}) {
      const flight=time>0?passFlightRoute(play):null;
      for (const route of play.routes) {
        const item=routes.get(route.id);if(!item)continue;
        const d=route.kind==='motion'?motionPath(route):routePath(flight?.id===route.id?flight:route);
        item.halo.setAttribute('d',d);item.tracer.setAttribute('d',d);
        const f=feedbackProgress(play,route,time);
        item.tracer.setAttribute('opacity',animated&&f.active&&time>0?'.9':'0');
        item.tracer.setAttribute('stroke-dashoffset',String(-f.progress));
        const end=project(route.points.at(-1));item.impact.setAttribute('cx',end.x);item.impact.setAttribute('cy',end.y);
        item.impact.setAttribute('r',String(10+(1-f.impact)*20));item.impact.setAttribute('opacity',animated?String(f.impact*.75):'0');
      }
      for (const zone of play.zones) {
        const item=zones.get(zone.id);if(!item)continue;
        const p=project(zone);item.group.setAttribute('transform',`translate(${p.x} ${p.y})`);
        const active=selected?.type==='zone'&&selected.id===zone.id;
        const clock=rehearsal?time:materialTime;
        item.contour.setAttribute('opacity',active?String(.55+(animated?Math.sin(clock*2)*.15:0)):'.25');
        item.contour.setAttribute('rx',zone.rx*9.64*(.78+(animated?Math.sin(clock*2)*.035:0)));
        item.contour.setAttribute('ry',zone.ry*7.6*(.78+(animated?Math.sin(clock*2)*.035:0)));
        const fill=item.group.firstElementChild;fill.setAttribute('rx',zone.rx*9.64);fill.setAttribute('ry',zone.ry*7.6);
      }
      const age=time-play.ball.arriveAt,b=animatedBall(play,time);
      for(const p of play.players){const trail=trails.get(p.id);if(!trail)continue;
        const at=animatedPlayer(play,p,time),before=animatedPlayer(play,p,Math.max(0,time-.22));
        const moving=animated&&time>0&&Math.hypot(at.x-before.x,at.y-before.y)>.05;
        trail.setAttribute('opacity',moving?'.3':'0');
        if(moving)trail.setAttribute('d',Array.from({length:7},(_,i)=>{const v=project(animatedPlayer(play,p,Math.max(0,time-.22+i*.22/6)));return`${i?'L':'M'}${v.x} ${v.y}`;}).join(' '));
      }
      const flying=animated&&play.ball.receiverId&&time>=play.ball.passAt&&time<play.ball.arriveAt;
      ballTrail.setAttribute('opacity',flying?'.65':'0');
      if(flying)ballTrail.setAttribute('d',Array.from({length:9},(_,i)=>{const v=project(animatedBall(play,Math.max(play.ball.passAt,time-.12+i*.12/8)));return`${i?'L':'M'}${v.x+23} ${v.y-11}`;}).join(' '));
      const caught=animated&&play.ball.receiverId&&age>=0&&age<.6;
      catchRing.setAttribute('opacity',caught?String((1-age/.6)*.8):'0');
      if(b){const p=project(b);catchRing.setAttribute('cx',p.x);catchRing.setAttribute('cy',p.y);catchRing.setAttribute('r',String(17+age*40));}
      const ball=svg.querySelector('#pitch-ball');
      if(ball){const t=time>=play.ball.passAt&&time<play.ball.arriveAt&&play.ball.receiverId?time*560:0;
        for(const child of ball.children)child.setAttribute('transform',`rotate(${-35+(animated?t:0)})`);}
    },
    destroy(){layer.remove();const ball=svg.querySelector('#pitch-ball');if(ball)for(const child of ball.children)child.setAttribute('transform','rotate(-35)');}
  };
}
