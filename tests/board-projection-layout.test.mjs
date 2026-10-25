import test from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { createBoardLayout, boardSizeControls } from '../web/board-layout.js';

test('projected board zoom reserves reachable corners without feeding gutters back into scale', async t => {
  const win = new Window({width:1440,height:1000});
  const doc = win.document;
  const names = ['window','document','localStorage'];
  const previous = Object.fromEntries(names.map(name => [name,Object.getOwnPropertyDescriptor(globalThis,name)]));
  for (const name of names) Object.defineProperty(globalThis,name,{configurable:true,value:name === 'window' ? win : name === 'document' ? doc : win.localStorage});
  doc.documentElement.dataset.visualMode = 'digital';
  doc.body.innerHTML = `<div class="workspace"><div class="editor-layout">${boardSizeControls()}<div class="pitch-viewport"></div></div></div>`;
  const workspace = doc.querySelector('.workspace'), viewport = doc.querySelector('.pitch-viewport');
  Object.defineProperties(viewport,{clientWidth:{value:700},clientHeight:{value:580}});
  const getComputedStyle = win.getComputedStyle.bind(win);
  // happy-dom has no CSS layout. Resolve the actual dynamically enlarged gutter
  // like the browser does, so reading last frame's padding would expose drift.
  win.getComputedStyle = node => {
    if (node !== viewport) return getComputedStyle(node);
    const projected = doc.documentElement.dataset.visualMode === 'digital' && !workspace.classList.contains('reference-play');
    const gutter = projected ? workspace.style.getPropertyValue('--pitch-gutter') || '49px' : '0px';
    return {paddingLeft:gutter,paddingRight:gutter,paddingTop:projected?'24px':'0px',paddingBottom:projected?'46px':'0px'};
  };
  const width = () => parseFloat(workspace.style.getPropertyValue('--pitch-width'));
  const gutter = () => parseFloat(workspace.style.getPropertyValue('--pitch-gutter'));
  const zoom = action => doc.querySelector(`[data-board-action="${action}"]`).click();
  const changeMode = value => {doc.documentElement.dataset.visualMode=value;doc.dispatchEvent(new win.Event('playbook:effects-changed'));};
  try {
    const layout = createBoardLayout();layout.mount();
    const base = Math.min(700*.86,(580-24-46)*1.25);
    await t.test('100% through 300% retains scale and at least 12px beyond the leftmost projected corner', () => {
      for (let step=0;step<=8;step++) {
        if (step) zoom('zoom-in');
        const expected = Math.floor(base*(1+step*.25));
        assert.equal(width(),expected);
        assert.ok(gutter()-.056*width()>=12,`left corner is reachable at ${(1+step*.25)*100}%`);
        for(let repeat=0;repeat<3;repeat++){layout.mount();assert.equal(width(),expected,'repeated sizing must not shrink the board');}
      }
      assert.equal(doc.querySelector('[data-board-action="zoom-in"]').disabled,true);
    });
    await t.test('return to 100% exactly restores original fit', () => {
      for(let step=7;step>=0;step--){zoom('zoom-out');assert.equal(width(),Math.floor(base*(1+step*.25)));}
      assert.equal(width(),Math.floor(base));assert.ok(Math.abs(gutter()-49)<1e-9);
      assert.equal(doc.querySelector('[data-board-action="zoom-out"]').disabled,true);
    });
    await t.test('changing modes recomputes fit without inheriting the digital gutter', () => {
      zoom('zoom-in');zoom('zoom-in');
      changeMode('traditional');assert.equal(width(),1050);
      changeMode('digital');assert.equal(width(),Math.floor(base*1.5));
      workspace.classList.add('reference-play');layout.mount();assert.equal(width(),1050,'reference images remain rectangular');
      workspace.classList.remove('reference-play');layout.mount();assert.equal(width(),Math.floor(base*1.5));
      zoom('fit');assert.equal(width(),Math.floor(base));
    });
  } finally {
    await win.happyDOM.abort();
    for(const name of names){if(previous[name])Object.defineProperty(globalThis,name,previous[name]);else delete globalThis[name];}
  }
});
