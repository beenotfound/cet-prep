/* core/api.js — static data loading with gzip, timeout and retry. */

export class ApiError extends Error {
  constructor(code, message, cause) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.cause = cause;
  }
}

const cache = new Map();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function canGzip() {
  return typeof DecompressionStream === 'function' && typeof Response === 'function';
}

async function loadGzip(url, timeout) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(`${url}.gz`, { signal: controller.signal });
    if (!res.ok || !res.body) throw new ApiError('HTTP', `${url}.gz 返回 ${res.status}`);
    const stream = res.body.pipeThrough(new DecompressionStream('gzip'));
    return JSON.parse(await new Response(stream).text());
  } finally {
    clearTimeout(timer);
  }
}

async function loadPlain(url, timeout) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new ApiError('HTTP', `${url} 返回 ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * loadJSON(url, { gzip, timeout, retry })
 * Tries the pre-compressed `<url>.gz` first (about 4x smaller), then falls back
 * to the plain JSON file. Timeout is generous because the word bank is ~2.3 MB.
 */
export async function loadJSON(url, { gzip = false, timeout = 60000, retry = 1, useCache = true } = {}) {
  if (useCache && cache.has(url)) return cache.get(url);
  let lastError;

  for (let attempt = 0; attempt <= retry; attempt++) {
    if (gzip && canGzip()) {
      try {
        const data = await loadGzip(url, timeout);
        cache.set(url, data);
        return data;
      } catch (error) {
        lastError = error;
      }
    }
    try {
      const data = await loadPlain(url, timeout);
      cache.set(url, data);
      return data;
    } catch (error) {
      lastError = error;
    }
    if (attempt < retry) await sleep(400 * (attempt + 1));
  }

  if (lastError instanceof ApiError) throw lastError;
  const reason = lastError?.name === 'AbortError' ? '网络太慢，请求超时' : '网络不可用';
  throw new ApiError('NETWORK', `${reason}，请检查网络后重试`, lastError);
}
