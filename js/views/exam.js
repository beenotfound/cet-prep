/* views/exam.js — question bank: practice sets and full mock papers. */

import { h } from '../core/dom.js';
import { button, card, tag, progress, toast, showSheet, statePanel, chips } from '../ui/components.js';
import { renderItem, feedbackView } from './exam-items.js';
import { writingReview, scoreEssay } from '../features/writing-review.js';
import { gradeItem, formatClock } from '../domain/exam.js';
import { translationEstimate, scoreAttempt } from '../domain/report.js';
import { pairListening, pairingLabel } from '../domain/pairing.js';
import { choosePracticeItems, wrongEntriesFromItem } from '../domain/progress.js';
import { renderReport } from './report.js';
import { gradeTranslation, gradeWriting, reportAIError } from '../features/ai.js';
import { track } from '../core/telemetry.js';

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
  let currentPaper = null;
  let currentPractice = null;
  let lastAttempt = null;
  let attemptStartedAt = 0;
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
    track('exam_start', { title, total: entries.length });
    if (!entries.length) { ctx.toast('这里还没有内容'); return false; }
    queue = entries;
    idx = 0;
    lastAttempt = null;
    attemptStartedAt = Date.now();
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
    currentPaper = null;
    currentPractice = { type, title: TYPE_LABEL[type] || type };
    const mode = ctx.state.profile.practiceMode || 'random';
    const seen = ctx.state.practiceSeen || {};
    let items;
    if (type === 'vocab') {
      const pool = vocabPool(ctx).filter((i) => {
        const lv = ctx.state.profile.level;
        if (lv === 'both') return true;
        if (lv === 'cet4') return i.level === 'cet4';
        return i.level !== 'cet4';
      });
      items = choosePracticeItems(pool, mode, seen, 20);
    } else {
      const pool = contentPool(ctx).filter((i) => i.type === type && matchesLevel(i));
      items = choosePracticeItems(pool, mode, seen, type === 'translation' || type === 'writing' ? 3 : 5);
    }
    if (!items.length) {
      currentPractice = null;
      ctx.toast(mode === 'wrong' ? '这个题型还没有错题，先做几组吧' : '这个题型暂时没有可练习的题');
      return;
    }
    begin(items.map((item) => ({ item })), TYPE_LABEL[type] || type);
  }

  function startPaper(paper) {
    currentPaper = paper;
    currentPractice = null;
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
      const cards = shown.map((paper) => {
        const attempts = (ctx.state.examAttempts || []).filter((a) => a.paperId === paper.id);
        const last = attempts.slice().sort((a, b) => (b.finishedAt || 0) - (a.finishedAt || 0))[0];
        const r = last ? scoreAttempt(last) : null;
        return card({
          className: 'v-exam__paper',
          children: h('div', { class: 'stack' },
            h('div', { class: 'row row--between' },
              h('div', { class: 'grow' },
                h('div', { class: 'bold' }, paper.title),
                h('div', { class: 'xs muted' }, `${paper.sections.length} 个部分 · ${paper.sections.reduce((a, s) => a + s.ids.length, 0)} 题`),
              ),
              last
                ? tag(`上次 ${r ? Math.round(r.total) : '—'} 分`, r?.complete ? 'mint' : 'yellow')
                : tag('未做', 'blue'),
            ),
            h('div', { class: 'row', style: { 'margin-top': '6px' } },
              button({ label: last ? '重做' : '开始', size: 'sm', variant: 'primary', onClick: () => startPaper(paper) }),
              last ? button({ label: '看上次报告', size: 'sm', onClick: () => ctx.go(`#/report/${last.id}`) }) : null,
            ),
          ),
        });
      });
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
        h('div', null, h('h1', { class: 'page-title' }, '题库')),
      ),
      chipHost,
      h('div', { class: 'row row--between' },
        h('h2', { class: 'bold', style: { 'font-size': '18px' } }, '专项练习'),
        chips(
          [{ id: 'random', label: '随机' }, { id: 'unseen', label: '优先未做' }, { id: 'wrong', label: '只练错题' }],
          ctx.state.profile.practiceMode || 'random',
          (id) => { ctx.actions.setPracticeMode(id); paint(); },
        ),
      ),
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
      h('div', { class: 'row row--between' },
        h('h2', { class: 'bold', style: { 'font-size': '18px' } }, '整卷'),
        button({ label: '完整模考', variant: 'primary', size: 'sm', onClick: openMockSetup }),
      ),
      paperHost,
      h('div', { class: 'c-divider', style: { 'margin': '6px 0' } }),
      h('div', { class: 'row row--between' },
        h('h2', { class: 'bold', style: { 'font-size': '18px' } }, '最近模考'),
        button({ label: '全部记录 / 错题本', size: 'sm', onClick: () => ctx.go('#/records') }),
      ),
      recentAttempts(),
      h('div', { class: 'xs muted', style: { 'margin-top': '12px' } }, subEl),
    );
  }

  function openMockSetup() {
    const levelOk = (item) => {
      const level = ctx.state.profile.level;
      return level === 'both' ? true : level === 'cet4' ? item.level === 'cet4' : item.level !== 'cet4';
    };
    const paperPool = () => (ctx.data.papers?.items || []).filter(levelOk);
    if (!paperPool().length) { ctx.toast('题库还没加载完'); return; }
    ctx.ensureListeningData?.().then(() => {
      const sets = ctx.data.listening?.sets || [];
      const levelKey = (v) => String(v).toLowerCase().replace('cet', '');
      let paper = paperPool()[0];
      let paired = pairListening(paper, sets, ctx.data.contentById);
      let chosen = paired.set;

      const paperSel = h('select', { class: 'c-select' },
        paperPool().map((p) => h('option', { value: p.id, selected: p.id === paper.id }, `${p.title} · ${p.sections.reduce((a, s) => a + s.ids.length, 0)} 题`)),
      );
      const setSel = h('select', { class: 'c-select' });
      const hint = h('div', { class: 'xs muted' });

      function fillSets() {
        const pool = sets.filter((s) => levelKey(s.level) === levelKey(paper.level));
        const keep = paired.set && pool.some((s) => s.id === paired.set.id) ? paired.set : null;
        chosen = keep || pool[0] || null;
        if (!keep) paired = { set: chosen, pairing: chosen ? 'latest' : 'none' };
        setSel.replaceChildren(
          ...(pool.length
            ? pool.map((s) => h('option', { value: s.id, selected: chosen && s.id === chosen.id }, `${s.title} · ${s.sections.length} 大题`))
            : [h('option', { value: '' }, '同级别暂无听力套')]),
        );
        setSel.dataset.pairing = paired.pairing;
        hint.textContent = chosen
          ? `听力搭配：${pairingLabel(paired.pairing)} · ${chosen.sections.length} 大题；听力交卷后自动进入这套笔试。`
          : '同级别暂无听力套，只能先做笔试。';
      }

      paperSel.addEventListener('change', () => {
        paper = paperPool().find((p) => p.id === paperSel.value) || paperPool()[0];
        paired = pairListening(paper, sets, ctx.data.contentById);
        fillSets();
      });
      setSel.addEventListener('change', () => {
        chosen = sets.find((s) => s.id === setSel.value) || null;
        if (chosen) paired = { set: chosen, pairing: 'manual' };
      });
      fillSets();

      showSheet({
        title: '完整模考',
        body: h('div', { class: 'stack' },
          h('div', { class: 'c-label' }, '选择整卷'),
          paperSel,
          h('div', { class: 'c-label', style: { 'margin-top': '10px' } }, '搭配听力'),
          setSel,
          hint,
          h('div', { class: 'xs faint' }, '整卷本身不含听力，这里按级别/年份自动搭配，可手动切换。'),
        ),
        actions: [
          {
            label: '开始听力',
            variant: 'primary',
            onClick: () => {
              if (!chosen) { ctx.toast('同级别暂无听力套，先做笔试吧'); return false; }
              ctx.pending = ctx.pending || {};
              ctx.pending.mock = { paperId: paper.id, paperTitle: paper.title, setId: chosen.id, setTitle: chosen.title, pairing: paired.pairing, listening: null };
              track('mock_start', { paperId: paper.id, setId: chosen.id, pairing: paired.pairing });
              ctx.go(`#/listening/${chosen.id}`);
            },
          },
          {
            label: '只做笔试',
            onClick: () => { ctx.pending = ctx.pending || {}; ctx.pending.paperId = paper.id; ctx.go('#/exam'); },
          },
          { label: '取消' },
        ],
      });
    }).catch((error) => ctx.toast(`听力题库加载失败：${error.message}`));
  }

  function recentAttempts() {
    const level = ctx.state.profile.level;
    const list = (ctx.state.examAttempts || [])
      .filter((a) => level === 'both' || a.level === level)
      .slice(-3)
      .reverse();
    if (!list.length) {
      return h('div', { class: 'c-panel small muted' }, '还没有模考记录。完成一套整卷后，这里会出现分数和薄弱项。');
    }
    return h('div', { class: 'stack' },
      list.map((a) => {
        const r = scoreAttempt(a);
        return h('button', {
          type: 'button', class: 'c-card v-exam__paper',
          style: { cursor: 'pointer', textAlign: 'left', width: '100%' },
          onclick: () => ctx.go(`#/report/${a.id}`),
        },
          h('div', { class: 'row row--between' },
            h('div', { class: 'grow' },
              h('div', { class: 'bold' }, a.paperTitle || a.paperId),
              h('div', { class: 'xs muted' }, `${new Date(a.finishedAt || a.startedAt).toLocaleDateString('zh-CN')} · ${r?.complete ? '完整' : '笔试部分'}`),
            ),
            h('span', { class: 'bold' }, r ? `${Math.round(r.total)} 分` : '—'),
          ),
        );
      }),
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
      entry.startedAt = Date.now();
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

  function record(entry, result, elapsedMs = 0) {
    const item = entry.item;
    entry.result = result;
    entry.correct = result.correct;
    entry.total = result.total;
    entry.detail = result.detail || [];
    entry.elapsedMs = elapsedMs;
    session.correct += result.correct;
    session.total += result.total;
    if (result.needsReview) session.pending++;
    const bucket = session.byType[item.type] || (session.byType[item.type] = { correct: 0, total: 0 });
    bucket.correct += result.correct;
    bucket.total += result.total;
  }

  function elapsedOf(entry) {
    return entry.startedAt ? Math.max(0, Date.now() - entry.startedAt) : 0;
  }

  function pickInstant(choice) {
    if (answered) return;
    const entry = queue[idx];
    const item = entry.item;
    const result = gradeItem(item, choice);
    entry.response = choice;
    record(entry, result, elapsedOf(entry));
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
    entry.response = response;
    record(entry, result, elapsedOf(entry));
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

  function buildPracticeAttempt() {
    const items = queue.map((entry) => {
      const response = entry.response ?? null;
      const isText = entry.item.type === 'writing' || entry.item.type === 'translation';
      return {
        itemId: entry.item.id,
        type: entry.item.type,
        correct: Number(entry.correct) || 0,
        total: Number(entry.total) || 0,
        detail: entry.detail || [],
        response: isText ? String(response || '').slice(0, 4000) : response,
        elapsedMs: Number(entry.elapsedMs) || 0,
      };
    });
    return {
      id: `prac-${Date.now()}`,
      type: currentPractice?.type || 'vocab',
      title: currentPractice?.title || '练习',
      startedAt: attemptStartedAt || Date.now(),
      finishedAt: Date.now(),
      items,
    };
  }

  function collectWrong() {
    const list = [];
    for (const entry of queue) {
      if (!entry?.item) continue;
      list.push(...wrongEntriesFromItem(entry.item, entry));
    }
    return list;
  }

  function collectCorrectKeys() {
    const keys = [];
    for (const entry of queue) {
      if (!entry?.item || !Array.isArray(entry.detail)) continue;
      entry.detail.forEach((d, i) => { if (d.ok) keys.push(`${entry.item.id}:${i}`); });
    }
    return keys;
  }

  function buildAttempt() {
    const items = queue.map((entry) => {
      const response = entry.response ?? null;
      const isText = entry.item.type === 'writing' || entry.item.type === 'translation';
      return {
        itemId: entry.item.id,
        type: entry.item.type,
        correct: Number(entry.correct) || 0,
        total: Number(entry.total) || 0,
        detail: entry.detail || [],
        response: isText ? String(response || '').slice(0, 4000) : response,
        elapsedMs: Number(entry.elapsedMs) || 0,
      };
    });

    let writing = null;
    const writingEntry = queue.find((entry) => entry.item.type === 'writing' && entry.response);
    if (writingEntry) {
      try {
        const sc = scoreEssay(ctx, writingEntry.item, writingEntry.response);
        if (sc) writing = { itemId: writingEntry.item.id, score15: sc.total, band: sc.band, dimensions: sc.dimensions };
      } catch (error) { console.warn('writing score failed', error); }
    }

    let translation = null;
    const transEntry = queue.find((entry) => entry.item.type === 'translation' && String(entry.response || '').trim());
    if (transEntry) {
      const text = String(transEntry.response || '');
      const est = translationEstimate(text, transEntry.item.keyPoints);
      translation = { itemId: transEntry.item.id, text: text.slice(0, 4000), ...est, estimatedRatio: est.ratio };
    }

    return {
      id: `att-${Date.now()}`,
      paperId: currentPaper?.id || null,
      paperTitle: currentPaper?.title || paperTitle,
      level: currentPaper?.level || ctx.state.profile.level,
      startedAt: attemptStartedAt || Date.now(),
      finishedAt: Date.now(),
      session: {
        correct: session.correct,
        total: session.total,
        pending: session.pending,
        byType: JSON.parse(JSON.stringify(session.byType)),
      },
      items,
      writing,
      translation,
      listening: ctx.pending?.mock?.listening
        ? { ...ctx.pending.mock.listening, pairing: ctx.pending.mock.pairing || 'manual' }
        : null,
    };
  }

  function finish() {
    track('exam_finish', { correct: session.correct, total: session.total, pending: session.pending });
    stopTimer();
    if (currentPaper) {
      try {
        lastAttempt = buildAttempt();
        ctx.actions.saveExamAttempt(lastAttempt);
        ctx.actions.recordPracticeSeen(lastAttempt.items, 'paper');
        ctx.actions.addWrongItems(collectWrong());
        ctx.actions.removeWrongKeys(collectCorrectKeys());
        if (ctx.pending?.mock) delete ctx.pending.mock;
        track('exam_report', { paperId: currentPaper.id, total: session.total, correct: session.correct });
      } catch (error) {
        console.warn('save attempt failed', error);
        ctx.toast('报告已生成，但本地保存失败');
      }
    } else if (currentPractice) {
      try {
        const attempt = buildPracticeAttempt();
        ctx.actions.savePracticeAttempt(attempt);
        ctx.actions.recordPracticeSeen(attempt.items, 'practice');
        ctx.actions.addWrongItems(collectWrong());
        ctx.actions.removeWrongKeys(collectCorrectKeys());
      } catch (error) {
        console.warn('save practice failed', error);
      }
    }
    mode = 'result';
    paint();
  }

  function result() {
    if (lastAttempt) return renderReport(ctx, lastAttempt);
    return legacyResult();
  }

  function legacyResult() {
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

  // one-shot hand-off from report / mock flow
  if (ctx.pending?.wrongItems) {
    const ids = [...new Set(ctx.pending.wrongItems)];
    delete ctx.pending.wrongItems;
    const entries = ids.map((id) => ctx.data.contentById?.get(id)).filter(Boolean).map((item) => ({ item }));
    if (entries.length) {
      currentPaper = null;
      currentPractice = { type: 'wrong', title: '错题重练' };
      begin(entries, '错题重练');
      return root;
    }
    ctx.toast('错题数据不完整，先重新做一组吧');
  }
  if (ctx.pending?.mock?.listening) {
    const id = ctx.pending.mock.paperId;
    const paper = ctx.data.papers?.items?.find((p) => p.id === id);
    if (paper) { startPaper(paper); return root; }
  }
  if (ctx.pending?.practice) {
    const type = ctx.pending.practice;
    delete ctx.pending.practice;
    if (TYPE_LABEL[type]) { startPractice(type); return root; }
  }
  if (ctx.pending?.paperId) {
    const id = ctx.pending.paperId;
    delete ctx.pending.paperId;
    const paper = ctx.data.papers?.items?.find((p) => p.id === id);
    if (paper) { startPaper(paper); return root; }
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
