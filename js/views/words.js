/* views/words.js — search, filter, page and "sieve" the 6662-word bank. */

import { h } from '../core/dom.js';
import { button, card, chips, progress, tag, toast } from '../ui/components.js';
import { pKnow, zoneOf } from '../domain/engine.js';
import { speak } from './study.js';

const FILTERS = [
  { id: 'all', label: '全部' },
  { id: 'cet6only', label: '六级新词' },
  { id: 'cet4', label: '四级' },
  { id: 'unseen', label: '未学' },
  { id: 'wrong', label: '易错' },
  { id: 'fav', label: '收藏' },
  { id: 'known', label: '已会' },
];

const PAGE = 60;

export function render(ctx) {
  const state = ctx.state;
  const root = h('div', { class: 'v-words stack stack--lg' });
  let filter = 'all';
  let query = '';
  let limit = PAGE;
  let mode = 'list';

  const listEl = h('div', { class: 'v-words__list' });
  const countEl = h('span', { class: 'xs muted' });

  function matches(w) {
    if (query) {
      const q = query.toLowerCase();
      const inWord = w.w.includes(q);
      const inGloss = (w.t || []).some(([, cn]) => cn.includes(query));
      if (!inWord && !inGloss) return false;
    }
    const st = state.words[w.w];
    switch (filter) {
      case 'cet6only': return w.g.includes('cet6only');
      case 'cet4': return w.g.includes('cet4');
      case 'unseen': return !st;
      case 'wrong': return Boolean(state.wrong[w.w]);
      case 'fav': return state.fav.includes(w.w);
      case 'known': return Boolean(st?.k);
      default: return true;
    }
  }

  function filtered() {
    return ctx.data.words.filter(matches);
  }

  function statusTag(w) {
    const st = state.words[w.w];
    if (st?.k) return tag('已会', 'mint');
    if (state.fav.includes(w.w)) return tag('★', 'yellow');
    if (state.wrong[w.w]) return tag('易错', 'red');
    if (st?.iv) return tag('复习中', 'blue');
    return null;
  }

  function row(w) {
    const gloss = w.t?.[0] ? `${w.t[0][0]}. ${w.t[0][1]}` : '';
    return h('button', {
      type: 'button', class: 'v-words__row', onclick: () => ctx.go(`#/word/${encodeURIComponent(w.w)}`),
    },
      h('div', { class: 'grow' },
        h('div', { class: 'v-words__word display' }, w.w),
        h('div', { class: 'xs muted truncate' }, gloss),
      ),
      statusTag(w),
      h('span', { class: 'v-words__chev' }, '›'),
    );
  }

  function paintList(reset = true) {
    const rows = filtered();
    countEl.textContent = `${rows.length} 个词`;
    if (reset) listEl.replaceChildren();
    const slice = rows.slice(0, limit);
    const parts = slice.map(row);
    if (rows.length > limit) {
      parts.push(h('div', { style: { 'margin-top': '10px' } }, button({
        label: `再显示 ${Math.min(PAGE, rows.length - limit)} 个`,
        block: true,
        onClick: () => { limit += PAGE; paintList(false); },
      })));
    }
    listEl.replaceChildren(...parts);
  }

  /* ---------------- sieve mode ---------------- */

  let sieveWords = [];
  let sieveIndex = 0;
  let sieveKnown = 0;

  function startSieve() {
    const theta = state.theta;
    sieveWords = ctx.data.words
      .filter((w) => {
        if (state.words[w.w]?.k) return false;
        const p = pKnow(w.d, theta);
        return zoneOf(p) === 'frontier';
      })
      .sort((a, b) => Math.abs(a.d - theta) - Math.abs(b.d - theta))
      .slice(0, 30);
    if (!sieveWords.length) {
      toast('暂时没有待确认的词');
      return;
    }
    sieveIndex = 0;
    sieveKnown = 0;
    mode = 'sieve';
    paint();
  }

  function sieveAnswer(score) {
    const w = sieveWords[sieveIndex];
    ctx.actions.sieveAnswer(w, score);
    if (score >= 1) sieveKnown++;
    sieveIndex++;
    if (sieveIndex >= sieveWords.length) {
      mode = 'list';
      toast(`过筛完成：${sieveKnown} 个标记为已会`, 'ok');
      paint();
      return;
    }
    paint();
  }

  function sieveView() {
    const w = sieveWords[sieveIndex];
    if (!w) return h('div');
    return h('div', { class: 'stack stack--lg' },
      h('div', { class: 'row row--between' },
        tag(`过筛 ${sieveIndex + 1} / ${sieveWords.length}`, 'violet'),
      ),
      progress(sieveIndex / Math.max(sieveWords.length, 1)),
      card({
        tape: true, className: 'v-words__sievecard',
        children: h('div', { class: 'stack center', style: { 'min-height': '180px', 'justify-content': 'center' } },
          h('div', { class: 'v-onboard__wordtext display' }, w.w),
          w.i ? h('div', { class: 'muted small' }, `/${w.i}/`) : null,
          (w.t || []).slice(0, 1).map(([, cn]) => h('div', { class: 'xs muted' }, cn)),
        ),
      }),
      h('div', { class: 'answer-row' },
        button({ label: '认识', variant: 'mint', size: 'lg', block: true, onClick: () => sieveAnswer(1) }),
        button({ label: '眼熟', variant: 'primary', size: 'lg', block: true, onClick: () => sieveAnswer(0.5) }),
        button({ label: '不认识', variant: 'red', size: 'lg', block: true, onClick: () => sieveAnswer(0) }),
      ),
      button({ label: '退出过筛', variant: 'ghost', block: true, onClick: () => { mode = 'list'; paint(); } }),
    );
  }

  /* ---------------- shell ---------------- */

  function paint() {
    if (mode === 'sieve') {
      root.replaceChildren(sieveView());
      return;
    }
    root.replaceChildren(
      h('header', { class: 'page-head' },
        h('div', null,
          h('h1', { class: 'page-title' }, '单词库'),
          h('div', { class: 'page-sub' }, countEl),
        ),
        button({ label: '逐词过筛', variant: 'violet', size: 'sm', onClick: startSieve }),
      ),
      h('input', {
        class: 'c-input', type: 'search', placeholder: '搜单词或中文释义…', value: query,
        oninput: (e) => { query = e.target.value.trim(); limit = PAGE; paintList(); },
      }),
      chips(FILTERS, filter, (id) => { filter = id; limit = PAGE; paint(); }),
      listEl,
    );
    paintList();
  }

  paint();
  return root;
}

/* ---------------- word detail ---------------- */

export function renderWord(ctx, { w }) {
  const state = ctx.state;
  const word = ctx.data.byWord.get(String(w || '').toLowerCase());
  const root = h('div', { class: 'v-word stack stack--lg' });

  if (!word) {
    root.append(
      h('header', { class: 'page-head' }, h('h1', { class: 'page-title' }, '没找到这个词')),
      button({ label: '返回单词库', onClick: () => ctx.go('#/words') }),
    );
    return root;
  }

  const st = state.words[word.w];
  const isKnown = Boolean(st?.k);
  const detail = ctx.data.details?.get(word.w);
  if (!ctx.data.detailsReady) {
    ctx.ensureDetails?.().then(() => ctx.refresh?.()).catch(() => {});
  }

  root.append(
    h('header', { class: 'page-head' },
      h('div', null,
        h('h1', { class: 'page-title display' }, word.w),
        h('div', { class: 'page-sub' }, word.i ? `/${word.i}/` : '暂无音标'),
      ),
      h('button', {
        type: 'button', class: 'c-btn c-btn--sm', 'aria-label': '朗读',
        onclick: () => speak(word.w),
      }, '🔊 朗读'),
    ),
    h('div', { class: 'c-pill-row' },
      word.g.includes('cet4') ? tag('四级', 'blue') : null,
      word.g.includes('cet6') ? tag('六级', 'violet') : null,
      word.g.includes('cet6only') ? tag('六级新词', 'yellow') : null,
      st?.iv ? tag(`间隔 ${Math.round(st.iv * 10) / 10} 天`) : null,
    ),
    card({
      children: h('div', { class: 'stack' },
        h('div', { class: 'c-label' }, '释义'),
        (word.t || []).map(([pos, cn]) => h('div', { class: 'v-study__meaning' },
          h('span', { class: 'c-tag', style: { 'margin-right': '8px' } }, pos),
          h('span', {}, cn),
        )),
      ),
    }),
    detail?.e?.length ? card({
      variant: 'yellow',
      children: h('div', { class: 'stack' },
        h('div', { class: 'c-label' }, '例句'),
        detail.e.map(([en, cn]) => h('div', { class: 'v-study__example' },
          h('div', { class: 'v-study__en' }, en),
          h('div', { class: 'xs muted' }, cn),
        )),
      ),
    }) : null,
    detail?.p?.length ? card({
      children: h('div', { class: 'stack' },
        h('div', { class: 'c-label' }, '搭配'),
        h('div', { class: 'c-pill-row' }, detail.p.map(([en, cn]) => h('span', { class: 'c-tag', title: cn }, en))),
      ),
    }) : null,
    h('div', { class: 'stack' },
      isKnown
        ? button({ label: '取消「已会」，放回队列', block: true, onClick: () => { ctx.actions.unmarkKnown(word); paint(); } })
        : button({ label: '标记为已会（不再推给我）', variant: 'mint', block: true, onClick: () => { ctx.actions.markKnown(word); paint(); } }),
      button({
        label: state.fav.includes(word.w) ? '取消收藏' : '收藏',
        block: true,
        onClick: () => { ctx.actions.toggleFav(word); paint(); },
      }),
      button({ label: '开始学这个词', variant: 'primary', block: true, onClick: () => ctx.go('#/today') }),
    ),
  );

  function paint() {
    ctx.refresh?.();
  }

  return root;
}
