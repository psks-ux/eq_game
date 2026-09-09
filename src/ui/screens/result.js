/**
 * Screen: result. The measurement report — point estimate, confidence band,
 * reliability, items used, per-family breakdown and the test information curve,
 * with a plainly worded statement of what a single administration can and cannot say.
 */

import { mountSvg, button, bell, infoCurve } from '../components.js';
import { icon } from '../icons.js';
import { demoFor } from '../demos.js';
import { t, labelsEnabled } from '../i18n.js';
import { go as routerGo } from '../router.js';
import { bandFor, tierFor, confidenceInterval, FLOOR_INDEX, CEILING_INDEX } from '../../core/scale.js';
import { reliability as reliabilityFromSe } from '../../core/irt.js';

const LAST_RESULT_KEY = 'eqgame.lastResult.v1';

const SCREEN_STYLE =
  'display:flex;flex-direction:column;gap:var(--sp-5,20px);' +
  'padding:var(--sp-5,20px);max-width:900px;margin:0 auto;width:100%;' +
  'box-sizing:border-box;color:var(--fg,#e9e9ee);font-family:var(--font,system-ui,sans-serif)';

const CARD_STYLE =
  'background:var(--bg-elev,#16171c);border:1px solid var(--line,#2a2c34);' +
  'border-radius:var(--r-lg,16px);padding:var(--sp-5,20px);' +
  'display:flex;flex-direction:column;gap:var(--sp-4,16px)';

const ROW_STYLE = 'display:flex;flex-wrap:wrap;gap:var(--sp-3,12px);align-items:center';

const GLYPH = {
  train: '<svg viewBox="0 0 24 24" width="100%" height="100%" aria-hidden="true">' +
    '<circle cx="6" cy="12" r="3" fill="currentColor"/>' +
    '<circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" stroke-width="2"/>' +
    '<circle cx="18" cy="12" r="3" fill="none" stroke="currentColor" stroke-width="2"/></svg>',
  home: '<svg viewBox="0 0 24 24" width="100%" height="100%" aria-hidden="true">' +
    '<rect x="4" y="4" width="16" height="16" rx="3" fill="none" stroke="currentColor" ' +
    'stroke-width="2"/><rect x="9" y="9" width="6" height="6" fill="currentColor"/></svg>',
  progress: '<svg viewBox="0 0 24 24" width="100%" height="100%" aria-hidden="true">' +
    '<rect x="3" y="14" width="4" height="7" fill="currentColor"/>' +
    '<rect x="10" y="9" width="4" height="12" fill="currentColor"/>' +
    '<rect x="17" y="4" width="4" height="17" fill="currentColor"/></svg>'
};

let cleanup = [];

export function render(ctx) {
  destroy();
  const profile = (ctx && ctx.profile) || {};
  const root = h('main', { class: 'screen screen-result', style: SCREEN_STYLE });

  const assessment = lastAssessment(profile);
  const cached = readCachedResult();
  const report = mergeReport(assessment, cached, profile);

  if (!report) {
    /* Nothing has been measured yet — there is no report to show. */
    navigate(ctx, '#/');
    return root;
  }

  root.appendChild(headlineCard(report));
  root.appendChild(precisionCard(report));
  const families = familyCard(report, profile);
  if (families) root.appendChild(families);
  const info = infoCard(report);
  if (info) root.appendChild(info);
  root.appendChild(honestyCard());
  root.appendChild(actionsCard(ctx, profile));
  return root;
}

export function destroy() {
  const fns = cleanup;
  cleanup = [];
  for (const fn of fns) {
    try { fn(); } catch (err) { /* teardown must never throw */ }
  }
}

/* ------------------------------------------------------------------- report */

function mergeReport(assessment, cached, profile) {
  const base = {};
  const src = assessment || {};
  base.index = firstNumber(src.index, cached && cached.index, profile.currentIndex);
  if (!Number.isFinite(base.index)) return null;
  base.theta = firstNumber(src.theta, cached && cached.theta, null);
  base.se = firstNumber(src.se, cached && cached.se, null);
  base.itemsUsed = firstNumber(src.itemsUsed, cached && cached.itemsUsed, null);
  base.reliability = firstNumber(src.reliability, cached && cached.reliability, null);
  if (!Number.isFinite(base.reliability) && Number.isFinite(base.se)) {
    base.reliability = safeCall(() => reliabilityFromSe(base.se), null);
  }
  base.ci = pickCi(src.ci, cached && cached.ci, base.theta, base.se);
  base.byFamily = (src.byFamily && typeof src.byFamily === 'object' && Object.keys(src.byFamily).length)
    ? src.byFamily
    : ((cached && cached.byFamily) || null);
  base.byContentGroup = (cached && cached.byContentGroup) || null;
  base.medianRtMs = firstNumber(cached && cached.medianRtMs, null, null);
  base.finishedReason = (cached && typeof cached.finishedReason === 'string')
    ? cached.finishedReason
    : null;
  /* Only shown when the real curve from this session is available; it is never
   * reconstructed from the point estimate, because that would be invented data. */
  base.informationCurve = cached && Array.isArray(cached.informationCurve) &&
    cached.informationCurve.length ? cached.informationCurve : null;
  base.at = firstNumber(src.at, null, null);
  return base;
}

function pickCi(a, b, theta, se) {
  if (a && Number.isFinite(a.lo) && Number.isFinite(a.hi)) return { lo: a.lo, hi: a.hi };
  if (b && Number.isFinite(b.lo) && Number.isFinite(b.hi)) return { lo: b.lo, hi: b.hi };
  if (Number.isFinite(theta) && Number.isFinite(se)) {
    const ci = safeCall(() => confidenceInterval(theta, se, 0.9), null);
    if (ci && Number.isFinite(ci.lo) && Number.isFinite(ci.hi)) return { lo: ci.lo, hi: ci.hi };
  }
  return null;
}

/* ------------------------------------------------------------------- cards */

function headlineCard(report) {
  const card = h('section', { style: CARD_STYLE });
  const head = h('div', { style: 'display:flex;flex-direction:column;align-items:center;gap:6px' });
  head.appendChild(h('div', {
    style: 'font-size:clamp(48px,13vw,80px);line-height:1;font-weight:600;' +
      'font-family:var(--mono,ui-monospace,monospace);color:' + bandColor(report.index),
    text: String(report.index)
  }));
  if (report.ci) {
    head.appendChild(h('div', {
      style: 'font-family:var(--mono,ui-monospace,monospace);font-size:16px;color:var(--fg-dim,#a9abb6)',
      text: report.ci.lo + ' – ' + report.ci.hi
    }));
    head.appendChild(h('div', {
      style: 'font-size:13px;color:var(--fg-mute,#7b7d88)',
      text: tx('result.ciLabel', '90% confidence band')
    }));
  }
  card.appendChild(head);
  card.appendChild(scaleStrip(report.index, report.ci));
  if (report.ci) {
    card.appendChild(compose(
      () => bell({ index: report.index, ci: report.ci }),
      () => h('div', { style: 'height:1px;background:var(--line,#2a2c34)' })
    ));
  }
  card.appendChild(tierRow(report.index));
  return card;
}

/* A wordless position strip: the reporting range, the qualification floor, the band
 * and the point estimate. Readable without any of the numbers above it. */
function scaleStrip(index, ci) {
  const lo = FLOOR_INDEX;
  const hi = CEILING_INDEX;
  const span = Math.max(1, hi - lo);
  const at = (v) => ((clamp(v, lo, hi) - lo) / span) * 100;
  const wrap = h('div', {
    role: 'img',
    'aria-label': tx('result.scale', 'Position on the reporting range') + ': ' + index,
    style: 'position:relative;height:34px;border-radius:999px;background:linear-gradient(90deg,' +
      'var(--bg-elev-2,#1d1f26),var(--accent-dim,#33487f));border:1px solid var(--line,#2a2c34)'
  });
  if (ci) {
    wrap.appendChild(h('div', {
      style: 'position:absolute;top:6px;bottom:6px;border-radius:999px;' +
        'background:var(--accent-dim,#33487f);opacity:.85;left:' + at(ci.lo).toFixed(2) + '%;' +
        'width:' + Math.max(1.5, at(ci.hi) - at(ci.lo)).toFixed(2) + '%'
    }));
  }
  wrap.appendChild(h('div', {
    style: 'position:absolute;top:-3px;bottom:-3px;width:4px;border-radius:2px;' +
      'background:var(--fg,#e9e9ee);left:calc(' + at(index).toFixed(2) + '% - 2px)'
  }));
  return wrap;
}

function tierRow(index) {
  const tier = safeCall(() => tierFor(index), -1);
  const row = h('div', {
    style: ROW_STYLE + ';justify-content:center',
    role: 'img',
    'aria-label': tx('result.tier', 'Tier') + ' ' + (tier + 1) + ' / 6'
  });
  for (let i = 0; i < 6; i += 1) {
    const on = Number.isFinite(tier) && i <= tier;
    row.appendChild(h('span', {
      style: 'width:' + (on ? 20 : 13) + 'px;height:' + (on ? 20 : 13) + 'px;border-radius:50%;' +
        'display:inline-block;border:2px solid var(--line-strong,#3a3d47);background:' +
        (on ? 'var(--accent,#5b8cff)' : 'transparent')
    }));
  }
  return row;
}

function precisionCard(report) {
  const card = h('section', { style: CARD_STYLE });
  const grid = h('div', {
    style: 'display:grid;gap:var(--sp-4,16px);grid-template-columns:repeat(auto-fit,minmax(180px,1fr))'
  });
  if (Number.isFinite(report.reliability)) {
    grid.appendChild(statBlock(
      tx('result.reliability', 'Reliability'),
      report.reliability.toFixed(2),
      barRow(report.reliability, 1)
    ));
  }
  if (Number.isFinite(report.itemsUsed)) {
    grid.appendChild(statBlock(
      tx('result.items', 'Puzzles used'),
      String(report.itemsUsed),
      pipRow(Math.min(40, report.itemsUsed), 40)
    ));
  }
  if (Number.isFinite(report.se)) {
    grid.appendChild(statBlock(
      tx('result.se', 'Standard error'),
      report.se.toFixed(2),
      barRow(Math.max(0, 1 - Math.min(1, report.se)), 1)
    ));
  }
  if (Number.isFinite(report.medianRtMs)) {
    grid.appendChild(statBlock(
      tx('result.rt', 'Median time per puzzle'),
      Math.round(report.medianRtMs / 100) / 10 + 's',
      null
    ));
  }
  card.appendChild(grid);
  return card;
}

function statBlock(label, value, extra) {
  const box = h('div', { style: 'display:flex;flex-direction:column;gap:6px' });
  box.appendChild(h('div', {
    style: 'font-size:13px;color:var(--fg-mute,#7b7d88)',
    text: label
  }));
  box.appendChild(h('div', {
    style: 'font-family:var(--mono,ui-monospace,monospace);font-size:24px',
    text: value
  }));
  if (extra) box.appendChild(extra);
  return box;
}

function barRow(value, max) {
  const pct = Math.max(0, Math.min(1, (Number(value) || 0) / (max || 1))) * 100;
  const track = h('div', {
    style: 'height:8px;border-radius:999px;background:var(--bg-elev-2,#1d1f26);' +
      'border:1px solid var(--line,#2a2c34);overflow:hidden'
  });
  track.appendChild(h('div', {
    style: 'height:100%;width:' + pct.toFixed(1) + '%;background:var(--accent,#5b8cff)'
  }));
  return track;
}

function pipRow(n, max) {
  const row = h('div', { style: 'display:flex;flex-wrap:wrap;gap:3px' });
  const total = Math.min(max, 40);
  for (let i = 0; i < total; i += 1) {
    row.appendChild(h('span', {
      style: 'width:6px;height:6px;border-radius:50%;display:inline-block;background:' +
        (i < n ? 'var(--accent,#5b8cff)' : 'var(--line,#2a2c34)')
    }));
  }
  return row;
}

function familyCard(report, profile) {
  const byFamily = report.byFamily;
  if (!byFamily || typeof byFamily !== 'object') return null;
  const keys = Object.keys(byFamily);
  if (!keys.length) return null;

  const card = h('section', { style: CARD_STYLE });
  card.appendChild(h('h2', {
    style: 'margin:0;font-size:15px;font-weight:600;color:var(--fg-dim,#a9abb6)',
    text: tx('result.byFamily', 'By puzzle format')
  }));
  const reduced = prefersReducedMotion(profile);
  const list = h('div', { style: 'display:flex;flex-direction:column;gap:var(--sp-3,12px)' });

  for (const key of keys) {
    const stat = byFamily[key] || {};
    const pct = Number.isFinite(stat.pctCorrect)
      ? (stat.pctCorrect > 1 ? stat.pctCorrect / 100 : stat.pctCorrect)
      : null;
    const row = h('div', { style: 'display:flex;align-items:center;gap:var(--sp-3,12px)' });
    row.appendChild(familyThumb(key, reduced));
    const body = h('div', { style: 'flex:1 1 auto;display:flex;flex-direction:column;gap:5px;min-width:0' });
    if (labelsOn()) {
      body.appendChild(h('div', {
        style: 'font-size:13px;color:var(--fg-dim,#a9abb6);overflow:hidden;text-overflow:ellipsis',
        text: tx('family.' + key, key)
      }));
    }
    body.appendChild(barRow(pct === null ? 0 : pct, 1));
    row.appendChild(body);
    const meta = h('div', {
      style: 'font-family:var(--mono,ui-monospace,monospace);font-size:13px;' +
        'color:var(--fg-mute,#7b7d88);text-align:right;min-width:74px',
      text: (pct === null ? '—' : Math.round(pct * 100) + '%') +
        (Number.isFinite(stat.n) ? ' · ' + stat.n : '')
    });
    row.setAttribute('aria-label', key + ': ' +
      (pct === null ? tx('result.noData', 'no data') : Math.round(pct * 100) + '%') +
      (Number.isFinite(stat.n) ? ', ' + stat.n : ''));
    row.appendChild(meta);
    list.appendChild(row);
  }
  card.appendChild(list);
  card.appendChild(note('result.familyNote',
    'Formats are not equally represented: the adaptive test spends its puzzles where ' +
    'they measure you best, so a format with few puzzles says little on its own.'));
  return card;
}

/* Each family is identified by the first frame of its own wordless demonstration,
 * so the breakdown is legible without reading the family names. */
function familyThumb(family, reduced) {
  const box = h('div', {
    'aria-hidden': 'true',
    style: 'width:52px;height:52px;flex:0 0 auto;border-radius:var(--r-sm,8px);' +
      'background:var(--bg-elev-2,#1d1f26);border:1px solid var(--line,#2a2c34);padding:4px'
  });
  let demo = null;
  try { demo = demoFor(family); } catch (err) { demo = null; }
  const frames = demo && Array.isArray(demo.frames) ? demo.frames.filter((f) => f && f.svg) : [];
  if (frames.length) {
    const idx = reduced ? 0 : frames.length - 1;
    mountSvg(box, frames[idx].svg);
  } else {
    mountSvg(box,
      '<svg viewBox="0 0 40 40" width="100%" height="100%" aria-hidden="true">' +
      '<rect x="6" y="6" width="28" height="28" rx="4" fill="none" ' +
      'stroke="var(--stim,#e6e6ea)" stroke-width="3"/></svg>');
  }
  return box;
}

function infoCard(report) {
  const points = report.informationCurve;
  if (!points) return null;
  const clean = points.filter((p) => p && Number.isFinite(p.theta) && Number.isFinite(p.info));
  if (!clean.length) return null;
  const card = h('section', { style: CARD_STYLE });
  card.appendChild(h('h2', {
    style: 'margin:0;font-size:15px;font-weight:600;color:var(--fg-dim,#a9abb6)',
    text: tx('result.infoCurve', 'Where this test measured precisely')
  }));
  card.appendChild(compose(
    () => infoCurve(clean),
    () => localInfoCurve(clean)
  ));
  card.appendChild(note('result.infoNote',
    'The curve is high where the puzzles you saw could tell small differences apart. ' +
    'Where it is low, your band is wider — the test simply had less to go on there.'));
  return card;
}

function localInfoCurve(points) {
  const w = 600;
  const hgt = 160;
  const xs = points.map((p) => p.theta);
  const ys = points.map((p) => p.info);
  const minX = Math.min.apply(null, xs);
  const maxX = Math.max.apply(null, xs);
  const maxY = Math.max.apply(null, ys) || 1;
  const px = (x) => ((x - minX) / Math.max(1e-6, maxX - minX)) * (w - 20) + 10;
  const py = (y) => hgt - 12 - (y / maxY) * (hgt - 24);
  let d = '';
  points.forEach((p, i) => {
    d += (i === 0 ? 'M' : 'L') + px(p.theta).toFixed(1) + ' ' + py(p.info).toFixed(1) + ' ';
  });
  const box = h('div', { style: 'width:100%' });
  mountSvg(box,
    '<svg viewBox="0 0 ' + w + ' ' + hgt + '" width="100%" height="' + hgt + '" ' +
    'preserveAspectRatio="none" aria-hidden="true">' +
    '<path d="' + d.trim() + '" fill="none" stroke="var(--accent,#5b8cff)" stroke-width="3"/>' +
    '</svg>');
  return box;
}

function honestyCard() {
  const card = h('section', {
    style: CARD_STYLE + ';border-color:var(--line-strong,#3a3d47)'
  });
  card.appendChild(h('h2', {
    style: 'margin:0;font-size:15px;font-weight:600;color:var(--fg-dim,#a9abb6)',
    text: tx('result.honestyTitle', 'What this number is, and is not')
  }));
  const body = h('div', {
    style: 'display:flex;flex-direction:column;gap:var(--sp-3,12px);' +
      'font-size:14px;line-height:1.6;color:var(--fg-dim,#a9abb6)'
  });
  body.appendChild(h('p', {
    style: 'margin:0',
    text: tx('result.honesty1',
      'This is one sitting. Every measurement carries error, and yours is shown as the ' +
      'band, not the single number. The band is the honest answer; the number is only ' +
      'its middle.')
  }));
  body.appendChild(h('p', {
    style: 'margin:0',
    text: tx('result.honesty2',
      'Sleep, illness, stress, screen size and simple luck on which puzzles came up all ' +
      'move a result by a few points. A second sitting would very likely land somewhere ' +
      'else inside the same band.')
  }));
  body.appendChild(h('p', {
    style: 'margin:0',
    text: tx('result.honesty3',
      'The index describes how you did on abstract pattern puzzles today. It is not a ' +
      'measure of your worth, your character, or what you can become.')
  }));
  card.appendChild(body);
  return card;
}

function actionsCard(ctx, profile) {
  const card = h('section', { style: CARD_STYLE });
  const row = h('div', { style: ROW_STYLE });
  if (profile.status === 'qualified') {
    row.appendChild(actionButton({
      iconKey: 'train', glyph: GLYPH.train, labelKey: ['result.train', 'train'],
      fallbackLabel: 'Start training', variant: 'primary', large: true,
      onClick: () => navigate(ctx, '#/train')
    }));
    row.appendChild(actionButton({
      iconKey: 'progress', glyph: GLYPH.progress, labelKey: ['result.progress', 'progress'],
      fallbackLabel: 'Progress', onClick: () => navigate(ctx, '#/progress')
    }));
  }
  row.appendChild(actionButton({
    iconKey: 'home', glyph: GLYPH.home, labelKey: ['result.home', 'home'],
    fallbackLabel: 'Home', onClick: () => navigate(ctx, '#/')
  }));
  card.appendChild(row);
  if (profile.status === 'qualified') {
    card.appendChild(note('result.trainNote',
      'Training starts at the tier your band supports and adapts from there.'));
  }
  return card;
}

/* ------------------------------------------------------------------- helpers */

function readCachedResult() {
  try {
    const raw = window.sessionStorage.getItem(LAST_RESULT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch (err) {
    return null;
  }
}

function lastAssessment(profile) {
  const list = profile && Array.isArray(profile.assessments) ? profile.assessments : [];
  return list.length ? list[list.length - 1] : null;
}

function firstNumber(a, b, c) {
  if (typeof a === 'number' && Number.isFinite(a)) return a;
  if (typeof b === 'number' && Number.isFinite(b)) return b;
  if (typeof c === 'number' && Number.isFinite(c)) return c;
  return null;
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function bandColor(index) {
  const band = safeCall(() => bandFor(index), null);
  if (band && typeof band.color === 'string' && band.color.length) {
    return band.color.indexOf('--') === 0
      ? 'var(' + band.color + ',var(--fg,#e9e9ee))'
      : band.color;
  }
  return 'var(--fg,#e9e9ee)';
}

function note(key, fallback) {
  return h('p', {
    style: 'margin:0;color:var(--fg-mute,#7b7d88);font-size:13px;line-height:1.55',
    text: tx(key, fallback)
  });
}

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
  } catch (err) { /* component drift must not blank the report */ }
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

function iconEl(key, size, fallbackSvg) {
  const host = h('span', {
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
    node.setAttribute('aria-label', label);
  }
  if (!node.getAttribute('title')) node.setAttribute('title', label);
  return node;
}

function localButton(spec, label) {
  const primary = spec.variant === 'primary';
  const btn = h('button', {
    type: 'button',
    class: 'btn' + (primary ? ' btn-primary' : ''),
    'aria-label': label,
    style: 'display:inline-flex;align-items:center;gap:var(--sp-2,8px);cursor:pointer;' +
      'padding:' + (spec.large ? '14px 24px' : '10px 14px') + ';' +
      'border-radius:var(--r-md,12px);font:inherit;font-size:' + (spec.large ? '17px' : '15px') + ';' +
      'border:1px solid ' + (primary ? 'var(--accent,#5b8cff)' : 'var(--line-strong,#3a3d47)') + ';' +
      'background:' + (primary ? 'var(--accent,#5b8cff)' : 'var(--bg-elev-2,#1d1f26)') + ';' +
      'color:' + (primary ? 'var(--bg,#0e0f13)' : 'var(--fg,#e9e9ee)') + ';'
  });
  btn.appendChild(iconEl(spec.iconKey, spec.large ? 26 : 20, spec.glyph));
  if (labelsOn() && label && !spec.compact) btn.appendChild(h('span', { text: label }));
  if (typeof spec.onClick === 'function') btn.addEventListener('click', spec.onClick);
  return btn;
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

function navigate(ctx, path) {
  const target = path.charAt(0) === '#' ? path : '#' + (path.charAt(0) === '/' ? path : '/' + path);
  if (ctx && typeof ctx.go === 'function') {
    try { ctx.go(target); return; } catch (err) { /* fall through */ }
  }
  try { routerGo(target); return; } catch (err) { /* fall through */ }
  window.location.hash = target;
}
