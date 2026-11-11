/* views/study.js — the reusable word-card session used by 今日 and 单词. */

import { h } from '../core/dom.js';
import { button, card, progress, tag, toast, showSheet } from '../ui/components.js';
import { explainWord, reportAIError } from '../features/ai.js';
import { pKnow, ZONES } from '../domain/engine.js';

export function speak(text) {
  if (!('speechSynthesis' in window)) return;
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'en-US';
  u.rate = 0.9;
  try { speechSynthesis.cancel(); speechSynthesis.speak(u); } catch { /* ignore */ }
}

function meanings(word) {
  return (word.t || []).slice(0, 2).map(([pos, cn]) => h('div', { class: 'v-study__meaning' },
    h('span', { class: 'c-tag', style: { 'margin-right': '8px' } }, pos),
    h('span', {}, cn),
  ));
}

function examples(detail) {
  if (!detail?.e?.length) return null;
  return h('div', { class: 'v-study__block' },
    h('div', { class: 'c-label' }, '例句'),
    detail.e.slice(0, 1).map(([en, cn]) => h('div', { class: 'v-study__example' },
      h('div', { class: 'v-study__en' }, en),
      h('div', { class: 'xs muted' }, cn),
    )),
  );
}

function phrases(detail) {
  if (!detail?.p?.length) return null;
  return h('div', { class: 'v-study__block' },
    h('div', { class: 'c-label' }, '搭配'),
    h('div', { class: 'c-pill-row' }, detail.p.slice(0, 3).map(([en, cn]) => h('span', { class: 'c-tag', title: cn }, en))),
  );
}

/** Build a study session element. queue: word[] */
export function createStudySession(ctx, { queue, onDone, title = '学习' }) {
  const words = queue.slice();
  const root = h('div', { class: 'v-study stack stack--lg' });
  const session = { done: 0, again: 0, index: 0, revealed: false };
  let current = null;
  let finished = false;

  const keyHandler = (e) => {
    if (!root.isConnected) {
      document.removeEventListener('keydown', keyHandler);   // session was left
      return;
    }
    if (finished) return;
    if (e.target.matches('input, textarea, select')) return;
    if (e.code === 'Space') { e.preventDefault(); if (!session.revealed) reveal(); return; }
    if (session.revealed && ['1', '2', '3', '4'].includes(e.key)) grade(Number(e.key) - 1);
  };
  document.addEventListener('keydown', keyHandler);

  function cleanup() {
    document.removeEventListener('keydown', keyHandler);
    finished = true;
  }

  function paint() {
    if (!root.isConnected && finished) return;
    current = words[session.index] || null;
    if (!current) return finish();
    root.replaceChildren(header(), cardView());
  }

  function header() {
    return h('div', { class: 'stack' },
      h('div', { class: 'row row--between' },
        tag(title, 'yellow'),
        h('span', { class: 'small muted' }, `${Math.min(session.index + 1, words.length)} / ${words.length}`),
      ),
      progress(session.index / words.length),
    );
  }

  function cardView() {
    const w = current;
    const st = ctx.state.words[w.w];
    const edge = !st && pKnow(w.d, ctx.state.theta) > ZONES.unknown;
    const detail = ctx.data.details?.get(w.w);
    return h('div', { class: 'stack' },
      card({
        tape: true,
        className: 'v-study__card',
        children: h('div', { class: 'stack' },
          h('div', { class: 'row row--between' },
            h('div', { class: 'row' },
              h('span', { class: 'c-tag c-tag--mint' }, st ? '复习' : edge ? '边缘词' : '新词'),
              w.g.includes('cet6only') ? h('span', { class: 'c-tag c-tag--violet' }, '六级新词') : null,
            ),
            h('button', {
              type: 'button', class: 'c-btn c-btn--ghost c-btn--sm', 'aria-label': '收藏',
              onclick: () => { ctx.actions.toggleFav(w); toast(ctx.state.fav.includes(w.w) ? '已收藏' : '已取消收藏'); },
            }, ctx.state.fav.includes(w.w) ? '★' : '☆'),
          ),
          h('div', { class: 'v-study__word display' }, w.w),
          h('div', { class: 'row', style: { 'justify-content': 'center', gap: '10px' } },
            w.i ? h('span', { class: 'muted small' }, `/${w.i}/`) : null,
            h('button', {
              type: 'button', class: 'c-btn c-btn--ghost c-btn--sm', 'aria-label': '朗读',
              onclick: () => speak(w.w),
            }, '🔊'),
          ),
        ),
      }),
      session.revealed
        ? card({
            variant: 'yellow',
            children: h('div', { class: 'stack' },
              h('div', { class: 'stack' }, meanings(w)),
              examples(detail),
              phrases(detail),
              !detail && !ctx.data.detailsReady
                ? h('div', { class: 'xs faint' }, '例句正在后台加载…')
                : null,
              h('div', { style: { 'margin-top': '10px' } },
                h('button', {
                  type: 'button', class: 'c-btn c-btn--ghost c-btn--sm',
                  onclick: async () => {
                    try {
                      const text = await explainWord(w, ctx);
                      await showSheet({ title: `AI 解释 · ${w.w}`, body: h('div', { class: 'small', style: { 'white-space': 'pre-wrap' } }, text), actions: [{ label: '知道了' }] });
                    } catch (error) { reportAIError(ctx, error); }
                  },
                }, 'AI 解释'),
              ),
            ),
          })
        : h('div', { class: 'stack' },
            button({ label: '显示释义', variant: 'primary', size: 'lg', block: true, onClick: reveal }),
          ),
      session.revealed ? gradeRow(w) : null,
      h('div', { class: 'row row--between' },
        h('button', {
          type: 'button', class: 'c-btn c-btn--ghost c-btn--sm',
          onclick: () => { ctx.actions.markKnown(w); session.index++; session.revealed = false; paint(); },
        }, '我会了'),
        h('button', {
          type: 'button', class: 'c-btn c-btn--ghost c-btn--sm',
          onclick: () => { session.index++; session.revealed = false; paint(); },
        }, '跳过 →'),
      ),
    );
  }

  function reveal() {
    session.revealed = true;
    if (!ctx.data.detailsReady) {
      ctx.ensureDetails?.()
        .then(() => { if (root.isConnected && session.revealed) paint(); })
        .catch(() => {});
    }
    paint();
  }

  function gradeRow(w) {
    const opts = [
      { g: 0, label: '不认识', variant: 'red' },
      { g: 1, label: '模糊', variant: '' },
      { g: 2, label: '认识', variant: 'mint' },
      { g: 3, label: '熟练', variant: 'blue' },
    ];
    return h('div', { class: 'v-study__grades' },
      opts.map((o) => button({
        label: o.label, variant: o.variant, block: true,
        onClick: () => grade(o.g),
      })),
    );
  }

  function grade(g) {
    if (!current) return;
    ctx.actions.gradeWord(current, g);
    if (g === 0) session.again++;
    session.done++;
    session.index++;
    session.revealed = false;
    paint();
  }

  function finish() {
    cleanup();
    root.replaceChildren(
      h('div', { class: 'stack stack--lg' },
        card({
          tape: true,
          variant: 'mint',
          children: h('div', { class: 'stack center', style: { padding: '10px 0' } },
            h('div', { style: { 'font-size': '44px' } }, '🎉'),
            h('div', { class: 'bold', style: { 'font-size': '20px' } }, '这一组完成了'),
            h('div', { class: 'small muted' }, `学了 ${session.done} 个 · 需要重来 ${session.again} 个`),
          ),
        }),
        button({ label: '回到今日', variant: 'primary', size: 'lg', block: true, onClick: () => ctx.go('#/today') }),
        button({
          label: '再来一组', block: true, variant: 'ghost',
          onClick: () => { onDone?.(); ctx.go('#/today'); },
        }),
      ),
    );
  }

  paint();
  return root;
}
