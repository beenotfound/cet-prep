/* core/dom.js — DOM construction only. No business logic, no storage. */

const ATTR_ALIASES = { className: 'class', htmlFor: 'for' };

/** h('div', {class, text, dataset, style, on:{click}}, ...children) */
export function h(tag, props, ...children) {
  // allow h('div', 'text', h('span'))
  if (props == null || typeof props !== 'object' || props instanceof Node || Array.isArray(props)) {
    children.unshift(props);
    props = {};
  }
  const el = document.createElement(tag);

  for (const [key, value] of Object.entries(props)) {
    if (value == null || value === false) continue;
    if (key === 'class' || key === 'className') {
      el.className = Array.isArray(value) ? value.filter(Boolean).join(' ') : String(value);
    } else if (key === 'text') {
      el.textContent = String(value);
    } else if (key === 'dataset') {
      for (const [k, v] of Object.entries(value)) if (v != null) el.dataset[k] = String(v);
    } else if (key === 'style') {
      for (const [k, v] of Object.entries(value)) {
        if (v == null) continue;
        if (k.startsWith('--')) el.style.setProperty(k, String(v));
        else el.style[k] = String(v);
      }
    } else if (key === 'on') {
      for (const [evt, fn] of Object.entries(value)) if (fn) el.addEventListener(evt, fn);
    } else if (key.startsWith('on') && typeof value === 'function') {
      el.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (key === 'ref') {
      value(el);
    } else {
      el.setAttribute(ATTR_ALIASES[key] || key, value === true ? '' : String(value));
    }
  }

  append(el, children);
  return el;
}

function append(el, children) {
  for (const child of children.flat(Infinity)) {
    if (child == null || child === false || child === true) continue;
    el.appendChild(child instanceof Node ? child : document.createTextNode(String(child)));
  }
}

export function frag(...children) {
  const f = document.createDocumentFragment();
  append(f, children);
  return f;
}

/** Event delegation: one listener for a whole list. */
export function delegate(root, type, selector, handler) {
  const listener = (event) => {
    const target = event.target.closest(selector);
    if (target && root.contains(target)) handler(event, target);
  };
  root.addEventListener(type, listener);
  return () => root.removeEventListener(type, listener);
}

export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

export function onReady(fn) {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn, { once: true });
  else fn();
}
