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
