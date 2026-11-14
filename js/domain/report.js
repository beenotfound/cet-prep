/* domain/report.js — CET mock-exam scoring, prediction range and weakness diagnosis.
 * Pure: no DOM, no network. All scores are estimates based on the attempt.
 */

export const COMPONENTS = Object.freeze({
  listening: 248.5,
  reading: 248.5,
  writing: 106.5,
  translation: 106.5,
});

export const READING_PARTS = Object.freeze({
  cloze: 35.5,
  matching: 71,
  reading: 142,
});

export const SECTION_LABEL = Object.freeze({
  listening: '听力',
  reading: '仔细阅读',
  cloze: '选词填空',
  matching: '长篇匹配',
  writing: '写作',
  translation: '翻译',
});

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/** Sum objective question results by section type. */
function objectiveByType(items) {
  const out = {};
  for (const entry of items || []) {
    const type = entry.type;
    if (!READING_PARTS[type] && type !== 'listening') continue;
    if (!out[type]) out[type] = { correct: 0, total: 0, elapsedMs: 0 };
    out[type].correct += Number(entry.correct) || 0;
    out[type].total += Number(entry.total) || 0;
    out[type].elapsedMs += Number(entry.elapsedMs) || 0;
  }
  return out;
}

export function translationEstimate(text, keyPoints) {
  const points = Array.isArray(keyPoints) ? keyPoints : [];
  const english = points
    .map((p) => String(p).split('→').pop().trim().toLowerCase())
    .flatMap((p) => p.split(/[/,，;；]/).map((x) => x.trim()).filter(Boolean));
  const words = String(text || '').toLowerCase().match(/[a-z][a-z'-]*/g) || [];
  const lower = ` ${words.join(' ')} `;
  const unique = [...new Set(english.filter((p) => p.length > 1))];
  const hit = unique.filter((p) => lower.includes(p.toLowerCase()));
  const coverage = unique.length ? hit.length / unique.length : 0;
  const ratio = unique.length ? clamp(0.4 + 0.6 * coverage, 0.3, 0.9) : 0.6;
  return {
    coverage: Number(coverage.toFixed(3)),
    ratio: Number(ratio.toFixed(3)),
    points: unique.length,
    hit: hit.length,
    estimated: true,
  };
}

function writingComponent(writing) {
  if (!writing || !Number.isFinite(Number(writing.score15))) return null;
  return {
    score: Number(writing.score15) / 15 * COMPONENTS.writing,
    max: COMPONENTS.writing,
    detail: writing,
  };
}

function translationComponent(translation) {
  if (!translation || !Number.isFinite(Number(translation.estimatedRatio))) return null;
  return {
    score: COMPONENTS.translation * Number(translation.estimatedRatio),
    max: COMPONENTS.translation,
    detail: translation,
  };
}

/** Reward: {components, complete, measured, measuredMax, total, range, confidence, weaknesses}
 * attempt.items: [{type, correct, total, elapsedMs, ...}] */
export function scoreAttempt(attempt) {
  if (!attempt) return null;
  const byType = objectiveByType(attempt.items);

  const readingParts = Object.entries(READING_PARTS)
    .filter(([type]) => byType[type] && byType[type].total > 0)
    .map(([type, max]) => ({
      type,
      label: SECTION_LABEL[type],
      correct: byType[type].correct,
      total: byType[type].total,
      accuracy: byType[type].correct / byType[type].total,
      score: max * (byType[type].correct / byType[type].total),
      max,
      elapsedMs: byType[type].elapsedMs,
    }));

  const readingScore = readingParts.reduce((sum, p) => sum + p.score, 0);
  const readingMax = readingParts.reduce((sum, p) => sum + p.max, 0);
  const reading = readingParts.length
    ? { score: readingScore, max: readingMax, parts: readingParts }
    : null;

  const writing = writingComponent(attempt.writing);
  const translation = translationComponent(attempt.translation);

  let listening = null;
  if (attempt.listening && Number.isFinite(Number(attempt.listening.total)) && Number(attempt.listening.total) > 0) {
    const total = Number(attempt.listening.total);
    const correct = clamp(Number(attempt.listening.correct) || 0, 0, total);
    listening = {
      score: COMPONENTS.listening * correct / total,
      max: COMPONENTS.listening,
      correct,
      total,
      accuracy: correct / total,
      selfAssessed: Number(attempt.listening.selfAssessed) || 0,
      selfMarked: Number(attempt.listening.selfMarked) || 0,
    };
  }

  const components = { listening, reading, writing, translation };
  const present = Object.entries(components).filter(([, c]) => c && c.max > 0);
  const measuredMax = present.reduce((sum, [, c]) => sum + c.max, 0);
  const measured = present.reduce((sum, [, c]) => sum + c.score, 0);
  const complete = Boolean(listening && reading && reading.parts.length === 3 && writing && translation);
  const missing = Object.entries(components).filter(([, c]) => !c).map(([k]) => k);

  // If listening is missing, project it from reading accuracy (or a neutral 60% fallback)
  // so the report can show a "what if" range without pretending it was measured.
  let projected = null;
  if (!complete) {
    const listenRatio = reading && readingMax > 0 ? readingScore / readingMax : 0.6;
    const assumed = COMPONENTS.listening * clamp(listenRatio, 0.3, 0.9);
    projected = {
      listeningAssumed: assumed,
      total: measured + assumed,
      note: `听力未测，按${Math.round(clamp(listenRatio, 0.3, 0.9) * 100)}%估算`,
    };
  }

  const base = complete ? measured : projected ? projected.total : measured;
  const subjectiveUncertainty = (translation ? 15 : 0) + (listening ? 25 : 20);
  const lo = clamp(base - subjectiveUncertainty, 0, 710);
  const hi = clamp(base + subjectiveUncertainty, 0, 710);

  // Confidence: objective coverage, listening auto-grading, and writing score.
  const objectiveTotal = Object.values(byType).reduce((s, b) => s + b.total, 0);
  const objectiveAnswered = Object.values(byType).reduce((s, b) => s + b.correct, 0);
  const autoListening = listening && listening.total > 0 ? 1 - (listening.selfAssessed || 0) / listening.total : 0;
  let confidence = 'low';
  const noSelfAssess = !listening || (listening.selfAssessed || 0) === 0;
  const selfAssessComplete = !listening || (listening.selfMarked || 0) >= (listening.selfAssessed || 0);
  if (complete && objectiveTotal >= 20 && noSelfAssess && writing) confidence = 'high';
  else if (objectiveTotal >= 10 && writing && selfAssessComplete && (!attempt.listening || listening)) confidence = 'medium';

  const weaknesses = [];
  for (const part of readingParts) {
    if (part.total >= 5) weaknesses.push({ key: part.type, label: part.label, accuracy: part.accuracy, total: part.total });
  }
  if (listening && listening.total >= 5) weaknesses.push({ key: 'listening', label: '听力', accuracy: listening.accuracy, total: listening.total });
  if (writing) weaknesses.push({ key: 'writing', label: '写作', accuracy: clamp(Number(attempt.writing.score15) / 15, 0, 1), total: 1 });
  if (translation) weaknesses.push({ key: 'translation', label: '翻译', accuracy: clamp(Number(attempt.translation.estimatedRatio), 0, 1), total: 1 });
  weaknesses.sort((a, b) => a.accuracy - b.accuracy);
  const topWeak = weaknesses.slice(0, 2);

  return {
    components,
    readingParts,
    measured,
    measuredMax,
    complete,
    missing,
    total: base,
    projected,
    range: [lo, hi],
    confidence,
    weaknesses: topWeak,
    objectiveTotal,
    objectiveAnswered,
    autoListening,
  };
}

export function scoreLine(total) {
  if (total >= 550) return '550+';
  if (total >= 500) return '500–549';
  if (total >= 425) return '425–499';
  return '425 以下';
}

export function recommendationFor(key) {
  return {
    reading: '仔细阅读：定位句 + 同义替换，先题干后原文',
    cloze: '选词填空：先判词性，再看搭配与上下文',
    matching: '长篇匹配：先圈题干关键词，再扫段落首尾句',
    listening: '听力精听：同一段反复听，抓信号词与数字',
    writing: '写作：背 2 个万能结构，练段落展开',
    translation: '翻译：先抓主谓，再补修饰，积累中国文化词',
  }[key] || '针对薄弱部分做一组专项练习';
}

export function formatMinutes(ms) {
  const m = Math.round((Number(ms) || 0) / 60000);
  return `${m} 分钟`;
}
