/* views/today.js — the daily dashboard and entry into a study session. */

import { h } from '../core/dom.js';
import { button, card, progress, tag, sticker } from '../ui/components.js';
import { buildQueue, estimateKnown } from '../domain/engine.js';
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
        h('h1', { class: 'page-title' }, '先花 3 分钟，', h('br'), h('span', { class: 'marked' }, '认清自己')),
        h('p', { class: 'muted small', style: { 'margin-top': '8px' } },
          '做完校准，已经会的词不会再出现在你的学习队列里。'),
      ),
      card({
        variant: 'yellow', tape: true,
        children: h('div', { class: 'stack' },
          h('div', { class: 'bold' }, '为什么值得先测'),
          h('div', { class: 'small muted' },
            '市面上的"词汇量测试"只给一个分数。这里给的是逐词清单：哪些不用学、哪些是边缘、哪些立刻开始。'),
        ),
      }),
      button({ label: '开始 3 分钟校准', variant: 'primary', size: 'lg', block: true, onClick: () => ctx.go('#/onboarding') }),
    );
  }

  /* ---------------- home ---------------- */

  const days = daysUntil(state.profile.examDate);
  const known = estimateKnown(ctx.data.words, state.theta, state.profile.level);
  const mastered = Object.values(state.words).filter((w) => w.k).length;

  function start(words, label) {
    if (!words.length) { ctx.toast('这一组是空的，换个模式试试'); return; }
    root.replaceChildren(createStudySession(ctx, { queue: words, title: label }));
  }

  const home = h('div', { class: 'stack stack--lg' },
    h('header', { class: 'v-today__head' },
      h('div', { class: 'xs bold muted' }, `${weekday()} · ${new Date().toLocaleDateString('zh-CN')}`),
      h('h1', { class: 'page-title' },
        '今天', h('span', { class: 'marked' }, '只学不会的'),
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
            h('div', { style: { 'font-size': '40px' } }, '☕'),
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

    card({
      children: h('div', { class: 'stack' },
        h('div', { class: 'row row--between' },
          h('div', { class: 'bold' }, '你的进度'),
          h('span', { class: 'xs muted' }, `θ=${state.theta.toFixed(2)}`),
        ),
        h('div', { class: 'c-kv' }, h('span', { class: 'muted' }, '预计已掌握'), h('span', { class: 'bold' }, `${known.known} / ${known.total}`)),
        progress(known.known / Math.max(known.total, 1)),
        h('div', { class: 'c-kv' }, h('span', { class: 'muted' }, '手动标记已会'), h('span', { class: 'bold' }, `${mastered}`)),
        h('div', { class: 'c-kv' }, h('span', { class: 'muted' }, '今日新词 / 复习'), h('span', { class: 'bold' }, `${today.new} / ${today.review}`)),
      ),
    }),

    h('div', { class: 'row row--wrap' },
      button({ label: '📚 单词库', onClick: () => ctx.go('#/words') }),
      button({ label: '📝 题库', onClick: () => ctx.go('#/exam') }),
      button({ label: '🎯 重新校准', onClick: () => ctx.go('#/onboarding') }),
    ),
  );

  root.append(home);
  return root;
}
