import test from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { starterWorkspace } from '../web/model.js';
import { createMatchupView, resolveHandoffContext } from '../web/ai-matchup.js';

test('an explicit full defense title is selected only when it has one match', () => {
  const defense=[{id:'c2',title:'Cover 2 Press',book:'defense'}, {id:'c3',title:'Cover 3 Buzz',book:'defense'}];
  assert.equal(resolveHandoffContext(defense,{instruction:'How do we beat Cover 3 Buzz?'}).defensePlayId,'c3');
  assert.equal(resolveHandoffContext([...defense,{id:'other',title:'Cover 3 Buzz',book:'defense'}],{instruction:'Cover 3 Buzz'}).defensePlayId,undefined);
  assert.equal(resolveHandoffContext(defense,{instruction:'How do we beat Cover 3?'}).defensePlayId,undefined);
});

test('handoff preserves the original question, coverage and selected opposing play', async () => {
  const win = new Window({url:'https://test.local/local.html#analysis'});
  const previous = Object.getOwnPropertyDescriptor(globalThis,'document');
  Object.defineProperty(globalThis,'document',{configurable:true,value:win.document});
  win.document.body.innerHTML='<div id="analysis"></div>';
  const data=starterWorkspace(), play=data.plays.find(play=>play.book==='offense'), defense=data.plays.find(play=>play.book==='defense');
  const view=createMatchupView({root:win.document.querySelector('#analysis'),request:async()=>({}),getCurrent:()=>({id:'b',revision:1}),getData:()=>data,isDirty:()=>false});
  try {
    view.selectPlay(play,{instruction:'How does this attack their Cover 2?',coverage:'cover2',defensePlayId:defense.id});
    view.show(true);
    assert.equal(win.document.querySelector('[data-ai-field="offense"]').value,play.id);
    assert.equal(win.document.querySelector('[data-ai-field="defense"]').value,defense.id);
    assert.equal(win.document.querySelector('[data-ai-field="coverage"]').value,'cover2');
    assert.equal(win.document.querySelector('[data-ai-field="context"]').value,'How does this attack their Cover 2?');
  } finally {
    view.show(false);
    if(previous)Object.defineProperty(globalThis,'document',previous);else delete globalThis.document;
    await win.happyDOM.abort();
  }
});
