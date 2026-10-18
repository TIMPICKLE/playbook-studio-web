export const MAX_BODY = 950_000;
export class ApiError extends Error { constructor(status, message) { super(message); this.status = status; } }
export const fail = (status, message) => { throw new ApiError(status, message); };
export const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store, private', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', ...headers } });
export async function readJson(request, limit = MAX_BODY) {
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) fail(415, '请使用 JSON 请求');
  if (Number(request.headers.get('content-length')) > limit) fail(413, '内容过大，请拆分战术本或导出备份');
  const reader = request.body?.getReader(); if (!reader) fail(400, '请求为空');
  const chunks = []; let size = 0;
  while (true) { const { value, done } = await reader.read(); if (done) break; size += value.byteLength; if (size > limit) { await reader.cancel(); fail(413, '内容过大，请拆分战术本或导出备份'); } chunks.push(value); }
  const bytes = new Uint8Array(size); let offset = 0; for (const c of chunks) { bytes.set(c, offset); offset += c.byteLength; }
  let body; try { body = JSON.parse(new TextDecoder().decode(bytes)); } catch { fail(400, 'JSON 格式不正确'); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) fail(400, '请求内容须为 JSON 对象');
  return body;
}
