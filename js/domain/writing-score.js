/* domain/writing-score.js — heuristic CET writing score. Pure: no DOM, no network.
 *
 * Dimensions follow the CET 15-point writing scale (content / structure /
 * language, 5 each). Vocabulary difficulty comes from the word bank (d value),
 * grammar from sentence length, clause density and connectives. Reference
 * essays of the same exam are used as the calibration baseline, so a plain
 * essay scores around the middle and a strong one near the top.
 */

const STOP = new Set(('the a an and or but if of to in on at for with from by as is are was were be been being '
  + 'it its this that these those i you he she we they me my your his her our their not no so than then there '
  + 'here what which who whom whose when where why how all any both each few more most other some such only own '
  + 'same too very can could may might must shall should will would do does did have has had having about into over '
  + 'under again further once during before after above below between through because while although though since '
  + 'until unless also just even still yet').split(/\s+/));

const CONNECTORS = ['however', 'therefore', 'moreover', 'furthermore', 'in addition', 'besides',
  'on the other hand', 'in conclusion', 'firstly', 'secondly', 'finally', 'for example', 'for instance',
  'as a result', 'consequently', 'nevertheless', 'nonetheless', 'in contrast', 'what is more', 'to sum up'];

const CLAUSE_RE = /\b(which|that|who|whom|whose|where|when|because|although|though|while|if|unless|since|as|after|before|whereas)\b/g;

const BANDS = [
  { min: 13, label: '优秀', desc: '内容切题，表达清楚，句式有变化，语言基本无误' },
  { min: 10, label: '良好', desc: '内容较切题，表达清楚，少量语言错误' },
  { min: 7, label: '中等', desc: '基本切题，表达基本清楚，语言错误较多' },
  { min: 4, label: '较差', desc: '条理不清或偏离主题，语言错误多' },
  { min: 1, label: '差', desc: '内容混乱，语言错误很多' },
];

const clamp = (value, lo, hi) => Math.max(lo, Math.min(hi, value));

function tokensOf(text) {
  return String(text || '').toLowerCase().match(/[a-z][a-z'-]*/g) || [];
}

function sentencesOf(text) {
  return String(text || '').split(/[.!?]+/).map((s) => s.trim()).filter((s) => s.length > 1);
}

function paragraphsOf(text) {
  const raw = String(text || '');
  const blocks = raw.split(/\n\s*\n/).map((s) => s.trim()).filter(Boolean);
  if (blocks.length > 1) return blocks;
  return raw.split(/\n+/).map((s) => s.trim()).filter((s) => s.length > 30);
}

function mean(values) {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
}

function stdev(values) {
  if (values.length < 2) return 0;
  const m = mean(values);
  return Math.sqrt(mean(values.map((v) => (v - m) ** 2)));
}

/** Raw metrics for a piece of writing. */
export function analyze(text, byWord) {
  const tokens = tokensOf(text);
  const content = tokens.filter((t) => t.length >= 3 && !STOP.has(t));
  const unique = new Set(content);
  const known = content.filter((t) => byWord?.has?.(t));
  const diffs = known.map((t) => byWord.get(t).d).filter(Number.isFinite);
  const avgD = mean(diffs);
  const advanced = known.filter((t) => {
    const word = byWord.get(t);
    return (word.g || []).includes('cet6') || (word.d || 0) >= 6.2;
  }).length;

  const sentences = sentencesOf(text);
  const lengths = sentences.map((s) => tokensOf(s).length);
  const lower = ` ${String(text || '').toLowerCase()} `;
  const clauses = (lower.match(CLAUSE_RE) || []).length;
  let connectors = 0;
  for (const c of CONNECTORS) connectors += lower.split(c).length - 1;
  const repeated = new Map();
  for (const t of content) repeated.set(t, (repeated.get(t) || 0) + 1);
  const topRepeat = repeated.size ? Math.max(...repeated.values()) : 0;

  return {
    tokens: tokens.length,
    contentWords: content.length,
    unique: unique.size,
    ttr: content.length ? unique.size / content.length : 0,
    known: known.length,
    avgD,
    advancedRatio: content.length ? advanced / content.length : 0,
    sentences: sentences.length,
    avgLen: mean(lengths),
    sd: stdev(lengths),
    clauseRate: sentences.length ? clauses / sentences.length : 0,
    connRate: content.length ? (connectors / content.length) * 100 : 0,
    paragraphs: paragraphsOf(text).length,
    topRepeat,
    hasFinalPunct: /[.!?]\s*$/.test(String(text || '').trim()),
  };
}

/** Calibration distribution built from reference essays. */
export function buildBaseline(references, byWord) {
  const metrics = (references || []).map((r) => analyze(r, byWord)).filter((m) => m.tokens >= 40);
  const col = (key) => metrics.map((m) => m[key]).filter(Number.isFinite).sort((a, b) => a - b);
  return {
    count: metrics.length,
    advRatio: col('advancedRatio'),
    avgD: col('avgD'),
    ttr: col('ttr'),
    clauseRate: col('clauseRate'),
    connRate: col('connRate'),
    sd: col('sd'),
  };
}

function pct(sorted, value) {
  if (!sorted || !sorted.length) return 0.5;
  let n = 0;
  for (const x of sorted) if (x <= value) n++;
  return n / sorted.length;
}

/** Percentile -> 1..5, so matching the reference median gives 3/5. */
function pctScore(p) {
  return 1 + 4 * clamp(p, 0, 1);
}

function overlapWith(reference, essay, byWord) {
  if (!reference) return 0.5;
  const refTokens = tokensOf(reference).filter((t) => t.length >= 4 && !STOP.has(t));
  const freq = new Map();
  for (const t of refTokens) freq.set(t, (freq.get(t) || 0) + 1);
  const top = [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 24).map(([t]) => t);
  if (!top.length) return 0.5;
  const essayTokens = new Set(tokensOf(essay));
  return top.filter((t) => essayTokens.has(t)).length / top.length;
}

export function bandOf(total) {
  return BANDS.find((b) => total >= b.min) || BANDS[BANDS.length - 1];
}

/**
 * scoreWriting(text, { byWord, baseline, reference, level })
 * Returns a 1–15 CET-style score with per-dimension breakdown and issues.
 */
export function scoreWriting(text, { byWord, baseline, reference, level = 'cet6' } = {}) {
  const m = analyze(text, byWord);
  const base = baseline || buildBaseline([], byWord);

  const vocab = clamp(pctScore(
    0.50 * pct(base.advRatio, m.advancedRatio)
    + 0.25 * pct(base.avgD, m.avgD)
    + 0.25 * pct(base.ttr, m.ttr),
  ), 0, 5);

  let grammar = pctScore(
    0.40 * pct(base.clauseRate, m.clauseRate)
    + 0.30 * pct(base.connRate, m.connRate)
    + 0.30 * pct(base.sd, m.sd),
  );
  if (m.avgLen > 38) grammar *= 0.75;
  if (m.avgLen < 6) grammar *= 0.8;
  grammar = clamp(grammar, 0, 5);

  const target = level === 'cet4' ? 130 : 160;
  const lenScore = m.tokens >= target ? (m.tokens > target * 1.8 ? 0.75 : 1) : m.tokens / target;
  const paraScore = Math.min(1, m.paragraphs / 3);
  const overlap = reference ? overlapWith(reference, text, byWord) : 0.5;
  const content = clamp(5 * (0.40 * lenScore + 0.25 * paraScore + 0.35 * overlap), 0, 5);

  const structure = clamp(5 * (
    0.50 * paraScore
    + 0.30 * pct(base.connRate, m.connRate)
    + 0.20 * pct(base.clauseRate, m.clauseRate)
  ), 0, 5);
  const language = clamp((vocab + grammar) / 2, 0, 5);

  const total = clamp(Math.round(content + structure + language), 1, 15);
  const band = bandOf(total);

  const issues = [];
  if (m.tokens < target * 0.8) issues.push({ text: `字数偏少（${m.tokens} 词）`, tip: `目标 ${target}–${target + 40} 词` });
  if (m.paragraphs < 2) issues.push({ text: '没有分段', tip: '建议三段：引入、展开、结论' });
  if (m.avgLen > 36) issues.push({ text: '句子偏长', tip: '超过 35 词的句子拆开写' });
  if (m.clauseRate < 0.25) issues.push({ text: '从句偏少', tip: '用 which/that/because/although 组织复合句' });
  if (m.connRate < 1.5) issues.push({ text: '连接词偏少', tip: '加 however、therefore、in addition 之类' });
  if (m.advancedRatio < 0.08) issues.push({ text: '高级词偏少', tip: '把常见词换成 d≥6 的表达' });
  if (!m.hasFinalPunct) issues.push({ text: '结尾缺标点', tip: '检查句末标点' });
  if (m.topRepeat >= 6) issues.push({ text: '同一个词重复太多', tip: '换同义词或代词' });

  const good = [];
  if (m.paragraphs >= 3) good.push('分段清楚');
  if (m.connRate >= 2.5) good.push('衔接自然');
  if (m.clauseRate >= 0.45) good.push('句式有变化');
  if (m.advancedRatio >= 0.18) good.push('词汇有亮点');
  if (m.tokens >= target) good.push('字数达标');

  return {
    total,
    band,
    level,
    metrics: m,
    dimensions: [
      { key: 'content', label: '内容', score: content },
      { key: 'structure', label: '结构', score: structure },
      { key: 'language', label: '语言', score: language },
    ],
    issues: issues.slice(0, 4),
    good: good.slice(0, 3),
  };
}
