import test from 'node:test';
import assert from 'node:assert/strict';
import { makePlay } from '../web/model.js';
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
    return change.play.routes.find(r => r.id === change.routeIds[0]).blockTargets[0];
  });
  assert.deepEqual(targets, ['left-d','right-d','front-d']);
  const ids = ['LT','LG','C','RG','RT'].map(label => pick(input,label).id);
  assert.equal(buildAssistantEdit(input, [], [{kind:'block',playerIds:ids,scheme:'zone',direction:'left'}]).routeIds.length, 5);
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
