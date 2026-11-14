/* views/report.js — mock-exam report: estimated score, weak spots, wrong answers, timing. */

import { h } from '../core/dom.js';
import { button, card, tag, statePanel } from '../ui/components.js';
import { scoreAttempt, recommendationFor, scoreLine, formatMinutes, COMPONENTS } from '../domain/report.js';
import { track } from '../core/telemetry.js';

const TYPE_LABEL = {
  reading: '仔细阅读', cloze: '选词填空', matching: '长篇匹配',
  translation: '翻译', writing: '写作',
};

const BUDGET_MIN = { reading: 40, cloze: 10, matching: 15, translation: 30, writing: 30 };

const CONFIDENCE_LABEL = { high: '高', medium: '中', low: '低' };

function num(value) {
  const n = Number(value) || 0;
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

function pct(value) {
  return `${Math.round((Number(value) || 0) * 100)}%`;
}

function compRow(label, comp, fallback) {
  if (!comp) {
    return h('div', { class: 'v-report__row' },
      h('div', { class: 'v-report__rowhead' },
        h('span', { class: 'bold' }, label),
        h('span', { class: 'xs muted' }, fallback),
      ),
      h('div', { class: 'v-report__bar' }, h('i', { style: { width: '0%' } })),
    );
  }
  const ratio = comp.max ? Math.max(0, Math.min(1, comp.score / comp.max)) : 0;
  return h('div', { class: 'v-report__row' },
    h('div', { class: 'v-report__rowhead' },
      h('span', { class: 'bold' }, label),
      h('span', { class: 'xs' }, `${num(comp.score)} / ${num(comp.max)}${comp.accuracy != null ? ` · ${pct(comp.accuracy)}` : ''}`),
    ),
    h('div', { class: 'v-report__bar' }, h('i', { style: { width: `${ratio * 100}%` } })),
  );
}

function attemptLabel(attempt) {
  return attempt.paperTitle || attempt.paperId || '模考';
}

function wrongItems(ctx, attempt) {
  const out = [];
  for (const entry of attempt.items || []) {
    const item = ctx.data.contentById?.get?.(entry.itemId);
    const details = entry.detail || [];
    details.forEach((d, i) => {
      if (d.ok) return;
      let prompt = '';
      let mine = entry.response?.[i] ?? '';
      let correct = '';
      let explain = d.explain || '';
      if (item?.type === 'reading') {
        const q = item.questions?.[i];
        prompt = q?.q || '';
        correct = q?.answer;
        explain = explain || q?.explain || '';
        if (typeof correct === 'number') correct = String.fromCharCode(65 + correct);
        if (typeof mine === 'number') mine = String.fromCharCode(65 + mine);
      } else if (item?.type === 'cloze') {
        const b = item.blanks?.[i];
        prompt = `第 ${i + 1} 空`;
        correct = b?.answer || '';
        explain = explain || b?.explain || '';
      } else if (item?.type === 'matching') {
        const s = item.statements?.[i];
        prompt = s?.text || '';
        correct = s?.answer || '';
      }
      out.push({ type: entry.type, index: i, prompt, mine, correct, explain });
    });
  }
  return out;
}

function scoreCard(r) {
  const line = r.complete ? scoreLine(r.total) : r.projected ? `已测部分 · 若补听力约 ${scoreLine(r.projected.total)}` : '未测';
  const title = r.complete ? `${num(r.total)} / 710` : `${num(r.measured)} / ${num(r.measuredMax)}`;
  const sub = r.complete
    ? `预估区间 ${Math.round(r.range[0])}–${Math.round(r.range[1])} · 分数段 ${line}`
    : `听力未测，以上为已测部分；补上听力后预计 ${Math.round(r.projected?.total || 0)} 左右`;
  return card({
    tape: true,
    children: h('div', { class: 'stack center' },
      h('div', { class: 'v-report__big' }, title),
      h('div', { class: 'v-report__sub' }, sub),
      h('div', { class: 'row', style: { 'justify-content': 'center', gap: '8px', 'flex-wrap': 'wrap' } },
        tag(r.complete ? '估算，非官方成绩' : '部分模考', r.complete ? 'yellow' : 'blue'),
        tag(`置信度 ${CONFIDENCE_LABEL[r.confidence] || '低'}`, r.confidence === 'high' ? 'mint' : r.confidence === 'medium' ? 'yellow' : 'pink'),
        r.complete ? tag(r.total >= 425 ? `高于 425 线 ${Math.round(r.total - 425)} 分` : `距 425 还差 ${Math.round(425 - r.total)} 分`, r.total >= 425 ? 'mint' : 'pink') : null,
      ),
      h('div', { class: 'xs faint', style: { 'margin-top': '8px' } }, '以本次作答按 CET 分项权重估算；作文/翻译为本地估算，不代表官方阅卷。'),
    ),
  });
}

function weaknessCard(ctx, r, attempt) {
  if (!r.weaknesses?.length) return null;
  return card({
    variant: 'yellow',
    children: h('div', { class: 'stack' },
      h('div', { class: 'bold' }, '最该补的 2 个部分'),
      r.weaknesses.map((w) => h('div', { class: 'v-report__weak' },
        h('div', { class: 'v-report__weakmain' },
          h('div', { class: 'bold' }, `${w.label} · 正确率 ${pct(w.accuracy)}`),
          h('div', { class: 'xs muted' }, recommendationFor(w.key)),
        ),
        button({
          label: '去练',
          size: 'sm',
          onClick: () => {
            track('report_weak_click', { key: w.key, paperId: attempt?.paperId || null });
            if (w.key === 'listening') ctx.go('#/listening');
            else { ctx.pending = ctx.pending || {}; ctx.pending.practice = w.key; ctx.go('#/exam'); }
          },
        }),
      )),
    ),
  });
}

function wrongCard(ctx, attempt) {
  const rows = wrongItems(ctx, attempt);
  if (!rows.length) {
    return card({ variant: 'mint', children: h('div', { class: 'stack' }, h('div', { class: 'bold' }, '这次没有客观错题'), h('div', { class: 'xs muted' }, '主观题请看写作/翻译部分，或回到解析逐题复盘。')) });
  }
  return card({
    children: h('div', { class: 'stack' },
      h('div', { class: 'bold' }, `错题 ${rows.length} 道`),
      rows.slice(0, 12).map((row) => h('div', { class: 'v-report__wrong' },
        h('div', { class: 'row row--between' },
          h('span', { class: 'bold' }, `${TYPE_LABEL[row.type] || row.type} · 第 ${row.index + 1} 题`),
          row.correct ? h('span', { class: 'xs muted' }, `正确答案 ${row.correct}`) : null,
        ),
        row.prompt ? h('div', { class: 'xs' }, row.prompt) : null,
        h('div', { class: 'xs muted' }, `你的答案：${Array.isArray(row.mine) ? row.mine.join('') : (row.mine || '空')}`),
        row.explain ? h('div', { class: 'xs faint', style: { 'white-space': 'pre-wrap' } }, row.explain) : null,
      )),
      rows.length > 12 ? h('div', { class: 'xs faint' }, `只展示前 12 道，共 ${rows.length} 道。`) : null,
    ),
  });
}

function timingCard(attempt) {
  const byType = {};
  for (const entry of attempt.items || []) {
    if (!byType[entry.type]) byType[entry.type] = 0;
    byType[entry.type] += Number(entry.elapsedMs) || 0;
  }
  const rows = Object.entries(byType).filter(([type]) => BUDGET_MIN[type]);
  if (!rows.length) return null;
  return card({
    children: h('div', { class: 'stack' },
      h('div', { class: 'bold' }, '时间分配'),
      rows.map(([type, ms]) => {
        const min = Math.round(ms / 60000);
        const over = min > BUDGET_MIN[type] * 1.3;
        return h('div', { class: 'c-kv' },
          h('span', {}, TYPE_LABEL[type] || type),
          h('span', { class: over ? 'pink bold' : '' }, `${min} 分钟 / 建议 ${BUDGET_MIN[type]}`),
        );
      }),
      h('div', { class: 'xs faint' }, '按实际停留时间统计，包含切换后台的时间。'),
    ),
  });
}

function historyCard(ctx, attempt) {
  const list = (ctx.state.examAttempts || []).filter((a) => a.level === attempt.level).slice(-5).reverse();
  if (list.length < 2) return null;
  return card({
    children: h('div', { class: 'stack' },
      h('div', { class: 'bold' }, '最近成绩'),
      list.map((a) => {
        const r = scoreAttempt(a);
        const current = a.id === attempt.id;
        return h('button', {
          type: 'button', class: ['v-report__history', current && 'is-current'].filter(Boolean).join(' '),
          onclick: () => ctx.go(`#/report/${a.id}`),
        },
          h('span', { class: 'xs muted' }, new Date(a.finishedAt || a.startedAt).toLocaleDateString('zh-CN')),
          h('span', { class: 'grow' }, attemptLabel(a)),
          h('span', { class: 'bold' }, r ? Math.round(r.total) : '—'),
        );
      }),
    ),
  });
}

export function renderReport(ctx, attempt) {
  if (typeof window !== 'undefined') window.scrollTo({ top: 0 });
  if (!attempt) return statePanel('empty', { message: '找不到这次模考记录。' });
  const r = scoreAttempt(attempt);
  const writing = attempt.writing;
  const translation = attempt.translation;
  const root = h('div', { class: 'v-report stack stack--lg' },
    h('header', { class: 'page-head' },
      h('div', null,
        h('h1', { class: 'page-title' }, '模考报告'),
        h('div', { class: 'page-sub' }, `${attemptLabel(attempt)} · ${new Date(attempt.finishedAt || attempt.startedAt).toLocaleString('zh-CN')}`),
      ),
    ),
    scoreCard(r),
    card({
      children: h('div', { class: 'stack' },
        h('div', { class: 'bold' }, '分项得分'),
        compRow('听力', r.components.listening, '未测'),
        compRow('阅读（仔细+选词+匹配）', r.components.reading, '未测'),
        compRow('写作', r.components.writing, '未评'),
        compRow('翻译', r.components.translation, '未评'),
        h('div', { class: 'xs faint', style: { 'margin-top': '8px' } }, `阅读满分 ${num(COMPONENTS.reading)}；写作按本地 15 分制换算；翻译为关键词覆盖率估算。`),
      ),
    }),
    weaknessCard(ctx, r, attempt),
    wrongCard(ctx, attempt),
    writing ? card({
      children: h('div', { class: 'stack' },
        h('div', { class: 'bold' }, `写作 · ${writing.score15}/15`),
        writing.band ? h('div', { class: 'xs muted' }, `${writing.band.label || ''} ${writing.band.desc || ''}`) : null,
        h('div', { class: 'xs faint' }, '写作分只计入本地启发式评分；可回看原文对照范文。'),
      ),
    }) : null,
    translation ? card({
      children: h('div', { class: 'stack' },
        h('div', { class: 'bold' }, `翻译 · 估算 ${Math.round((translation.estimatedRatio || 0) * 100)}%`),
        h('div', { class: 'xs muted' }, `关键词覆盖 ${translation.hit || 0}/${translation.points || 0}`),
        h('div', { class: 'xs faint' }, '翻译没有官方机器评分，只能按参考译文关键词覆盖估算。'),
      ),
    }) : null,
    timingCard(attempt),
    historyCard(ctx, attempt),
    h('div', { class: 'stack' },
      button({ label: '再做一次', variant: 'primary', block: true, onClick: () => { ctx.pending = ctx.pending || {}; ctx.pending.paperId = attempt.paperId; ctx.go('#/exam'); } }),
      button({ label: '错题本 / 学习记录', block: true, onClick: () => ctx.go('#/records') }),
      button({ label: '回题库', block: true, onClick: () => ctx.go('#/exam') }),
    ),
  );
  return root;
}

export async function render(ctx, params) {
  if (!ctx.data.examReady && ctx.ensureExamData) {
    try { await ctx.ensureExamData(); } catch { /* report can still render without item metadata */ }
  }
  const attempt = (ctx.state.examAttempts || []).find((a) => a.id === params.id);
  return renderReport(ctx, attempt);
}
