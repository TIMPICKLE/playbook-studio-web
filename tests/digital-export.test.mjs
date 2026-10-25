import test from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { starterWorkspace } from '../web/model.js';
import { fieldSVG, updateAnimation } from '../web/field.js';
import { composeDigitalExport, pngExportDescription } from '../web/digital-export.js';

function fixture(time=0) {
  const win=new Window(),doc=win.document,play=starterWorkspace().plays[0];
  doc.body.innerHTML=fieldSVG(play,{}, {prefix:'export',time});
  const root=doc.querySelector('svg');updateAnimation(root,play,time,'export');
  return {win,doc,root,play};
}

test('full 3D PNG capture exports once without SVG geometry, styles or a second projection',()=>{
  const {root}=fixture(2);
  root.setAttribute('style','transform:matrix3d(1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1)');
  root.setAttribute('transform','translate(10 10)');
  const image='data:image/png;base64,iVBORw0KGgo=';
  const result=composeDigitalExport(root,{fullScene:true,image,time:2,decoration:'<g class="digital-decoration"><path d="M0 0L1 1"/></g>'});
  assert.equal(result,root);assert.equal(root.getAttribute('viewBox'),'0 0 1000 800');
  assert.equal(root.children.length,1,'only the rendered scene remains');
  const embedded=root.querySelector('image');
  assert.equal(embedded.getAttribute('href'),image);
  assert.equal(embedded.getAttribute('width'),'1000');assert.equal(embedded.getAttribute('height'),'800');
  assert.equal(embedded.getAttribute('transform'),null);
  for(const name of ['class','style','transform'])assert.equal(root.getAttribute(name),null);
  assert.equal(root.querySelector('[data-digital-projection],.player-label,[data-route],.digital-decoration,defs'),null);
});

test('compatibility PNG retains current playback positions, passing path, markers and feedback as a flat diagram',()=>{
  const {root}=fixture(2.5);
  const positions=[...root.querySelectorAll('[data-player]')].map(node=>node.getAttribute('transform'));
  const routes=[...root.querySelectorAll('.route-stroke')].map(node=>node.getAttribute('d'));
  const ball=root.querySelector('#export-ball').getAttribute('transform'),defs=root.querySelector('defs');
  composeDigitalExport(root,{fullScene:false,image:null,time:2.5,decoration:'<g class="digital-decoration"><circle cx="18" cy="20" r="3"/></g>'});
  assert.deepEqual([...root.querySelectorAll('[data-player]')].map(node=>node.getAttribute('transform')),positions);
  assert.deepEqual([...root.querySelectorAll('.route-stroke')].map(node=>node.getAttribute('d')),routes);
  assert.equal(root.querySelector('#export-ball').getAttribute('transform'),ball);
  assert.ok(root.querySelector('.digital-decoration circle'));
  assert.equal(root.querySelector('[data-digital-projection],image[data-digital-scene]'),null);
  assert.equal(root.querySelector('#export-players').parentElement,root);
  assert.equal(defs.parentElement,root);
  for(const label of root.querySelectorAll('.player-label'))assert.equal(label.getAttribute('transform'),null);
  for(const path of root.querySelectorAll('.route-stroke')){
    const id=path.getAttribute('marker-end').slice(5,-1);assert.ok(defs.querySelector(`[id="${id}"]`));
  }
});

test('missing complete-scene image or incomplete material capture cannot erase flat fallback players',()=>{
  for(const capture of [{fullScene:true,image:null},{fullScene:false,image:'data:image/png;base64,AAAA'}]){
    const {root}=fixture();const count=root.querySelectorAll('[data-player]').length;
    composeDigitalExport(root,capture);
    assert.equal(root.querySelectorAll('[data-player]').length,count);
    assert.equal(root.querySelector('image'),null);
    for(const body of root.querySelectorAll('.player-body'))assert.equal(body.getAttribute('opacity'),null);
  }
});

test('PNG export descriptions distinguish rendered 3D, vector compatibility, traditional and reference images',()=>{
  assert.equal(pngExportDescription({digital:true,ready:true}),'2000 × 1600 · 当前 3D 视图');
  assert.equal(pngExportDescription({digital:true,ready:false}),'2000 × 1600 · 兼容视图导出平面图');
  assert.equal(pngExportDescription(), '2000 × 1600 · 平面战术图');
  assert.equal(pngExportDescription({reference:true,digital:true,ready:true}),'2000 × 1120 · 原图分辨率');
});
