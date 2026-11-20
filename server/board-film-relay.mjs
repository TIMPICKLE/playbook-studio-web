import { fail } from './http.mjs';

const encoder = new TextEncoder();
const secretKey = 'board-film-relay-aes-v1';
const object = value => !!value && typeof value === 'object' && !Array.isArray(value);
const invalid = () => fail(400, '讲解操作的续调信息无效，请重新发送指令。');

function base64(bytes) {
  let text = '';
  for (let i = 0; i < bytes.length; i += 8192) text += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(text);
}
const bytes = text => Uint8Array.from(atob(text), char => char.charCodeAt(0));

// Only a random service key is stored. An authenticated browser carries the
// compressed, encrypted continuation; play data and lessons never enter this table.
async function serviceKey(db) {
  const read = () => db.prepare('SELECT value FROM app_setup WHERE key=?').bind(secretKey).first();
  let row = await read();
  if (!row) {
    const fresh = base64(crypto.getRandomValues(new Uint8Array(32)));
    await db.prepare('INSERT OR IGNORE INTO app_setup(key,value,created_at) VALUES(?,?,?)').bind(secretKey, fresh, Date.now()).run();
    row = await read();
  }
  return crypto.subtle.importKey('raw', bytes(row.value), 'AES-GCM', false, ['encrypt','decrypt']);
}

async function compressed(data, transform) {
  const stream = new Blob([data]).stream().pipeThrough(transform);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function createBoardFilmRelay(db, {userId, workspaceId, revision, body}) {
  const input = body.filmRelay;
  if (!input) return null;
  if (!object(input)) invalid();
  const context = [userId, workspaceId, body.revision, body.model, body.instruction, body.locale, body.mode, body.previous,
    body.board, body.editor?.view, !!body.stream];
  let key, binding;
  async function protect() {
    key ??= await serviceKey(db);
    binding ??= await crypto.subtle.digest('SHA-256', encoder.encode(JSON.stringify(context)));
  }
  let data = {revision, models:[], receipts:[], providerCalls:0, seen:{tool:0,trace:0}};
  const resuming = input.continuation != null;
  if (resuming) {
    if (typeof input.continuation !== 'string' || !object(input.receipt)) invalid();
    await protect();
    try {
      const packet = bytes(input.continuation);
      const clear = await crypto.subtle.decrypt({name:'AES-GCM',iv:packet.subarray(0,12),additionalData:binding},key,packet.subarray(12));
      data = JSON.parse(new TextDecoder().decode(await compressed(clear, new DecompressionStream('gzip'))));
    } catch { invalid(); }
    if (data.expires < Date.now()) invalid();
    if (data.revision !== revision) fail(409, '战术本在讲解中已改变，请重新发送指令。');
    data.receipts.push({call:data.pending, result:input.receipt});
    delete data.pending;
  } else if (input.enabled !== true) invalid();

  let modelIndex = 0, receiptIndex = 0, pending = null;
  const seen = {tool:0, trace:0};
  function host(call) {
    const recorded = data.receipts[receiptIndex++];
    if (recorded) {
      if (JSON.stringify(call) !== JSON.stringify(recorded.call)) invalid();
      return recorded.result;
    }
    pending = call;
    throw Object.assign(new Error('Awaiting film device'), {awaitingFilmHost:true});
  }
  return {
    resuming,
    film: {read:() => host({name:'read_film'}), execute:command => host({name:'control_film',command})},
    countProviderRequest() {data.providerCalls++;},
    providerCalls: () => data.providerCalls,
    async modelTurn(requestTurn) {
      const index = modelIndex++;
      if (index < data.models.length) return data.models[index];
      const response = await requestTurn();
      data.models.push(response);
      return response;
    },
    listener(kind, callback) {
      return (...args) => {if (++seen[kind] > data.seen[kind]) callback?.(...args);};
    },
    pending: () => !!pending,
    async yieldToBrowser() {
      await protect();
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const packed = await compressed(encoder.encode(JSON.stringify({...data, pending, seen, expires:Date.now() + 30 * 60_000})), new CompressionStream('gzip'));
      const cipher = await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:binding}, key, packed);
      const packet = new Uint8Array(iv.length + cipher.byteLength);
      packet.set(iv); packet.set(new Uint8Array(cipher), iv.length);
      return {kind:'film_host_call', call:pending, continuation:base64(packet)};
    },
  };
}
