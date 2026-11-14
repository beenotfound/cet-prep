/* views/records.js — mock-attempt history, practice history and wrong-question book. */

import { h } from '../core/dom.js';
import { button, statePanel } from '../ui/components.js';
import { scoreAttempt } from '../domain/report.js';
import { typeLabel } from '../domain/progress.js';

const TABS = [
  { id: 'exam', label: '模考记录' },
  { id: 'practice', label: '专项记录' },
  { id: 'wrong', label: '错题本' },
];

const WRONG_FILTERS = [
  { id: 'all', label: '全部' },
  { id: 'reading', label: '仔细阅读' },
  { id: 'cloze', label: '选词填空' },
  { id: 'matching', label: '长篇匹配' },
  { id: 'vocab', label: '词汇' },
];

function fmtDate(value) {
  return new Date(value || Date.now()).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function examRows(ctx) {
  const list = (ctx.state.examAttempts || []).slice().sort((a, b) => (b.finishedAt || 0) - (a.finishedAt || 0));
  if (!list.length) return statePanel('empty', { message: '还没有模考记录，做完一套整卷后会出现在这里。' });
  return h('div', { class: 'stack' },
    list.map((a) => {
      const r = scoreAttempt(a);
      return h('button', {
        type: 'button', class: 'v-records__row',
        onclick: () => ctx.go(`#/report/${a.id}`),
      },
        h('div', { class: 'grow' },
          h('div', { class: 'bold' }, a.paperTitle || a.paperId),
          h('div', { class: 'xs muted' }, `${fmtDate(a.finishedAt || a.startedAt)} · ${r?.complete ? '完整模考' : '笔试部分'}${a.listening ? ' · 含听力' : ''}`),
        ),
        h('div', { class: 'v-records__score' },
          h('div', { class: 'bold' }, r ? `${Math.round(r.total)}` : '—'),
          h('div', { class: 'xs faint' }, '估分'),
        ),
      );
    }),
  );
}

function practiceRows(ctx) {
  const list = (ctx.state.practiceAttempts || []).slice().sort((a, b) => (b.finishedAt || 0) - (a.finishedAt || 0));
  if (!list.length) return statePanel('empty', { message: '还没有专项练习记录，去题库做一组专项吧。' });
  return h('div', { class: 'stack' },
    list.map((a) => {
      const items = a.items || [];
      const total = items.reduce((n, x) => n + (Number(x.total) || 0), 0);
      const correct = items.reduce((n, x) => n + (Number(x.correct) || 0), 0);
      return h('div', { class: 'v-records__row is-static' },
        h('div', { class: 'grow' },
          h('div', { class: 'bold' }, `${a.title || typeLabel(a.type)} · ${items.length} 题`),
          h('div', { class: 'xs muted' }, `${fmtDate(a.finishedAt || a.startedAt)} · 正确 ${correct}/${total}`),
        ),
        h('div', { class: 'v-records__score' },
          h('div', { class: 'bold' }, total ? `${Math.round(correct / total * 100)}%` : '—'),
          h('div', { class: 'xs faint' }, '正确率'),
        ),
      );
    }),
  );
}

function wrongRows(ctx, filter) {
  let list = (ctx.state.wrongBook || []).slice().sort((a, b) => (b.lastAt || 0) - (a.lastAt || 0));
  if (filter === 'vocab') list = list.filter((x) => ['w2m', 'm2w', 'fill', 'spell'].includes(x.type));
  else if (filter !== 'all') list = list.filter((x) => x.type === filter);
  if (!list.length) {
    return statePanel('empty', {
      message: filter === 'all' ? '错题本是空的；整卷或专项里答错的客观题会自动收进来。' : '这个题型还没有错题。',
    });
  }
  const uniqueIds = [...new Set(list.map((x) => x.itemId))];
  return h('div', { class: 'stack' },
    h('div', { class: 'row row--between' },
      h('span', { class: 'xs muted' }, `共 ${list.length} 道 · ${uniqueIds.length} 篇/组`),
      button({
        label: '重做这些错题',
        variant: 'primary',
        size: 'sm',
        onClick: () => {
          ctx.pending = ctx.pending || {};
          ctx.pending.wrongItems = uniqueIds;
          ctx.go('#/exam');
        },
      }),
    ),
    list.map((x) => h('div', { class: 'v-wrong' },
      h('div', { class: 'row row--between' },
        h('span', { class: 'bold' }, `${typeLabel(x.type)} · 第 ${Number(x.qIndex) + 1} 题`),
        h('span', { class: 'xs muted' }, x.count > 1 ? `错过 ${x.count} 次` : fmtDate(x.lastAt)),
      ),
      x.prompt ? h('div', { class: 'xs' }, x.prompt) : null,
      h('div', { class: 'xs muted' }, `你的答案：${x.mine || '空'} · 正确答案 ${x.correct || '—'}`),
      x.explain ? h('div', { class: 'xs faint', style: { 'white-space': 'pre-wrap' } }, x.explain) : null,
      h('div', { class: 'row', style: { 'margin-top': '4px' } },
        button({ label: '移出错题本', size: 'sm', onClick: () => { ctx.actions.removeWrongItem(x.key); paint(); } }),
      ),
    )),
  );
}

export function render(ctx) {
  const root = h('div', { class: 'v-records stack stack--lg' });
  let tab = 'exam';
  let wrongFilter = 'all';

  function paint() {
    root.replaceChildren(
      h('header', { class: 'page-head' },
        h('div', null,
          h('h1', { class: 'page-title' }, '学习记录'),
          h('div', { class: 'page-sub' }, '模考、专项和错题都只保存在本机'),
        ),
      ),
      h('div', { class: 'row row--wrap' }, TABS.map((t) => button({
        label: t.label,
        variant: tab === t.id ? 'primary' : 'ghost',
        size: 'sm',
        onClick: () => { tab = t.id; paint(); },
      }))),
      tab === 'exam' ? examRows(ctx) : tab === 'practice' ? practiceRows(ctx) : h('div', { class: 'stack' },
        h('div', { class: 'row row--wrap' },
          WRONG_FILTERS.map((f) => h('button', {
            type: 'button',
            class: ['c-chip', wrongFilter === f.id && 'is-active'].filter(Boolean).join(' '),
            onclick: () => { wrongFilter = f.id; paint(); },
          }, f.label)),
        ),
        wrongRows(ctx, wrongFilter),
      ),
      h('div', { class: 'row', style: { 'margin-top': '8px' } },
        button({ label: '回题库', block: true, onClick: () => ctx.go('#/exam') }),
        button({ label: '回今日', block: true, onClick: () => ctx.go('#/today') }),
      ),
    );
  }

  paint();
  return root;
}
