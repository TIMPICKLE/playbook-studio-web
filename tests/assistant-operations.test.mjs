import test from 'node:test';
import assert from 'node:assert/strict';
import { dynamicBlockRoute, makePlay, validatePlay } from '../web/model.js';
import { buildAssistantEdit } from '../web/assistant-edit.js';

const play = () => makePlay({formation:'Gun Trips'});
const pick = (p,label) => p.players.find(x => x.label === label);

test('operation groups create a motion followed by a measured dig in one atomic edit', () => {
  const input = play(), z = pick(input,'Z'), old = JSON.stringify(input);
  const {play: edited} = buildAssistantEdit(input,[],[
    {kind:'motion',playerId:z.id,type:'jet',toward:'left'},
    {kind:'route',playerId:z.id,concept:'dig',depthYards:12,breakTo:'inside'},
  ]);
  assert.equal(JSON.stringify(input),old);
  const motion = edited.routes.find(r=>r.playerId===z.id && r.kind==='motion');
  const route = edited.routes.find(r=>r.playerId===z.id && r.kind==='route');
  assert.deepEqual(route.points[0],motion.points.at(-1));
  assert.equal(route.points[1].y,43);
  assert.ok(route.points[2].x < route.points[1].x);
  assert.ok(route.delay >= motion.delay + motion.duration);
});

test('invalid later operation leaves original play and its existing routes intact', () => {
  const input=play(), x=pick(input,'X'), before=JSON.stringify(input);
  assert.throws(()=>buildAssistantEdit(input,[],[
    {kind:'route',playerId:x.id,concept:'go',depthYards:12},
    {kind:'timing',playerId:x.id,delay:1,duration:-1},
  ]));
  assert.equal(JSON.stringify(input),before);
});

test('group blocking creates five assignments and retains named targets', () => {
  const input=play();
  input.players.push({id:'dt',label:'DT',name:'',x:50,y:58,side:'defense',shape:'circle',color:'#c4a5f5'});
  const ids=['LT','LG','C','RG','RT'].map(label=>pick(input,label).id);
  const {play: edited}=buildAssistantEdit(input,[],[{kind:'block',playerIds:ids,scheme:'zone',direction:'left'}]);
  const blocks=edited.routes.filter(r=>r.kind==='block');
  assert.equal(blocks.length,5);
  assert.equal(blocks.filter(r=>r.blockTargets?.[0]==='dt').length,1);
  assert.ok(blocks.every(r=>r.points.length===2));
});

test('pass, annotation and zones use existing editable play model', () => {
  const input=play(), y=pick(input,'Y');
  const {play:edited}=buildAssistantEdit(input,[],[
    {kind:'pass',receiverId:y.id,throwAt:2.5,arriveAt:3.5},
    {kind:'annotate',nearId:y.id,text:'first read'},
    {kind:'zone',preset:'deep_third',side:'left'},
  ]);
  assert.equal(edited.ball.receiverId,y.id);
  assert.equal(edited.ball.passAt,2.5);
  assert.equal(edited.zones.length,1);
  assert.equal(edited.annotations[0].text,'first read');
});

test('motion types produce distinct paths and keep post-motion routes anchored', () => {
  const input = play(), z = pick(input, 'Z');
  const paths = ['jet', 'orbit', 'across', 'shift'].map(type => {
    const result = buildAssistantEdit(input, [], [
      {kind:'motion', playerId:z.id, type, toward:'left'},
      {kind:'route', playerId:z.id, concept:'post', depthYards:12},
    ]);
    const motion = result.play.routes.find(r => r.playerId === z.id && r.kind === 'motion');
    const route = result.play.routes.find(r => r.playerId === z.id && r.kind === 'route');
    assert.deepEqual(route.points[0], motion.points.at(-1));
    assert.ok(route.delay >= motion.delay + motion.duration);
    return JSON.stringify(motion.points);
  });
  assert.equal(new Set(paths).size, 4);
});

test('blocking schemes choose distinct geometric assignments and return every changed route', () => {
  const input = play(), c = pick(input, 'C');
  input.players.push(
    {id:'left-d',label:'DL',name:'',x:c.x - 5,y:c.y - 5,side:'defense',shape:'circle',color:'#c4a5f5'},
    {id:'right-d',label:'DL',name:'',x:c.x + 5,y:c.y - 5,side:'defense',shape:'circle',color:'#c4a5f5'},
    {id:'front-d',label:'DL',name:'',x:c.x,y:c.y - 5,side:'defense',shape:'circle',color:'#c4a5f5'},
  );
  const result = scheme => buildAssistantEdit(input, [], [{kind:'block',playerIds:[c.id],scheme,direction:'left'}]);
  const targets = ['zone','gap','pass_pro'].map(scheme => {
    const change = result(scheme);
    assert.equal(change.routeIds.length, 1);
    return change.play.routes.find(r => r.id === change.routeIds[0]).blockTargets.at(-1);
  });
  assert.deepEqual(targets, ['left-d','right-d','front-d']);
  const ids = ['LT','LG','C','RG','RT'].map(label => pick(input,label).id);
  assert.equal(buildAssistantEdit(input, [], [{kind:'block',playerIds:ids,scheme:'zone',direction:'left'}]).routeIds.length, 5);
});

test('pass protection takes a fixed setback before tracking a moving defender', () => {
  const input = play(), c = pick(input, 'C');
  const d = {id:'front-d',label:'DT',name:'',x:c.x,y:c.y - 8,side:'defense',shape:'circle',color:'#c4a5f5'};
  input.players.push(d);
  input.routes.push({id:'defender-route', playerId:d.id, kind:'route', color:d.color,
    points:[{x:d.x,y:d.y},{x:d.x+10,y:d.y}],delay:0,duration:4,smooth:false,endCap:'arrow',optional:false});
  const {play: edited} = buildAssistantEdit(input, [], [{kind:'block',playerIds:[c.id],scheme:'pass_pro',direction:'left'}]);
  const reloaded = validatePlay(JSON.parse(JSON.stringify(edited)));
  const block = reloaded.routes.find(r => r.playerId === c.id && r.kind === 'block');
  assert.deepEqual(block.blockTargets, [null, d.id]);
  assert.ok(block.points[1].y > block.points[0].y);
  assert.ok(!block.stagedBlock);
  const before = dynamicBlockRoute(reloaded, block, 0), after = dynamicBlockRoute(reloaded, block, 4);
  assert.deepEqual(before.points[1], after.points[1]);
  assert.notDeepEqual(before.points[2], after.points[2]);
});

test('adding, replacing and removing motion translates all following route points', () => {
  const input = play(), c = pick(input, 'C');
  const route = buildAssistantEdit(input, [], [{kind:'route',playerId:c.id,points:[{x:c.x+5,y:c.y-4},{x:c.x+9,y:c.y-8}]}]);
  const original = route.play.routes.find(r => r.id === route.routeId);
  const added = buildAssistantEdit(route.play, [], [{kind:'motion',playerId:c.id,type:'shift',toward:'left'}]);
  const motion = added.play.routes.find(r => r.playerId === c.id && r.kind === 'motion');
  const after = added.play.routes.find(r => r.id === route.routeId);
  const dx = motion.points.at(-1).x - c.x, dy = motion.points.at(-1).y - c.y;
  for (let i = 0; i < original.points.length; i++) {
    assert.equal(after.points[i].x, original.points[i].x + dx);
    assert.equal(after.points[i].y, original.points[i].y + dy);
  }
  assert.equal(after.delay, original.delay + motion.duration);
  const replaced = buildAssistantEdit(added.play, [], [{kind:'motion',playerId:c.id,type:'shift',toward:'right'}]);
  const replacement = replaced.play.routes.find(r => r.id === motion.id);
  const newRoute = replaced.play.routes.find(r => r.id === route.routeId);
  assert.deepEqual(newRoute.points[0], replacement.points.at(-1));
  assert.ok(Math.abs((newRoute.points[2].x - newRoute.points[0].x) - (original.points[2].x - original.points[0].x)) < 1e-9);
  const removed = buildAssistantEdit(replaced.play, [], [{kind:'remove_route',playerId:c.id,routeId:motion.id}]);
  const finalRoute = removed.play.routes.find(r => r.id === route.routeId);
  for (let i = 0; i < original.points.length; i++) {
    assert.ok(Math.abs(finalRoute.points[i].x - original.points[i].x) < 1e-9);
    assert.ok(Math.abs(finalRoute.points[i].y - original.points[i].y) < 1e-9);
  }
  assert.equal(finalRoute.delay, original.delay);
});

test('explicit route IDs target only the named player and preserve the requested route', () => {
  const input = play(), x = pick(input, 'X'), z = pick(input, 'Z');
  const first = buildAssistantEdit(input, [], [{kind:'route',playerId:x.id,concept:'go',depthYards:10}]);
  const routeId = first.routeId;
  const change = buildAssistantEdit(first.play, [], [{kind:'route',playerId:x.id,routeId,concept:'dig',depthYards:12}]);
  assert.equal(change.routeId, routeId);
  assert.deepEqual(change.routeIds, [routeId]);
  assert.equal(change.play.routes.find(r => r.id === routeId).points[1].y, 43);
  assert.throws(() => buildAssistantEdit(first.play, [], [{kind:'route',playerId:z.id,routeId,concept:'go',depthYards:12}]));
  assert.throws(() => buildAssistantEdit(first.play, [], [{kind:'timing',playerId:z.id,routeId,delay:1,duration:2}]));
});
