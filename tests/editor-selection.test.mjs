import test from 'node:test';
import assert from 'node:assert/strict';
import { makePlay, validatePlay, History } from '../web/model.js';
import { selectedPlayerIds, playerSelection, togglePlayerSelection, moveSelectedPlayers, removeSelectedPlayers } from '../web/editor-selection.js';

function diagram() {
  const play = makePlay({formation:'Gun Trips'});
  play.players = play.players.slice(0,3);
  for (const [i,player] of play.players.entries()) Object.assign(player,{x:[20,60,80][i],y:[70,70,40][i]});
  const [a,b,c] = play.players;
  play.ball.holderId=a.id;play.ball.receiverId=b.id;
  const route=(id,owner,kind,points,extra={})=>({id,playerId:owner.id,kind,points,color:owner.color,smooth:false,endCap:'arrow',delay:0,duration:1,optional:false,...extra});
  play.routes = [
    route('motion',a,'motion',[{x:20,y:70},{x:30,y:70}]),
    route('post-motion',a,'route',[{x:30,y:70},{x:30,y:30}],{delay:1,intent:{concept:'go',depthYards:20}}),
    route('wide',b,'route',[{x:60,y:70},{x:95,y:50}]),
    route('block',c,'block',[{x:80,y:40},{x:20,y:70}],{blockTargets:[a.id],endCap:'bar'}),
  ];
  validatePlay(play);
  return play;
}

test('additive selection toggles real players and collapses to the legacy single-object shape',()=>{
  const play=diagram(),[a,b]=play.players;
  let selection=togglePlayerSelection(play,null,a.id);
  assert.deepEqual(selection,{type:'player',id:a.id});
  selection=togglePlayerSelection(play,selection,b.id,{additive:true});
  assert.deepEqual(selection,{type:'players',ids:[a.id,b.id]});
  assert.deepEqual(selectedPlayerIds(play,selection),[a.id,b.id]);
  assert.deepEqual(togglePlayerSelection(play,selection,a.id,{additive:true}),{type:'player',id:b.id});
  assert.equal(togglePlayerSelection(play,{type:'player',id:b.id},b.id,{additive:true}),null);
  assert.deepEqual(playerSelection(play,[a.id,a.id,'gone']),{type:'player',id:a.id});
  assert.deepEqual(togglePlayerSelection(play,selection,'gone',{additive:true}),selection);
  assert.deepEqual(selectedPlayerIds(play,{type:'route',id:'wide'}),[]);
});

test('a group move clamps one shared delta and keeps motion, routes and teammate spacing intact',()=>{
  const play=diagram(),original=structuredClone(play),[a,b,c]=play.players;
  const moved=moveSelectedPlayers(play,[a.id,b.id,a.id],20,-5);
  assert.deepEqual(moved.delta,{x:5,y:-5});
  assert.deepEqual(moved.ids,[a.id,b.id]);
  assert.equal(moved.changed,true);
  assert.deepEqual(play,original);
  assert.equal(moved.play.players[1].x-moved.play.players[0].x,b.x-a.x);
  assert.deepEqual(moved.play.players[2],c);
  for (const route of original.routes.filter(route=>route.playerId!==c.id)) {
    assert.deepEqual(moved.play.routes.find(item=>item.id===route.id).points,route.points.map(point=>({x:point.x+5,y:point.y-5})));
  }
  assert.deepEqual(moved.play.routes.find(route=>route.id==='post-motion').points[0],moved.play.routes.find(route=>route.id==='motion').points.at(-1));
  assert.equal(moved.play.routes.find(route=>route.id==='post-motion').intent,undefined);
  assert.deepEqual(moved.play.routes.find(route=>route.id==='block'),original.routes.find(route=>route.id==='block'));
  validatePlay(moved.play);
});

test('one group edit restores all geometry in one history transaction',()=>{
  const play=diagram(),state={data:{plays:[play]},selectedId:play.id},history=new History();
  const moved=moveSelectedPlayers(play,play.players.slice(0,2).map(player=>player.id),-5,-5);
  history.record(state);
  const edited={...state,data:{plays:[moved.play]}};
  assert.deepEqual(history.undo(edited),state);
  assert.equal(history.past.length,0);
  assert.deepEqual(history.redo(state),edited);
});

test('group deletion cleans holder, receiver, owned routes and foreign blocking references atomically',()=>{
  const play=diagram(),original=structuredClone(play),[a,b,c]=play.players;
  const removed=removeSelectedPlayers(play,[a.id,b.id]);
  assert.deepEqual(play,original);
  assert.deepEqual(removed.play.players,[c]);
  assert.deepEqual(removed.play.routes.map(route=>route.id),['block']);
  assert.deepEqual(removed.play.routes[0].blockTargets,[null]);
  assert.equal(removed.play.ball.holderId,c.id);
  assert.equal(removed.play.ball.receiverId,'');
  validatePlay(removed.play);
});

test('stale, invalid, read-only reference and delete-all requests do not produce partial edits',()=>{
  const play=diagram(),before=structuredClone(play),ids=play.players.map(player=>player.id);
  assert.throws(()=>moveSelectedPlayers(play,[ids[0],'gone'],1,1),/no longer/);
  assert.throws(()=>moveSelectedPlayers(play,[ids[0]],NaN,1),/finite/);
  assert.throws(()=>removeSelectedPlayers(play,[ids[0],'gone']),/no longer/);
  assert.throws(()=>removeSelectedPlayers(play,ids),/at least one/);
  assert.throws(()=>moveSelectedPlayers({...play,reference:{}},ids,1,1),/reference/);
  assert.deepEqual(play,before);
  assert.equal(moveSelectedPlayers(play,[],1,1).changed,false);
  assert.equal(removeSelectedPlayers(play,[]).changed,false);
  assert.equal(moveSelectedPlayers(play,ids,0,0).play,play);
});
