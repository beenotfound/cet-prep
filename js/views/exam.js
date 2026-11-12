/* views/exam.js — question bank: practice sets and full mock papers. */

import { h } from '../core/dom.js';
import { button, card, tag, progress, toast, showSheet, statePanel, chips } from '../ui/components.js';
import { renderItem, feedbackView } from './exam-items.js';
import { writingReview } from '../features/writing-review.js';
import { gradeItem, formatClock } from '../domain/exam.js';
import { gradeTranslation, gradeWriting, reportAIError } from '../features/ai.js';

const TYPE_LABEL = {
  vocab: '词汇速练', reading: '仔细阅读', cloze: '选词填空',
  matching: '长篇匹配', translation: '翻译', writing: '写作',
};

const VOCAB_SET = new Set(['w2m', 'm2w', 'fill', 'spell']);
/** choice questions grade the moment you tap an option — no separate submit step */
const INSTANT = new Set(['w2m', 'm2w', 'fill']);
export const vocabPool = (ctx) => [...ctx.data.questionsVocab.items, ...(ctx.state.custom || []).filter((i) => VOCAB_SET.has(i.type))];
export const contentPool = (ctx) => [...ctx.data.content, ...(ctx.state.custom || []).filter((i) => !VOCAB_SET.has(i.type))];

const PRACTICE = [
  { type: 'vocab', label: '词汇速练', desc: '中英互选·例句填空·拼写', tone: 'yellow' },
  { type: 'reading', label: '仔细阅读', desc: '5 题/篇 · 带解析', tone: 'blue' },
  { type: 'cloze', label: '选词填空', desc: '15 选 10', tone: 'mint' },
  { type: 'matching', label: '长篇匹配', desc: '10 段 · 10 题', tone: 'violet' },
  { type: 'translation', label: '翻译', desc: '参考译文 + AI 点评', tone: 'pink' },
  { type: 'writing', label: '写作', desc: '范文 + AI 批改', tone: 'yellow' },
];

/** Shows a loading state immediately, then fills the same root once the exam bundle arrives. */
function shuffle(items) {
  const copy = items.slice();
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

export function render(ctx) {
  const root = h('div', { class: 'v-exam stack stack--lg' });
  if (ctx.data.examReady) {
    build(ctx, root);
    return root;
  }
  root.appendChild(statePanel('loading', { message: '正在加载题库…' }));
  ctx.ensureExamData()
    .then(() => build(ctx, root))
    .catch((error) => {
      root.replaceChildren(statePanel('error', {
        message: error.message,
        action: button({ label: '重试', variant: 'primary', onClick: () => ctx.refresh() }),
      }));
    });
  return root;
}

function build(ctx, root) {
  let mode = 'home';
  let queue = [];
  let idx = 0;
  let runner = null;
  let answered = false;
  let session = { correct: 0, total: 0, pending: 0, byType: {} };
  let paperTitle = '';
  let timer = null;
  let startedAt = 0;
  let clockEl = null;
  let runnerIdx = -1;

  function stopTimer() { if (timer) { clearInterval(timer); timer = null; } }

  /** Only the clock text is updated every second — repainting the view would
   *  rebuild <details>/<textarea> and lose the user's open state and input. */
  function startTimer() {
    stopTimer();
    startedAt = Date.now();
    timer = setInterval(() => {
      if (!root.isConnected || mode !== 'run' || !clockEl || !clockEl.isConnected) {
        if (!root.isConnected) stopTimer();   // view was navigated away: clean up
        return;
      }
      clockEl.textContent = `⏱ ${formatClock(Date.now() - startedAt)}`;
    }, 1000);
  }

  function begin(entries, title) {
    if (!entries.length) { ctx.toast('这里还没有内容'); return false; }
    queue = entries;
    idx = 0;
    answered = false;
    session = { correct: 0, total: 0, pending: 0, byType: {} };
    paperTitle = title;
    mode = 'run';
    runnerIdx = -1;
    clockEl = null;
    startTimer();
    paint();
    return true;
  }

  function startPractice(type) {
    let items;
    if (type === 'vocab') {
      items = pickVocab(ctx, 20);
    } else {
      const pool = contentPool(ctx).filter((i) => i.type === type && matchesLevel(i));
      items = shuffle(pool).slice(0, type === 'translation' ? 3 : type === 'writing' ? 3 : 5);
    }
    begin(items.map((item) => ({ item })), TYPE_LABEL[type] || type);
  }

  function startPaper(paper) {
    const items = [];
    paper.sections.forEach((section, si) => {
      section.ids.forEach((id, ii) => {
        const item = ctx.data.contentById.get(id);
        if (item) items.push({ item, si, ii });
      });
    });
    begin(items, paper.title || '模拟卷');
  }

  function matchesLevel(item) {
    const lv = ctx.state.profile.level;
    return lv === 'both' || lv === 'cet6' ? item.level !== 'cet4' : item.level === 'cet4';
  }

  function pickVocab(ctx, n) {
    const pool = vocabPool(ctx).filter((i) => {
      const lv = ctx.state.profile.level;
      if (lv === 'both') return true;
      if (lv === 'cet4') return i.level === 'cet4';
      return i.level !== 'cet4';
    });
    const out = [];
    const used = new Set();
    while (out.length < n && out.length < pool.length) {
      const i = Math.floor(Math.random() * pool.length);
      if (used.has(i)) continue;
      used.add(i);
      out.push(pool[i]);
    }
    return out;
  }

  /* ---------------- home ---------------- */

  function home() {
    const levelOk = (item) => {
      const level = ctx.state.profile.level;
      return level === 'both' ? true : level === 'cet4' ? item.level === 'cet4' : item.level !== 'cet4';
    };
    const subEl = h('div', { class: 'page-sub' });
    const chipHost = h('div');
    const paperHost = h('div', { class: 'stack' });
    const countEls = new Map();
    const COLLAPSE = 6;
    let expanded = false;

    function refresh() {
      const vocabCount = vocabPool(ctx).filter(levelOk).length;
      const readWriteCount = contentPool(ctx).filter(levelOk).length;
      subEl.textContent = `词汇题 ${vocabCount} 道 · 读写题 ${readWriteCount} 篇`;
      for (const [type, el] of countEls) {
        el.textContent = type === 'vocab'
          ? '20 题/组'
          : `${contentPool(ctx).filter((i) => i.type === type && levelOk(i)).length} 篇`;
      }
      const papers = ctx.data.papers.items.filter(levelOk).slice().sort((a, b) => {
        const rank = (p) => (p.id.startsWith('bank-real4-') ? 0 : p.id.startsWith('bank-') ? 1 : 2);
        return rank(a) - rank(b) || (a.id < b.id ? 1 : -1);
      });
      const shown = expanded ? papers : papers.slice(0, COLLAPSE);
      const cards = shown.map((paper) => card({
        className: 'v-exam__paper',
        children: h('div', { class: 'row row--between' },
          h('div', { class: 'grow' },
            h('div', { class: 'bold' }, paper.title),
            h('div', { class: 'xs muted' }, `${paper.sections.length} 个部分 · ${paper.sections.reduce((a, s) => a + s.ids.length, 0)} 题`),
          ),
          button({ label: '开始', size: 'sm', variant: 'primary', onClick: () => startPaper(paper) }),
        ),
      }));
      if (papers.length > COLLAPSE) {
        cards.push(button({
          label: expanded ? '收起' : `显示全部 ${papers.length} 套`,
          variant: 'ghost', block: true, size: 'sm',
          onClick: () => { expanded = !expanded; refresh(); },
        }));
      }
      paperHost.replaceChildren(...(cards.length ? cards : [h('div', { class: 'c-panel small' }, '这个级别还没有整卷')]));
    }

    function refreshChips() {
      chipHost.replaceChildren(chips(
        [{ id: 'cet4', label: '四级' }, { id: 'cet6', label: '六级' }, { id: 'both', label: '混合' }],
        ctx.state.profile.level,
        (id) => {
          ctx.actions.setProfile({ level: id });
          refreshChips();
          refresh();
        },
      ));
    }

    refreshChips();
    refresh();

    return h('div', { class: 'stack stack--lg' },
      h('header', { class: 'page-head' },
        h('div', null, h('h1', { class: 'page-title' }, '题库'), subEl),
      ),
      chipHost,
      h('h2', { class: 'bold', style: { 'font-size': '18px' } }, '专项练习'),
      h('div', { class: 'v-exam__grid' },
        PRACTICE.map((p) => {
          const countEl = h('div', { class: 'xs bold' });
          countEls.set(p.type, countEl);
          return card({
            variant: p.tone,
            className: 'v-exam__tile',
            children: h('div', { class: 'stack' },
              h('div', { class: 'bold', style: { 'font-size': '17px' } }, p.label),
              h('div', { class: 'xs muted' }, p.desc),
              countEl,
              button({ label: '开始', size: 'sm', onClick: () => startPractice(p.type) }),
            ),
          });
        }),
      ),
      h('div', { class: 'c-divider', style: { 'margin': '6px 0' } }),
      h('h2', { class: 'bold', style: { 'font-size': '18px' } }, '整卷'),
      paperHost,
    );
  }

  /* ---------------- run ---------------- */

  function run() {
    const entry = queue[idx];
    if (!entry) return null;
    const item = entry.item;
    const instant = INSTANT.has(item.type);
    if (!answered && runnerIdx !== idx) {
      runner = renderItem(ctx, item, { onPick: instant ? pickInstant : undefined });
      runnerIdx = idx;
    }

    clockEl = h('span', { class: 'small bold', dataset: { clock: '1' } }, `⏱ ${formatClock(startedAt ? Date.now() - startedAt : 0)}`);
    return h('div', { class: 'stack' },
      h('div', { class: 'row row--between' },
        tag(paperTitle, 'yellow'),
        h('span', { class: 'small muted' }, `${Math.min(idx + 1, queue.length)} / ${queue.length}`),
        clockEl,
      ),
      progress(idx / queue.length),
      answered && item.type === 'writing' ? writingReview(ctx, item, entry.response) : null,
      card({ tape: true, children: answered && !instant ? feedbackView(item, entry.result) : runner.el }),
      answered
        ? h('div', { class: 'stack' },
            item.type === 'translation' ? aiGradeButton(item, entry.response) : null,
            button({ label: idx + 1 >= queue.length ? '查看结果' : '下一题', variant: 'primary', block: true, onClick: next }),
          )
        : instant
          ? h('div', { class: 'xs faint center' }, '点选项即判分')
          : h('div', { class: 'stack' },
              button({ label: '提交答案', variant: 'primary', size: 'lg', block: true, onClick: submit }),
              (item.type === 'translation' || item.type === 'writing')
                ? h('div', { class: 'xs faint center' }, item.type === 'writing' ? '提交后看本地评分和范文' : '主观题不自动判分，提交后可看范文')
                : null,
            ),
    );
  }

  function record(item, result) {
    session.correct += result.correct;
    session.total += result.total;
    if (result.needsReview) session.pending++;
    const bucket = session.byType[item.type] || (session.byType[item.type] = { correct: 0, total: 0 });
    bucket.correct += result.correct;
    bucket.total += result.total;
  }

  function pickInstant(choice) {
    if (answered) return;
    const entry = queue[idx];
    const item = entry.item;
    const result = gradeItem(item, choice);
    entry.result = result;
    entry.response = choice;
    record(item, result);
    runner.reveal?.(result);
    answered = true;
    paint();
  }

  function submit() {
    const entry = queue[idx];
    const item = entry.item;
    const response = runner.getResponse();
    if (item.type !== 'translation' && item.type !== 'writing') {
      if (response == null
        || (typeof response === 'string' && !response.trim())
        || (Array.isArray(response) && response.every((x) => x == null || x === ''))) {
        toast('先作答再提交');
        return;
      }
      if (Array.isArray(response) && response.some((x) => x == null || x === '')) {
        toast('还有空没填');
        return;
      }
    }
    const result = gradeItem(item, response);
    entry.result = result;
    entry.response = response;
    record(item, result);
    answered = true;
    paint();
  }

  function aiGradeButton(item, response) {
    return h('button', {
      type: 'button', class: 'c-btn c-btn--ghost c-btn--block', style: { width: '100%' },
      onclick: async () => {
        const text = String(response || '').trim();
        if (!text) { toast('先写点内容'); return; }
        try {
          const out = item.type === 'writing'
            ? await gradeWriting(item.prompt, text, ctx)
            : await gradeTranslation(item.prompt, text, ctx);
          await showSheet({ title: 'AI 点评', body: h('div', { class: 'small', style: { 'white-space': 'pre-wrap' } }, out), actions: [{ label: '知道了' }] });
        } catch (error) { reportAIError(ctx, error); }
      },
    }, 'AI 批改');
  }

  /* ---------------- finish ---------------- */

  function next() {
    idx++;
    answered = false;
    if (idx >= queue.length) {
      finish();
      return;
    }
    paint();
  }

  function finish() {
    stopTimer();
    mode = 'result';
    paint();
  }

  function result() {
    const objective = session.total > 0;
    const pct = objective ? Math.round((session.correct / session.total) * 100) : 0;
    // only meaningful section splits (a paper), never internal vocab codes
    const breakdown = Object.entries(session.byType).filter(([type]) => TYPE_LABEL[type]);
    return h('div', { class: 'stack stack--lg' },
      card({
        tape: true,
        variant: objective ? (pct >= 80 ? 'mint' : pct >= 60 ? 'yellow' : 'pink') : 'blue',
        children: h('div', { class: 'stack center' },
          h('div', { style: { 'font-size': '44px' } }, !objective ? '📝' : pct >= 80 ? '🏆' : pct >= 60 ? '💪' : '🌱'),
          objective
            ? h('div', { class: 'bold', style: { 'font-size': '22px' } }, `${pct}%`)
            : h('div', { class: 'bold', style: { 'font-size': '22px' } }, '已提交'),
          h('div', { class: 'small muted' },
            objective
              ? `答对 ${session.correct} / ${session.total}${session.pending ? ` · ${session.pending} 道主观题待自评` : ''}`
              : `${session.pending} 道主观题，请对照范文自评或让 AI 批改`),
        ),
      }),
      breakdown.length > 1
        ? h('div', { class: 'stack' },
            breakdown.map(([type, v]) => h('div', { class: 'c-kv' },
              h('span', { class: 'muted' }, TYPE_LABEL[type]),
              h('span', { class: 'bold' }, v.total ? `${v.correct} / ${v.total}` : `${v.correct} 题`),
            )),
          )
        : null,
      button({ label: '再来一组', variant: 'primary', block: true, onClick: () => { mode = 'home'; paint(); } }),
      button({ label: '回首页', block: true, onClick: () => ctx.go('#/today') }),
    );
  }

  /* ---------------- paint ---------------- */

  function paint() {
    if (mode === 'home') root.replaceChildren(home());
    else if (mode === 'run') {
      const el = run();
      if (el) root.replaceChildren(el);
    } else root.replaceChildren(result());
  }

  // one-shot hand-off from another view ("read this passage")
  if (ctx.pending?.reading) {
    const id = ctx.pending.reading;
    ctx.pending.reading = null;
    const item = ctx.data.contentById.get(id);
    if (item && begin([{ item }], '阅读')) return root;
  }

  paint();
  return root;
}
