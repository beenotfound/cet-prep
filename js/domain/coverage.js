/* domain/coverage.js — how much of real text you can already read.
 *
 * Two ideas:
 *   1. coverage: expected share of words in a passage you already know.
 *   2. i+1: recommend the passage whose unknown-word load sits just above
 *      your current level (Krashen's `i+1`), instead of a random passage.
 *
 * Tokens that are not in the CET bank (function words, names, inflections we
 * cannot match) are treated as known; they are a small share of the passages.
 */

import { pKnow } from './engine.js';

export function wordProbability(word, byWord, theta, state) {
  const entry = byWord.get(word);
  if (!entry) return 1;
  const offset = state?.words?.[word]?.o || 0;
  return pKnow(entry.d, theta, offset);
}

/** tokens: { tokens: totalTokenCount, words: [[word, count], ...] } */
export function coverageOf(tokens, byWord, theta, state) {
  let known = 0;
  let inBank = 0;
  for (const [word, count] of tokens.words || []) {
    known += count * wordProbability(word, byWord, theta, state);
    inBank += count;
  }
  const total = tokens.tokens || inBank;
  const outside = Math.max(0, total - inBank);
  return { ratio: total ? (known + outside) / total : 0, known: known + outside, total };
}

/** One passage: coverage plus how many distinct words are still unknown. */
export function passageFit(passage, byWord, theta, state) {
  const cov = coverageOf(passage, byWord, theta, state);
  const unknownWords = (passage.words || []).filter(
    ([word]) => wordProbability(word, byWord, theta, state) < 0.5,
  ).length;
  return { ratio: cov.ratio, unknownWords, tokens: passage.tokens };
}

/**
 * Passages ranked by how close they are to the i+1 sweet spot (default 95% known).
 * Returns [{ passage, ratio, unknownWords }].
 */
export function recommendPassages(passages, byWord, theta, state, { level = 'cet6', target = 0.95, limit = 3 } = {}) {
  const levelOk = (p) => (level === 'both' ? true : level === 'cet4' ? p.level === 'cet4' : p.level !== 'cet4');
  return passages
    .filter(levelOk)
    .map((passage) => ({ passage, ...passageFit(passage, byWord, theta, state) }))
    .sort((a, b) => Math.abs(a.ratio - target) - Math.abs(b.ratio - target))
    .slice(0, limit);
}

/**
 * How many more high-frequency words raise coverage by `step` (default +5 points).
 * Returns { current, goal, need, achieved }.
 */
export function coveragePlan(corpus, byWord, theta, state, { step = 0.05, cap = 0.98, maxWords = 800 } = {}) {
  const cov = coverageOf(corpus, byWord, theta, state);
  const goal = Math.min(cap, cov.ratio + step);
  const goalTokens = goal * cov.total;
  const unknown = (corpus.words || [])
    .map(([word, count]) => ({ word, count, p: wordProbability(word, byWord, theta, state) }))
    .filter((x) => x.p < 0.5)
    .sort((a, b) => b.count * (1 - b.p) - a.count * (1 - a.p));

  let known = cov.known;
  let need = 0;
  for (const item of unknown) {
    if (known >= goalTokens || need >= maxWords) break;
    known += item.count * (1 - item.p);
    need++;
  }
  return { current: cov.ratio, goal, need, achieved: known / Math.max(cov.total, 1) };
}
