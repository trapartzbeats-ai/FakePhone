// Tiny DOM toolkit for the editor: element builder, form controls, popover, modal, toast.
export function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'value') el.value = v;
    else if (k === 'checked') el.checked = !!v;
    else if (k === 'html') el.innerHTML = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid == null || kid === false) continue;
    el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return el;
}

export const field = (label, control, hint) =>
  h('label', { class: 'field' }, h('span', { class: 'field-label' }, label), control, hint ? h('span', { class: 'hint' }, hint) : null);

export const row = (...kids) => h('div', { class: 'row' }, ...kids);
export const section = (title, ...kids) => h('section', { class: 'sect' }, title ? h('h3', {}, title) : null, ...kids);

export function text(value, onInput, attrs = {}) {
  return h('input', { type: 'text', value: value ?? '', oninput: (e) => onInput(e.target.value), ...attrs });
}
export function area(value, onInput, attrs = {}) {
  const el = h('textarea', { rows: 3, oninput: (e) => { onInput(e.target.value); grow(e.target); }, ...attrs });
  el.value = value ?? '';
  requestAnimationFrame(() => grow(el));
  return el;
}
function grow(el) { el.style.height = 'auto'; el.style.height = Math.min(220, el.scrollHeight + 2) + 'px'; }

export function num(value, onInput, attrs = {}) {
  return h('input', {
    type: 'number', value: value ?? '', step: attrs.step ?? 0.1, min: attrs.min, max: attrs.max, placeholder: attrs.placeholder,
    oninput: (e) => onInput(e.target.value === '' ? null : Number(e.target.value)),
  });
}
export function range(value, onInput, { min = 0, max = 1, step = 0.01, fmt = (v) => v } = {}) {
  const out = h('span', { class: 'range-val' }, fmt(value));
  const el = h('input', { type: 'range', min, max, step, value, oninput: (e) => { const v = Number(e.target.value); out.textContent = fmt(v); onInput(v); } });
  return h('div', { class: 'range' }, el, out);
}
export function select(value, options, onChange, attrs = {}) {
  const el = h('select', { onchange: (e) => onChange(e.target.value), ...attrs },
    options.map(([v, label]) => h('option', { value: v }, label)));
  el.value = value ?? '';
  return el;
}
export function toggle(value, onChange, label) {
  return h('label', { class: 'toggle' }, h('input', { type: 'checkbox', checked: value, onchange: (e) => onChange(e.target.checked) }), h('span', { class: 'knob' }), label ? h('span', {}, label) : null);
}
export function seg(value, options, onChange) {
  const wrap = h('div', { class: 'seg' });
  for (const [v, label] of options) {
    wrap.append(h('button', { type: 'button', class: v === value ? 'on' : '', onclick: () => { wrap.querySelectorAll('button').forEach((b) => b.classList.remove('on')); wrap.querySelector(`[data-v="${CSS.escape(String(v))}"]`)?.classList.add('on'); onChange(v); }, 'data-v': v }, label));
  }
  return wrap;
}
export function color(value, onInput) {
  return h('input', { type: 'color', value, oninput: (e) => onInput(e.target.value) });
}
export const btn = (label, onclick, cls = '', attrs = {}) => h('button', { type: 'button', class: 'btn ' + cls, onclick, ...attrs }, label);

export function pickFile(accept, multiple = false) {
  return new Promise((resolve) => {
    const inp = h('input', { type: 'file', accept, multiple });
    inp.addEventListener('change', () => resolve([...inp.files]));
    inp.click();
  });
}

// ---- popover / modal / toast -------------------------------------------------------
let pop = null;
export function popover(anchor, content, { width = 320, place = 'above' } = {}) {
  closePopover();
  pop = h('div', { class: 'popover', style: { width: width + 'px' } }, content);
  document.body.append(pop);
  const r = anchor.getBoundingClientRect();
  const ph = pop.offsetHeight;
  let top = place === 'above' ? r.top - ph - 8 : r.bottom + 8;
  if (top < 8) top = r.bottom + 8;
  if (top + ph > innerHeight - 8) top = Math.max(8, innerHeight - ph - 8);
  pop.style.top = top + 'px';
  pop.style.left = Math.max(8, Math.min(innerWidth - width - 8, r.left)) + 'px';
  setTimeout(() => document.addEventListener('pointerdown', outside, true), 0);
  return pop;
}
function outside(e) { if (pop && !pop.contains(e.target)) closePopover(); }
export function closePopover() {
  if (pop) { pop.remove(); pop = null; }
  document.removeEventListener('pointerdown', outside, true);
}

export function modal(title, body, actions = []) {
  const back = h('div', { class: 'modal-back', onpointerdown: (e) => { if (e.target === back) close(); } });
  const close = () => back.remove();
  back.append(h('div', { class: 'modal' },
    h('div', { class: 'modal-head' }, h('h2', {}, title), h('button', { class: 'icon-btn', onclick: close, title: 'Close' }, '✕')),
    h('div', { class: 'modal-body' }, body),
    actions.length ? h('div', { class: 'modal-foot' }, actions.map(([label, fn, cls]) => btn(label, () => { if (fn() !== false) close(); }, cls))) : null));
  document.body.append(back);
  return close;
}

let toastTimer;
export function toast(msg, kind = '') {
  let el = document.getElementById('toast');
  if (!el) { el = h('div', { id: 'toast' }); document.body.append(el); }
  el.textContent = msg;
  el.className = 'show ' + kind;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = ''; }, kind === 'error' ? 6000 : 2600);
}
