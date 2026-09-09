/**
 * 3x3 matrix-reasoning item generator (Raven's-style) — the single strongest
 * marker of fluid g. Rules hold across rows AND columns, the missing cell is
 * re-derived independently before returning, and foils are systematic near-misses.
 */

import { SHAPE_KEYS, FILLS, COLORS, SIZES, LINE_WEIGHTS } from './shapes.js';
import { gridSvg, optionSvg, cellKey } from './svg.js';
import { ruleCost } from './rules.js';

export const family = 'matrix';
export const bRange = [-1.6, 5.2];
export const contentGroup = 'induction';

/* ------------------------------------------------------------------ *
 * Lexicon (defensively intersected with the shapes module)
 * ------------------------------------------------------------------ */

const KEYSET = new Set(Array.isArray(SHAPE_KEYS) ? SHAPE_KEYS : []);

function usableShapes(wanted, min) {
  const out = wanted.filter((k) => KEYSET.has(k));
  if (out.length >= min) return out;
  const all = Array.isArray(SHAPE_KEYS) ? SHAPE_KEYS.slice() : [];
  return all.length >= min ? all.slice(0, Math.max(min, 6)) : wanted.slice(0, min);
}

const GENERAL_SHAPES = usableShapes(
  ['circle', 'square', 'triangleUp', 'hexagon', 'diamond', 'pentagon', 'octagon',
    'trapezoid', 'ellipse', 'roundedSquare', 'ring', 'semicircle', 'uShape', 'lShape'],
  6
);

/* Shapes whose orientation is unambiguous at 45-degree steps. */
const ROTATABLE_SHAPES = usableShapes(
  ['triangleUp', 'rightTriangle', 'trapezoid', 'lShape', 'zShape', 'tShape', 'uShape',
    'semicircle', 'quarterDisc', 'arc', 'parallelogram', 'triangleRight', 'bar', 'pentagon'],
  4
);

const FILL_ALL = (Array.isArray(FILLS) ? FILLS : ['empty', 'solid']).slice();
const FILL_SOFT = FILL_ALL.filter((f) => f !== 'solid');
const SIZE_N = Array.isArray(SIZES) && SIZES.length ? SIZES.length : 4;
const COLOR_N = Array.isArray(COLORS) && COLORS.length ? COLORS.length : 7;
const LW_N = Array.isArray(LINE_WEIGHTS) && LINE_WEIGHTS.length ? LINE_WEIGHTS.length : 3;
const COUNT_MAX = 5;

const OFFSET_SETS = [
  [{ dx: -0.3, dy: 0 }, { dx: 0, dy: 0 }, { dx: 0.3, dy: 0 }],
  [{ dx: 0, dy: -0.3 }, { dx: 0, dy: 0 }, { dx: 0, dy: 0.3 }],
  [{ dx: -0.26, dy: -0.26 }, { dx: 0, dy: 0 }, { dx: 0.26, dy: 0.26 }],
  [{ dx: -0.26, dy: 0.26 }, { dx: 0, dy: 0 }, { dx: 0.26, dy: -0.26 }]
];

const SLOTS = [
  { dx: -0.45, dy: -0.45 }, { dx: 0.45, dy: -0.45 },
  { dx: -0.45, dy: 0.45 }, { dx: 0.45, dy: 0.45 }
];

const CELL = 96;
const GAP = 14;
const OPTION_CELL = 84;
const GENERATOR_VERSION = 1;

/* Mirrors items/calibration.js DIFFICULTY_MODEL (family offset excluded — the
 * registry adds B_FAMILY when it calls priorIrtParams). */
const B0 = -1.10;
const B_RULES = 0.92;
const B_ABSTRACT = 0.55;
const B_WM = 0.38;
const B_ELEMENTS = 0.30;
const B_SALIENCE = 1.20;

const LOCAL_ABSTRACT = {
  constancy: 1,
  sequenceAlternation: 2,
  distributionOfThree: 2,
  progression: 2,
  sizeOrdering: 2,
  quantityProgression: 2,
  symmetryCompletion: 3,
  reflection: 3,
  rotation: 3,
  translation: 3,
  containment: 3,
  attributeSwap: 3,
  overlayUnion: 4,
  overlayIntersection: 4,
  overlayExclusive: 4,
  overlayDifference: 4,
  ruleChaining: 4
};

const DIMS = ['shape', 'fill', 'size', 'count', 'color', 'rotation', 'lineWeight',
  'position', 'containment', 'components'];

const DIM_TIER = {
  shape: 0, fill: 0, size: 0, count: 0, color: 0, lineWeight: 0,
  rotation: 1, position: 1, containment: 1, components: 2
};

/* Dimensions that cannot be governed at the same time, because one would make the
 * other invisible or would overflow the cell. */
const CONFLICT = {
  components: ['count', 'position', 'containment', 'size', 'rotation'],
  containment: ['size', 'count', 'components'],
  position: ['size', 'components'],
  size: ['containment', 'position', 'components'],
  count: ['containment', 'components'],
  rotation: ['components']
};

const ORDERED = new Set(['size', 'count', 'lineWeight', 'rotation', 'position', 'containment']);
const DIM_LABEL = { rotation: 'rotation', position: 'translation', containment: 'containment' };

/* ------------------------------------------------------------------ *
 * Small helpers
 * ------------------------------------------------------------------ */

const mod = (x, n) => ((x % n) + n) % n;

function clampNum(x, lo, hi) {
  return x < lo ? lo : x > hi ? hi : x;
}

function finiteOr(x, d) {
  return typeof x === 'number' && Number.isFinite(x) ? x : d;
}

function round3(x) {
  return Math.round(x * 1000) / 1000;
}

function meanOf(xs) {
  if (!xs.length) return 0;
  let s = 0;
  for (const x of xs) s += x;
  return s / xs.length;
}

function pickFrom(rng, arr, fallback) {
  if (!Array.isArray(arr) || !arr.length) return fallback;
  return arr[rng.int(0, arr.length)];
}

function abstractnessOf(label) {
  let c = NaN;
  try {
    c = ruleCost(label);
  } catch (err) {
    c = NaN;
  }
  if (typeof c === 'number' && Number.isFinite(c) && c >= 1 && c <= 4) return c;
  const local = LOCAL_ABSTRACT[label];
  return typeof local === 'number' ? local : 2;
}

function svgDims(svg, fw, fh) {
  if (typeof svg !== 'string') return { width: fw, height: fh };
  const w = /\swidth="([0-9.]+)"/.exec(svg);
  const h = /\sheight="([0-9.]+)"/.exec(svg);
  if (w && h) {
    const wv = Number(w[1]);
    const hv = Number(h[1]);
    if (Number.isFinite(wv) && Number.isFinite(hv) && wv > 0 && hv > 0) {
      return { width: wv, height: hv };
    }
  }
  const vb = /\sviewBox="([^"]+)"/.exec(svg);
  if (vb) {
    const p = vb[1].trim().split(/[\s,]+/).map(Number);
    if (p.length === 4 && p.every((n) => Number.isFinite(n)) && p[2] > 0 && p[3] > 0) {
      return { width: p[2], height: p[3] };
    }
  }
  return { width: fw, height: fh };
}

function ruleLabel(dim, poolLen, dir, op) {
  if (dim === 'components') {
    if (op === 'union') return 'overlayUnion';
    if (op === 'intersection') return 'overlayIntersection';
    return 'overlayExclusive';
  }
  if (poolLen <= 1) return 'constancy';
  if (DIM_LABEL[dim]) return DIM_LABEL[dim];
  if (poolLen === 2) return 'sequenceAlternation';
  if (dir === 1 && ORDERED.has(dim)) {
    if (dim === 'size') return 'sizeOrdering';
    if (dim === 'count') return 'quantityProgression';
    return 'progression';
  }
  return 'distributionOfThree';
}

/* ------------------------------------------------------------------ *
 * Difficulty model (inverted during planning to hit targetB)
 * ------------------------------------------------------------------ */

function predictB(m) {
  return B0
    + B_RULES * (m.ruleCount - 1)
    + B_ABSTRACT * (m.abstractness - 1)
    + B_WM * (m.wmLoad - 1)
    + B_ELEMENTS * Math.log2(Math.max(1, m.elementCount) / 4)
    - B_SALIENCE * m.perceptualSalience;
}

function salienceOf({ ruleCount, abstractness, systematicity, modalFrac, singleGlyph }) {
  let s = 0.04;
  if (ruleCount <= 1) s += 0.40;
  else if (ruleCount === 2) s += 0.18;
  else if (ruleCount === 3) s += 0.07;
  if (abstractness < 1.5) s += 0.26;
  else if (abstractness < 2.1) s += 0.10;
  if (singleGlyph) s += 0.05;
  s += 0.28 * clampNum(modalFrac, 0, 1);
  s += 0.20 * clampNum(1 - systematicity, 0, 1);
  return round3(clampNum(s, 0, 1));
}

function wmLoadOf(ruleCount, abstractnesses, glyphsPerCell) {
  const deep = abstractnesses.some((a) => a >= 3) ? 1 : 0;
  const busy = glyphsPerCell > 1 ? 1 : 0;
  return clampNum(ruleCount + deep + busy, 1, 6);
}

/* ------------------------------------------------------------------ *
 * Planning: choose which dimensions carry rules, and how abstract they are
 * ------------------------------------------------------------------ */

function compatible(dim, chosen) {
  for (const c of chosen) {
    const a = CONFLICT[dim];
    const b = CONFLICT[c];
    if (a && a.indexOf(c) >= 0) return false;
    if (b && b.indexOf(dim) >= 0) return false;
  }
  return true;
}

function draftPlan(rng, ruleCount, bias) {
  if (ruleCount === 1 && bias <= -1) {
    return { dims: [{ dim: 'shape', poolLen: 1, dir: 1, op: null }], identity: true };
  }
  const scored = DIMS.map((d) => ({ d, s: DIM_TIER[d] * bias + rng.next() * 1.15 }));
  scored.sort((x, y) => y.s - x.s);
  const chosen = [];
  for (const { d } of scored) {
    if (chosen.length >= ruleCount) break;
    if (d === 'color' && ruleCount < 2) continue;
    if (!compatible(d, chosen)) continue;
    chosen.push(d);
  }
  if (chosen.length < ruleCount) return null;
  /* Colour must never be the only carrier of information (contract 21). */
  if (chosen.length === 1 && chosen[0] === 'color') return null;
  const dims = chosen.map((dim) => {
    if (dim === 'components') {
      return { dim, poolLen: 0, dir: 1, op: pickFrom(rng, ['union', 'intersection', 'exclusive'], 'union') };
    }
    const poolLen = rng.next() < 0.78 ? 3 : 2;
    return { dim, poolLen, dir: rng.next() < 0.6 ? 1 : 2, op: null };
  });
  return { dims, identity: false };
}

function planEstimate(plan) {
  const labels = plan.dims.map((d) => ruleLabel(d.dim, d.poolLen, d.dir, d.op));
  const abstractnesses = labels.map(abstractnessOf);
  const abstractness = meanOf(abstractnesses);
  const has = (k) => plan.dims.some((d) => d.dim === k);
  let perCell = 1;
  if (has('components')) perCell = 2.5;
  else if (has('containment')) perCell = 2;
  if (has('count')) perCell *= 2;
  const elementCount = Math.max(1, Math.round(9 * perCell));
  const ruleCount = plan.dims.length;
  const wmLoad = wmLoadOf(ruleCount, abstractnesses, perCell);
  const perceptualSalience = salienceOf({
    ruleCount, abstractness, systematicity: 0.95, modalFrac: 0.45, singleGlyph: perCell <= 1
  });
  return { ruleCount, ruleTypes: labels, abstractness, elementCount, wmLoad, perceptualSalience };
}

/* Three draws per (ruleCount, bias) cell. One draw each left a ~1 logit hole
 * between the 1-rule and 2-rule clusters — inside the declared bRange — because
 * the cheap ways of raising a 1-rule item (a busy `count` cell, a more abstract
 * dimension) were rarely drawn. Denser sampling is nearly free: planning does no
 * SVG work, and `generate` still stops at the first plan within 0.2 of target. */
const PLAN_DRAWS = 3;

function rankPlans(rng, targetB) {
  const plans = [];
  for (let k = 1; k <= 5; k++) {
    for (const bias of [-1.2, -0.4, 0.4, 1.2, 2.0]) {
      for (let d = 0; d < PLAN_DRAWS; d++) {
        const p = draftPlan(rng, k, bias);
        if (p) {
          p.predictedB = predictB(planEstimate(p));
          plans.push(p);
        }
      }
    }
  }
  plans.sort((a, b) => Math.abs(a.predictedB - targetB) - Math.abs(b.predictedB - targetB));
  return plans;
}

/* ------------------------------------------------------------------ *
 * Materialise a plan into concrete pools and a 3x3 index grid
 * ------------------------------------------------------------------ */

function idxAt(g, r, c) {
  if (g.poolLen <= 1) return 0;
  if (g.poolLen === 2) return (r + c) % 2;
  return mod(c + g.dir * r, 3);
}

function overlayApply(op, a, b) {
  if (op === 'union') return a | b;
  if (op === 'intersection') return a & b;
  return a ^ b;
}

function buildMasks(rng, op) {
  for (let tries = 0; tries < 240; tries++) {
    const free = [];
    for (let i = 0; i < 4; i++) {
      const lo = op === 'intersection' ? 3 : 1;
      free.push(rng.int(lo, 16) | (op === 'intersection' ? rng.int(1, 16) : 0));
    }
    const m = [[free[0], free[1], 0], [free[2], free[3], 0], [0, 0, 0]];
    m[0][2] = overlayApply(op, m[0][0], m[0][1]);
    m[1][2] = overlayApply(op, m[1][0], m[1][1]);
    m[2][0] = overlayApply(op, m[0][0], m[1][0]);
    m[2][1] = overlayApply(op, m[0][1], m[1][1]);
    const fromRow = overlayApply(op, m[2][0], m[2][1]);
    const fromCol = overlayApply(op, m[0][2], m[1][2]);
    if (fromRow !== fromCol) continue;
    m[2][2] = fromRow;
    let ok = true;
    const seen = new Set();
    for (let r = 0; r < 3 && ok; r++) {
      for (let c = 0; c < 3 && ok; c++) {
        if (m[r][c] <= 0 || m[r][c] > 15) ok = false;
        seen.add(m[r][c]);
      }
    }
    if (!ok || seen.size < 3) continue;
    return m;
  }
  return null;
}

function materialise(rng, plan) {
  const governed = new Set(plan.dims.map((d) => d.dim));
  const usesRotation = governed.has('rotation');
  const shapePool = usesRotation ? ROTATABLE_SHAPES : GENERAL_SHAPES;
  const fillPool = governed.has('lineWeight') ? FILL_SOFT : FILL_ALL;
  if (!shapePool.length || fillPool.length < 2) return null;

  const cfg = {
    byDim: {},
    dims: [],
    useComponents: governed.has('components'),
    containerShape: pickFrom(rng, usableShapes(['circle', 'square', 'hexagon', 'roundedSquare', 'octagon'], 1), 'circle'),
    markerSize: 0,
    shapePool,
    fillPool,
    offsets: pickFrom(rng, OFFSET_SETS, OFFSET_SETS[0]),
    base: null,
    grid: null
  };

  const base = {
    shape: pickFrom(rng, shapePool, 'circle'),
    size: governed.has('containment') || governed.has('position') ? 1 : 2,
    fill: pickFrom(rng, fillPool, 'empty'),
    color: 0,
    rotation: 0,
    lineWeight: 1,
    count: 1,
    dx: 0,
    dy: 0,
    depth: 0,
    mask: 15
  };
  if (cfg.useComponents) base.size = cfg.markerSize;
  cfg.base = base;

  for (const d of plan.dims) {
    if (d.dim === 'components') {
      const masks = buildMasks(rng, d.op);
      if (!masks) return null;
      const g = { dim: 'components', poolLen: 0, dir: 1, op: d.op, pool: null, masks };
      g.label = ruleLabel('components', 0, 1, d.op);
      cfg.byDim.components = g;
      cfg.dims.push(g);
      continue;
    }
    const pool = poolFor(rng, d.dim, d.poolLen, cfg);
    if (!pool || pool.length < d.poolLen) return null;
    const g = { dim: d.dim, poolLen: pool.length, dir: d.dir, op: null, pool, masks: null };
    g.label = ruleLabel(d.dim, g.poolLen, g.dir, null);
    cfg.byDim[d.dim] = g;
    cfg.dims.push(g);
  }

  cfg.grid = [];
  for (let r = 0; r < 3; r++) {
    const row = [];
    for (let c = 0; c < 3; c++) row.push(specAt(cfg, r, c));
    cfg.grid.push(row);
  }
  return cfg;
}

function poolFor(rng, dim, want, cfg) {
  const n = want;
  switch (dim) {
    case 'shape': {
      if (cfg.shapePool.length < n) return null;
      return rng.sample(cfg.shapePool, n);
    }
    case 'fill': {
      if (cfg.fillPool.length < n) return null;
      return rng.sample(cfg.fillPool, n);
    }
    case 'color': {
      const all = [];
      for (let i = 0; i < COLOR_N; i++) all.push(i);
      return all.length < n ? null : rng.sample(all, n);
    }
    case 'size': {
      const start = rng.int(0, Math.max(1, SIZE_N - n + 1));
      const out = [];
      for (let i = 0; i < n; i++) out.push(clampNum(start + i, 0, SIZE_N - 1));
      return new Set(out).size === n ? out : null;
    }
    case 'count': {
      const start = rng.int(1, Math.max(2, COUNT_MAX - n + 2));
      const out = [];
      for (let i = 0; i < n; i++) out.push(clampNum(start + i, 1, COUNT_MAX));
      return new Set(out).size === n ? out : null;
    }
    case 'lineWeight': {
      const all = [];
      for (let i = 0; i < LW_N; i++) all.push(i);
      return all.length < n ? null : (n === LW_N ? all : rng.sample(all, n));
    }
    case 'rotation': {
      const step = pickFrom(rng, [1, 2, 3], 1);
      const start = rng.int(0, 8);
      const out = [];
      for (let i = 0; i < n; i++) out.push(mod(start + i * step, 8) * 45);
      return new Set(out).size === n ? out : null;
    }
    case 'position': {
      const set = cfg.offsets;
      return n === 3 ? set.slice() : [set[0], set[2]];
    }
    case 'containment': {
      const all = [0, 1, 2];
      return n === 3 ? all : [0, 2];
    }
    default:
      return null;
  }
}

function specAt(cfg, r, c) {
  const s = Object.assign({}, cfg.base);
  for (const g of cfg.dims) {
    if (g.dim === 'components') {
      s.mask = g.masks[r][c];
      continue;
    }
    setAttr(s, g.dim, g.pool[idxAt(g, r, c)]);
  }
  return s;
}

function setAttr(spec, dim, value) {
  if (dim === 'position') {
    spec.dx = value.dx;
    spec.dy = value.dy;
  } else if (dim === 'containment') {
    spec.depth = value;
  } else if (dim === 'components') {
    spec.mask = value;
  } else {
    spec[dim] = value;
  }
  return spec;
}

function getAttr(spec, dim) {
  if (dim === 'position') return { dx: spec.dx, dy: spec.dy };
  if (dim === 'containment') return spec.depth;
  if (dim === 'components') return spec.mask;
  return spec[dim];
}

function withAttr(spec, dim, value) {
  return setAttr(Object.assign({}, spec), dim, value);
}

function sameValue(dim, a, b) {
  if (dim === 'position') return a.dx === b.dx && a.dy === b.dy;
  return a === b;
}

/* ------------------------------------------------------------------ *
 * Independent verification: re-derive the missing cell from rows and columns
 * ------------------------------------------------------------------ */

function verifyGrid(cfg) {
  for (const g of cfg.dims) {
    if (g.dim === 'components') {
      const m = g.masks;
      for (let r = 0; r < 2; r++) {
        if (overlayApply(g.op, m[r][0], m[r][1]) !== m[r][2]) return false;
      }
      for (let c = 0; c < 2; c++) {
        if (overlayApply(g.op, m[0][c], m[1][c]) !== m[2][c]) return false;
      }
      const fromRow = overlayApply(g.op, m[2][0], m[2][1]);
      const fromCol = overlayApply(g.op, m[0][2], m[1][2]);
      if (fromRow !== fromCol || fromRow !== m[2][2] || fromRow === 0) return false;
      continue;
    }
    const v = [];
    for (let r = 0; r < 3; r++) {
      const row = [];
      for (let c = 0; c < 3; c++) row.push(idxAt(g, r, c));
      v.push(row);
    }
    if (g.poolLen <= 1) {
      for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) if (v[r][c] !== 0) return false;
      continue;
    }
    if (g.poolLen === 2) {
      for (let r = 0; r < 3; r++) {
        if (v[r][0] === v[r][1] || v[r][0] !== v[r][2]) return false;
        if (v[0][r] === v[1][r] || v[0][r] !== v[2][r]) return false;
      }
      if (v[2][0] !== v[2][2] || v[0][2] !== v[2][2]) return false;
      continue;
    }
    for (let r = 0; r < 3; r++) {
      if (new Set([v[r][0], v[r][1], v[r][2]]).size !== 3) return false;
      if (new Set([v[0][r], v[1][r], v[2][r]]).size !== 3) return false;
    }
    const fromRow = 3 - v[2][0] - v[2][1];
    const fromCol = 3 - v[0][2] - v[1][2];
    if (fromRow !== fromCol || fromRow !== v[2][2]) return false;
  }
  return true;
}

/* ------------------------------------------------------------------ *
 * Cell rendering
 * ------------------------------------------------------------------ */

function cellGlyphs(cfg, spec) {
  const glyphs = [];
  if (cfg.useComponents) {
    for (let i = 0; i < SLOTS.length; i++) {
      if ((spec.mask >> i) & 1) {
        glyphs.push({
          shape: spec.shape, size: cfg.markerSize, fill: spec.fill, color: spec.color,
          rotation: mod(spec.rotation, 360), lineWeight: spec.lineWeight,
          dx: SLOTS[i].dx, dy: SLOTS[i].dy, count: 1
        });
      }
    }
    if (!glyphs.length) {
      glyphs.push({
        shape: spec.shape, size: cfg.markerSize, fill: spec.fill, color: spec.color,
        rotation: mod(spec.rotation, 360), lineWeight: spec.lineWeight, dx: 0, dy: 0, count: 1
      });
    }
    return glyphs;
  }
  for (let d = spec.depth; d >= 1; d--) {
    glyphs.push({
      shape: cfg.containerShape,
      size: clampNum(spec.size + d, 0, SIZE_N - 1),
      fill: 'empty',
      color: spec.color,
      rotation: 0,
      lineWeight: spec.lineWeight,
      dx: spec.dx, dy: spec.dy, count: 1
    });
  }
  glyphs.push({
    shape: spec.shape,
    size: clampNum(spec.size, 0, SIZE_N - 1),
    fill: spec.fill,
    color: spec.color,
    rotation: mod(spec.rotation, 360),
    lineWeight: spec.lineWeight,
    dx: spec.dx, dy: spec.dy,
    count: clampNum(spec.count, 1, COUNT_MAX)
  });
  return glyphs;
}

function attrVector(glyphs) {
  const core = glyphs[glyphs.length - 1];
  const slots = glyphs.map((g) => `${g.dx},${g.dy}`).sort().join('|');
  return {
    n: glyphs.length,
    shape: core.shape,
    size: core.size,
    fill: core.fill,
    color: core.color,
    rot: core.rotation,
    lw: core.lineWeight,
    count: core.count,
    slots
  };
}

const VEC_KEYS = ['n', 'shape', 'size', 'fill', 'color', 'rot', 'lw', 'count', 'slots'];

function typicality(vectors) {
  const freq = VEC_KEYS.map(() => new Map());
  for (const v of vectors) {
    for (let i = 0; i < VEC_KEYS.length; i++) {
      const k = String(v[VEC_KEYS[i]]);
      freq[i].set(k, (freq[i].get(k) || 0) + 1);
    }
  }
  return vectors.map((v) => {
    let s = 0;
    for (let i = 0; i < VEC_KEYS.length; i++) s += freq[i].get(String(v[VEC_KEYS[i]])) || 0;
    return s;
  });
}

/* ------------------------------------------------------------------ *
 * Distractors
 * ------------------------------------------------------------------ */

function domainSteps(cfg, spec, dim) {
  const cur = getAttr(spec, dim);
  const out = [];
  switch (dim) {
    case 'shape': {
      const pool = cfg.shapePool;
      const i = pool.indexOf(cur);
      if (pool.length > 1) {
        out.push(pool[mod(i + 1, pool.length)]);
        out.push(pool[mod(i - 1, pool.length)]);
      }
      break;
    }
    case 'size':
      if (cur + 1 <= SIZE_N - 1) out.push(cur + 1);
      if (cur - 1 >= 0) out.push(cur - 1);
      break;
    case 'fill': {
      const pool = cfg.fillPool;
      const i = pool.indexOf(cur);
      if (pool.length > 1) {
        out.push(pool[mod(i + 1, pool.length)]);
        out.push(pool[mod(i - 1, pool.length)]);
      }
      break;
    }
    case 'color':
      if (cfg.byDim.color) {
        out.push(mod(cur + 1, COLOR_N));
        out.push(mod(cur - 1, COLOR_N));
      }
      break;
    case 'rotation':
      if (ROTATABLE_SHAPES.indexOf(spec.shape) >= 0) {
        out.push(mod(cur + 45, 360));
        out.push(mod(cur - 45, 360));
      }
      break;
    case 'lineWeight':
      if (spec.fill !== 'solid') {
        if (cur + 1 <= LW_N - 1) out.push(cur + 1);
        if (cur - 1 >= 0) out.push(cur - 1);
      }
      break;
    case 'count':
      if (!cfg.useComponents) {
        if (cur + 1 <= COUNT_MAX) out.push(cur + 1);
        if (cur - 1 >= 1) out.push(cur - 1);
      }
      break;
    case 'position':
      if (!cfg.useComponents && spec.size <= 1) {
        for (const o of cfg.offsets) if (!sameValue('position', o, cur)) out.push(o);
      }
      break;
    case 'containment':
      if (!cfg.useComponents && spec.size <= SIZE_N - 2) {
        if (cur + 1 <= 2) out.push(cur + 1);
        if (cur - 1 >= 0) out.push(cur - 1);
      }
      break;
    case 'components':
      if (cfg.useComponents) {
        for (let bit = 0; bit < 4; bit++) {
          const alt = cur ^ (1 << bit);
          if (alt > 0 && alt < 16) out.push(alt);
        }
      }
      break;
    default:
      break;
  }
  return out;
}

function altValues(cfg, spec, dim) {
  const cur = getAttr(spec, dim);
  const out = [];
  const push = (v) => {
    if (v === undefined || v === null) return;
    if (sameValue(dim, v, cur)) return;
    if (out.some((x) => sameValue(dim, x, v))) return;
    out.push(v);
  };
  const g = cfg.byDim[dim];
  if (g) {
    if (dim === 'components') {
      const m = g.masks;
      for (const op of ['union', 'intersection', 'exclusive']) {
        if (op !== g.op) push(overlayApply(op, m[2][0], m[2][1]));
      }
      push(m[2][0]);
      push(m[2][1]);
      push(m[0][2]);
      push(m[1][2]);
    } else {
      push(g.pool[idxAt(g, 2, 1)]);
      push(g.pool[idxAt(g, 1, 2)]);
      for (const v of g.pool) push(v);
    }
  }
  for (const v of domainSteps(cfg, spec, dim)) push(v);
  return out;
}

function makeCandidate(cfg, spec, type, systematic, priority) {
  const glyphs = cellGlyphs(cfg, spec);
  return {
    spec,
    glyphs,
    key: cellKey(glyphs),
    vec: attrVector(glyphs),
    type,
    systematic,
    priority
  };
}

function buildPool(rng, cfg, answerSpec, answerKey) {
  const governed = cfg.dims.map((g) => g.dim);
  const visible = DIMS.filter((d) => {
    if (governed.indexOf(d) >= 0) return true;
    return domainSteps(cfg, answerSpec, d).length > 0;
  });

  /* Pick the dimension whose mis-application will be shared by several foils.
   * This is what stops the answer being the "most typical" option — a known
   * Raven's shortcut. Prefer a governed rule so the shared error is principled. */
  const sabotageDim = governed.length ? pickFrom(rng, governed, governed[0]) : pickFrom(rng, visible, 'shape');
  const wOptions = altValues(cfg, answerSpec, sabotageDim);
  const wValue = wOptions.length ? wOptions[0] : null;

  const pool = [];
  const seen = new Set([answerKey]);
  const add = (spec, type, systematic, priority) => {
    const cand = makeCandidate(cfg, spec, type, systematic, priority);
    if (seen.has(cand.key)) return false;
    seen.add(cand.key);
    pool.push(cand);
    return true;
  };

  /* (a) near-miss: every rule applied correctly except one, off by one step. */
  for (const dim of governed) {
    const alts = altValues(cfg, answerSpec, dim);
    const shared = dim === sabotageDim;
    if (alts.length) add(withAttr(answerSpec, dim, alts[0]), shared ? 'sabotageNear' : 'nearMiss', true, 0);
    if (alts.length > 1) add(withAttr(answerSpec, dim, alts[1]), 'nearMiss', true, 3);
  }

  /* (b) rule applied to the wrong dimension. */
  for (const src of cfg.dims) {
    for (const dst of DIMS) {
      if (dst === src.dim || dst === 'components') continue;
      if (cfg.useComponents && (dst === 'count' || dst === 'position' || dst === 'containment')) continue;
      const alts = altValues(cfg, answerSpec, dst);
      if (!alts.length) continue;
      const k = src.dim === 'components'
        ? (src.masks[2][2] % alts.length)
        : (idxAt(src, 2, 2) % alts.length);
      add(withAttr(answerSpec, dst, alts[k]), 'wrongDimension', true, 1);
    }
  }

  /* (c) repetition error: a matrix cell copied verbatim. */
  for (const [r, c] of [[2, 1], [1, 2], [1, 1], [0, 2], [2, 0], [0, 0]]) {
    add(Object.assign({}, cfg.grid[r][c]), 'repetition', true, 2);
  }

  /* (d) the answer with one surface attribute perturbed. */
  for (const dim of visible) {
    if (governed.indexOf(dim) >= 0) continue;
    const steps = domainSteps(cfg, answerSpec, dim);
    if (steps.length) add(withAttr(answerSpec, dim, steps[0]), 'perturbed', true, 4);
  }

  /* (a2) compound near-miss: the shared wrong value plus a second mis-applied rule.
   * These carry the sabotage value, which is what breaks the typicality shortcut. */
  if (wValue !== null) {
    const seedSpec = withAttr(answerSpec, sabotageDim, wValue);
    for (const dim of visible) {
      if (dim === sabotageDim) continue;
      const alts = altValues(cfg, seedSpec, dim);
      if (alts.length) add(withAttr(seedSpec, dim, alts[0]), 'compound', true, 5);
    }
    /* A second anchor, two rules off the answer, with near-misses of its own.
     * Several foils then share the same pair of wrong values, so the correct
     * option stops being the most typical-looking one in the set — otherwise
     * "pick the option that resembles the others" would solve the item. */
    const secondSource = governed.length > 1 ? governed : visible;
    const secondPool = secondSource.filter((d) => d !== sabotageDim);
    const secondDim = secondPool.length ? pickFrom(rng, secondPool, secondPool[0]) : null;
    if (secondDim) {
      const w2 = altValues(cfg, seedSpec, secondDim);
      if (w2.length) {
        const anchor2 = withAttr(seedSpec, secondDim, w2[0]);
        add(anchor2, 'decoy', true, 6);
        for (const dim of visible) {
          if (dim === sabotageDim || dim === secondDim) continue;
          const alts = altValues(cfg, anchor2, dim);
          if (alts.length) add(withAttr(anchor2, dim, alts[0]), 'decoyVariant', true, 7);
        }
      }
    }
  }

  /* fallback: random perturbation (counted as NON-systematic). */
  const shuffled = rng.shuffle(visible);
  for (let i = 0; i < 10; i++) {
    let spec = Object.assign({}, answerSpec);
    let changed = 0;
    for (const dim of shuffled) {
      if (changed >= 2) break;
      const steps = domainSteps(cfg, spec, dim);
      if (!steps.length) continue;
      spec = withAttr(spec, dim, steps[rng.int(0, steps.length)]);
      changed++;
    }
    if (changed) add(spec, 'random', false, 9);
  }

  return { pool, sabotageDim, wValue };
}

function scoreSubset(subset, answerVec) {
  const vectors = [answerVec].concat(subset.map((c) => c.vec));
  const typ = typicality(vectors);
  const answerTyp = typ[0];
  let uniqueMax = true;
  for (let i = 1; i < typ.length; i++) {
    if (typ[i] >= answerTyp) {
      uniqueMax = false;
      break;
    }
  }
  const systematic = subset.reduce((n, c) => n + (c.systematic ? 1 : 0), 0);
  const types = new Set(subset.map((c) => c.type)).size;
  const rank = typ.slice(1).filter((t) => t < answerTyp).length;
  const modalFrac = subset.length ? rank / subset.length : 0;
  /* Centre the answer in the typicality distribution: neither "most typical"
   * nor "least typical" may point at it. */
  const score = (uniqueMax ? 0 : 1000) + systematic * 12 + types * 4 - Math.abs(modalFrac - 0.5) * 60;
  return { ok: !uniqueMax, score, systematic, modalFrac };
}

const TYPE_ORDER = ['sabotageNear', 'compound', 'nearMiss', 'decoy', 'decoyVariant',
  'repetition', 'wrongDimension', 'perturbed', 'random'];

function selectDistractors(rng, pool, need, answerVec) {
  if (pool.length < need) return null;
  const buckets = new Map();
  for (const c of rng.shuffle(pool)) {
    if (!buckets.has(c.type)) buckets.set(c.type, []);
    buckets.get(c.type).push(c);
  }
  for (const arr of buckets.values()) arr.sort((a, b) => a.priority - b.priority);

  let best = null;
  for (let quota = 1; quota <= 4; quota++) {
    for (let decoys = 0; decoys <= 3; decoys++) {
      const taken = new Set();
      const out = [];
      const takeFrom = (type, want) => {
        const arr = buckets.get(type) || [];
        let n = want;
        for (const c of arr) {
          if (out.length >= need || n <= 0) break;
          if (taken.has(c.key)) continue;
          taken.add(c.key);
          out.push(c);
          n--;
        }
      };
      takeFrom('sabotageNear', 1);
      takeFrom('decoy', decoys > 0 ? 1 : 0);
      takeFrom('decoyVariant', Math.max(0, decoys - 1));
      takeFrom('compound', quota);
      takeFrom('nearMiss', 2);
      takeFrom('repetition', 1);
      takeFrom('wrongDimension', 1);
      takeFrom('perturbed', 1);
      for (const t of TYPE_ORDER) if (t !== 'random') takeFrom(t, need);
      takeFrom('random', need);
      if (out.length < need) continue;
      const subset = out.slice(0, need);
      const s = scoreSubset(subset, answerVec);
      if (!best || s.score > best.s.score) best = { subset, s };
    }
  }
  if (!best || !best.s.ok) return null;
  return best;
}

/* ------------------------------------------------------------------ *
 * Assembly
 * ------------------------------------------------------------------ */

function tryBuild(rng, plan, optionCount, seed, variant) {
  const cfg = materialise(rng, plan);
  if (!cfg) return null;
  if (!verifyGrid(cfg)) return null;

  const answerSpec = cfg.grid[2][2];
  const answerGlyphs = cellGlyphs(cfg, answerSpec);
  const answerKey = cellKey(answerGlyphs);
  const answerVec = attrVector(answerGlyphs);

  /* When something varies, the answer must differ from both of its neighbours or
   * the blank is trivially copied. A pure constancy item is the exception: there
   * copying IS the rule, and it is the intended floor item of the bank. */
  const varying = cfg.dims.some((g) => g.dim === 'components' || g.poolLen > 1);
  if (varying) {
    if (cellKey(cellGlyphs(cfg, cfg.grid[2][1])) === answerKey) return null;
    if (cellKey(cellGlyphs(cfg, cfg.grid[1][2])) === answerKey) return null;
  }

  const built = buildPool(rng, cfg, answerSpec, answerKey);
  const chosen = selectDistractors(rng, built.pool, optionCount - 1, answerVec);
  if (!chosen) return null;

  const answerIndex = rng.int(0, optionCount);
  const cells = [];
  let k = 0;
  for (let i = 0; i < optionCount; i++) {
    cells.push(i === answerIndex ? { glyphs: answerGlyphs, key: answerKey } : chosen.subset[k++]);
  }
  const keys = new Set(cells.map((c) => c.key));
  if (keys.size !== optionCount) return null;

  /* Verification: exactly one option reproduces the independently derived cell. */
  let matches = 0;
  for (const c of cells) if (c.key === answerKey) matches++;
  if (matches !== 1) return null;

  const gridCells = [];
  let elementCount = 0;
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      const g = r === 2 && c === 2 ? answerGlyphs : cellGlyphs(cfg, cfg.grid[r][c]);
      for (const gl of g) elementCount += clampNum(gl.count, 1, COUNT_MAX);
      gridCells.push(r === 2 && c === 2 ? [] : g);
    }
  }

  const promptSvg = gridSvg({
    rows: 3, cols: 3, cells: gridCells, cell: CELL, gap: GAP, missingIndex: 8, frame: true
  });
  const pd = svgDims(promptSvg, 3 * CELL + 4 * GAP, 3 * CELL + 4 * GAP);

  const options = cells.map((c, i) => {
    const svg = optionSvg(c.glyphs, { cell: OPTION_CELL });
    const d = svgDims(svg, OPTION_CELL, OPTION_CELL);
    return { id: `o${i}`, svg, width: d.width, height: d.height };
  });

  const labels = cfg.dims.map((g) => g.label);
  const abstractnesses = labels.map(abstractnessOf);
  const abstractness = round3(meanOf(abstractnesses));
  const glyphsPerCell = elementCount / 9;
  const systematicity = round3(chosen.s.systematic / (optionCount - 1));
  const perceptualSalience = salienceOf({
    ruleCount: cfg.dims.length,
    abstractness,
    systematicity,
    modalFrac: chosen.s.modalFrac,
    singleGlyph: glyphsPerCell <= 1
  });

  const meta = {
    ruleCount: cfg.dims.length,
    ruleTypes: labels,
    abstractness,
    elementCount,
    distractorSystematicity: systematicity,
    wmLoad: wmLoadOf(cfg.dims.length, abstractnesses, glyphsPerCell),
    perceptualSalience,
    optionCount,
    generatorVersion: GENERATOR_VERSION
  };

  return {
    predictedB: predictB(meta),
    item: {
      id: `${family}:${seed}:${variant}`,
      family,
      seed,
      prompt: { svg: promptSvg, width: pd.width, height: pd.height },
      options,
      answerId: `o${answerIndex}`,
      meta,
      irt: null
    }
  };
}

function normaliseOptionCount(v) {
  const n = Math.round(finiteOr(v, 8));
  if (!Number.isFinite(n)) return 8;
  /* Contract 9 caps an Item at 8 options; never emit more, whatever is asked. */
  return clampNum(n, 4, 8);
}

/**
 * Generate one 3x3 matrix item whose predicted difficulty sits as close to
 * `targetB` as the rule lexicon allows.
 */
export function generate(rng, spec) {
  const opts = spec || {};
  const optionCount = normaliseOptionCount(opts.optionCount);
  const targetB = clampNum(finiteOr(opts.targetB, 0), bRange[0], bRange[1]);
  const seed = rng.int(0, 2147483647);
  const plans = rankPlans(rng, targetB);

  let best = null;
  let attempts = 0;
  for (let i = 0; i < plans.length && attempts < 50; i++) {
    for (let t = 0; t < 3 && attempts < 50; t++) {
      attempts++;
      const built = tryBuild(rng, plans[i], optionCount, seed, attempts);
      if (!built) continue;
      const err = Math.abs(built.predictedB - targetB);
      if (!best || err < best.err) best = { err, built };
      break;
    }
    if (best && best.err <= 0.2) break;
  }
  if (!best) throw new Error('matrix.generate: no valid item after 50 attempts');
  return best.built.item;
}
