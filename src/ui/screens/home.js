/**
 * Screen: home. Entry point of the app. A new profile sees a calm wordless
 * invitation into the assessment; a qualified profile sees its index with the
 * confidence band, tier, next level and streak; an eliminated profile is redirected.
 */

import { mountSvg, button, bell } from '../components.js';
import { icon } from '../icons.js';
import { demoFor } from '../demos.js';
import { t, labelsEnabled } from '../i18n.js';
import { go as routerGo } from '../router.js';
import { tierFor, bandFor } from '../../core/scale.js';
import { nextLevel } from '../../train/curriculum.js';

const SCREEN_STYLE =
  'display:flex;flex-direction:column;gap:var(--sp-5,20px);' +
  'padding:var(--sp-5,20px);max-width:900px;margin:0 auto;width:100%;' +
  'box-sizing:border-box;color:var(--fg,#e9e9ee);font-family:var(--font,system-ui,sans-serif)';

const CARD_STYLE =
  'background:var(--bg-elev,#16171c);border:1px solid var(--line,#2a2c34);' +
  'border-radius:var(--r-lg,16px);padding:var(--sp-5,20px);' +
  'display:flex;flex-direction:column;gap:var(--sp-4,16px)';

const ROW_STYLE = 'display:flex;flex-wrap:wrap;gap:var(--sp-3,12px);align-items:center';

/* Geometric fallbacks used when icons.js has no entry for a key. No arrows, no
 * check marks, no culturally loaded glyphs — allowed primitives only. */
const GLYPH = {
  play: '<svg viewBox="0 0 24 24" width="100%" height="100%" aria-hidden="true">' +
    '<path d="M7 4 L20 12 L7 20 Z" fill="currentColor"/></svg>',
  train: '<svg viewBox="0 0 24 24" width="100%" height="100%" aria-hidden="true">' +
    '<circle cx="6" cy="12" r="3" fill="currentColor"/>' +
    '<circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" stroke-width="2"/>' +
    '<circle cx="18" cy="12" r="3" fill="none" stroke="currentColor" stroke-width="2"/></svg>',
  progress: '<svg viewBox="0 0 24 24" width="100%" height="100%" aria-hidden="true">' +
    '<rect x="3" y="14" width="4" height="7" fill="currentColor"/>' +
    '<rect x="10" y="9" width="4" height="12" fill="currentColor"/>' +
    '<rect x="17" y="4" width="4" height="17" fill="currentColor"/></svg>',
  settings: '<svg viewBox="0 0 24 24" width="100%" height="100%" aria-hidden="true">' +
    '<circle cx="12" cy="12" r="7" fill="none" stroke="currentColor" stroke-width="2"/>' +
    '<circle cx="12" cy="12" r="2.4" fill="currentColor"/></svg>',
  about: '<svg viewBox="0 0 24 24" width="100%" height="100%" aria-hidden="true">' +
    '<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/>' +
    '<rect x="10.6" y="10" width="2.8" height="7" rx="1.2" fill="currentColor"/>' +
    '<circle cx="12" cy="7" r="1.5" fill="currentColor"/></svg>',
  retest: '<svg viewBox="0 0 24 24" width="100%" height="100%" aria-hidden="true">' +
    '<path d="M12 3 A9 9 0 1 1 4.2 16.5" fill="none" stroke="currentColor" ' +
    'stroke-width="2" stroke-linecap="round"/>' +
    '<circle cx="12" cy="3" r="2.4" fill="currentColor"/></svg>'
};

/* Static, wordless fallback demo: a three-by-three field with one cell left open. */
const FALLBACK_DEMO_SVG =
  '<svg viewBox="0 0 300 300" width="100%" height="100%" aria-hidden="true">' +
  '<g fill="none" stroke="var(--stim,#e6e6ea)" stroke-width="4">' +
  '<circle cx="50" cy="50" r="22"/><circle cx="150" cy="50" r="22"/><circle cx="250" cy="50" r="22"/>' +
  '<rect x="28" y="128" width="44" height="44"/><rect x="128" y="128" width="44" height="44"/>' +
  '<rect x="228" y="128" width="44" height="44"/>' +
  '<path d="M50 228 L72 272 L28 272 Z"/><path d="M150 228 L172 272 L128 272 Z"/>' +
  '<rect x="222" y="222" width="56" height="56" stroke-dasharray="8 8" opacity="0.55"/>' +
  '</g></svg>';

let cleanup = [];

export function render(ctx) {
  destroy();
  const profile = (ctx && ctx.profile) || {};
  const status = profile.status || 'new';
  const root = h('main', { class: 'screen screen-home', style: SCREEN_STYLE });

  if (status === 'eliminated') {
    /* The gate is enforced in main.js too; this keeps the screen honest on its own. */
    navigate(ctx, '#/eliminated');
    return root;
  }

  if (status === 'qualified') root.appendChild(qualifiedView(ctx, profile));
  else root.appendChild(newView(ctx, profile));

  root.appendChild(navRow(ctx, status));
  return root;
}

export function destroy() {
  const fns = cleanup;
  cleanup = [];
  for (const fn of fns) {
    try { fn(); } catch (err) { /* teardown must never throw */ }
  }
}

/* ---------------------------------------------------------------- new profile */

function newView(ctx, profile) {
  const wrap = h('section', { class: 'hero', style: CARD_STYLE });
  const reduced = prefersReducedMotion(profile);

  const stage = h('div', {
    class: 'hero-demo',
    style: 'display:flex;justify-content:center;align-items:center;min-height:230px;' +
      'background:var(--bg-elev-2,#1d1f26);border-radius:var(--r-md,12px);padding:var(--sp-4,16px)'
  });
  const inner = h('div', { style: 'width:100%;max-width:340px' });
  stage.appendChild(inner);
  cleanup.push(mountDemo(inner, 'matrix', reduced));

  const start = actionButton({
    iconKey: 'play',
    glyph: GLYPH.play,
    labelKey: ['home.start', 'start'],
    fallbackLabel: 'Begin',
    variant: 'primary',
    large: true,
    onClick: () => navigate(ctx, '#/test')
  });

  const caption = note('home.intro',
    'A sequence of picture puzzles. No words, no numbers, no schooling required — ' +
    'watch the example above, then begin.');

  wrap.appendChild(stage);
  wrap.appendChild(h('div', { style: 'display:flex;justify-content:center' }, [start]));
  wrap.appendChild(caption);
  return wrap;
}

/* ------------------------------------------------------------ qualified profile */

function qualifiedView(ctx, profile) {
  const wrap = h('div', { style: 'display:flex;flex-direction:column;gap:var(--sp-5,20px)' });
  const last = lastAssessment(profile);
  const index = numberOr(profile.currentIndex, last ? last.index : null);
  const ci = last && last.ci && isFiniteNum(last.ci.lo) && isFiniteNum(last.ci.hi) ? last.ci : null;
  const tier = resolveTier(profile, index);

  const head = h('section', { class: 'card', style: CARD_STYLE });
  head.appendChild(indexHeadline(index, ci));
  if (index !== null && ci) head.appendChild(bellBlock(index, ci));
  head.appendChild(tierRow(tier));
  wrap.appendChild(head);

  const next = safeCall(() => nextLevel(profile), null);
  const actions = h('section', { class: 'card', style: CARD_STYLE });
  if (next && next.id) actions.appendChild(nextLevelBlock(ctx, next));
  actions.appendChild(h('div', { style: ROW_STYLE }, [
    actionButton({
      iconKey: 'train', glyph: GLYPH.train, labelKey: ['home.train', 'train'],
      fallbackLabel: 'Train', variant: 'primary', large: true,
      onClick: () => navigate(ctx, '#/train')
    }),
    actionButton({
      iconKey: 'progress', glyph: GLYPH.progress, labelKey: ['home.progress', 'progress'],
      fallbackLabel: 'Progress', onClick: () => navigate(ctx, '#/progress')
    }),
    actionButton({
      iconKey: 'retest', glyph: GLYPH.retest, labelKey: ['home.retest', 'test'],
      fallbackLabel: 'Measure again', onClick: () => navigate(ctx, '#/test')
    })
  ]));
  wrap.appendChild(actions);

  wrap.appendChild(streakCard(profile));
  return wrap;
}

function indexHeadline(index, ci) {
  const box = h('div', { style: 'display:flex;flex-direction:column;gap:4px;align-items:center' });
  const value = h('div', {
    class: 'index-value',
    style: 'font-size:clamp(46px,12vw,72px);line-height:1;font-weight:600;' +
      'font-family:var(--mono,ui-monospace,monospace);color:' + bandColor(index),
    text: index === null ? '—' : String(index)
  });
  box.appendChild(value);
  if (ci) {
    box.appendChild(h('div', {
      style: 'font-family:var(--mono,ui-monospace,monospace);color:var(--fg-dim,#a9abb6);font-size:15px',
      text: ci.lo + '–' + ci.hi
    }));
  }
  box.appendChild(note('home.bandNote',
    'The band, not the single number, is the measurement.'));
  return box;
}

function bellBlock(index, ci) {
  return compose(
    () => bell({ index, ci }),
    () => h('div', {
      style: 'height:8px;border-radius:4px;background:linear-gradient(90deg,' +
        'var(--line,#2a2c34),var(--accent,#5b8cff),var(--line,#2a2c34))'
    })
  );
}

function tierRow(tier) {
  const row = h('div', {
    style: ROW_STYLE + ';justify-content:center',
    role: 'img',
    'aria-label': tx('home.tier', 'Tier') + ' ' + (tier + 1) + ' / 6'
  });
  for (let i = 0; i < 6; i += 1) {
    row.appendChild(h('span', {
      style: 'width:' + (i <= tier ? 22 : 14) + 'px;height:' + (i <= tier ? 22 : 14) + 'px;' +
        'border-radius:50%;display:inline-block;border:2px solid var(--line-strong,#3a3d47);' +
        'background:' + (i <= tier ? 'var(--accent,#5b8cff)' : 'transparent')
    }));
  }
  return row;
}

function nextLevelBlock(ctx, level) {
  const box = h('div', { style: ROW_STYLE });
  box.appendChild(levelNode(level));
  box.appendChild(actionButton({
    iconKey: 'play', glyph: GLYPH.play, labelKey: ['home.continue', 'continue'],
    fallbackLabel: 'Continue', variant: 'primary',
    onClick: () => navigate(ctx, '#/train/' + encodeURIComponent(level.id))
  }));
  return box;
}

function levelNode(level) {
  const color = factorColor(level.factor);
  const node = h('div', {
    role: 'img',
    'aria-label': tx('home.nextLevel', 'Next level') + ' ' + (level.id || ''),
    style: 'width:56px;height:56px;border-radius:var(--r-md,12px);display:flex;' +
      'align-items:center;justify-content:center;border:2px solid ' + color +
      ';background:var(--bg-elev-2,#1d1f26)'
  });
  mountSvg(node, factorGlyphSvg(level.factor, color));
  return node;
}

function streakCard(profile) {
  const streak = (profile && profile.streak) || {};
  const days = Math.max(0, Math.floor(Number(streak.days) || 0));
  const card = h('section', { class: 'card', style: CARD_STYLE });
  const row = h('div', {
    style: ROW_STYLE,
    role: 'img',
    'aria-label': tx(['home.streak', 'streak'], 'Streak') + ': ' + days
  });
  const shown = Math.min(7, Math.max(days, 0));
  for (let i = 0; i < 7; i += 1) {
    row.appendChild(h('span', {
      style: 'width:16px;height:16px;border-radius:4px;display:inline-block;' +
        'border:2px solid var(--line-strong,#3a3d47);background:' +
        (i < shown ? 'var(--good,#43c08a)' : 'transparent')
    }));
  }
  if (days > 0) {
    row.appendChild(h('span', {
      style: 'font-family:var(--mono,ui-monospace,monospace);color:var(--fg-dim,#a9abb6)',
      text: String(days)
    }));
  }
  card.appendChild(row);
  return card;
}

/* ------------------------------------------------------------------- nav row */

function navRow(ctx, status) {
  const row = h('nav', { style: ROW_STYLE + ';justify-content:center' });
  if (status === 'qualified') {
    row.appendChild(actionButton({
      iconKey: 'progress', glyph: GLYPH.progress, labelKey: ['nav.progress', 'progress'],
      fallbackLabel: 'Progress', compact: true,
      onClick: () => navigate(ctx, '#/progress')
    }));
  }
  row.appendChild(actionButton({
    iconKey: 'settings', glyph: GLYPH.settings, labelKey: ['nav.settings', 'settings'],
    fallbackLabel: 'Settings', compact: true,
    onClick: () => navigate(ctx, '#/settings')
  }));
  row.appendChild(actionButton({
    iconKey: 'about', glyph: GLYPH.about, labelKey: ['nav.about', 'about'],
    fallbackLabel: 'About', compact: true,
    onClick: () => navigate(ctx, '#/about')
  }));
  return row;
}

/* ------------------------------------------------------------------- helpers */

function h(tag, attrs, kids) {
  const node = document.createElement(tag);
  if (attrs) {
    for (const key of Object.keys(attrs)) {
      const value = attrs[key];
      if (value === null || value === undefined || value === false) continue;
      if (key === 'text') node.textContent = String(value);
      else if (key === 'class') node.className = String(value);
      else node.setAttribute(key, value === true ? '' : String(value));
    }
  }
  const list = kids === undefined || kids === null ? [] : [].concat(kids);
  for (const kid of list) {
    if (!kid) continue;
    node.appendChild(typeof kid === 'string' ? document.createTextNode(kid) : kid);
  }
  return node;
}

function compose(make, fallback) {
  try {
    const node = make();
    if (node && node.nodeType === 1) return node;
  } catch (err) { /* component drift must not blank the screen */ }
  return fallback();
}

function safeCall(fn, fallback) {
  try {
    const out = fn();
    return out === undefined ? fallback : out;
  } catch (err) {
    return fallback;
  }
}

/**
 * Look a label up in i18n, accepting a list of candidate keys so a screen can use its
 * own specific key and still fall back to the shared chrome vocabulary. The English
 * fallback is always the last resort: nothing functional depends on any of them.
 */
function tx(key, fallback) {
  const keys = Array.isArray(key) ? key : [key];
  for (const candidate of keys) {
    const s = safeCall(() => t(candidate), '');
    if (typeof s === 'string' && s.length) return s;
  }
  return fallback;
}

function labelsOn() {
  return safeCall(() => labelsEnabled(), true) !== false;
}

function note(key, fallback) {
  return h('p', {
    class: 'note',
    style: 'margin:0;color:var(--fg-dim,#a9abb6);font-size:14px;line-height:1.5;text-align:center',
    text: tx(key, fallback)
  });
}

function iconEl(key, size, fallbackSvg) {
  const host = h('span', {
    class: 'ico',
    'aria-hidden': 'true',
    style: 'display:inline-flex;align-items:center;justify-content:center;width:' +
      size + 'px;height:' + size + 'px;flex:0 0 auto'
  });
  let out = null;
  try { out = icon(key, size); } catch (err) { out = null; }
  if (out && out.nodeType === 1) host.appendChild(out);
  else if (typeof out === 'string' && out.trim().length) mountSvg(host, out);
  else if (fallbackSvg) mountSvg(host, fallbackSvg);
  return host;
}

function actionButton(spec) {
  const label = tx(spec.labelKey, spec.fallbackLabel);
  const aria = spec.ariaLabel || label;
  const node = compose(
    () => button({
      icon: spec.iconKey,
      label: labelsOn() ? label : '',
      onClick: spec.onClick,
      variant: spec.variant || 'default'
    }),
    () => localButton(spec, label)
  );
  if (!node.getAttribute('aria-label') && !node.textContent.trim()) {
    node.setAttribute('aria-label', aria);
  }
  if (!node.getAttribute('title')) node.setAttribute('title', aria);
  return node;
}

function localButton(spec, label) {
  const primary = spec.variant === 'primary';
  const size = spec.large ? 30 : 22;
  const btn = h('button', {
    type: 'button',
    class: 'btn' + (primary ? ' btn-primary' : ''),
    'aria-label': label,
    style: 'display:inline-flex;align-items:center;gap:var(--sp-2,8px);cursor:pointer;' +
      'padding:' + (spec.large ? '16px 26px' : '10px 16px') + ';' +
      'border-radius:var(--r-md,12px);font:inherit;font-size:' + (spec.large ? '18px' : '15px') + ';' +
      'border:1px solid ' + (primary ? 'var(--accent,#5b8cff)' : 'var(--line-strong,#3a3d47)') + ';' +
      'background:' + (primary ? 'var(--accent,#5b8cff)' : 'var(--bg-elev-2,#1d1f26)') + ';' +
      'color:' + (primary ? 'var(--bg,#0e0f13)' : 'var(--fg,#e9e9ee)') + ';'
  });
  btn.appendChild(iconEl(spec.iconKey, size, spec.glyph));
  if (labelsOn() && label && !spec.compact) {
    btn.appendChild(h('span', { text: label }));
  }
  if (typeof spec.onClick === 'function') btn.addEventListener('click', spec.onClick);
  return btn;
}

function mountDemo(host, kindId, reduced) {
  let demo = null;
  try { demo = demoFor(kindId); } catch (err) { demo = null; }
  const frames = demo && Array.isArray(demo.frames) ? demo.frames.filter((f) => f && f.svg) : [];
  if (!frames.length) {
    mountSvg(host, FALLBACK_DEMO_SVG);
    return () => {};
  }
  if (reduced) {
    const strip = h('div', {
      style: 'display:flex;flex-wrap:wrap;gap:8px;justify-content:center;align-items:center'
    });
    for (const frame of frames.slice(0, 6)) {
      const cellEl = h('div', { style: 'width:90px;height:90px' });
      mountSvg(cellEl, frame.svg);
      strip.appendChild(cellEl);
    }
    host.appendChild(strip);
    return () => {};
  }
  const view = h('div', { style: 'width:100%;display:flex;justify-content:center' });
  host.appendChild(view);
  let i = 0;
  let timer = null;
  let stopped = false;
  const step = () => {
    if (stopped) return;
    const frame = frames[i % frames.length];
    mountSvg(view, frame.svg);
    const ms = Math.max(150, Math.min(4000, Number(frame.ms) || 700));
    i += 1;
    if (demo.loop === false && i >= frames.length) return;
    timer = setTimeout(step, ms);
  };
  step();
  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    timer = null;
  };
}

function navigate(ctx, path) {
  const target = path.charAt(0) === '#' ? path : '#' + (path.charAt(0) === '/' ? path : '/' + path);
  if (ctx && typeof ctx.go === 'function') {
    try { ctx.go(target); return; } catch (err) { /* fall through */ }
  }
  try { routerGo(target); return; } catch (err) { /* fall through */ }
  window.location.hash = target;
}

function prefersReducedMotion(profile) {
  const flag = profile && profile.settings && profile.settings.reducedMotion;
  if (flag === true) return true;
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches === true;
  } catch (err) {
    return false;
  }
}

function lastAssessment(profile) {
  const list = profile && Array.isArray(profile.assessments) ? profile.assessments : [];
  return list.length ? list[list.length - 1] : null;
}

function numberOr(a, b) {
  if (isFiniteNum(a)) return a;
  if (isFiniteNum(b)) return b;
  return null;
}

function isFiniteNum(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

function resolveTier(profile, index) {
  if (isFiniteNum(index)) {
    const fromScale = safeCall(() => tierFor(index), null);
    if (isFiniteNum(fromScale) && fromScale >= 0) return fromScale;
  }
  const stored = profile && profile.tier;
  return isFiniteNum(stored) && stored >= 0 ? stored : 0;
}

const FACTOR_COLORS = {
  induction: '#0072B2',
  spatial: '#E69F00',
  workingMemory: '#009E73',
  relational: '#CC79A7',
  speed: '#56B4E9',
  flexibility: '#D55E00'
};

function factorColor(factor) {
  return FACTOR_COLORS[factor] || 'var(--accent,#5b8cff)';
}

/* Each factor also carries a distinct shape, so colour is never the sole carrier. */
function factorGlyphSvg(factor, color) {
  const body = {
    induction: '<circle cx="16" cy="16" r="10"/>',
    spatial: '<rect x="6" y="6" width="20" height="20"/>',
    workingMemory: '<path d="M16 5 L25.5 10.5 L25.5 21.5 L16 27 L6.5 21.5 L6.5 10.5 Z"/>',
    relational: '<path d="M16 5 L27 26 L5 26 Z"/>',
    speed: '<path d="M16 4 L28 16 L16 28 L4 16 Z"/>',
    flexibility: '<path d="M16 4 L27 12 L23 25 L9 25 L5 12 Z"/>'
  }[factor] || '<circle cx="16" cy="16" r="10"/>';
  return '<svg viewBox="0 0 32 32" width="100%" height="100%" aria-hidden="true" ' +
    'fill="none" stroke="' + color + '" stroke-width="2.6">' + body + '</svg>';
}

/* `bandFor` returns null below 100 (the eliminated state), so the default colour is
 * used and no band is claimed. `band.color` is a CSS custom-property name. */
function bandColor(index) {
  if (!isFiniteNum(index)) return 'var(--fg,#e9e9ee)';
  const band = safeCall(() => bandFor(index), null);
  if (band && typeof band.color === 'string' && band.color.length) {
    return band.color.indexOf('--') === 0
      ? 'var(' + band.color + ',var(--fg,#e9e9ee))'
      : band.color;
  }
  return 'var(--fg,#e9e9ee)';
}
