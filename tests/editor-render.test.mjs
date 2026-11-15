import test from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { patchEditorHTML } from '../web/editor-render.js';

test('editor updates retain keyed cards and independently managed renderers',async()=>{
  const win=new Window(),doc=win.document;
  const cards=ids=>ids.map(id=>`<button class="play-card" data-action="choose:${id}"><div class="play-thumb" data-thumbnail-index="${ids.indexOf(id)}"></div><strong>${id}</strong></button>`).join('');
  doc.body.innerHTML=`<div id="app"><div class="play-list">${cards(['a','b','c'])}</div><div id="field"><div class="pitch-stage"><svg></svg><canvas></canvas></div><div class="board-ai"><textarea>Unsent prompt</textarea></div></div></div>`;
  const root=doc.querySelector('#app'),list=doc.querySelector('.play-list'),b=list.children[1],c=list.children[2];
  const stage=doc.querySelector('.pitch-stage'),svg=stage.firstElementChild,canvas=stage.lastElementChild,ai=doc.querySelector('.board-ai');
  const thumb=b.querySelector('.play-thumb');thumb.innerHTML='<svg><defs><marker id="stable-marker"></marker></defs></svg>';
  const thumbnail=thumb.firstElementChild;
  try {
    patchEditorHTML(root,`<div class="play-list">${cards(['c','b'])}</div><div id="field"><div class="pitch-stage"></div></div>`);
    assert.ok(doc.querySelector('.play-list')===list);
    assert.ok(list.children[0]===c && list.children[1]===b,'stable actions distinguish cards with identical classes');
    assert.ok(thumb.firstElementChild===thumbnail,'the thumbnail renderer keeps its subtree');
    assert.ok(doc.querySelector('.pitch-stage')===stage && stage.firstElementChild===svg && stage.lastElementChild===canvas);
    assert.ok(doc.querySelector('.board-ai')===ai);
    assert.equal(ai.querySelector('textarea').value,'Unsent prompt');
    patchEditorHTML(list,cards(['new','c','b']));
    assert.ok(list.children[1]===c && list.children[2]===b);
    assert.equal(b.querySelector('.play-thumb').dataset.thumbnailIndex,'2','retained thumbnail indices follow the current list');
    assert.equal(list.children.length,3);
  } finally { await win.happyDOM.abort(); }
});

test('editor forms keep focused text and caret while model-controlled states remain current',async()=>{
  const win=new Window(),doc=win.document;
  doc.body.innerHTML='<aside class="inspector" data-context="play:a"><label><input data-prop="title" value="Original"></label><select data-prop="kind"><option value="route" selected>Route</option><option value="block">Block</option></select><input data-prop="smooth" type="checkbox" checked><button data-action="save">Save</button></aside>';
  const root=doc.querySelector('.inspector'),title=doc.querySelector('[data-prop="title"]'),kind=doc.querySelector('select');
  const html=(blocked,choice)=>`<aside class="inspector" data-context="play:a"><label><input data-prop="title" value="Saved" ${blocked?'disabled':''}></label><select data-prop="kind"><option value="route" ${choice==='route'?'selected':''}>Route</option><option value="block" ${choice==='block'?'selected':''}>Block</option></select><input data-prop="smooth" type="checkbox"><button data-action="save" ${blocked?'disabled':''}>Save</button></aside>`;
  try {
    title.focus();title.value='Uncommitted typing';title.setSelectionRange(2,8);
    patchEditorHTML(doc.body,html(false,'block'));
    assert.ok(doc.querySelector('.inspector')===root && doc.querySelector('[data-prop="title"]')===title);
    assert.ok(doc.activeElement===title);assert.equal(title.value,'Uncommitted typing');
    assert.equal(title.selectionStart,2);assert.equal(title.selectionEnd,8);
    assert.ok(doc.querySelector('select')===kind);assert.equal(kind.value,'block');
    assert.equal(doc.querySelector('[data-prop="smooth"]').checked,false);
    doc.querySelector('button').focus();
    patchEditorHTML(doc.body,html(true,'route'));
    assert.equal(title.value,'Saved');assert.equal(kind.value,'route');assert.equal(title.disabled,true);
    patchEditorHTML(doc.body,html(false,'block'));
    assert.equal(title.disabled,false);assert.equal(doc.querySelector('button').disabled,false);
    assert.equal(kind.value,'block');
  } finally { await win.happyDOM.abort(); }
});
