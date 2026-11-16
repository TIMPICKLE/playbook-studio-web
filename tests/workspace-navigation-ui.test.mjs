import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Window } from 'happy-dom';

test('module navigation never intercepts ordinary editor clicks or steals a form caret', async () => {
  const win = new Window({url:'http://localhost:3000/local.html#editor',width:1440,height:900});
  win.localStorage.setItem('playbook-studio:onboarding:v1',JSON.stringify({dismissed:true,completed:[]}));
  win.document.body.innerHTML = readFileSync(new URL('../web/index.html',import.meta.url),'utf8').split('<body>')[1].split('</body>')[0];
  const names = ['window','document','navigator','localStorage','location','history','Image','Blob','requestAnimationFrame','cancelAnimationFrame'];
  const previous = Object.fromEntries(names.map(name => [name,Object.getOwnPropertyDescriptor(globalThis,name)]));
  for (const name of names) Object.defineProperty(globalThis,name,{configurable:true,value:['requestAnimationFrame','cancelAnimationFrame'].includes(name) ? win[name].bind(win) : win[name]});
  const doc = win.document, q = selector => doc.querySelector(selector);
  const originalRect=win.HTMLElement.prototype.getBoundingClientRect;
  win.HTMLElement.prototype.getBoundingClientRect=function(){
    if(this.id==='field') {const top=q('#ai-matchup-root')?.hidden===false?2000:100;return {x:0,y:top,top,left:0,right:1000,bottom:top+500,width:1000,height:500};}
    return originalRect.call(this);
  };
  try {
    await import(`../web/app.js?navigation-regression=${Date.now()}`);
    assert.equal(doc.body.dataset.workspaceMode,'editor');
    const navigation=q('#workspace-navigation');
    for(const selector of ['#app','#ai-matchup-root','#roster-root'])assert.ok(navigation.compareDocumentPosition(q(selector)) & win.Node.DOCUMENT_POSITION_FOLLOWING,'module navigation precedes every work surface in reading and keyboard order');
    const notes = q('[data-prop="notes"]'), field = q('#field'), svg = q('#field .pitch-svg');
    notes.focus(); notes.value = 'Keep this draft and its caret'; notes.setSelectionRange(5,15);
    const event = new win.MouseEvent('click',{bubbles:true,cancelable:true});
    q('[data-action="favorite"]').dispatchEvent(event);
    assert.equal(event.defaultPrevented,false,'an editor command is not a module-navigation event');
    assert.equal(doc.activeElement,notes,'a status/header update must not blur an active form');
    assert.equal(notes.value,'Keep this draft and its caret');
    assert.equal(notes.selectionStart,5); assert.equal(notes.selectionEnd,15);
    assert.equal(q('#field'),field); assert.equal(q('#field .pitch-svg'),svg);
    assert.equal(win.location.hash,'#editor');
    q('.workspace-nav button[data-workspace-mode="roster"]').click();
    assert.equal(doc.body.dataset.workspaceMode,'roster');
    assert.equal(q('#app').hidden,true); assert.equal(q('#roster-root').hidden,false);
    q('.workspace-nav button[data-workspace-mode="editor"]').click();
    assert.equal(doc.body.dataset.workspaceMode,'editor');
    assert.equal(q('#app').hidden,false); assert.equal(q('#roster-root').hidden,true);
    q('.workspace-nav button[data-workspace-mode="analysis"]').click();
    assert.equal(q('#ai-matchup-root').hidden,false);
    q('.workspace-nav button[data-workspace-mode="editor"]').click();
    assert.equal(q('#ai-matchup-root').hidden,true);
    assert.ok(parseInt(q('.workspace').style.getPropertyValue('--board-height'),10)>280,'the report is hidden before the editor measures the available viewport');
  } finally {
    win.dispatchEvent(new win.Event('pagehide')); await win.happyDOM.abort();
    for (const name of names) { if (previous[name]) Object.defineProperty(globalThis,name,previous[name]); else delete globalThis[name]; }
  }
});
