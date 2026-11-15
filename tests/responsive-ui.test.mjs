import test from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { readFileSync } from 'node:fs';
import { STORAGE_KEY, decodeWorkspace } from '../web/model.js';

test('touch workspace panels, zoom and orientation preserve editable play data', async t => {
  const win = new Window({ url:'http://localhost:3000/local.html', width:390, height:844 });
  win.document.body.innerHTML=readFileSync(new URL('../web/index.html',import.meta.url),'utf8').split('<body>')[1].split('</body>')[0];
  const names=['window','document','navigator','localStorage','location','Image','Blob','requestAnimationFrame','cancelAnimationFrame'];
  const previous=Object.fromEntries(names.map(n=>[n,Object.getOwnPropertyDescriptor(globalThis,n)]));
  for(const n of names)Object.defineProperty(globalThis,n,{configurable:true,value:['requestAnimationFrame','cancelAnimationFrame'].includes(n)?win[n].bind(win):win[n]});
  const doc=win.document,q=s=>doc.querySelector(s),click=s=>{const node=q(s);assert.ok(node,s);node.click();};
  const pointer=(node,type,x,y,{id=1,primary=true}={})=>node.dispatchEvent(new win.PointerEvent(type,{bubbles:true,cancelable:true,button:0,pointerId:id,pointerType:'touch',isPrimary:primary,clientX:x,clientY:y}));
  const geometry=()=>{
    const svg=q('#field .pitch-svg');
    svg.getBoundingClientRect=()=>({left:0,top:0,width:2000,height:1600});
    // happy-dom has no layout engine; model the actual SVG screen transform at 2x.
    svg.getScreenCTM=()=>({inverse:()=>({a:.5,b:0,c:0,d:.5,e:0,f:0})});
  };
  try {
    await import(`../web/app.js?responsive=${Date.now()}`);
    await t.test('drawers are isolated, focus returns on close, and properties remain editable',()=>{
      assert.equal(q('.sidebar').inert,true);assert.equal(q('.inspector-panel').inert,true);
      const opener=q('.compact-nav [data-action="inspector-panel"]');opener.focus();opener.click();
      assert.equal(q('.inspector-panel').getAttribute('role'),'dialog');assert.equal(q('.inspector-panel').inert,false);
      assert.equal(q('.canvas-section').inert,true);assert.equal(q('.sidebar').inert,true);
      assert.ok(doc.activeElement===q('.inspector-panel .panel-close'));
      const input=q('[data-prop="title"]');input.value='手机编辑验证';input.dispatchEvent(new win.Event('change',{bubbles:true}));
      assert.equal(decodeWorkspace(win.localStorage.getItem(STORAGE_KEY)).plays[0].title,'手机编辑验证');
      const panel=q('.inspector-panel'), controls=[...panel.querySelectorAll('a[href],button,input,select,textarea,[tabindex]')].filter(n=>!n.disabled&&n.tabIndex>=0&&!n.closest('[hidden],[inert]'));
      controls.at(-1).focus();controls.at(-1).dispatchEvent(new win.KeyboardEvent('keydown',{key:'Tab',bubbles:true,cancelable:true}));
      assert.ok(doc.activeElement===controls[0]);
      click('.inspector-panel .panel-close');assert.equal(q('.canvas-section').inert,false);assert.ok(doc.activeElement===opener);
    });
    await t.test('opening and dismissing a panel never discards unfinished route points',()=>{
      geometry();pointer(q('#field [data-player]'),'pointerdown',800,1000);pointer(q('#field'),'pointerup',800,1000);
      click('[data-action="tool:route"]');geometry();pointer(q('#field'),'pointerdown',950,750);
      const draft=q('.context-player').textContent, saved=win.localStorage.getItem(STORAGE_KEY), svg=q('#field svg');
      click('[data-board-action="zoom-in"]');click('[data-board-action="zoom-out"]');
      assert.equal(q('.context-player').textContent,draft);assert.ok(q('#field svg')===svg);
      click('.compact-nav [data-action="sidebar"]');assert.equal(q('.main').inert,true);
      q('.sidebar .panel-close').dispatchEvent(new win.KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));
      assert.equal(q('.main').inert,false);assert.equal(q('.sidebar').inert,true);
      assert.equal(q('.context-player').textContent,draft);assert.ok(q('#field svg')===svg);assert.equal(win.localStorage.getItem(STORAGE_KEY),saved);
      click('[data-action="cancel-draft"]');click('[data-action="clear-selection"]');
    });
    await t.test('zoom and fit preserve SVG, drafts and saved data while clamping to 100–300 percent',()=>{
      const saved=win.localStorage.getItem(STORAGE_KEY), svg=q('#field svg');
      for(let i=0;i<12;i++)click('[data-board-action="zoom-in"]');
      assert.equal(q('#board-zoom-value').textContent,'300%');assert.equal(q('[data-board-action="zoom-in"]').disabled,true);
      assert.ok(q('#field svg')===svg);assert.equal(win.localStorage.getItem(STORAGE_KEY),saved);
      click('[data-board-action="fit"]');assert.equal(q('#board-zoom-value').textContent,'100%');assert.equal(q('[data-board-action="zoom-out"]').disabled,true);
      assert.ok(q('#field svg')===svg);assert.equal(q('.board-advanced').open,false);
    });
    await t.test('touch dragging at 2x zoom uses SVG coordinates and empty turf stays scrollable',()=>{
      for(let i=0;i<4;i++)click('[data-board-action="zoom-in"]');
      const before=decodeWorkspace(win.localStorage.getItem(STORAGE_KEY)), player=before.plays[0].players[0];
      geometry();pointer(q('#field [data-player]'),'pointerdown',800,1000);geometry();
      pointer(q('#field'),'pointermove',838.56,1030.4);pointer(q('#field'),'pointerup',838.56,1030.4);
      const after=decodeWorkspace(win.localStorage.getItem(STORAGE_KEY));
      assert.ok(Math.abs(after.plays[0].players[0].x-player.x-2)<1e-6);
      assert.ok(Math.abs(after.plays[0].players[0].y-player.y-2)<1e-6);
      click('[data-action="clear-selection"]');geometry();
      const raw=win.localStorage.getItem(STORAGE_KEY), event=new win.PointerEvent('pointerdown',{bubbles:true,cancelable:true,button:0,pointerId:2,pointerType:'touch',isPrimary:true,clientX:80,clientY:80});
      q('#field svg').dispatchEvent(event);assert.equal(event.defaultPrevented,false);assert.equal(win.localStorage.getItem(STORAGE_KEY),raw);
      click('[data-board-action="fit"]');
    });
    await t.test('a touch can adjust a route endpoint without being mistaken for empty turf',()=>{
      const before=decodeWorkspace(win.localStorage.getItem(STORAGE_KEY)), route=before.plays[0].routes.find(r=>r.points.length>1);
      assert.ok(route);
      geometry();pointer(q(`#field [data-route="${route.id}"]`),'pointerdown',800,1000);pointer(q('#field'),'pointerup',800,1000);
      geometry();const handle=q(`#field [data-route-id="${route.id}"][data-point="1"]`);assert.ok(handle);
      pointer(handle,'pointerdown',600,600);pointer(q('#field'),'pointermove',638.56,630.4);pointer(q('#field'),'pointerup',638.56,630.4);
      const after=decodeWorkspace(win.localStorage.getItem(STORAGE_KEY)), adjusted=after.plays[0].routes.find(r=>r.id===route.id);
      assert.ok(Math.abs(adjusted.points[1].x-(638.56*.5-18)/9.64)<1e-6);
      assert.ok(Math.abs(adjusted.points[1].y-(630.4*.5-20)/7.6)<1e-6);
      assert.deepEqual(after.plays[0].players,before.plays[0].players);
      assert.deepEqual(adjusted.points[0],route.points[0]);
      click('[data-action="undo"]');
      assert.deepEqual(decodeWorkspace(win.localStorage.getItem(STORAGE_KEY)).plays[0].routes,before.plays[0].routes);
    });
    await t.test('a second finger cannot move, finish or cancel the first finger’s edit',()=>{
      const raw=win.localStorage.getItem(STORAGE_KEY), before=decodeWorkspace(raw), player=before.plays[0].players[0];
      geometry();pointer(q(`#field [data-player="${player.id}"]`),'pointerdown',800,1000);
      pointer(q('#field [data-player]:last-child'),'pointerdown',1400,400,{id:2,primary:false});
      pointer(q('#field'),'pointermove',1500,500,{id:2,primary:false});
      pointer(q('#field'),'pointerup',1500,500,{id:2,primary:false});
      pointer(q('#field'),'pointercancel',1500,500,{id:2,primary:false});
      pointer(q('#field'),'lostpointercapture',1500,500,{id:2,primary:false});
      assert.equal(win.localStorage.getItem(STORAGE_KEY),raw);
      // The release sample must be applied even when no move frame has run.
      pointer(q('#field'),'pointerup',838.56,1030.4);
      const after=decodeWorkspace(win.localStorage.getItem(STORAGE_KEY));
      assert.ok(Math.abs(after.plays[0].players[0].x-player.x-2)<1e-6);
      assert.ok(Math.abs(after.plays[0].players[0].y-player.y-2)<1e-6);
      assert.deepEqual(after.plays[0].players.slice(1),before.plays[0].players.slice(1));
      click('[data-action="undo"]');
      assert.deepEqual(decodeWorkspace(win.localStorage.getItem(STORAGE_KEY)).plays[0].players,before.plays[0].players);
    });
    await t.test('a secondary contact during a pan cannot start a new player edit',()=>{
      const raw=win.localStorage.getItem(STORAGE_KEY);
      geometry();pointer(q('#field svg'),'pointerdown',80,80);
      pointer(q('#field [data-player]'),'pointerdown',800,1000,{id:2,primary:false});
      pointer(q('#field'),'pointermove',950,1150,{id:2,primary:false});
      pointer(q('#field'),'pointerup',950,1150,{id:2,primary:false});
      pointer(q('#field'),'pointerup',80,80);
      assert.equal(win.localStorage.getItem(STORAGE_KEY),raw);
      assert.equal(q('.context-player'),null);
    });
    await t.test('normal capture release commits even when capture loss is dispatched synchronously',()=>{
      const raw=win.localStorage.getItem(STORAGE_KEY), before=decodeWorkspace(raw), player=before.plays[0].players[0];
      geometry();pointer(q(`#field [data-player="${player.id}"]`),'pointerdown',800,1000);
      const field=q('#field');
      field.hasPointerCapture=()=>true;
      field.releasePointerCapture=id=>pointer(field,'lostpointercapture',838.56,1030.4,{id});
      pointer(field,'pointerup',838.56,1030.4);
      const after=decodeWorkspace(win.localStorage.getItem(STORAGE_KEY));
      assert.ok(Math.abs(after.plays[0].players[0].x-player.x-2)<1e-6);
      assert.ok(Math.abs(after.plays[0].players[0].y-player.y-2)<1e-6);
      click('[data-action="undo"]');
      assert.deepEqual(decodeWorkspace(win.localStorage.getItem(STORAGE_KEY)).plays[0].players,before.plays[0].players);
    });
    await t.test('cancel, capture loss, app blur and rotation roll back unsaved movement and allow another gesture',async()=>{
      for(const reason of ['pointercancel','lostpointercapture','blur','resize']) {
        const raw=win.localStorage.getItem(STORAGE_KEY), before=decodeWorkspace(raw), player=before.plays[0].players[0];
        geometry();pointer(q(`#field [data-player="${player.id}"]`),'pointerdown',800,1000);
        pointer(q('#field'),'pointermove',900,1100);
        await new Promise(resolve=>win.requestAnimationFrame(resolve));
        if(['blur','resize'].includes(reason))win.dispatchEvent(new win.Event(reason));
        else pointer(q('#field'),reason,900,1100);
        assert.equal(win.localStorage.getItem(STORAGE_KEY),raw);
        assert.equal(q('.field-wrap').classList.contains('is-dragging'),false);
        geometry();pointer(q(`#field [data-player="${player.id}"]`),'pointerdown',800,1000);
        pointer(q('#field'),'pointerup',838.56,1030.4);
        const after=decodeWorkspace(win.localStorage.getItem(STORAGE_KEY));
        assert.ok(Math.abs(after.plays[0].players[0].x-player.x-2)<1e-6,reason);
        assert.ok(Math.abs(after.plays[0].players[0].y-player.y-2)<1e-6,reason);
        click('[data-action="undo"]');
      }
    });
    await t.test('phone, iPad and desktop transitions update panel access without remounting the pitch',()=>{
      const saved=win.localStorage.getItem(STORAGE_KEY), svg=q('#field svg');
      win.happyDOM.setWindowSize({width:1024,height:768});win.dispatchEvent(new win.Event('resize'));
      assert.equal(q('.sidebar').inert,true);assert.equal(q('.inspector-panel').inert,true);assert.equal(q('.board-advanced').open,true);
      click('.compact-nav [data-action="sidebar"]');assert.equal(q('.sidebar').inert,false);
      win.happyDOM.setWindowSize({width:1440,height:900});win.dispatchEvent(new win.Event('resize'));
      assert.equal(q('.sidebar').inert,false);assert.equal(q('.inspector-panel').inert,false);assert.equal(q('.main').inert,false);
      assert.equal(doc.body.classList.contains('compact-panel-open'),false);assert.equal(q('.sidebar').hasAttribute('aria-modal'),false);
      win.happyDOM.setWindowSize({width:390,height:844});win.dispatchEvent(new win.Event('resize'));
      assert.equal(q('.sidebar').inert,true);assert.equal(q('.inspector-panel').inert,true);
      assert.ok(q('#field svg')===svg);assert.equal(win.localStorage.getItem(STORAGE_KEY),saved);
    });
  } finally {await win.happyDOM.abort();for(const n of names){if(previous[n])Object.defineProperty(globalThis,n,previous[n]);else delete globalThis[n];}}
});
