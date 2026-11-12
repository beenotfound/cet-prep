/* core/store.js — the only module that touches localStorage. */

export const SCHEMA_VERSION = 2;

/** Repair states written by the old study loop, which inflated theta. */
function migrate(state) {
  if (!state.v || state.v < 2) {
    if (typeof state.theta === 'number' && state.theta > 8.8) {
      state.theta = 5.2;
      state.calib = { at: null, se: null, items: 0, spot: null };
      if (state.profile) state.profile.onboarded = false;
    }
    state.v = SCHEMA_VERSION;
  }
  return state;
}

export function defaultExamDate(now = new Date()) {
  // CET exams are held around the third Saturday of December.
  const year = now.getFullYear();
  const make = (y) => {
    const d = new Date(y, 11, 1);
    const firstSaturday = 1 + ((6 - d.getDay() + 7) % 7);
    return new Date(y, 11, firstSaturday + 14);
  };
  let target = make(year);
  if (target.getTime() < now.getTime()) target = make(year + 1);
  const p = (n) => String(n).padStart(2, '0');
  return `${target.getFullYear()}-${p(target.getMonth() + 1)}-${p(target.getDate())}`;
}

export function defaults() {
  return {
    v: SCHEMA_VERSION,
    profile: { level: 'cet6', examDate: defaultExamDate(), dailyNew: 20, onboarded: false },
    theta: 5.2,
    calib: { at: null, se: null, items: 0, spot: null },
    words: {},
    stats: { days: {}, streak: 0, lastDay: null },
    wrong: {},
    fav: [],
    read: [],
    papers: {},
    custom: [],
    ai: { provider: 'deepseek', baseUrl: '', key: '', model: '', sessionTokens: 0, budget: 0, remember: false },
    ui: { tab: 'today' },
  };
}

function fillDefaults(target, base) {
  for (const [key, value] of Object.entries(base)) {
    if (target[key] == null) target[key] = value;
    else if (value && typeof value === 'object' && !Array.isArray(value) && typeof target[key] === 'object') {
      fillDefaults(target[key], value);
    }
  }
  return target;
}

export function createStore({ key = 'cetcollage.v1', onError } = {}) {
  const base = defaults();
  let state = base;
  const listeners = new Set();
  let saveTimer = null;
  let dirty = false;
  let needsSave = false;

  try {
    const raw = localStorage.getItem(key);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        const previousVersion = parsed.v;
        state = migrate(fillDefaults(parsed, defaults()));
        needsSave = previousVersion !== state.v;
      }
    }
  } catch (error) {
    try { localStorage.setItem(`${key}.bak`, localStorage.getItem(key) || ''); } catch { /* ignore */ }
    onError?.('本地数据损坏，已重置并备份', error);
    state = defaults();
  }

  function persist() {
    saveTimer = null;
    if (!dirty) return;
    dirty = false;
    try {
      localStorage.setItem(key, JSON.stringify(state));
    } catch (error) {
      onError?.('本地存储写入失败（可能空间不足），请导出备份', error);
    }
  }

  function schedule() {
    dirty = true;
    if (saveTimer) return;
    saveTimer = setTimeout(persist, 300);
  }

  function flush() {
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
    persist();
  }

  if (needsSave) {
    dirty = true;
    persist();   // write the migrated state back immediately
  }

  if (typeof window !== 'undefined') {
    window.addEventListener('pagehide', flush);
    window.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });
  }

  return {
    get: () => state,
    /** Replace top-level slices. Nested mutation goes through actions + touch(). */
    patch(partial) {
      Object.assign(state, partial);
      state.v = SCHEMA_VERSION;
      schedule();
    },
    touch: schedule,
    flush,
    replace(next) {
      const fresh = fillDefaults(next, defaults());
      fresh.v = SCHEMA_VERSION;
      state = fresh;
      schedule();
      sync();
      return state;
    },
    reset() {
      state = defaults();
      try { localStorage.removeItem(key); } catch { /* ignore */ }
      schedule();
      sync();
      return state;
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    sync() {
      for (const fn of listeners) fn(state);
    },
  };
}
