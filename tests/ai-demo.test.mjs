import test from 'node:test';
import assert from 'node:assert/strict';
import { starterWorkspace } from '../web/model.js';
import { createDemoRequest } from '../web/ai-demo.js';

const makeBody = data => ({locale:'en', offensePlayId:data.plays.find(p=>p.book==='offense').id, defensePlayId:data.plays.find(p=>p.book==='defense').id, coverage:'unknown', mode:'real_football', context:'third down', mirrorDefense:true, includeNotes:false, model:{provider:'openrouter',model:'test-model',apiKey:'test-secret'}});
const analysis = {summary:'Sample',scenarios:[{title:'If zone',condition:'if',observation:'watch',possibility:'possible',action:'consider',limitations:'unknown'}],missingInfo:['timing']};

test('demo sends selected anonymized diagrams directly and normalizes the result', async () => {
  const data=starterWorkspace(), body=makeBody(data); let captured;
  data.plays[0].players[0].name='PRIVATE PLAYER NAME';
  const request=createDemoRequest(()=>data, async (url, options)=>{captured={url,options};return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(analysis)}}]}));});
  const result=await request('/ignored',{body});
  assert.equal(captured.url,'https://openrouter.ai/api/v1/chat/completions');
  assert.equal(captured.options.headers.Authorization,'Bearer test-secret');
  const payload=JSON.parse(captured.options.body), tactical=JSON.parse(payload.messages[1].content);
  assert.equal(tactical.offense.title,data.plays[0].title);
  assert.equal(tactical.defense.players[0].x,100-data.plays.find(p=>p.book==='defense').players[0].x);
  assert.doesNotMatch(captured.options.body,/PRIVATE PLAYER NAME|test-secret|QB：/);
  assert.equal(result.scenarios[0].title,'If zone'); assert.deepEqual(result.scenarios[0].evidenceIds,[]);
  assert.match(result.warnings[0],/single model request/);
});

test('demo reports provider, CORS, malformed response and cancellation failures', async () => {
  const data=starterWorkspace(), body=makeBody(data);
  const bad=createDemoRequest(()=>data,async()=>new Response('secret provider details',{status:401}));
  await assert.rejects(bad('',{body}),error=>/HTTP 401/.test(error.message)&&!/secret provider details/.test(error.message));
  const cors=createDemoRequest(()=>data,async()=>{throw new TypeError('Failed to fetch');});
  await assert.rejects(cors('',{body}),/CORS/);
  const malformed=createDemoRequest(()=>data,async()=>new Response(JSON.stringify({choices:[{message:{content:'not JSON'}}]})));
  await assert.rejects(malformed('',{body}),/usable analysis/);
  const nullScenario=createDemoRequest(()=>data,async()=>new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({scenarios:[null]})}}]})));
  await assert.rejects(nullScenario('',{body}),/missing required scenario fields/);
  const controller=new AbortController();controller.abort();
  const canceled=createDemoRequest(()=>data,async()=>{throw new DOMException('aborted','AbortError');});
  await assert.rejects(canceled('',{body,signal:controller.signal}),{name:'AbortError'});
});
