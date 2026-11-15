import test from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { createBoardAssistant } from '../web/board-assistant.js';
import { createMatchupView } from '../web/ai-matchup.js';
import { starterWorkspace } from '../web/model.js';
import { MODEL_PROVIDER_PRESETS } from '../web/model-protocol.js';

const settle = async () => { for (let i=0;i<5;i++) await new Promise(resolve=>setImmediate(resolve)); };
const values = select => [...select.options].map(option=>option.value);
const result = () => ({status:'limited',summary:'Conditional report',scenarios:[{title:'Read',condition:'If',observation:'Watch',possibility:'May open',evidenceIds:[]}],warnings:[],evidence:[]});

test('board model settings expose actual protocol families and submit custom settings without persisting credentials', async () => {
  const win = new Window({url:'https://playbook.test/local.html'}), host=win.document.createElement('div');
  win.document.body.append(host);
  const requests=[], context={scope:'local/a',title:'Mesh',readOnly:false,serverProxy:false};
  const assistant=createBoardAssistant({host,getContext:()=>context,onRequest:async request=>{requests.push(request);return {kind:'clarify',message:'Next action?'};}});
  const q=selector=>win.document.querySelector(selector), click=action=>q(`[data-ba="${action}"]`).click();
  const input=(selector,value)=>{const node=q(selector);node.value=value;node.dispatchEvent(new win.Event(node.tagName==='SELECT'?'change':'input',{bubbles:true}));};
  async function send(instruction='Inspect this play') {
    click('done');input('[data-ba-prompt]',instruction);click('send');await settle();
    return requests.at(-1);
  }
  try {
    click('open');click('settings');
    assert.deepEqual(new Set(values(q('[data-ba-provider]'))),new Set(Object.keys(MODEL_PROVIDER_PRESETS)));
    assert.deepEqual(values(q('[data-ba-protocol]')),['openai','responses']);
    assert.equal(q('[data-ba-custom]').hidden,true);
    input('[data-ba-model]','my-openai-model');input('[data-ba-key]','openai-secret');input('[data-ba-protocol]','responses');
    assert.equal(q('[data-ba-key]').value,'openai-secret');assert.equal(q('[data-ba-model]').value,'my-openai-model');
    const openai=await send();
    assert.equal(openai.provider,'openai');assert.equal(openai.protocol,'responses');assert.equal(openai.baseUrl,'');
    assert.equal(openai.apiKey,'openai-secret');

    click('settings');input('[data-ba-provider]','anthropic');
    assert.deepEqual(values(q('[data-ba-protocol]')),['anthropic']);
    assert.equal(q('[data-ba-protocol]').value,'anthropic');assert.equal(q('[data-ba-key]').value,'');
    assert.equal(q('[data-ba-model]').value,'claude-sonnet-4-6');
    input('[data-ba-key]','claude-secret');
    const anthropic=await send();assert.equal(anthropic.protocol,'anthropic');assert.equal(anthropic.provider,'anthropic');

    click('settings');input('[data-ba-provider]','custom');
    assert.deepEqual(values(q('[data-ba-protocol]')),['openai','anthropic','responses']);
    assert.equal(q('[data-ba-custom]').hidden,false);assert.match(q('[data-ba-url-hint]').textContent,/CORS/);
    input('[data-ba-model]','gateway-model');input('[data-ba-key]','gateway-secret');
    input('[data-ba-base-url]','https://gateway.example/tenant/v1/messages');input('[data-ba-protocol]','anthropic');
    input('[data-ba-protocol]','responses');
    assert.equal(q('[data-ba-model]').value,'gateway-model');assert.equal(q('[data-ba-key]').value,'gateway-secret');
    assert.equal(q('[data-ba-base-url]').value,'https://gateway.example/tenant/v1/messages');
    const custom=await send();
    assert.equal(custom.provider,'custom');assert.equal(custom.protocol,'responses');
    assert.equal(custom.baseUrl,'https://gateway.example/tenant/v1/messages');
    assert.equal(custom.apiKey,'gateway-secret');
    assert.doesNotMatch(q('.ba-output').textContent,/openai-secret|claude-secret|gateway-secret/);
    assert.doesNotMatch(JSON.stringify(custom.previous),/openai-secret|claude-secret|gateway-secret/);
    assert.equal(win.localStorage.length,0);assert.equal(win.sessionStorage.length,0);

    click('settings');context.serverProxy=true;input('[data-ba-provider]','deepseek');
    assert.deepEqual(values(q('[data-ba-protocol]')),['openai','anthropic']);
    assert.equal(q('[data-ba-key]').value,'');assert.equal(q('[data-ba-base-url]').value,'');
    input('[data-ba-provider]','custom');assert.match(q('[data-ba-url-hint]').textContent,/管理员|administrator/);
    input('[data-ba-key]','new-secret');input('[data-ba-model]','model');click('done');input('[data-ba-prompt]','Inspect');click('send');await settle();
    assert.equal(requests.length,3,'missing custom URL does not submit a model request');
    assert.match(q('.ba-status').textContent,/服务地址|service URL/);
  } finally {assistant.destroy();await win.happyDOM.abort();}
});

async function withMatchup(demo,run) {
  const win=new Window({url:'https://playbook.test/editor/',width:1024,height:900});
  const previous=Object.fromEntries(['window','document','localStorage'].map(name=>[name,Object.getOwnPropertyDescriptor(globalThis,name)]));
  for(const name of Object.keys(previous))Object.defineProperty(globalThis,name,{configurable:true,value:name==='window'?win:win[name]});
  win.document.body.innerHTML='<div id="root"></div>';
  const root=win.document.querySelector('#root'),data=starterWorkspace(),record={id:'book',title:'Team',revision:1},calls=[];
  const view=createMatchupView({root,demo,getCurrent:()=>record,getData:()=>data,isDirty:()=>false,request:async(path,options)=>{calls.push({path,...options});return result();}});
  const q=selector=>root.querySelector(selector);
  const input=(field,value)=>{const node=q(`[data-ai-field="${field}"]`);node.value=value;node.dispatchEvent(new win.Event(node.tagName==='SELECT'?'change':'input',{bubbles:true}));};
  try {view.onData(data,record);view.show(true);await run({win,root,q,input,calls,view});}
  finally {view.show(false);await win.happyDOM.abort();for(const [name,descriptor] of Object.entries(previous)){if(descriptor)Object.defineProperty(globalThis,name,descriptor);else delete globalThis[name];}}
}

for(const demo of [false,true])test(`${demo?'browser demo':'cloud'} analysis exposes protocol selection and preserves fields across rerenders`,async()=>{
  await withMatchup(demo,async({win,root,q,input,calls})=>{
    assert.deepEqual(new Set(values(q('[data-ai-field="provider"]'))),new Set(Object.keys(MODEL_PROVIDER_PRESETS)));
    input('provider','openai');
    assert.deepEqual(values(q('[data-ai-field="protocol"]')),['openai','responses']);
    assert.equal(q('[data-ai-field="baseUrl"]'),null,'built-in providers do not require a URL');
    input('model','custom-openai-id');input('apiKey','analysis-secret');input('protocol','responses');
    assert.equal(q('[data-ai-field="model"]').value,'custom-openai-id');assert.equal(q('[data-ai-field="apiKey"]').value,'analysis-secret');
    q('[data-ai-action="analyze"]').click();await settle();
    assert.equal(calls.at(-1).body.model.protocol,'responses');assert.equal(calls.at(-1).body.model.provider,'openai');
    assert.equal(calls.at(-1).body.model.apiKey,'analysis-secret');

    input('provider','anthropic');
    assert.deepEqual(values(q('[data-ai-field="protocol"]')),['anthropic']);
    assert.equal(q('[data-ai-field="apiKey"]').value,'');assert.equal(q('[data-ai-field="model"]').value,'claude-sonnet-4-6');
    input('apiKey','anthropic-analysis-secret');q('[data-ai-action="analyze"]').click();await settle();
    assert.equal(calls.at(-1).body.model.protocol,'anthropic');

    input('provider','custom');
    assert.deepEqual(values(q('[data-ai-field="protocol"]')),['openai','anthropic','responses']);
    assert.match(q('[data-ai-field="baseUrl"]').parentElement.textContent,demo?/CORS/:/管理员|administrator/);
    input('model','gateway-analysis');input('baseUrl','https://gateway.example/v1');input('apiKey','gateway-analysis-secret');
    input('protocol','anthropic');input('protocol','responses');
    assert.equal(q('[data-ai-field="apiKey"]').value,'gateway-analysis-secret');
    assert.equal(q('[data-ai-field="baseUrl"]').value,'https://gateway.example/v1');
    assert.equal(q('[data-ai-field="model"]').value,'gateway-analysis');
    q('[data-ai-action="analyze"]').click();await settle();
    assert.deepEqual(calls.at(-1).body.model,{provider:'custom',protocol:'responses',model:'gateway-analysis',apiKey:'gateway-analysis-secret',baseUrl:'https://gateway.example/v1'});
    assert.doesNotMatch(root.textContent,/analysis-secret|anthropic-analysis-secret|gateway-analysis-secret/);
    assert.doesNotMatch(JSON.stringify(win.localStorage),/analysis-secret|gateway-analysis-secret/);
    input('provider','deepseek');
    assert.equal(q('[data-ai-field="protocol"]').value,'openai');assert.equal(q('[data-ai-field="model"]').value,'deepseek-flash');
    assert.equal(q('[data-ai-field="apiKey"]').value,'');assert.equal(q('[data-ai-field="baseUrl"]'),null);
    assert.equal(win.sessionStorage.length,0);
  });
});
