/* main.js — bootstrap: load the light word list, mount the router, prefetch the rest. */

import { loadJSON } from './core/api.js';
import { createStore } from './core/store.js';
import { createActions } from './core/actions.js';
import { createRouter } from './core/router.js';
import { track, trackOncePerSession } from './core/telemetry.js';
import { statePanel, toast } from './ui/components.js';
import * as today from './views/today.js';
import * as words from './views/words.js';
import * as listening from './views/listening.js';
import * as exam from './views/exam.js';
import * as library from './views/library.js';
import * as me from './views/me.js';
import * as onboarding from './views/onboarding.js';
import * as report from './views/report.js';
import * as records from './views/records.js';

const mount = document.getElementById('app');

const TAB_OF = { today: 'today', words: 'words', word: 'words', listening: 'listening', exam: 'exam', report: 'exam', records: 'exam', library: 'library', me: 'me', onboarding: 'today' };

function syncNav() {
  const first = (location.hash || '#/today').replace(/^#\/?/, '').split('/')[0] || 'today';
  const tab = TAB_OF[first] || 'today';
  track('page_view', { route: first });
  for (const button of document.querySelectorAll('.c-nav__item')) {
    button.classList.toggle('is-active', button.dataset.tab === tab);
  }
}

function errorPanel(error) {
  const retry = document.createElement('button');
  retry.className = 'c-btn c-btn--primary';
  retry.textContent = '重新加载';
  retry.onclick = () => location.reload();
  return statePanel('error', { message: `${error.message}。请检查网络后重试。`, action: retry });
}

/**
 * Data is split into three waves so the first screen never waits for the whole bank:
 *   wave 1  words.json          (list: word / ipa / gloss / tags / difficulty)
 *   wave 2  words-detail.json   (examples + phrases, prefetched in the background)
 *   wave 3  exam bundle         (vocab questions + passages + papers, on demand)
 */
async function boot() {
  mount.replaceChildren(statePanel('loading'));

  let data;
  try {
    const [wordsData, readingStats] = await Promise.all([
      loadJSON('./data/words.json', { gzip: true }),
      loadJSON('./data/reading-stats.json', { gzip: true }),
    ]);
    data = {
      words: wordsData.words,
      wordsMeta: wordsData.meta,
      byWord: new Map(wordsData.words.map((w) => [w.w, w])),
      readingStats,
      details: new Map(),
      detailsReady: false,
      questionsVocab: { items: [] },
      listening: { sets: [] },
      listeningReady: false,
      content: [],
      contentById: new Map(),
      papers: { items: [] },
      examReady: false,
    };
  } catch (error) {
    mount.replaceChildren(errorPanel(error));
    return;
  }

  let detailsPromise = null;
  let examPromise = null;
  let storiesPromise = null;
  let listeningPromise = null;

  const ctx = {
    data,
    toast,
    /** one-shot hand-off between views (e.g. "read this passage") */
    pending: {},
    ensureDetails() {
      if (data.detailsReady) return Promise.resolve();
      if (detailsPromise) return detailsPromise;
      detailsPromise = loadJSON('./data/words-detail.json', { gzip: true })
        .then((payload) => {
          for (const row of payload.items) data.details.set(row.w, row);
          data.detailsReady = true;
        })
        .catch((error) => { detailsPromise = null; throw error; });
      return detailsPromise;
    },
    ensureExamData() {
      if (data.examReady) return Promise.resolve();
      if (examPromise) return examPromise;
      examPromise = Promise.all([
        loadJSON('./data/questions-vocab.json', { gzip: true }),
        loadJSON('./data/content.json', { gzip: true }),
        loadJSON('./data/papers.json', { gzip: true }),
      ]).then(([vocab, content, papers]) => {
        data.questionsVocab = vocab;
        data.content = content.items;
        data.contentById = new Map(content.items.map((i) => [i.id, i]));
        data.papers = papers;
        data.examReady = true;
      }).catch((error) => { examPromise = null; throw error; });
      return examPromise;
    },
    ensureStories() {
      if (data.stories) return Promise.resolve();
      if (storiesPromise) return storiesPromise;
      storiesPromise = loadJSON('./data/stories.json', { gzip: true })
        .then((payload) => { data.stories = payload; })
        .catch((error) => { storiesPromise = null; throw error; });
      return storiesPromise;
    },
    ensureListeningData() {
      if (data.listeningReady) return Promise.resolve();
      if (listeningPromise) return listeningPromise;
      listeningPromise = loadJSON('./data/listening.json', { gzip: false })
        .then((payload) => {
          data.listening = payload;
          data.listeningReady = true;
        })
        .catch((error) => { listeningPromise = null; throw error; });
      return listeningPromise;
    },
  };

  const store = createStore({ onError: (message) => toast(message, 'error') });
  const actions = createActions({ store, data });
  ctx.store = store;
  ctx.actions = actions;

  const routes = {
    today,
    words,
    listening,
    exam,
    library,
    me,
    onboarding,
    report,
    records,
    'report/:id': { render: (c, params) => report.render(c, params) },
    'word/:w': { render: (c, params) => words.renderWord(c, params) },
    'listening/:setId': { render: (c, params) => listening.render(c, params) },
  };

  const router = createRouter({ routes, mount, fallback: today, context: ctx });
  ctx.go = (path) => router.go(path);
  ctx.refresh = () => router.refresh();
  Object.defineProperty(ctx, 'state', { get: () => store.get() });

  for (const button of document.querySelectorAll('.c-nav__item')) {
    button.addEventListener('click', () => router.go(`#/${button.dataset.tab}`));
  }

  window.addEventListener('hashchange', syncNav);
  syncNav();
  trackOncePerSession('app_open');
  router.start();

  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' })
      .then((reg) => {
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible') reg.update().catch(() => {});
        });
      })
      .catch(() => { /* offline caching is optional */ });
  }

  // background prefetch: examples only; the exam bundle loads when 题库 is opened
  const idle = window.requestIdleCallback || ((fn) => setTimeout(fn, 600));
  idle(() => { ctx.ensureDetails().catch(() => {}); });
}

boot().catch((error) => {
  console.error(error);
  mount.replaceChildren(errorPanel(error));
});
