/* views/exam-items.js — renderers for each question type. */

import { h } from '../core/dom.js';
import { button, card, tag } from '../ui/components.js';
import { speak } from './study.js';

function paragraphs(text) {
  return String(text || '').split(/\n{2,}/).filter(Boolean).map((p) => h('p', { class: 'v-exam__para' }, p));
}

function optionList(options, selected, onPick, review) {
  const wrap = h('div', { class: 'v-exam__options' });
  let current = selected;

  function paint() {
    wrap.replaceChildren(
      ...options.map((text, i) => {
        const isCorrect = Boolean(review) && i === review.correct;
        const isWrong = Boolean(review) && i === review.choice && i !== review.correct;
        return h('button', {
          type: 'button',
          class: [
            'v-exam__option',
            !review && current === i && 'is-picked',
            isCorrect && 'is-correct',
            isWrong && 'is-wrong',
            review && 'is-locked',
          ].filter(Boolean).join(' '),
          'aria-pressed': !review && current === i ? 'true' : 'false',
          onclick: () => {
            if (review) return;
            current = i;
            paint();
            onPick(i);
          },
        },
          h('span', { class: 'v-exam__badge' }, String.fromCharCode(65 + i)),
          h('span', { class: 'grow' }, text),
          review ? h('span', { class: 'v-exam__mark' }, isCorrect ? '✓' : isWrong ? '✗' : '') : null,
        );
      }),
    );
  }

  paint();
  return wrap;
}

function selectRow(labels, value, onChange, placeholder = '选择') {
  const sel = h('select', { class: 'c-select', onchange: (e) => onChange(e.target.value) });
  sel.appendChild(h('option', { value: '' }, placeholder));
  for (const label of labels) sel.appendChild(h('option', { value: label, selected: value === label }, label));
  return sel;
}

/** Creates a renderer for one item. Returns { el, getResponse, reveal? }. */
export function renderItem(ctx, item, { onPick } = {}) {
  const store = { choice: null, answers: [], text: '' };

  if (item.type === 'w2m' || item.type === 'm2w' || item.type === 'fill') {
    const el = h('div', { class: 'stack' });
    let choice = null;
    let review = null;

    const paint = () => {
      const parts = [
        h('div', { class: 'v-exam__prompt' },
          item.type === 'w2m'
            ? h('div', { class: 'v-exam__word display' }, item.prompt)
            : h('div', { class: 'v-exam__wordtext' }, item.prompt),
          item.type === 'w2m'
            ? h('button', { type: 'button', class: 'c-btn c-btn--ghost c-btn--sm', onclick: () => speak(item.prompt) }, '🔊')
            : null,
        ),
        optionList(item.options, choice, (i) => {
          if (review) return;
          choice = i;
          paint();
          onPick?.(i);
        }, review),
      ];
      if (review) parts.push(h('div', { class: 'v-exam__explain small' }, item.explain || ''));
      el.replaceChildren(...parts);
    };
    paint();

    return {
      el,
      getResponse: () => choice,
      reveal(result) {
        review = { correct: item.answer, choice };
        paint();
      },
    };
  }

  if (item.type === 'spell') {
    const input = h('input', {
      class: 'c-input', type: 'text', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false',
      placeholder: '拼写这个单词', oninput: (e) => { store.text = e.target.value; },
    });
    input.value = store.text;
    return {
      el: h('div', { class: 'stack' },
        h('div', { class: 'c-label' }, item.prompt),
        h('div', { class: 'xs muted' }, `提示：${item.hint || ''}`),
        input,
      ),
      getResponse: () => store.text,
    };
  }

  if (item.type === 'reading') {
    const questions = item.questions.map((q, qi) => h('div', { class: 'stack', style: { 'margin-top': qi === 0 ? '0' : '18px' } },
      h('div', { class: 'bold' }, `${qi + 1}. ${q.q}`),
      optionList(q.options, store.answers[qi], (i) => {
        store.answers[qi] = i;
        el.dispatchEvent(new CustomEvent('answer-change'));
      }),
    ));
    const el = h('div', { class: 'v-exam__split' },
      h('div', { class: 'v-exam__pane v-exam__pane--passage' },
        h('div', { class: 'v-exam__passage' }, paragraphs(item.passage))),
      h('div', { class: 'v-exam__pane v-exam__pane--questions' }, questions),
    );
    return { el, getResponse: () => store.answers };
  }

  if (item.type === 'cloze') {
    const parts = String(item.passage).split(/(\{\{\d+\}\})/);
    const passage = h('div', { class: 'v-exam__passage' });
    for (const part of parts) {
      const m = part.match(/^\{\{(\d+)\}\}$/);
      if (m) passage.appendChild(h('span', { class: 'v-exam__blank' }, m[1]));
      else if (part) passage.appendChild(document.createTextNode(part));
    }
    const selects = item.blanks.map((b, i) => h('div', { class: 'v-exam__blankrow' },
      h('span', { class: 'v-exam__badge' }, String(b.n)),
      selectRow(item.bank, store.answers[i], (v) => { store.answers[i] = v; }, '选一个词'),
    ));
    return {
      el: h('div', { class: 'stack' },
        h('div', { class: 'c-card c-card--flat', style: { 'margin-bottom': '10px' } },
          h('div', { class: 'c-label' }, '词库（15 选 10）'),
          h('div', { class: 'c-pill-row' }, item.bank.map((w) => h('span', { class: 'c-tag' }, w))),
        ),
        h('div', { class: 'v-exam__split' },
          h('div', { class: 'v-exam__pane v-exam__pane--passage' }, passage),
          h('div', { class: 'v-exam__pane v-exam__pane--questions' },
            h('div', { class: 'stack' }, selects)),
        ),
      ),
      getResponse: () => store.answers,
    };
  }

  if (item.type === 'matching') {
    const labels = item.paragraphs.map((p) => p.label);
    const el = h('div', { class: 'stack' },
      h('details', { class: 'c-card c-card--flat', style: { 'margin-bottom': '10px' } },
        h('summary', { class: 'bold', style: { cursor: 'pointer' } }, '展开文章（10 段）'),
        h('div', { class: 'stack', style: { 'margin-top': '10px' } },
          item.paragraphs.map((p) => h('p', { class: 'v-exam__para' }, h('strong', null, `${p.label}. `), p.text)),
        ),
      ),
      item.statements.map((s, i) => h('div', { class: 'v-exam__blankrow', style: { 'align-items': 'flex-start' } },
        h('span', { class: 'v-exam__badge' }, String(i + 1)),
        h('span', { class: 'grow small' }, s.text),
        h('div', { style: { width: '110px', 'flex': '0 0 auto' } },
          selectRow(labels, store.answers[i], (v) => { store.answers[i] = v; }, '段落'),
        ),
      )),
    );
    return { el, getResponse: () => store.answers };
  }

  if (item.type === 'translation' || item.type === 'writing') {
    const ta = h('textarea', {
      class: 'c-textarea', placeholder: item.type === 'translation' ? '在这里写英文译文…' : '在这里写作文…',
      oninput: (e) => { store.text = e.target.value; },
    });
    ta.value = store.text;
    return {
      el: h('div', { class: 'stack' },
        h('div', { class: 'v-exam__passage' }, paragraphs(item.prompt)),
        item.keyPoints?.length
          ? h('details', { class: 'c-card c-card--flat' },
              h('summary', { class: 'bold', style: { cursor: 'pointer' } }, '评分要点'),
              h('ul', { class: 'stack', style: { 'margin-top': '8px', 'padding-left': '18px' } },
                item.keyPoints.map((p) => h('li', { class: 'small' }, p))),
            )
          : null,
        ta,
        h('div', { class: 'xs faint' }, `${item.type === 'translation' ? '建议 140–180 词' : '建议 150–200 词'} · 提交后可看参考译文`),
      ),
      getResponse: () => store.text,
    };
  }

  return { el: h('div', { class: 'c-panel c-panel--error' }, `未知题型：${item.type}`), getResponse: () => null };
}

export function feedbackView(item, result) {
  const parts = [];
  if (item.type === 'translation' || item.type === 'writing') {
    parts.push(h('div', { class: 'c-label' }, '参考译文 / 范文'));
    parts.push(h('div', { class: 'v-exam__passage' }, paragraphs(item.reference || '（暂无参考）')));
    if (item.keyPoints?.length) {
      parts.push(h('div', { class: 'c-label' }, '要点'));
      parts.push(h('ul', { class: 'stack', style: { 'padding-left': '18px' } }, item.keyPoints.map((p) => h('li', { class: 'small' }, p))));
    }
    return card({ variant: 'blue', children: h('div', { class: 'stack' }, parts) });
  }

  const total = result?.total ?? 1;
  const correct = result?.correct ?? 0;
  parts.push(h('div', { class: 'row row--between' },
    h('span', { class: 'bold' }, '判分'),
    tag(`${correct} / ${total}`, correct === total ? 'mint' : correct === 0 ? 'red' : 'yellow'),
  ));

  if (item.type === 'reading') {
    item.questions.forEach((q, i) => parts.push(h('div', { class: 'v-exam__explain' },
      h('div', { class: 'bold small' }, `${i + 1}. ${result.detail[i]?.ok ? '✅' : '❌'} 正确答案：${String.fromCharCode(65 + q.answer)}`),
      h('div', { class: 'small muted' }, q.explain),
    )));
  } else if (item.type === 'cloze') {
    item.blanks.forEach((b, i) => parts.push(h('div', { class: 'v-exam__explain' },
      h('div', { class: 'bold small' }, `${b.n}. ${result.detail[i]?.ok ? '✅' : '❌'} ${b.answer}`),
      h('div', { class: 'small muted' }, b.explain),
    )));
  } else if (item.type === 'matching') {
    item.statements.forEach((s, i) => parts.push(h('div', { class: 'v-exam__explain' },
      h('div', { class: 'bold small' }, `${i + 1}. ${result.detail[i]?.ok ? '✅' : '❌'} 答案：${s.answer}`),
    )));
  } else {
    parts.push(h('div', { class: 'small' }, item.explain || ''));
    parts.push(h('div', { class: 'small muted' }, `正确答案：${item.type === 'spell' ? item.answer : item.options?.[item.answer] ?? item.answer}`));
  }

  return card({ children: h('div', { class: 'stack' }, parts) });
}
