/**
 * Paper-folding item family: a square sheet is folded 1-4 times across real
 * symmetry axes (vertical / horizontal / the two diagonals), punched, and the
 * solver picks the true unfolded hole pattern. All geometry is computed.
 */

import { svgRoot, el } from './svg.js';
import { priorIrtParams } from './calibration.js';

export const family = 'paperFolding';
export const bRange = [-1.0, 5.0];
export const contentGroup = 'spatial';

const GENERATOR_VERSION = 1;

/* ---------------------------------------------------------------- constants */

const EPS = 1e-9;
const TOL = 1e-7;
const KEY_Q = 1e4; // canonical key quantisation (4 decimal places)

const MAX_ATTEMPTS = 50;
const HOLE_CAP = 16; // never render more than this many unfolded holes

const HOLE_R = 0.052; // hole radius in unit-sheet coordinates
const HOLE_MARGIN = HOLE_R + 0.022; // clearance from the folded region boundary
const MIN_HOLE_GAP = 2.45 * HOLE_R; // min centre distance between unfolded holes

const PUNCH_GRID = 14; // candidate lattice for punch positions

/** Fold axes are restricted to these directions (degrees of the axis line). */
const AXIS_DEGS = [0, 45, 90, 135];

/** Abstractness weights (mirrors the intent of rules.js `ruleCost`, 1..4). */
const ABSTRACTNESS = { reflection: 2, ruleChaining: 4, symmetryCompletion: 3 };

/**
 * Distractor-mix presets: the fraction of distractors that may differ from the
 * key in hole COUNT. It is a hard quota, not a preference, because it is the
 * one thing that decides whether counting the holes is a shortcut to the answer.
 */
const MIX_COUNT_CHANGING = {
  easiest: 0.9,
  easy: 0.7,
  mixed: 0.38,
  hard: 0.05
};

/**
 * Salience is derived from the quota with the very formula used to report it,
 * so the plan and the finished item agree by construction. Measured realized
 * means over the whole plan space are 0.76 / 0.66 / 0.47 / 0.20 — the shortfall
 * on the hard end is patterns that cannot supply enough count-preserving
 * distractors, and it is reported honestly per item rather than assumed away.
 */
const SALIENCE_BASE = 0.05;
const SALIENCE_SPAN = 0.85;

const MIXES = {};
for (const key of Object.keys(MIX_COUNT_CHANGING)) {
  const countChanging = MIX_COUNT_CHANGING[key];
  MIXES[key] = {
    countChanging,
    salience: clampNum(SALIENCE_BASE + SALIENCE_SPAN * countChanging, 0.03, 0.95)
  };
}

const MIX_KEYS = Object.keys(MIXES);

/* ------------------------------------------------------------ small helpers */

function clampNum(x, lo, hi) {
  return x < lo ? lo : x > hi ? hi : x;
}

function n2(v) {
  const r = Math.round(v * 100) / 100;
  return Object.is(r, -0) ? 0 : r;
}

function meanOf(xs) {
  let s = 0;
  for (const x of xs) s += x;
  return xs.length ? s / xs.length : 0;
}

function normaliseOptionCount(n) {
  const v = Math.round(Number(n));
  if (!Number.isFinite(v)) return 8;
  return clampNum(v, 3, 10);
}

/* --------------------------------------------------------- planar geometry */

/** A line in normal form: point `p` on the line, unit normal `n`. */
function lineThrough(p, deg) {
  const r = (deg * Math.PI) / 180;
  // direction (cos, sin); normal is the direction turned by 90 degrees.
  return { p: { x: p.x, y: p.y }, n: { x: -Math.sin(r), y: Math.cos(r) }, deg };
}

function signedDist(q, L) {
  return (q.x - L.p.x) * L.n.x + (q.y - L.p.y) * L.n.y;
}

function reflectPoint(q, L) {
  const d = signedDist(q, L);
  return { x: q.x - 2 * d * L.n.x, y: q.y - 2 * d * L.n.y };
}

function pointsEqual(a, b, tol = TOL) {
  return Math.abs(a.x - b.x) <= tol && Math.abs(a.y - b.y) <= tol;
}

function polygonArea(poly) {
  let s = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    s += a.x * b.y - b.x * a.y;
  }
  return s / 2;
}

/** Area centroid — every symmetry axis of a convex polygon passes through it. */
function polygonCentroid(poly) {
  const a = polygonArea(poly);
  if (Math.abs(a) < EPS) {
    return { x: meanOf(poly.map((v) => v.x)), y: meanOf(poly.map((v) => v.y)) };
  }
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    const cross = p.x * q.y - q.x * p.y;
    cx += (p.x + q.x) * cross;
    cy += (p.y + q.y) * cross;
  }
  return { x: cx / (6 * a), y: cy / (6 * a) };
}

function dedupePolygon(poly) {
  const out = [];
  for (const p of poly) {
    if (!out.length || !pointsEqual(out[out.length - 1], p)) out.push(p);
  }
  while (out.length > 1 && pointsEqual(out[0], out[out.length - 1])) out.pop();
  return out;
}

/** Sutherland-Hodgman clip of a convex polygon against one half-plane. */
function clipHalfPlane(poly, L, keepSign) {
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const da = keepSign * signedDist(a, L);
    const db = keepSign * signedDist(b, L);
    const aIn = da >= -TOL;
    const bIn = db >= -TOL;
    if (aIn) out.push(a);
    if (aIn !== bIn) {
      const t = da / (da - db);
      out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
    }
  }
  return dedupePolygon(out);
}

function sameVertexSet(a, b) {
  if (a.length !== b.length) return false;
  const used = new Array(b.length).fill(false);
  for (const p of a) {
    let hit = -1;
    for (let j = 0; j < b.length; j++) {
      if (!used[j] && pointsEqual(p, b[j], 1e-6)) {
        hit = j;
        break;
      }
    }
    if (hit < 0) return false;
    used[hit] = true;
  }
  return true;
}

/**
 * The real symmetry axes of the current region, restricted to the four
 * allowed directions. A fold is only legal across one of these, which is what
 * guarantees the moving half lands exactly on the half that stays.
 */
function symmetryAxes(poly) {
  const c = polygonCentroid(poly);
  const axes = [];
  for (const deg of AXIS_DEGS) {
    const L = lineThrough(c, deg);
    if (sameVertexSet(poly, poly.map((v) => reflectPoint(v, L)))) axes.push(L);
  }
  return axes;
}

function pointInPolygon(q, poly, tol = 0) {
  // Convex polygon, vertices in consistent orientation.
  const sign = polygonArea(poly) >= 0 ? 1 : -1;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const cross = sign * ((b.x - a.x) * (q.y - a.y) - (b.y - a.y) * (q.x - a.x));
    if (cross < -tol) return false;
  }
  return true;
}

function distToSegment(q, a, b) {
  const vx = b.x - a.x;
  const vy = b.y - a.y;
  const len2 = vx * vx + vy * vy;
  let t = len2 > EPS ? ((q.x - a.x) * vx + (q.y - a.y) * vy) / len2 : 0;
  t = clampNum(t, 0, 1);
  const dx = q.x - (a.x + t * vx);
  const dy = q.y - (a.y + t * vy);
  return Math.hypot(dx, dy);
}

function distToBoundary(q, poly) {
  let best = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const d = distToSegment(q, poly[i], poly[(i + 1) % poly.length]);
    if (d < best) best = d;
  }
  return best;
}

/** The chord where an infinite line crosses a convex polygon, or null. */
function lineChord(L, poly) {
  const hits = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const da = signedDist(a, L);
    const db = signedDist(b, L);
    if (Math.abs(da) <= TOL) {
      hits.push({ x: a.x, y: a.y });
    } else if (da * db < 0) {
      const t = da / (da - db);
      hits.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
    }
  }
  const uniq = [];
  for (const h of hits) {
    if (!uniq.some((u) => pointsEqual(u, h, 1e-6))) uniq.push(h);
  }
  if (uniq.length < 2) return null;
  // Keep the two extremes along the line direction.
  const dir = { x: -L.n.y, y: L.n.x };
  uniq.sort((p, q) => (p.x * dir.x + p.y * dir.y) - (q.x * dir.x + q.y * dir.y));
  return [uniq[0], uniq[uniq.length - 1]];
}

/* --------------------------------------------------- hole sets and unfolding */

function pointKey(p) {
  const x = Math.round(p.x * KEY_Q) / KEY_Q;
  const y = Math.round(p.y * KEY_Q) / KEY_Q;
  return `${x === 0 ? 0 : x},${y === 0 ? 0 : y}`;
}

function dedupePoints(points) {
  const seen = new Set();
  const out = [];
  for (const p of points) {
    const k = pointKey(p);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(p);
  }
  return out;
}

function holeSetKey(points) {
  return points.map(pointKey).sort().join(';');
}

/**
 * Unfold: opening fold i turns every point of the folded stack into itself
 * plus its mirror image across that fold's crease. Folds are undone in
 * reverse order, i.e. the inverse reflections are applied last-fold-first.
 */
function unfoldPoints(punches, folds) {
  let set = punches.map((p) => ({ x: p.x, y: p.y }));
  for (let i = folds.length - 1; i >= 0; i--) {
    const L = folds[i].line;
    const grown = set.slice();
    for (const q of set) grown.push(reflectPoint(q, L));
    set = dedupePoints(grown);
  }
  return dedupePoints(set);
}

function minPairwiseGap(points) {
  let best = Infinity;
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      const d = Math.hypot(points[i].x - points[j].x, points[i].y - points[j].y);
      if (d < best) best = d;
    }
  }
  return best;
}

/** Every drawn hole must sit wholly on the paper, distractors included. */
function allInsideSheet(points) {
  const m = HOLE_R + 0.008;
  return points.every((p) => p.x >= m && p.x <= 1 - m && p.y >= m && p.y <= 1 - m);
}

function validHoleSet(points) {
  return (
    points.length >= 1 &&
    points.length <= HOLE_CAP &&
    allInsideSheet(points) &&
    (points.length < 2 || minPairwiseGap(points) >= MIN_HOLE_GAP * 0.98)
  );
}

/* ------------------------------------------------------------- fold building */

/**
 * Build a legal fold chain. Each fold reflects one half of the current region
 * onto the other across a genuine symmetry axis of that region.
 */
function buildFolds(rng, foldCount, wantDiagonal) {
  const regions = [[
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 1, y: 1 },
    { x: 0, y: 1 }
  ]];
  const folds = [];
  for (let i = 0; i < foldCount; i++) {
    const region = regions[regions.length - 1];
    const axes = symmetryAxes(region);
    if (!axes.length) return null;
    const diagonal = axes.filter((a) => a.deg === 45 || a.deg === 135);
    const straight = axes.filter((a) => a.deg === 0 || a.deg === 90);
    let pool;
    if (wantDiagonal && diagonal.length) pool = diagonal;
    else if (!wantDiagonal && straight.length) pool = straight;
    else pool = axes;
    const line = rng.pick(pool);
    const keepSign = rng.bool() ? 1 : -1;
    const next = clipHalfPlane(region, line, keepSign);
    if (next.length < 3 || Math.abs(polygonArea(next)) < 1e-4) return null;
    folds.push({ line, keepSign });
    regions.push(next);
  }
  return { regions, folds };
}

/** Punch candidates strictly inside the folded stack. */
function interiorCandidates(region) {
  const out = [];
  for (let i = 0; i < PUNCH_GRID; i++) {
    for (let j = 0; j < PUNCH_GRID; j++) {
      const p = { x: (i + 0.5) / PUNCH_GRID, y: (j + 0.5) / PUNCH_GRID };
      if (!pointInPolygon(p, region, 0)) continue;
      if (distToBoundary(p, region) < HOLE_MARGIN) continue;
      out.push(p);
    }
  }
  return out;
}

/**
 * Punch candidates sitting on a crease: after folding, every crease is an edge
 * of the stack, so a hole centred there collapses its two images into one.
 */
function creaseCandidates(region, folds) {
  const out = [];
  for (let i = 0; i < region.length; i++) {
    const a = region[i];
    const b = region[(i + 1) % region.length];
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const onCrease = folds.some((f) => Math.abs(signedDist(mid, f.line)) <= 1e-6);
    if (!onCrease) continue;
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len < 3 * HOLE_MARGIN) continue;
    for (const t of [0.3, 0.5, 0.7]) {
      const p = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
      if (Math.min(t, 1 - t) * len < HOLE_MARGIN) continue;
      out.push(p);
    }
  }
  return out;
}

function choosePunches(rng, region, folds, punchCount, onCrease) {
  const interior = interiorCandidates(region);
  if (!interior.length) return null;
  const crease = onCrease ? creaseCandidates(region, folds) : [];
  for (let attempt = 0; attempt < 24; attempt++) {
    const wanted = [];
    if (onCrease && crease.length) wanted.push(rng.pick(crease));
    const shuffled = rng.shuffle(interior);
    for (const p of shuffled) {
      if (wanted.length >= punchCount) break;
      if (wanted.some((q) => Math.hypot(q.x - p.x, q.y - p.y) < MIN_HOLE_GAP * 1.15)) continue;
      wanted.push(p);
    }
    if (wanted.length < punchCount) continue;
    const picked = wanted.slice(0, punchCount);
    if (validHoleSet(unfoldPoints(picked, folds))) return picked;
  }
  return null;
}

/* ---------------------------------------------------------- distractor recipes */

function rotateAbout(points, cx, cy, quarterTurns) {
  const k = ((quarterTurns % 4) + 4) % 4;
  return points.map((p) => {
    let x = p.x - cx;
    let y = p.y - cy;
    for (let i = 0; i < k; i++) {
      const nx = -y;
      const ny = x;
      x = nx;
      y = ny;
    }
    return { x: x + cx, y: y + cy };
  });
}

function mirrorSet(points, deg) {
  const L = lineThrough({ x: 0.5, y: 0.5 }, deg);
  return points.map((p) => reflectPoint(p, L));
}

/**
 * Every recipe is a systematic mis-application of the real fold geometry:
 * a wrong reflection axis, a fold left un-opened, an extra opening, a mirrored
 * or quarter-turned answer, or a subset of the true images.
 */
function distractorRecipes(rng, ctx) {
  const { punches, folds, region, trueHoles } = ctx;
  const list = [];

  // 1. One fold never opened (outermost / innermost).
  if (folds.length >= 2) {
    list.push({ tag: 'foldNotOpened', countChanging: true, build: () => unfoldPoints(punches, folds.slice(1)) });
    list.push({
      tag: 'foldNotOpened',
      countChanging: true,
      build: () => unfoldPoints(punches, folds.slice(0, folds.length - 1))
    });
  } else {
    list.push({ tag: 'foldNotOpened', countChanging: true, build: () => punches.slice() });
  }

  // 2. Wrong reflection axis on one fold: swap that crease for a different
  //    allowed direction through the same point (optionally mirrored after).
  for (let i = 0; i < folds.length; i++) {
    for (const deg of AXIS_DEGS) {
      if (deg === folds[i].line.deg) continue;
      const swap = () => {
        const swapped = folds.map((f, j) =>
          j === i ? { ...f, line: lineThrough(f.line.p, deg) } : f
        );
        return unfoldPoints(punches, swapped);
      };
      list.push({ tag: 'wrongAxis', countChanging: false, build: swap });
      list.push({
        tag: 'wrongAxisMirrored',
        countChanging: false,
        build: () => mirrorSet(swap(), 90)
      });
    }
  }

  // 2b. Crease in the right direction but in the wrong place — the fold line
  //     slid along its own normal, so every image lands off by a constant.
  for (let i = 0; i < folds.length; i++) {
    for (const off of [0.15, -0.15, 0.28, -0.28]) {
      list.push({
        tag: 'shiftedCrease',
        countChanging: false,
        build: () => {
          const L = folds[i].line;
          const moved = lineThrough(
            { x: L.p.x + L.n.x * off, y: L.p.y + L.n.y * off },
            L.deg
          );
          const swapped = folds.map((f, j) => (j === i ? { ...f, line: moved } : f));
          return unfoldPoints(punches, swapped);
        }
      });
    }
  }

  // 3. Mirrored answer.
  for (const deg of [90, 0, 45, 135]) {
    list.push({ tag: 'mirrored', countChanging: false, build: () => mirrorSet(trueHoles, deg) });
  }

  // 4. Correct pattern, quarter / half / three-quarter turned.
  for (const q of [1, 3, 2]) {
    list.push({
      tag: 'rotated',
      countChanging: false,
      build: () => rotateAbout(trueHoles, 0.5, 0.5, q)
    });
  }

  // 5. A subset of the true holes.
  for (const drop of [1, 2]) {
    if (trueHoles.length - drop < 1) continue;
    list.push({
      tag: 'subset',
      countChanging: true,
      build: () => rng.shuffle(trueHoles).slice(0, trueHoles.length - drop)
    });
  }

  // 5b. One reflection too many across a sheet axis (the sheet opened twice).
  for (const deg of [90, 0, 45]) {
    list.push({
      tag: 'doubled',
      countChanging: true,
      build: () => dedupePoints(trueHoles.concat(mirrorSet(trueHoles, deg)))
    });
  }

  // 6. One extra opening across the last crease (over-unfolded).
  if (folds.length >= 1) {
    const last = folds[folds.length - 1].line;
    list.push({
      tag: 'overUnfolded',
      countChanging: true,
      build: () => dedupePoints(trueHoles.concat(trueHoles.map((p) => reflectPoint(p, last))))
    });
  }

  // 7. A punch mirrored inside the folded stack (across a real symmetry axis of
  //    the stack, so it stays on the paper) before unfolding.
  const stackAxes = symmetryAxes(region);
  for (let i = 0; i < punches.length; i++) {
    for (const axis of stackAxes) {
      list.push({
        tag: 'punchMirrored',
        countChanging: false,
        build: () => {
          const moved = punches.map((p, j) => (j === i ? reflectPoint(p, axis) : p));
          if (!moved.every((p) => pointInPolygon(p, region, 1e-6))) return null;
          return unfoldPoints(moved, folds);
        }
      });
    }
  }

  // 8. One image reflected across the wrong line while its siblings stay put —
  //    the error of opening one layer the wrong way. Scales with the hole count,
  //    which is what keeps hard items count-uninformative.
  const swapAxes = folds
    .map((f) => f.line)
    .concat(AXIS_DEGS.map((deg) => lineThrough({ x: 0.5, y: 0.5 }, deg)));
  for (let i = 0; i < trueHoles.length; i++) {
    for (const axis of swapAxes) {
      list.push({
        tag: 'imageMisreflected',
        countChanging: false,
        build: () => trueHoles.map((p, j) => (j === i ? reflectPoint(p, axis) : p))
      });
    }
  }

  return list;
}

/** Non-systematic fallback: slide one hole to a free lattice cell. */
function perturbSet(rng, points) {
  const base = rng.shuffle(points.slice());
  const moved = base.slice(1);
  const target = base[0];
  const options = [];
  for (let i = 0; i < PUNCH_GRID; i++) {
    for (let j = 0; j < PUNCH_GRID; j++) {
      const p = { x: (i + 0.5) / PUNCH_GRID, y: (j + 0.5) / PUNCH_GRID };
      if (!allInsideSheet([p])) continue;
      if (Math.hypot(p.x - target.x, p.y - target.y) < 1e-6) continue;
      if (moved.some((q) => Math.hypot(q.x - p.x, q.y - p.y) < MIN_HOLE_GAP)) continue;
      options.push(p);
    }
  }
  if (!options.length) return null;
  return moved.concat([rng.pick(options)]);
}

/* ------------------------------------------------------------------ rendering */

const PANEL = 96;
const PANEL_GAP = 16;
const PAD = 10;
const OPT = 118;
const OPT_PAD = 7;

function sheetFrame(ox, oy, size, strong) {
  return el('rect', {
    x: n2(ox),
    y: n2(oy),
    width: n2(size),
    height: n2(size),
    rx: 3,
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': strong ? 2.2 : 1.1,
    'stroke-opacity': strong ? 0.9 : 0.24
  });
}

function regionShape(poly, ox, oy, size) {
  const pts = poly.map((p) => `${n2(ox + p.x * size)},${n2(oy + p.y * size)}`).join(' ');
  return el('polygon', {
    points: pts,
    fill: 'currentColor',
    'fill-opacity': 0.09,
    stroke: 'currentColor',
    'stroke-width': 2.4,
    'stroke-linejoin': 'round'
  });
}

function creaseLine(chord, ox, oy, size) {
  if (!chord) return '';
  return el('line', {
    x1: n2(ox + chord[0].x * size),
    y1: n2(oy + chord[0].y * size),
    x2: n2(ox + chord[1].x * size),
    y2: n2(oy + chord[1].y * size),
    stroke: 'currentColor',
    'stroke-width': 1.9,
    'stroke-linecap': 'round',
    'stroke-dasharray': '6 5',
    'stroke-opacity': 0.85
  });
}

function holeMarks(points, ox, oy, size) {
  return points
    .map((p) =>
      el('circle', {
        cx: n2(ox + p.x * size),
        cy: n2(oy + p.y * size),
        r: n2(HOLE_R * size),
        fill: 'currentColor',
        stroke: 'none'
      })
    )
    .join('');
}

function promptSvg(regions, folds, punches) {
  const panels = regions.length;
  const width = panels * PANEL + (panels - 1) * PANEL_GAP + 2 * PAD;
  const height = PANEL + 2 * PAD;
  let body = '';
  for (let i = 0; i < panels; i++) {
    const ox = PAD + i * (PANEL + PANEL_GAP);
    const oy = PAD;
    body += sheetFrame(ox, oy, PANEL, false);
    body += regionShape(regions[i], ox, oy, PANEL);
    if (i < folds.length) {
      body += creaseLine(lineChord(folds[i].line, regions[i]), ox, oy, PANEL);
    } else {
      body += holeMarks(punches, ox, oy, PANEL);
    }
  }
  return {
    svg: svgRoot({
      width,
      height,
      viewBox: `0 0 ${width} ${height}`,
      className: 'item-folding-prompt',
      body
    }),
    width,
    height
  };
}

function optionSvgFor(points) {
  const size = OPT;
  const total = size + 2 * OPT_PAD;
  const body =
    sheetFrame(OPT_PAD, OPT_PAD, size, true) + holeMarks(points, OPT_PAD, OPT_PAD, size);
  return {
    svg: svgRoot({
      width: total,
      height: total,
      viewBox: `0 0 ${total} ${total}`,
      className: 'item-folding-option',
      body
    }),
    width: total,
    height: total
  };
}

/* ------------------------------------------------------------ difficulty plan */

function planRuleTypes(foldCount, diagonal) {
  const types = ['reflection'];
  if (foldCount >= 2) types.push('ruleChaining');
  if (diagonal) types.push('symmetryCompletion');
  return types;
}

function planAbstractness(types, diagonal) {
  const base = meanOf(types.map((t) => ABSTRACTNESS[t]));
  return clampNum(base + (diagonal ? 0.2 : 0), 1, 4);
}

function estimateHoleCount(foldCount, punchCount, onCrease) {
  const raw = punchCount * Math.pow(2, foldCount);
  const collapsed = onCrease ? raw - Math.pow(2, foldCount - 1) : raw;
  return clampNum(Math.round(collapsed), 1, HOLE_CAP);
}

/**
 * Difficulty of a candidate plan, from the one difficulty model the rest of the
 * app uses — including this family's offset — so `targetB` means the same thing
 * here as it does downstream.
 */
function predictB(meta) {
  return priorIrtParams(
    { ...meta, distractorSystematicity: 1, optionCount: 8 },
    family
  ).b;
}

function planMeta(cfg) {
  const types = planRuleTypes(cfg.folds, cfg.diagonal);
  const holes = estimateHoleCount(cfg.folds, cfg.punches, cfg.onCrease);
  return {
    // ruleCount is the number of reflection relations the solver must chain,
    // which is the fold count; ruleTypes is the set of families involved.
    ruleCount: cfg.folds,
    ruleTypes: types,
    abstractness: planAbstractness(types, cfg.diagonal),
    wmLoad: clampNum(cfg.folds + (cfg.punches - 1) + (cfg.onCrease ? 1 : 0), 1, 6),
    elementCount: cfg.folds + 1 + holes,
    perceptualSalience: MIXES[cfg.mix].salience
  };
}

function enumeratePlans() {
  const plans = [];
  for (let folds = 1; folds <= 4; folds++) {
    for (let punches = 1; punches <= 3; punches++) {
      for (const diagonal of [false, true]) {
        for (const onCrease of [false, true]) {
          for (const mix of MIX_KEYS) {
            if (punches * Math.pow(2, folds) > HOLE_CAP + 6) continue;
            const cfg = { folds, punches, diagonal, onCrease, mix };
            cfg.predictedB = predictB(planMeta(cfg));
            plans.push(cfg);
          }
        }
      }
    }
  }
  return plans;
}

const PLANS = enumeratePlans();

/** The closest plans to the requested difficulty, in a randomised order. */
function planPool(rng, targetB) {
  const ranked = PLANS.slice().sort(
    (a, b) => Math.abs(a.predictedB - targetB) - Math.abs(b.predictedB - targetB)
  );
  return rng.shuffle(ranked.slice(0, Math.min(6, ranked.length)));
}

/* ------------------------------------------------------------------ assembly */

/**
 * Distractors are filled against an explicit quota of count-changing versus
 * count-preserving patterns. That quota is what makes hole-counting a useful
 * heuristic on easy items and a useless one on hard ones, so the reported
 * `perceptualSalience` is a property of the option set, not a wish.
 */
function buildDistractors(rng, plan, ctx, needed) {
  const wantChanging = clampNum(
    Math.round(MIXES[plan.mix].countChanging * needed),
    0,
    needed
  );
  const trueLen = ctx.trueHoles.length;
  const recipes = distractorRecipes(rng, ctx);
  // The label only orders the search; the quota is spent on what a recipe
  // actually produced, because a mis-applied fold can change the hole count
  // whether or not the recipe was meant to.
  const ordered = rng
    .shuffle(recipes.filter((r) => r.countChanging === wantChanging > needed / 2))
    .concat(rng.shuffle(recipes.filter((r) => r.countChanging !== wantChanging > needed / 2)));

  const quota = { changing: wantChanging, same: needed - wantChanging };
  const seen = new Set([holeSetKey(ctx.trueHoles)]);
  const chosen = [];

  const accept = (pts, tag, systematic, strict) => {
    if (!pts || chosen.length >= needed) return false;
    const clean = dedupePoints(pts);
    if (!validHoleSet(clean)) return false;
    const key = holeSetKey(clean);
    if (seen.has(key)) return false;
    const cls = clean.length === trueLen ? 'same' : 'changing';
    if (strict && quota[cls] <= 0) return false;
    quota[cls] -= 1;
    seen.add(key);
    chosen.push({ points: clean, tag, systematic });
    return true;
  };

  const sweep = (strict) => {
    for (const recipe of ordered) {
      if (chosen.length >= needed) return;
      let pts = null;
      try {
        pts = recipe.build();
      } catch (err) {
        pts = null;
      }
      accept(pts, recipe.tag, true, strict);
    }
  };

  sweep(true); // honour the quota
  sweep(false); // then take whatever systematic material is left

  // A pattern that cannot carry a systematic option set (a fully symmetric
  // answer, say) is not worth shipping: fail the attempt and resample.
  if (chosen.length < Math.min(needed, Math.ceil(0.7 * needed))) return null;

  // Fallbacks, only if the systematic recipes ran dry. They aim at whichever
  // side of the quota is still short, so salience lands where the plan put it.
  let guard = 0;
  while (chosen.length < needed && guard < 240) {
    guard++;
    const moved = perturbSet(rng, ctx.trueHoles);
    if (!moved) break;
    const pts = quota.changing > 0 && moved.length > 1 ? moved.slice(1) : moved;
    accept(pts, 'perturbed', false, false);
  }
  return chosen.length >= needed ? chosen.slice(0, needed) : null;
}

function tryBuild(rng, plan, optionCount) {
  const chain = buildFolds(rng, plan.folds, plan.diagonal);
  if (!chain) return null;
  const region = chain.regions[chain.regions.length - 1];
  const punches = choosePunches(rng, region, chain.folds, plan.punches, plan.onCrease);
  if (!punches) return null;

  const trueHoles = unfoldPoints(punches, chain.folds);
  if (!validHoleSet(trueHoles)) return null;

  const ctx = { punches, folds: chain.folds, region, trueHoles };
  const distractors = buildDistractors(rng, plan, ctx, optionCount - 1);
  if (!distractors) return null;

  // Verification: exactly one option carries the true unfolded pattern.
  const trueKey = holeSetKey(trueHoles);
  if (distractors.some((d) => holeSetKey(d.points) === trueKey)) return null;

  return { chain, punches, trueHoles, distractors };
}

/* -------------------------------------------------------------------- public */

export function generate(rng, opts) {
  const spec = opts || {};
  const optionCount = normaliseOptionCount(spec.optionCount);
  const targetB = Number.isFinite(spec.targetB) ? spec.targetB : 0.6;
  const wantB = clampNum(targetB, bRange[0] - 0.6, bRange[1] + 0.6);

  const seed = rng.int(1, 2147483647);
  const pool = planPool(rng, wantB);

  let built = null;
  let attempt = 0;
  let plan = pool[0];
  for (; attempt < MAX_ATTEMPTS; attempt++) {
    // Stay on one plan for a run of attempts, then fall back to the next
    // nearest plan rather than failing outright.
    plan = pool[Math.floor(attempt / 10) % pool.length];
    built = tryBuild(rng.fork(`fold:${seed}:${attempt}`), plan, optionCount);
    if (built) break;
  }
  if (!built) {
    throw new Error('paperFolding: no valid item after ' + MAX_ATTEMPTS + ' attempts');
  }

  const entries = [{ points: built.trueHoles, correct: true, systematic: true }].concat(
    built.distractors.map((d) => ({ points: d.points, correct: false, systematic: d.systematic }))
  );
  const shuffled = rng.shuffle(entries);

  const options = [];
  let answerId = 'o0';
  for (let i = 0; i < shuffled.length; i++) {
    const id = `o${i}`;
    const drawn = optionSvgFor(shuffled[i].points);
    options.push({ id, svg: drawn.svg, width: drawn.width, height: drawn.height });
    if (shuffled[i].correct) answerId = id;
  }

  const prompt = promptSvg(built.chain.regions, built.chain.folds, built.punches);

  const distractorSets = built.distractors;
  const systematicCount = distractorSets.filter((d) => d.systematic).length;
  const differentCount = distractorSets.filter(
    (d) => d.points.length !== built.trueHoles.length
  ).length;
  const salience = clampNum(
    SALIENCE_BASE +
      SALIENCE_SPAN * (distractorSets.length ? differentCount / distractorSets.length : 0),
    0.03,
    0.95
  );
  const ruleTypes = planRuleTypes(plan.folds, plan.diagonal);

  const variant =
    plan.folds * 1000 +
    plan.punches * 100 +
    (plan.diagonal ? 20 : 0) +
    (plan.onCrease ? 3 : 0) +
    (attempt % 10);

  return {
    id: `${family}:${seed}:${variant}`,
    family,
    seed,
    prompt,
    options,
    answerId,
    meta: {
      ruleCount: plan.folds,
      ruleTypes,
      abstractness: planAbstractness(ruleTypes, plan.diagonal),
      elementCount: built.chain.regions.length + built.trueHoles.length,
      distractorSystematicity: distractorSets.length
        ? systematicCount / distractorSets.length
        : 1,
      wmLoad: clampNum(
        plan.folds + (built.punches.length - 1) + (plan.onCrease ? 1 : 0),
        1,
        6
      ),
      perceptualSalience: salience,
      optionCount,
      generatorVersion: GENERATOR_VERSION
    },
    irt: null
  };
}
