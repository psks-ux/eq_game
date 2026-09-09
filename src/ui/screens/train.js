/**
 * Screen: train. The level map — every level as a node on a per-tier path, carrying
 * its factor, its lock state and the marks earned, plus the six-factor radar and the
 * overall progress meter. Unlock requirements are shown as nodes and marks, not prose.
 */

import { mountSvg, button, radar } from '../components.js';
import { icon } from '../icons.js';
import { t, labelsEnabled } from '../i18n.js';
import { go as routerGo } from '../router.js';
import {
  LEVELS, levelsForTier, levelById, unlockedLevels, nextLevel, progressSummary
} from '../../train/curriculum.js';

const FACTORS = ['induction', 'spatial', 'workingMemory', 'relational', 'speed', 'flexibility'];

const FACTOR_COLORS = {
  induction: '#0072B2',
  spatial: '#E69F00',
  workingMemory: '#009E73',
  relational: '#CC79A7',
  speed: '#56B4E9',
  flexibility: '#D55E00'
};

const SCREEN_STYLE =
  'display:flex;flex-direction:column;gap:var(--sp-5,20px);' +
  'padding:var(--sp-5,20px);max-width:980px;margin:0 auto;width:100%;' +
  'box-sizing:border-box;color:var(--fg,#e9e9ee);font-family:var(--font,system-ui,sans-serif)';

const CARD_STYLE =
  'background:var(--bg-elev,#16171c);border:1px solid var(--line,#2a2c34);' +
  'border-radius:var(--r-lg,16px);padding:var(--sp-4,16px);' +
  'display:flex;flex-direction:column;gap:var(--sp-3,12px)';

const ROW_STYLE = 'display:flex;flex-wrap:wrap;gap:var(--sp-3,12px);align-items:center';

const GLYPH = {
  home: '<svg viewBox="0 0 24 24" width="100%" height="100%" aria-hidden="true">' +
    '<rect x="4" y="4" width="16" height="16" rx="3" fill="none" stroke="currentColor" ' +
    'stroke-width="2"/><rect x="9" y="9" width="6" height="6" fill="currentColor"/></svg>',
  progress: '<svg viewBox="0 0 24 24" width="100%" height="100%" aria-hidden="true">' +
    '<rect x="3" y="14" width="4" height="7" fill="currentColor"/>' +
    '<rect x="10" y="9" width="4" height="12" fill="currentColor"/>' +
    '<rect x="17" y="4" width="4" height="17" fill="currentColor"/></svg>',
  play: '<svg viewBox="0 0 24 24" width="100%" height="100%" aria-hidden="true">' +
    '<path d="M7 4 L20 12 L7 20 Z" fill="currentColor"/></svg>'
};

/* A padlock built only from allowed primitives: a rounded square body and an arc. */
const LOCK_SVG =
  '<svg viewBox="0 0 32 32" width="100%" height="100%" aria-hidden="true">' +
  '<path d="M10 15 V11 a6 6 0 0 1 12 0 v4" fill="none" stroke="currentColor" stroke-width="3"/>' +
  '<rect x="7" y="15" width="18" height="13" rx="3" fill="currentColor"/></svg>';

let cleanup = [];

export function render(ctx) {
  destroy();
  const profile = (ctx && ctx.profile) || {};
  const root = h('main', { class: 'screen screen-train', style: SCREEN_STYLE });

  /* The gate is the product rule; the map is never reachable from an ungated state. */
  if (profile.status === 'eliminated') {
    navigate(ctx, '#/eliminated');
    return root;
  }
  if (profile.status !== 'qualified') {
    navigate(ctx, '#/');
    return root;
  }

  const levels = allLevels();
  const unlocked = unlockedSet(profile, levels);
  const next = safeCall(() => nextLevel(profile), null);
  const summary = summarize(profile, levels, unlocked);

  root.appendChild(topCard(ctx, profile, summary, next));
  root.appendChild(radarCard(profile));

  const tiers = groupByTier(levels);
  for (const tier of tiers) {
    root.appendChild(tierSection(ctx, profile, tier, unlocked, next));
  }

  root.appendChild(footerRow(ctx));
  return root;
}

export function destroy() {
  const fns = cleanup;
  cleanup = [];
  for (const fn of fns) {
    try { fn(); } catch (err) { /* teardown must never throw */ }
  }
}

/* --------------------------------------------------------------------- data */

function allLevels() {
  const list = Array.isArray(LEVELS) ? LEVELS.filter((l) => l && l.id) : [];
  return list.slice().sort((a, b) => {
    const ta = num(a.tier, 0);
    const tb = num(b.tier, 0);
    if (ta !== tb) return ta - tb;
    return num(a.order, 0) - num(b.order, 0);
  });
}

function groupByTier(levels) {
  const tiers = [];
  const seen = new Map();
  for (const level of levels) {
    const tier = num(level.tier, 0);
    if (!seen.has(tier)) {
      seen.set(tier, { tier, levels: [] });
      tiers.push(seen.get(tier));
    }
    seen.get(tier).levels.push(level);
  }
  /* Prefer the curriculum's own ordering per tier when it offers one. */
  for (const group of tiers) {
    const own = safeCall(() => levelsForTier(group.tier), null);
    if (Array.isArray(own) && own.length === group.levels.length) {
      const ordered = own.map((l) => (l && l.id ? levelById(l.id) || l : null)).filter(Boolean);
      if (ordered.length === group.levels.length) group.levels = ordered;
    }
  }
  tiers.sort((a, b) => a.tier - b.tier);
  return tiers;
}

function unlockedSet(profile, levels) {
  const set = new Set();
  const fromCurriculum = safeCall(() => unlockedLevels(profile), null);
  if (Array.isArray(fromCurriculum)) {
    for (const entry of fromCurriculum) {
      if (typeof entry === 'string') set.add(entry);
      else if (entry && typeof entry.id === 'string') set.add(entry.id);
    }
  }
  const stored = (profile && profile.levels) || {};
  for (const level of levels) {
    const rec = stored[level.id];
    if (rec && rec.unlocked === true) set.add(level.id);
  }
  if (!set.size && levels.length) set.add(levels[0].id);
  return set;
}

function summarize(profile, levels, unlocked) {
  const stored = (profile && profile.levels) || {};
  let passed = 0;
  let stars = 0;
  let maxStars = 0;
  for (const level of levels) {
    const rec = stored[level.id] || {};
    const earned = Math.max(0, Math.floor(num(rec.stars, 0)));
    const possible = Array.isArray(level.stars) && level.stars.length ? level.stars.length : 3;
    stars += Math.min(earned, possible);
    maxStars += possible;
    if (earned > 0) passed += 1;
  }
  const local = {
    passed,
    total: levels.length,
    stars,
    maxStars,
    unlocked: unlocked.size,
    xp: Math.max(0, Math.floor(num(profile.xp, 0)))
  };
  const ext = safeCall(() => progressSummary(profile), null);
  if (ext && typeof ext === 'object' && Number.isFinite(ext.percent)) {
    local.percent = Math.max(0, Math.min(1, ext.percent > 1 ? ext.percent / 100 : ext.percent));
  } else {
    local.percent = local.maxStars > 0 ? local.stars / local.maxStars : 0;
  }
  return local;
}

/* -------------------------------------------------------------------- cards */

function topCard(ctx, profile, summary, next) {
  const card = h('section', { style: CARD_STYLE });
  const head = h('div', { style: 'display:flex;align-items:center;gap:var(--sp-3,12px);flex-wrap:wrap' });
  head.appendChild(meterEl(summary.percent,
    tx('train.progress', 'Overall progress') + ': ' +
    summary.stars + ' / ' + summary.maxStars));
  head.appendChild(h('span', {
    style: 'font-family:var(--mono,ui-monospace,monospace);font-size:13px;color:var(--fg-mute,#7b7d88)',
    text: summary.passed + '/' + summary.total
  }));
  card.appendChild(head);

  if (next && next.id) {
    const row = h('div', { style: ROW_STYLE });
    const rec = ((profile && profile.levels) || {})[next.id] || {};
    row.appendChild(levelNodeButton(ctx, next, true, Math.max(0, Math.floor(num(rec.stars, 0))), true));
    row.appendChild(actionButton({
      iconKey: 'play', glyph: GLYPH.play, labelKey: ['train.continue', 'continue'],
      fallbackLabel: 'Continue', variant: 'primary',
      onClick: () => openLevel(ctx, next.id)
    }));
    card.appendChild(row);
  }
  return card;
}

function radarCard(profile) {
  const card = h('section', { style: CARD_STYLE });
  const scores = normalizedFactors(profile);
  card.appendChild(compose(
    () => radar({ factorScores: scores }),
    () => localRadar(scores)
  ));
  card.appendChild(factorLegend(scores));
  return card;
}

function factorLegend(scores) {
  const row = h('div', { style: 'display:flex;flex-wrap:wrap;gap:var(--sp-3,12px)' });
  for (const factor of FACTORS) {
    const item = h('div', {
      style: 'display:flex;align-items:center;gap:6px',
      role: 'img',
      'aria-label': factor + ': ' + Math.round(num(scores[factor], 0) * 100) / 100
    });
    const mark = h('span', { style: 'width:16px;height:16px;display:inline-block' });
    mountSvg(mark, factorGlyphSvg(factor, FACTOR_COLORS[factor]));
    item.appendChild(mark);
    if (labelsOn()) {
      item.appendChild(h('span', {
        style: 'font-size:12px;color:var(--fg-mute,#7b7d88)',
        text: tx('factor.' + factor, factor)
      }));
    }
    row.appendChild(item);
  }
  return row;
}

function tierSection(ctx, profile, group, unlocked, next) {
  const section = h('section', { style: CARD_STYLE });
  section.appendChild(tierHeader(group.tier, profile));

  const rail = h('div', {
    style: 'position:relative;display:flex;gap:var(--sp-4,16px);align-items:flex-start;' +
      'overflow-x:auto;padding:var(--sp-3,12px) 2px;scrollbar-width:thin'
  });
  rail.appendChild(h('div', {
    'aria-hidden': 'true',
    style: 'position:absolute;left:0;right:0;top:46px;height:3px;' +
      'background:var(--line,#2a2c34);border-radius:2px'
  }));

  const stored = (profile && profile.levels) || {};
  for (const level of group.levels) {
    const isUnlocked = unlocked.has(level.id);
    const rec = stored[level.id] || {};
    const stars = Math.max(0, Math.floor(num(rec.stars, 0)));
    const isNext = !!(next && next.id === level.id);
    rail.appendChild(levelCell(ctx, level, isUnlocked, stars, isNext));
  }
  section.appendChild(rail);
  return section;
}

function tierHeader(tier, profile) {
  const row = h('div', {
    style: 'display:flex;align-items:center;gap:var(--sp-3,12px)'
  });
  const pips = h('div', {
    role: 'img',
    'aria-label': tx('train.tier', 'Tier') + ' ' + (tier + 1),
    style: 'display:flex;gap:5px;align-items:center'
  });
  for (let i = 0; i <= tier; i += 1) {
    pips.appendChild(h('span', {
      style: 'width:12px;height:12px;border-radius:50%;display:inline-block;' +
        'background:var(--accent,#5b8cff)'
    }));
  }
  row.appendChild(pips);
  if (num(profile.tier, 0) === tier) {
    row.appendChild(h('span', {
      style: 'width:9px;height:9px;border-radius:50%;display:inline-block;' +
        'background:var(--good,#43c08a)',
      role: 'img',
      'aria-label': tx('train.yourTier', 'Your tier')
    }));
  }
  return row;
}

function levelCell(ctx, level, isUnlocked, stars, isNext) {
  const cell = h('div', {
    style: 'display:flex;flex-direction:column;align-items:center;gap:6px;flex:0 0 auto;width:78px'
  });
  cell.appendChild(levelNodeButton(ctx, level, isUnlocked, stars, isNext));
  cell.appendChild(starRow(stars, starCount(level)));
  if (!isUnlocked) cell.appendChild(requirementRow(level));
  else if (labelsOn()) {
    cell.appendChild(h('span', {
      style: 'font-size:11px;color:var(--fg-mute,#7b7d88);font-family:var(--mono,ui-monospace,monospace)',
      text: level.id
    }));
  }
  return cell;
}

function levelNodeButton(ctx, level, isUnlocked, stars, isNext) {
  const color = FACTOR_COLORS[level.factor] || 'var(--accent,#5b8cff)';
  const label = tx(['train.level', 'level'], 'Level') + ' ' + level.id + ' · ' +
    tx('factor.' + level.factor, level.factor || '') + ' · ' +
    (isUnlocked
      ? tx('train.unlocked', 'open') + ', ' + stars + ' ' + tx(['train.marks', 'stars'], 'marks')
      : tx(['train.locked', 'locked'], 'locked'));

  const node = h('button', {
    type: 'button',
    class: 'level-node',
    'data-level-id': level.id,
    'aria-label': label,
    title: label,
    'aria-disabled': isUnlocked ? null : 'true',
    style: 'position:relative;width:62px;height:62px;border-radius:50%;cursor:' +
      (isUnlocked ? 'pointer' : 'not-allowed') + ';' +
      'display:flex;align-items:center;justify-content:center;padding:0;' +
      'background:var(--bg-elev-2,#1d1f26);' +
      'border:3px solid ' + (isUnlocked ? color : 'var(--line,#2a2c34)') + ';' +
      'box-shadow:' + (isNext ? '0 0 0 3px var(--accent-dim,#33487f)' : 'none') + ';' +
      'opacity:' + (isUnlocked ? '1' : '0.62')
  });

  const inner = h('span', { 'aria-hidden': 'true', style: 'width:30px;height:30px;display:block' });
  if (isUnlocked) mountSvg(inner, factorGlyphSvg(level.factor, color));
  else {
    inner.style.color = 'var(--fg-mute,#7b7d88)';
    mountSvg(inner, LOCK_SVG);
  }
  node.appendChild(inner);

  if (isUnlocked) {
    node.addEventListener('click', () => openLevel(ctx, level.id));
  } else {
    /* A locked node stays operable by keyboard but leads nowhere; pressing it marks
     * the requirement instead of navigating. */
    node.addEventListener('click', (ev) => {
      ev.preventDefault();
      node.style.borderColor = 'var(--warn,#d9a441)';
      const timer = setTimeout(() => { node.style.borderColor = 'var(--line,#2a2c34)'; }, 700);
      cleanup.push(() => clearTimeout(timer));
    });
  }
  return node;
}

/* Marks earned, drawn as filled discs against open rings. A five-point star is a
 * culturally loaded glyph, so the reward marker is a plain disc instead. */
function starRow(earned, total) {
  const row = h('div', {
    role: 'img',
    'aria-label': earned + ' / ' + total,
    style: 'display:flex;gap:4px;align-items:center;height:14px'
  });
  for (let i = 0; i < total; i += 1) {
    const on = i < earned;
    row.appendChild(h('span', {
      style: 'width:10px;height:10px;border-radius:50%;display:inline-block;' +
        'border:2px solid ' + (on ? 'var(--good,#43c08a)' : 'var(--line-strong,#3a3d47)') + ';' +
        'background:' + (on ? 'var(--good,#43c08a)' : 'transparent')
    }));
  }
  return row;
}

/* Unlock requirements as icons: one small locked node per prerequisite level, plus a
 * tier pip row for the minimum tier. No sentence to read. */
function requirementRow(level) {
  const unlock = (level && level.unlock) || {};
  const requires = Array.isArray(unlock.requires) ? unlock.requires : [];
  const minTier = num(unlock.minTier, 0);
  const row = h('div', {
    role: 'img',
    'aria-label': tx('train.needs', 'Requires') + ': ' +
      (requires.length ? requires.join(', ') + '. ' : '') +
      tx('train.minTier', 'minimum tier') + ' ' + (minTier + 1),
    style: 'display:flex;flex-wrap:wrap;gap:3px;justify-content:center;align-items:center'
  });
  for (const reqId of requires.slice(0, 3)) {
    const req = safeCall(() => levelById(reqId), null);
    const color = req && FACTOR_COLORS[req.factor] ? FACTOR_COLORS[req.factor] : 'var(--line-strong,#3a3d47)';
    row.appendChild(h('span', {
      style: 'width:11px;height:11px;border-radius:50%;display:inline-block;' +
        'border:2px solid ' + color
    }));
  }
  if (requires.length) {
    row.appendChild(h('span', {
      'aria-hidden': 'true',
      style: 'width:1px;height:11px;background:var(--line-strong,#3a3d47);display:inline-block'
    }));
  }
  for (let i = 0; i <= minTier; i += 1) {
    row.appendChild(h('span', {
      style: 'width:7px;height:7px;border-radius:2px;display:inline-block;' +
        'background:var(--accent-dim,#33487f)'
    }));
  }
  return row;
}

function footerRow(ctx) {
  const row = h('nav', { style: ROW_STYLE + ';justify-content:center' });
  row.appendChild(actionButton({
    iconKey: 'progress', glyph: GLYPH.progress, labelKey: ['nav.progress', 'progress'],
    fallbackLabel: 'Progress', onClick: () => navigate(ctx, '#/progress')
  }));
  row.appendChild(actionButton({
    iconKey: 'home', glyph: GLYPH.home, labelKey: ['nav.home', 'home'],
    fallbackLabel: 'Home', onClick: () => navigate(ctx, '#/')
  }));
  return row;
}

/* ------------------------------------------------------------------- helpers */

function openLevel(ctx, levelId) {
  navigate(ctx, '#/train/' + encodeURIComponent(levelId));
}

function starCount(level) {
  return Array.isArray(level.stars) && level.stars.length ? level.stars.length : 3;
}

function normalizedFactors(profile) {
  const src = (profile && profile.factorScores) || {};
  const out = {};
  for (const factor of FACTORS) out[factor] = num(src[factor], 0);
  return out;
}

function meterEl(value, ariaLabel) {
  const pct = Math.max(0, Math.min(1, num(value, 0))) * 100;
  const track = h('div', {
    role: 'progressbar',
    'aria-valuemin': '0',
    'aria-valuemax': '100',
    'aria-valuenow': String(Math.round(pct)),
    'aria-label': ariaLabel,
    style: 'flex:1 1 200px;height:12px;border-radius:999px;overflow:hidden;' +
      'background:var(--bg-elev-2,#1d1f26);border:1px solid var(--line,#2a2c34)'
  });
  track.appendChild(h('div', {
    style: 'height:100%;width:' + pct.toFixed(1) + '%;background:var(--good,#43c08a)'
  }));
  return track;
}

function localRadar(scores) {
  const size = 220;
  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - 26;
  const values = FACTORS.map((f) => Math.max(0, Math.min(1, normalizeScore(scores[f]))));
  let web = '';
  for (const ring of [0.25, 0.5, 0.75, 1]) {
    web += '<polygon points="' + polygonPoints(cx, cy, r * ring, 6) +
      '" fill="none" stroke="var(--line,#2a2c34)" stroke-width="1"/>';
  }
  const pts = values.map((v, i) => {
    const a = (Math.PI * 2 * i) / 6 - Math.PI / 2;
    return (cx + Math.cos(a) * r * v).toFixed(1) + ',' + (cy + Math.sin(a) * r * v).toFixed(1);
  }).join(' ');
  const box = h('div', {
    role: 'img',
    'aria-label': FACTORS.map((f) => f + ' ' + Math.round(num(scores[f], 0) * 100) / 100).join(', '),
    style: 'width:100%;max-width:260px;margin:0 auto'
  });
  mountSvg(box,
    '<svg viewBox="0 0 ' + size + ' ' + size + '" width="100%" height="100%">' + web +
    '<polygon points="' + pts + '" fill="var(--accent-dim,#33487f)" fill-opacity="0.55" ' +
    'stroke="var(--accent,#5b8cff)" stroke-width="2.5"/></svg>');
  return box;
}

function polygonPoints(cx, cy, r, n) {
  const out = [];
  for (let i = 0; i < n; i += 1) {
    const a = (Math.PI * 2 * i) / n - Math.PI / 2;
    out.push((cx + Math.cos(a) * r).toFixed(1) + ',' + (cy + Math.sin(a) * r).toFixed(1));
  }
  return out.join(' ');
}

/* Factor scores have no contracted range, so the fallback radar accepts either a
 * 0..1 or a 0..100 convention and normalises defensively. */
function normalizeScore(v) {
  const n = num(v, 0);
  if (n <= 1) return n;
  if (n <= 100) return n / 100;
  return 1;
}

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
  } catch (err) { /* component drift must not blank the map */ }
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

function num(v, fallback) {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
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
      'padding:10px 16px;border-radius:var(--r-md,12px);font:inherit;font-size:15px;' +
      'border:1px solid ' + (primary ? 'var(--accent,#5b8cff)' : 'var(--line-strong,#3a3d47)') + ';' +
      'background:' + (primary ? 'var(--accent,#5b8cff)' : 'var(--bg-elev-2,#1d1f26)') + ';' +
      'color:' + (primary ? 'var(--bg,#0e0f13)' : 'var(--fg,#e9e9ee)') + ';'
  });
  btn.appendChild(iconEl(spec.iconKey, 20, spec.glyph));
  if (labelsOn() && label && !spec.compact) btn.appendChild(h('span', { text: label }));
  if (typeof spec.onClick === 'function') btn.addEventListener('click', spec.onClick);
  return btn;
}

function navigate(ctx, path) {
  const target = path.charAt(0) === '#' ? path : '#' + (path.charAt(0) === '/' ? path : '/' + path);
  if (ctx && typeof ctx.go === 'function') {
    try { ctx.go(target); return; } catch (err) { /* fall through */ }
  }
  try { routerGo(target); return; } catch (err) { /* fall through */ }
  window.location.hash = target;
}
