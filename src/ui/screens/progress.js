/**
 * Screen: progress. The analytics view — index history, the six-factor radar against
 * this tier's targets, per-drill statistics, XP, streak, levels and marks, plus an
 * honest note about what training gains do and do not demonstrate.
 */

import { mountSvg, button, sparkline, radar } from '../components.js';
import { icon } from '../icons.js';
import { t, labelsEnabled } from '../i18n.js';
import { go as routerGo } from '../router.js';
import { DRILLS, LEVELS, factorTargets, progressSummary } from '../../train/curriculum.js';
import { tierFor } from '../../core/scale.js';

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
  'padding:var(--sp-5,20px);max-width:960px;margin:0 auto;width:100%;' +
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
  map: '<svg viewBox="0 0 24 24" width="100%" height="100%" aria-hidden="true">' +
    '<circle cx="5" cy="12" r="2.6" fill="currentColor"/>' +
    '<circle cx="12" cy="12" r="2.6" fill="currentColor"/>' +
    '<circle cx="19" cy="12" r="2.6" fill="currentColor"/>' +
    '<rect x="5" y="11" width="14" height="2" fill="currentColor" opacity=".5"/></svg>',
  retest: '<svg viewBox="0 0 24 24" width="100%" height="100%" aria-hidden="true">' +
    '<path d="M12 3 A9 9 0 1 1 4.2 16.5" fill="none" stroke="currentColor" stroke-width="2" ' +
    'stroke-linecap="round"/><circle cx="12" cy="3" r="2.4" fill="currentColor"/></svg>'
};

let cleanup = [];

export function render(ctx) {
  destroy();
  const profile = (ctx && ctx.profile) || {};
  const root = h('main', { class: 'screen screen-progress', style: SCREEN_STYLE });

  if (profile.status === 'eliminated') {
    navigate(ctx, '#/eliminated');
    return root;
  }
  if (profile.status !== 'qualified') {
    navigate(ctx, '#/');
    return root;
  }

  const tier = resolveTier(profile);
  root.appendChild(headlineCard(profile));
  root.appendChild(historyCard(profile));
  root.appendChild(factorCard(profile, tier));
  const drills = drillCard(profile);
  if (drills) root.appendChild(drills);
  root.appendChild(honestyCard());
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

/* -------------------------------------------------------------------- cards */

function headlineCard(profile) {
  const card = h('section', { style: CARD_STYLE });
  const totals = levelTotals(profile);
  const grid = h('div', {
    style: 'display:grid;gap:var(--sp-4,16px);grid-template-columns:repeat(auto-fit,minmax(140px,1fr))'
  });
  grid.appendChild(stat(tx(['progress.xp', 'xp'], 'Experience'),
    String(Math.max(0, Math.round(num(profile.xp, 0))))));
  grid.appendChild(stat(tx('progress.levels', 'Levels passed'),
    totals.passed + ' / ' + totals.total, barRow(totals.total ? totals.passed / totals.total : 0)));
  grid.appendChild(stat(tx(['progress.stars', 'stars'], 'Marks earned'),
    totals.stars + ' / ' + totals.maxStars,
    barRow(totals.maxStars ? totals.stars / totals.maxStars : 0)));
  grid.appendChild(stat(tx(['progress.streak', 'streak'], 'Day streak'),
    String(Math.max(0, Math.floor(num(profile.streak && profile.streak.days, 0)))),
    streakPips(profile)));
  card.appendChild(grid);
  return card;
}

function stat(label, value, extra) {
  const box = h('div', { style: 'display:flex;flex-direction:column;gap:6px' });
  box.appendChild(h('div', {
    style: 'font-size:13px;color:var(--fg-mute,#7b7d88)', text: label
  }));
  box.appendChild(h('div', {
    style: 'font-family:var(--mono,ui-monospace,monospace);font-size:24px', text: value
  }));
  if (extra) box.appendChild(extra);
  return box;
}

function streakPips(profile) {
  const days = Math.max(0, Math.floor(num(profile.streak && profile.streak.days, 0)));
  const row = h('div', { style: 'display:flex;gap:4px', 'aria-hidden': 'true' });
  for (let i = 0; i < 7; i += 1) {
    row.appendChild(h('span', {
      style: 'width:12px;height:12px;border-radius:3px;display:inline-block;' +
        'border:2px solid var(--line-strong,#3a3d47);background:' +
        (i < Math.min(7, days) ? 'var(--good,#43c08a)' : 'transparent')
    }));
  }
  return row;
}

function historyCard(profile) {
  const card = h('section', { style: CARD_STYLE });
  card.appendChild(h('h2', {
    style: 'margin:0;font-size:15px;font-weight:600;color:var(--fg-dim,#a9abb6)',
    text: tx('progress.history', 'Measured index over time')
  }));
  const list = Array.isArray(profile.assessments) ? profile.assessments : [];
  const values = list.map((a) => num(a && a.index, null)).filter((v) => v !== null);

  if (!values.length) {
    card.appendChild(h('p', {
      style: 'margin:0;font-size:14px;color:var(--fg-mute,#7b7d88)',
      text: tx('progress.noHistory', 'No measurement recorded yet.')
    }));
    return card;
  }

  card.appendChild(compose(
    () => sparkline(values),
    () => localSparkline(values)
  ));

  const row = h('div', { style: ROW_STYLE });
  const first = values[0];
  const latest = values[values.length - 1];
  row.appendChild(h('span', {
    style: 'font-family:var(--mono,ui-monospace,monospace);font-size:20px', text: String(latest)
  }));
  if (values.length > 1) {
    const delta = latest - first;
    row.appendChild(h('span', {
      style: 'font-family:var(--mono,ui-monospace,monospace);font-size:14px;color:' +
        (delta >= 0 ? 'var(--good,#43c08a)' : 'var(--warn,#d9a441)'),
      text: (delta >= 0 ? '+' : '') + delta
    }));
  }
  const peak = num(profile.peakIndex, Math.max.apply(null, values));
  row.appendChild(h('span', {
    style: 'font-family:var(--mono,ui-monospace,monospace);font-size:13px;color:var(--fg-mute,#7b7d88)',
    text: tx('progress.peak', 'peak') + ' ' + peak
  }));
  card.appendChild(row);

  const lastCi = lastCiOf(list);
  if (lastCi) {
    row.appendChild(h('span', {
      style: 'font-family:var(--mono,ui-monospace,monospace);font-size:13px;color:var(--fg-mute,#7b7d88)',
      text: lastCi.lo + ' – ' + lastCi.hi
    }));
    card.appendChild(h('p', {
      style: 'margin:0;font-size:13px;color:var(--fg-mute,#7b7d88);line-height:1.55',
      text: tx('progress.ciNote',
        'A move smaller than the latest confidence band is not evidence that anything ' +
        'about you has changed.')
    }));
  }
  return card;
}

function factorCard(profile, tier) {
  const card = h('section', { style: CARD_STYLE });
  card.appendChild(h('h2', {
    style: 'margin:0;font-size:15px;font-weight:600;color:var(--fg-dim,#a9abb6)',
    text: tx('progress.factors', 'Six factors against this tier')
  }));

  const scores = {};
  for (const factor of FACTORS) scores[factor] = num((profile.factorScores || {})[factor], 0);
  const targetsRaw = safeCall(() => factorTargets(tier), null) || {};
  const targets = {};
  for (const factor of FACTORS) targets[factor] = num(targetsRaw[factor], null);

  card.appendChild(compose(
    () => radar({ factorScores: scores, targets }),
    () => localRadar(scores, targets)
  ));

  const list = h('div', { style: 'display:flex;flex-direction:column;gap:10px' });
  const scale = factorScale(scores, targets);
  for (const factor of FACTORS) {
    list.appendChild(factorRow(factor, scores[factor], targets[factor], scale));
  }
  card.appendChild(list);

  const ranked = rankFactors(scores, targets);
  if (ranked.best && ranked.worst && ranked.best !== ranked.worst) {
    const summary = h('div', { style: ROW_STYLE });
    summary.appendChild(factorChip(ranked.best, tx('progress.strongest', 'strongest')));
    summary.appendChild(factorChip(ranked.worst, tx('progress.weakest', 'needs most work')));
    card.appendChild(summary);
  }
  return card;
}

function factorRow(factor, value, target, scale) {
  const color = FACTOR_COLORS[factor];
  const pct = Math.max(0, Math.min(1, num(value, 0) / scale)) * 100;
  const tPct = target === null ? null : Math.max(0, Math.min(1, target / scale)) * 100;
  const row = h('div', { style: 'display:flex;align-items:center;gap:var(--sp-3,12px)' });

  const mark = h('span', { 'aria-hidden': 'true', style: 'width:20px;height:20px;flex:0 0 auto' });
  mountSvg(mark, factorGlyphSvg(factor, color));
  row.appendChild(mark);

  const body = h('div', { style: 'flex:1 1 auto;display:flex;flex-direction:column;gap:4px;min-width:0' });
  if (labelsOn()) {
    body.appendChild(h('div', {
      style: 'font-size:12px;color:var(--fg-mute,#7b7d88)',
      text: tx('factor.' + factor, factor)
    }));
  }
  const track = h('div', {
    style: 'position:relative;height:10px;border-radius:999px;overflow:visible;' +
      'background:var(--bg-elev-2,#1d1f26);border:1px solid var(--line,#2a2c34)'
  });
  track.appendChild(h('div', {
    style: 'height:100%;width:' + pct.toFixed(1) + '%;background:' + color + ';border-radius:999px'
  }));
  if (tPct !== null) {
    track.appendChild(h('div', {
      'aria-hidden': 'true',
      style: 'position:absolute;top:-4px;bottom:-4px;width:3px;background:var(--fg,#e9e9ee);' +
        'left:calc(' + tPct.toFixed(1) + '% - 1.5px);border-radius:2px'
    }));
  }
  body.appendChild(track);
  row.appendChild(body);

  const readout = h('span', {
    style: 'font-family:var(--mono,ui-monospace,monospace);font-size:12px;' +
      'color:var(--fg-mute,#7b7d88);min-width:72px;text-align:right',
    text: round2(value) + (target === null ? '' : ' / ' + round2(target))
  });
  row.appendChild(readout);
  row.setAttribute('role', 'img');
  row.setAttribute('aria-label', tx('factor.' + factor, factor) + ': ' + round2(value) +
    (target === null ? '' : ', ' + tx('progress.target', 'target') + ' ' + round2(target)));
  return row;
}

function factorChip(factor, caption) {
  const chip = h('div', {
    style: 'display:flex;align-items:center;gap:8px;padding:8px 12px;' +
      'border-radius:999px;border:1px solid ' + FACTOR_COLORS[factor] + ';'
  });
  const mark = h('span', { 'aria-hidden': 'true', style: 'width:16px;height:16px;display:block' });
  mountSvg(mark, factorGlyphSvg(factor, FACTOR_COLORS[factor]));
  chip.appendChild(mark);
  chip.appendChild(h('span', {
    style: 'font-size:12px;color:var(--fg-dim,#a9abb6)',
    text: tx('factor.' + factor, factor) + ' · ' + caption
  }));
  return chip;
}

function drillCard(profile) {
  const stats = (profile && profile.drillStats) || {};
  const ids = Object.keys(stats);
  if (!ids.length) return null;
  const card = h('section', { style: CARD_STYLE });
  card.appendChild(h('h2', {
    style: 'margin:0;font-size:15px;font-weight:600;color:var(--fg-dim,#a9abb6)',
    text: tx('progress.drills', 'By drill')
  }));
  const defs = new Map();
  if (Array.isArray(DRILLS)) {
    for (const def of DRILLS) {
      if (def && def.id) defs.set(def.id, def);
    }
  }
  const list = h('div', { style: 'display:flex;flex-direction:column;gap:10px' });
  ids.sort();
  for (const id of ids) {
    const s = stats[id] || {};
    const def = defs.get(id) || {};
    const color = FACTOR_COLORS[def.factor] || 'var(--accent,#5b8cff)';
    const accuracy = clamp01(num(s.accuracy, 0));
    const row = h('div', { style: 'display:flex;align-items:center;gap:var(--sp-3,12px)' });
    const mark = h('span', { 'aria-hidden': 'true', style: 'width:18px;height:18px;flex:0 0 auto' });
    mountSvg(mark, factorGlyphSvg(def.factor, color));
    row.appendChild(mark);
    const body = h('div', { style: 'flex:1 1 auto;display:flex;flex-direction:column;gap:4px;min-width:0' });
    if (labelsOn()) {
      body.appendChild(h('div', {
        style: 'font-size:12px;color:var(--fg-mute,#7b7d88);overflow:hidden;text-overflow:ellipsis',
        text: tx('drillName.' + id, id)
      }));
    }
    body.appendChild(barRow(accuracy, color));
    row.appendChild(body);
    row.appendChild(h('span', {
      style: 'font-family:var(--mono,ui-monospace,monospace);font-size:12px;' +
        'color:var(--fg-mute,#7b7d88);min-width:132px;text-align:right',
      text: Math.round(accuracy * 100) + '% · ' +
        Math.max(0, Math.floor(num(s.totalTrials, 0))) + ' · ' +
        tx(['progress.best', 'best'], 'best') + ' ' + round2(num(s.bestLevel, 0)) +
        (num(s.msPerTrial, 0) > 0 ? ' · ' + Math.round(num(s.msPerTrial, 0)) + 'ms' : '')
    }));
    row.setAttribute('role', 'img');
    row.setAttribute('aria-label', id + ': ' + Math.round(accuracy * 100) + '%, ' +
      Math.max(0, Math.floor(num(s.sessions, 0))) + ' ' + tx('progress.sessions', 'sessions'));
    list.appendChild(row);
  }
  card.appendChild(list);
  return card;
}

function honestyCard() {
  const card = h('section', { style: CARD_STYLE + ';border-color:var(--line-strong,#3a3d47)' });
  card.appendChild(h('h2', {
    style: 'margin:0;font-size:15px;font-weight:600;color:var(--fg-dim,#a9abb6)',
    text: tx('progress.honestyTitle', 'How to read these numbers')
  }));
  const body = h('div', {
    style: 'display:flex;flex-direction:column;gap:var(--sp-3,12px);font-size:14px;' +
      'line-height:1.6;color:var(--fg-dim,#a9abb6)'
  });
  body.appendChild(h('p', {
    style: 'margin:0',
    text: tx('progress.honesty1',
      'Gains show up first on the tasks you trained. That part is expected and well ' +
      'established: practice makes you better at the practised thing.')
  }));
  body.appendChild(h('p', {
    style: 'margin:0',
    text: tx('progress.honesty2',
      'Whether that carries over to reasoning in general is the open question. The ' +
      're-test is the only line here that tries to measure carry-over, because it uses ' +
      'puzzles you have not been drilled on.')
  }));
  body.appendChild(h('p', {
    style: 'margin:0',
    text: tx('progress.honesty3',
      'Treat a rise in drill scores as progress on the drills, and wait for the re-test ' +
      'band to move before concluding anything more.')
  }));
  card.appendChild(body);
  return card;
}

function footerRow(ctx) {
  const row = h('nav', { style: ROW_STYLE + ';justify-content:center' });
  row.appendChild(actionButton({
    iconKey: 'map', glyph: GLYPH.map, labelKey: ['nav.train', 'train'],
    fallbackLabel: 'Level map', onClick: () => navigate(ctx, '#/train')
  }));
  row.appendChild(actionButton({
    iconKey: 'retest', glyph: GLYPH.retest, labelKey: ['progress.retest', 'test'],
    fallbackLabel: 'Measure again', onClick: () => navigate(ctx, '#/test')
  }));
  row.appendChild(actionButton({
    iconKey: 'home', glyph: GLYPH.home, labelKey: ['nav.home', 'home'],
    fallbackLabel: 'Home', onClick: () => navigate(ctx, '#/')
  }));
  return row;
}

/* ------------------------------------------------------------------- helpers */

function levelTotals(profile) {
  const levels = Array.isArray(LEVELS) ? LEVELS.filter((l) => l && l.id) : [];
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
  const out = { passed, total: levels.length, stars, maxStars };
  const ext = safeCall(() => progressSummary(profile), null);
  if (ext && typeof ext === 'object') {
    if (Number.isFinite(ext.levelsPassed)) out.passed = ext.levelsPassed;
    if (Number.isFinite(ext.stars)) out.stars = ext.stars;
  }
  return out;
}

function lastCiOf(list) {
  for (let i = list.length - 1; i >= 0; i -= 1) {
    const ci = list[i] && list[i].ci;
    if (ci && Number.isFinite(ci.lo) && Number.isFinite(ci.hi)) return ci;
  }
  return null;
}

function resolveTier(profile) {
  const index = num(profile.currentIndex, null);
  if (index !== null) {
    const fromScale = safeCall(() => tierFor(index), null);
    if (Number.isFinite(fromScale) && fromScale >= 0) return fromScale;
  }
  const stored = num(profile.tier, 0);
  return stored >= 0 ? stored : 0;
}

/* Factor scores and targets share an uncontracted range; the axis is scaled to the
 * largest value actually present so neither convention is misdrawn. */
function factorScale(scores, targets) {
  let max = 1;
  for (const factor of FACTORS) {
    max = Math.max(max, num(scores[factor], 0), num(targets[factor], 0));
  }
  if (max <= 1) return 1;
  if (max <= 100) return 100;
  return max;
}

function rankFactors(scores, targets) {
  const scale = factorScale(scores, targets);
  let best = null;
  let worst = null;
  let bestV = -Infinity;
  let worstV = Infinity;
  for (const factor of FACTORS) {
    const target = num(targets[factor], null);
    const value = num(scores[factor], 0);
    const rel = target && target > 0 ? value / target : value / scale;
    if (rel > bestV) { bestV = rel; best = factor; }
    if (rel < worstV) { worstV = rel; worst = factor; }
  }
  return { best, worst };
}

function barRow(value, color) {
  const pct = Math.max(0, Math.min(1, Number(value) || 0)) * 100;
  const track = h('div', {
    style: 'height:8px;border-radius:999px;background:var(--bg-elev-2,#1d1f26);' +
      'border:1px solid var(--line,#2a2c34);overflow:hidden'
  });
  track.appendChild(h('div', {
    style: 'height:100%;width:' + pct.toFixed(1) + '%;background:' +
      (color || 'var(--accent,#5b8cff)')
  }));
  return track;
}

function localSparkline(values) {
  const w = 600;
  const hgt = 90;
  const min = Math.min.apply(null, values);
  const max = Math.max.apply(null, values);
  const span = Math.max(1, max - min);
  const step = values.length > 1 ? (w - 20) / (values.length - 1) : 0;
  let d = '';
  let dots = '';
  values.forEach((v, i) => {
    const x = 10 + i * step;
    const y = hgt - 10 - ((v - min) / span) * (hgt - 20);
    d += (i === 0 ? 'M' : 'L') + x.toFixed(1) + ' ' + y.toFixed(1) + ' ';
    dots += '<circle cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) +
      '" r="4" fill="var(--accent,#5b8cff)"/>';
  });
  const box = h('div', {
    role: 'img',
    'aria-label': values.join(', '),
    style: 'width:100%'
  });
  mountSvg(box,
    '<svg viewBox="0 0 ' + w + ' ' + hgt + '" width="100%" height="' + hgt + '" ' +
    'preserveAspectRatio="none">' +
    '<path d="' + d.trim() + '" fill="none" stroke="var(--accent,#5b8cff)" stroke-width="3"/>' +
    dots + '</svg>');
  return box;
}

function localRadar(scores, targets) {
  const size = 240;
  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - 28;
  const scale = factorScale(scores, targets);
  let web = '';
  for (const ring of [0.25, 0.5, 0.75, 1]) {
    web += '<polygon points="' + polygonPoints(cx, cy, r * ring, 6) +
      '" fill="none" stroke="var(--line,#2a2c34)" stroke-width="1"/>';
  }
  const point = (v, i) => {
    const a = (Math.PI * 2 * i) / 6 - Math.PI / 2;
    const k = Math.max(0, Math.min(1, v / scale));
    return (cx + Math.cos(a) * r * k).toFixed(1) + ',' + (cy + Math.sin(a) * r * k).toFixed(1);
  };
  const valuePts = FACTORS.map((f, i) => point(num(scores[f], 0), i)).join(' ');
  const hasTargets = FACTORS.some((f) => Number.isFinite(targets[f]));
  const targetPts = hasTargets
    ? FACTORS.map((f, i) => point(num(targets[f], 0), i)).join(' ')
    : null;
  const box = h('div', {
    role: 'img',
    'aria-label': FACTORS.map((f) => f + ' ' + round2(scores[f])).join(', '),
    style: 'width:100%;max-width:280px;margin:0 auto'
  });
  mountSvg(box,
    '<svg viewBox="0 0 ' + size + ' ' + size + '" width="100%" height="100%">' + web +
    (targetPts
      ? '<polygon points="' + targetPts + '" fill="none" stroke="var(--fg-mute,#7b7d88)" ' +
        'stroke-width="2" stroke-dasharray="5 4"/>'
      : '') +
    '<polygon points="' + valuePts + '" fill="var(--accent-dim,#33487f)" fill-opacity="0.5" ' +
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

function factorGlyphSvg(factor, color) {
  const body = {
    induction: '<circle cx="16" cy="16" r="10"/>',
    spatial: '<rect x="6" y="6" width="20" height="20"/>',
    workingMemory: '<path d="M16 5 L25.5 10.5 L25.5 21.5 L16 27 L6.5 21.5 L6.5 10.5 Z"/>',
    relational: '<path d="M16 5 L27 26 L5 26 Z"/>',
    speed: '<path d="M16 4 L28 16 L16 28 L4 16 Z"/>',
    flexibility: '<path d="M16 4 L27 12 L23 25 L9 25 L5 12 Z"/>'
  }[factor] || '<circle cx="16" cy="16" r="9"/>';
  return '<svg viewBox="0 0 32 32" width="100%" height="100%" aria-hidden="true" ' +
    'fill="none" stroke="' + (color || 'currentColor') + '" stroke-width="2.6">' + body + '</svg>';
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
  } catch (err) { /* component drift must not blank the analytics */ }
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

function clamp01(v) {
  const n = num(v, 0);
  if (n > 1 && n <= 100) return n / 100;
  return Math.max(0, Math.min(1, n));
}

function round2(v) {
  const n = num(v, 0);
  return Math.round(n * 100) / 100;
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
