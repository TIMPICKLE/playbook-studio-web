import test from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { starterWorkspace } from '../web/model.js';
import { createTrainingAuthor } from '../web/training-author.js';

function setup(t, makeField) {
  const win = new Window(), root = win.document.body, book = starterWorkspace();
  t.after(()=>win.happyDOM.abort());
  const state={editable:true,workspaceId:'book1',saved:[],back:[]};
  const view=createTrainingAuthor({root,makeField,getData:()=>book,canEdit:()=>state.editable,getWorkspaceId:()=>state.workspaceId,
    onSave:drill=>{state.saved.push(drill);book.drills=[drill];},onBack:args=>state.back.push(args)});
  const q = selector=>root.querySelector(selector);
  const ready = async () => {
    for (let i=0;i<100 && q('[data-ta="accept"]').disabled;i++) await new Promise(resolve=>setTimeout(resolve,15));
    assert.equal(q('[data-ta="accept"]').disabled,false,q('.ta-preview-status').textContent);
  };
  const click = (cmd)=>q(`[data-ta="${cmd}"]`).click();
  const set = (name,value)=>{
    const el=q(`[name="${name}"]`); assert.ok(el, name);
    el.value=value; el.dispatchEvent(new win.Event(el.tagName==='SELECT'?'change':'input',{bubbles:true}));
  };
  const offensive=book.plays.find(p=>p.book==='offense'), defensive=book.plays.find(p=>p.book==='defense');
  function compose(){
    view.open({playId:offensive.id});
    set('defensePlayId',defensive.id);
    set('question','Who threatens the inside?');set('explanation','Check the defender over the guard.');set('title','Read the front');
    q('.ta-picks [data-marker]').click();
  }
  return {state,book,view,q,click,set,offensive,defensive,compose,ready};
}

test('a coach pairs editable plays, checks the learner view and publishes a marker-specific answer',async t=>{
  const {view,q,click,state,compose,ready}=setup(t);
  compose(); assert.equal(view.isDirty(),true);
  const id=q('.ta-picks [data-marker][aria-pressed="true"]').dataset.marker;
  assert.ok(id.startsWith('d:'));
  click('publish');
  assert.equal(state.saved.length,0);
  assert.equal(q('dialog').open,true); await ready();click('field');
  const neutral=q(`[data-training-marker="${id}"]`);
  assert.equal(neutral.getAttribute('aria-pressed'),'false');
  neutral.dispatchEvent(new neutral.ownerDocument.defaultView.Event('click',{bubbles:true}));
  click('reveal'); assert.match(q('.ta-preview-status').textContent,/Check the defender/);
  await ready();click('accept');click('publish'); await Promise.resolve();
  assert.equal(state.saved[0].status,'published');assert.deepEqual(state.saved[0].targetIds,[id]);assert.equal(view.isDirty(),false);
});

test('preview acceptance is invalidated by a changed question and sources, and drafts need no answer',async t=>{
  const {view,q,click,set,state,compose,offensive,ready}=setup(t);
  compose();click('preview');await ready();click('accept');
  set('question','Identify the edge threat.');click('publish');
  assert.equal(state.saved.length,0);assert.equal(q('dialog').open,true);
  click('close-preview');click('draft');await Promise.resolve();
  assert.equal(state.saved[0].status,'draft');assert.equal(state.saved[0].revision,0);
  view.open({playId:offensive.id});click('draft');await Promise.resolve();
  assert.deepEqual(state.saved[1].targetIds,[]);
});

test('changed permissions, workspace or concurrent drill edits cannot write over a coach draft',async t=>{
  const {view,q,click,state,book,compose}=setup(t);
  compose();state.editable=false;click('draft');assert.equal(state.saved.length,0);
  state.editable=true;state.workspaceId='other';click('draft');assert.equal(state.saved.length,0);
  state.workspaceId='book1';click('draft');await Promise.resolve();
  view.open({drillId:state.saved[0].id});book.drills[0].title='Another editor';click('draft');
  assert.equal(state.saved.length,1);assert.ok(q('[data-ta-error]').textContent);
  state.editable=false;view.open();assert.equal(q('[data-ta="publish"]'),null);
});

test('coaches publish equivalent answer sets, and preview grades the alternative without revealing the primary',async t=>{
  const {state,q,click,compose,ready}=setup(t);
  compose(); const main=q('.ta-picks [data-marker][aria-pressed="true"]').dataset.marker;
  click('add-set');
  const alternate=[...q('.ta-picks [data-marker]').parentElement.querySelectorAll('[data-marker]')].find(b=>b.dataset.marker!==main);
  alternate.click();
  click('publish');await ready();click('field');
  const picked=q(`[data-training-marker="${alternate.dataset.marker}"]`);
  picked.dispatchEvent(new picked.ownerDocument.defaultView.Event('click',{bubbles:true}));
  click('reveal');assert.match(q('.ta-preview-status').textContent,/选择正确|Correct selection/);
  const primary=q(`[data-training-marker="${main}"]`);
  assert.equal(primary.querySelectorAll('circle')[1].getAttribute('stroke'),'none');
  click('accept');click('publish');await Promise.resolve();
  assert.deepEqual(state.saved[0].alternativeTargetIds,[[alternate.dataset.marker]]);
});

test('an obscured main answer blocks publication unless a complete equivalent read is visible',async t=>{
  let visible=[];
  const {q,click,compose,state}=setup(t, ({onModeChange})=>({
    supportsPOV:true, setState:()=>onModeChange('pov'), getReachableIds:()=>visible, destroy(){},
  }));
  compose();const main=q('.ta-picks [data-marker][aria-pressed="true"]').dataset.marker;
  click('publish');assert.equal(q('[data-ta="accept"]').disabled,true);click('close-preview');
  click('add-set');
  const other=[...q('.ta-picks [data-marker]').parentElement.querySelectorAll('[data-marker]')].find(b=>b.dataset.marker!==main);
  other.click();visible=[other.dataset.marker];
  click('publish');assert.equal(q('[data-ta="accept"]').disabled,false);
  click('accept');click('publish');await Promise.resolve();
  assert.equal(state.saved[0].status,'published');
});
