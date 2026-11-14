/* domain/importer.js — validate user-supplied question JSON. Pure, no DOM. */

const VOCAB_TYPES = new Set(['w2m', 'm2w', 'fill', 'spell']);
const CONTENT_TYPES = new Set(['reading', 'cloze', 'matching', 'translation', 'writing']);

function ok(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function normalizeVocab(raw, index, errors) {
  const type = String(raw.type || '').trim();
  if (!VOCAB_TYPES.has(type)) { errors.push(`第 ${index + 1} 项：type 必须是 w2m/m2w/fill/spell`); return null; }
  if (!ok(raw.prompt)) { errors.push(`第 ${index + 1} 项：缺少 prompt`); return null; }
  const level = raw.level === 'cet4' ? 'cet4' : 'cet6';
  if (type === 'spell') {
    if (!ok(raw.answer)) { errors.push(`第 ${index + 1} 项：spell 需要 answer`); return null; }
    return {
      id: raw.id || `custom-${index}-${Date.now().toString(36)}`,
      type, level, prompt: raw.prompt.trim(), options: [],
      answer: String(raw.answer).trim(), hint: raw.hint || '',
      explain: raw.explain || '', word: raw.word || String(raw.answer).trim(),
      custom: true,
    };
  }
  const options = Array.isArray(raw.options) ? raw.options.map((o) => String(o)) : [];
  if (options.length !== 4) { errors.push(`第 ${index + 1} 项：需要 4 个选项`); return null; }
  const answer = Number(raw.answer);
  if (!Number.isInteger(answer) || answer < 0 || answer > 3) { errors.push(`第 ${index + 1} 项：answer 必须是 0-3`); return null; }
  return {
    id: raw.id || `custom-${index}-${Date.now().toString(36)}`,
    type, level, prompt: raw.prompt.trim(), options, answer,
    explain: raw.explain || '', word: raw.word || '', custom: true,
  };
}

function normalizeContent(raw, index, errors) {
  const type = String(raw.type || '').trim();
  if (!CONTENT_TYPES.has(type)) { errors.push(`第 ${index + 1} 项：type 不认识（${type}）`); return null; }
  if (!ok(raw.title)) { errors.push(`第 ${index + 1} 项：缺少 title`); return null; }
  const base = {
    id: raw.id || `custom-${index}-${Date.now().toString(36)}`,
    type,
    level: raw.level === 'cet4' ? 'cet4' : 'cet6',
    title: raw.title.trim(),
    difficulty: Number(raw.difficulty) || 3,
    source: 'imported',
    targetWords: Array.isArray(raw.targetWords) ? raw.targetWords : [],
    custom: true,
  };
  if (type === 'reading') {
    if (!ok(raw.passage) || !Array.isArray(raw.questions) || !raw.questions.length) {
      errors.push(`第 ${index + 1} 项：reading 需要 passage 与 questions`); return null;
    }
  } else if (type === 'cloze') {
    if (!ok(raw.passage) || !Array.isArray(raw.bank) || !Array.isArray(raw.blanks)) {
      errors.push(`第 ${index + 1} 项：cloze 需要 passage/bank/blanks`); return null;
    }
  } else if (type === 'matching') {
    if (!Array.isArray(raw.paragraphs) || !Array.isArray(raw.statements)) {
      errors.push(`第 ${index + 1} 项：matching 需要 paragraphs/statements`); return null;
    }
  } else if (type === 'translation' || type === 'writing') {
    if (!ok(raw.prompt) || !ok(raw.reference)) {
      errors.push(`第 ${index + 1} 项：需要 prompt 与 reference`); return null;
    }
  }
  return { ...base, ...raw, id: base.id, type, level: base.level, custom: true };
}

/** Accepts a JSON array, or {"items": [...]}. Returns { items, errors }. */
export function parseImport(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch (error) {
    return { items: [], errors: [`JSON 解析失败：${error.message}`] };
  }
  const arr = Array.isArray(data) ? data : Array.isArray(data?.items) ? data.items : null;
  if (!arr) return { items: [], errors: ['需要是数组，或形如 {"items": [...]}'] };

  const items = [];
  const errors = [];
  arr.forEach((raw, index) => {
    if (!raw || typeof raw !== 'object') { errors.push(`第 ${index + 1} 项不是对象`); return; }
    const item = VOCAB_TYPES.has(raw.type) ? normalizeVocab(raw, index, errors) : normalizeContent(raw, index, errors);
    if (item) items.push(item);
  });
  return { items, errors };
}


/**
 * Plain word list: one word per line, e.g. "abandon 放弃" / "abandon,放弃".
 * Produces custom vocabulary questions (spell + w2m when enough words).
 * These go to 题库 → 词汇速练; they do not modify the built-in SRS word bank.
 */
export function parseWordList(text, level = 'cet6') {
  const lines = String(text || '').split(/\r?\n/);
  const entries = [];
  const errors = [];
  const seen = new Set();
  lines.forEach((raw, index) => {
    const line = raw.replace(/^\uFEFF/, '').trim();
    if (!line || line.startsWith('#')) return;
    const m = line.match(/^([A-Za-z][A-Za-z'’-]*(?:\s+[A-Za-z][A-Za-z'’-]*)?)\s*(?:[\t,，]|\s{2,}|\s+)\s*(.+)$/);
    if (!m) {
      errors.push(`第 ${index + 1} 行：格式应为「英文单词 中文释义」`);
      return;
    }
    const word = m[1].trim();
    const gloss = m[2].trim();
    if (!/[\u3400-\u9fff]/.test(gloss)) {
      errors.push(`第 ${index + 1} 行：释义请用中文，例如「${word} 中文释义」`);
      return;
    }
    const key = word.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    entries.push({ word, gloss });
  });
  if (!entries.length) return { items: [], errors: errors.length ? errors : ['没有识别到单词，请每行写「单词 释义」'], words: 0 };

  const safeLevel = level === 'cet4' ? 'cet4' : 'cet6';
  const items = [];
  const optionPool = entries.map((x) => x.gloss);
  entries.forEach((entry, index) => {
    const base = { level: safeLevel, custom: true, word: entry.word, source: 'imported' };
    items.push({
      ...base,
      id: `word-spell-${index}-${entry.word.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
      type: 'spell',
      prompt: entry.gloss,
      hint: `${entry.word[0]}… (${entry.word.length} 个字母)`,
      answer: entry.word,
      explain: `${entry.word} = ${entry.gloss}`,
    });
    const distractors = [];
    for (let i = 0; i < optionPool.length && distractors.length < 3; i++) {
      const candidate = optionPool[(index + 1 + i) % optionPool.length];
      if (candidate !== entry.gloss && !distractors.includes(candidate)) distractors.push(candidate);
    }
    if (distractors.length === 3) {
      const options = [entry.gloss, ...distractors];
      for (let i = options.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [options[i], options[j]] = [options[j], options[i]];
      }
      items.push({
        ...base,
        id: `word-w2m-${index}-${entry.word.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
        type: 'w2m',
        prompt: entry.word,
        options,
        answer: options.indexOf(entry.gloss),
        explain: `${entry.word} = ${entry.gloss}`,
      });
    }
  });
  return { items, errors, words: entries.length };
}
