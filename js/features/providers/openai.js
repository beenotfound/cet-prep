/* features/providers/openai.js — OpenAI-compatible chat endpoint.
   Works for OpenAI, DeepSeek, 豆包/方舟 v3, 通义, GLM, Kimi, and any compatible gateway. */

export class ProviderError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ProviderError';
    this.code = code;
  }
}

function endpoint(baseUrl) {
  const base = String(baseUrl || '').trim().replace(/\/+$/, '');
  if (!base) throw new ProviderError('CONFIG', '还没有填写 API 地址');
  if (/\/chat\/completions$/.test(base)) return base;
  return `${base}/chat/completions`;
}

export async function chat({ baseUrl, apiKey, model, messages, signal, maxTokens = 900 }) {
  if (!apiKey) throw new ProviderError('CONFIG', '还没有填写 API Key');
  if (!model) throw new ProviderError('CONFIG', '还没有填写模型名');

  let res;
  try {
    res = await fetch(endpoint(baseUrl), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model, messages, temperature: 0.6, max_tokens: maxTokens, stream: false }),
      signal,
    });
  } catch (error) {
    if (error?.name === 'AbortError') throw error;
    throw new ProviderError('CORS', '浏览器直连被拦截（CORS）或网络不可用。可换用"复制提示词"，或填一个代理地址。');
  }

  if (!res.ok) {
    let detail = '';
    try { detail = (await res.json())?.error?.message || ''; } catch { /* ignore */ }
    if (!detail) { try { detail = (await res.text()).slice(0, 200); } catch { /* ignore */ } }
    const hint = res.status === 401 || res.status === 403 ? '密钥无效或无权限'
      : res.status === 429 ? '触发限流或余额不足'
      : res.status === 404 ? '接口地址或模型名不对'
      : '请求失败';
    throw new ProviderError(`HTTP_${res.status}`, `${hint}（${res.status}）${detail ? '：' + detail : ''}`);
  }

  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content;
  if (!text) throw new ProviderError('EMPTY', '模型没有返回文本');
  return {
    text: String(text).trim(),
    usage: {
      input: data?.usage?.prompt_tokens ?? 0,
      output: data?.usage?.completion_tokens ?? 0,
    },
  };
}

export async function ping({ baseUrl, apiKey, model }) {
  const result = await chat({
    baseUrl, apiKey, model, maxTokens: 8,
    messages: [{ role: 'user', content: 'Reply with the single word: ok' }],
  });
  return result.text;
}
