import test from 'node:test';
import assert from 'node:assert/strict';
import { database } from './helpers/db.mjs';
import { handleApi } from '../server/api.mjs';
import { clone, makePlay, starterWorkspace } from '../web/model.js';
import { isFlag5Play } from '../web/game-formats.js';

const owner = {userId:'flag-owner', email:'flag@example.com', displayName:'Coach'};
async function call(db, path, method = 'GET', body) {
  const response = await handleApi(new Request('https://playbook.test/api' + path, {
    method, headers:{Origin:'https://playbook.test', ...(body === undefined ? {} : {'Content-Type':'application/json'})},
    ...(body === undefined ? {} : {body:JSON.stringify(body)}),
  }), {DB:db}, owner);
  return {status:response.status, body:await response.json()};
}
async function create(db, data) {
  const result = await call(db, '/workspaces', 'POST', {title:'Mixed flag playbook', data});
  assert.equal(result.status,201);
  return result.body;
}
const save = (db, record, data, revision = record.revision) => call(db, '/workspaces/' + record.id, 'PUT', {revision,data});
function mixedBook() {
  const data = starterWorkspace(), flag = makePlay({count:5, formation:'Flag 5 Spread'});
  flag.formation = 'Team flag custom';
  data.plays.push(flag);
  data.formations.push({id:'flag-template',name:'Team custom',book:'offense',league:5,players:clone(flag.players)});
  data.settings.league = 11;
  return data;
}

test('cloud saves retain custom flag formats and reject an older editor that strips play metadata', async t => {
  const db = database(t), record = await create(db,mixedBook());
  const olderEditor = clone(record.data);
  olderEditor.plays[0].title = 'An unrelated older-editor change';
  delete olderEditor.plays.at(-1).league;
  const result = await save(db,record,olderEditor);
  assert.equal(result.status,422);
  assert.match(result.body.error,/刷新.*五人腰旗/);
  const current = (await call(db,'/workspaces/' + record.id)).body;
  assert.equal(current.revision,record.revision);
  assert.deepEqual(current.data,record.data);
  assert.equal(isFlag5Play(current.data.plays.at(-1)),true);
  assert.equal(db.sql.prepare('SELECT COUNT(*) AS n FROM snapshots').get().n,1);
});

test('saved flag template metadata is protected but explicit conversions to another format remain valid', async t => {
  const db = database(t), record = await create(db,mixedBook());
  const olderEditor = clone(record.data);
  delete olderEditor.formations[0].league;
  assert.equal((await save(db,record,olderEditor)).status,422);

  const converted = clone(record.data), original = converted.plays.at(-1);
  const tackle = makePlay({count:11,formation:'Gun Doubles'});
  tackle.id = original.id;
  converted.plays[converted.plays.length - 1] = tackle;
  converted.formations[0].league = 11;
  converted.formations[0].players = clone(tackle.players);
  assert.equal((await save(db,record,converted)).status,200);
  const current = (await call(db,'/workspaces/' + record.id)).body;
  assert.equal(current.data.plays.at(-1).league,11);
  assert.equal(current.data.formations[0].league,11);
  assert.equal(isFlag5Play(current.data.plays.at(-1)),false);
});

test('legacy backups and newly added diagrams without format metadata remain accepted', async t => {
  const db = database(t), legacy = starterWorkspace();
  for (const play of legacy.plays) delete play.league;
  const record = await create(db,legacy), changed = clone(record.data);
  const partial = makePlay({count:5}); delete partial.league;
  partial.formation = 'Legacy partial diagram';
  changed.plays.push(partial);
  assert.equal((await save(db,record,changed)).status,200);
  const current = (await call(db,'/workspaces/' + record.id)).body;
  assert.equal(current.data.plays.at(-1).league,undefined);
  assert.equal(isFlag5Play(current.data.plays.at(-1)),false);
});

test('restoring an authorized historical version may deliberately restore legacy format metadata', async t => {
  const db = database(t), legacy = starterWorkspace();
  delete legacy.plays[0].league;
  const record = await create(db,legacy), changed = clone(record.data);
  const flag = makePlay({count:5}); flag.id = changed.plays[0].id;
  flag.formation = 'Team flag custom'; changed.plays[0] = flag;
  assert.equal((await save(db,record,changed)).status,200);
  const restored = await call(db,'/workspaces/' + record.id + '/history/1/restore','POST',{revision:2});
  assert.equal(restored.status,200);
  const current = (await call(db,'/workspaces/' + record.id)).body;
  assert.equal(current.revision,3);
  assert.equal(current.data.plays[0].league,undefined);
  assert.equal(current.data.plays[0].players.length,11);
  assert.equal(isFlag5Play(current.data.plays[0]),false);
});
