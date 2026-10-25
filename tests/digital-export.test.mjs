import test from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { starterWorkspace } from '../web/model.js';
import { fieldSVG } from '../web/field.js';
import { projectDigitalExport, DIGITAL_EXPORT_MATRIX as matrix } from '../web/digital-export.js';

test('digital PNG projection keeps routes, chip image, numbers and ball on the same board plane',()=>{
  const win=new Window(),doc=win.document;
  doc.body.innerHTML=fieldSVG(starterWorkspace().plays[0],{}, {prefix:'export'});
  const root=doc.querySelector('svg'),defs=root.querySelector('defs'),players=root.querySelector('#export-players'),ball=root.querySelector('#export-ball');
  const routes=[...root.querySelectorAll('[data-route]')],image=doc.createElementNS('http://www.w3.org/2000/svg','image');
  image.setAttribute('href','data:image/png;base64,AAAA');root.insertBefore(image,players);
  projectDigitalExport(root,{material:true});
  const plane=root.querySelector('[data-digital-projection]');
  assert.ok(plane);assert.equal(plane.getAttribute('transform'),'matrix(0.86 0 -0.1204 0.7396 118 78)');
  assert.equal(defs.parentElement,root,'marker IDs remain in the outer SVG definitions');
  for(const node of [players,ball,image,...routes])assert.equal(node.parentElement,plane);
  assert.equal(root.lastElementChild,plane,'field overlays the board edge and shadow');
  assert.equal(root.getAttribute('viewBox'),'0 0 1000 800');
  for(const label of players.querySelectorAll('.player-label'))assert.equal(label.getAttribute('transform'),'translate(0 -3.7)');
  for(const path of root.querySelectorAll('.route-stroke')){
    const id=path.getAttribute('marker-end').slice(5,-1);assert.ok(defs.querySelector(`[id="${id}"]`),'route end markers still resolve');
  }
});

test('projected board, side edge and shadow fit entirely within the PNG viewBox',()=>{
  for(const x of [0,1000])for(const y of [0,822]){
    const sx=matrix.a*x+matrix.c*y+matrix.e,sy=matrix.b*x+matrix.d*y+matrix.f;
    assert.ok(sx>=0&&sx<=1000,`horizontal extent ${sx}`);
    assert.ok(sy>=0&&sy<=800,`vertical extent ${sy}`);
  }
});

test('fallback flat chip labels keep their centered placement in the projected PNG',()=>{
  const win=new Window(),doc=win.document;
  doc.body.innerHTML=fieldSVG(starterWorkspace().plays[0],{}, {prefix:'export'});
  const root=doc.querySelector('svg');projectDigitalExport(root);
  assert.ok(root.querySelector('[data-digital-projection]'));
  for(const label of root.querySelectorAll('.player-label'))assert.equal(label.getAttribute('transform'),null);
});
