// Shared HTTP contracts for the browser editor and Worker analysis agent.
// Sources: OpenAI Responses migration/function-calling docs and Anthropic's
// Messages tool-call lifecycle. Application permissions and persistence stay
// with the caller; this module only translates protocol data.
export const PROTOCOL_OPTIONS = Object.freeze({
  openai: 'OpenAI Chat Completions', anthropic: 'Anthropic Messages', responses: 'OpenAI Responses',
});
export const MODEL_PROVIDER_PRESETS = Object.freeze({
  openai: {label:'OpenAI', protocols:['openai','responses'], defaultProtocol:'openai', defaultModel:'gpt-6.1-terra', endpoints:{openai:'https://api.openai.com/v1/chat/completions',responses:'https://api.openai.com/v1/responses'}},
  deepseek: {label:'DeepSeek', protocols:['openai','anthropic'], defaultProtocol:'openai', defaultModel:'deepseek-flash', endpoints:{openai:'https://api.deepseek.com/chat/completions',anthropic:'https://api.deepseek.com/anthropic/v1/messages'}},
  anthropic: {label:'Anthropic / Claude', protocols:['anthropic'], defaultProtocol:'anthropic', defaultModel:'claude-sonnet-4-6', endpoints:{anthropic:'https://api.anthropic.com/v1/messages'}},
  openrouter: {label:'OpenRouter', protocols:['openai','responses'], defaultProtocol:'openai', defaultModel:'openai/gpt-4o-mini', endpoints:{openai:'https://openrouter.ai/api/v1/chat/completions',responses:'https://openrouter.ai/api/v1/responses'}},
  custom: {label:'Custom', protocols:['openai','anthropic','responses'], defaultProtocol:'openai', defaultModel:'', endpoints:{}},
});
const aliases = {openai:'openai',chat:'openai',chat_completions:'openai','chat-completions':'openai','chat/completions':'openai',anthropic:'anthropic',messages:'anthropic',anthropic_messages:'anthropic','anthropic-messages':'anthropic',response:'responses',responses:'responses'};
const copy = value => structuredClone(value);
const error = (code, message) => { throw Object.assign(new Error(message), {code}); };
const invalid = message => error('MODEL_INVALID_RESPONSE', message || 'The model returned an invalid response.');
const toolError = () => error('MODEL_INVALID_TOOL','The model returned an invalid tool call.');
const object = value => value && typeof value === 'object' && !Array.isArray(value);

export function normalizeModelProtocol(value, provider = 'openai') {
  const preset = Object.hasOwn(MODEL_PROVIDER_PRESETS,provider) && MODEL_PROVIDER_PRESETS[provider];
  if (!preset) error('MODEL_CONFIGURATION','Choose a supported model provider.');
  const protocol = value == null || value === '' ? preset.defaultProtocol : aliases[String(value).trim().toLowerCase()];
  if (!protocol || !preset.protocols.includes(protocol)) error('MODEL_CONFIGURATION','Choose a protocol supported by this provider.');
  return protocol;
}

export function resolveModelEndpoint(config = {}) {
  const provider = typeof config.provider === 'string' ? config.provider.trim().toLowerCase() : 'openai';
  const protocol = normalizeModelProtocol(config.protocol, provider);
  const model = typeof config.model === 'string' ? config.model.trim() : '';
  const apiKey = typeof config.apiKey === 'string' ? config.apiKey.trim() : '';
  if (!model || model.length > 160 || /[\r\n]/.test(model)) error('MODEL_CONFIGURATION','Enter the model ID supplied by your provider.');
  if (!apiKey || apiKey.length > 512 || /[^\x21-\x7e]/.test(apiKey)) error('MODEL_CONFIGURATION','Enter a valid API key.');
  let endpoint = MODEL_PROVIDER_PRESETS[provider].endpoints[protocol];
  if (provider === 'custom') {
    const raw = typeof config.baseUrl === 'string' ? config.baseUrl.trim() : '';
    if (!raw || raw.length > 400) error('MODEL_CONFIGURATION','Enter a valid HTTPS API base URL.');
    let url;
    try { url = new URL(raw); } catch { error('MODEL_CONFIGURATION','Enter a valid HTTPS API base URL.'); }
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || (url.port && url.port !== '443'))
      error('MODEL_CONFIGURATION','Use an HTTPS API URL without credentials, query parameters or a custom port.');
    // A full endpoint may be pasted instead of a base. Changing the protocol
    // replaces its final suffix while retaining gateway prefixes such as /v1.
    const suffix = {openai:'/chat/completions',anthropic:'/messages',responses:'/responses'}[protocol];
    url.pathname = url.pathname.replace(/\/+$/, '').replace(/\/(?:chat\/completions|messages|responses)$/i, '') + suffix;
    endpoint = url.toString();
  }
  return {provider,protocol,endpoint,model,apiKey};
}

function toolName(choice) {
  return object(choice) ? choice.function?.name || choice.name : null;
}
function checkedCall(call) {
  if (!object(call) || call.type !== 'function' || typeof call.id !== 'string' || !call.id ||
      !object(call.function) || typeof call.function.name !== 'string' || !call.function.name || typeof call.function.arguments !== 'string') toolError();
  return copy(call);
}
function checkedCalls(calls) {
  if (!Array.isArray(calls)) toolError();
  const ids = new Set();
  return calls.map(call => {
    const checked = checkedCall(call);
    if (ids.has(checked.id)) toolError();
    ids.add(checked.id);
    return checked;
  });
}
function chatMessages(messages) {
  return messages.map(message => {
    const next = {role:message.role,content:message.content ?? null};
    if (message.role === 'tool') next.tool_call_id = message.tool_call_id;
    if (message.role === 'assistant') {
      if (message.tool_calls?.length) next.tool_calls = checkedCalls(message.tool_calls);
      if (typeof message.reasoning_content === 'string') next.reasoning_content = message.reasoning_content;
      if (Array.isArray(message.reasoning_details)) next.reasoning_details = copy(message.reasoning_details);
    }
    return next;
  });
}

function anthropicMessages(messages) {
  const out = [];
  for (const message of messages) {
    if (message.role === 'system' || message.role === 'developer') continue;
    if (message.role === 'tool') {
      if (typeof message.tool_call_id !== 'string' || !message.tool_call_id) toolError();
      const block = {type:'tool_result',tool_use_id:message.tool_call_id,content:typeof message.content === 'string' ? message.content : JSON.stringify(message.content)};
      const last = out.at(-1);
      if (last?.role === 'user' && Array.isArray(last.content) && last.content.every(item => item.type === 'tool_result')) last.content.push(block);
      else out.push({role:'user',content:[block]});
    } else if (message.role === 'assistant') {
      if (Array.isArray(message.anthropicContent)) out.push({role:'assistant',content:copy(message.anthropicContent)});
      else {
        const blocks = [];
        if (typeof message.content === 'string' && message.content) blocks.push({type:'text',text:message.content});
        for (const call of checkedCalls(message.tool_calls || [])) {
          let input;
          try { input = JSON.parse(call.function.arguments); } catch { toolError(); }
          if (!object(input)) toolError();
          blocks.push({type:'tool_use',id:call.id,name:call.function.name,input});
        }
        out.push({role:'assistant',content:blocks.length ? blocks : [{type:'text',text:' '}]});
      }
    } else if (message.role === 'user') out.push({role:'user',content:message.content});
    else invalid('Unsupported message role.');
  }
  return out;
}

function responseInput(messages) {
  const out = [];
  for (const message of messages) {
    if (message.role === 'system' || message.role === 'developer') continue;
    if (message.role === 'tool') {
      if (typeof message.tool_call_id !== 'string' || !message.tool_call_id) toolError();
      out.push({type:'function_call_output',call_id:message.tool_call_id,output:typeof message.content === 'string' ? message.content : JSON.stringify(message.content)});
    } else if (message.role === 'assistant' && Array.isArray(message.responsesOutput)) {
      // Keep encrypted reasoning, function call IDs and message items together.
      // Reconstructing this from text/tool_calls loses stateless continuation.
      out.push(...copy(message.responsesOutput));
    } else if (message.role === 'assistant') {
      // Synthetic repair messages are easy input messages, not fabricated
      // output message records (which can require server IDs and annotations).
      if (typeof message.content === 'string' && message.content) out.push({role:'assistant',content:message.content});
      for (const call of checkedCalls(message.tool_calls || [])) out.push({type:'function_call',call_id:call.id,name:call.function.name,arguments:call.function.arguments});
    } else if (message.role === 'user') out.push({role:'user',content:message.content});
    else invalid('Unsupported message role.');
  }
  return out;
}

export function buildModelRequest(config, messages, {tools = [], toolChoice = 'auto', maxTokens = 1800, browser = false, jsonOnly = false} = {}) {
  const protocol = normalizeModelProtocol(config.protocol,config.provider);
  if (!Array.isArray(messages) || !messages.length || !Number.isSafeInteger(maxTokens) || maxTokens < 1) invalid('Invalid model request.');
  const headers = {'Content-Type':'application/json'};
  const system = messages.filter(message => ['system','developer'].includes(message.role)).map(message => message.content).filter(Boolean).join('\n');
  const named = toolName(toolChoice);
  const definitions = tools.map(tool => tool.function || tool);
  let body;
  if (protocol === 'anthropic') {
    headers['x-api-key'] = config.apiKey;
    headers['anthropic-version'] = '2023-06-01';
    let directAnthropic = config.provider === 'anthropic';
    if (browser && !directAnthropic) {
      try { directAnthropic = new URL(config.endpoint).hostname === 'api.anthropic.com'; }
      catch { /* Pure request-builder callers may not supply an endpoint. */ }
    }
    if (browser && directAnthropic) headers['anthropic-dangerous-direct-browser-access'] = 'true';
    body = {model:config.model,system,messages:anthropicMessages(messages),max_tokens:maxTokens,stream:false};
    if (definitions.length) {
      body.tools = definitions.map(fn => ({name:fn.name,description:fn.description || '',input_schema:copy(fn.parameters)}));
      body.tool_choice = named ? {type:'tool',name:named} : {type:toolChoice === 'required' ? 'any' : toolChoice};
    }
  } else if (protocol === 'responses') {
    headers.Authorization = `Bearer ${config.apiKey}`;
    body = {model:config.model,instructions:system,input:responseInput(messages),max_output_tokens:maxTokens,store:false,include:['reasoning.encrypted_content'],stream:false};
    if (definitions.length) {
      // The editor schema uses optional fields: never silently normalize these
      // into required nullable fields or enable strict mode at this boundary.
      body.tools = definitions.map(fn => ({type:'function',name:fn.name,description:fn.description || '',parameters:copy(fn.parameters),strict:false}));
      body.tool_choice = named ? {type:'function',name:named} : toolChoice;
    }
    if (jsonOnly) body.text = {format:{type:'json_object'}};
    if (config.provider === 'openai' && config.model === 'gpt-6.1-terra') body.reasoning = {effort:'none'};
  } else {
    headers.Authorization = `Bearer ${config.apiKey}`;
    body = {model:config.model,messages:chatMessages(messages),stream:false,...(config.provider === 'openai' ? {max_completion_tokens:maxTokens} : {max_tokens:maxTokens})};
    if (definitions.length) {
      body.tools = definitions.map(fn => ({type:'function',function:copy(fn)}));
      body.tool_choice = named ? {type:'function',function:{name:named}} : toolChoice;
    }
    if (jsonOnly) body.response_format = {type:'json_object'};
    if (config.provider === 'openai' && config.model === 'gpt-6.1-terra') body.reasoning_effort = 'none';
  }
  if (config.provider === 'deepseek') body.thinking = {type:'disabled'};
  return {headers,body};
}

function normalized(content, calls, extra = {}) {
  if (typeof content !== 'string' && content !== null) invalid();
  if (!content && !calls.length) invalid('The model returned neither text nor a tool call.');
  return {role:'assistant',content,...(calls.length ? {tool_calls:calls} : {}),...extra};
}

export function parseModelResponse(config, payload) {
  const protocol = normalizeModelProtocol(config.protocol,config.provider);
  if (!object(payload) || payload.error) invalid('The provider returned an error response.');
  if (protocol === 'anthropic') {
    if (payload.stop_reason === 'max_tokens') error('MODEL_TRUNCATED','The model response was truncated.');
    if (payload.stop_reason === 'refusal') error('MODEL_REFUSAL','The model refused the request.');
    if (!Array.isArray(payload.content) || payload.content.some(block => !object(block) || !['text','tool_use','thinking','redacted_thinking'].includes(block.type))) invalid();
    const calls = checkedCalls(payload.content.filter(block => block.type === 'tool_use').map(block => {
      if (!object(block.input)) toolError();
      return {id:block.id,type:'function',function:{name:block.name,arguments:JSON.stringify(block.input)}};
    }));
    if (payload.stop_reason != null && ((payload.stop_reason === 'tool_use') !== (calls.length > 0))) invalid('The provider returned an invalid tool-call stop reason.');
    const blocks = payload.content.filter(block => block.type === 'text');
    if (blocks.some(block => typeof block.text !== 'string')) invalid();
    return normalized(blocks.map(block => block.text).join('\n'),calls,{anthropicContent:copy(payload.content)});
  }
  if (protocol === 'responses') {
    if (payload.status === 'incomplete' || payload.incomplete_details) error('MODEL_TRUNCATED','The model response was incomplete or truncated.');
    if (payload.status != null && payload.status !== 'completed') invalid('The provider response did not complete.');
    if (!Array.isArray(payload.output) || payload.output.some(item => !object(item) || !['message','function_call','reasoning'].includes(item.type))) invalid();
    const calls = [], texts = [];
    for (const item of payload.output) {
      if (item.status === 'incomplete' || item.status === 'in_progress') error('MODEL_TRUNCATED','The model response was incomplete or truncated.');
      if (item.type === 'function_call') calls.push({id:item.call_id,type:'function',function:{name:item.name,arguments:item.arguments}});
      if (item.type === 'message') {
        if (item.role !== 'assistant' || !Array.isArray(item.content)) invalid();
        for (const block of item.content) {
          if (block?.type === 'refusal') error('MODEL_REFUSAL','The model refused the request.');
          if (block?.type !== 'output_text' || typeof block.text !== 'string') invalid();
          texts.push(block.text);
        }
      }
    }
    return normalized(texts.join('') || null,checkedCalls(calls),{responsesOutput:copy(payload.output)});
  }
  const choice = payload.choices?.[0], message = choice?.message;
  if (choice?.finish_reason === 'length') error('MODEL_TRUNCATED','The model response was truncated.');
  if (choice?.finish_reason === 'content_filter' || message?.refusal) error('MODEL_REFUSAL','The model refused the request.');
  if (!object(message)) invalid();
  const calls = message.tool_calls == null ? [] : checkedCalls(message.tool_calls);
  let content = message.content ?? null;
  if (Array.isArray(content)) {
    if (content.some(block => block?.type !== 'text' || typeof block.text !== 'string')) invalid();
    content = content.map(block => block.text).join('\n');
  }
  return normalized(content,calls,{
    ...(typeof message.reasoning_content === 'string' ? {reasoning_content:message.reasoning_content} : {}),
    ...(Array.isArray(message.reasoning_details) ? {reasoning_details:copy(message.reasoning_details)} : {}),
  });
}

export function parseModelUsage(config, payload) {
  const protocol = normalizeModelProtocol(config.protocol,config.provider), usage = payload?.usage;
  const inputTokens = protocol === 'openai' ? usage?.prompt_tokens : usage?.input_tokens;
  const outputTokens = protocol === 'openai' ? usage?.completion_tokens : usage?.output_tokens;
  return Number.isSafeInteger(inputTokens) && inputTokens >= 0 && Number.isSafeInteger(outputTokens) && outputTokens >= 0 ? {inputTokens,outputTokens} : null;
}
