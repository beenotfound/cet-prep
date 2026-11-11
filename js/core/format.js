/* core/format.js — pure display formatting. */

export function pct(x, digits = 0) {
  if (!Number.isFinite(x)) return '—';
  return `${(x * 100).toFixed(digits)}%`;
}

export function num(x) {
  return Number(x || 0).toLocaleString('zh-CN');
}

export function clock(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function daysUntil(dateStr, now = Date.now()) {
  if (!dateStr) return null;
  const target = new Date(`${dateStr}T00:00:00`).getTime();
  if (!Number.isFinite(target)) return null;
  return Math.ceil((target - now) / 86400000);
}

export function intervalLabel(days) {
  if (days == null) return '新词';
  if (days < 1 / 24) return '稍后重来';
  if (days < 1) return `${Math.round(days * 24)} 小时`;
  if (days < 30) return `${Math.round(days)} 天`;
  if (days < 365) return `${(days / 30).toFixed(1)} 个月`;
  return `${(days / 365).toFixed(1)} 年`;
}

export function weekday(now = new Date()) {
  return ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][now.getDay()];
}
