/* sw.js — offline shell for 四六级剪贴本. Bump VERSION on every deploy. */
const VERSION = 'cet-collage-d273436f67';
const CACHE = VERSION;

const SHELL = [
  './index.html',
  './manifest.webmanifest',
  './css/tokens.css',
  './css/base.css',
  './css/components.css',
  './css/views.css',
  './js/main.js',
  './js/core/dom.js',
  './js/core/api.js',
  './js/core/store.js',
  './js/core/actions.js',
  './js/core/router.js',
  './js/core/format.js',
  './js/domain/engine.js',
  './js/domain/exam.js',
  './js/domain/importer.js',
  './js/ui/components.js',
  './js/views/today.js',
  './js/views/words.js',
  './js/views/study.js',
  './js/views/exam.js',
  './js/views/exam-items.js',
  './js/views/me.js',
  './js/views/onboarding.js',
  './js/features/ai.js',
  './js/features/providers/openai.js',
  './js/features/providers/claude.js',
  './data/words.json.gz',
  './data/words-detail.json.gz',
  './data/questions-vocab.json.gz',
  './data/content.json.gz',
  './data/papers.json.gz',
  './icons/icon-180.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;   // never touch AI calls

  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put('./index.html', copy));
          return res;
        })
        .catch(() => caches.match('./index.html'))
    );
    return;
  }

  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req).then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put(req, copy));
        }
        return res;
      });
    })
  );
});
