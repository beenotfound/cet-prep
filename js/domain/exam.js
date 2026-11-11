/* domain/exam.js — pure grading and scoring. No DOM. */

export const WEIGHTS = Object.freeze({ reading: 249, writing: 106.5, translation: 106.5 });

export function normalize(text) {
  return String(text ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

/** Returns { correct, total, needsReview, detail[] } */
export function gradeItem(item, response) {
  if (!item) return { correct: 0, total: 1, needsReview: false, detail: [] };

  switch (item.type) {
    case 'w2m':
    case 'm2w':
    case 'fill':
      return { correct: response === item.answer ? 1 : 0, total: 1, needsReview: false, detail: [{ ok: response === item.answer }] };

    case 'spell':
      return { correct: normalize(response) === normalize(item.answer) ? 1 : 0, total: 1, needsReview: false, detail: [] };

    case 'reading': {
      const detail = item.questions.map((q, i) => ({ ok: response?.[i] === q.answer, explain: q.explain }));
      return { correct: detail.filter((d) => d.ok).length, total: item.questions.length, needsReview: false, detail };
    }

    case 'cloze': {
      const detail = item.blanks.map((b, i) => ({ ok: normalize(response?.[i]) === normalize(b.answer), explain: b.explain }));
      return { correct: detail.filter((d) => d.ok).length, total: item.blanks.length, needsReview: false, detail };
    }

    case 'matching': {
      const detail = item.statements.map((s, i) => ({ ok: String(response?.[i] || '').toUpperCase() === s.answer }));
      return { correct: detail.filter((d) => d.ok).length, total: item.statements.length, needsReview: false, detail };
    }

    case 'translation':
    case 'writing':
      return { correct: 0, total: 1, needsReview: true, detail: [] };

    default:
      return { correct: 0, total: 1, needsReview: true, detail: [] };
  }
}

/** sections: [{type, items:[...]}], answers: {"s:i": response} */
export function scorePaper(sections, answers) {
  const byType = {};
  let correct = 0;
  let total = 0;
  let pending = 0;
  sections.forEach((section, si) => {
    section.items.forEach((item, ii) => {
      const key = `${si}:${ii}`;
      const result = gradeItem(item, answers[key]);
      const bucket = byType[section.type] || (byType[section.type] = { correct: 0, total: 0, objective: true });
      bucket.correct += result.correct;
      bucket.total += result.total;
      if (result.needsReview) bucket.objective = false;
      if (result.needsReview) pending++;
      else { correct += result.correct; total += result.total; }
    });
  });
  const reading = byType.reading || { correct: 0, total: 0 };
  const estimated = total ? Math.round((reading.correct / Math.max(reading.total, 1)) * WEIGHTS.reading) : 0;
  return { byType, correct, total, pending, readingScore: estimated, maxReading: WEIGHTS.reading };
}

export function formatClock(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
