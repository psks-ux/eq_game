/**
 * Transformation-chaining item generator: one figure stepped along a geometric
 * rail while several operators compose. At high difficulty the operator itself
 * changes on a schedule (second-order progression) — the high-ceiling mechanism.
 */

import { SHAPE_KEYS, FILLS, COLORS, SIZES, LINE_WEIGHTS } from './shapes.js';
import { svgRoot, el, drawCell, optionSvg, cellKey } from './svg.js';
import { ruleCost } from './rules.js';

export const family = 'progression';
export const bRange = [-1.2, 5.5];
export const contentGroup = 'induction';

/* ------------------------------------------------------------------ *
 * Lexicon
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
  [{ dx: 0, dy: -0.3 }, { dx: 0, dy: 0 }, { dx: 0, dy: 0.3 }],
  [{ dx: -0.26, dy: -0.26 }, { dx: 0, dy: 0 }, { dx: 0.26, dy: 0.26 }],
  [{ dx: -0.26, dy: 0.26 }, { dx: 0, dy: 0 }, { dx: 0.26, dy: -0.26 }]
];

const CELL = 88;
const GAP = 14;
const RAIL_DROP = 16;
const RAIL_TICK = 7;
const OPTION_CELL = 84;
const GENERATOR_VERSION = 1;

/* Mirrors items/calibration.js DIFFICULTY_MODEL, minus the family offset. */
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
  'position', 'containment'];

const DIM_TIER = {
  shape: 0, fill: 0, size: 0, count: 0, color: 0, lineWeight: 0,
  rotation: 1, position: 1, containment: 1
};

const CONFLICT = {
  containment: ['size', 'count'],
  position: ['size'],
  size: ['containment', 'position'],
  count: ['containment']
};

const ORDERED = new Set(['size', 'count', 'lineWeight', 'rotation', 'position', 'containment']);
const DIM_LABEL = { rotation: 'rotation', position: 'translation', containment: 'containment' };

/* ------------------------------------------------------------------ *
 * Helpers
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

function opLabel(dim, poolLen) {
  if (DIM_LABEL[dim]) return DIM_LABEL[dim];
  if (poolLen === 2) return 'sequenceAlternation';
  if (ORDERED.has(dim)) {
    if (dim === 'size') return 'sizeOrdering';
    if (dim === 'count') return 'quantityProgression';
    return 'progression';
  }
  if (poolLen === 3) return 'distributionOfThree';
  return 'progression';
}

/* ------------------------------------------------------------------ *
 * Difficulty model
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

function wmLoadOf(ruleCount, abstractnesses, glyphsPerState) {
  const deep = abstractnesses.some((a) => a >= 3) ? 1 : 0;
  const busy = glyphsPerState > 1 ? 1 : 0;
  return clampNum(ruleCount + deep + busy, 1, 6);
}

/* ------------------------------------------------------------------ *
 * Planning
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

function draftPlan(rng, opCount, chained, bias) {
  const scored = DIMS.map((d) => ({ d, s: DIM_TIER[d] * bias + rng.next() * 1.15 }));
  scored.sort((x, y) => y.s - x.s);
  const chosen = [];
  for (const { d } of scored) {
    if (chosen.length >= opCount) break;
    if (d === 'color' && opCount < 2) continue;
    if (!compatible(d, chosen)) continue;
    chosen.push(d);
  }
  if (chosen.length < opCount) return null;
  if (chosen.length === 1 && chosen[0] === 'color') return null;
  const shown = chained ? 5 : (rng.bool(0.45) ? 5 : 4);
  const chainIndex = chained ? rng.int(0, chosen.length) : -1;
  return { dims: chosen.slice(), chained, chainIndex, shown };
}

function planEstimate(plan) {
  const labels = plan.dims.map((d) => opLabel(d, d === 'rotation' ? 8 : 3));
  if (plan.chained) labels.push('ruleChaining');
  const abstractnesses = labels.map(abstractnessOf);
  const abstractness = meanOf(abstractnesses);
  const total = plan.shown + 1;
  let perState = plan.dims.indexOf('containment') >= 0 ? 2 : 1;
  if (plan.dims.indexOf('count') >= 0) perState *= 2;
  const elementCount = Math.max(1, Math.round(total * perState));
  const ruleCount = labels.length;
  const wmLoad = wmLoadOf(ruleCount, abstractnesses, perState);
  const perceptualSalience = salienceOf({
    ruleCount, abstractness, systematicity: 0.95, modalFrac: 0.45, singleGlyph: perState <= 1
  });
  return { ruleCount, ruleTypes: labels, abstractness, elementCount, wmLoad, perceptualSalience };
}

/* Three draws per (opCount, chained, bias) cell. One draw each left the easy
 * half of the range sparse — a requested b of -0.9 could land a logit and a half
 * away — because which dimensions a draft happens to pick moves predicted b a
 * long way. Planning does no SVG work, and `generate` still stops at the first
 * plan within 0.2 of target, so the extra drafts cost almost nothing. */
const PLAN_DRAWS = 3;

function rankPlans(rng, targetB) {
  const plans = [];
  for (let k = 1; k <= 4; k++) {
    for (const chained of [false, true]) {
      for (const bias of [-1.0, 0.3, 1.6]) {
        for (let d = 0; d < PLAN_DRAWS; d++) {
          const p = draftPlan(rng, k, chained, bias);
          if (p) {
            p.predictedB = predictB(planEstimate(p));
            plans.push(p);
          }
        }
      }
    }
  }
  plans.sort((a, b) => Math.abs(a.predictedB - targetB) - Math.abs(b.predictedB - targetB));
  return plans;
}

/* ------------------------------------------------------------------ *
 * Operators
 * ------------------------------------------------------------------ */

function poolFor(rng, dim, cfg) {
  switch (dim) {
    case 'shape':
      return cfg.shapePool.length >= 3 ? rng.sample(cfg.shapePool, Math.min(4, cfg.shapePool.length)) : null;
    case 'fill':
      return cfg.fillPool.length >= 3 ? rng.sample(cfg.fillPool, Math.min(4, cfg.fillPool.length))
        : (cfg.fillPool.length === 2 ? cfg.fillPool.slice() : null);
    case 'color': {
      const all = [];
      for (let i = 0; i < COLOR_N; i++) all.push(i);
      return all.length >= 3 ? rng.sample(all, Math.min(4, all.length)) : null;
    }
    case 'size': {
      const out = [];
      for (let i = 0; i < SIZE_N; i++) out.push(i);
      return out;
    }
    case 'count': {
      const span = Math.min(4, COUNT_MAX);
      const start = rng.int(1, Math.max(2, COUNT_MAX - span + 2));
      const out = [];
      for (let i = 0; i < span; i++) out.push(clampNum(start + i, 1, COUNT_MAX));
      return new Set(out).size === span ? out : null;
    }
    case 'lineWeight': {
      const all = [];
      for (let i = 0; i < LW_N; i++) all.push(i);
      return all;
    }
    case 'rotation': {
      const out = [];
      for (let i = 0; i < 8; i++) out.push(i * 45);
      return out;
    }
    case 'position':
      return cfg.offsets.slice();
    case 'containment':
      return [0, 1, 2];
    default:
      return null;
  }
}

function deltaAt(op, k) {
  if (op.order === 'accelerate') return op.delta + op.inc * (k - 1);
  if (op.order === 'alternate') return (k - 1) % 2 === 0 ? op.delta : op.delta2;
  return op.delta;
}

function cumAt(op, k) {
  let s = 0;
  for (let j = 1; j <= k; j++) s += deltaAt(op, j);
  return s;
}

function opIndexAt(op, k) {
  return mod(op.base + cumAt(op, k), op.pool.length);
}

function opValueAt(op, k) {
  return op.pool[opIndexAt(op, k)];
}

function makeOp(rng, dim, pool, order) {
  const n = pool.length;
  const op = { dim, pool, order, base: rng.int(0, n), delta: 0, delta2: 0, inc: 0 };
  const steps = [];
  for (let d = 1; d < n; d++) steps.push(d);
  if (dim === 'rotation') {
    op.delta = pickFrom(rng, [1, 2, 3, -1], 1);
  } else {
    op.delta = pickFrom(rng, steps.length ? steps : [1], 1);
    if (rng.bool(0.35)) op.delta = -op.delta;
  }
  if (order === 'accelerate') {
    op.inc = pickFrom(rng, [1, 2], 1) * (op.delta < 0 ? -1 : 1);
  } else if (order === 'alternate') {
    const alt = steps.filter((d) => mod(d, n) !== mod(op.delta, n));
    if (!alt.length) return null;
    op.delta2 = pickFrom(rng, alt, alt[0]);
  }
  op.label = opLabel(dim, n);
  return op;
}

/* Dimensions whose values carry an intrinsic perceptual order. For these the
 * cycle wrap (largest back to smallest) only becomes inferable once it has been
 * shown; if the first wrap lands on the hidden final state the item has two
 * defensible readings — "keep growing" and "start over" — and stops being a
 * single-answer item. Shape / fill / colour pools carry no such order, so there
 * the completed cycle IS the demonstration, and rotation is cyclic by nature. */
const WRAP_MUST_BE_SHOWN = new Set(['size', 'count', 'lineWeight', 'containment']);

function opIsClean(op, total) {
  const n = op.pool.length;
  const seen = new Set();
  let firstWrap = -1;
  for (let k = 0; k < total; k++) {
    const raw = op.base + cumAt(op, k);
    if (firstWrap < 0 && (raw < 0 || raw >= n)) firstWrap = k;
    const i = opIndexAt(op, k);
    if (k > 0 && i === opIndexAt(op, k - 1)) return false;
    seen.add(i);
  }
  if (WRAP_MUST_BE_SHOWN.has(op.dim) && firstWrap === total - 1) return false;
  return seen.size >= 2;
}

/* ------------------------------------------------------------------ *
 * Specs and glyphs
 * ------------------------------------------------------------------ */

function setAttr(spec, dim, value) {
  if (dim === 'position') {
    spec.dx = value.dx;
    spec.dy = value.dy;
  } else if (dim === 'containment') {
    spec.depth = value;
  } else {
    spec[dim] = value;
  }
  return spec;
}

function getAttr(spec, dim) {
  if (dim === 'position') return { dx: spec.dx, dy: spec.dy };
  if (dim === 'containment') return spec.depth;
  return spec[dim];
}

function withAttr(spec, dim, value) {
  return setAttr(Object.assign({}, spec), dim, value);
}

function sameValue(dim, a, b) {
  if (dim === 'position') return a.dx === b.dx && a.dy === b.dy;
  return a === b;
}

function cellGlyphs(cfg, spec) {
  const glyphs = [];
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
  return {
    n: glyphs.length,
    shape: core.shape,
    size: core.size,
    fill: core.fill,
    color: core.color,
    rot: core.rotation,
    lw: core.lineWeight,
    count: core.count,
    pos: `${core.dx},${core.dy}`
  };
}

const VEC_KEYS = ['n', 'shape', 'size', 'fill', 'color', 'rot', 'lw', 'count', 'pos'];

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
 * Build the sequence
 * ------------------------------------------------------------------ */

function materialise(rng, plan) {
  const governed = new Set(plan.dims);
  const shapePool = governed.has('rotation') ? ROTATABLE_SHAPES : GENERAL_SHAPES;
  const fillPool = governed.has('lineWeight') ? FILL_SOFT : FILL_ALL;
  if (!shapePool.length || fillPool.length < 2) return null;

  const cfg = {
    ops: [],
    byDim: {},
    shapePool,
    fillPool,
    offsets: pickFrom(rng, OFFSET_SETS, OFFSET_SETS[0]),
    containerShape: pickFrom(rng, usableShapes(['circle', 'square', 'hexagon', 'roundedSquare', 'octagon'], 1), 'circle'),
    total: plan.shown + 1,
    chained: plan.chained,
    base: null,
    states: null
  };

  cfg.base = {
    shape: pickFrom(rng, shapePool, 'circle'),
    size: governed.has('containment') || governed.has('position') ? 1 : 2,
    fill: pickFrom(rng, fillPool, 'empty'),
    color: 0,
    rotation: governed.has('rotation') ? 0 : 0,
    lineWeight: 1,
    count: 1,
    dx: 0,
    dy: 0,
    depth: 0
  };

  for (let i = 0; i < plan.dims.length; i++) {
    const dim = plan.dims[i];
    const pool = poolFor(rng, dim, cfg);
    if (!pool || pool.length < 2) return null;
    let op = null;
    for (let t = 0; t < 14 && !op; t++) {
      const cand = makeOp(rng, dim, pool, 'first');
      if (cand && opIsClean(cand, cfg.total)) op = cand;
    }
    if (!op) return null;
    cfg.ops.push(op);
    cfg.byDim[dim] = op;
  }

  /* Promote one operator to a second-order schedule. It needs a cycle long
   * enough for the changing step to read as a schedule rather than as noise. */
  if (plan.chained) {
    const eligible = cfg.ops.filter((o) => o.pool.length >= 4);
    if (eligible.length) {
      const target = eligible[Math.abs(plan.chainIndex) % eligible.length];
      for (let t = 0; t < 20; t++) {
        const cand = makeOp(rng, target.dim, target.pool,
          pickFrom(rng, ['accelerate', 'alternate'], 'accelerate'));
        if (cand && opIsClean(cand, cfg.total)) {
          cfg.ops[cfg.ops.indexOf(target)] = cand;
          cfg.byDim[target.dim] = cand;
          break;
        }
      }
    }
  }
  cfg.chained = cfg.ops.some((o) => o.order !== 'first');

  cfg.states = [];
  for (let k = 0; k < cfg.total; k++) {
    const s = Object.assign({}, cfg.base);
    for (const op of cfg.ops) setAttr(s, op.dim, opValueAt(op, k));
    cfg.states.push(s);
  }
  return cfg;
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
      if (cur + 1 <= COUNT_MAX) out.push(cur + 1);
      if (cur - 1 >= 1) out.push(cur - 1);
      break;
    case 'position':
      if (spec.size <= 1) {
        for (const o of cfg.offsets) if (!sameValue('position', o, cur)) out.push(o);
      }
      break;
    case 'containment':
      if (spec.size <= SIZE_N - 2) {
        if (cur + 1 <= 2) out.push(cur + 1);
        if (cur - 1 >= 0) out.push(cur - 1);
      }
      break;
    default:
      break;
  }
  return out;
}

function opAlternatives(cfg, op) {
  const K = cfg.total - 1;
  const n = op.pool.length;
  const prev = mod(op.base + cumAt(op, K - 1), n);
  const out = [];
  const push = (i) => {
    const v = op.pool[mod(i, n)];
    if (!out.some((x) => sameValue(op.dim, x, v))) out.push(v);
  };
  push(prev);                                            /* operator not applied */
  push(op.base + cumAt(op, K) + deltaAt(op, K));          /* operator applied twice */
  push(prev - deltaAt(op, K));                            /* operator inverted */
  if (op.order !== 'first') push(prev + op.delta);        /* first-order instead of chained */
  const answer = mod(op.base + cumAt(op, K), n);
  return out.filter((v) => !sameValue(op.dim, v, op.pool[answer]));
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
  const governed = cfg.ops.map((o) => o.dim);
  const visible = DIMS.filter((d) => {
    if (governed.indexOf(d) >= 0) return true;
    return domainSteps(cfg, answerSpec, d).length > 0;
  });

  const sabotageOp = cfg.ops.length ? pickFrom(rng, cfg.ops, cfg.ops[0]) : null;
  const sabotageDim = sabotageOp ? sabotageOp.dim : pickFrom(rng, visible, 'shape');
  let wValue = null;
  if (sabotageOp) {
    const alts = opAlternatives(cfg, sabotageOp);
    wValue = alts.length ? alts[0] : null;
  } else {
    const steps = domainSteps(cfg, answerSpec, sabotageDim);
    wValue = steps.length ? steps[0] : null;
  }

  const pool = [];
  const seen = new Set([answerKey]);
  const add = (spec, type, systematic, priority) => {
    const cand = makeCandidate(cfg, spec, type, systematic, priority);
    if (seen.has(cand.key)) return false;
    seen.add(cand.key);
    pool.push(cand);
    return true;
  };

  /* Partial / doubled / inverted operator application, one family per operator. */
  for (const op of cfg.ops) {
    const alts = opAlternatives(cfg, op);
    for (let i = 0; i < alts.length; i++) {
      const shared = op.dim === sabotageDim && i === 0;
      add(withAttr(answerSpec, op.dim, alts[i]), shared ? 'sabotageNear' : 'operatorError',
        true, i === 0 ? 0 : 2);
    }
  }

  /* A previous state repeated verbatim. */
  for (let back = 1; back <= 3; back++) {
    const k = cfg.total - 1 - back;
    if (k < 0) break;
    add(Object.assign({}, cfg.states[k]), 'repetition', true, 1);
  }

  /* An operator applied to the wrong attribute. */
  for (const op of cfg.ops) {
    for (const dst of DIMS) {
      if (dst === op.dim) continue;
      const steps = domainSteps(cfg, answerSpec, dst);
      if (!steps.length) continue;
      const k = Math.abs(deltaAt(op, cfg.total - 1)) % steps.length;
      add(withAttr(answerSpec, dst, steps[k]), 'wrongDimension', true, 3);
    }
  }

  /* Surface perturbation of an attribute that stays constant along the track. */
  for (const dim of visible) {
    if (governed.indexOf(dim) >= 0) continue;
    const steps = domainSteps(cfg, answerSpec, dim);
    if (steps.length) add(withAttr(answerSpec, dim, steps[0]), 'perturbed', true, 4);
  }

  /* Compound errors sharing one wrong value — these stop the correct option from
   * being the most "typical" looking one, which is a real solver shortcut. */
  if (wValue !== null) {
    const seedSpec = withAttr(answerSpec, sabotageDim, wValue);
    for (const op of cfg.ops) {
      if (op.dim === sabotageDim) continue;
      const alts = opAlternatives(cfg, op);
      if (alts.length) add(withAttr(seedSpec, op.dim, alts[0]), 'compound', true, 5);
    }
    for (const dim of visible) {
      if (dim === sabotageDim || governed.indexOf(dim) >= 0) continue;
      const steps = domainSteps(cfg, seedSpec, dim);
      if (steps.length) add(withAttr(seedSpec, dim, steps[0]), 'compound', true, 5);
    }
    /* A second anchor, two operators off the answer, with near-misses of its own.
     * Several foils then share the same pair of wrong values, so the correct
     * option stops being the most typical-looking one in the set. */
    const secondSource = governed.length > 1 ? governed : visible;
    const secondPool = secondSource.filter((d) => d !== sabotageDim);
    const secondDim = secondPool.length ? pickFrom(rng, secondPool, secondPool[0]) : null;
    if (secondDim) {
      const secondOp = cfg.byDim[secondDim];
      const w2 = secondOp ? opAlternatives(cfg, secondOp) : domainSteps(cfg, seedSpec, secondDim);
      if (w2.length) {
        const anchor2 = withAttr(seedSpec, secondDim, w2[0]);
        add(anchor2, 'decoy', true, 6);
        for (const dim of visible) {
          if (dim === sabotageDim || dim === secondDim) continue;
          const op = cfg.byDim[dim];
          const alts = op ? opAlternatives(cfg, op) : domainSteps(cfg, anchor2, dim);
          if (alts.length) add(withAttr(anchor2, dim, alts[0]), 'decoyVariant', true, 7);
        }
      }
    }
  }

  /* Fallback: random perturbation (NOT counted as systematic). */
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

const TYPE_ORDER = ['sabotageNear', 'compound', 'operatorError', 'decoy', 'decoyVariant',
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
      takeFrom('operatorError', 2);
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
 * Prompt SVG: states on a plain rail with tick marks (never an arrow)
 * ------------------------------------------------------------------ */

function promptSvgFor(cfg, shownGlyphs) {
  const n = cfg.total;
  const width = n * CELL + (n + 1) * GAP;
  const height = CELL + 2 * GAP + RAIL_DROP + RAIL_TICK;
  const railY = GAP + CELL + RAIL_DROP;
  const centreX = (i) => GAP + CELL / 2 + i * (CELL + GAP);
  /* No defs here: svgRoot() prepends defsPatterns() itself, and emitting a
   * second copy would duplicate the pattern/clipPath ids inside one document. */
  const parts = [];

  parts.push(el('line', {
    x1: GAP * 0.6, y1: railY, x2: width - GAP * 0.6, y2: railY,
    stroke: 'var(--line-strong)', 'stroke-width': 2, 'stroke-linecap': 'round'
  }, ''));
  for (let i = 0; i < n; i++) {
    const x = centreX(i);
    parts.push(el('line', {
      x1: x, y1: railY - RAIL_TICK, x2: x, y2: railY + RAIL_TICK,
      stroke: 'var(--line-strong)', 'stroke-width': 2, 'stroke-linecap': 'round'
    }, ''));
  }
  for (let i = 0; i < n; i++) {
    const x = centreX(i);
    if (i === n - 1) {
      parts.push(el('rect', {
        x: x - CELL / 2, y: GAP, width: CELL, height: CELL, rx: 10,
        fill: 'none', stroke: 'var(--line-strong)', 'stroke-width': 2,
        'stroke-dasharray': '7 6'
      }, ''));
    } else {
      parts.push(el('rect', {
        x: x - CELL / 2, y: GAP, width: CELL, height: CELL, rx: 10,
        fill: 'none', stroke: 'var(--line)', 'stroke-width': 1
      }, ''));
      parts.push(drawCell(shownGlyphs[i], x, GAP + CELL / 2, CELL));
    }
  }

  const svg = svgRoot({
    width,
    height,
    viewBox: `0 0 ${width} ${height}`,
    className: 'stim stim-progression',
    body: parts.join('')
  });
  return { svg, width, height };
}

/* ------------------------------------------------------------------ *
 * Assembly
 * ------------------------------------------------------------------ */

function tryBuild(rng, plan, optionCount, seed, variant) {
  const cfg = materialise(rng, plan);
  if (!cfg) return null;

  const glyphsByState = cfg.states.map((s) => cellGlyphs(cfg, s));
  const keys = glyphsByState.map((g) => cellKey(g));
  const last = cfg.total - 1;
  /* Every step must visibly change the figure, and the answer may not simply
   * repeat one of the states used as repetition foils. A cyclic rule is still
   * allowed to bring an earlier state back. */
  for (let k = 1; k < cfg.total; k++) if (keys[k] === keys[k - 1]) return null;
  if (keys[last] === keys[last - 2]) return null;
  if (last - 3 >= 0 && keys[last] === keys[last - 3]) return null;

  const answerSpec = cfg.states[cfg.total - 1];
  const answerGlyphs = glyphsByState[cfg.total - 1];
  const answerKey = keys[cfg.total - 1];
  const answerVec = attrVector(answerGlyphs);

  /* Every operator must still be doing something at the final step. */
  for (const op of cfg.ops) {
    if (opIndexAt(op, cfg.total - 1) === opIndexAt(op, cfg.total - 2)) return null;
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
  if (new Set(cells.map((c) => c.key)).size !== optionCount) return null;
  let matches = 0;
  for (const c of cells) if (c.key === answerKey) matches++;
  if (matches !== 1) return null;

  const prompt = promptSvgFor(cfg, glyphsByState.slice(0, cfg.total - 1));
  const pd = svgDims(prompt.svg, prompt.width, prompt.height);

  const options = cells.map((c, i) => {
    const svg = optionSvg(c.glyphs, { cell: OPTION_CELL });
    const d = svgDims(svg, OPTION_CELL, OPTION_CELL);
    return { id: `o${i}`, svg, width: d.width, height: d.height };
  });

  let elementCount = 0;
  for (const g of glyphsByState) {
    for (const gl of g) elementCount += clampNum(gl.count, 1, COUNT_MAX);
  }

  const labels = cfg.ops.map((o) => o.label);
  if (cfg.chained) labels.push('ruleChaining');
  const abstractnesses = labels.map(abstractnessOf);
  const abstractness = round3(meanOf(abstractnesses));
  const glyphsPerState = elementCount / cfg.total;
  const systematicity = round3(chosen.s.systematic / (optionCount - 1));
  const perceptualSalience = salienceOf({
    ruleCount: labels.length,
    abstractness,
    systematicity,
    modalFrac: chosen.s.modalFrac,
    singleGlyph: glyphsPerState <= 1
  });

  const meta = {
    ruleCount: labels.length,
    ruleTypes: labels,
    abstractness,
    elementCount,
    distractorSystematicity: systematicity,
    wmLoad: wmLoadOf(labels.length, abstractnesses, glyphsPerState),
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
      prompt: { svg: prompt.svg, width: pd.width, height: pd.height },
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
 * Generate one transformation-chaining item whose predicted difficulty sits as
 * close to `targetB` as the operator lexicon allows.
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
  if (!best) throw new Error('progression.generate: no valid item after 50 attempts');
  return best.built.item;
}
