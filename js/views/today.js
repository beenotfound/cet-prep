/* views/today.js — the daily dashboard and entry into a study session. */

import { h } from '../core/dom.js';
import { button, card, progress, tag, sticker } from '../ui/components.js';
import { icon } from '../ui/icons.js';
import { buildQueue, estimateKnown } from '../domain/engine.js';
import { coverageOf, coveragePlan, recommendPassages } from '../domain/coverage.js';
import { createStudySession } from './study.js';
import { daysUntil, weekday } from '../core/format.js';

export function render(ctx) {
  const root = h('div', { class: 'v-today stack stack--lg' });
  const state = ctx.state;

  if (!state.profile.onboarded) {
    root.append(welcome());
    return root;
  }

  const queue = buildQueue(ctx.data.words, state, state.profile.level);
  const review = queue.review.slice(0, 120);
  // Unknown words first, then the uncertain band — otherwise a strong learner
  // ends up with an empty queue while thousands of words sit unresolved.
  const freshPool = [...queue.fresh, ...queue.frontier];
  const fresh = freshPool.slice(0, state.profile.dailyNew);
  const today = state.stats.days?.[todayKey()] || { new: 0, review: 0, total: 0 };

  function todayKey() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }

  function welcome() {
    return h('div', { class: 'stack stack--lg' },
      h('header', { class: 'v-today__hero' },
        h('div', { class: 'c-tape' }),
        h('h1', { class: 'page-title' }, '首先', h('br'), '我们需要了解你的', h('span', { class: 'marked' }, '词汇量')),
      ),
      card({
        variant: 'yellow', tape: true,
        children: h('div', { class: 'stack' },
          h('div', { class: 'bold' }, '背单词拒绝从abandon开始'),
        ),
      }),
      button({ label: '开始词汇量校准', variant: 'primary', size: 'lg', block: true, onClick: () => ctx.go('#/onboarding') }),
    );
  }

  /* ---------------- home ---------------- */

  const days = daysUntil(state.profile.examDate);
  const known = estimateKnown(ctx.data.words, state.theta, state.profile.level);
  const mastered = Object.values(state.words).filter((w) => w.k).length;
  const reviewing = Object.values(state.words).filter((w) => (w.reps || 0) > 0).length;

  const corpus = ctx.data.readingStats?.corpus;
  const coverage = corpus ? coverageOf(corpus, ctx.data.byWord, state.theta, state) : null;
  const plan = corpus ? coveragePlan(corpus, ctx.data.byWord, state.theta, state, { step: 0.05 }) : null;
  const readingPick = ctx.data.readingStats
    ? recommendPassages(ctx.data.readingStats.passages, ctx.data.byWord, state.theta, state, { level: state.profile.level })[0]
    : null;

  function start(words, label) {
    if (!words.length) { ctx.toast('这一组是空的，换个模式试试'); return; }
    root.replaceChildren(createStudySession(ctx, { queue: words, title: label }));
  }

  const home = h('div', { class: 'stack stack--lg' },
    h('header', { class: 'v-today__head' },
      h('div', { class: 'xs bold muted' }, `${weekday()} · ${new Date().toLocaleDateString('zh-CN')}`),
      h('h1', { class: 'page-title' },
        '今天', h('span', { class: 'marked' }, '学点什么'), '呢',
      ),
      days != null
        ? h('div', { class: 'row', style: { 'margin-top': '6px' } },
            tag(`距考试 ${days} 天`, days <= 30 ? 'red' : 'yellow'),
            state.stats.streak > 0 ? tag(`连续 ${state.stats.streak} 天`, 'mint') : null,
          )
        : null,
    ),

    h('div', { class: 'v-today__stats' },
      h('div', { class: 'c-card c-card--yellow c-card--flat v-today__stat' },
        h('div', { class: 'v-today__statnum' }, `${review.length}`),
        h('div', { class: 'xs bold' }, '待复习'),
      ),
      h('div', { class: 'c-card c-card--flat v-today__stat' },
        h('div', { class: 'v-today__statnum' }, `${fresh.length}`),
        h('div', { class: 'xs bold' }, '新词'),
      ),
      h('div', { class: 'c-card c-card--mint c-card--flat v-today__stat' },
        h('div', { class: 'v-today__statnum' }, `${today.new + today.review}`),
        h('div', { class: 'xs bold' }, '今日已学'),
      ),
    ),

    review.length + fresh.length === 0
      ? card({
          variant: 'mint', tape: true,
          children: h('div', { class: 'stack center' },
            h('div', { class: 'v-today__illust' }, icon('cup', 'c-icon--xl')),
            h('div', { class: 'bold' }, '今天没有要复习的词'),
            h('div', { class: 'small muted' }, '可以去题库练练阅读和翻译'),
          ),
        })
      : h('div', { class: 'stack' },
          button({
            label: `开始学习 · ${review.length + fresh.length} 个词`,
            variant: 'primary', size: 'lg', block: true,
            onClick: () => start([...review, ...fresh], '今日学习'),
          }),
          h('div', { class: 'row' },
            button({ label: `只复习 ${review.length}`, block: true, onClick: () => start(review, '复习') }),
            button({ label: `只学新词 ${fresh.length}`, block: true, onClick: () => start(fresh, '新词') }),
          ),
        ),

    readingPick ? card({
      tape: true,
      children: h('div', { class: 'stack' },
        h('div', { class: 'bold' }, '今天读哪篇'),
        h('div', { class: 'bold small', style: { 'margin-top': '6px' } }, readingPick.passage.title),
        h('div', { class: 'xs muted' },
          `生词率 ${((1 - readingPick.ratio) * 100).toFixed(1)}% · 还差 ${readingPick.unknownWords} 个词就全认识`),
        h('div', { style: { 'margin-top': '10px' } },
          button({
            label: '开始读这篇', variant: 'primary', block: true,
            onClick: () => { ctx.pending.reading = readingPick.passage.id; ctx.go('#/exam'); },
          }),
        ),
      ),
    }) : null,

    card({
      children: h('div', { class: 'stack' },
        h('div', { class: 'row row--between' },
          h('div', { class: 'bold' }, '你的进度'),
          h('span', { class: 'xs muted' }, `θ=${state.theta.toFixed(2)}`),
        ),
        h('div', { class: 'c-kv' }, h('span', { class: 'muted' }, '预计已掌握'), h('span', { class: 'bold' }, `${known.known} / ${known.total}`)),
        progress(known.known / Math.max(known.total, 1)),
        coverage ? h('div', { class: 'c-kv' },
          h('span', { class: 'muted' }, '阅读覆盖率'),
          h('span', { class: 'bold' }, `${Math.round(coverage.ratio * 100)}%`)) : null,
        coverage && coverage.ratio < 0.9 && plan && plan.need > 0
          ? h('div', { class: 'xs faint' }, `再学 ${plan.need} 个高频词可到 ${Math.floor(plan.goal * 100)}%`)
          : null,
        h('div', { class: 'c-kv' }, h('span', { class: 'muted' }, '已进入复习'), h('span', { class: 'bold' }, `${reviewing}`)),
        h('div', { class: 'c-kv' }, h('span', { class: 'muted' }, '手动标记已会'), h('span', { class: 'bold' }, `${mastered}`)),
        h('div', { class: 'c-kv' }, h('span', { class: 'muted' }, '今日新词 / 复习'), h('span', { class: 'bold' }, `${today.new} / ${today.review}`)),
      ),
    }),

    h('div', { class: 'row row--wrap' },
      button({ label: '单词库', icon: icon('words'), onClick: () => ctx.go('#/words') }),
      button({ label: '题库', icon: icon('exam'), onClick: () => ctx.go('#/exam') }),
      button({ label: '重新校准', icon: icon('target'), onClick: () => ctx.go('#/onboarding') }),
    ),
  );

  root.append(home);
  return root;
}
