/* features/share.js — share the app link and a canvas "study portrait" card. */

const PUBLIC_URL = 'https://beenotfound.github.io/cet-prep/';

export function shareUrl() {
  return /^(localhost|127\.0\.0\.1)$/.test(location.hostname)
    ? PUBLIC_URL
    : `${location.origin}${location.pathname}`;
}

/** WeChat / QQ in-app browsers block the Web Share API and most downloads. */
export function isInAppBrowser() {
  return /MicroMessenger|QQ\/|Weibo/i.test(navigator.userAgent);
}

export function dataUrlToBlob(dataUrl) {
  const [head, b64] = String(dataUrl).split(',');
  const mime = (head.match(/:(.*?);/) || [, 'image/png'])[1];
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

const INK = '#1E1E1E';
const PAPER = '#FFF8E7';
const PAPER_CARD = '#FFFDF6';

function rr(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

function paperCard(g, x, y, w, h, r, fill, shadow = true) {
  if (shadow) {
    g.fillStyle = INK;
    rr(g, x + 10, y + 10, w, h, r);
    g.fill();
  }
  g.fillStyle = fill;
  rr(g, x, y, w, h, r);
  g.fill();
  g.lineWidth = 6;
  g.strokeStyle = INK;
  g.stroke();
}

function label(g, text, x, y, size, color = INK, weight = 900, align = 'center') {
  g.fillStyle = color;
  g.font = `${weight} ${size}px -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif`;
  g.textAlign = align;
  g.textBaseline = 'middle';
  g.fillText(text, x, y);
}

function dots(g, W, H) {
  g.fillStyle = 'rgba(30,30,30,0.08)';
  for (let y = 24; y < H; y += 34) {
    for (let x = 24; x < W; x += 34) {
      g.beginPath();
      g.arc(x, y, 1.8, 0, Math.PI * 2);
      g.fill();
    }
  }
}

/**
 * stats: { known, total, coverage, streak, days, reviewing, examIn, level, theta }
 * Returns a 1080x1350 canvas.
 */
export function buildCard(stats) {
  const W = 1080;
  const H = 1350;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const g = canvas.getContext('2d');

  g.fillStyle = PAPER;
  g.fillRect(0, 0, W, H);
  dots(g, W, H);

  // washi tape
  g.save();
  g.translate(W / 2, 62);
  g.rotate(-0.05);
  g.fillStyle = 'rgba(255,214,120,0.9)';
  g.fillRect(-130, -26, 260, 52);
  g.restore();

  label(g, '四六级剪贴本', W / 2, 148, 66);
  label(g, '我的学习画像', W / 2, 212, 30, '#55504A', 700);

  // main number card
  g.save();
  g.translate(W / 2, 520);
  g.rotate(-0.018);
  paperCard(g, -460, -240, 920, 480, 34, PAPER_CARD);
  label(g, '预计已掌握', 0, -150, 38, '#55504A', 800);
  label(g, String(stats.known ?? 0), 0, -10, 168);
  label(g, `/ ${stats.total ?? 0} 个候选词`, 0, 108, 36, '#55504A', 700);
  label(g, `目标 ${stats.level === 'cet4' ? '四级' : stats.level === 'both' ? '四六级' : '六级'}  ·  θ ${Number(stats.theta || 0).toFixed(1)}`, 0, 182, 28, '#8B8479', 700);
  g.restore();

  // sticker
  g.save();
  g.translate(918, 292);
  g.rotate(0.08);
  g.fillStyle = '#FFC93C';
  g.beginPath();
  g.arc(0, 0, 76, 0, Math.PI * 2);
  g.fill();
  g.lineWidth = 6;
  g.strokeStyle = INK;
  g.stroke();
  label(g, `${stats.streak ?? 0}`, 0, -8, 58);
  label(g, '天连续', 0, 40, 22, INK, 800);
  g.restore();

  // stat grid
  const cells = [
    { label: '阅读覆盖率', value: `${Math.round((stats.coverage || 0) * 100)}%`, fill: '#FFF6D8' },
    { label: '已进入复习', value: String(stats.reviewing ?? 0), fill: '#E8F4FF' },
    { label: '学习天数', value: String(stats.days ?? 0), fill: '#E6FBEF' },
    { label: '距考试', value: stats.examIn == null ? '—' : `${stats.examIn} 天`, fill: '#FFEEF4' },
  ];
  const cols = [64, 556];
  const rows = [820, 1010];
  cells.forEach((cell, i) => {
    const x = cols[i % 2];
    const y = rows[Math.floor(i / 2)];
    paperCard(g, x, y, 460, 160, 26, cell.fill);
    label(g, cell.label, x + 230, y + 52, 30, '#55504A', 800);
    label(g, cell.value, x + 230, y + 112, 62);
  });

  label(g, shareUrl().replace(/^https?:\/\//, ''), W / 2, 1250, 30, '#8B8479', 600);
  return canvas;
}

function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function saveBlob(blob, name = '四六级剪贴本.png') {
  download(blob, name);
  return 'saved';
}

/** The system share sheet is only worth using on touch devices; on Windows it is unreliable. */
export function prefersSystemShare() {
  try {
    return typeof navigator.share === 'function' && window.matchMedia('(pointer: coarse)').matches;
  } catch {
    return false;
  }
}

/**
 * Call this directly from a click handler: on iOS the share sheet must be opened
 * synchronously, before any await, or the user activation is gone.
 */
export async function shareFile(file) {
  if (prefersSystemShare() && navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: '四六级剪贴本', text: '我的学习画像' });
      return 'shared';
    } catch (error) {
      if (error?.name === 'AbortError') return 'cancelled';
    }
  }
  download(file, '四六级剪贴本.png');
  return 'downloaded';
}

export async function saveCard(stats) {
  const blob = await new Promise((resolve) => buildCard(stats).toBlob(resolve, 'image/png'));
  download(blob, '四六级剪贴本.png');
  return 'saved';
}

export async function shareApp() {
  if (isInAppBrowser()) return 'inapp';
  const url = shareUrl();
  const text = '先测后学，只学你还没掌握的四六级词汇';
  if (prefersSystemShare()) {
    try {
      await navigator.share({ title: '四六级剪贴本', text, url });
      return 'shared';
    } catch (error) {
      if (error?.name === 'AbortError') return 'cancelled';
    }
  }
  await copyText(`${text} ${url}`);
  return 'copied';
}

export function copyText(text) {
  if (navigator.clipboard?.writeText) {
    return navigator.clipboard.writeText(text).catch(() => fallbackCopy(text));
  }
  return fallbackCopy(text);
}

function fallbackCopy(text) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  try { document.execCommand('copy'); } catch { /* ignore */ }
  ta.remove();
  return Promise.resolve();
}
