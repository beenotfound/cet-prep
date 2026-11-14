/* views/listening.js — 听力：按大题逐块作答，最后交卷自动评分（1 题 1 分）。 */

import { h } from '../core/dom.js';
import { button, card, tag, statePanel, toast } from '../ui/components.js';
import { track } from '../core/telemetry.js';

const LEVEL_LABEL = { 4: '四级', 6: '六级' };
const levelTone = (level) => (level === 6 ? 'violet' : 'blue');

export function render(ctx, params) {
  const root = h('div', { class: 'v-listening stack stack--lg' });
  if (ctx.data.listeningReady) {
    build(ctx, root, params);
    return root;
  }
  root.appendChild(statePanel('loading', { message: '正在加载听力题库…' }));
  ctx.ensureListeningData()
    .then(() => build(ctx, root, params))
    .catch((error) => {
      root.replaceChildren(statePanel('error', {
        message: error.message,
        action: button({ label: '重试', variant: 'primary', onClick: () => ctx.refresh() }),
      }));
    });
  return root;
}

function build(ctx, root, params) {
  let level = 0;
  let currentSet = null;

  const S = {
    pageTitle: { margin: 0, fontSize: '22px' },
    pageHint: { margin: '4px 0 0', opacity: 0.7, fontSize: '13px' },
    filterRow: { display: 'flex', gap: '8px', flexWrap: 'wrap' },
    cardStack: { display: 'flex', flexDirection: 'column', gap: '6px' },
    metaRow: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' },
    setTitle: { fontSize: '16px' },
    setCount: { fontSize: '12px', opacity: 0.65 },
    startRow: { marginTop: '6px' },
    topBar: { display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' },
    topTitle: { fontSize: '18px' },
    progress: { fontSize: '12px', opacity: 0.7 },
    player: { width: '100%', margin: '10px 0 4px' },
    blockTitle: { margin: 0, fontSize: '17px' },
    qWrap: { marginTop: '14px' },
    qHead: { display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '4px' },
    stem: { fontSize: '14px', lineHeight: 1.6, fontWeight: 600 },
    options: { display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '8px' },
    option: {
      textAlign: 'left', padding: '9px 12px', borderRadius: '10px', cursor: 'pointer',
      border: '1px solid rgba(0,0,0,.12)', background: 'rgba(255,255,255,.72)', fontSize: '14px',
    },
    optionPicked: { border: '2px solid #e8b13a', background: 'rgba(255,235,180,.75)' },
    footer: { display: 'flex', gap: '10px', alignItems: 'center', marginTop: '18px', flexWrap: 'wrap' },
    hint: { fontSize: '12px', opacity: 0.65 },
    scoreBox: { fontSize: '15px', lineHeight: 1.8 },
    partRow: { marginTop: '8px' },
    partLabel: { fontSize: '12px', opacity: 0.7, marginBottom: '2px' },
    reviewItem: { marginTop: '12px', fontSize: '13px', lineHeight: 1.7 },
  };

  const allQuestions = (set) => (set.sections || []).flatMap((s) => s.questions || []);
  const countQuestions = (set) => allQuestions(set).length;

  let answers = {};
  let blockIndex = 0;
  let submitted = false;
  let selfMarks = {};

  function reset() {
    answers = {};
    blockIndex = 0;
    submitted = false;
    selfMarks = {};
  }

  function paint() {
    root.replaceChildren(currentSet ? setView(currentSet) : homeView());
    window.scrollTo({ top: 0 });
  }

  function homeView() {
    const sets = (ctx.data.listening?.sets || [])
      .filter((s) => !level || s.level === level)
      .slice()
      .sort((a, b) => (b.year - a.year) || (b.month - a.month));

    const head = h('div', { class: 'stack' },
      h('h1', { style: S.pageTitle }, '听力'),
    );

    const filters = h('div', { style: S.filterRow },
      ...[0, 4, 6].map((lv) => button({
        label: lv ? LEVEL_LABEL[lv] : '全部',
        variant: level === lv ? 'primary' : '',
        onClick: () => { level = lv; paint(); },
      })),
    );

    const list = h('div', { class: 'stack' },
      ...(sets.length ? sets.map(setCard) : [statePanel('empty', { message: '这个级别下还没有听力套卷。' })]),
    );

    return h('div', { class: 'stack stack--lg' }, head, filters, list);
  }

  function setCard(set) {
    const secs = set.sections || [];
    return card({
      tape: true,
      children: h('div', { style: S.cardStack },
        h('div', { style: S.metaRow },
          tag(`${set.year}年${set.month}月`, 'yellow'),
          tag(LEVEL_LABEL[set.level] || `${set.level}级`, levelTone(set.level)),
          set.demo ? tag('示例', 'mint') : null,
        ),
        h('strong', { style: S.setTitle }, set.title),
        h('span', { style: S.setCount }, `${secs.length} 个大题 · 共 ${countQuestions(set)} 小题`),
        h('div', { style: S.startRow },
          button({
            label: '开始练习',
            variant: 'primary',
            onClick: () => { currentSet = set; reset(); track('listening_start', { setId: set.id, level: set.level, questions: countQuestions(set) }); paint(); },
          }),
        ),
      ),
    });
  }

  function audioParts(section) {
    if (Array.isArray(section.audioParts) && section.audioParts.length) return section.audioParts;
    return section.audio ? [section.audio] : [];
  }

  function setView(set) {
    const sections = set.sections || [];
    const total = countQuestions(set);
    const answered = Object.keys(answers).length;

    const top = h('div', { style: S.topBar },
      button({ label: '返回', onClick: () => { currentSet = null; paint(); } }),
      h('strong', { style: S.topTitle }, set.title),
      tag(LEVEL_LABEL[set.level] || '', levelTone(set.level)),
      h('span', { style: S.progress }, `已答 ${answered} / ${total}`),
    );

    if (submitted) return h('div', { class: 'stack stack--lg' }, top, resultView(set));

    const section = sections[blockIndex];
    const block = card({
      children: h('div', {},
        h('h2', { style: S.blockTitle }, `大题 ${blockIndex + 1} / ${sections.length} · ${section.name || ''}`),
        h('p', { style: S.hint }, '先听音频，再逐题选择。这一大题的音频只需要听一次。'),
        ...audioParts(section).map((src, i, all) => h('div', { style: S.partRow },
          all.length > 1 ? h('div', { style: S.partLabel }, `第 ${i + 1} / ${all.length} 段`) : null,
          h('audio', { controls: 'controls', preload: 'metadata', src, style: S.player }),
        )),
        ...(section.questions || []).map((q) => questionView(q)),
      ),
    });

    const pending = (section.questions || []).filter((q) => !answers[q.id]).length;
    const isLast = blockIndex === sections.length - 1;

    const footer = h('div', { style: S.footer },
      pending > 0 ? h('span', { style: S.hint }, `还有 ${pending} 题未作答`) : null,
      button({
        label: isLast ? '交卷并评分' : '下一题 →',
        variant: 'primary',
        disabled: pending > 0,
        onClick: () => {
          if (pending > 0) return;
          if (isLast) {
            submitted = true;
            track('listening_submit', { setId: set.id, level: set.level, total, answered });
            paint();
            toast('已交卷，成绩见下方', '');
          } else {
            blockIndex += 1;
            paint();
          }
        },
      }),
      button({ label: '重新开始', onClick: () => { reset(); paint(); } }),
    );

    return h('div', { class: 'stack stack--lg' }, top, block, footer);
  }

  function questionView(q) {
    const options = h('div', { style: S.options });
    (q.options || []).forEach((text, i) => {
      const key = String.fromCharCode(65 + i);
      const picked = answers[q.id] === key;
      const opt = h('button', {
        type: 'button',
        style: Object.assign({}, S.option, picked ? S.optionPicked : {}),
      }, `${key}. ${text}`);
      opt.addEventListener('click', () => {
        answers[q.id] = key;
        paint();
      });
      options.appendChild(opt);
    });

    return h('div', { style: S.qWrap },
      h('div', { style: S.qHead }, tag(q.id, 'yellow')),
      q.stem ? h('div', { style: S.stem }, q.stem) : null,
      options,
    );
  }

  function resultView(set) {
    const qs = allQuestions(set);
    const total = qs.length;
    let autoRight = 0;
    let manualRight = 0;
    let unknown = 0;
    for (const q of qs) {
      if (q.answer) {
        if (answers[q.id] === q.answer) autoRight += 1;
      } else {
        unknown += 1;
        if (selfMarks[q.id] === true) manualRight += 1;
      }
    }
    const right = autoRight + manualRight;
    const marked = Object.keys(selfMarks).length;

    const scoreLine = unknown > 0
      ? `得分 ${right} / ${total}（其中 ${unknown} 题自评，已评 ${marked} 题）`
      : `得分 ${right} / ${total}`;

    const head = card({
      children: h('div', { style: S.scoreBox },
        h('div', { style: { fontSize: '20px', fontWeight: 700 } }, scoreLine),
        h('div', { style: S.progress },
          `自动判分 ${autoRight} 题 · 自评正确 ${manualRight} 题 · 未作答 ${total - Object.keys(answers).length} 题`),
        unknown > 0
          ? h('div', { style: { marginTop: '6px', fontSize: '12px', opacity: 0.7 } },
            '本套暂无标准答案：请打开纸质解析对照，在下面每题点「✓ 对」或「✗ 错」自己评分。')
          : null,
        h('div', { style: { marginTop: '10px', display: 'flex', gap: '8px' } },
          button({ label: '再做一次', variant: 'primary', onClick: () => { reset(); paint(); } }),
          button({ label: '返回列表', onClick: () => { currentSet = null; paint(); } }),
        ),
      ),
    });

    const review = card({
      children: h('div', {},
        h('h2', { style: { margin: '0 0 8px', fontSize: '17px' } }, '答题详情'),
        ...qs.map((q, idx) => {
          const mine = answers[q.id];
          const hasKey = Boolean(q.answer);
          const ok = hasKey ? (mine && mine === q.answer) : (selfMarks[q.id] === true);
          const wrong = hasKey ? (mine && mine !== q.answer) : (selfMarks[q.id] === false);

          const markRow = hasKey ? null : h('div', { style: { marginTop: '6px', display: 'flex', gap: '6px' } },
            h('button', {
              type: 'button',
              style: {
                padding: '4px 10px', borderRadius: '8px', cursor: 'pointer', fontSize: '12px',
                border: '1px solid rgba(0,0,0,.15)',
                background: selfMarks[q.id] === true ? 'rgba(190,235,190,.95)' : 'rgba(255,255,255,.8)',
              },
              onclick: () => { selfMarks[q.id] = true; paint(); },
            }, '✓ 对'),
            h('button', {
              type: 'button',
              style: {
                padding: '4px 10px', borderRadius: '8px', cursor: 'pointer', fontSize: '12px',
                border: '1px solid rgba(0,0,0,.15)',
                background: selfMarks[q.id] === false ? 'rgba(255,205,205,.95)' : 'rgba(255,255,255,.8)',
              },
              onclick: () => { selfMarks[q.id] = false; paint(); },
            }, '✗ 错'),
          );

          return h('div', { style: S.reviewItem },
            h('div', {},
              h('strong', {}, `${idx + 1}. ${q.id}`),
              ' ',
              tag(ok ? '正确' : (wrong ? '错误' : (mine ? '待自评' : '未答')), ok ? 'mint' : (wrong ? 'pink' : 'yellow')),
              mine ? h('span', { style: { marginLeft: '6px' } }, `你的答案 ${mine}`) : null,
              hasKey ? h('span', { style: { marginLeft: '6px', color: '#2f7d46' } }, `正确答案 ${q.answer}`) : null,
            ),
            q.stem ? h('div', { style: { marginTop: '2px', opacity: 0.85 } }, q.stem) : null,
            markRow,
            q.transcript ? h('div', { style: { marginTop: '4px', opacity: 0.7, whiteSpace: 'pre-wrap' } }, q.transcript) : null,
          );
        }),
      ),
    });

    return h('div', { class: 'stack stack--lg' }, head, review);
  }
  const deepId = params?.setId;
  if (deepId) {
    const found = (ctx.data.listening?.sets || []).find((s) => s.id === deepId);
    if (found) { currentSet = found; reset(); }
  }

  paint();
}