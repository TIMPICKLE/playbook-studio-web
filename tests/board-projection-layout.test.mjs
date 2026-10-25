import test from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { readFileSync } from 'node:fs';
import { createBoardLayout, boardSizeControls } from '../web/board-layout.js';
import { projectBoardPoint } from '../web/digital-projection.js';

test('perspective stage zoom keeps its fitted dimensions and rectangular scroll footprint', async t => {
  const win = new Window({width:1440,height:1000});
  const doc = win.document;
  const names = ['window','document','localStorage'];
  const previous = Object.fromEntries(names.map(name => [name,Object.getOwnPropertyDescriptor(globalThis,name)]));
  for (const name of names) Object.defineProperty(globalThis,name,{configurable:true,value:name === 'window' ? win : name === 'document' ? doc : win.localStorage});
  doc.documentElement.dataset.visualMode = 'digital';
  doc.head.innerHTML = `<style>${['board-layout.css','visual-mode.css'].map(file=>readFileSync(new URL(`../web/${file}`,import.meta.url),'utf8')).join('\n')}</style>`;
  doc.body.innerHTML = `<div class="workspace"><div class="editor-layout">${boardSizeControls()}<div class="pitch-viewport"><div class="pitch-stage"><svg class="pitch-svg"></svg></div></div></div></div>`;
  const workspace = doc.querySelector('.workspace'), viewport = doc.querySelector('.pitch-viewport');
  // Only layout metrics need a stand-in; use the real stylesheets for mode
  // padding, custom-property width, stage aspect ratio and SVG sizing.
  Object.defineProperties(viewport,{clientWidth:{value:700},clientHeight:{value:580}});
  const nativeComputedStyle=win.getComputedStyle.bind(win);
  // happy-dom retains stale descendant computed styles after an ancestor's
  // mode/class changes. Fresh copies resolve the actual current CSS rules.
  const computed=selector=>{
    const copy=workspace.cloneNode(true);doc.body.append(copy);
    const style=nativeComputedStyle(copy.querySelector(selector));
    const result=Object.fromEntries(['width','height','aspectRatio','flexShrink','transform','paddingTop','paddingRight','paddingBottom','paddingLeft'].map(key=>[key,style[key]]));
    copy.remove();return result;
  };
  win.getComputedStyle=node=>node===viewport?computed('.pitch-viewport'):nativeComputedStyle(node);
  const width = () => parseFloat(workspace.style.getPropertyValue('--pitch-width'));
  const zoom = action => doc.querySelector(`[data-board-action="${action}"]`).click();
  const changeMode = value => {doc.documentElement.dataset.visualMode=value;doc.dispatchEvent(new win.Event('playbook:effects-changed'));};
  function assertStage(expectedWidth,ratio=1.25) {
    const style=computed('.pitch-stage'), parts=style.aspectRatio.split('/').map(Number);
    assert.equal(parseFloat(style.width),expectedWidth,'stage follows the current zoom width');
    assert.equal(parts[0]/parts[1],ratio,'stage retains the correct board aspect ratio');
    assert.equal(style.flexShrink,'0','large stages must scroll rather than shrink');
    assert.ok(!style.transform || style.transform==='none','the stage itself is not projected into negative scroll space');
    const svgStyle=computed('.pitch-svg');
    assert.equal(svgStyle.width,'100%');assert.equal(svgStyle.height,'100%');
  }
  try {
    const layout = createBoardLayout();layout.mount();
    const base = Math.min(700-24,(580-24)*1.25);
    await t.test('100% through 300% retains width, aspect ratio and fixed 12px padding', () => {
      for (let step=0;step<=8;step++) {
        if (step) zoom('zoom-in');
        const expected = Math.floor(base*(1+step*.25));
        assert.equal(width(),expected);
        assertStage(expected);
        for(const side of ['Top','Right','Bottom','Left'])assert.equal(win.getComputedStyle(viewport)[`padding${side}`],'12px');
        for(let repeat=0;repeat<3;repeat++){layout.mount();assert.equal(width(),expected,'repeated sizing must not shrink the board');}
      }
      assert.equal(doc.querySelector('[data-board-action="zoom-in"]').disabled,true);
    });
    await t.test('return to 100% exactly restores original fit', () => {
      for(let step=7;step>=0;step--){zoom('zoom-out');assert.equal(width(),Math.floor(base*(1+step*.25)));}
      assert.equal(width(),Math.floor(base));assertStage(Math.floor(base));
      assert.equal(doc.querySelector('[data-board-action="zoom-out"]').disabled,true);
    });
    await t.test('changing modes and reference images does not inherit digital padding or the wrong aspect ratio', () => {
      zoom('zoom-in');zoom('zoom-in');
      changeMode('traditional');assert.equal(width(),1050);assertStage(1050);
      assert.ok(!parseFloat(win.getComputedStyle(viewport).paddingLeft));
      changeMode('digital');assert.equal(width(),Math.floor(base*1.5));assertStage(Math.floor(base*1.5));
      workspace.classList.add('reference-play');layout.mount();assert.equal(width(),1050,'reference images remain rectangular');assertStage(1050,1000/560);
      assert.ok(!parseFloat(win.getComputedStyle(viewport).paddingLeft));
      workspace.classList.remove('reference-play');layout.mount();assert.equal(width(),Math.floor(base*1.5));
      zoom('fit');assert.equal(width(),Math.floor(base));assertStage(Math.floor(base));
    });
    await t.test('all four projected field corners remain inside the untransformed stage', () => {
      for(const x of [0,1000])for(const y of [0,800]){
        const p=projectBoardPoint(x,y);
        assert.ok(p&&p.x>=0&&p.x<=1000&&p.y>=0&&p.y<=800,`projected corner ${x},${y} must be reachable`);
      }
    });
  } finally {
    await win.happyDOM.abort();
    for(const name of names){if(previous[name])Object.defineProperty(globalThis,name,previous[name]);else delete globalThis[name];}
  }
});
