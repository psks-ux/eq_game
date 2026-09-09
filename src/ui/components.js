/* components.js — the shared component library (contract 20).
   `mountSvg` is the ONLY place innerHTML is used in the whole app; every other
   element here is built with DOM / createElementNS calls. */

import { icon as iconMarkup } from './icons.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

const FACTOR_KEYS = [
  'induction',
  'spatial',
  'workingMemory',
  'relational',
  'speed',
  'flexibility',
];

const FOCUSABLE =
  'a[href],area[href],button:not([disabled]),input:not([disabled]),' +
  'select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

/* unique DOM ids for clip paths / aria wiring (UI-only counter) */
let uidCounter = 0;
function uid(prefix) {
  uidCounter += 1;
  return `${prefix}-${uidCounter}`;
}

/* ------------------------------------------------------------- utilities */

function isNode(v) {
  return typeof Node !== 'undefined' && v instanceof Node;
}

function num(v, fallback = 0) {
  return Number.isFinite(v) ? v : fallback;
}

function clamp(x, lo, hi) {
  return x < lo ? lo : x > hi ? hi : x;
}

function fx(n) {
  const v = Number.isFinite(n) ? n : 0;
  return Math.round(v * 100) / 100;
}

function h(tag, attrs, children) {
  const node = document.createElement(tag);
  applyAttrs(node, attrs);
  append(node, children);
  return node;
}

function s(tag, attrs) {
  const node = document.createElementNS(SVG_NS, tag);
  if (attrs) {
    for (const key of Object.keys(attrs)) {
      const v = attrs[key];
      if (v === null || v === undefined || v === false) continue;
      node.setAttribute(key, String(v));
    }
  }
  return node;
}

function applyAttrs(node, attrs) {
  if (!attrs) return;
  for (const key of Object.keys(attrs)) {
    const v = attrs[key];
    if (v === null || v === undefined || v === false) continue;
    if (key === 'class' || key === 'className') node.setAttribute('class', String(v));
    else if (key === 'text') node.textContent = String(v);
    else if (key === 'dataset' && typeof v === 'object') Object.assign(node.dataset, v);
    else if (key === 'style' && typeof v === 'object') Object.assign(node.style, v);
    else if (v === true) node.setAttribute(key, '');
    else node.setAttribute(key, String(v));
  }
}

function append(parent, children) {
  if (children === null || children === undefined || children === false) return parent;
  if (Array.isArray(children)) {
    for (const child of children) append(parent, child);
    return parent;
  }
  if (isNode(children)) parent.appendChild(children);
  else parent.appendChild(document.createTextNode(String(children)));
  return parent;
}

function clear(node) {
  while (node && node.firstChild) node.removeChild(node.firstChild);
  return node;
}

function iconSpan(key, size = 20, className = 'icon') {
  const span = h('span', { class: className, 'aria-hidden': 'true' });
  mountSvg(span, iconMarkup(key, size));
  return span;
}

function normaliseActions(actions, closeFn) {
  const out = [];
  if (!actions) return out;
  const list = Array.isArray(actions) ? actions : [actions];
  for (const item of list) {
    if (!item) continue;
    if (isNode(item)) {
      out.push(item);
      continue;
    }
    const spec = Object.assign({}, item);
    const userClick = typeof spec.onClick === 'function' ? spec.onClick : null;
    const shouldClose = spec.close !== false;
    spec.onClick = (ev) => {
      if (userClick) userClick(ev);
      if (shouldClose && typeof closeFn === 'function') closeFn('action');
    };
    out.push(button(spec));
  }
  return out;
}

/* ------------------------------------------------------------- mountSvg */

/**
 * Replace an element's content with an SVG string.
 * This is the single sanctioned `innerHTML` site in the application: every SVG
 * string reaching it is produced by our own generators (items/svg.js, ui/icons.js,
 * ui/demos.js) and never contains user or network data.
 * @returns {SVGElement|null} the mounted <svg>, if any.
 */
export function mountSvg(el, svgString) {
  if (!el) return null;
  clear(el);
  if (typeof svgString !== 'string' || svgString.length === 0) return null;
  el.innerHTML = svgString;
  return el.querySelector('svg');
}

/* --------------------------------------------------------------- button */

/**
 * button({ icon, label, onClick, variant }) -> HTMLButtonElement
 * The label is an optional affordance: an icon-only button still exposes the label
 * to assistive tech through aria-label, so nothing functional depends on reading.
 */
export function button(opts = {}) {
  const {
    icon: iconKey = null,
    label = '',
    onClick = null,
    variant = 'default',
    size = null,
    disabled = false,
    pressed = null,
    title = null,
    ariaLabel = null,
    className = '',
    type = 'button',
    block = false,
    id = null,
    dataset = null,
  } = opts || {};

  const classes = ['btn'];
  if (variant && variant !== 'default') classes.push(`btn--${variant}`);
  if (size) classes.push(`btn--${size}`);
  if (block) classes.push('btn--block');
  if (iconKey && !label) classes.push('btn--icon');
  if (className) classes.push(className);

  const btn = h('button', { type, class: classes.join(' ') });
  if (id) btn.id = id;
  if (dataset) Object.assign(btn.dataset, dataset);

  if (iconKey) btn.appendChild(iconSpan(iconKey, size === 'lg' ? 24 : 20, 'icon btn__icon'));
  if (label) {
    btn.appendChild(h('span', { class: 'btn__label label-text', text: String(label) }));
  }

  const accessible = ariaLabel || label || (iconKey ? String(iconKey) : '');
  if (accessible) btn.setAttribute('aria-label', String(accessible));
  if (title) btn.setAttribute('title', String(title));
  if (pressed !== null && pressed !== undefined) btn.setAttribute('aria-pressed', String(!!pressed));
  if (disabled) btn.disabled = true;
  if (typeof onClick === 'function') btn.addEventListener('click', onClick);

  btn.update = (next = {}) => {
    if ('label' in next) {
      let span = btn.querySelector('.btn__label');
      if (!span) {
        span = h('span', { class: 'btn__label label-text' });
        btn.appendChild(span);
      }
      span.textContent = String(next.label ?? '');
      if (next.label) btn.setAttribute('aria-label', String(next.label));
    }
    if ('disabled' in next) btn.disabled = !!next.disabled;
    if ('pressed' in next) btn.setAttribute('aria-pressed', String(!!next.pressed));
    if ('variant' in next) {
      for (const cls of Array.from(btn.classList)) {
        if (cls.startsWith('btn--') && !cls.startsWith('btn--icon')) btn.classList.remove(cls);
      }
      if (next.variant && next.variant !== 'default') btn.classList.add(`btn--${next.variant}`);
    }
    return btn;
  };

  return btn;
}

/* ----------------------------------------------------------------- card */

/**
 * card({ title, icon, body, actions, variant, className }) -> HTMLElement
 * Also accepts a bare Node or string as the body.
 */
export function card(opts = {}) {
  let spec = opts;
  if (isNode(spec) || typeof spec === 'string' || Array.isArray(spec)) spec = { body: spec };
  const {
    title = '',
    icon: iconKey = null,
    body = null,
    actions = null,
    variant = null,
    className = '',
    id = null,
    tag = 'section',
    ariaLabel = null,
  } = spec || {};

  const classes = ['card'];
  if (variant) classes.push(`card--${variant}`);
  if (className) classes.push(className);
  const root = h(tag, { class: classes.join(' ') });
  if (id) root.id = id;
  if (ariaLabel) root.setAttribute('aria-label', String(ariaLabel));

  if (title || iconKey) {
    const head = h('div', { class: 'card__head' });
    if (iconKey) head.appendChild(iconSpan(iconKey, 20));
    if (title) head.appendChild(h('h3', { class: 'card__title', text: String(title) }));
    root.appendChild(head);
  }

  const bodyEl = h('div', { class: 'card__body' });
  append(bodyEl, body);
  root.appendChild(bodyEl);

  const acts = normaliseActions(actions, null);
  if (acts.length) {
    const row = h('div', { class: 'card__actions' });
    append(row, acts);
    root.appendChild(row);
  }

  root.setBody = (next) => {
    clear(bodyEl);
    append(bodyEl, next);
    return root;
  };

  return root;
}

/* ---------------------------------------------------------- progressBar */

/**
 * progressBar({ value, max, label, variant }) -> HTMLElement with .update(value, max)
 */
export function progressBar(opts = {}) {
  const spec = typeof opts === 'number' ? { value: opts } : opts || {};
  const {
    value = 0,
    max = 1,
    label = '',
    hint = '',
    variant = null,
    className = '',
    showValue = false,
  } = spec;

  const classes = ['progress'];
  if (variant) classes.push(`progress--${variant}`);
  if (className) classes.push(className);
  const root = h('div', { class: classes.join(' ') });

  let valueEl = null;
  if (label || hint || showValue) {
    const head = h('div', { class: 'progress__head' });
    head.appendChild(h('span', { class: 'label-text', text: String(label || '') }));
    valueEl = h('span', { class: 'numeral', text: String(hint || '') });
    head.appendChild(valueEl);
    root.appendChild(head);
  }

  const track = h('div', { class: 'progress__track' });
  const fill = h('div', { class: 'progress__fill' });
  track.appendChild(fill);
  root.appendChild(track);

  track.setAttribute('role', 'progressbar');
  if (label) track.setAttribute('aria-label', String(label));

  const paint = (v, m) => {
    const top = num(m, 1) > 0 ? num(m, 1) : 1;
    const val = clamp(num(v, 0), 0, top);
    const pct = top === 0 ? 0 : (val / top) * 100;
    fill.style.width = `${fx(pct)}%`;
    track.setAttribute('aria-valuemin', '0');
    track.setAttribute('aria-valuemax', String(fx(top)));
    track.setAttribute('aria-valuenow', String(fx(val)));
  };

  paint(value, max);

  root.update = (v, m) => {
    paint(v, m === undefined ? Number(track.getAttribute('aria-valuemax')) : m);
    return root;
  };
  root.setHint = (text) => {
    if (valueEl) valueEl.textContent = String(text ?? '');
    return root;
  };

  return root;
}

/* ---------------------------------------------------------------- meter */

/**
 * meter({ value, min, max, label, ticks, variant }) -> HTMLElement with .update(value)
 * A bounded gauge: filled span plus a needle at the exact value.
 */
export function meter(opts = {}) {
  const spec = typeof opts === 'number' ? { value: opts } : opts || {};
  const {
    value = 0,
    min = 0,
    max = 1,
    label = '',
    hint = '',
    ticks = 4,
    variant = null,
    className = '',
  } = spec;

  const lo = num(min, 0);
  const hi = num(max, 1) > lo ? num(max, 1) : lo + 1;

  const classes = ['meter'];
  if (variant) classes.push(`meter--${variant}`);
  if (className) classes.push(className);
  const root = h('div', { class: classes.join(' ') });

  let hintEl = null;
  if (label || hint) {
    const head = h('div', { class: 'meter__head' });
    head.appendChild(h('span', { class: 'label-text', text: String(label || '') }));
    hintEl = h('span', { class: 'numeral', text: String(hint || '') });
    head.appendChild(hintEl);
    root.appendChild(head);
  }

  const track = h('div', { class: 'meter__track' });
  const fill = h('div', { class: 'meter__fill' });
  const needle = h('div', { class: 'meter__needle' });
  const tickWrap = h('div', { class: 'meter__ticks', 'aria-hidden': 'true' });
  const tickCount = clamp(Math.round(num(ticks, 4)), 0, 12);
  for (let i = 0; i <= tickCount; i += 1) tickWrap.appendChild(h('span', { class: 'meter__tick' }));
  track.appendChild(fill);
  track.appendChild(tickWrap);
  track.appendChild(needle);
  root.appendChild(track);

  track.setAttribute('role', 'meter');
  track.setAttribute('aria-valuemin', String(fx(lo)));
  track.setAttribute('aria-valuemax', String(fx(hi)));
  if (label) track.setAttribute('aria-label', String(label));

  const paint = (v) => {
    const val = clamp(num(v, lo), lo, hi);
    const pct = ((val - lo) / (hi - lo)) * 100;
    fill.style.width = `${fx(pct)}%`;
    needle.style.left = `${fx(pct)}%`;
    track.setAttribute('aria-valuenow', String(fx(val)));
  };

  paint(value);

  root.update = (v) => {
    paint(v);
    return root;
  };
  root.setHint = (text) => {
    if (hintEl) hintEl.textContent = String(text ?? '');
    return root;
  };

  return root;
}

/* ----------------------------------------------------------- optionGrid */

/**
 * optionGrid({ options, onPick, columns }) -> HTMLElement
 * options: [{ id, svg, width, height }]
 * Roving tabindex, arrow-key navigation, aria-pressed, and states carried by
 * border weight + corner notch + mark shape as well as colour.
 */
export function optionGrid(opts = {}) {
  const { options = [], onPick = null, columns = 4, ariaLabel = null, className = '' } = opts || {};

  const list = Array.isArray(options) ? options.filter(Boolean) : [];
  const declaredCols = clamp(Math.round(num(columns, 4)), 1, 8);

  const classes = ['optgrid'];
  if (className) classes.push(className);
  const grid = h('div', { class: classes.join(' '), role: 'group' });
  grid.style.setProperty('--cols', String(declaredCols));
  if (ariaLabel) grid.setAttribute('aria-label', String(ariaLabel));

  const tiles = [];
  const byId = new Map();
  let focusIndex = 0;
  let locked = false;

  function effectiveColumns() {
    try {
      const tpl = getComputedStyle(grid).gridTemplateColumns;
      if (tpl && tpl !== 'none') {
        const n = tpl.trim().split(/\s+/).length;
        if (n > 0) return n;
      }
    } catch (err) {
      /* jsdom-free environments: fall back to the declared column count */
    }
    return declaredCols;
  }

  function setFocus(index, moveFocus = true) {
    if (!tiles.length) return;
    const next = clamp(index, 0, tiles.length - 1);
    focusIndex = next;
    for (let i = 0; i < tiles.length; i += 1) tiles[i].tabIndex = i === next ? 0 : -1;
    if (moveFocus && typeof tiles[next].focus === 'function') tiles[next].focus();
  }

  function pick(index, ev) {
    if (locked) return;
    const option = list[index];
    if (!option) return;
    setFocus(index, false);
    if (typeof onPick === 'function') onPick(option.id, index, ev);
  }

  function onKeyDown(ev) {
    const key = ev.key;
    if (key !== 'ArrowLeft' && key !== 'ArrowRight' && key !== 'ArrowUp' &&
        key !== 'ArrowDown' && key !== 'Home' && key !== 'End' &&
        key !== 'Enter' && key !== ' ' && key !== 'Spacebar') {
      return;
    }
    const cols = effectiveColumns();
    const last = tiles.length - 1;
    let next = focusIndex;
    if (key === 'ArrowLeft') next = focusIndex <= 0 ? last : focusIndex - 1;
    else if (key === 'ArrowRight') next = focusIndex >= last ? 0 : focusIndex + 1;
    else if (key === 'ArrowUp') next = focusIndex - cols < 0 ? focusIndex : focusIndex - cols;
    else if (key === 'ArrowDown') next = focusIndex + cols > last ? focusIndex : focusIndex + cols;
    else if (key === 'Home') next = 0;
    else if (key === 'End') next = last;
    else {
      ev.preventDefault();
      pick(focusIndex, ev);
      return;
    }
    ev.preventDefault();
    setFocus(next, true);
  }

  list.forEach((option, index) => {
    const tile = h('button', {
      type: 'button',
      class: 'opt',
      'aria-pressed': 'false',
      tabindex: index === 0 ? '0' : '-1',
    });
    tile.dataset.optionId = String(option.id ?? index);

    const holder = h('div', { class: 'opt__svg' });
    mountSvg(holder, option.svg);
    tile.appendChild(holder);

    const mark = h('span', { class: 'opt__mark', 'aria-hidden': 'true' });
    tile.appendChild(mark);

    tile.addEventListener('click', (ev) => pick(index, ev));
    tile.addEventListener('focus', () => setFocus(index, false));
    tile.addEventListener('keydown', onKeyDown);

    tiles.push(tile);
    byId.set(String(option.id ?? index), { tile, mark, index });
    grid.appendChild(tile);
  });

  function entry(id) {
    return byId.get(String(id)) || null;
  }

  function applyState(id, state) {
    const found = entry(id);
    if (!found) return;
    const { tile, mark } = found;
    tile.classList.remove('is-selected', 'is-correct', 'is-incorrect', 'is-muted');
    tile.setAttribute('aria-pressed', state === 'selected' || state === 'correct' ? 'true' : 'false');
    clear(mark);
    if (state === 'selected') tile.classList.add('is-selected');
    else if (state === 'correct') {
      tile.classList.add('is-correct');
      mountSvg(mark, iconMarkup('success', 18));
    } else if (state === 'incorrect') {
      tile.classList.add('is-incorrect');
      mountSvg(mark, iconMarkup('fail', 18));
    } else if (state === 'muted') tile.classList.add('is-muted');
  }

  grid.setState = (id, state) => {
    applyState(id, state);
    return grid;
  };
  grid.setSelected = (id) => {
    for (const key of byId.keys()) applyState(key, key === String(id) ? 'selected' : 'idle');
    return grid;
  };
  grid.clearStates = () => {
    for (const key of byId.keys()) applyState(key, 'idle');
    return grid;
  };
  grid.reveal = (correctId, chosenId) => {
    for (const key of byId.keys()) {
      if (key === String(correctId)) applyState(key, 'correct');
      else if (chosenId !== undefined && chosenId !== null && key === String(chosenId)) {
        applyState(key, 'incorrect');
      } else applyState(key, 'muted');
    }
    return grid;
  };
  grid.lock = (value = true) => {
    locked = !!value;
    for (const tile of tiles) {
      tile.classList.toggle('is-locked', locked);
      tile.setAttribute('aria-disabled', locked ? 'true' : 'false');
    }
    return grid;
  };
  grid.focusFirst = () => {
    setFocus(0, true);
    return grid;
  };
  grid.destroy = () => {
    for (const tile of tiles) tile.removeEventListener('keydown', onKeyDown);
    clear(grid);
    tiles.length = 0;
    byId.clear();
  };

  return grid;
}

/* --------------------------------------------------------------- dialog */

/**
 * dialog({ title, body, actions, onClose, dismissible }) -> overlay HTMLElement
 * with .open(), .close() and .destroy(). Traps focus, closes on Escape and
 * restores focus to whatever was focused before it opened.
 */
export function dialog(opts = {}) {
  let spec = opts;
  if (isNode(spec) || typeof spec === 'string') spec = { body: spec };
  const {
    title = '',
    icon: iconKey = null,
    body = null,
    actions = null,
    onClose = null,
    dismissible = true,
    className = '',
    closeLabel = '',
  } = spec || {};

  const overlay = h('div', { class: 'dialog-overlay' });
  overlay.hidden = true;
  const panel = h('div', {
    class: `dialog${className ? ` ${className}` : ''}`,
    role: 'dialog',
    'aria-modal': 'true',
  });
  overlay.appendChild(panel);

  let previousFocus = null;
  let isOpen = false;

  function close(reason) {
    if (!isOpen) return overlay;
    isOpen = false;
    overlay.hidden = true;
    document.removeEventListener('keydown', onKeyDown, true);
    document.removeEventListener('focusin', onFocusIn, true);
    if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
    if (previousFocus && typeof previousFocus.focus === 'function') {
      try {
        previousFocus.focus();
      } catch (err) {
        /* the previously focused node may have been unmounted */
      }
    }
    previousFocus = null;
    if (typeof onClose === 'function') onClose(reason);
    return overlay;
  }

  if (title || iconKey || dismissible) {
    const head = h('div', { class: 'dialog__head' });
    if (iconKey) head.appendChild(iconSpan(iconKey, 20));
    const titleId = uid('dlg-title');
    if (title) {
      const heading = h('h2', { class: 'dialog__title', id: titleId, text: String(title) });
      head.appendChild(heading);
      panel.setAttribute('aria-labelledby', titleId);
    }
    if (dismissible) {
      head.appendChild(
        button({
          icon: 'close',
          variant: 'quiet',
          className: 'dialog__close',
          ariaLabel: closeLabel || 'close',
          onClick: () => close('dismiss'),
        })
      );
    }
    panel.appendChild(head);
  }

  const bodyEl = h('div', { class: 'dialog__body' });
  append(bodyEl, body);
  panel.appendChild(bodyEl);

  const acts = normaliseActions(actions, close);
  if (acts.length) {
    const row = h('div', { class: 'dialog__actions' });
    append(row, acts);
    panel.appendChild(row);
  }

  function focusables() {
    return Array.from(panel.querySelectorAll(FOCUSABLE)).filter(
      (el) => el.offsetParent !== null || el === document.activeElement || el.tabIndex >= 0
    );
  }

  function onKeyDown(ev) {
    if (!isOpen) return;
    if (ev.key === 'Escape') {
      if (dismissible) {
        ev.preventDefault();
        ev.stopPropagation();
        close('escape');
      }
      return;
    }
    if (ev.key !== 'Tab') return;
    const items = focusables();
    if (!items.length) {
      ev.preventDefault();
      panel.focus();
      return;
    }
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;
    if (ev.shiftKey && (active === first || !panel.contains(active))) {
      ev.preventDefault();
      last.focus();
    } else if (!ev.shiftKey && active === last) {
      ev.preventDefault();
      first.focus();
    }
  }

  function onFocusIn(ev) {
    if (!isOpen) return;
    if (panel.contains(ev.target)) return;
    const items = focusables();
    (items[0] || panel).focus();
  }

  overlay.addEventListener('mousedown', (ev) => {
    if (ev.target === overlay && dismissible) close('backdrop');
  });

  overlay.open = () => {
    if (isOpen) return overlay;
    isOpen = true;
    previousFocus = document.activeElement;
    if (!overlay.parentNode) document.body.appendChild(overlay);
    overlay.hidden = false;
    panel.tabIndex = -1;
    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('focusin', onFocusIn, true);
    const items = focusables();
    (items[0] || panel).focus();
    return overlay;
  };
  overlay.close = (reason) => close(reason || 'close');
  overlay.destroy = () => {
    close('destroy');
    clear(overlay);
  };
  overlay.setBody = (next) => {
    clear(bodyEl);
    append(bodyEl, next);
    return overlay;
  };

  return overlay;
}

/* ------------------------------------------------------------ sparkline */

/**
 * sparkline(values) -> HTMLElement
 * Degrades cleanly for empty, single-point and flat series.
 */
export function sparkline(values, opts = {}) {
  const { width = 148, height = 38, className = '', ariaLabel = null } = opts || {};
  const data = (Array.isArray(values) ? values : []).map((v) => num(Number(v), 0));

  const root = h('span', { class: `chart chart--sparkline${className ? ` ${className}` : ''}` });
  if (ariaLabel) {
    root.setAttribute('role', 'img');
    root.setAttribute('aria-label', String(ariaLabel));
  } else {
    root.setAttribute('aria-hidden', 'true');
  }

  const draw = (series) => {
    clear(root);
    const svg = s('svg', {
      viewBox: `0 0 ${width} ${height}`,
      width,
      height,
      preserveAspectRatio: 'none',
    });
    const pad = 4;
    const w = width - pad * 2;
    const hgt = height - pad * 2;

    if (!series.length) {
      svg.appendChild(
        s('line', { class: 'c-grid', x1: pad, y1: height / 2, x2: width - pad, y2: height / 2 })
      );
      root.appendChild(svg);
      return;
    }
    if (series.length === 1) {
      svg.appendChild(s('circle', { class: 'c-dot', cx: width / 2, cy: height / 2, r: 3.5 }));
      root.appendChild(svg);
      return;
    }

    let lo = Math.min(...series);
    let hi = Math.max(...series);
    if (hi - lo < 1e-9) {
      lo -= 0.5;
      hi += 0.5;
    }
    const x = (i) => pad + (i / (series.length - 1)) * w;
    const y = (v) => pad + hgt - ((v - lo) / (hi - lo)) * hgt;

    let d = '';
    for (let i = 0; i < series.length; i += 1) {
      d += `${i === 0 ? 'M' : 'L'}${fx(x(i))} ${fx(y(series[i]))}`;
    }
    svg.appendChild(s('path', { class: 'c-line', d }));
    svg.appendChild(
      s('circle', {
        class: 'c-dot',
        cx: fx(x(series.length - 1)),
        cy: fx(y(series[series.length - 1])),
        r: 3,
      })
    );
    root.appendChild(svg);
  };

  draw(data);
  root.update = (next) => {
    draw((Array.isArray(next) ? next : []).map((v) => num(Number(v), 0)));
    return root;
  };
  return root;
}

/* ---------------------------------------------------------------- radar */

/**
 * radar({ factorScores }) -> HTMLElement
 * Six axes in the contract's factor order. Axis identity is carried by a distinct
 * geometric glyph per axis — never by text.
 */
export function radar(input = {}, opts = {}) {
  const { className = '', size = 340, ariaLabel = 'factor profile' } = opts || {};
  const root = h('div', {
    class: `chart chart--radar${className ? ` ${className}` : ''}`,
    role: 'img',
    'aria-label': String(ariaLabel),
  });

  const W = size;
  const cx = W / 2;
  const cy = W / 2;
  const R = W * 0.34;
  const RINGS = 4;

  const axisGlyph = (index, x, y, r) => {
    switch (index) {
      case 0:
        return s('circle', { class: 'c-axis-glyph', cx: fx(x), cy: fx(y), r: fx(r) });
      case 1:
        return s('rect', {
          class: 'c-axis-glyph',
          x: fx(x - r),
          y: fx(y - r),
          width: fx(r * 2),
          height: fx(r * 2),
          rx: 1.5,
        });
      case 2:
        return s('path', {
          class: 'c-axis-glyph',
          d: `M${fx(x)} ${fx(y - r)}L${fx(x + r)} ${fx(y + r)}L${fx(x - r)} ${fx(y + r)}Z`,
        });
      case 3:
        return s('path', {
          class: 'c-axis-glyph',
          d: `M${fx(x)} ${fx(y - r)}L${fx(x + r)} ${fx(y)}L${fx(x)} ${fx(y + r)}L${fx(x - r)} ${fx(y)}Z`,
        });
      case 4: {
        let d = '';
        for (let k = 0; k < 5; k += 1) {
          const a = -Math.PI / 2 + (k * 2 * Math.PI) / 5;
          d += `${k === 0 ? 'M' : 'L'}${fx(x + r * Math.cos(a))} ${fx(y + r * Math.sin(a))}`;
        }
        return s('path', { class: 'c-axis-glyph', d: `${d}Z` });
      }
      default: {
        let d = '';
        for (let k = 0; k < 6; k += 1) {
          const a = -Math.PI / 2 + (k * 2 * Math.PI) / 6;
          d += `${k === 0 ? 'M' : 'L'}${fx(x + r * Math.cos(a))} ${fx(y + r * Math.sin(a))}`;
        }
        return s('path', { class: 'c-axis-glyph', d: `${d}Z` });
      }
    }
  };

  const draw = (scores) => {
    clear(root);
    const svg = s('svg', { viewBox: `0 0 ${W} ${W}`, width: W, height: W });

    const raw = FACTOR_KEYS.map((key) => {
      const v = scores && Number.isFinite(Number(scores[key])) ? Number(scores[key]) : 0;
      return v;
    });
    const peak = Math.max(1, ...raw.map((v) => Math.abs(v)));
    const vals = raw.map((v) => clamp(peak > 1 ? v / peak : v, 0, 1));

    const point = (i, rad) => {
      const a = -Math.PI / 2 + (i * 2 * Math.PI) / FACTOR_KEYS.length;
      return [cx + rad * Math.cos(a), cy + rad * Math.sin(a)];
    };

    for (let ring = 1; ring <= RINGS; ring += 1) {
      const rad = (R * ring) / RINGS;
      let d = '';
      for (let i = 0; i < FACTOR_KEYS.length; i += 1) {
        const [px, py] = point(i, rad);
        d += `${i === 0 ? 'M' : 'L'}${fx(px)} ${fx(py)}`;
      }
      svg.appendChild(s('path', { class: 'c-radar-grid', d: `${d}Z` }));
    }

    for (let i = 0; i < FACTOR_KEYS.length; i += 1) {
      const [px, py] = point(i, R);
      svg.appendChild(s('line', { class: 'c-radar-axis', x1: cx, y1: cy, x2: fx(px), y2: fx(py) }));
      const [gx, gy] = point(i, R + W * 0.075);
      svg.appendChild(axisGlyph(i, gx, gy, W * 0.026));
    }

    let area = '';
    for (let i = 0; i < FACTOR_KEYS.length; i += 1) {
      const [px, py] = point(i, R * Math.max(vals[i], 0.015));
      area += `${i === 0 ? 'M' : 'L'}${fx(px)} ${fx(py)}`;
    }
    svg.appendChild(s('path', { class: 'c-radar-area', d: `${area}Z` }));

    for (let i = 0; i < FACTOR_KEYS.length; i += 1) {
      const [px, py] = point(i, R * Math.max(vals[i], 0.015));
      svg.appendChild(s('circle', { class: 'c-radar-node', cx: fx(px), cy: fx(py), r: 4 }));
    }

    root.appendChild(svg);
  };

  draw((input && input.factorScores) || {});

  root.update = (next) => {
    draw((next && (next.factorScores || next)) || {});
    return root;
  };
  return root;
}

/* ----------------------------------------------------------------- bell */

/**
 * bell({ index, ci }) -> HTMLElement
 * The population curve, the elimination cut, the point estimate AND a loud
 * confidence band. The band is deliberately the most prominent mark on the chart:
 * the product never shows a point estimate without its uncertainty.
 */
export function bell(input = {}, opts = {}) {
  const { className = '', ariaLabel = 'measured index with confidence interval' } = opts || {};
  const root = h('div', {
    class: `chart chart--bell${className ? ` ${className}` : ''}`,
    role: 'img',
    'aria-label': String(ariaLabel),
  });

  const W = 640;
  const H = 280;
  const X0 = 34;
  const X1 = 606;
  const Y_TOP = 30;
  const Y_BASE = 206;
  const Y_CAL = 240;
  /* The plotted domain must cover the whole reportable scale: scale.js clamps the
     index to [40, 200], so a floor above 40 would pin a low eliminated score — and
     its CI edge — to the left wall and misstate both. */
  const D_LO = 40;
  const D_HI = 205;
  const MU = 100;
  const SD = 15;
  const CUT = 100;

  const xOf = (v) => X0 + ((clamp(num(v, MU), D_LO, D_HI) - D_LO) / (D_HI - D_LO)) * (X1 - X0);
  const yOf = (v) => Y_BASE - Math.exp(-0.5 * ((v - MU) / SD) ** 2) * (Y_BASE - Y_TOP);

  const draw = (state) => {
    clear(root);
    const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H });

    const index = Number.isFinite(Number(state && state.index)) ? Number(state.index) : null;
    const ciRaw = state && state.ci ? state.ci : null;
    let lo = ciRaw && Number.isFinite(Number(ciRaw.lo)) ? Number(ciRaw.lo) : null;
    let hi = ciRaw && Number.isFinite(Number(ciRaw.hi)) ? Number(ciRaw.hi) : null;
    if (lo !== null && hi !== null && lo > hi) {
      const t = lo;
      lo = hi;
      hi = t;
    }
    const hasCi = lo !== null && hi !== null;

    /* population distribution */
    let pop = `M${X0} ${Y_BASE}`;
    const STEPS = 150;
    for (let i = 0; i <= STEPS; i += 1) {
      const v = D_LO + ((D_HI - D_LO) * i) / STEPS;
      pop += `L${fx(xOf(v))} ${fx(yOf(v))}`;
    }
    pop += `L${X1} ${Y_BASE}Z`;
    svg.appendChild(s('path', { class: 'c-pop', d: pop }));

    /* the sub-100 elimination zone */
    svg.appendChild(
      s('rect', {
        class: 'c-cut-zone',
        x: X0,
        y: Y_TOP - 8,
        width: fx(xOf(CUT) - X0),
        height: fx(Y_BASE - Y_TOP + 8),
      })
    );
    svg.appendChild(
      s('line', { class: 'c-cut', x1: fx(xOf(CUT)), y1: Y_TOP - 8, x2: fx(xOf(CUT)), y2: Y_BASE + 14 })
    );

    /* confidence band — drawn above the curve so it cannot read as a footnote */
    if (hasCi) {
      const bx = xOf(lo);
      const bw = Math.max(3, xOf(hi) - bx);
      const clipId = uid('ci-clip');
      const defs = s('defs', null);
      const clip = s('clipPath', { id: clipId });
      clip.appendChild(
        s('rect', { x: fx(bx), y: Y_TOP - 8, width: fx(bw), height: fx(Y_BASE - Y_TOP + 8) })
      );
      defs.appendChild(clip);
      svg.appendChild(defs);

      svg.appendChild(
        s('rect', {
          class: 'c-ci',
          x: fx(bx),
          y: Y_TOP - 8,
          width: fx(bw),
          height: fx(Y_BASE - Y_TOP + 8),
        })
      );

      const hatch = s('g', { class: 'c-ci-hatch', 'clip-path': `url(#${clipId})` });
      const span = Y_BASE - Y_TOP + 8;
      for (let t = bx - span; t < bx + bw + span; t += 11) {
        hatch.appendChild(
          s('line', { x1: fx(t), y1: fx(Y_BASE), x2: fx(t + span), y2: fx(Y_TOP - 8) })
        );
      }
      svg.appendChild(hatch);

      svg.appendChild(
        s('line', { class: 'c-ci-edge', x1: fx(bx), y1: Y_TOP - 8, x2: fx(bx), y2: fx(Y_BASE) })
      );
      svg.appendChild(
        s('line', {
          class: 'c-ci-edge',
          x1: fx(bx + bw),
          y1: Y_TOP - 8,
          x2: fx(bx + bw),
          y2: fx(Y_BASE),
        })
      );

      /* caliper under the axis */
      svg.appendChild(
        s('line', { class: 'c-ci-bar', x1: fx(bx), y1: Y_CAL, x2: fx(bx + bw), y2: Y_CAL })
      );
      svg.appendChild(
        s('line', { class: 'c-ci-edge', x1: fx(bx), y1: Y_CAL - 9, x2: fx(bx), y2: Y_CAL + 9 })
      );
      svg.appendChild(
        s('line', {
          class: 'c-ci-edge',
          x1: fx(bx + bw),
          y1: Y_CAL - 9,
          x2: fx(bx + bw),
          y2: Y_CAL + 9,
        })
      );
    }

    /* axis and ticks (geometric only — no numerals) */
    svg.appendChild(s('line', { class: 'c-axis', x1: X0, y1: Y_BASE, x2: X1, y2: Y_BASE }));
    for (let v = D_LO; v <= D_HI; v += 15) {
      const long = v === CUT;
      svg.appendChild(
        s('line', {
          class: 'c-tick',
          x1: fx(xOf(v)),
          y1: Y_BASE,
          x2: fx(xOf(v)),
          y2: Y_BASE + (long ? 14 : 7),
        })
      );
    }

    /* the point estimate */
    if (index !== null) {
      const px = xOf(index);
      svg.appendChild(s('line', { class: 'c-point', x1: fx(px), y1: Y_TOP - 8, x2: fx(px), y2: fx(Y_BASE) }));
      svg.appendChild(s('circle', { class: 'c-point-dot', cx: fx(px), cy: fx(yOf(index)), r: 6 }));
      svg.appendChild(
        s('path', {
          class: 'c-point-dot',
          d: `M${fx(px)} ${fx(Y_BASE + 6)}L${fx(px + 7)} ${fx(Y_BASE + 19)}L${fx(px - 7)} ${fx(
            Y_BASE + 19
          )}Z`,
        })
      );
    }

    root.appendChild(svg);
  };

  draw(input || {});

  root.update = (next) => {
    draw(next || {});
    return root;
  };
  return root;
}

/* ------------------------------------------------------------ infoCurve */

/**
 * infoCurve(points) -> HTMLElement
 * points: [{ theta, info, se }] — plots the test information function with the
 * standard-error curve on its own scale, and marks the peak.
 */
export function infoCurve(points, opts = {}) {
  const { className = '', ariaLabel = 'test information function' } = opts || {};
  const root = h('div', {
    class: `chart chart--info${className ? ` ${className}` : ''}`,
    role: 'img',
    'aria-label': String(ariaLabel),
  });

  const W = 640;
  const H = 250;
  const X0 = 38;
  const X1 = 612;
  const Y_TOP = 22;
  const Y_BASE = 194;

  const draw = (raw) => {
    clear(root);
    const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H });

    const data = (Array.isArray(raw) ? raw : [])
      .map((p) => ({
        theta: Number(p && p.theta),
        info: Number(p && p.info),
        se: Number(p && p.se),
      }))
      .filter((p) => Number.isFinite(p.theta) && Number.isFinite(p.info))
      .sort((a, b) => a.theta - b.theta);

    const tLo = data.length ? data[0].theta : -3;
    const tHi = data.length ? data[data.length - 1].theta : 6;
    const span = tHi - tLo > 1e-9 ? tHi - tLo : 1;
    const iMax = data.length ? Math.max(...data.map((p) => p.info)) : 1;
    const iTop = iMax > 1e-9 ? iMax : 1;
    const seVals = data.map((p) => p.se).filter((v) => Number.isFinite(v) && v > 0 && v < 5);
    const seTop = seVals.length ? Math.max(...seVals) : 1;

    const x = (t) => X0 + ((t - tLo) / span) * (X1 - X0);
    const y = (v) => Y_BASE - (clamp(v, 0, iTop) / iTop) * (Y_BASE - Y_TOP);
    const ySe = (v) => Y_BASE - (clamp(v, 0, seTop) / seTop) * (Y_BASE - Y_TOP);

    /* grid at whole-theta steps */
    const first = Math.ceil(tLo);
    for (let t = first; t <= tHi + 1e-9; t += 1) {
      svg.appendChild(s('line', { class: 'c-grid', x1: fx(x(t)), y1: Y_TOP, x2: fx(x(t)), y2: Y_BASE }));
      svg.appendChild(
        s('line', { class: 'c-tick', x1: fx(x(t)), y1: Y_BASE, x2: fx(x(t)), y2: Y_BASE + 7 })
      );
    }

    if (data.length >= 2) {
      let line = '';
      for (let i = 0; i < data.length; i += 1) {
        line += `${i === 0 ? 'M' : 'L'}${fx(x(data[i].theta))} ${fx(y(data[i].info))}`;
      }
      svg.appendChild(
        s('path', {
          class: 'c-area',
          d: `M${fx(X0)} ${fx(Y_BASE)}${line.slice(1)}L${fx(X1)} ${fx(Y_BASE)}Z`,
        })
      );
      svg.appendChild(s('path', { class: 'c-line', d: line }));

      if (seVals.length >= 2) {
        let seLine = '';
        let started = false;
        for (const p of data) {
          if (!Number.isFinite(p.se) || p.se <= 0 || p.se >= 5) continue;
          seLine += `${started ? 'L' : 'M'}${fx(x(p.theta))} ${fx(ySe(p.se))}`;
          started = true;
        }
        if (started) svg.appendChild(s('path', { class: 'c-line-2', d: seLine }));
      }

      let peak = data[0];
      for (const p of data) if (p.info > peak.info) peak = p;
      svg.appendChild(
        s('line', { class: 'c-peak', x1: fx(x(peak.theta)), y1: Y_TOP, x2: fx(x(peak.theta)), y2: Y_BASE })
      );
      svg.appendChild(
        s('circle', { class: 'c-dot', cx: fx(x(peak.theta)), cy: fx(y(peak.info)), r: 4.5 })
      );
    }

    svg.appendChild(s('line', { class: 'c-axis', x1: X0, y1: Y_BASE, x2: X1, y2: Y_BASE }));
    svg.appendChild(s('line', { class: 'c-axis', x1: X0, y1: Y_TOP, x2: X0, y2: Y_BASE }));

    root.appendChild(svg);
  };

  draw(points);

  root.update = (next) => {
    draw(next);
    return root;
  };
  return root;
}
