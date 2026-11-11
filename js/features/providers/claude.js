/* features/providers/claude.js — Anthropic Messages API.
   Browser calls require the anthropic-dangerous-direct-browser-access header. */

import { ProviderError } from './openai.js';

function endpoint(baseUrl) {
  const base = String(baseUrl || '').trim().replace(/\/+$/, '');
  if (!base) throw new ProviderError('CONFIG', '还没有填写 API 地址');
  if (/\/messages$/.test(base)) return base;
  return `${base}/messages`;
}

export async function chat({ baseUrl, apiKey, model, messages, signal, maxTokens = 900 }) {
  if (!apiKey) throw new ProviderError('CONFIG', '还没有填写 API Key');
  if (!model) throw new ProviderError('CONFIG', '还没有填写模型名');

  const system = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n');
  const rest = messages.filter((m) => m.role !== 'system');

  let res;
  try {
    res = await fetch(endpoint(baseUrl), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({ model, max_tokens: maxTokens, system, messages: rest }),
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
    const hint = res.status === 401 ? '密钥无效'
      : res.status === 429 ? '触发限流或余额不足'
      : res.status === 404 ? '接口地址或模型名不对'
      : '请求失败';
    throw new ProviderError(`HTTP_${res.status}`, `${hint}（${res.status}）${detail ? '：' + detail : ''}`);
  }

  const data = await res.json();
  const text = (data?.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
  if (!text) throw new ProviderError('EMPTY', '模型没有返回文本');
  return {
    text: text.trim(),
    usage: { input: data?.usage?.input_tokens ?? 0, output: data?.usage?.output_tokens ?? 0 },
  };
}

export async function ping({ baseUrl, apiKey, model }) {
  const r = await chat({ baseUrl, apiKey, model, maxTokens: 8, messages: [{ role: 'user', content: 'Reply with: ok' }] });
  return r.text;
}
