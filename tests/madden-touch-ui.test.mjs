import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Window } from 'happy-dom';
import { createMaddenLibrary } from '../web/madden.js';

const catalog=JSON.parse(readFileSync(new URL('../web/data/huddle-catalog.json',import.meta.url)));
test('touch library traps navigation, exposes preview close and follows keyboard height', async () => {
  const win=new Window({url:'https://playbook.test/local.html',width:390,height:844});
  win.document.body.innerHTML='<button id="opener">Library</button><div id="madden-root" hidden></div><button id="outside">Outside</button>';
  const viewport=new win.EventTarget();viewport.height=844;
  Object.defineProperty(win,'visualViewport',{configurable:true,value:viewport});
  const names=['window','document','fetch'], previous=Object.fromEntries(names.map(name=>[name,Object.getOwnPropertyDescriptor(globalThis,name)]));
  Object.defineProperty(globalThis,'window',{configurable:true,value:win});
  Object.defineProperty(globalThis,'document',{configurable:true,value:win.document});
  Object.defineProperty(globalThis,'fetch',{configurable:true,value:async()=>new Response(JSON.stringify(catalog))});
  const q=selector=>win.document.querySelector(selector);
  try {
    const library=createMaddenLibrary({canEdit:()=>true,getPlays:()=>[],onImport:()=>({ok:true}),notify:()=>{}});
    q('#opener').focus();await library.open();
    assert.equal(q('.madden-panel').getAttribute('aria-modal'),'true');
    const last=q('.madden-footer a');last.focus();
    const tab=new win.KeyboardEvent('keydown',{key:'Tab',bubbles:true,cancelable:true});last.dispatchEvent(tab);
    assert.equal(tab.defaultPrevented,true);assert.equal(win.document.activeElement,q('[data-madden=close]'));
    viewport.height=350;viewport.dispatchEvent(new win.Event('resize'));
    const panel=q('.madden-panel');panel.scrollTop=475;
    q('.madden-card [data-madden=preview]').click();
    assert.equal(panel.scrollTop,0);
    q('.madden-detail [data-madden=back]').click();
    assert.equal(panel.scrollTop,475);
    q('.madden-card [data-madden=preview]').click();
    assert.equal(panel.scrollTop,0);
    q('.madden-detail [data-madden=back]').dispatchEvent(new win.KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));
    assert.equal(panel.scrollTop,475);
    q('.madden-card [data-madden=preview]').click();
    assert.equal(panel.scrollTop,0);
    const previewClose=q('.madden-detail [data-madden=close]');assert.ok(previewClose);
    const previewLast=q('.madden-detail>a');previewLast.focus();
    previewLast.dispatchEvent(new win.KeyboardEvent('keydown',{key:'Tab',bubbles:true,cancelable:true}));
    assert.equal(win.document.activeElement,q('.madden-detail [data-madden=back]'));
    viewport.height=350;viewport.dispatchEvent(new win.Event('resize'));
    assert.equal(q('#madden-root').classList.contains('madden-short'),true);
    win.happyDOM.setWindowSize({width:1366,height:1024});
    win.matchMedia=query=>({matches:query==='(any-pointer: coarse)'});
    win.dispatchEvent(new win.Event('resize'));
    assert.equal(panel.getAttribute('aria-modal'),'true');
    previewClose.click();assert.equal(q('#madden-root').hidden,true);assert.equal(win.document.activeElement,q('#opener'));
  } finally {
    await win.happyDOM.abort();
    for(const name of names){if(previous[name])Object.defineProperty(globalThis,name,previous[name]);else delete globalThis[name];}
  }
});
