/* domain/pairing.js — pair a mock paper with a listening set at runtime.
 * No content edits: papers stay listening-free; the pairing is stored on the attempt.
 */

export function paperYearOf(paper, contentById) {
  if (!paper) return null;
  const years = new Set();
  for (const section of paper.sections || []) {
    for (const id of section.ids || []) {
      const item = contentById?.get?.(id) || contentById?.[id];
      const raw = item?.paperYear;
      if (!raw) continue;
      const m = String(raw).match(/^(\d{4})-(\d{1,2})$/);
      if (m) years.add(`${m[1]}-${String(m[2]).padStart(2, '0')}`);
    }
  }
  const list = [...years].sort().reverse();
  return list[0] || null;
}

const monthIndex = (year, month) => Number(year) * 12 + (Number(month) - 1);

function setMonthIndex(set) {
  if (!set || !Number.isFinite(Number(set.year)) || !Number.isFinite(Number(set.month))) return null;
  return monthIndex(set.year, set.month);
}

/** Returns { set, pairing } where pairing is explicit|same-month|nearest-month|latest|none. */
function levelKey(value) {
  const raw = String(value ?? '').toLowerCase();
  if (raw === '4' || raw === 'cet4') return 'cet4';
  if (raw === '6' || raw === 'cet6') return 'cet6';
  return raw;
}

export function pairListening(paper, sets, contentById) {
  const targetLevel = levelKey(paper?.level);
  const pool = (sets || []).filter((s) => s && s.sections && s.sections.length && levelKey(s.level) === targetLevel);
  if (!pool.length) return { set: null, pairing: 'none' };

  const byLatest = pool.slice().sort((a, b) => (setMonthIndex(b) ?? 0) - (setMonthIndex(a) ?? 0));
  const explicitId = paper?.listeningSetId;
  if (explicitId) {
    const explicit = pool.find((s) => s.id === explicitId);
    if (explicit) return { set: explicit, pairing: 'explicit' };
  }

  const y = paperYearOf(paper, contentById);
  if (!y) return { set: byLatest[0], pairing: 'latest' };

  const m = String(y).match(/^(\d{4})-(\d{2})$/);
  if (!m) return { set: byLatest[0], pairing: 'latest' };
  const target = monthIndex(m[1], m[2]);
  const exact = pool.find((s) => setMonthIndex(s) === target);
  if (exact) return { set: exact, pairing: 'same-month' };

  const withIndex = pool
    .map((s) => ({ s, i: setMonthIndex(s) }))
    .filter((x) => Number.isFinite(x.i))
    .sort((a, b) => Math.abs(a.i - target) - Math.abs(b.i - target) || b.i - a.i);
  if (withIndex.length) return { set: withIndex[0].s, pairing: 'nearest-month' };
  return { set: byLatest[0], pairing: 'latest' };
}

export function pairingLabel(pairing) {
  return {
    explicit: '指定搭配',
    'same-month': '同场次搭配',
    'nearest-month': '最近场次搭配',
    latest: '最新听力搭配',
    none: '暂无听力',
    manual: '手动选择',
  }[pairing] || '';
}
