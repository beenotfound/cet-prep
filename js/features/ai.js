/* features/ai.js — consent-gated AI orchestration.
   Rule: nothing is ever sent to a provider without an explicit user confirmation. */

import { h } from '../core/dom.js';
import { showSheet, toast } from '../ui/components.js';
import * as openai from './providers/openai.js';
import * as claude from './providers/claude.js';

export const PRESETS = {
  openai: { label: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini', kind: 'openai' },
  deepseek: { label: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat', kind: 'openai' },
  doubao: { label: '豆包（火山方舟）', baseUrl: 'https://ark.cn-beijing.volces.com/api/v3', model: '', kind: 'openai' },
  claude: { label: 'Claude', baseUrl: 'https://api.anthropic.com/v1', model: 'claude-3-5-sonnet-latest', kind: 'claude' },
  custom: { label: '自定义兼容接口', baseUrl: '', model: '', kind: 'openai' },
};

export function presetOf(provider) {
  return PRESETS[provider] || PRESETS.custom;
}

export function isConfigured(ai) {
  return Boolean(ai && ai.baseUrl && ai.apiKey && ai.model);
}

export function estimateTokens(text) {
  // conservative: CJK ~1 token/char, English ~1 token/3.5 chars
  const cjk = (text.match(/[\u4e00-\u9fff]/g) || []).length;
  const rest = text.length - cjk;
  return Math.ceil(cjk + rest / 3.5);
}

export function copyText(text) {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text).catch(() => fallbackCopy(text));
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

function consentBody({ preview, ai, estimate, sessionTokens }) {
  return h('div', { class: 'stack' },
    h('div', { class: 'c-card c-card--yellow c-card--flat', style: { padding: '10px 12px' } },
      h('div', { class: 'xs bold muted' }, '将要发送的内容'),
      h('div', { class: 'small', style: { 'white-space': 'pre-wrap', 'max-height': '9em', overflow: 'auto' } }, preview),
    ),
    h('div', { class: 'c-kv' }, h('span', { class: 'muted' }, '模型'), h('span', { class: 'bold' }, `${presetOf(ai.provider).label} · ${ai.model}`)),
    h('div', { class: 'c-kv' }, h('span', { class: 'muted' }, '预计消耗'), h('span', { class: 'bold' }, `≈ ${estimate} tokens`)),
    h('div', { class: 'c-kv' }, h('span', { class: 'muted' }, '本次会话已用'), h('span', { class: 'bold' }, `${sessionTokens || 0} tokens`)),
  );
}

/**
 * requestAI — the only entry point to a model.
 * ctx must provide { state, actions, toast }.
 */
export async function requestAI({ ctx, title, system, user, preview, maxTokens = 800, timeout = 60000 }) {
  const ai = ctx.state.ai;
  if (!isConfigured(ai)) {
    throw Object.assign(new Error('还没有配置 AI：请到「我的 → AI 设置」填 Key 和模型'), { code: 'NOT_CONFIGURED' });
  }
  if (ai.budget > 0 && (ai.sessionTokens || 0) >= ai.budget) {
    throw Object.assign(new Error(`本次会话已达到预算上限（${ai.budget} tokens），可在设置里调高`), { code: 'BUDGET' });
  }

  const estimate = estimateTokens(system + user) + Math.min(maxTokens, 500);
  const ok = await showSheet({
    title: title || '调用 AI',
    body: consentBody({ preview: preview || user.slice(0, 400), ai, estimate, sessionTokens: ai.sessionTokens }),
    actions: [
      { label: '发送并消耗', variant: 'primary', value: true },
      { label: '取消', value: false },
    ],
  });
  if (!ok) throw Object.assign(new Error('cancelled'), { code: 'CANCELLED' });

  const messages = [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
  const kind = presetOf(ai.provider).kind;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const provider = kind === 'claude' ? claude : openai;
    const result = await provider.chat({
      baseUrl: ai.baseUrl, apiKey: ai.apiKey, model: ai.model,
      messages, maxTokens, signal: controller.signal,
    });
    const used = result.usage?.input || result.usage?.output
      ? (result.usage.input || 0) + (result.usage.output || 0)
      : estimate;
    ctx.actions.addTokens(used);
    return result.text;
  } catch (error) {
    if (error?.name === 'AbortError') throw Object.assign(new Error('请求超时'), { code: 'TIMEOUT' });
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

/* ---------------- ready-made tasks ---------------- */

const WORD_SYSTEM = '你是一位英语词汇老师，面向中国大学英语六级考生。回答务必简短、具体、可记忆，用中文解释。';

export function explainWord(word, ctx) {
  const gloss = (word.t || []).map(([pos, cn]) => `${pos}. ${cn}`).join('；');
  return requestAI({
    ctx,
    title: `解释 ${word.w}`,
    system: WORD_SYSTEM,
    user: `请讲解单词 "${word.w}"（${gloss}）。要求：1) 一句话核心词义；2) 词根/词缀或记忆点；3) 两个六级难度的例句（英文+中文）；4) 常见搭配；5) 一个易混词对比。总字数 200 字以内。`,
    preview: word.w,
    maxTokens: 700,
  });
}

export function gradeWriting(promptText, essay, ctx) {
  return requestAI({
    ctx,
    title: 'AI 批改作文（会消耗 token）',
    system: '你是大学英语六级写作阅卷老师。按内容、结构、语言三项给分（满分 15），指出具体问题并给出改写建议。用中文点评。',
    user: `题目：${promptText}\n\n学生作文：\n${essay}`,
    preview: `题目 + 学生作文（${essay.length} 字符）`,
    maxTokens: 1000,
  });
}

export function gradeTranslation(promptText, answer, ctx) {
  return requestAI({
    ctx,
    title: 'AI 点评翻译（会消耗 token）',
    system: '你是大学英语六级翻译阅卷老师。逐句对照参考译文给出点评，标出语法错误、用词不当与漏译，最后给一个 15 分制分数。用中文点评。',
    user: `原文：${promptText}\n\n学生译文：\n${answer}`,
    preview: `原文 + 学生译文（${answer.length} 字符）`,
    maxTokens: 1000,
  });
}

export function askAI(question, ctx) {
  return requestAI({
    ctx,
    title: '问 AI',
    system: '你是四六级备考助手，回答简洁、给具体例子，用中文。',
    user: question,
    preview: question.slice(0, 400),
    maxTokens: 800,
  });
}

export function friendlyAIError(error) {
  if (!error) return '未知错误';
  if (error.code === 'CANCELLED') return '';
  if (error.code === 'NOT_CONFIGURED') return error.message;
  if (error.code === 'CONFIG') return error.message;
  return error.message || '调用失败';
}

export function reportAIError(ctx, error) {
  const message = friendlyAIError(error);
  if (message) ctx.toast(message, 'error');
}
