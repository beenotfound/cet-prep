/* ui/components.js — stateless reusable pieces. No store, no fetching. */

import { h } from '../core/dom.js';

export function button({ label, icon, variant = '', block = false, size = '', onClick, disabled = false, type = 'button' } = {}) {
  return h(
    'button',
    {
      type,
      class: ['c-btn', variant && `c-btn--${variant}`, block && 'c-btn--block', size && `c-btn--${size}`, disabled && 'is-disabled'].filter(Boolean).join(' '),
      onclick: disabled ? null : onClick,
      'aria-disabled': disabled ? 'true' : null,
    },
    icon ? h('span', { 'aria-hidden': 'true' }, icon) : null,
    label ? h('span', {}, label) : null,
  );
}

export function card({ children, variant = '', tape = false, className = '', ...rest } = {}) {
  return h(
    'div',
    { class: ['c-card', variant && `c-card--${variant}`, className].filter(Boolean).join(' '), ...rest },
    tape ? h('span', { class: 'c-tape' }) : null,
    children,
  );
}

export function tag(text, tone = '') {
  return h('span', { class: ['c-tag', tone && `c-tag--${tone}`].filter(Boolean).join(' ') }, text);
}

export function sticker(text) {
  return h('span', { class: 'c-sticker' }, text);
}

export function progress(value, { variant = '' } = {}) {
  const pct = Math.max(0, Math.min(100, Math.round(value * 100)));
  const bar = h('div', { class: ['c-progress', variant && `c-progress--${variant}`].filter(Boolean).join(' '), role: 'progressbar', 'aria-valuenow': pct, 'aria-valuemin': 0, 'aria-valuemax': 100 });
  bar.appendChild(h('div', { class: 'c-progress__fill', style: { '--p': `${pct}%` } }));
  return bar;
}

export function chips(items, activeId, onPick) {
  return h(
    'div',
    { class: 'c-chips' },
    items.map((item) =>
      h(
        'button',
        {
          type: 'button',
          class: ['c-chip', item.id === activeId && 'is-active'].filter(Boolean).join(' '),
          onclick: () => onPick?.(item.id),
        },
        `${item.label}${item.count != null ? ` ${item.count}` : ''}`,
      ),
    ),
  );
}

export function kv(label, value) {
  return h('div', { class: 'c-kv' }, h('span', { class: 'muted' }, label), h('span', { class: 'bold' }, value));
}

export function field({ label, input }) {
  return h('div', { class: 'c-field' }, label ? h('label', { class: 'c-label' }, label) : null, input);
}

export function statePanel(kind, { title, message, action } = {}) {
  const map = {
    loading: { title: '正在加载…', message: '正在下载词库' },
    empty: { title: '这里还是空的', message: '' },
    error: { title: '加载失败', message: '' },
  };
  const base = map[kind] || map.empty;
  return h(
    'div',
    { class: ['c-panel', kind === 'error' && 'c-panel--error'].filter(Boolean).join(' ') },
    h('div', { class: 'bold', style: { 'font-size': '16px', 'margin-bottom': '6px' } }, title || base.title),
    h('div', { class: 'small' }, message || base.message),
    action ? h('div', { style: { 'margin-top': '12px' } }, action) : null,
  );
}

/* ---------------- toast ---------------- */

let toastHost = null;
export function toast(message, kind = '') {
  if (!toastHost || !toastHost.isConnected) {
    toastHost = h('div', { class: 'c-toast-host', role: 'status', 'aria-live': 'polite' });
    document.body.appendChild(toastHost);
  }
  const node = h('div', { class: ['c-toast', kind && `c-toast--${kind}`].filter(Boolean).join(' ') }, message);
  toastHost.appendChild(node);
  setTimeout(() => {
    node.style.opacity = '0';
    node.style.transition = 'opacity .2s';
    setTimeout(() => node.remove(), 220);
  }, 2400);
}

/* ---------------- bottom sheet ---------------- */

/**
 * showSheet({ title, body, actions: [{label, variant, value, keepOpen, onClick}] })
 * Resolves with the clicked action's `value` (or null when dismissed).
 */
export function showSheet({ title, body, actions = [] } = {}) {
  return new Promise((resolve) => {
    const overlay = h('div', { class: 'c-sheet', role: 'dialog', 'aria-modal': 'true' });
    const panel = h('div', { class: 'c-sheet__panel' });

    let settled = false;
    const close = (value) => {
      if (settled) return;
      settled = true;
      document.removeEventListener('keydown', onKey);
      overlay.remove();
      resolve(value);
    };
    const onKey = (e) => { if (e.key === 'Escape') close(null); };

    panel.appendChild(h('div', { class: 'row row--between', style: { 'margin-bottom': '10px' } },
      h('h2', { class: 'bold', style: { 'font-size': '18px' } }, title || ''),
      h('button', { class: 'c-btn c-btn--ghost c-btn--sm', type: 'button', 'aria-label': '关闭', onclick: () => close(null) }, '✕'),
    ));
    if (body) panel.appendChild(body);

    if (actions.length) {
      const row = h('div', { class: 'stack', style: { 'margin-top': '16px' } });
      for (const action of actions) {
        row.appendChild(button({
          label: action.label,
          variant: action.variant || '',
          block: true,
          onClick: () => {
            const keep = action.onClick?.();
            if (keep === false || action.keepOpen) return;
            close(action.value ?? action.label);
          },
        }));
      }
      panel.appendChild(row);
    }

    overlay.appendChild(panel);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(null); });
    document.addEventListener('keydown', onKey);
    document.body.appendChild(overlay);
  });
}

export function confirmSheet(title, message, { okLabel = '确定', cancelLabel = '取消', tone = 'primary' } = {}) {
  return showSheet({
    title,
    body: h('p', { class: 'small muted' }, message),
    actions: [
      { label: okLabel, variant: tone, value: true },
      { label: cancelLabel, value: false },
    ],
  });
}
