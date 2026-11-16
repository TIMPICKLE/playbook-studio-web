import test from 'node:test';
import assert from 'node:assert/strict';

test('AI workspaces share preferences while credentials remain memory-only', async () => {
  const records=new Map();globalThis.localStorage={getItem:k=>records.get(k)||null,setItem:(k,v)=>records.set(k,v)};
  const {getModelConnection,setModelConnection,subscribeModelConnection}=await import('../web/model-connection.js?connection-test');
  assert.equal(getModelConnection(),null);
  const events=[],unsubscribe=subscribeModelConnection(value=>events.push(value));
  setModelConnection({provider:'custom',protocol:'responses',model:'example',baseUrl:'https://example.com/v1',apiKey:'session-only-key'});
  assert.equal(getModelConnection().apiKey,'session-only-key');
  assert.equal([...records.values()].some(value=>value.includes('session-only-key')),false);
  setModelConnection({model:'other'});
  assert.equal(getModelConnection().apiKey,'session-only-key');
  const copy=getModelConnection();copy.model='mutated';assert.equal(getModelConnection().model,'other');
  unsubscribe();setModelConnection({model:'last'});assert.equal(events.length,2);
  const fresh=await import('../web/model-connection.js?fresh-session');
  assert.equal(fresh.getModelConnection().apiKey,undefined);
  assert.equal(fresh.getModelConnection().model,'last');
  delete globalThis.localStorage;
});
