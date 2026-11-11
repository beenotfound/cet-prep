/* main.js — bootstrap only: load data, build store/router, wire nav. */

import { loadJSON } from './core/api.js';
import { createStore } from './core/store.js';
import { createActions } from './core/actions.js';
import { createRouter } from './core/router.js';
import { statePanel, toast } from './ui/components.js';
import * as today from './views/today.js';
import * as words from './views/words.js';
import * as exam from './views/exam.js';
import * as me from './views/me.js';
import * as onboarding from './views/onboarding.js';

const mount = document.getElementById('app');

const TAB_OF = { today: 'today', words: 'words', word: 'words', exam: 'exam', me: 'me', onboarding: 'today' };

function syncNav() {
  const first = (location.hash || '#/today').replace(/^#\/?/, '').split('/')[0] || 'today';
  const tab = TAB_OF[first] || 'today';
  for (const button of document.querySelectorAll('.c-nav__item')) {
    button.classList.toggle('is-active', button.dataset.tab === tab);
  }
}

async function loadData() {
  const [wordsData, vocab, content, papers] = await Promise.all([
    loadJSON('./data/words.json'),
    loadJSON('./data/questions-vocab.json'),
    loadJSON('./data/content.json'),
    loadJSON('./data/papers.json'),
  ]);
  return {
    words: wordsData.words,
    wordsMeta: wordsData.meta,
    byWord: new Map(wordsData.words.map((w) => [w.w, w])),
    questionsVocab: vocab,
    content: content.items,
    contentById: new Map(content.items.map((i) => [i.id, i])),
    papers,
  };
}

async function boot() {
  mount.replaceChildren(statePanel('loading'));

  let data;
  try {
    data = await loadData();
  } catch (error) {
    mount.replaceChildren(statePanel('error', {
      message: `${error.message}。请检查网络后重试。`,
      action: (() => {
        const b = document.createElement('button');
        b.className = 'c-btn c-btn--primary';
        b.textContent = '重新加载';
        b.onclick = () => location.reload();
        return b;
      })(),
    }));
    return;
  }

  const store = createStore({ onError: (message) => toast(message, 'error') });
  const actions = createActions({ store, data });

  const ctx = {
    data,
    store,
    actions,
    toast,
    go: (path) => router.go(path),
    refresh: () => router.refresh(),
  };
  Object.defineProperty(ctx, 'state', { get: () => store.get() });

  const routes = {
    today,
    words,
    exam,
    me,
    onboarding,
    'word/:w': { render: (c, params) => words.renderWord(c, params) },
  };

  const router = createRouter({ routes, mount, fallback: today, context: ctx });
  ctx.go = (path) => router.go(path);
  ctx.refresh = () => router.refresh();

  for (const button of document.querySelectorAll('.c-nav__item')) {
    button.addEventListener('click', () => router.go(`#/${button.dataset.tab}`));
  }

  window.addEventListener('hashchange', syncNav);
  syncNav();
  router.start();

  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    navigator.serviceWorker.register('./sw.js').catch(() => { /* offline caching is optional */ });
  }
}

boot().catch((error) => {
  console.error(error);
  mount.replaceChildren(statePanel('error', { message: String(error?.message || error) }));
});
