import test from 'node:test';
import assert from 'node:assert/strict';
import { createBoardTools } from '../web/assistant-tools.js';
import { boardAssistantInput, requestBoardAssistant } from '../web/assistant-provider.js';
import { FILM_COMMAND_SCHEMAS } from '../web/coach-film-commands.js';
import { createFilmBridge } from '../web/coach-film-bridge.js';
import { starterWorkspace } from '../web/model.js';
import { handleApi } from '../server/api.mjs';
import { database } from './helpers/db.mjs';

const model = {provider:'openai',model:'film-test',apiKey:'test-fixture-key'};
const owner = {userId:'film-owner',email:'film-owner@example.com'};
const viewer = {userId:'film-viewer',email:'film-viewer@example.com'};
const origin = 'https://board.test';
const post = (db,path,body,user = viewer,signal) => handleApi(new Request(origin + path,{
  method:'POST',headers:{origin,'Content-Type':'application/json'},body:JSON.stringify(body),signal,
}),{DB:db},user);
const tool = (id,name,args) => ({id,type:'function',function:{name,arguments:JSON.stringify(args)}});
const modelReply = (...calls) => Response.json({choices:[{message:{role:'assistant',content:null,tool_calls:calls}}]});
const bookWithViewer = async db => {
  const book = await (await post(db,'/api/workspaces',{title:'Film trial'},owner)).json();
  await handleApi(new Request(origin + '/api/workspaces'),{DB:db},viewer);
  db.sql.prepare('INSERT INTO members(workspace_id,user_id,role,joined_at) VALUES(?,?,?,?)').run(book.id,viewer.userId,'viewer',Date.now());
  return book;
};

test('film tool discovery uses the native schema, preserves coded errors, and reads the current device each time', async () => {
  const data = starterWorkspace();
  const input = boardAssistantInput({instruction:'Show film',board:data.plays[0],editor:{data}});
  let time = 1, writes = 0;
  const film = {
    read:() => ({open:true,time,available:{state:true,seek:true,theme:false}}),
    execute:() => {writes++;throw Object.assign(Error('Missing event'),{code:'EVENT_UNAVAILABLE',details:{event:'release'}});},
  };
  const tools = createBoardTools(input,async () => [],film);
  const discovered = await tools.run('list_capabilities',{category:'film'});
  assert.deepEqual(discovered.capabilities.map(item => item.id),FILM_COMMAND_SCHEMAS.map(schema => 'film_' + schema.properties.operation.const));
  assert.equal(discovered.capabilities.find(item => item.id === 'film_theme').available,false);
  assert.equal(discovered.capabilities.find(item => item.id === 'film_seek').available,true);
  assert.deepEqual((await tools.run('get_command_schema',{command:'film_lesson'})).schema,
    FILM_COMMAND_SCHEMAS.find(schema => schema.properties.operation.const === 'lesson'));
  assert.equal((await tools.run('read_film',{})).time,1);
  time = 2.35;
  assert.equal((await tools.run('read_film',{})).time,2.35);
  assert.equal((await tools.run('control_film',{command:{operation:'seek',time:-1}})).code,'INVALID_COMMAND');
  assert.equal(writes,0);
  assert.deepEqual(await tools.run('control_film',{command:{operation:'event',event:'release'}}),
    {error:'Missing event',code:'EVENT_UNAVAILABLE',details:{event:'release'}});
  assert.equal(writes,1);
  assert.ok(tools.didObserveFilm());
  assert.ok(!(await createBoardTools(input,async () => []).run('list_capabilities',{category:'film'})).capabilities.length);
});

for (const protocol of ['anthropic','responses']) {
  test('film receipts retain native tool-call pairing in ' + protocol, async () => {
    const play = starterWorkspace().plays[0];
    let time = 0, writes = 0, requests = 0;
    const film = {read:() => ({time}), execute(command) {writes++;time = command.time;return {time};}};
    const result = await requestBoardAssistant({instruction:'Freeze at 2.35 seconds', board:play, locale:'en',film,
      model:{...model,provider:protocol === 'responses' ? 'openai' : 'anthropic',protocol},
      fetchImpl:async (_url,options) => {
        requests++;
        const body = JSON.parse(options.body), anth = protocol === 'anthropic';
        const definitions = body.tools.map(tool => tool.name);
        assert.ok(definitions.includes('control_film'));
        const replies = anth
          ? body.messages.flatMap(item => Array.isArray(item.content) ? item.content.filter(block => block.type === 'tool_result') : []).map(item => [item.tool_use_id,JSON.parse(item.content)])
          : body.input.filter(item => item.type === 'function_call_output').map(item => [item.call_id,JSON.parse(item.output)]);
        const [name, args] = [
          ['read_film',{}],['control_film',{command:{operation:'seek',time:2.35}}],['submit_result',{result:{kind:'answer',message:'Frozen at 2.35 seconds.'}}],
        ][replies.length];
        if (replies.length) assert.deepEqual(replies[0],['round0',{time:0}]);
        if (replies.length === 2) assert.deepEqual(replies[1],['round1',{time:2.35}]);
        const id = 'round' + replies.length;
        return Response.json(anth
          ? {stop_reason:'tool_use',content:[{type:'tool_use',id,name,input:args}]}
          : {status:'completed',output:[{type:'function_call',call_id:id,name,arguments:JSON.stringify(args)}]});
      },
    });
    assert.equal(result.kind,'answer');
    assert.equal(requests,3);
    assert.equal(writes,1);
  });
}

test('all local provider protocols and the cloud relay return the device failure when a lesson save conflicts',async t=>{
  const receipt={error:'Another window updated the lesson.',code:'LESSON_CONFLICT',details:{}};
  for (const transport of ['chat','responses','anthropic','cloud']) await t.test(transport,async t=>{
    const cloud=transport==='cloud',protocol=cloud?'chat':transport;
    const db=cloud?database(t):null,book=cloud?await bookWithViewer(db):null;
    const play=(book?.data || starterWorkspace()).plays[0];
    let writes=0,providerCalls=0;
    const film={read:()=>({open:true}),execute() {
      writes++;
      throw Object.assign(Error(receipt.error),{code:receipt.code,details:receipt.details});
    }};
    const provider=async()=>{
      providerCalls++;
      const [name,args]=providerCalls===1
        ? ['control_film',{command:{operation:'lesson',action:'save'}}]
        : ['submit_result',{result:{kind:'answer',message:'Successfully saved.'}}];
      const id='response-'+providerCalls;
      if(protocol==='anthropic')return Response.json({stop_reason:'tool_use',content:[{type:'tool_use',id,name,input:args}]});
      if(protocol==='responses')return Response.json({status:'completed',output:[{type:'function_call',call_id:id,name,arguments:JSON.stringify(args)}]});
      return modelReply(tool(id,name,args));
    };
    if(cloud)t.mock.method(globalThis,'fetch',provider);
    const traces=[];
    const result=await requestBoardAssistant({
      instruction:'Save my lesson on this device.',board:play,locale:'en',film,
      model:{...model,provider:protocol==='anthropic'?'anthropic':'openai',protocol:protocol==='chat'?'chat-completions':protocol},
      ...(cloud?{workspace:{id:book.id,revision:book.revision},fetchImpl:(path,options)=>post(db,path,JSON.parse(options.body),viewer,options.signal)}:{fetchImpl:provider}),
      onEvent:event=>traces.push(event),
    });
    assert.equal(writes,1);assert.equal(providerCalls,1);
    assert.equal(result.kind,'error');assert.equal(result.status,'failed');assert.equal(result.submission,'device');
    assert.equal(result.code,receipt.code);assert.equal(result.message,receipt.error);assert.deepEqual(result.receipt,receipt);
    assert.deepEqual(traces.filter(event=>event.type==='result'),[{type:'result',kind:'error',summary:receipt.error}]);
  });
});

test('a cloud viewer can inspect and control the browser in one turn, with one receipt per real action', async t => {
  const db = database(t), book = await bookWithViewer(db);
  const original = db.sql.prepare('SELECT data_json,revision FROM workspaces WHERE id=?').get(book.id);
  const play = book.data.plays[0], ids = ['H','Y'].map(label => play.players.find(player => player.label === label).id);
  let providerCalls = 0, reads = 0, httpTurns = 0;
  let state = {open:false,time:0,players:play.players.map(({id,label}) => ({id,label})),events:[{id:'release',time:2.35}],focusIds:[]};
  const writes = [], streamedTools = [], traces = [];
  const film = {
    read() {reads++;return structuredClone(state);},
    execute(command) {
      writes.push(command);
      state = command.operation === 'event' ? {...state,open:true,time:2.35} : {...state,focusIds:command.players,comparison:{deeperId:ids[1],gapYards:4}};
      return structuredClone(state);
    },
  };
  t.mock.method(globalThis,'fetch',async (url,options) => {
    assert.equal(url,'https://api.openai.com/v1/chat/completions');
    providerCalls++;
    const {messages,tools} = JSON.parse(options.body);
    const evidence = messages.filter(item => item.role === 'tool').map(item => JSON.parse(item.content));
    if (!evidence.length) {
      assert.ok(tools.some(item => item.function.name === 'read_film'));
      assert.ok(tools.some(item => item.function.name === 'control_film'));
      return modelReply(tool('inspect','read_film',{}));
    }
    if (evidence.length === 1) {
      assert.equal(evidence[0].open,false);
      return modelReply(tool('release','control_film',{command:{operation:'event',event:'release'}}),
        tool('focus','control_film',{command:{operation:'focus',players:ids}}));
    }
    assert.equal(evidence[1].time,2.35);
    assert.equal(evidence[2].comparison.deeperId,ids[1]);
    if (evidence.length === 3) return modelReply(tool('verify','read_film',{}));
    assert.equal(evidence[3].comparison.gapYards,4);
    return modelReply(tool('done','submit_result',{result:{kind:'answer',message:'Y is four designed yards deeper at release.'}}));
  });
  const result = await requestBoardAssistant({instruction:'Show the release, focus H and Y, then compare.',locale:'en',
    board:play,editor:{data:book.data,readOnly:true},workspace:{id:book.id,revision:book.revision},film,model,
    fetchImpl:async (path,options) => {httpTurns++;return post(db,path,JSON.parse(options.body),viewer,options.signal);},
    onTool:name => streamedTools.push(name),onEvent:event => {if (event.type === 'tool') traces.push(event.name);},
  });
  assert.equal(result.kind,'answer');
  assert.equal(result.providerCalls,4);
  assert.equal(providerCalls,4);
  assert.equal(httpTurns,5);
  assert.equal(reads,2);
  assert.deepEqual(writes,[{operation:'event',event:'release'},{operation:'focus',players:ids}]);
  assert.deepEqual(streamedTools,['read_film','control_film','control_film','read_film','submit_result']);
  assert.deepEqual(traces,streamedTools);
  assert.deepEqual(db.sql.prepare('SELECT data_json,revision FROM workspaces WHERE id=?').get(book.id),original);
});

test('the worker and browser keep a pending timeline on the same source while a committed room is open',async t=>{
  const db=database(t),book=await bookWithViewer(db);
  const staged=structuredClone(book.data.plays[0]);staged.ball.passAt=1.4;
  let providerCalls=0;
  const film=createFilmBridge({
    guard() {},available:()=>true,pilot:'film',source:'staged',
    getPlay:()=>staged,getRoster:()=>[],getRoom:()=>({readState:()=>assert.fail('the committed scene belongs to another version')}),
    open:()=>assert.fail('a staged read cannot change the room'),regular:{enabled:()=>true},
  });
  t.mock.method(globalThis,'fetch',async(_url,options)=>{
    providerCalls++;
    const messages=JSON.parse(options.body).messages;
    const evidence=messages.filter(m=>m.role==='tool').map(m=>JSON.parse(m.content));
    if(!evidence.length)return modelReply(tool('board','read_board',{}));
    assert.equal(evidence[0].source,'staged');assert.equal(evidence[0].ball.passAt,1.4);
    if(evidence.length===1)return modelReply(tool('film','read_film',{}));
    assert.equal(evidence[1].source,'staged');assert.equal(evidence[1].projectedSource,'committed');
    assert.equal(evidence[1].events.find(e=>e.id==='release').time,1.4);
    return modelReply(tool('seek','control_film',{command:{operation:'event',event:'release'}}));
  });
  const result=await requestBoardAssistant({instruction:'Show the pending release.',locale:'en',
    board:{...staged,play:staged,source:'staged'},workspace:{id:book.id,revision:book.revision},film,model,
    request:async(path,{body,signal})=>(await post(db,path,body,viewer,signal)).json(),
  });
  assert.equal(result.kind,'error');assert.equal(result.code,'FILM_PREVIEW_PENDING');
  assert.deepEqual(result.receipt.details,{source:'staged',choices:['apply','discard']});
  assert.equal(providerCalls,3);
  const persisted=JSON.parse(db.sql.prepare('SELECT data_json FROM workspaces WHERE id=?').get(book.id).data_json);
  assert.equal(persisted.plays.find(play=>play.id===staged.id).ball.passAt,2);
});

test('an opaque continuation is bound to membership, workspace, request, and revision', async t => {
  const db = database(t), book = await bookWithViewer(db);
  const other = await bookWithViewer(db);
  const path = '/api/workspaces/' + book.id + '/board-assistant';
  const body = {instruction:'Read this room',board:book.data.plays[0],model,revision:book.revision,filmRelay:{enabled:true}};
  let requests = 0;
  t.mock.method(globalThis,'fetch',async () => {requests++;return modelReply(tool('inspect','read_film',{}));});
  const start = await (await post(db,path,body)).json();
  assert.equal(start.kind,'film_host_call');
  assert.deepEqual(start.call,{name:'read_film'});
  const resume = {...body,filmRelay:{continuation:start.continuation,receipt:{open:false}}};
  assert.equal((await post(db,path,resume,owner)).status,400);
  assert.equal((await post(db,'/api/workspaces/' + other.id + '/board-assistant',resume)).status,400);
  assert.equal((await post(db,path,{...resume,instruction:'Altered intent'})).status,400);
  assert.equal((await post(db,path,{...resume,filmRelay:{...resume.filmRelay,continuation:'abcd'}})).status,400);
  db.sql.prepare('UPDATE workspaces SET revision=revision+1 WHERE id=?').run(book.id);
  assert.equal((await post(db,path,resume)).status,409);
  db.sql.prepare('DELETE FROM members WHERE workspace_id=? AND user_id=?').run(book.id,viewer.userId);
  assert.equal((await post(db,path,resume)).status,404);
  assert.equal(requests,1);
});
