import test from 'node:test';
import assert from 'node:assert/strict';
import { makePlay, movePlayer, validatePlay } from '../web/model.js';
import { proposeEdit } from '../web/assistant-proposal.js';
import { proposalConflicts } from '../web/assistant-conflicts.js';
import { runEditorPlayCommand } from '../web/editor-play-commands.js';

const setup = () => {
  const play = makePlay({formation:'Gun Trips'});
  const actor = play.players.find(player => player.label === 'X');
  const operations = [{kind:'route',playerId:actor.id,concept:'dig',depthYards:12,breakTo:'inside'}];
  return {play,actor,operations,proposal:proposeEdit(play,operations)};
};

test('route intent survives play validation and serialization', () => {
  const {proposal} = setup();
  const saved = validatePlay(JSON.parse(JSON.stringify(proposal.play)));
  const route = saved.routes.find(route => route.id === proposal.routeId);
  assert.deepEqual(route.intent, {concept:'dig',depthYards:12,breakTo:'inside'});
  route.intent.depthYards = '12';
  assert.throws(() => validatePlay(saved));
});

test('manual player movement clears a route intent whose coordinates no longer express it', () => {
  const {actor,proposal}=setup();
  const route=proposal.play.routes.find(route=>route.id===proposal.routeId);
  movePlayer(proposal.play,actor.id,actor.x+1,actor.y);
  assert.equal(route.intent,undefined);
});

test('unrelated title and player edits can be rebased without losing them', () => {
  const {play,actor,operations,proposal} = setup();
  const current = structuredClone(play);
  current.title = 'New title';
  const other = current.players.find(player => player.id !== actor.id);
  other.x += 1;
  assert.equal(proposalConflicts(play,current,operations,proposal),false);
  const rebased = proposeEdit(current,operations);
  assert.equal(rebased.play.title,'New title');
  assert.equal(rebased.play.players.find(player=>player.id===other.id).x,other.x);
});

test('editing or deleting an involved player or route conflicts', () => {
  const {play,actor,operations,proposal} = setup();
  for (const mutate of [
    current => {current.players.find(player=>player.id===actor.id).x+=1;},
    current => {current.players=current.players.filter(player=>player.id!==actor.id);},
    current => {current.routes.push({...proposal.play.routes[0],id:'concurrent-route'});},
  ]) {
    const current=structuredClone(play); mutate(current);
    assert.equal(proposalConflicts(play,current,operations,proposal),true);
  }
});

test('a concurrent center shift conflicts with a center-relative route proposal', () => {
  const {play,operations,proposal} = setup();
  const current = structuredClone(play);
  current.players.find(player => player.label === 'C').x += 8;
  assert.equal(proposalConflicts(play,current,operations,proposal),true);
});

test('moving a referenced block target conflicts while unrelated defenders remain editable', () => {
  const {play,actor} = setup();
  const defender = {id:'dt',label:'DT',name:'',x:actor.x,y:55,side:'defense',shape:'circle',color:'#c4a5f5'};
  play.players.push(defender,{...defender,id:'cb',x:90});
  const operations=[{kind:'block',playerId:actor.id,targetIds:['dt']}];
  const proposal=proposeEdit(play,operations),current=structuredClone(play);
  current.players.find(player=>player.id==='cb').x-=1;
  assert.equal(proposalConflicts(play,current,operations,proposal),false);
  current.players.find(player=>player.id==='dt').y-=1;
  assert.equal(proposalConflicts(play,current,operations,proposal),true);
});

test('a pending opponent route conflicts when the home formation changes from flag to eleven players', () => {
  const before = makePlay({ count:5, formation:'Flag 5 Spread' });
  runEditorPlayCommand(before, {kind:'opponents_set', enabled:true});
  const rusher = before.players.find(player => player.side === 'defense' && player.label === 'R');
  const operations = [{kind:'route_add', playerId:rusher.id, routeKind:'route', points:[
    {x:rusher.x,y:rusher.y}, {x:rusher.x,y:rusher.y + 5},
  ]}];
  const proposal = proposeEdit(before, operations), current = structuredClone(before);
  runEditorPlayCommand(current, {kind:'formation_apply', formation:'Gun Doubles', count:11});
  assert.deepEqual(current.players.filter(player => player.side === 'defense'), before.players.filter(player => player.side === 'defense'), 'opponent IDs and positions remain unchanged');
  assert.equal(proposalConflicts(before,current,operations,proposal),true, 'the proposal was generated for a different game format');
});

test('explicit flag rules context is a dependency, while equivalent legacy metadata can be rebased', () => {
  const before = makePlay({count:5, formation:'Flag 5 Spread'});
  const actor = before.players.find(player => player.label === 'X');
  const operations = [{kind:'route', playerId:actor.id, concept:'go', depthYards:8}];
  const proposal = proposeEdit(before,operations), current = structuredClone(before);
  current.formation = 'Custom five-marker drill';
  delete current.league;
  assert.equal(proposalConflicts(before,current,operations,proposal),true, 'five markers alone do not establish flag rules');

  const oldPlay = makePlay(); delete oldPlay.league;
  const oldActor = oldPlay.players.find(player => player.label === 'X');
  const oldOperations = [{kind:'route',playerId:oldActor.id,concept:'go',depthYards:8}];
  const oldProposal = proposeEdit(oldPlay,oldOperations), enriched = structuredClone(oldPlay);
  enriched.league = 11; enriched.title = 'Renamed legacy play';
  assert.equal(proposalConflicts(oldPlay,enriched,oldOperations,oldProposal),false, 'adding equivalent format metadata does not block an otherwise unrelated rebase');
});
