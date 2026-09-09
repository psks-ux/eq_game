/**
 * Odd-one-out item family (contentGroup 'relational'): N wordless figures share one
 * property, exactly one violates it. Difficulty rises with irrelevant co-variation and
 * with higher-order shared properties (relations that hold *inside* every figure).
 */

import { SHAPE_KEYS, FILLS, COLORS, SIZES, LINE_WEIGHTS } from './shapes.js';
import { gridSvg, optionSvg, cellKey } from './svg.js';

export const family = 'oddOneOut';
export const bRange = [-1.5, 4.6];
export const contentGroup = 'relational';

const GENERATOR_VERSION = 1;
const CELL = 100;
const GAP = 16;
const MAX_ATTEMPTS = 50;

/* --- difficulty model mirror (must track calibration.js DIFFICULTY_MODEL) --- */
const B0 = -1.10;
const B_RULES = 0.92;
const B_ABSTRACT = 0.55;
const B_WM = 0.38;
const B_ELEMENTS = 0.30;
const B_SALIENCE = 1.20;
const B_FAMILY = -0.05; // calibration.js B_FAMILY.oddOneOut; kept in sync by hand

function predictB(m) {
  return B_FAMILY + B0 +
    B_RULES * (m.ruleCount - 1) +
    B_ABSTRACT * (m.abstractness - 1) +
    B_WM * (m.wmLoad - 1) +
    B_ELEMENTS * Math.log2(Math.max(1, m.elementCount) / 4) -
    B_SALIENCE * m.perceptualSalience;
}

function clamp(x, lo, hi) {
  return x < lo ? lo : x > hi ? hi : x;
}

/* --- shape pools (curated; filtered against SHAPE_KEYS defensively) --- */
function safePool(keys) {
  if (!Array.isArray(SHAPE_KEYS) || SHAPE_KEYS.length === 0) return keys.slice();
  const ok = keys.filter((k) => SHAPE_KEYS.indexOf(k) !== -1);
  return ok.length >= 2 ? ok : keys.slice();
}

const POOL_MIXED = safePool([
  'circle', 'square', 'triangleUp', 'hexagon', 'pentagon', 'diamond', 'octagon',
  'trapezoid', 'ellipse', 'uShape', 'lShape', 'zShape', 'tShape', 'semicircle',
  'parallelogram', 'rectangle', 'ring', 'roundedSquare'
]);
const POOL_AREA = safePool([
  'circle', 'square', 'triangleUp', 'hexagon', 'pentagon', 'diamond', 'octagon',
  'trapezoid', 'ellipse', 'parallelogram', 'rectangle', 'roundedSquare', 'semicircle',
  'triangleDown', 'uShape', 'tShape'
]);
const POOL_CURVED = safePool(['circle', 'ring', 'ellipse', 'semicircle', 'quarterDisc', 'notchedCircle']);
const POOL_STRAIGHT = safePool([
  'square', 'triangleUp', 'hexagon', 'pentagon', 'diamond', 'trapezoid', 'octagon',
  'parallelogram', 'rectangle', 'lShape', 'zShape', 'uShape', 'tShape', 'notchedSquare'
]);
const POOL_VSYM = safePool([
  'circle', 'ring', 'ellipse', 'square', 'roundedSquare', 'rectangle', 'triangleUp',
  'triangleDown', 'diamond', 'trapezoid', 'pentagon', 'hexagon', 'octagon', 'uShape', 'tShape'
]);
const POOL_NEST = safePool([
  'circle', 'square', 'triangleUp', 'hexagon', 'pentagon', 'diamond', 'octagon',
  'trapezoid', 'ellipse', 'rectangle', 'roundedSquare', 'triangleDown'
]);
const SIDES_POOL = [
  { sides: 3, shapes: safePool(['triangleUp', 'triangleDown', 'triangleRight', 'triangleLeft', 'rightTriangle']) },
  { sides: 4, shapes: safePool(['square', 'roundedSquare', 'rectangle', 'diamond', 'trapezoid', 'parallelogram']) },
  { sides: 5, shapes: safePool(['pentagon']) }
];

const SIDE_COUNT = {
  triangleUp: 3, triangleDown: 3, triangleRight: 3, triangleLeft: 3, rightTriangle: 3,
  square: 4, roundedSquare: 4, rectangle: 4, diamond: 4, trapezoid: 4, parallelogram: 4,
  bar: 4, pentagon: 5, hexagon: 6, octagon: 8, lShape: 6, zShape: 8, tShape: 8,
  uShape: 8, notchedSquare: 8,
  circle: 0, ring: 0, ellipse: 0, semicircle: 0, quarterDisc: 0, arc: 0,
  notchedCircle: 0, dot: 0
};
const CURVED = new Set(['circle', 'ring', 'ellipse', 'semicircle', 'quarterDisc', 'arc', 'notchedCircle', 'dot']);

const FILL_LIST = Array.isArray(FILLS) && FILLS.length
  ? FILLS.slice()
  : ['empty', 'solid', 'hStripe', 'vStripe', 'dStripe', 'dots', 'half'];
const VSYM_FILLS = FILL_LIST.filter((f) => f === 'empty' || f === 'solid' || f === 'hStripe' || f === 'vStripe' || f === 'dots');
const COLOR_N = Array.isArray(COLORS) && COLORS.length ? COLORS.length : 7;
const SIZE_N = Array.isArray(SIZES) && SIZES.length ? SIZES.length : 4;
const LW_N = Array.isArray(LINE_WEIGHTS) && LINE_WEIGHTS.length ? LINE_WEIGHTS.length : 3;

const ARRANGEMENTS = {
  1: [[0, 0]],
  2: [[-0.5, 0], [0.5, 0]],
  3: [[0, -0.45], [-0.5, 0.42], [0.5, 0.42]],
  4: [[-0.5, -0.5], [0.5, -0.5], [-0.5, 0.5], [0.5, 0.5]],
  5: [[-0.5, -0.5], [0.5, -0.5], [0, 0], [-0.5, 0.5], [0.5, 0.5]]
};
const SYM_ARRANGEMENTS = {
  3: [[0, -0.45], [-0.5, 0.42], [0.5, 0.42]],
  5: [[0, 0], [-0.5, -0.45], [0.5, -0.45], [-0.5, 0.45], [0.5, 0.45]]
};

function glyph(o) {
  return {
    shape: o.shape,
    size: o.size,
    fill: o.fill,
    color: o.color,
    rotation: o.rotation === undefined ? 0 : ((o.rotation % 360) + 360) % 360,
    lineWeight: o.lineWeight,
    dx: o.dx === undefined ? 0 : o.dx,
    dy: o.dy === undefined ? 0 : o.dy,
    count: o.count === undefined ? 1 : o.count
  };
}

/* ---------------------------------------------------------------------------
 * Attribute dimensions used by the validity check. An odd-one-out is valid only
 * when NO figure other than the intended answer is a lone singleton on ANY of
 * these, and at least one dimension isolates the answer while the rest agree.
 * ------------------------------------------------------------------------ */
const sortJoin = (xs) => xs.slice().sort().join('|');
const NA = '~';

function sides(shape) {
  const s = SIDE_COUNT[shape];
  return s === undefined ? -1 : s;
}
function vSymShape(s) { return POOL_VSYM.indexOf(s) !== -1; }
function vSymFill(f) { return VSYM_FILLS.indexOf(f) !== -1; }
function selfVSym(g) { return vSymShape(g.shape) && vSymFill(g.fill) && g.rotation % 180 === 0; }

function cellVSymmetric(gs) {
  const used = gs.map(() => false);
  for (let i = 0; i < gs.length; i++) {
    if (used[i]) continue;
    const a = gs[i];
    if (Math.abs(a.dx) < 1e-9) {
      if (!selfVSym(a)) return false;
      used[i] = true;
      continue;
    }
    if (!vSymShape(a.shape) || !vSymFill(a.fill)) return false;
    let found = -1;
    for (let j = 0; j < gs.length; j++) {
      if (j === i || used[j]) continue;
      const b = gs[j];
      if (Math.abs(b.dx + a.dx) < 1e-9 && Math.abs(b.dy - a.dy) < 1e-9 &&
        b.shape === a.shape && b.size === a.size && b.fill === a.fill &&
        b.color === a.color && b.lineWeight === a.lineWeight && b.count === a.count &&
        b.rotation === ((360 - a.rotation) % 360)) { found = j; break; }
    }
    if (found < 0) return false;
    used[i] = true;
    used[found] = true;
  }
  return true;
}

function biggest(gs) {
  let b = gs[0];
  for (const g of gs) if (g.size > b.size) b = g;
  return b;
}

const DIMENSIONS = [
  { key: 'glyphCount', of: (c) => c.length },
  { key: 'shapes', of: (c) => sortJoin(c.map((g) => g.shape)) },
  { key: 'fills', of: (c) => sortJoin(c.map((g) => g.fill)) },
  { key: 'colors', of: (c) => sortJoin(c.map((g) => String(g.color))) },
  { key: 'sizes', of: (c) => sortJoin(c.map((g) => String(g.size))) },
  { key: 'rotations', of: (c) => sortJoin(c.map((g) => String(g.rotation))) },
  { key: 'lineWeights', of: (c) => sortJoin(c.map((g) => String(g.lineWeight))) },
  { key: 'counts', of: (c) => sortJoin(c.map((g) => String(g.count))) },
  { key: 'positions', of: (c) => sortJoin(c.map((g) => `${g.dx.toFixed(3)},${g.dy.toFixed(3)}`)) },
  { key: 'nDistinctShapes', of: (c) => new Set(c.map((g) => g.shape)).size },
  { key: 'nDistinctFills', of: (c) => new Set(c.map((g) => g.fill)).size },
  { key: 'nDistinctColors', of: (c) => new Set(c.map((g) => g.color)).size },
  { key: 'nDistinctSizes', of: (c) => new Set(c.map((g) => g.size)).size },
  { key: 'allShapesSame', of: (c) => new Set(c.map((g) => g.shape)).size === 1 },
  { key: 'allFillsSame', of: (c) => new Set(c.map((g) => g.fill)).size === 1 },
  { key: 'allColorsSame', of: (c) => new Set(c.map((g) => g.color)).size === 1 },
  { key: 'allSizesSame', of: (c) => new Set(c.map((g) => g.size)).size === 1 },
  { key: 'allRotationsSame', of: (c) => new Set(c.map((g) => g.rotation)).size === 1 },
  { key: 'outerShape', of: (c) => biggest(c).shape },
  { key: 'outerFill', of: (c) => biggest(c).fill },
  { key: 'sideCounts', of: (c) => sortJoin(c.map((g) => String(sides(g.shape)))) },
  { key: 'curvedCount', of: (c) => c.filter((g) => CURVED.has(g.shape)).length },
  { key: 'totalPips', of: (c) => c.reduce((s, g) => s + g.count, 0) },
  { key: 'pipParity', of: (c) => c.reduce((s, g) => s + g.count, 0) % 2 },
  {
    key: 'countMatchesSides',
    of: (c) => (c.length === 1 ? sides(c[0].shape) === c[0].count : NA)
  },
  { key: 'verticalSymmetry', of: (c) => cellVSymmetric(c) },
  {
    key: 'innerEqualsOuter',
    of: (c) => {
      if (c.length !== 2) return NA;
      const co = c.filter((g) => Math.abs(g.dx) < 1e-9 && Math.abs(g.dy) < 1e-9);
      if (co.length !== 2) return NA;
      return co[0].shape === co[1].shape;
    }
  },
  {
    key: 'innerFillEqualsOuter',
    of: (c) => {
      if (c.length !== 2) return NA;
      const co = c.filter((g) => Math.abs(g.dx) < 1e-9 && Math.abs(g.dy) < 1e-9);
      if (co.length !== 2) return NA;
      return co[0].fill === co[1].fill;
    }
  },
  { key: 'nestedPairs', of: (c) => c.filter((g) => Math.abs(g.dx) < 1e-9 && Math.abs(g.dy) < 1e-9).length }
];

function dimValues(cells, dim) {
  return cells.map((c) => String(dim.of(c)));
}

/** Every non-answer figure must share each dimension value with >= 1 other figure. */
function alternateAnswers(cells, answerIndex) {
  const bad = [];
  for (const dim of DIMENSIONS) {
    const vals = dimValues(cells, dim);
    const counts = new Map();
    for (const v of vals) counts.set(v, (counts.get(v) || 0) + 1);
    for (let i = 0; i < vals.length; i++) {
      if (i !== answerIndex && counts.get(vals[i]) === 1) bad.push(`${dim.key}@${i}`);
    }
  }
  return bad;
}

/** The answer must be isolated on at least one dimension where all others agree. */
function isDefensible(cells, answerIndex) {
  for (const dim of DIMENSIONS) {
    const vals = dimValues(cells, dim);
    const a = vals[answerIndex];
    let ok = true;
    let common = null;
    for (let i = 0; i < vals.length; i++) {
      if (i === answerIndex) continue;
      if (common === null) common = vals[i];
      else if (vals[i] !== common) { ok = false; break; }
    }
    if (ok && common !== null && common !== a && common !== NA && a !== NA) return dim.key;
  }
  return null;
}

/* ---------------------------------------------------------------------------
 * Group scaffolding.
 *
 * Figures are built in groups of 2-3 that are identical except for one
 * "differentiator" attribute. The intended answer always sits in a group of 3, so
 * after it deviates its two group-mates still share every attribute with each
 * other -- which is what makes a lone alternate answer structurally impossible.
 * ------------------------------------------------------------------------ */
const GROUP_SIZES = { 6: [3, 3], 7: [3, 2, 2], 8: [3, 3, 2], 9: [3, 3, 3] };

/** Distinct values inside each group; every used value appears >= 2 times overall. */
function assignDifferentiator(rng, sizes, values) {
  if (values.length < Math.max(...sizes)) return null;
  const counts = new Map(values.map((v) => [String(v), 0]));
  const out = new Array(sizes.length);
  const order = sizes.map((s, i) => i).sort((a, b) => sizes[b] - sizes[a]);
  for (const gi of order) {
    const pool = rng.shuffle(values.slice());
    pool.sort((a, b) => counts.get(String(a)) - counts.get(String(b)));
    const chosen = pool.slice(0, sizes[gi]);
    for (const v of chosen) counts.set(String(v), counts.get(String(v)) + 1);
    out[gi] = rng.shuffle(chosen);
  }
  for (let pass = 0; pass < 8; pass++) {
    const lonely = values.filter((v) => counts.get(String(v)) === 1);
    if (lonely.length === 0) return out;
    let moved = false;
    for (const v of lonely) {
      const home = out.findIndex((g) => g.some((x) => String(x) === String(v)));
      for (let gi = 0; gi < out.length && !moved; gi++) {
        if (gi === home) continue;
        if (out[gi].some((x) => String(x) === String(v))) continue;
        const swapAt = out[gi].findIndex((u) => counts.get(String(u)) >= 3);
        if (swapAt < 0) continue;
        const u = out[gi][swapAt];
        out[gi][swapAt] = v;
        counts.set(String(u), counts.get(String(u)) - 1);
        counts.set(String(v), counts.get(String(v)) + 1);
        moved = true;
      }
      if (moved) break;
    }
    if (!moved) return null;
  }
  return values.every((v) => counts.get(String(v)) !== 1) ? out : null;
}

function sizePoolFor(k) {
  // k glyphs must fit the cell: multi-glyph figures use the two smallest steps.
  if (k <= 1) return SIZE_N >= 4 ? [1, 2, 3] : [0, 1];
  return SIZE_N >= 2 ? [0, 1] : [0];
}

function optionalValues(dim, rule, k) {
  switch (dim) {
    case 'shape': return rule.pool;
    case 'fill': return rule.fills;
    case 'color': return range(COLOR_N);
    case 'size': return sizePoolFor(k);
    case 'lineWeight': return range(LW_N);
    case 'rotation': return [0, 45, 90, 135];
    default: return [];
  }
}

function range(n) {
  const a = [];
  for (let i = 0; i < n; i++) a.push(i);
  return a;
}

/* --- rule catalogue -------------------------------------------------------
 * order 1: the shared property is a plain attribute value.
 * order 2+: the shared property is a relation that must be computed inside each
 * figure first (the elite separator).
 * ------------------------------------------------------------------------ */
const RULES = [
  {
    key: 'sharedShape',
    abstractness: 1.0, ruleCount: 1, ruleTypes: ['constancy'],
    salienceBase: 0.85, ks: [1], pool: POOL_MIXED, fills: FILL_LIST,
    forced: [], optional: ['fill', 'color', 'size', 'lineWeight'],
    init(rng) {
      const two = rng.sample(this.pool, 2);
      return { shape: two[0], oddShape: two[1] };
    },
    group(rng, st, t) { t.shape = st.shape; },
    violate(rng, st, t) { t.shape = st.oddShape; return true; },
    cell(t) { return [glyph({ shape: t.shape, size: t.size, fill: t.fill, color: t.color, rotation: t.rotation, lineWeight: t.lineWeight })]; }
  },
  {
    key: 'sharedFill',
    abstractness: 1.1, ruleCount: 1, ruleTypes: ['constancy'],
    salienceBase: 0.72, ks: [1], pool: POOL_AREA, fills: FILL_LIST,
    forced: [], optional: ['shape', 'color', 'size', 'lineWeight'],
    init(rng) {
      const two = rng.sample(this.fills, 2);
      return { fill: two[0], oddFill: two[1] };
    },
    group(rng, st, t) { t.fill = st.fill; },
    violate(rng, st, t) { t.fill = st.oddFill; return true; },
    cell(t) { return [glyph({ shape: t.shape, size: t.size, fill: t.fill, color: t.color, rotation: t.rotation, lineWeight: t.lineWeight })]; }
  },
  {
    key: 'sharedColor',
    abstractness: 1.2, ruleCount: 1, ruleTypes: ['constancy'],
    salienceBase: 0.70, ks: [1], pool: POOL_AREA, fills: ['solid'],
    forced: [], optional: ['shape', 'size', 'lineWeight'],
    init(rng) {
      const two = rng.sample(range(COLOR_N), 2);
      return { color: two[0], oddColor: two[1] };
    },
    group(rng, st, t) { t.color = st.color; },
    violate(rng, st, t) { t.color = st.oddColor; return true; },
    cell(t) { return [glyph({ shape: t.shape, size: t.size, fill: 'solid', color: t.color, rotation: t.rotation, lineWeight: t.lineWeight })]; }
  },
  {
    key: 'sharedQuantity',
    abstractness: 1.4, ruleCount: 1, ruleTypes: ['constancy'],
    salienceBase: 0.62, ks: [1], pool: POOL_AREA, fills: FILL_LIST,
    forced: [], optional: ['shape', 'fill', 'color', 'lineWeight'],
    init(rng) {
      const m = rng.int(2, 5);
      let odd = rng.pick([1, 2, 3, 4, 5].filter((x) => x !== m));
      return { m, odd };
    },
    group(rng, st, t) { t.count = st.m; t.size = 0; },
    violate(rng, st, t) { t.count = st.odd; return true; },
    cell(t) { return [glyph({ shape: t.shape, size: 0, fill: t.fill, color: t.color, rotation: t.rotation, lineWeight: t.lineWeight, count: t.count })]; }
  },
  {
    key: 'sharedShapeFamily',
    abstractness: 1.9, ruleCount: 2, ruleTypes: ['constancy', 'ruleChaining'],
    salienceBase: 0.45, ks: [1], pool: POOL_CURVED, fills: FILL_LIST,
    forced: ['shape'], optional: ['fill', 'color', 'size', 'lineWeight'],
    init(rng) {
      const flip = rng.bool(0.5);
      return flip
        ? { inPool: POOL_CURVED, outPool: POOL_STRAIGHT }
        : { inPool: POOL_STRAIGHT, outPool: POOL_CURVED };
    },
    poolFor(st) { return st.inPool; },
    group() { },
    violate(rng, st, t) { t.shape = rng.pick(st.outPool); return true; },
    cell(t) { return [glyph({ shape: t.shape, size: t.size, fill: t.fill, color: t.color, rotation: t.rotation, lineWeight: t.lineWeight })]; }
  },
  {
    key: 'allShapesMatch',
    abstractness: 2.5, ruleCount: 2, ruleTypes: ['constancy', 'ruleChaining'],
    salienceBase: 0.30, ks: [2, 3, 4], pool: POOL_MIXED, fills: FILL_LIST,
    forced: ['shape'], optional: ['fill', 'color', 'lineWeight'],
    init() { return {}; },
    group() { },
    violate(rng, st, t) {
      const other = this.pool.filter((s) => s !== t.shape);
      if (!other.length) return false;
      t.shape2 = rng.pick(other);
      return true;
    },
    cell(t) {
      const pos = ARRANGEMENTS[t.k];
      return pos.map((p, i) => glyph({
        shape: i === pos.length - 1 && t.shape2 ? t.shape2 : t.shape,
        size: t.size, fill: t.fill, color: t.color, rotation: t.rotation,
        lineWeight: t.lineWeight, dx: p[0], dy: p[1]
      }));
    }
  },
  {
    key: 'allFillsMatch',
    abstractness: 2.6, ruleCount: 2, ruleTypes: ['constancy', 'ruleChaining'],
    salienceBase: 0.28, ks: [2, 3, 4], pool: POOL_AREA, fills: FILL_LIST,
    forced: ['fill'], optional: ['color', 'lineWeight', 'size'],
    init(rng) { return { shapes: rng.shuffle(POOL_AREA.slice()) }; },
    group(rng, st, t, gi) { t.shapeCycle = gi; t.shapes = st.shapes; },
    violate(rng, st, t) {
      const other = this.fills.filter((f) => f !== t.fill);
      if (!other.length) return false;
      t.fill2 = rng.pick(other);
      return true;
    },
    cell(t) {
      const pos = ARRANGEMENTS[t.k];
      return pos.map((p, i) => glyph({
        shape: t.shapes[(t.shapeCycle + i) % t.shapes.length],
        size: t.size, fill: i === pos.length - 1 && t.fill2 ? t.fill2 : t.fill,
        color: t.color, rotation: t.rotation, lineWeight: t.lineWeight,
        dx: p[0], dy: p[1]
      }));
    }
  },
  {
    key: 'nestedSelfSimilar',
    abstractness: 2.8, ruleCount: 2, ruleTypes: ['containment', 'constancy'],
    salienceBase: 0.24, ks: [2], pool: POOL_NEST, fills: FILL_LIST,
    forced: ['shape'], optional: ['fill', 'color', 'lineWeight'],
    init() { return {}; },
    group() { },
    violate(rng, st, t) {
      const other = this.pool.filter((s) => s !== t.shape);
      if (!other.length) return false;
      t.shape2 = rng.pick(other);
      return true;
    },
    cell(t) {
      return [
        glyph({ shape: t.shape, size: 3, fill: 'empty', color: t.color, rotation: 0, lineWeight: t.lineWeight }),
        glyph({ shape: t.shape2 || t.shape, size: 1, fill: t.fill, color: t.color, rotation: 0, lineWeight: t.lineWeight })
      ];
    }
  },
  {
    key: 'nestedFillMatch',
    abstractness: 3.1, ruleCount: 2, ruleTypes: ['containment', 'ruleChaining'],
    salienceBase: 0.18, ks: [2], pool: POOL_NEST, fills: FILL_LIST.filter((f) => f !== 'solid'),
    forced: ['fill'], optional: ['shape', 'color', 'lineWeight'],
    init() { return {}; },
    group() { },
    violate(rng, st, t) {
      const other = this.fills.filter((f) => f !== t.fill);
      if (!other.length) return false;
      t.fill2 = rng.pick(other);
      return true;
    },
    cell(t) {
      return [
        glyph({ shape: t.shape, size: 3, fill: t.fill, color: t.color, rotation: 0, lineWeight: t.lineWeight }),
        glyph({ shape: t.shape, size: 1, fill: t.fill2 || t.fill, color: t.color, rotation: 0, lineWeight: t.lineWeight })
      ];
    }
  },
  {
    key: 'allColorsDistinct',
    abstractness: 3.0, ruleCount: 2, ruleTypes: ['constancy', 'ruleChaining'],
    salienceBase: 0.22, ks: [3, 4, 5], pool: POOL_AREA, fills: ['solid'],
    forced: ['colorSet'], optional: ['shape', 'size', 'lineWeight'],
    init() { return {}; },
    group(rng, st, t, gi, k) { t.colorSet = rng.sample(range(COLOR_N), k); },
    violate(rng, st, t) {
      if (!t.colorSet || t.colorSet.length < 2) return false;
      const cs = t.colorSet.slice();
      cs[cs.length - 1] = cs[0];
      t.colorSet = cs;
      return true;
    },
    cell(t) {
      const pos = ARRANGEMENTS[t.k];
      return pos.map((p, i) => glyph({
        shape: t.shape, size: t.size, fill: 'solid', color: t.colorSet[i],
        rotation: t.rotation, lineWeight: t.lineWeight, dx: p[0], dy: p[1]
      }));
    }
  },
  {
    key: 'quantityMatchesSides',
    abstractness: 3.6, ruleCount: 3, ruleTypes: ['quantityProgression', 'constancy', 'ruleChaining'],
    salienceBase: 0.12, ks: [1], pool: POOL_STRAIGHT, fills: FILL_LIST,
    forced: ['sidesShape'], optional: ['fill', 'color', 'lineWeight'],
    minGroups: 2,
    init(rng) { return { bands: rng.shuffle(SIDES_POOL.slice()) }; },
    group(rng, st, t, gi) {
      const band = st.bands[gi % st.bands.length];
      t.shape = rng.pick(band.shapes);
      t.count = band.sides;
      t.size = 0;
    },
    violate(rng, st, t, ctx) {
      const others = ctx.groupCounts.filter((c) => c !== t.count);
      if (!others.length) return false;
      t.count = rng.pick(others);
      return true;
    },
    cell(t) { return [glyph({ shape: t.shape, size: 0, fill: t.fill, color: t.color, rotation: 0, lineWeight: t.lineWeight, count: t.count })]; }
  },
  {
    key: 'mirrorSymmetry',
    abstractness: 3.8, ruleCount: 3, ruleTypes: ['symmetryCompletion', 'reflection', 'ruleChaining'],
    salienceBase: 0.10, ks: [3, 5], pool: POOL_VSYM, fills: VSYM_FILLS,
    forced: ['shape'], optional: ['fill', 'color', 'size', 'lineWeight'],
    init() { return {}; },
    group() { },
    violate(rng, st, t) {
      t.breakMode = rng.pick(['rotate', 'shift', 'reshape', 'refill', 'resize']);
      if (t.breakMode === 'reshape') {
        const other = this.pool.filter((s) => s !== t.shape);
        if (!other.length) return false;
        t.shape2 = rng.pick(other);
      }
      if (t.breakMode === 'refill') {
        const other = this.fills.filter((f) => f !== t.fill);
        if (!other.length) return false;
        t.fill2 = rng.pick(other);
      }
      if (t.breakMode === 'resize') t.size2 = t.size === 0 ? 1 : 0;
      return true;
    },
    cell(t) {
      const pos = SYM_ARRANGEMENTS[t.k];
      const gs = pos.map((p) => glyph({
        shape: t.shape, size: t.size, fill: t.fill, color: t.color, rotation: 0,
        lineWeight: t.lineWeight, dx: p[0], dy: p[1]
      }));
      if (!t.breakMode) return gs;
      const side = gs.findIndex((g) => g.dx < -1e-9);
      const centre = gs.findIndex((g) => Math.abs(g.dx) < 1e-9);
      if (t.breakMode === 'rotate') gs[side].rotation = 45;
      else if (t.breakMode === 'shift') { const j = centre >= 0 ? centre : side; gs[j].dx = 0.3; }
      else if (t.breakMode === 'reshape') gs[side].shape = t.shape2;
      else if (t.breakMode === 'refill') gs[side].fill = t.fill2;
      else if (t.breakMode === 'resize') gs[side].size = t.size2;
      return gs;
    }
  }
];

/* --- configuration search ------------------------------------------------- */
const GENERIC_DIMS = new Set(['shape', 'fill', 'color', 'size', 'lineWeight', 'rotation']);

function elementsPerCell(rule, k) {
  if (rule.key === 'sharedQuantity') return 3;
  if (rule.key === 'quantityMatchesSides') return 4;
  return k;
}

function metaFor(rule, k, covary, n, elementCount) {
  return {
    ruleCount: rule.ruleCount,
    ruleTypes: rule.ruleTypes.slice(),
    abstractness: rule.abstractness,
    elementCount,
    distractorSystematicity: 1,
    wmLoad: clamp(Math.round(0.5 + 0.55 * covary + 1.15 * (rule.ruleCount - 1) + 0.35 * (k - 1)), 1, 6),
    perceptualSalience: Math.round(clamp(rule.salienceBase - 0.10 * (covary - 2), 0.03, 0.9) * 1000) / 1000,
    optionCount: n,
    generatorVersion: GENERATOR_VERSION
  };
}

function buildConfigs(n) {
  const sizes = GROUP_SIZES[n];
  const nGroups = sizes.length;
  const out = [];
  for (const rule of RULES) {
    if (rule.minGroups && nGroups < rule.minGroups) continue;
    for (const k of rule.ks) {
      const forcedGeneric = rule.forced.filter((d) => GENERIC_DIMS.has(d));
      const pickable = rule.optional.filter((d) => forcedGeneric.indexOf(d) === -1);
      const maxGroup = Math.max.apply(null, sizes);
      const diffOk = pickable.filter((d) => optionalValues(d, rule, k).length >= maxGroup);
      const extraOk = pickable.filter((d) => optionalValues(d, rule, k).length >= nGroups);
      if (!diffOk.length) continue;
      const maxExtra = Math.max(0, extraOk.length - 1);
      for (let extra = 0; extra <= maxExtra; extra++) {
        const covary = rule.forced.length + extra + 1;
        const ec = n * elementsPerCell(rule, k);
        out.push({ rule, k, extra, covary, estB: predictB(metaFor(rule, k, covary, n, ec)) });
      }
    }
  }
  return out;
}

/* --- construction --------------------------------------------------------- */
function buildCells(rng, cfg, n) {
  const rule = cfg.rule;
  const sizes = GROUP_SIZES[n];
  const nGroups = sizes.length;
  const st = rule.init(rng);
  const view = Object.create(rule);
  if (rule.poolFor) view.pool = rule.poolFor(st);

  const genericForced = rule.forced.filter((d) => GENERIC_DIMS.has(d));
  const pickable = rng.shuffle(rule.optional.filter((d) => genericForced.indexOf(d) === -1));
  const maxGroup = Math.max.apply(null, sizes);

  const diffOk = pickable.filter((d) => optionalValues(d, view, cfg.k).length >= maxGroup);
  if (!diffOk.length) return null;
  const diffDim = diffOk[0];

  const extras = [];
  for (const d of pickable) {
    if (d === diffDim || extras.length >= cfg.extra) continue;
    if (optionalValues(d, view, cfg.k).length >= nGroups) extras.push(d);
  }
  if (extras.length < cfg.extra) return null;
  const templateDims = genericForced.concat(extras);

  const diffValues = assignDifferentiator(rng, sizes, optionalValues(diffDim, view, cfg.k));
  if (!diffValues) return null;

  const templateValues = {};
  for (const d of templateDims) {
    templateValues[d] = rng.sample(optionalValues(d, view, cfg.k), nGroups);
  }

  const base = {
    shape: rng.pick(view.pool),
    fill: rng.pick(view.fills),
    color: rng.int(0, COLOR_N),
    size: rng.pick(sizePoolFor(cfg.k)),
    rotation: 0,
    lineWeight: rng.int(0, LW_N),
    count: 1,
    k: cfg.k
  };

  const groupTemplates = [];
  for (let gi = 0; gi < nGroups; gi++) {
    const t = Object.assign({}, base);
    for (const d of templateDims) t[d] = templateValues[d][gi];
    rule.group.call(view, rng, st, t, gi, cfg.k);
    groupTemplates.push(t);
  }

  const ctx = { groupCounts: groupTemplates.map((t) => t.count) };
  const targetGroup = 0; // group 0 always has 3 members, so the answer's mates stay paired
  const targetMember = rng.int(0, sizes[targetGroup]);

  const cells = [];
  let answerIndex = -1;
  for (let gi = 0; gi < nGroups; gi++) {
    for (let j = 0; j < sizes[gi]; j++) {
      const t = Object.assign({}, groupTemplates[gi]);
      t[diffDim] = diffValues[gi][j];
      if (gi === targetGroup && j === targetMember) {
        if (!rule.violate.call(view, rng, st, t, ctx)) return null;
        answerIndex = cells.length;
      }
      const gs = rule.cell.call(view, t);
      if (!gs || !gs.length) return null;
      cells.push(gs);
    }
  }
  if (answerIndex < 0) return null;

  const order = rng.shuffle(cells.map((_, i) => i));
  const shuffled = order.map((i) => cells[i]);
  const answer = order.indexOf(answerIndex);
  return { cells: shuffled, answerIndex: answer, covary: templateDims.length + 1 };
}

/* --- svg helpers ---------------------------------------------------------- */
function svgDims(svg, fallbackW, fallbackH) {
  let w = fallbackW;
  let h = fallbackH;
  const vb = /viewBox="\s*[-\d.]+\s+[-\d.]+\s+([\d.]+)\s+([\d.]+)/.exec(svg || '');
  if (vb) { w = parseFloat(vb[1]); h = parseFloat(vb[2]); }
  const mw = /\bwidth="([\d.]+)"/.exec(svg || '');
  const mh = /\bheight="([\d.]+)"/.exec(svg || '');
  if (mw) w = parseFloat(mw[1]);
  if (mh) h = parseFloat(mh[1]);
  return { width: w, height: h };
}

const LAYOUT = { 6: [2, 3], 7: [1, 7], 8: [2, 4], 9: [3, 3] };

export function generate(rng, opts) {
  const options = opts || {};
  const requested = Number.isFinite(options.optionCount) ? Math.round(options.optionCount) : 8;
  const n = clamp(requested, 6, 9);
  const targetB = Number.isFinite(options.targetB) ? options.targetB : 0;
  const wanted = clamp(targetB, bRange[0], bRange[1]);
  const seed = rng.int(0, 2147483647);

  const configs = buildConfigs(n)
    .filter((c) => c.estB <= bRange[1] + 0.1 && c.estB >= bRange[0] - 0.1)
    .sort((a, b) => Math.abs(a.estB - wanted) - Math.abs(b.estB - wanted));
  if (!configs.length) throw new Error('oddOneOut: no configuration available');

  const shortlist = configs.slice(0, Math.min(6, configs.length));
  let built = null;
  let meta = null;
  let used = null;
  let optionEls = null;
  let bestErr = Infinity;
  let kept = 0;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const cfg = shortlist[attempt % shortlist.length];
    const candidate = buildCells(rng, cfg, n);
    if (!candidate) continue;
    const keys = candidate.cells.map((c) => cellKey(c));
    if (new Set(keys).size !== keys.length) continue;
    if (alternateAnswers(candidate.cells, candidate.answerIndex).length) continue;
    if (!isDefensible(candidate.cells, candidate.answerIndex)) continue;
    // Distinct canonical keys are not sufficient: the renderer clamps some
    // attributes (a stroke weight against a small drawn extent, for instance), so
    // two figures that differ in the model can still reach the eye identically.
    const drawn = candidate.cells.map((c, i) => {
      const svg = optionSvg(c, { cell: CELL });
      const d = svgDims(svg, CELL, CELL);
      return { id: `o${i}`, svg, width: d.width, height: d.height };
    });
    if (new Set(drawn.map((o) => o.svg)).size !== drawn.length) continue;
    const elementCount = candidate.cells.reduce(
      (s, c) => s + c.reduce((u, g) => u + g.count, 0), 0
    );
    const m = metaFor(cfg.rule, cfg.k, candidate.covary, n, elementCount);
    const err = Math.abs(predictB(m) - wanted);
    if (err < bestErr) { bestErr = err; built = candidate; meta = m; used = cfg; optionEls = drawn; }
    kept++;
    if (bestErr <= 0.15 || kept >= 4) break;
  }
  if (!built) throw new Error('oddOneOut: could not construct a single-answer item');

  const [rows, cols] = LAYOUT[n];
  const panel = gridSvg({
    rows, cols, cells: built.cells, cell: CELL, gap: GAP, missingIndex: -1, frame: true
  });
  const panelDims = svgDims(panel, cols * CELL + (cols + 1) * GAP, rows * CELL + (rows + 1) * GAP);

  return {
    id: `${family}:${seed}:${RULES.indexOf(used.rule)}`,
    family,
    seed,
    prompt: { svg: panel, width: panelDims.width, height: panelDims.height },
    options: optionEls,
    answerId: `o${built.answerIndex}`,
    meta,
    irt: null
  };
}
