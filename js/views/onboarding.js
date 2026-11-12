/* views/onboarding.js — level choice → 3-minute calibration → personal word plan. */

import { h } from '../core/dom.js';
import { button, card, progress, chips, tag } from '../ui/components.js';
import { Calibrator, pKnow, zoneOf, spotCheck, applySpotCheck, eligibleWords, estimateKnown } from '../domain/engine.js';

const LEVELS = [
  { id: 'cet4', label: '四级' },
  { id: 'cet6', label: '六级' },
  { id: 'both', label: '四六级都要' },
];

export function render(ctx) {
  const root = h('div', { class: 'v-onboard stack stack--lg' });
  const state = ctx.state;
  let step = 'intro';
  let cal = null;
  let current = null;
  let spot = null;
  let spotIndex = 0;
  let hits = { known: 0, knownN: 0, unknown: 0, unknownN: 0 };

  function paint() {
    root.replaceChildren(
      step === 'intro' ? intro()
        : step === 'quiz' ? quiz()
        : step === 'spot' ? spotView()
        : result(),
    );
  }

  function eligible() {
    return eligibleWords(ctx.data.words, state.profile.level);
  }

  function zoneCounts(theta) {
    const out = { known: 0, frontier: 0, unknown: 0 };
    for (const w of eligible()) out[zoneOf(pKnow(w.d, theta))]++;
    return out;
  }

  /* ---------------- intro ---------------- */

  function intro() {
    const level = state.profile.level;
    return h('div', { class: 'stack stack--lg' },
      h('header', { class: 'v-onboard__head' },
        h('div', { class: 'c-tape' }),
        h('h1', { class: 'page-title' }, '首先', h('br'), '我们需要了解你的', h('span', { class: 'marked' }, '词汇量')),
        h('p', { class: 'muted small', style: { 'margin-top': '8px' } },
          '只测你还没掌握的词。'),
      ),
      card({
        tape: true,
        children: h('div', { class: 'stack' },
          h('div', { class: 'bold' }, '你的目标'),
          chips(LEVELS, level, (id) => { ctx.actions.setProfile({ level: id }); paint(); }),
          h('div', { class: 'bold', style: { 'margin-top': '10px' } }, '考试日期'),
          h('input', {
            class: 'c-input', type: 'date', value: state.profile.examDate,
            onchange: (e) => ctx.actions.setProfile({ examDate: e.target.value }),
          }),
          h('div', { class: 'bold', style: { 'margin-top': '10px' } }, '每天新词'),
          h('div', { class: 'row row--wrap' },
            [10, 20, 30, 50].map((n) => h('button', {
              type: 'button',
              class: ['c-chip', state.profile.dailyNew === n && 'is-active'].filter(Boolean).join(' '),
              onclick: () => { ctx.actions.setProfile({ dailyNew: n }); paint(); },
            }, `${n} 个`)),
          ),
        ),
      }),
      h('div', { class: 'stack' },
        button({ label: '开始词汇量校准', variant: 'primary', size: 'lg', block: true, onClick: startQuiz }),
        button({ label: '跳过，直接开始学', variant: 'ghost', block: true, onClick: skip }),
      ),
    );
  }

  function startQuiz() {
    cal = new Calibrator(eligible(), state.profile.level, { theta: 5.2 });
    step = 'quiz';
    next();
  }

  function skip() {
    ctx.actions.finishCalibration({ theta: state.theta, se: null, items: 0, spot: null });
    ctx.go('#/today');
    ctx.toast('已跳过校准，可以在「单词」里随时重新校准', 'ok');
  }

  /* ---------------- quiz ---------------- */

  function next() {
    current = cal.next();
    if (!current || cal.done) return finishQuiz();
    paint();
  }

  function answer(score) {
    cal.answer(current, score);
    if (cal.done) finishQuiz();
    else next();
  }

  function answerRow(onPick) {
    return h('div', { class: 'answer-row' },
      button({ label: '认识', variant: 'mint', size: 'lg', block: true, onClick: () => onPick(1) }),
      button({ label: '眼熟', variant: 'primary', size: 'lg', block: true, onClick: () => onPick(0.5) }),
      button({ label: '不认识', variant: 'red', size: 'lg', block: true, onClick: () => onPick(0) }),
    );
  }

  function quiz() {
    if (!current) return h('div');
    return h('div', { class: 'stack stack--lg' },
      h('div', { class: 'row row--between' },
        tag(`第 ${cal.answers.length + 1} / ${cal.maxItems} 题`, 'yellow'),
        h('span', { class: 'xs muted' }, `当前能力值 θ=${cal.theta.toFixed(1)}`),
      ),
      progress(cal.answers.length / cal.maxItems),
      card({
        tape: true,
        className: 'v-onboard__word',
        children: h('div', { class: 'stack center', style: { 'min-height': '200px', 'justify-content': 'center' } },
          h('div', { class: 'v-onboard__wordtext display' }, current.w),
          current.i ? h('div', { class: 'muted small' }, `/${current.i}/`) : null,
          h('div', { class: 'xs faint' }, '这个词你…'),
        ),
      }),
      answerRow(answer),
      h('p', { class: 'xs faint center' }, '「眼熟」＝见过，但说不出意思'),
    );
  }

  /* ---------------- finish / result ---------------- */

  function finishQuiz() {
    const result = cal ? cal.result() : { theta: state.theta, se: null, items: 0, zones: null };
    ctx.actions.finishCalibration({ theta: result.theta, se: result.se, items: result.items, spot: null });
    step = 'result';
    paint();
    return null;
  }

  function startSpot() {
    const sample = spotCheck(eligible(), state.theta, 5);
    spot = [...sample.known.map((w) => ({ w, expect: 'known' })), ...sample.unknown.map((w) => ({ w, expect: 'unknown' }))];
    spotIndex = 0;
    hits = { known: 0, knownN: 0, unknown: 0, unknownN: 0 };
    step = 'spot';
    paint();
  }

  function spotAnswer(score) {
    const item = spot[spotIndex];
    const known = score >= 0.5;
    if (item.expect === 'known') { hits.knownN++; if (known) hits.known++; }
    else { hits.unknownN++; if (known) hits.unknown++; }
    spotIndex++;
    if (spotIndex >= spot.length) finishSpot();
    else paint();
  }

  function finishSpot() {
    const nextTheta = applySpotCheck(state.theta, hits.known, hits.knownN, hits.unknown, hits.unknownN);
    ctx.actions.finishCalibration({
      theta: nextTheta,
      se: state.calib.se,
      items: state.calib.items,
      spot: { knownHits: hits.known, knownN: hits.knownN, unknownHits: hits.unknown, unknownN: hits.unknownN, theta: nextTheta },
    });
    step = 'result';
    paint();
  }

  function spotView() {
    const item = spot[spotIndex];
    return h('div', { class: 'stack stack--lg' },
      h('div', { class: 'row row--between' },
        tag(`复核 ${spotIndex + 1} / ${spot.length}`, 'blue'),
        h('span', { class: 'xs muted' }, item.expect === 'known' ? '我们猜你认识' : '我们猜你不认识'),
      ),
      progress(spotIndex / spot.length),
      card({
        tape: true,
        className: 'v-onboard__word',
        children: h('div', { class: 'stack center', style: { 'min-height': '200px', 'justify-content': 'center' } },
          h('div', { class: 'v-onboard__wordtext display' }, item.w.w),
          item.w.i ? h('div', { class: 'muted small' }, `/${item.w.i}/`) : null,
          h('div', { class: 'xs faint' }, '再确认一次'),
        ),
      }),
      answerRow(spotAnswer),
    );
  }

  function result() {
    const theta = state.theta;
    const zones = zoneCounts(theta);
    const est = estimateKnown(ctx.data.words, theta, state.profile.level);
    const total = zones.known + zones.frontier + zones.unknown;
    return h('div', { class: 'stack stack--lg' },
      h('header', null,
        h('h1', { class: 'page-title' }, '你的词表已生成'),
      ),
      card({
        tape: true,
        children: h('div', { class: 'stack' },
          h('div', { class: 'row row--between' },
            h('span', { class: 'bold' }, '预计已掌握'),
            h('span', { class: 'display bold', style: { 'font-size': '28px' } }, `${est.known}`),
          ),
          h('div', { class: 'xs faint' }, `共 ${est.total} 个候选词 · 能力值 θ=${theta.toFixed(2)}`),
          h('div', { style: { 'margin-top': '12px' } },
            h('div', { class: 'c-kv' }, h('span', {}, '✅ 已会（不推给你）'), h('span', { class: 'bold' }, `${zones.known}`)),
            h('div', { class: 'c-kv' }, h('span', {}, '🟡 边缘（优先确认）'), h('span', { class: 'bold' }, `${zones.frontier}`)),
            h('div', { class: 'c-kv' }, h('span', {}, '🔴 未掌握（进队列）'), h('span', { class: 'bold' }, `${zones.unknown}`)),
          ),
          progress(zones.known / Math.max(total, 1)),
        ),
      }),
      state.calib.spot ? card({
        variant: 'blue',
        children: h('div', { class: 'small' },
          `复核结果：猜你会 ${state.calib.spot.knownHits}/${state.calib.spot.knownN} 命中，猜你不会 ${state.calib.spot.unknownN - state.calib.spot.unknownHits}/${state.calib.spot.unknownN} 命中。`),
      }) : null,
      h('div', { class: 'stack' },
        button({ label: '开始今天的词', variant: 'primary', size: 'lg', block: true, onClick: () => ctx.go('#/today') }),
        button({ label: '复核 10 个词，校准更准', variant: 'ghost', block: true, onClick: startSpot }),
        button({ label: '重新测一次', variant: 'ghost', block: true, onClick: () => { step = 'intro'; paint(); } }),
      ),
    );
  }

  paint();
  return root;
}
