/* core/telemetry.js — 匿名事件上报（不含任何学习内容 / 个人信息）。
 * 只上报：随机匿名 ID、事件名、页面路径、少量计数。
 * 关闭方式：localStorage.setItem('cet.telemetry', 'off')，或浏览器开启 DNT/GPC。
 */

const ENDPOINT = '/api/e';
const CID_KEY = 'cet.telemetry.cid';
const SESSION_KEY = 'cet.telemetry.sid';
const OUT_KEY = 'cet.telemetry';
const disabled = (() => {
  // GitHub Pages 备用站没有 /api/e，避免无意义 404
  if (location.hostname.endsWith('github.io')) return true;
  try {
    if (localStorage.getItem(OUT_KEY) === 'off') return true;
  } catch { /* private mode */ }
  return navigator.doNotTrack === '1' || navigator.globalPrivacyControl === true;
})();

function uuid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

let cid = null;
let sid = null;
try {
  cid = localStorage.getItem(CID_KEY);
  if (!cid) { cid = uuid(); localStorage.setItem(CID_KEY, cid); }
  sid = sessionStorage.getItem(SESSION_KEY);
  if (!sid) { sid = uuid(); sessionStorage.setItem(SESSION_KEY, sid); }
} catch { /* storage blocked: no id, still aggregate events */ }

let queue = [];
let timer = null;

function flush() {
  if (!queue.length) return;
  const batch = queue.splice(0, 20);
  const body = JSON.stringify(batch);
  try {
    if (navigator.sendBeacon) {
      navigator.sendBeacon(ENDPOINT, new Blob([body], { type: 'text/plain' }));
    } else {
      fetch(ENDPOINT, { method: 'POST', body, keepalive: true, headers: { 'Content-Type': 'text/plain' } }).catch(() => {});
    }
  } catch { /* never block UI */ }
}

function schedule() {
  if (timer) return;
  timer = setTimeout(() => { timer = null; flush(); }, 800);
}

export function track(ev, props = {}) {
  if (disabled || !ev) return;
  queue.push({ cid: cid || '', sid: sid || '', ev: String(ev).slice(0, 32), path: location.pathname, ts: Math.floor(Date.now() / 1000), props });
  if (queue.length >= 10) flush();
  else schedule();
}

export function trackOncePerSession(ev, props = {}) {
  const key = `cet.telemetry.once.${ev}`;
  try {
    if (sessionStorage.getItem(key)) return;
    sessionStorage.setItem(key, '1');
  } catch { /* ignore */ }
  track(ev, props);
}

export function setTelemetryOptOut(off) {
  try {
    if (off) localStorage.setItem(OUT_KEY, 'off');
    else localStorage.removeItem(OUT_KEY);
  } catch { /* ignore */ }
}

export function telemetryOptedOut() {
  try { return localStorage.getItem(OUT_KEY) === 'off'; } catch { return false; }
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });
  window.addEventListener('pagehide', flush);
}
