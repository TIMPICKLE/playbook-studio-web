import test from 'node:test';
import assert from 'node:assert/strict';
import { MODEL_PROVIDER_PRESETS, PROTOCOL_OPTIONS, normalizeModelProtocol, resolveModelEndpoint, buildModelRequest, parseModelResponse, parseModelUsage } from '../web/model-protocol.js';

const config = (provider = 'openai', protocol = 'openai', extra = {}) => ({provider,protocol,model:'test-model',apiKey:'test-key',...extra});
const messages = [{role:'system',content:'System instructions'},{role:'user',content:'Inspect this play.'}];
const tool = {type:'function',function:{name:'inspect',description:'Inspect a real object.',parameters:{type:'object',properties:{label:{type:'string'}},additionalProperties:false}}};
const call = (id = 'call-1') => ({id,type:'function',function:{name:'inspect',arguments:'{"label":"X"}'}});
const throwsCode = (run,code) => assert.throws(run,error => error.code === code);

test('one provider registry resolves every advertised protocol with explicit model and key', () => {
  assert.deepEqual(Object.keys(PROTOCOL_OPTIONS),['openai','anthropic','responses']);
  for (const [provider,preset] of Object.entries(MODEL_PROVIDER_PRESETS)) {
    for (const protocol of preset.protocols) {
      const result=resolveModelEndpoint({...config(provider,protocol),...(provider==='custom'?{baseUrl:'https://gateway.example/api/v1'}:{})});
      assert.equal(result.provider,provider);
      assert.equal(result.protocol,protocol);
      assert.match(result.endpoint,/^https:\/\//);
      assert.equal(result.model,'test-model');
      assert.equal(result.apiKey,'test-key');
      if (provider!=='custom') assert.equal(result.endpoint,preset.endpoints[protocol]);
    }
  }
  assert.equal(resolveModelEndpoint(config('deepseek','anthropic')).endpoint,'https://api.deepseek.com/anthropic/v1/messages');
  assert.equal(resolveModelEndpoint(config('openrouter','responses')).endpoint,'https://openrouter.ai/api/v1/responses');
  throwsCode(()=>resolveModelEndpoint({provider:'openai',apiKey:'test-key'}),'MODEL_CONFIGURATION');
  throwsCode(()=>resolveModelEndpoint(config('openai','openai',{apiKey:'secret\nheader'})),'MODEL_CONFIGURATION');
  throwsCode(()=>resolveModelEndpoint(config('openai','openai',{model:'model\nheader'})),'MODEL_CONFIGURATION');
});

test('old protocol values and explicit compatible aliases normalize without inventing provider support', () => {
  for (const value of ['openai','chat','chat_completions','chat-completions','chat/completions']) assert.equal(normalizeModelProtocol(value,'custom'),'openai');
  for (const value of ['anthropic','messages','anthropic_messages','anthropic-messages']) assert.equal(normalizeModelProtocol(value,'custom'),'anthropic');
  assert.equal(normalizeModelProtocol('response','custom'),'responses');
  assert.equal(normalizeModelProtocol(undefined,'anthropic'),'anthropic');
  assert.equal(normalizeModelProtocol('','deepseek'),'openai');
  for (const [value,provider] of [['responses','deepseek'],['openai','anthropic'],['made-up','custom'],['openai','unknown'],['openai','constructor'],['openai','__proto__']]) throwsCode(()=>normalizeModelProtocol(value,provider),'MODEL_CONFIGURATION');
});

test('custom base URLs retain prefixes and full endpoint suffixes are replaced when protocol changes', () => {
  const suffixes={openai:'/chat/completions',anthropic:'/messages',responses:'/responses'};
  for (const protocol of Object.keys(suffixes)) {
    for (const ending of ['', '/', ...Object.values(suffixes)]) {
      const result=resolveModelEndpoint({...config('custom',protocol),baseUrl:'https://gateway.example/team/v1'+ending});
      assert.equal(result.endpoint,'https://gateway.example/team/v1'+suffixes[protocol]);
    }
    assert.equal(resolveModelEndpoint({...config('custom',protocol),baseUrl:'https://gateway.example'}).endpoint,'https://gateway.example'+suffixes[protocol]);
  }
  for (const baseUrl of ['http://gateway.example/v1','https://user:pass@gateway.example/v1','https://gateway.example:8443/v1','https://gateway.example/v1?key=secret','https://gateway.example/v1#fragment','garbage'])
    throwsCode(()=>resolveModelEndpoint({...config('custom'),baseUrl}),'MODEL_CONFIGURATION');
});

test('Chat Completions preserves its native messages and tools while omitting protocol-private metadata', () => {
  const transcript=[...messages,{role:'assistant',content:null,tool_calls:[call()],reasoning_content:'provider-private',reasoning_details:[{type:'reasoning.text',text:'private'}],responsesOutput:[{type:'reasoning'}],anthropicContent:[{type:'thinking'}],textFallback:true},{role:'tool',tool_call_id:'call-1',content:'{"found":true}'}];
  const original=structuredClone(transcript);
  const {headers,body}=buildModelRequest(config('deepseek'),transcript,{tools:[tool],toolChoice:{type:'function',function:{name:'inspect'}},maxTokens:2345});
  assert.equal(headers.Authorization,'Bearer test-key');
  assert.equal(headers['x-api-key'],undefined);
  assert.equal(body.max_tokens,2345);
  assert.deepEqual(body.thinking,{type:'disabled'});
  assert.deepEqual(body.tool_choice,{type:'function',function:{name:'inspect'}});
  assert.deepEqual(body.tools,[tool]);
  assert.equal(body.messages[2].reasoning_content,'provider-private');
  assert.deepEqual(body.messages[2].reasoning_details,transcript[2].reasoning_details);
  assert.equal(body.messages[3].tool_call_id,'call-1');
  assert.doesNotMatch(JSON.stringify(body),/responsesOutput|anthropicContent|textFallback/);
  assert.deepEqual(transcript,original);
  assert.equal(buildModelRequest(config(),messages).body.max_completion_tokens,1800);
  assert.deepEqual(buildModelRequest(config('openai','openai',{model:'gpt-6.1-terra'}),messages).body.reasoning_effort,'none');
});

test('Anthropic Messages preserves signed thinking and groups parallel results in the next user message', () => {
  const raw=[{type:'thinking',thinking:'private',signature:'signed-proof'},{type:'tool_use',id:'a',name:'inspect',input:{label:'X'}},{type:'tool_use',id:'b',name:'inspect',input:{label:'Y'}}];
  const assistant=parseModelResponse(config('anthropic','anthropic'),{stop_reason:'tool_use',content:raw});
  const transcript=[...messages,assistant,{role:'tool',tool_call_id:'a',content:'X facts'},{role:'tool',tool_call_id:'b',content:'Y facts'}];
  const {headers,body}=buildModelRequest(config('anthropic','anthropic'),transcript,{tools:[tool],toolChoice:{type:'function',function:{name:'inspect'}},browser:true});
  assert.equal(headers['x-api-key'],'test-key');
  assert.equal(headers.Authorization,undefined);
  assert.equal(headers['anthropic-version'],'2023-06-01');
  assert.equal(headers['anthropic-dangerous-direct-browser-access'],'true');
  assert.equal(body.system,'System instructions');
  assert.ok(body.messages.every(message=>message.role!=='system'));
  assert.deepEqual(body.messages[1].content,raw);
  assert.deepEqual(body.messages[2],{role:'user',content:[{type:'tool_result',tool_use_id:'a',content:'X facts'},{type:'tool_result',tool_use_id:'b',content:'Y facts'}]});
  assert.deepEqual(body.tools,[{name:'inspect',description:tool.function.description,input_schema:tool.function.parameters}]);
  assert.deepEqual(body.tool_choice,{type:'tool',name:'inspect'});
  assert.equal(buildModelRequest(config('anthropic','anthropic'),messages).headers['anthropic-dangerous-direct-browser-access'],undefined);
  assert.equal(buildModelRequest(config('deepseek','anthropic'),messages,{browser:true}).headers['anthropic-dangerous-direct-browser-access'],undefined);
  const custom=resolveModelEndpoint({...config('custom','anthropic'),baseUrl:'https://api.anthropic.com/v1'});
  assert.equal(buildModelRequest(custom,messages,{browser:true}).headers['anthropic-dangerous-direct-browser-access'],'true','the same official endpoint works through the custom configuration');
  const gateway=resolveModelEndpoint({...config('custom','anthropic'),baseUrl:'https://gateway.example/v1'});
  assert.equal(buildModelRequest(gateway,messages,{browser:true}).headers['anthropic-dangerous-direct-browser-access'],undefined,'unrelated compatible gateways do not gain an extra CORS header');
});

test('Anthropic synthetic repair messages can be serialized without raw content blocks', () => {
  const {body}=buildModelRequest(config('custom','anthropic'),[...messages,{role:'assistant',content:'Please clarify.',tool_calls:[call()]},{role:'tool',tool_call_id:'call-1',content:'not found'},{role:'user',content:'Use Y instead.'}],{tools:[tool],toolChoice:'none'});
  assert.deepEqual(body.messages[1].content,[{type:'text',text:'Please clarify.'},{type:'tool_use',id:'call-1',name:'inspect',input:{label:'X'}}]);
  assert.deepEqual(body.tool_choice,{type:'none'});
  assert.equal(body.messages.at(-1).content,'Use Y instead.');
});

test('Responses uses typed items, flat non-strict tools and stateless encrypted reasoning replay', () => {
  const raw=[{type:'reasoning',id:'rs_1',summary:[],encrypted_content:'encrypted-proof'},{type:'function_call',id:'fc_item_1',call_id:'call-A',name:'inspect',arguments:'{"label":"X"}',status:'completed'},{type:'function_call',id:'fc_item_2',call_id:'call-B',name:'inspect',arguments:'{"label":"Y"}',status:'completed'}];
  const assistant=parseModelResponse(config('openai','responses'),{status:'completed',output:raw});
  assert.deepEqual(assistant.tool_calls.map(item=>item.id),['call-A','call-B']);
  const transcript=[...messages,assistant,{role:'tool',tool_call_id:'call-A',content:'X facts'},{role:'tool',tool_call_id:'call-B',content:'Y facts'}];
  const {headers,body}=buildModelRequest(config('openai','responses'),transcript,{tools:[tool],toolChoice:{type:'function',function:{name:'inspect'}},maxTokens:3456});
  assert.equal(headers.Authorization,'Bearer test-key');
  assert.equal(body.instructions,'System instructions');
  assert.equal(body.max_output_tokens,3456);
  assert.equal(body.store,false);
  assert.deepEqual(body.include,['reasoning.encrypted_content']);
  assert.deepEqual(body.tools,[{type:'function',...tool.function,strict:false}]);
  assert.deepEqual(body.tool_choice,{type:'function',name:'inspect'});
  assert.deepEqual(body.input.slice(1,4),raw);
  assert.deepEqual(body.input.slice(-2),[{type:'function_call_output',call_id:'call-A',output:'X facts'},{type:'function_call_output',call_id:'call-B',output:'Y facts'}]);
  assert.doesNotMatch(JSON.stringify(body),/tool_calls|tool_call_id|anthropicContent|responsesOutput|max_completion_tokens/);
  assert.equal(body.previous_response_id,undefined);
  const terra=buildModelRequest(config('openai','responses',{model:'gpt-6.1-terra'}),messages).body;
  assert.deepEqual(terra.reasoning,{effort:'none'});
  assert.equal(terra.reasoning_effort,undefined);
});

test('Responses REST output content is combined without requiring the SDK output_text helper', () => {
  const raw=[{type:'reasoning',id:'rs_1',summary:[],encrypted_content:'opaque'},{type:'message',role:'assistant',content:[{type:'output_text',text:'{"summary":'},{type:'output_text',text:'"ready"}'}],status:'completed'}];
  const parsed=parseModelResponse(config('openrouter','responses'),{status:'completed',output:raw});
  assert.equal(parsed.content,'{"summary":"ready"}');
  assert.equal(JSON.parse(parsed.content).summary,'ready');
  assert.deepEqual(parsed.responsesOutput,raw);
  const next=buildModelRequest(config('openrouter','responses'),[...messages,parsed,{role:'user',content:'Follow up.'}]).body;
  assert.deepEqual(next.input.slice(1,3),raw);
  assert.deepEqual(next.input.at(-1),{role:'user',content:'Follow up.'});
  const repaired=buildModelRequest(config('custom','responses'),[...messages,{role:'assistant',content:'{"summary":'},{role:'user',content:'The result was rejected. Return complete JSON.'}]).body;
  assert.deepEqual(repaired.input[1],{role:'assistant',content:'{"summary":'});
  assert.equal(repaired.input[1].type,undefined,'synthetic repair uses EasyInputMessage rather than fake output records');
});

test('truncation, incomplete responses and refusals never masquerade as complete results', () => {
  throwsCode(()=>parseModelResponse(config(),{choices:[{finish_reason:'length',message:{content:'{"partial":'}}]}),'MODEL_TRUNCATED');
  throwsCode(()=>parseModelResponse(config(),{choices:[{finish_reason:'content_filter',message:{content:'no'}}]}),'MODEL_REFUSAL');
  throwsCode(()=>parseModelResponse(config('anthropic','anthropic'),{stop_reason:'max_tokens',content:[{type:'text',text:'partial'}]}),'MODEL_TRUNCATED');
  throwsCode(()=>parseModelResponse(config('anthropic','anthropic'),{stop_reason:'refusal',content:[{type:'text',text:'no'}]}),'MODEL_REFUSAL');
  throwsCode(()=>parseModelResponse(config('openai','responses'),{status:'incomplete',output:[]}), 'MODEL_TRUNCATED');
  throwsCode(()=>parseModelResponse(config('openai','responses'),{status:'failed',output:[]}), 'MODEL_INVALID_RESPONSE');
  throwsCode(()=>parseModelResponse(config('openai','responses'),{status:'completed',output:[{type:'message',role:'assistant',content:[{type:'refusal',refusal:'no'}]}]}),'MODEL_REFUSAL');
  throwsCode(()=>parseModelResponse(config('openai','responses'),{status:'completed',output:[{type:'function_call',call_id:'a',name:'inspect',arguments:'{}',status:'incomplete'}]}),'MODEL_TRUNCATED');
});

test('malformed, duplicated or missing tool-call IDs are rejected across all three protocols', () => {
  for (const calls of [[call(),call()],[{...call(),id:''}],[{...call(),function:{name:'',arguments:'{}'}}]])
    throwsCode(()=>parseModelResponse(config(),{choices:[{message:{content:null,tool_calls:calls}}]}),'MODEL_INVALID_TOOL');
  throwsCode(()=>parseModelResponse(config('anthropic','anthropic'),{stop_reason:'tool_use',content:[{type:'tool_use',id:'a',name:'inspect',input:[]}]}),'MODEL_INVALID_TOOL');
  throwsCode(()=>parseModelResponse(config('anthropic','anthropic'),{stop_reason:'end_turn',content:[{type:'tool_use',id:'a',name:'inspect',input:{}}]}),'MODEL_INVALID_RESPONSE');
  throwsCode(()=>parseModelResponse(config('openai','responses'),{status:'completed',output:[{type:'function_call',id:'not-a-call-id',name:'inspect',arguments:'{}'}]}),'MODEL_INVALID_TOOL');
  throwsCode(()=>parseModelResponse(config('openai','responses'),{status:'completed',output:[{type:'function_call',call_id:'a',name:'inspect',arguments:'{}'},{type:'function_call',call_id:'a',name:'inspect',arguments:'{}'}]}),'MODEL_INVALID_TOOL');
  for (const protocol of ['openai','anthropic','responses']) throwsCode(()=>parseModelResponse(config('custom',protocol),{error:{message:'Provider error'}}),'MODEL_INVALID_RESPONSE');
});

test('text-only compatibility uses protocol-native output format settings and no tool definitions', () => {
  const chat=buildModelRequest(config(),messages,{jsonOnly:true}).body;
  assert.deepEqual(chat.response_format,{type:'json_object'});
  assert.equal(chat.tools,undefined);
  const responses=buildModelRequest(config('openai','responses'),messages,{jsonOnly:true}).body;
  assert.deepEqual(responses.text,{format:{type:'json_object'}});
  assert.equal(responses.tools,undefined);
  const anthropic=buildModelRequest(config('anthropic','anthropic'),messages,{jsonOnly:true}).body;
  assert.equal(anthropic.response_format,undefined);
  assert.equal(anthropic.text,undefined);
});

test('usage normalizes Chat and Messages/Responses field names and reports absent usage honestly', () => {
  assert.deepEqual(parseModelUsage(config(),{usage:{prompt_tokens:12,completion_tokens:6}}),{inputTokens:12,outputTokens:6});
  for (const protocol of ['anthropic','responses']) assert.deepEqual(parseModelUsage(config('custom',protocol),{usage:{input_tokens:12,output_tokens:6}}),{inputTokens:12,outputTokens:6});
  for (const usage of [undefined,{input_tokens:-1,output_tokens:3},{input_tokens:1.5,output_tokens:4},{input_tokens:10}])
    assert.equal(parseModelUsage(config('custom','responses'),{usage}),null);
});
