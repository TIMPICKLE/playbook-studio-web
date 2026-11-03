import { animatedBall, animatedPlayer, sampledRoute } from './model.js';
import copy from './locales/training-field.js';
import { getLocale } from './i18n.js';
import { deviceIsTraditional } from './visual-mode.js';

const SVG = 'http://www.w3.org/2000/svg';
const surface = 'display:block;width:100%;height:100%;min-height:inherit;';
const fieldPoint = p => [30 + p.x * 7.8, 16 + p.y * 4.46];
function diagram(doc, play, cameraId, losY, selectable, onPick, words) {
  const elem = (tag, attrs, parent) => {
    const el = doc.createElementNS(SVG, tag);
    Object.entries(attrs).forEach(([key, value]) => el.setAttribute(key, value));
    parent?.append(el); return el;
  };
  const svg = elem('svg', {viewBox:'0 0 840 478', role:'group', 'aria-label':words.field, style:surface+'background:#173a35'});
  const decor = elem('g', { 'aria-hidden':'true', 'pointer-events':'none' }, svg);
  for (let i=0; i<10; i++) {
    const y=16+i*44.6;
    if (i%2===0) elem('rect',{x:30,y,width:780,height:44.6,fill:'#193f39'},decor);
    elem('path',{d:'M30 '+y+'H810',stroke:'#53716a','stroke-width':1},decor);
    for (let j=1;j<5;j++) for (const x of [290,550]) {
      elem('path',{d:'M'+(x-4)+' '+(y+j*8.92)+'h8',stroke:'#6f8b82','stroke-width':1},decor);
    }
  }
  elem('rect',{x:30,y:16,width:780,height:446,fill:'none',stroke:'#73928a','stroke-width':2},decor);
  if (Number.isFinite(losY)) elem('path',{d:'M30 '+fieldPoint({x:0,y:losY})[1]+'H810',stroke:'#e9deb4','stroke-opacity':.6,'stroke-dasharray':'5 6'},decor);
  const paths=elem('g',{fill:'none','stroke-width':2.6,opacity:.85,'aria-hidden':'true','pointer-events':'none'},svg);
  const numbers={offense:0,defense:0};
  const markers=play.players.map(player=>{
    const canPick=selectable(player), n=++numbers[player.side], camera=player.id===cameraId;
    const group=elem('g',{'data-training-marker':player.id},svg);
    // Neutral jersey numbers identify selectable targets before the coach reveals the key.
    const neutral=(camera?words.origin:words[player.side]+' '+words.marker)+' '+n;
    group.setAttribute('aria-label',neutral);
    if(canPick){
      group.setAttribute('role','button'); group.style.cursor='pointer';
      group.addEventListener('click',()=>onPick(player.id));
      group.addEventListener('keydown',e=>{if(e.key===' '||e.key==='Enter'){e.preventDefault();onPick(player.id);}});
    } else group.setAttribute('role','img');
    elem('circle',{r:21,fill:'transparent'},group);
    const ring=elem('circle',{r:17,fill:'none','stroke-width':3},group);
    const glyph=elem(player.side==='defense'?'rect':'circle',player.side==='defense'?{x:-12,y:-12,width:24,height:24,rx:6}:{r:12},group);
    glyph.setAttribute('fill',player.side==='defense'?'#e99c70':'#d2e8e2');
    glyph.setAttribute('stroke',camera?'#f3e298':'#234138');glyph.setAttribute('stroke-width',camera?3:1.5);
    const label=elem('text',{'text-anchor':'middle',y:4.2,fill:'#162b29','font-family':'system-ui,sans-serif','font-weight':750,'font-size':11.5,'pointer-events':'none'},group);
    group.addEventListener('focus',()=>{ring.style.stroke='#fff';ring.style.strokeDasharray='2.5 2';});
    group.addEventListener('blur',()=>{ring.style.stroke='';ring.style.strokeDasharray='';});
    return {group,player,n,canPick,neutral,label,ring};
  });
  const ball=elem('ellipse',{rx:4.7,ry:3.1,fill:'#895337',stroke:'#fff2db','stroke-width':1,'aria-hidden':'true','pointer-events':'none'},svg);
  let lastKey='';
  return {node:svg,draw(state){
    const {time,selectedIds,correctIds,revealed,picking}=state;
    const key=JSON.stringify([selectedIds,correctIds,revealed,picking]);
    const changed=key!==lastKey;
    if(changed){
      lastKey=key; paths.replaceChildren();
      if(revealed) for(const r of play.routes.filter(r=>!r.optional&&r.kind!=='pass'&&(correctIds.includes(r.playerId)||selectedIds.includes(r.playerId)))){
        const d=sampledRoute(r).map((p,i)=>(i?'L':'M')+fieldPoint(p).join(' ')).join(' ');
        elem('path',{d,stroke:correctIds.includes(r.playerId)?'#a8f6c9':'#f3bd92','stroke-dasharray':'5 4'},paths);
      }
    }
    for(const {player,group,n,canPick,neutral,label,ring} of markers){
      const [x,y]=fieldPoint(animatedPlayer(play,player,time));
      group.setAttribute('transform','translate('+x+' '+y+')');
      if(!changed)continue;
      const chosen=selectedIds.includes(player.id),correct=revealed&&correctIds.includes(player.id);
      ring.setAttribute('stroke',correct?'#7cf4ac':chosen?(revealed?'#ff8e80':'#fff0a7'):'none');
      label.textContent=revealed||player.id===cameraId?player.label:n;
      group.setAttribute('aria-label',revealed?words[player.side]+' '+player.label:neutral);
      if(canPick){group.setAttribute('tabindex',picking?'0':'-1');group.setAttribute('aria-disabled',String(!picking));group.setAttribute('aria-pressed',String(chosen));}
    }
    const pos=animatedBall(play,time);
    if(pos&&revealed){const [x,y]=fieldPoint(pos);ball.setAttribute('transform','translate('+(x+9)+' '+(y+9)+') rotate(-30)');ball.setAttribute('visibility','visible');}
    else ball.setAttribute('visibility','hidden');
  }};
}

export function createTrainingField({root,play,cameraId,direction='up',losY,selectableSide,onPick=()=>{},onModeChange=()=>{},labels={}}) {
  const doc=root.ownerDocument, win=doc.defaultView, words={...copy[getLocale()],...labels};
  const owner=play.players.find(p=>p.id===cameraId);
  const side=selectableSide??(owner?.side==='defense'?'offense':'defense');
  const selectable=p=>p.id!==cameraId&&(side==='all'||p.side===side);
  let state={time:0,selectedIds:[],correctIds:[],revealed:false,picking:true};
  let mode=null, desired=null, engine=null, pending=false, dead=false;
  let canPOV=Boolean(owner && !deviceIsTraditional(win)), softwareOnly=false;
  const pick=id=>{if(state.picking&&!state.revealed&&play.players.some(p=>p.id===id&&selectable(p)))onPick(id);};
  const flat=diagram(doc,play,cameraId,losY,selectable,pick,words);
  const stage=doc.createElement('div');
  stage.style.cssText='position:relative;overflow:hidden;width:100%;height:100%;min-height:inherit;background:#193830;';
  root.replaceChildren(stage);
  function showFlat(){
    if(mode!=='field'){mode='field';stage.replaceChildren(flat.node);flat.draw(state);onModeChange('field');}
    else flat.draw(state);
  }
  function fail(){
    if(dead)return;
    const retry=engine?.kind==='gpu'&&!softwareOnly;
    engine?.destroy();engine=null;
    if(retry){
      softwareOnly=true;
      if(desired!=='pov')return;
      mode=null;
      // A device can lose its GPU during the first draw, before openPOV settles.
      queueMicrotask(()=>{if(!dead&&desired==='pov')openPOV();});return;
    }
    canPOV=false;desired='field';showFlat();
  }
  function showPOV(){
    if(mode!=='pov'){mode='pov';stage.replaceChildren(engine.canvas);engine.resize();engine.draw(state);onModeChange('pov');}
    else engine.draw(state);
  }
  async function openPOV(){
    if(pending)return;
    pending=true;
    if(!mode){const loading=doc.createElement('div');loading.setAttribute('role','status');loading.style.cssText='display:grid;place-items:center;min-height:inherit;height:100%;color:#d7e5df;font:500 14px system-ui';loading.textContent=words.loading;stage.replaceChildren(loading);}
    try {
      const {createTrainingPOV}=await import('./training-field-pov.js');
      if(dead||desired!=='pov')return;
      engine=createTrainingPOV({stage,play,cameraId,direction,losY,words,onPick:pick,onFail:fail,softwareOnly});
      showPOV();
    }catch{fail();}finally{pending=false;}
  }
  function setState(next={}){
    if(dead)return;
    state={...state,...next};
    desired=next.mode??desired??(canPOV?'pov':'field');
    if(desired==='pov'&&canPOV){
      if(engine){try{showPOV();}catch{fail();}}else openPOV();
    }else showFlat();
  }
  return {setState,resetLook(){engine?.resetLook();},get supportsPOV(){return canPOV;},
    getVisibleIds(){return mode==='pov'?engine?.visibleIds(false)??null:null;},
    getReachableIds(){return mode==='pov'?engine?.visibleIds(true)??null:null;},
    destroy(){dead=true;engine?.destroy();stage.remove();}
  };
}
