import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Window} from 'happy-dom';
import {STORAGE_KEY,encodeWorkspace,starterWorkspace} from '../web/model.js';

// Uses the actual editor host and panel coordinator. happy-dom does not paint
// CSS, so visibility assertions cover the DOM's hidden/inert ancestry and the
// body-level placement needed to escape a hidden compact inspector.
test('assistant stays reachable through compact mouse, touch, drawer and expanded-board layouts',{timeout:20000},async t=>{
  const win=new Window({url:'http://localhost:3000/local.html#editor',width:1440,height:1000});
  win.document.body.innerHTML=readFileSync(new URL('../web/index.html',import.meta.url),'utf8').split('<body>')[1].split('</body>')[0];
  win.localStorage.setItem(STORAGE_KEY,encodeWorkspace(starterWorkspace()));
  win.localStorage.setItem('playbook-studio:onboarding:v1',JSON.stringify({dismissed:true,completed:[]}));
  const names=['window','document','navigator','localStorage','location','history','Image','Blob','requestAnimationFrame','cancelAnimationFrame'];
  const previous=Object.fromEntries(names.map(name=>[name,Object.getOwnPropertyDescriptor(globalThis,name)]));
  for(const name of names)Object.defineProperty(globalThis,name,{configurable:true,value:['requestAnimationFrame','cancelAnimationFrame'].includes(name)?win[name].bind(win):win[name]});
  const media=new win.EventTarget();media.matches=false;
  const originalMatchMedia=win.matchMedia.bind(win);
  win.matchMedia=query=>query==='(any-pointer: coarse)'?media:originalMatchMedia(query);
  const q=selector=>win.document.querySelector(selector);
  const click=selector=>{const node=q(selector);assert.ok(node,selector);node.click();};
  const resize=(width,height,coarse=false)=>{
    if(media.matches!==coarse){media.matches=coarse;media.dispatchEvent(new win.Event('change'));}
    win.happyDOM.setWindowSize({width,height});win.dispatchEvent(new win.Event('resize'));
  };
  const visible=()=>{
    const root=q('.board-ai'),panel=q('.ba-panel');
    assert.ok(root?.isConnected);assert.equal(panel.hidden,false);
    assert.equal(root.closest('[hidden],[inert]'),null,'the open assistant has no hidden or inert ancestor');
    assert.equal(root.inert,false);
    assert.equal(win.document.body.classList.contains('compact-panel-open'),false,'a drawer must not hide the body-level assistant');
  };
  const retained=()=>{
    assert.equal(q('[data-ba-prompt]').value,'Keep my unsent route change');
    assert.equal(q('[data-ba-key]').value,'session-only-test-key');
  };
  const fromProperties=()=>{
    click('.compact-nav [data-action="inspector-panel"]');
    assert.equal(win.document.body.classList.contains('compact-panel-open'),true);
    assert.equal(q('.inspector-panel').inert,false);
    assert.equal(q('.inspector-panel').getAttribute('aria-modal'),'true');
    click('.task-panel-tabs [data-action="assistant-task"]');
    visible();assert.equal(q('.board-ai').parentElement,win.document.body);
    assert.equal(q('.inspector-panel').inert,true);
    assert.equal(q('.canvas-section').inert,false);
    assert.equal(q('.inspector-panel').hasAttribute('aria-modal'),false);
    retained();
  };
  try{
    await import(`../web/app.js?assistant-responsive-host=${Date.now()}`);
    const original=win.localStorage.getItem(STORAGE_KEY);
    await t.test('1440px desktop docks; expanded-board mode floats and returns without losing fields',()=>{
      click('[data-ba="open"]');visible();
      assert.equal(q('.board-ai').parentElement,q('.inspector-panel'));
      assert.equal(q('.board-ai').classList.contains('ba-task-panel'),true);
      assert.equal(q('.inspector').hidden,true);
      q('[data-ba-prompt]').value='Keep my unsent route change';
      click('[data-ba="settings"]');q('[data-ba-key]').value='session-only-test-key';click('[data-ba="done"]');
      q('.board-advanced').open=true;click('[data-board-action="expand"]');
      visible();assert.equal(q('.board-ai').parentElement,win.document.body);
      assert.equal(q('.board-ai').classList.contains('ba-floating'),true);
      assert.equal(q('.workspace').classList.contains('board-expanded'),true);retained();
      click('[data-board-action="expand"]');visible();
      assert.equal(q('.board-ai').parentElement,q('.inspector-panel'));retained();
    });
    await t.test('676px fine-pointer resize escapes the compact inspector; Properties to AI closes its drawer',()=>{
      resize(676,900);visible();retained();
      assert.equal(q('.board-ai').parentElement,win.document.body);
      assert.equal(q('.board-ai').classList.contains('ba-task-panel'),false);
      assert.equal(q('.board-ai').classList.contains('ba-docked'),false,'a compact mouse viewport uses the movable viewport window');
      click('[data-ba="close"]');assert.equal(q('.ba-panel').hidden,true);
      fromProperties();
      click('[data-ba="close"]');retained();
      assert.equal(q('.board-ai').parentElement,q('#field'));
      click('[data-ba="open"]');visible();retained();
    });
    await t.test('1024px coarse-pointer tablet uses a reachable sheet and dismisses the properties modal',()=>{
      resize(1024,1366,true);visible();retained();
      assert.equal(q('.board-ai').parentElement,win.document.body);
      assert.equal(q('.board-ai').classList.contains('ba-docked'),true);
      click('[data-ba="close"]');fromProperties();
      assert.equal(q('.board-ai').classList.contains('ba-docked'),true);
      click('[data-ba="close"]');retained();
      assert.equal(q('.canvas-section').inert,false);
      click('[data-ba="open"]');visible();retained();
    });
    await t.test('returning to desktop redocks automatically and never edits the playbook',()=>{
      resize(1440,1000,false);visible();retained();
      assert.equal(q('.board-ai').parentElement,q('.inspector-panel'));
      assert.equal(q('.board-ai').classList.contains('ba-task-panel'),true);
      assert.equal(q('.board-ai').classList.contains('ba-floating'),false);
      assert.equal(win.localStorage.getItem(STORAGE_KEY),original);
    });
  }finally{
    win.dispatchEvent(new win.Event('pagehide'));await win.happyDOM.abort();
    for(const name of names){if(previous[name])Object.defineProperty(globalThis,name,previous[name]);else delete globalThis[name];}
  }
});
