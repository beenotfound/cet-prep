/* core/api.js — static JSON loading with timeout + retry. */

export class ApiError extends Error {
  constructor(code, message, cause) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.cause = cause;
  }
}

const cache = new Map();

export async function loadJSON(url, { timeout = 20000, retry = 2, useCache = true } = {}) {
  if (useCache && cache.has(url)) return cache.get(url);
  let lastError;
  for (let attempt = 0; attempt <= retry; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const res = await fetch(url, { signal: controller.signal, cache: 'no-cache' });
      if (!res.ok) throw new ApiError('HTTP', `${url} 返回 ${res.status}`);
      const data = await res.json();
      if (useCache) cache.set(url, data);
      return data;
    } catch (error) {
      lastError = error;
      if (attempt < retry) await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
    } finally {
      clearTimeout(timer);
    }
  }
  if (lastError instanceof ApiError) throw lastError;
  const reason = lastError?.name === 'AbortError' ? '请求超时' : '网络不可用';
  throw new ApiError('NETWORK', `${reason}，请检查网络后重试`, lastError);
}
