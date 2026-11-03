import test from 'node:test';
import assert from 'node:assert/strict';
import { animatedPlayer, clone, decodeWorkspace, encodeWorkspace, formationPlayers, History, starterWorkspace } from '../web/model.js';
import { fieldSVG } from '../web/field.js';
import { assistantPlayers, buildAssistantEdit, resolveBoardPlayer } from '../web/assistant-edit.js';

function fixture() {
  const data = starterWorkspace();
  const play = data.plays[0];
  play.players.push(...formationPlayers('4–3'));
  const lb = play.players.find(p => p.label === 'M');
  data.roster.push({id:'lb-87', name:'张三', number:'87', position:'MLB'});
  lb.rosterId = 'lb-87';
  const actor = play.players.find(p => p.label === 'C');
  const dt = play.players.find(p => p.label === 'DT');
  return {data,play,actor,dt,lb};
}

test('two resolved contacts render on the board, hold during rehearsal, and survive save/undo', () => {
  const {data,play,actor,dt,lb} = fixture();
  const before = clone(play);
  const markers = assistantPlayers(play,data.roster);
  const first = resolveBoardPlayer(markers,{role:'DT',side:'defense',relativeToId:actor.id,relation:'in_front'});
  const second = resolveBoardPlayer(markers,{role:'LB',name:'张三'});
  assert.equal(first.status,'found');
  assert.equal(first.candidates[0].id,dt.id);
  assert.equal(second.status,'found');
  assert.equal(second.candidates[0].id,lb.id);
  const op = {kind:'block',playerId:actor.id,targetIds:[first.candidates[0].id,second.candidates[0].id]};
  const result = buildAssistantEdit(play,data.roster,op);
  assert.deepEqual(play,before);
  assert.match(result.summary,/DT.*张三/);
  assert.equal(assistantPlayers(play,data.roster).find(p => p.id === lb.id).number,'87');
  const route = result.play.routes.find(r => r.id === result.routeId);
  assert.equal(route.points.length,3);
  assert.deepEqual(animatedPlayer(result.play,actor,route.duration*.40),route.points[1]);
  assert.deepEqual(animatedPlayer(result.play,actor,route.duration*.49),route.points[1]);
  assert.notDeepEqual(animatedPlayer(result.play,actor,route.duration*.65),route.points[1]);
  assert.deepEqual(animatedPlayer(result.play,actor,route.duration),route.points[2]);
  assert.match(fieldSVG(result.play),/marker-mid="url\(#pitch-r\d+-bar\)"/);
  const history = new History();
  history.record(data);
  data.plays[0] = result.play;
  assert.equal(decodeWorkspace(encodeWorkspace(data)).plays[0].routes.find(r => r.id === route.id).stagedBlock,true);
  assert.deepEqual(history.undo(data).plays[0],before);
});

test('unqualified duplicate DT or unknown named LB prompts clarification without mutations', () => {
  const {data,play,actor,dt,lb} = fixture();
  const before = clone(play);
  const markers = assistantPlayers(play,data.roster);
  assert.equal(resolveBoardPlayer(markers,{role:'DT'}).status,'ambiguous');
  assert.equal(resolveBoardPlayer(markers,{role:'LB',name:'王五'}).status,'missing');
  assert.equal(resolveBoardPlayer(markers,{number:'87',role:'LB'}).candidates[0].id,lb.id);
  assert.equal(resolveBoardPlayer(markers,{relation:'in_front'}).status,'invalid');
  const aligned = markers.map(p => p.label === 'DT' ? {...p, x:50} : p);
  assert.equal(resolveBoardPlayer(aligned,{role:'DT',relation:'in_front',relativeToId:actor.id}).status,'ambiguous');
  for (const targetIds of [[actor.id],['invented'],[dt.id,dt.id],[]]) {
    assert.throws(()=>buildAssistantEdit(play,data.roster,{kind:'block',playerId:actor.id,targetIds}));
  }
  assert.deepEqual(play,before);
});

test('AI route edits keep other assignments, options, timing, and reject invalid coordinates', () => {
  const {data,play} = fixture();
  const owner = play.players.find(p => p.label === 'Y');
  const old = play.routes.find(r => r.playerId === owner.id);
  const op = {kind:'route',playerId:owner.id,points:[{x:40,y:35},{x:24,y:35}]};
  const {play: edited} = buildAssistantEdit(play,data.roster,op);
  const route = edited.routes.find(r => r.playerId === owner.id);
  assert.equal(route.id,old.id);
  assert.equal(route.delay,old.delay);
  assert.equal(route.duration,old.duration);
  assert.deepEqual(route.points.slice(1),op.points);
  assert.deepEqual(edited.routes.filter(r=>r.playerId!==owner.id),play.routes.filter(r=>r.playerId!==owner.id));
  assert.deepEqual(edited.ball,play.ball);
  assert.throws(()=>buildAssistantEdit(play,data.roster,{...op,points:[{x:-1,y:NaN}]}));
  assert.throws(()=>buildAssistantEdit({...play,reference:{}},data.roster,op));
});
