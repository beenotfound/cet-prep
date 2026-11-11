/* core/router.js — hash routing over a small route table. */

function parseHash() {
  const raw = (location.hash || '#/today').replace(/^#\/?/, '');
  const [path, query] = raw.split('?');
  return { path: path || 'today', query: new URLSearchParams(query || '') };
}

function matchRoute(pattern, path) {
  const p = pattern.split('/').filter(Boolean);
  const s = path.split('/').filter(Boolean);
  if (p.length !== s.length) return null;
  const params = {};
  for (let i = 0; i < p.length; i++) {
    if (p[i].startsWith(':')) params[p[i].slice(1)] = decodeURIComponent(s[i]);
    else if (p[i] !== s[i]) return null;
  }
  return params;
}

export function createRouter({ routes, mount, fallback, context }) {
  let current = null;

  async function render() {
    const { path, query } = parseHash();
    let entry = null;
    let params = {};
    for (const [pattern, view] of Object.entries(routes)) {
      const m = matchRoute(pattern, path);
      if (m) { entry = view; params = m; break; }
    }
    if (!entry) { entry = fallback; params = {}; }

    if (current?.view?.destroy) {
      try { current.view.destroy(); } catch { /* ignore */ }
    }
    if (current?.el?.remove) current.el.remove();

    try {
      const el = await entry.render(context, params);
      mount.replaceChildren(el);
      current = { view: entry, el };
    } catch (error) {
      const el = document.createElement('div');
      el.className = 'c-panel c-panel--error';
      el.textContent = `页面加载失败：${error?.message || error}`;
      mount.replaceChildren(el);
      current = { view: entry, el };
      console.error(error);
    }
  }

  return {
    start() {
      window.addEventListener('hashchange', render);
      if (!location.hash) location.replace('#/today');
      render();
    },
    go(path) {
      const next = path.startsWith('#') ? path : `#/${path}`;
      if (location.hash === next) render();
      else location.hash = next;
    },
    refresh: render,
  };
}
