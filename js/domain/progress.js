/* domain/progress.js — practice history, item-selection strategy and wrong-book entries. */

const TYPE_LABEL = {
  reading: '仔细阅读', cloze: '选词填空', matching: '长篇匹配',
  translation: '翻译', writing: '写作',
  w2m: '词汇', m2w: '词汇', fill: '词汇', spell: '词汇',
};

export function wrongKey(itemId, index) {
  return `${itemId}:${index}`;
}

function letter(value) {
  return typeof value === 'number' ? String.fromCharCode(65 + value) : String(value ?? '');
}

/** Build wrong-book entries from one answered item. Returns [] when all correct. */
export function wrongEntriesFromItem(item, entry) {
  if (!item || !entry) return [];
  const details = entry.detail || [];
  const now = Date.now();
  const out = [];
  details.forEach((d, i) => {
    if (d.ok) return;
    const base = { itemId: item.id, qIndex: i, type: item.type, lastAt: now };
    if (item.type === 'reading') {
      const q = item.questions?.[i];
      out.push({ ...base, prompt: q?.q || '', mine: letter(entry.response?.[i]), correct: letter(q?.answer), explain: d.explain || q?.explain || '' });
    } else if (item.type === 'cloze') {
      const b = item.blanks?.[i];
      out.push({ ...base, prompt: `第 ${i + 1} 空`, mine: String(entry.response?.[i] ?? ''), correct: String(b?.answer ?? ''), explain: d.explain || b?.explain || '' });
    } else if (item.type === 'matching') {
      const s = item.statements?.[i];
      out.push({ ...base, prompt: s?.text || '', mine: letter(entry.response?.[i]), correct: String(s?.answer ?? ''), explain: d.explain || '' });
    } else if (item.type === 'w2m' || item.type === 'm2w' || item.type === 'fill') {
      const mine = item.options?.[entry.response] ?? entry.response;
      const correct = item.options?.[item.answer] ?? item.answer;
      out.push({ ...base, prompt: item.prompt || '', mine: String(mine ?? ''), correct: String(correct ?? ''), explain: '' });
    } else if (item.type === 'spell') {
      out.push({ ...base, prompt: item.prompt || '', mine: String(entry.response ?? ''), correct: String(item.answer ?? ''), explain: '' });
    }
  });
  return out;
}

/**
 * Pick items for a practice set.
 * mode: random | unseen | wrong
 * seen: { itemId: { lastAt, wrong } }
 */
export function choosePracticeItems(pool, mode, seen, count, rng = Math.random) {
  let candidates = (pool || []).slice();
  if (mode === 'wrong') {
    candidates = candidates.filter((item) => (seen?.[item.id]?.wrong || 0) > 0);
  } else if (mode === 'unseen') {
    const fresh = candidates.filter((item) => !seen?.[item.id]);
    if (fresh.length) candidates = fresh;
  }
  for (let i = candidates.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
  }
  return candidates.slice(0, count);
}

export function typeLabel(type) {
  return TYPE_LABEL[type] || type;
}
