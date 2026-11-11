/*
 * engine.js — calibration + spaced repetition.
 *
 * Difficulty model
 *   Every word carries d = 0.8..9.5 (higher = harder), derived from Zipf frequency.
 *   A learner carries theta (ability). The probability the learner knows a word is
 *       p = 1 / (1 + 10^((d - theta) / 2))
 *   After every answer theta moves toward the answer (Elo): theta += K * (known - p).
 *   A per-word offset `o` lets individual words drift away from the global model.
 *
 * The point is not a score. It is to decide which words never enter the queue.
 */

export const ZONES = Object.freeze({ known: 0.85, unknown: 0.15 });

export function pKnow(d, theta, offset = 0) {
  return 1 / (1 + Math.pow(10, (d + offset - theta) / 2));
}

export function zoneOf(p) {
  if (p > ZONES.known) return 'known';
  if (p < ZONES.unknown) return 'unknown';
  return 'frontier';
}

export function clamp(x, lo, hi) {
  return Math.max(lo, Math.min(hi, x));
}

/* ---------------------------------------------------------------- answers */

export function recordAnswer(ctx, word, score) {
  const { theta, k } = ctx;
  const s = score === true ? 1 : score === false ? 0 : Number(score);
  const p = pKnow(word.d, theta, (ctx.state.words[word.w] || {}).o || 0);
  const nextTheta = clamp(theta + k * (s - p), -2, 12);
  const words = ctx.state.words;
  const w = words[word.w] || (words[word.w] = { seen: 0, wrong: 0, o: 0 });
  w.seen = (w.seen || 0) + 1;
  if (s < 0.5) w.wrong = (w.wrong || 0) + 1;
  // small per-word correction so repeated surprises stick ("眼熟" = neutral)
  w.o = clamp((w.o || 0) + (0.5 - s) * 0.5 * (1 - Math.abs(p - 0.5) * 2), -3, 3);
  ctx.theta = nextTheta;
  return nextTheta;
}

export function applyGrade(state, word, grade, now = Date.now()) {
  const w = state.words[word.w] || (state.words[word.w] = { seen: 0, wrong: 0, o: 0 });
  const DAY = 86400000;
  const ease = clamp(w.ease == null ? 2.5 : w.ease + ({ 0: -0.2, 1: -0.05, 2: 0, 3: 0.1 }[grade] ?? 0), 1.3, 3.2);
  const iv = w.iv || 0;
  let nextIv;
  if (grade === 0) nextIv = 10 / 1440;            // 10 minutes
  else if (grade === 1) nextIv = Math.max(0.5, iv * 1.2);
  else if (grade === 2) nextIv = iv ? Math.max(1, iv * ease) : 1;
  else nextIv = iv ? Math.max(3, iv * ease * 1.4) : 3;

  w.iv = nextIv;
  w.ease = ease;
  w.due = now + nextIv * DAY;
  w.reps = (w.reps || 0) + 1;
  w.g = grade;
  w.seen = (w.seen || 0) + 1;
  if (grade === 0) w.lapses = (w.lapses || 0) + 1;
  if (grade >= 2) w.lastOk = now;
  return w;
}

export function markKnown(state, word, manual = false) {
  const w = state.words[word.w] || (state.words[word.w] = { seen: 0, wrong: 0, o: 0 });
  w.k = 1;
  if (manual) w.m = 1;
  w.due = 0;
  w.iv = 0;
  return w;
}

export function unmarkKnown(state, word) {
  const w = state.words[word.w];
  if (w) { delete w.k; delete w.m; }
}

/* ---------------------------------------------------------------- selection */

export function eligibleWords(words, level) {
  if (level === 'cet4') return words.filter((w) => w.g.includes('cet4'));
  if (level === 'cet6') return words.filter((w) => w.g.includes('cet6'));
  return words;
}

function sharedPrefix(a, b) {
  const n = Math.min(a.length, b.length, 4);
  let i = 0;
  while (i < n && a[i] === b[i]) i++;
  return i;
}

/**
 * Calibration session. Feed words one at a time; stop on `done`.
 */
export class Calibrator {
  constructor(words, level, opts = {}) {
    this.pool = eligibleWords(words, level);
    this.theta = opts.theta ?? 5.2;
    this.k = opts.k ?? 0.9;
    this.maxItems = opts.maxItems ?? 24;
    this.answers = [];
    this.asked = new Set();
    this.lastWord = null;
    this.se = 1.6;
  }

  get progress() { return Math.min(1, this.answers.length / this.maxItems); }
  get done() { return this.answers.length >= this.maxItems || (this.answers.length >= 12 && this.se < 0.42); }

  next() {
    const cand = [];
    for (const w of this.pool) {
      if (this.asked.has(w.w)) continue;
      const p = pKnow(w.d, this.theta);
      if (this.lastWord && sharedPrefix(w.w, this.lastWord) >= 3) continue;
      cand.push({ w, p, score: Math.abs(p - 0.5) });
    }
    if (!cand.length) return null;
    cand.sort((a, b) => a.score - b.score);
    const top = cand.slice(0, 14);
    const pick = top[Math.floor(Math.random() * top.length)];
    this.asked.add(pick.w.w);
    this.lastWord = pick.w.w;
    return pick.w;
  }

  /** score: 1 = 认识, 0.5 = 眼熟（见过但说不出意思）, 0 = 不认识 */
  answer(word, score) {
    const s = score === true ? 1 : score === false ? 0 : Number(score);
    this.answers.push({ w: word.w, d: word.d, score: s });
    const p = pKnow(word.d, this.theta);
    this.theta = clamp(this.theta + this.k * (s - p), -2, 12);
    // crude Fisher-information standard error
    const info = this.answers.reduce((acc, a) => {
      const pp = pKnow(a.d, this.theta);
      return acc + pp * (1 - pp);
    }, 0);
    this.se = 1.15 / Math.sqrt(Math.max(info, 0.25));
  }

  result() {
    const zones = { known: 0, unknown: 0, frontier: 0 };
    for (const w of this.pool) {
      zones[zoneOf(pKnow(w.d, this.theta))]++;
    }
    return { theta: this.theta, se: this.se, items: this.answers.length, zones };
  }
}

/**
 * Spot-check: sample words from the predicted known and unknown zones.
 * If the model is wrong, these samples expose it.
 */
export function spotCheck(words, theta, n = 5, rng = Math.random) {
  const knownPool = [];
  const unknownPool = [];
  for (const w of words) {
    const p = pKnow(w.d, theta);
    if (p > ZONES.known) knownPool.push(w);
    else if (p < ZONES.unknown) unknownPool.push(w);
  }
  const take = (pool) => {
    const copy = pool.slice();
    const out = [];
    while (out.length < n && copy.length) {
      out.push(copy.splice(Math.floor(rng() * copy.length), 1)[0]);
    }
    return out;
  };
  return { known: take(knownPool), unknown: take(unknownPool) };
}

/**
 * Recompute theta after a spot check.
 * knownHits: how many of the sampled "known" words the user actually knew.
 * unknownHits: how many of the sampled "unknown" words the user actually knew
 *              (a high number means the model underrated them).
 */
export function applySpotCheck(theta, knownHits, knownN, unknownHits, unknownN) {
  let t = theta;
  const kAcc = knownN ? knownHits / knownN : 1;
  const uAcc = unknownN ? unknownHits / unknownN : 0;
  if (kAcc < 0.8) t -= (0.8 - kAcc) * 2.4;      // we over-trusted the model
  if (kAcc > 0.95 && uAcc < 0.15) t += 0.15;    // model was conservative
  if (uAcc > 0.35) t += (uAcc - 0.35) * 2.0;    // user knows more than we thought
  return clamp(t, -2, 12);
}

/* ---------------------------------------------------------------- queue */

/**
 * Build the study queue.
 * Only words the model believes the user does NOT know are eligible for "new".
 * Known words are excluded unless the user manually re-adds them.
 */
export function buildQueue(words, state, level, now = Date.now()) {
  const review = [];
  const fresh = [];
  const frontier = [];
  const table = state.words || {};
  for (const w of eligibleWords(words, level)) {
    const st = table[w.w];
    if (st && st.k) continue;                       // marked known: never queue
    if (st && st.iv && st.due <= now) { review.push({ w, st }); continue; }
    if (st && st.iv) continue;                      // scheduled in the future
    const p = pKnow(w.d, state.theta, st ? st.o || 0 : 0);
    const z = zoneOf(p);
    if (z === 'unknown') fresh.push(w);
    else if (z === 'frontier') frontier.push(w);
  }
  review.sort((a, b) => a.st.due - b.st.due);
  fresh.sort((a, b) => a.d - b.d);
  // Uncertain words: surface the ones most likely to be unknown first.
  frontier.sort((a, b) => pKnow(a.d, state.theta) - pKnow(b.d, state.theta));
  return { review: review.map((r) => r.w), fresh, frontier };
}

export function estimateKnown(words, theta, level) {
  let known = 0;
  let total = 0;
  for (const w of eligibleWords(words, level)) {
    total++;
    if (pKnow(w.d, theta) > 0.5) known++;
  }
  return { known, total };
}

/* ---------------------------------------------------------------- stats */

export function dayKey(ts = Date.now()) {
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function bumpDay(state, field, n = 1, ts = Date.now()) {
  const key = dayKey(ts);
  const days = state.stats.days;
  if (!days[key]) days[key] = { new: 0, review: 0, correct: 0, total: 0 };
  days[key][field] = (days[key][field] || 0) + n;
  state.stats.lastDay = key;
  // streak
  let streak = 0;
  const d = new Date(ts);
  for (;;) {
    const k = dayKey(d.getTime());
    const row = days[k];
    if (!row || !(row.total > 0)) break;
    streak++;
    d.setDate(d.getDate() - 1);
  }
  state.stats.streak = streak;
}
