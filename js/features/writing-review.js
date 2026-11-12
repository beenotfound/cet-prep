/* features/writing-review.js — local heuristic essay score + opt-in AI re-grade. */

import { h } from '../core/dom.js';
import { button, card, tag, toast } from '../ui/components.js';
import { requestAI, isConfigured, friendlyAIError } from './ai.js';
import { scoreWriting, buildBaseline } from '../domain/writing-score.js';

const baselineCache = new Map();

function baselineFor(ctx) {
  const refs = (ctx.data.content || [])
    .filter((item) => item.type === 'writing' && item.reference)
    .map((item) => item.reference);
  const key = `${refs.length}:${refs[0]?.length || 0}`;
  const cached = baselineCache.get('all');
  if (cached && cached.key === key) return cached.baseline;
  const baseline = buildBaseline(refs, ctx.data.byWord);
  baselineCache.set('all', { key, baseline });
  return baseline;
}

function parseAI(raw) {
  const text = String(raw || '').trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

const CLAUDE_STYLE = `你是大学英语四六级作文阅卷老师。严格按 CET 15 分制评分：
内容（切题、充实）5 分，结构（分段、衔接、逻辑）5 分，语言（词汇丰富度 + 语法准确与句式多样）5 分。
只输出一个 JSON 对象，不要任何多余文字，格式：
{"score":12,"band":"良好","dimensions":{"content":4,"structure":4,"language":4},
 "comments":["中文点评 2-4 条"],"corrections":[{"original":"学生原句","improved":"改写句","reason":"中文理由"}]}
corrections 只改 2-4 个典型句子，不要重写全文。`;

function aiPrompt(item, essay, score, level) {
  const m = score.metrics;
  return [
    `级别：${level === 'cet4' ? '四级' : '六级'}`,
    `题目：${item.prompt || ''}`,
    `本地指标：${m.tokens} 词，${m.sentences} 句，平均句长 ${m.avgLen.toFixed(1)}，从句密度 ${m.clauseRate.toFixed(2)}，连接词 ${m.connRate.toFixed(1)}/100词，高级词占比 ${(m.advancedRatio * 100).toFixed(0)}%，本地分 ${score.total}/15`,
    '学生作文：',
    essay,
  ].join('\n');
}

function dimensionRow(label, value) {
  const pct = Math.max(0, Math.min(100, (value / 5) * 100));
  return h('div', { class: 'v-write__dim' },
    h('div', { class: 'row row--between' },
      h('span', { class: 'xs bold' }, label),
      h('span', { class: 'xs bold' }, `${value.toFixed(1)} / 5`),
    ),
    h('div', { class: 'v-write__bar' }, h('i', { style: { width: `${pct}%` } })),
  );
}

function renderAI(host, raw, level) {
  const data = parseAI(raw);
  if (!data) {
    host.replaceChildren(h('div', { class: 'small', style: { 'white-space': 'pre-wrap' } }, String(raw || '')));
    return;
  }
  const score = Number(data.score);
  const dims = data.dimensions || {};
  const children = [
    h('div', { class: 'row row--between' },
      h('div', { class: 'bold' }, 'AI 评分'),
      h('div', null,
        tag(`${Number.isFinite(score) ? score : '—'} / 15`, 'yellow'),
        data.band ? tag(String(data.band), 'yellow') : null,
      ),
    ),
  ];
  if (Number.isFinite(score)) {
    children.push(h('div', { class: 'v-write__score' }, String(score)));
  }
  const rows = [
    ['内容', dims.content],
    ['结构', dims.structure],
    ['语言', dims.language],
  ].filter(([, v]) => Number.isFinite(Number(v)));
  if (rows.length) {
    children.push(h('div', { class: 'stack' }, rows.map(([label, v]) => dimensionRow(label, Number(v)))));
  }
  if (Array.isArray(data.comments) && data.comments.length) {
    children.push(h('div', { class: 'c-label' }, '点评'));
    children.push(h('ul', { class: 'stack', style: { 'padding-left': '18px' } },
      data.comments.slice(0, 4).map((c) => h('li', { class: 'small' }, String(c)))));
  }
  if (Array.isArray(data.corrections) && data.corrections.length) {
    children.push(h('div', { class: 'c-label' }, '逐句修改'));
    children.push(h('div', { class: 'stack' }, data.corrections.slice(0, 4).map((c) => h('div', { class: 'v-write__fix' },
      h('div', { class: 'small' }, h('span', { class: 'faint' }, '原句：'), String(c.original || '')),
      h('div', { class: 'small bold' }, h('span', { class: 'faint' }, '改为：'), String(c.improved || '')),
      c.reason ? h('div', { class: 'xs muted' }, String(c.reason)) : null,
    ))));
  }
  children.push(h('div', { class: 'xs faint' }, `AI 评分仅供参考 · ${level === 'cet4' ? '四级' : '六级'}`));
  host.replaceChildren(h('div', { class: 'stack' }, children));
}

/**
 * writingReview(ctx, item, response) — local score card + opt-in AI button.
 * Every AI call goes through requestAI's consent sheet; nothing is sent on render.
 */
export function writingReview(ctx, item, response) {
  const text = String(response || '').trim();
  if (!text) return null;
  const level = item.level || ctx.state.profile.level || 'cet6';
  const score = scoreWriting(text, {
    byWord: ctx.data.byWord,
    baseline: baselineFor(ctx),
    reference: item.reference,
    level,
  });
  const m = score.metrics;
  const aiHost = h('div');
  const configured = isConfigured(ctx.state.ai);

  async function runAI() {
    aiBtn.disabled = true;
    aiHost.replaceChildren(h('div', { class: 'xs muted' }, 'AI 批改中…'));
    try {
      const raw = await requestAI({
        ctx,
        title: 'AI 精批作文',
        system: CLAUDE_STYLE,
        user: aiPrompt(item, text, score, level),
        preview: `作文（${m.tokens} 词）+ 本地评分 ${score.total}/15`,
        maxTokens: 1400,
      });
      renderAI(aiHost, raw, level);
    } catch (error) {
      aiHost.replaceChildren();
      if (error?.code !== 'CANCELLED') toast(friendlyAIError(error), 'error');
    } finally {
      aiBtn.disabled = false;
    }
  }

  const aiBtn = button({
    label: configured ? 'AI 精批（会消耗 token）' : 'AI 精批（先配置 AI）',
    variant: 'ghost', block: true, size: 'sm',
    onClick: () => {
      if (!configured) { toast('先去「我的 → AI 设置」填 Key 和模型', 'error'); return; }
      runAI();
    },
  });

  return card({
    variant: 'yellow',
    children: h('div', { class: 'stack' },
      h('div', { class: 'row row--between' },
        h('div', { class: 'bold' }, '本地评分'),
        tag(`${score.total} / 15`, score.total >= 10 ? 'mint' : score.total >= 7 ? 'yellow' : 'red'),
      ),
      h('div', { class: 'v-write__score' }, String(score.total)),
      h('div', { class: 'small bold' }, `${score.band.label} · ${score.band.desc}`),
      h('div', { class: 'stack' }, score.dimensions.map((d) => dimensionRow(d.label, d.score))),
      h('div', { class: 'xs muted' },
        `${m.tokens} 词 · ${m.sentences} 句 · 平均句长 ${m.avgLen.toFixed(1)} · 高级词 ${(m.advancedRatio * 100).toFixed(0)}% · 连接词 ${m.connRate.toFixed(1)}/100词`),
      score.issues.length
        ? h('div', { class: 'stack' }, score.issues.map((issue) => h('div', { class: 'v-write__issue' },
          h('div', { class: 'small bold' }, issue.text),
          h('div', { class: 'xs muted' }, issue.tip),
        )))
        : null,
      score.good.length ? h('div', { class: 'row row--wrap' }, score.good.map((g) => tag(g, 'mint'))) : null,
      h('div', { class: 'xs faint' }, '本地评分按词汇难度和语法指标估算，仅供参考。'),
      aiBtn,
      aiHost,
    ),
  });
}
