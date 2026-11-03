export const providerMessages = {
  'zh-CN': {
    limit: '已达到本次助手查询上限，请缩小范围重试。',
    instruction: '请输入 1–2000 字的战术指令。',
    settings: '请填写有效的模型名称和 API Key。',
    unsupported: '此服务商不支持浏览器直连。',
    invalid: '模型返回了无效的操作或未知对象。请补充目标后重试。',
    network: '无法连接模型服务。请检查网络和服务商的浏览器跨域设置。',
    timeout: '模型响应超时，请重试。',
    failed: '模型请求失败，请检查模型名称、API Key 和账户额度。',
  },
  en: {
    limit: 'The assistant reached its query limit. Narrow the request and try again.',
    instruction: 'Enter a board instruction of 1–2000 characters.',
    settings: 'Enter a valid model ID and API key.',
    unsupported: 'This provider is unavailable in the browser.',
    invalid: 'The model returned an invalid operation or an unknown object. Clarify the target and try again.',
    network: 'Could not reach the provider. Check the connection and browser CORS settings.',
    timeout: 'The provider timed out. Try again.',
    failed: 'Model request failed. Check the model ID, API key and available credit.',
  },
};
