import test from 'node:test';
import assert from 'node:assert/strict';
import { starterWorkspace } from '../web/model.js';
import { buildMatchup } from '../server/matchup.mjs';
import { runMatchupAgent } from '../server/matchup-agent.mjs';

const secret = 'protocol-test-key';
function fixture() {
  const data = starterWorkspace();
  return buildMatchup(data.plays.find(play => play.book === 'offense'), data.plays.find(play => play.book === 'defense'), {coverage:'cover3_spot'});
}
const report = id => JSON.stringify({summary:'Conditional reads',scenarios:[1,2].map(n => ({title:`Read ${n}`,condition:'If the flat defender widens',observation:'Watch the flat defender',possibility:'An inside window may develop',action:'Confirm the team rule',limitations:'Timing and help are unknown',evidenceIds:[id]})),missingInfo:[]});
const call = (id,name,args={}) => ({id,type:'function',function:{name,arguments:JSON.stringify(args)}});
const outputCall = tool => ({type:'function_call',id:'item_'+tool.id,call_id:tool.id,name:tool.function.name,arguments:tool.function.arguments,status:'completed'});
const outputText = text => ({type:'message',id:'final_message',role:'assistant',status:'completed',content:[{type:'output_text',text,annotations:[]}]});
const thinking = {type:'thinking',thinking:'private-thinking',signature:'private-signature'};
const reasoning = {type:'reasoning',id:'reasoning_1',summary:[],encrypted_content:'private-encrypted-reasoning'};

function completion(protocol, {calls=[],text='',reason=false}={}) {
  if (protocol === 'anthropic') return Response.json({type:'message',role:'assistant',stop_reason:calls.length?'tool_use':'end_turn',usage:{input_tokens:10,output_tokens:5},content:[...(reason?[thinking]:[]),...calls.map(tool=>({type:'tool_use',id:tool.id,name:tool.function.name,input:JSON.parse(tool.function.arguments)})),...(text?[{type:'text',text}]:[])]});
  if (protocol === 'responses') return Response.json({id:'response_test',object:'response',status:'completed',usage:{input_tokens:10,output_tokens:5},output:[...(reason?[reasoning]:[]),...calls.map(outputCall),...(text?[outputText(text)]:[])]});
  return Response.json({choices:[{finish_reason:calls.length?'tool_calls':'stop',message:{role:'assistant',content:text||null,...(calls.length?{tool_calls:calls}:{})}}],usage:{prompt_tokens:10,completion_tokens:5}});
}
const config = protocol => ({provider:protocol==='anthropic'?'anthropic':'openai',protocol,model:'test-model',apiKey:secret});
const run = (matchup, protocol, extra={}) => runMatchupAgent(matchup,{model:config(protocol),...extra},{},new AbortController().signal);

test('all three model protocols complete actual matchup tool rounds with correct continuation and private usage', async t => {
  for (const protocol of ['openai','anthropic','responses']) await t.test(protocol,async t => {
    const matchup=fixture(),route=matchup.offense.routes.find(route=>route.kind==='route'),requests=[];
    t.mock.method(globalThis,'fetch',async (url,options) => {
      const payload=JSON.parse(options.body);requests.push(payload);
      assert.equal(options.redirect,'manual');
      assert.doesNotMatch(options.body,new RegExp(secret));
      if(protocol==='anthropic') {
        assert.equal(url,'https://api.anthropic.com/v1/messages');
        assert.equal(options.headers['x-api-key'],secret);
        assert.equal(options.headers.Authorization,undefined);
        assert.equal(payload.system.includes('美式橄榄球'),true);
        if(requests.length===1) {assert.equal(payload.tools.length,1);assert.deepEqual(payload.tool_choice,{type:'auto'});}
      } else {
        assert.equal(url,`https://api.openai.com/v1/${protocol==='responses'?'responses':'chat/completions'}`);
        assert.equal(options.headers.Authorization,'Bearer '+secret);
        assert.equal(options.headers['x-api-key'],undefined);
      }
      if(protocol==='responses') {
        assert.equal(payload.messages,undefined);
        assert.equal(payload.max_output_tokens,3500);
        assert.equal(payload.max_tokens,undefined);
        assert.equal(payload.store,false);
        assert.ok(payload.tools.every(tool=>tool.type==='function' && tool.name && tool.function===undefined));
        if(requests.length===1) assert.deepEqual(payload.tool_choice,{type:'function',name:'get_matchup_context'});
      }
      if(requests.length===1) return completion(protocol,{calls:[call('ctx','get_matchup_context')],reason:true});
      if(requests.length===2) return completion(protocol,{calls:[call('route','inspect_route_coverage',{routeId:route.id}),call('rule','read_coverage_rule')]});
      return completion(protocol,{text:report(route.id)});
    });
    const result=await run(matchup,protocol);
    assert.equal(requests.length,3);
    assert.equal(result.execution.modelCalls,3);
    assert.equal(result.execution.toolCalls,3);
    assert.deepEqual(result.execution.toolsUsed,['get_matchup_context','inspect_route_coverage','read_coverage_rule']);
    assert.deepEqual(result.execution.usage,{inputTokens:30,outputTokens:15});
    assert.equal(result.scenarios[0].evidenceIds[0],route.id);
    assert.doesNotMatch(JSON.stringify(result),/private-thinking|private-signature|private-encrypted-reasoning|protocol-test-key/);
    if(protocol==='responses') {
      assert.deepEqual(requests[1].input.find(item=>item.type==='reasoning'),reasoning);
      assert.deepEqual(requests[2].input.filter(item=>item.type==='function_call_output').map(item=>item.call_id),['ctx','route','rule']);
      assert.equal(requests[2].tool_choice,'none');
      assert.ok(JSON.parse(requests[1].input.find(item=>item.type==='function_call_output').output).matchup);
    } else if(protocol==='anthropic') {
      assert.deepEqual(requests[1].messages[1].content[0],thinking);
      assert.deepEqual(requests[2].messages.at(-1).content.map(item=>item.tool_use_id),['route','rule']);
      assert.deepEqual(requests[2].tool_choice,{type:'none'});
    } else assert.deepEqual(requests[2].messages.filter(item=>item.role==='tool').map(item=>item.tool_call_id),['ctx','route','rule']);
  });
});

test('Responses JSON repair preserves raw prior output and requires grounded citations',async t => {
  const matchup=fixture(),id=matchup.evidence[0].id,requests=[];
  const malformed=JSON.parse(report(id));malformed.scenarios[1].evidenceIds=['offense:route:invented'];
  t.mock.method(globalThis,'fetch',async (_url,options) => {
    const payload=JSON.parse(options.body);requests.push(payload);
    if(requests.length===1) return completion('responses',{calls:[call('ctx','get_matchup_context')],reason:true});
    if(requests.length===2) return completion('responses',{text:JSON.stringify(malformed)});
    assert.equal(payload.tool_choice,'none');
    assert.ok(payload.input.some(item=>item.type==='message'&&item.role==='assistant'&&item.content.some(block=>block.type==='output_text'&&block.text.includes('invented'))));
    assert.ok(payload.input.some(item=>item.role==='user'&&JSON.stringify(item.content).includes('保留每个情景中有效的 evidenceIds')));
    return completion('responses',{text:report(id)});
  });
  const result=await run(matchup,'responses');
  assert.equal(result.execution.repaired,true);
  assert.equal(result.execution.modelCalls,3);
  assert.ok(result.scenarios.every(scenario=>scenario.evidenceIds.includes(id)));
});

test('Anthropic Messages repairs invalid citations without dropping signed thinking or tool results',async t => {
  const matchup=fixture(),id=matchup.evidence[0].id;let requests=0;
  const invalid=JSON.parse(report(id));invalid.scenarios[1].evidenceIds=['defense:zone:invented'];
  t.mock.method(globalThis,'fetch',async(_url,options)=>{
    const payload=JSON.parse(options.body);
    if(++requests===1) return completion('anthropic',{calls:[call('ctx','get_matchup_context')],reason:true});
    if(requests===2) return completion('anthropic',{text:JSON.stringify(invalid)});
    assert.deepEqual(payload.tool_choice,{type:'none'});
    assert.deepEqual(payload.messages[1].content[0],thinking);
    assert.equal(payload.messages[2].content[0].tool_use_id,'ctx');
    assert.ok(payload.messages.some(message=>message.role==='assistant'&&message.content.some(block=>block.type==='text'&&block.text.includes('invented'))));
    assert.match(payload.messages.at(-1).content,/保留每个情景中有效的 evidenceIds/);
    return completion('anthropic',{text:report(id)});
  });
  const result=await run(matchup,'anthropic');
  assert.equal(result.execution.repaired,true);
  assert.equal(result.execution.modelCalls,3);
  assert.ok(result.scenarios.every(scenario=>scenario.evidenceIds.includes(id)));
  assert.doesNotMatch(JSON.stringify(result),/private-thinking|private-signature/);
});

test('provider refusal, failed response and truncation never turn into an empty or repaired analysis',async t => {
  const cases=[
    ['openai',{choices:[{finish_reason:'length',message:{content:'{}'}}]},/截断/],
    ['anthropic',{stop_reason:'max_tokens',content:[{type:'text',text:'{}'}]},/截断/],
    ['responses',{status:'incomplete',incomplete_details:{reason:'max_output_tokens'},output:[outputText('{}')]},/截断/],
    ['responses',{status:'failed',error:{code:'server_error',message:'private-provider-error'},output:[]},/可用消息/],
    ['responses',{status:'completed',output:[{...outputText(''),content:[{type:'refusal',refusal:'private-refusal'}]}]},/可用分析/],
  ];
  for(const [protocol,payload,expected] of cases) {
    let calls=0;
    t.mock.method(globalThis,'fetch',async()=>{calls++;return Response.json(payload);});
    await assert.rejects(run(fixture(),protocol),expected);
    assert.equal(calls,1);
    t.mock.restoreAll();
  }
});

test('custom Responses endpoint supports a complete tool loop under the cloud host allowlist',async t => {
  const matchup=fixture();let count=0;
  t.mock.method(globalThis,'fetch',async(url,options)=>{
    assert.equal(url,'https://models.example/v1/responses');
    assert.equal(options.headers.Authorization,'Bearer '+secret);
    return ++count===1?completion('responses',{calls:[call('ctx','get_matchup_context')]}):completion('responses',{text:report(matchup.evidence[0].id)});
  });
  const result=await runMatchupAgent(matchup,{model:{provider:'custom',protocol:'responses',baseUrl:'https://models.example/v1/chat/completions',model:'proxy-model',apiKey:secret}},{AI_ALLOWED_HOSTS:'models.example'},new AbortController().signal);
  assert.equal(result.execution.modelCalls,2);
  assert.equal(count,2);
});

test('Responses HTTP errors and user cancellation do not silently retry',async t => {
  let calls=0;
  t.mock.method(globalThis,'fetch',async()=>{calls++;return new Response('private-provider-error',{status:401});});
  await assert.rejects(run(fixture(),'responses'),/拒绝了 API Key/);
  assert.equal(calls,1);
  const controller=new AbortController();calls=0;
  t.mock.method(globalThis,'fetch',async()=>{calls++;controller.abort();return completion('responses',{calls:[call('ctx','get_matchup_context')]});});
  await assert.rejects(runMatchupAgent(fixture(),{model:config('responses')},{},controller.signal),/取消或超时/);
  assert.equal(calls,1);
});
