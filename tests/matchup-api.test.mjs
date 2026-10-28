import test from 'node:test';
import assert from 'node:assert/strict';
import { database } from './helpers/db.mjs';
import { handleApi } from '../server/api.mjs';
import { buildMatchup, modelEndpoint, segmentHitsZone } from '../server/matchup.mjs';
import { starterWorkspace } from '../web/model.js';

const owner = { userId:'coach', email:'coach@example.com', displayName:'Coach' };
const viewer = { userId:'player', email:'player@example.com', displayName:'Player' };
const outsider = { userId:'outsider', email:'outside@example.com', displayName:'Outside' };
async function call(db, path, user = owner, body, env = {}) {
  const res = await handleApi(new Request(`https://playbook.test/api${path}`, { method: body === undefined ? 'GET' : 'POST', headers:{ Origin:'https://playbook.test', ...(body === undefined ? {} : {'Content-Type':'application/json'}) }, ...(body === undefined ? {} : { body:JSON.stringify(body) }) }), { DB:db, ...env }, user);
  return { status:res.status, body:await res.json() };
}
async function setup(t) {
  const db=database(t), created=await call(db,'/workspaces',owner,{title:'Test team'});
  assert.equal(created.status,201);
  const record=created.body;
  db.sql.prepare('INSERT INTO users(id,email,name,created_at) VALUES(?,?,?,?)').run(viewer.userId,viewer.email,viewer.displayName,Date.now());
  db.sql.prepare('INSERT INTO members(workspace_id,user_id,role,joined_at) VALUES(?,?,?,?)').run(record.id,viewer.userId,'viewer',Date.now());
  const off=record.data.plays.find(p=>p.book==='offense'), def=record.data.plays.find(p=>p.book==='defense');
  const body={offensePlayId:off.id,defensePlayId:def.id,revision:record.revision,coverage:'unknown',mode:'real_football',consent:true,model:{provider:'deepseek',model:'test-model',apiKey:'fake-test-key'}};
  return {db,record,off,def,body,path:`/workspaces/${record.id}/matchup-analysis`};
}
function goodResult(routeId) { return { summary:'观察同侧覆盖。',scenarios:[{title:'情景 A',condition:'如果防守者向外移动',observation:'关注同侧浅层',possibility:'内侧可能出现空间',action:'依球队规则阅读',limitations:'时序未知',evidenceIds:[routeId]}],missingInfo:['防守责任'] }; }
function modelResponse(data, status=200) { return new Response(JSON.stringify(data), {status,headers:{'Content-Type':'application/json'}}); }
function contextTool() { return modelResponse({choices:[{message:{content:null,tool_calls:[{id:'call_context',type:'function',function:{name:'get_matchup_context',arguments:'{}'}}]}}]}); }
function stubFetch(t, fn) { const previous=globalThis.fetch;globalThis.fetch=fn;t.after(()=>{globalThis.fetch=previous;}); }

test('geometry is segment based and does not invent simultaneous arrival',()=>{
  const zone={x:0,y:0,rx:2,ry:1};
  assert.equal(segmentHitsZone({x:-5,y:0},{x:5,y:0},zone),true);
  assert.equal(segmentHitsZone({x:-5,y:1},{x:5,y:1},zone),true);
  assert.equal(segmentHitsZone({x:-5,y:2},{x:5,y:2},zone),false);
  assert.equal(segmentHitsZone({x:0,y:0},{x:0,y:0},zone),true);
});

test('mirroring is consistent with the original coordinates and never mutates the saved play',()=>{
  const data=starterWorkspace(),off=data.plays.find(p=>p.book==='offense'),def=data.plays.find(p=>p.book==='defense');
  const before=JSON.stringify(def), view=buildMatchup(off,def,{mirrorDefense:true});
  assert.equal(view.defense.players[0].x,100-def.players[0].x);
  assert.equal(view.defense.zones[0].x,100-def.zones[0].x);
  assert.equal(JSON.stringify(def),before);
  assert.match(view.warnings.join(' '),/镜像/);
});

test('endpoint restrictions prevent the service becoming an open proxy',()=>{
  assert.equal(modelEndpoint({provider:'deepseek',model:'model',apiKey:'abc'}).endpoint,'https://api.deepseek.com/chat/completions');
  assert.equal(modelEndpoint({provider:'custom',baseUrl:'https://models.example/v1',model:'model',apiKey:'abc'},{AI_ALLOWED_HOSTS:'models.example'}).endpoint,'https://models.example/v1/chat/completions');
  for(const baseUrl of ['http://models.example/v1','https://user:pass@models.example/v1','https://127.0.0.1/v1','https://models.example/v1?key=abc','https://not-allowed.example/v1']) assert.throws(()=>modelEndpoint({provider:'custom',baseUrl,model:'model',apiKey:'abc'},{AI_ALLOWED_HOSTS:'models.example,127.0.0.1'}));
});

test('analysis uses authorized snapshots, minimizes sent data and rejects stale, unconsented or unauthorized requests',async t=>{
  const {db,record,off,body,path}=await setup(t);let count=0,sent;
  // Sensitive details must not be sent by default.
  const data=JSON.parse(db.sql.prepare('SELECT data_json FROM workspaces WHERE id=?').get(record.id).data_json);
  data.plays[0].players[0].name='SECRET PLAYER NAME';data.plays[0].notes='SECRET PLAY NOTES';
  db.sql.prepare('UPDATE workspaces SET data_json=? WHERE id=?').run(JSON.stringify(data),record.id);
  const routeId=`offense:route:${off.routes[0].id}`;
  stubFetch(t,async(url,opts)=>{count++;assert.equal(url,'https://api.deepseek.com/chat/completions');assert.equal(opts.redirect,'manual');sent=JSON.parse(opts.body);if(sent.messages.length===2)return contextTool();return modelResponse({choices:[{message:{content:JSON.stringify(goodResult(routeId))}}]});});
  assert.equal((await call(db,path,outsider,body)).status,404);
  assert.equal((await call(db,path,viewer,{...body,consent:false})).status,400);
  assert.equal((await call(db,path,viewer,{...body,revision:2})).status,409);
  assert.equal(count,0);
  const result=await call(db,path,viewer,body);
  assert.equal(result.status,200);assert.equal(count,2);assert.equal(result.body.scenarios[0].evidenceIds[0],routeId);
  assert.ok(result.body.evidence.some(x=>x.id===routeId));assert.match(result.body.warnings.join(' '),/时序/);
  const payload=sent.messages.find(message=>message.role==='tool').content;
  assert.doesNotMatch(payload,/SECRET PLAYER NAME|SECRET PLAY NOTES|fake-test-key|duration/);
  assert.equal(sent.model,'test-model');assert.equal(sent.stream,false);
  const withNotes=await call(db,path,viewer,{...body,includeNotes:true});assert.equal(withNotes.status,200);assert.match(sent.messages.find(message=>message.role==='tool').content,/SECRET PLAY NOTES/);
});

test('model errors and invented evidence are not leaked as successful output',async t=>{
  const {db,body,path}=await setup(t);let response;
  stubFetch(t,async(_url,opts)=>{const messages=JSON.parse(opts.body).messages;if(response.status!==401&&messages.length===2)return contextTool();return response.clone();});
  response=modelResponse({error:{message:'SECRET raw provider message'}},401);
  let result=await call(db,path,owner,body);assert.equal(result.status,502);assert.doesNotMatch(JSON.stringify(result.body),/SECRET|fake-test-key/);
  response=modelResponse({choices:[{message:{content:JSON.stringify(goodResult('offense:route:invented'))}}]});
  result=await call(db,path,owner,body);assert.equal(result.status,502);assert.match(result.body.error,/不存在/);
  response=modelResponse({choices:[{message:{content:'not json'}}]});
  result=await call(db,path,owner,body);assert.equal(result.status,502);assert.match(result.body.error,/格式/);
});

test('permission revocation and revision changes during the model call prevent delivery',async t=>{
  const {db,record,off,body,path}=await setup(t);
  const response=()=>modelResponse({choices:[{message:{content:JSON.stringify(goodResult(`offense:route:${off.routes[0].id}`))}}]});
  let calls=0;
  stubFetch(t,async(_url,opts)=>{calls++;const messages=JSON.parse(opts.body).messages;if(messages.length===2){assert.doesNotMatch(JSON.stringify(messages),new RegExp(off.id));db.sql.prepare('DELETE FROM members WHERE workspace_id=? AND user_id=?').run(record.id,viewer.userId);return contextTool();}return response();});
  assert.equal((await call(db,path,viewer,body)).status,404);
  assert.equal(calls,1,'revoked member data must not be sent to the second model call');
  globalThis.fetch=async(_url,opts)=>{const messages=JSON.parse(opts.body).messages;if(messages.length===2){db.sql.prepare('UPDATE workspaces SET revision=revision+1 WHERE id=?').run(record.id);return contextTool();}return response();};
  const stale=await call(db,path,owner,body);assert.equal(stale.status,409);assert.equal(stale.body.code,'revision_conflict');
});

test('analysis calls are bounded per user and do not persist API credentials',async t=>{
  const {db,off,body,path}=await setup(t);let count=0;
  stubFetch(t,async(_url,opts)=>{count++;if(JSON.parse(opts.body).messages.length===2)return contextTool();return modelResponse({choices:[{message:{content:JSON.stringify(goodResult(`offense:route:${off.routes[0].id}`))}}]});});
  for(let i=0;i<12;i++)assert.equal((await call(db,path,owner,body)).status,200);
  assert.equal((await call(db,path,owner,body)).status,429);assert.equal(count,24);
  const stored=db.sql.prepare('SELECT key,started_at,attempts FROM auth_throttles').all();assert.doesNotMatch(JSON.stringify(stored),/fake-test-key/);
});
