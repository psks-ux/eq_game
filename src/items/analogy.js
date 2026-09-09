/**
 * Figural analogy: two pairs joined by a horizontal bar and split by a vertical
 * rule (never a colon glyph). The first pair's composed transformation must be
 * abstracted and re-applied; at the top of the range it is relational.
 */

import { SHAPE_KEYS, FILLS, COLORS, SIZES, LINE_WEIGHTS } from './shapes.js';
import { svgRoot, el, drawCell, cellKey } from './svg.js';
import { describeRuleSet } from './rules.js';
import { priorIrtParams } from './calibration.js';

export const family = 'analogy';
export const bRange = [-1.0, 5.5];
export const contentGroup = 'relational';

const GENERATOR_VERSION = 1;
const MAX_ATTEMPTS = 50;
const PLAN_SAMPLES = 72;
/** Mirrors registry.js's own out-of-range tolerance when routing a targetB. */
const RANGE_TOLERANCE = 0.25;

/* ------------------------------------------------------------------ layout */

const CELL = 104;
const PAD = 22;
const BAR = 40;
const RULE = 54;
const OPT_PAD = 10;
const ROW_DX = [-0.62, 0, 0.62];
const STRUCT_SCALE = { single: 1, nested: 1, row: 0.68 };

/* ------------------------------------------------- attribute value domains */

const SIZE_MAX = Math.max(1, SIZES.length - 1);
const COLOR_MAX = Math.max(1, COLORS.length - 1);
const LW_MAX = Math.max(0, LINE_WEIGHTS.length - 1);

const FILL_ORDER = ['empty', 'solid', 'hStripe', 'vStripe', 'dStripe', 'dots', 'half'];
const FILL_ALL = pickAvailable(FILL_ORDER, FILLS);
const FILL_ROT_SAFE = pickAvailable(['empty', 'solid', 'dots'], FILLS);
const FILL_HOLLOW = pickAvailable(['empty', 'hStripe', 'vStripe', 'dStripe', 'dots'], FILLS);
const FILL_HOLLOW_ROT_SAFE = pickAvailable(['empty', 'dots'], FILLS);

/** Distinct orientations on the 45-degree grid; unknown keys assume none. */
const ROT_STEPS = {
  circle: 1, ring: 1, dot: 1, octagon: 1,
  square: 2, roundedSquare: 2, diamond: 2,
  ellipse: 4, rectangle: 4, bar: 4, parallelogram: 4, hexagon: 4, zShape: 4,
  semicircle: 8, quarterDisc: 8, arc: 8, notchedCircle: 8, notchedSquare: 8,
  triangleUp: 8, triangleDown: 8, triangleRight: 8, triangleLeft: 8, rightTriangle: 8,
  trapezoid: 8, pentagon: 8, lShape: 8, tShape: 8, uShape: 8
};

const RAW_CLASSES = [
  ['circle', 'ring', 'octagon'],
  ['ellipse'],
  ['square', 'roundedSquare', 'diamond'],
  ['rectangle', 'bar'],
  ['triangleUp', 'triangleDown', 'triangleRight', 'triangleLeft', 'rightTriangle'],
  ['semicircle', 'quarterDisc', 'arc', 'notchedCircle'],
  ['pentagon', 'hexagon'],
  ['trapezoid', 'parallelogram'],
  ['lShape', 'tShape', 'zShape', 'uShape', 'notchedSquare']
];

const SHAPE_CLASSES = buildShapeClasses();

const SHAPE_CANON = {
  diamond: ['square', 45],
  triangleDown: ['triangleUp', 180],
  triangleRight: ['triangleUp', 90],
  triangleLeft: ['triangleUp', 270]
};

/* ------------------------------------------------------ difficulty model */

/* Planning normally calls calibration.priorIrtParams so the family offset is in
   the loop (see predictB). These are the CONTRACTS.md section 10 constants,
   duplicated only as an offline fallback for the case where calibration cannot
   answer; B_FAMILY is 0 on that path, which is bounded to +/-0.5. */
const B0 = -1.10;
const B_RULES = 0.92;
const B_ABSTRACT = 0.55;
const B_WM = 0.38;
const B_ELEMENTS = 0.30;
const B_SALIENCE = 1.20;

const LOCAL_ABSTRACTNESS = {
  constancy: 1.0,
  progression: 1.6,
  sizeOrdering: 1.7,
  quantityProgression: 1.8,
  translation: 1.9,
  rotation: 2.0,
  sequenceAlternation: 2.0,
  reflection: 2.2,
  distributionOfThree: 2.4,
  containment: 2.6,
  symmetryCompletion: 2.8,
  attributeSwap: 3.0,
  overlayUnion: 3.0,
  overlayIntersection: 3.1,
  overlayDifference: 3.2,
  overlayExclusive: 3.4,
  ruleChaining: 3.6
};

/* ---------------------------------------------------------- op definitions */

const OP_INFO = {
  sizeShift: { ruleType: 'sizeOrdering', relational: false },
  rotate: { ruleType: 'rotation', relational: false },
  colorShift: { ruleType: 'progression', relational: false },
  fillSet: { ruleType: 'progression', relational: false },
  lwShift: { ruleType: 'progression', relational: false },
  shapeMap: { ruleType: 'progression', relational: false },
  countShift: { ruleType: 'quantityProgression', relational: false },
  countDouble: { ruleType: 'quantityProgression', relational: true },
  selfNest: { ruleType: 'containment', relational: true, changesStruct: true },
  wrapInto: { ruleType: 'containment', relational: true, changesStruct: true },
  swapRoles: { ruleType: 'attributeSwap', relational: true },
  dropInner: { ruleType: 'containment', relational: true, changesStruct: true },
  innerCountDouble: { ruleType: 'quantityProgression', relational: true },
  innerFromOuter: { ruleType: 'containment', relational: true },
  outerFromInner: { ruleType: 'containment', relational: true },
  sortBySize: { ruleType: 'sizeOrdering', relational: true },
  reverseOrder: { ruleType: 'reflection', relational: true },
  mirrorSizes: { ruleType: 'reflection', relational: true },
  swapEnds: { ruleType: 'attributeSwap', relational: true },
  uniformShapeToLargest: { ruleType: 'attributeSwap', relational: true },
  promoteLargest: { ruleType: 'sizeOrdering', relational: true, changesStruct: true }
};

const OPS_BY_STRUCT = {
  single: {
    attr: ['sizeShift', 'rotate', 'colorShift', 'fillSet', 'lwShift', 'shapeMap', 'countShift'],
    rel: ['countDouble', 'selfNest', 'wrapInto']
  },
  nested: {
    attr: ['sizeShift', 'rotate', 'colorShift', 'fillSet', 'lwShift', 'shapeMap', 'countShift'],
    rel: ['swapRoles', 'dropInner', 'innerCountDouble', 'innerFromOuter', 'outerFromInner']
  },
  row: {
    attr: ['sizeShift', 'rotate', 'colorShift', 'fillSet', 'lwShift', 'shapeMap'],
    rel: ['sortBySize', 'reverseOrder', 'mirrorSizes', 'swapEnds', 'uniformShapeToLargest', 'promoteLargest']
  }
};

const COUNT_OPS = new Set(['countShift', 'countDouble', 'innerCountDouble']);
const STRUCT_TAG = { single: null, nested: 'containment', row: 'sizeOrdering' };

/**
 * How far each operation announces itself. Growing a shape is nearly self-
 * evident; re-ordering parts by size is not. Feeds meta.perceptualSalience.
 */
const OP_SALIENCE = {
  sizeShift: 0.06,
  countShift: 0.05,
  colorShift: 0.03,
  shapeMap: 0.01,
  fillSet: 0.00,
  rotate: -0.01,
  lwShift: -0.05,
  countDouble: -0.02,
  selfNest: -0.02,
  wrapInto: -0.02,
  dropInner: -0.01,
  promoteLargest: -0.01,
  reverseOrder: -0.02,
  innerCountDouble: -0.03,
  sortBySize: -0.03,
  swapRoles: -0.04,
  innerFromOuter: -0.04,
  outerFromInner: -0.04,
  swapEnds: -0.04,
  uniformShapeToLargest: -0.04,
  mirrorSizes: -0.05
};

/* ------------------------------------------------------------ tiny helpers */

function pickAvailable(wanted, available) {
  const have = Array.isArray(available) ? available : [];
  const out = wanted.filter((k) => have.includes(k));
  return out.length ? out : have.slice();
}

function buildShapeClasses() {
  const keys = Array.isArray(SHAPE_KEYS) ? SHAPE_KEYS : [];
  const classes = RAW_CLASSES
    .map((cls) => cls.filter((k) => keys.includes(k)))
    .filter((cls) => cls.length > 0);
  if (classes.length >= 2) return classes;
  return keys.length ? keys.map((k) => [k]) : [['circle']];
}

function mod(a, n) {
  if (!Number.isFinite(n) || n <= 0) return 0;
  return ((a % n) + n) % n;
}

function clampInt(x, lo, hi) {
  return Math.max(lo, Math.min(hi, Math.round(x)));
}

function round3(x) {
  return Math.round(x * 1000) / 1000;
}

function sampleK(rng, arr, k) {
  const n = Math.max(0, Math.min(k, arr.length));
  if (n === 0) return [];
  return rng.shuffle(arr).slice(0, n);
}

function rotSteps(shapeKey) {
  const s = ROT_STEPS[shapeKey];
  return Number.isFinite(s) && s > 0 ? s : 1;
}

function meanOf(xs) {
  if (!xs.length) return 0;
  let s = 0;
  for (const x of xs) s += x;
  return s / xs.length;
}

function abstractnessOf(ruleTypes) {
  let a = NaN;
  try {
    const d = describeRuleSet(ruleTypes);
    if (d && Number.isFinite(d.abstractness)) a = d.abstractness;
  } catch (err) {
    a = NaN;
  }
  if (!Number.isFinite(a)) {
    a = meanOf(ruleTypes.map((k) => (Number.isFinite(LOCAL_ABSTRACTNESS[k]) ? LOCAL_ABSTRACTNESS[k] : 2)));
  }
  return Math.max(1, Math.min(4, a));
}

function localB(meta) {
  return B0
    + B_RULES * (meta.ruleCount - 1)
    + B_ABSTRACT * (meta.abstractness - 1)
    + B_WM * (meta.wmLoad - 1)
    + B_ELEMENTS * Math.log2(Math.max(1, meta.elementCount) / 4)
    - B_SALIENCE * meta.perceptualSalience;
}

/**
 * The difficulty this item will actually be scored at. Planning against
 * `calibration.priorIrtParams` (rather than a private copy of the model) keeps
 * the family offset in the loop, so a requested targetB lands where the registry
 * will later measure it. The local coefficient copy is only a fallback for the
 * case where calibration cannot answer.
 */
function predictB(meta) {
  let b = NaN;
  try {
    const p = priorIrtParams(meta, family);
    if (p && Number.isFinite(p.b)) b = p.b;
  } catch (err) {
    b = NaN;
  }
  return Number.isFinite(b) ? b : localB(meta);
}

/* --------------------------------------------------------------- cell keys */

function canonRotation(glyph) {
  const canon = SHAPE_CANON[glyph.shape];
  const shape = canon ? canon[0] : glyph.shape;
  const base = canon ? canon[1] : 0;
  const steps = rotSteps(shape);
  const units = Math.round((base + (glyph.rotation || 0)) / 45);
  return [shape, mod(units, steps)];
}

/**
 * Visual identity of a cell: two options that would paint the same pixels share a
 * key even when their fields differ - a rotation on a rotationally symmetric
 * shape, a diamond versus a square turned 45 degrees, or a line weight on a
 * replicated glyph (svg.js caps the stroke once count exceeds one).
 */
function renderKey(glyphs) {
  return glyphs
    .map((g) => {
      const [shape, rot] = canonRotation(g);
      return [
        shape,
        rot,
        g.size,
        g.fill,
        g.color,
        g.count > 1 ? -1 : g.lineWeight,
        g.count,
        Math.round((g.dx || 0) * 100),
        Math.round((g.dy || 0) * 100)
      ].join(',');
    })
    .join('|');
}

function structKey(glyphs) {
  let k = '';
  try {
    k = String(cellKey(glyphs));
  } catch (err) {
    k = '';
  }
  return k || renderKey(glyphs);
}

function keyOf(cell) {
  return structKey(cell.glyphs);
}

function rkeyOf(cell) {
  return renderKey(cell.glyphs);
}

function cloneCell(cell) {
  return { struct: cell.struct, glyphs: cell.glyphs.map((g) => ({ ...g })) };
}

/* -------------------------------------------------------------- selectors */

function selectIdx(cell, sel) {
  const gs = cell.glyphs;
  if (!gs.length) return [];
  if (sel === 'all') return gs.map((g, i) => i);
  if (sel === 'outer') return [0];
  if (sel === 'inner') return cell.struct === 'nested' && gs.length > 1 ? [1] : [];
  if (sel === 'largest' || sel === 'smallest') {
    let bi = 0;
    for (let i = 1; i < gs.length; i++) {
      const better = sel === 'largest' ? gs[i].size > gs[bi].size : gs[i].size < gs[bi].size;
      if (better) bi = i;
    }
    return [bi];
  }
  if (sel === 'middle') {
    for (let i = 0; i < gs.length; i++) if (Math.abs(gs[i].dx || 0) < 1e-6) return [i];
    return [Math.floor(gs.length / 2)];
  }
  return gs.map((g, i) => i);
}

function selsFor(struct, key) {
  if (struct === 'nested') {
    if (key === 'sizeShift' || key === 'countShift') return ['inner'];
    return ['all', 'outer', 'inner'];
  }
  if (struct === 'row') {
    if (key === 'sizeShift') return ['all', 'largest', 'smallest'];
    if (key === 'countShift') return [];
    return ['all', 'largest', 'smallest', 'middle'];
  }
  return ['all'];
}

/* ----------------------------------------------------------- op execution */

function legalGlyph(g) {
  if (!Number.isInteger(g.size) || g.size < 0 || g.size > SIZE_MAX) return false;
  if (!Number.isInteger(g.color) || g.color < 0 || g.color > COLOR_MAX) return false;
  if (!Number.isInteger(g.lineWeight) || g.lineWeight < 0 || g.lineWeight > LW_MAX) return false;
  if (!Number.isInteger(g.count) || g.count < 1 || g.count > 4) return false;
  if (g.count > 1 && g.size !== 0) return false;
  if (mod(g.rotation, 45) !== 0) return false;
  if (!FILL_ALL.includes(g.fill)) return false;
  return true;
}

function legalCell(cell) {
  if (!cell || !cell.glyphs.length) return false;
  if (cell.struct === 'nested') {
    if (cell.glyphs.length !== 2) return false;
    if (cell.glyphs[1].size >= cell.glyphs[0].size) return false;
    if (!FILL_HOLLOW.includes(cell.glyphs[0].fill)) return false;
    // A patterned container must not camouflage what it contains.
    if (cell.glyphs[0].fill !== 'empty' && cell.glyphs[0].color === cell.glyphs[1].color) return false;
  }
  return cell.glyphs.every(legalGlyph);
}

function reflowRow(cell) {
  cell.glyphs.forEach((g, i) => {
    g.dx = ROW_DX[Math.min(i, ROW_DX.length - 1)];
    g.dy = 0;
  });
  return cell;
}

function runOp(op, cell, ctx) {
  const c = cloneCell(cell);
  const gs = c.glyphs;
  const idxs = selectIdx(c, op.sel);

  switch (op.key) {
    case 'sizeShift': {
      if (!idxs.length) return null;
      for (const i of idxs) gs[i].size += op.k;
      break;
    }
    case 'rotate': {
      if (!idxs.length) return null;
      for (const i of idxs) {
        const steps = rotSteps(gs[i].shape);
        if (steps < 2) return null;
        if (mod(op.deg / 45, steps) === 0) return null;
        gs[i].rotation = mod(gs[i].rotation + op.deg, 360);
      }
      break;
    }
    case 'colorShift': {
      if (!idxs.length) return null;
      for (const i of idxs) gs[i].color = mod(gs[i].color + op.k, COLOR_MAX + 1);
      break;
    }
    case 'fillSet': {
      if (!idxs.length) return null;
      for (const i of idxs) {
        if (c.struct === 'nested' && i === 0 && !FILL_HOLLOW.includes(op.fill)) return null;
        gs[i].fill = op.fill;
      }
      break;
    }
    case 'lwShift': {
      if (!idxs.length) return null;
      for (const i of idxs) gs[i].lineWeight += op.k;
      break;
    }
    case 'shapeMap': {
      if (!idxs.length) return null;
      const pool = ctx.shapePool;
      for (const i of idxs) {
        const at = pool.indexOf(gs[i].shape);
        if (at < 0) return null;
        gs[i].shape = pool[mod(at + op.shift, pool.length)];
      }
      break;
    }
    case 'countShift': {
      if (!idxs.length) return null;
      for (const i of idxs) gs[i].count += op.k;
      break;
    }
    case 'countDouble': {
      if (!idxs.length) return null;
      for (const i of idxs) gs[i].count *= 2;
      break;
    }
    case 'innerCountDouble': {
      if (c.struct !== 'nested') return null;
      gs[1].count *= 2;
      break;
    }
    case 'selfNest': {
      if (c.struct !== 'single') return null;
      const src = gs[0];
      const outer = { ...src, size: SIZE_MAX, fill: ctx.hollowFills[0], count: 1, dx: 0, dy: 0 };
      const inner = { ...src, size: 0, dx: 0, dy: 0 };
      return finishCell({ struct: 'nested', glyphs: [outer, inner] });
    }
    case 'wrapInto': {
      if (c.struct !== 'single') return null;
      const src = gs[0];
      if (src.shape === op.shape) return null;
      const outer = {
        ...src,
        shape: op.shape,
        size: SIZE_MAX,
        fill: ctx.hollowFills[0],
        rotation: 0,
        count: 1,
        dx: 0,
        dy: 0
      };
      const inner = { ...src, size: 0, dx: 0, dy: 0 };
      return finishCell({ struct: 'nested', glyphs: [outer, inner] });
    }
    case 'swapRoles': {
      if (c.struct !== 'nested') return null;
      if (gs[0].shape === gs[1].shape) return null;
      const t = gs[0].shape;
      gs[0].shape = gs[1].shape;
      gs[1].shape = t;
      break;
    }
    case 'dropInner': {
      if (c.struct !== 'nested') return null;
      const outer = { ...gs[0], size: SIZE_MAX, dx: 0, dy: 0 };
      return finishCell({ struct: 'single', glyphs: [outer] });
    }
    case 'innerFromOuter': {
      if (c.struct !== 'nested') return null;
      if (gs[1].shape === gs[0].shape) return null;
      gs[1].shape = gs[0].shape;
      break;
    }
    case 'outerFromInner': {
      if (c.struct !== 'nested') return null;
      if (gs[0].shape === gs[1].shape) return null;
      gs[0].shape = gs[1].shape;
      break;
    }
    case 'sortBySize': {
      if (c.struct !== 'row') return null;
      const sorted = gs.slice().sort((a, b) => (op.dir === 'asc' ? a.size - b.size : b.size - a.size));
      c.glyphs = sorted;
      return finishCell(reflowRow(c));
    }
    case 'reverseOrder': {
      if (c.struct !== 'row') return null;
      c.glyphs = gs.slice().reverse();
      return finishCell(reflowRow(c));
    }
    case 'mirrorSizes': {
      if (c.struct !== 'row') return null;
      const sizes = gs.map((g) => g.size).reverse();
      gs.forEach((g, i) => { g.size = sizes[i]; });
      break;
    }
    case 'swapEnds': {
      if (c.struct !== 'row' || gs.length < 2) return null;
      const a = gs[0];
      c.glyphs[0] = gs[gs.length - 1];
      c.glyphs[gs.length - 1] = a;
      return finishCell(reflowRow(c));
    }
    case 'uniformShapeToLargest': {
      if (c.struct !== 'row') return null;
      const bi = selectIdx(c, 'largest')[0];
      const target = gs[bi].shape;
      if (gs.every((g) => g.shape === target)) return null;
      for (const g of gs) g.shape = target;
      break;
    }
    case 'promoteLargest': {
      if (c.struct !== 'row') return null;
      const bi = selectIdx(c, 'largest')[0];
      const g = { ...gs[bi], size: SIZE_MAX, dx: 0, dy: 0, count: 1 };
      return finishCell({ struct: 'single', glyphs: [g] });
    }
    default:
      return null;
  }
  return finishCell(c);
}

function finishCell(cell) {
  if (cell.struct === 'row') reflowRow(cell);
  if (cell.struct === 'nested') {
    cell.glyphs[0].dx = 0;
    cell.glyphs[0].dy = 0;
    cell.glyphs[1].dx = 0;
    cell.glyphs[1].dy = 0;
  }
  return legalCell(cell) ? cell : null;
}

function applyOps(ops, cell, ctx) {
  let c = cell;
  for (const op of ops) {
    c = runOp(op, c, ctx);
    if (!c) return null;
  }
  return c;
}

/* -------------------------------------------------------- cell generation */

function pickShapePool(rng, k, requireRotSafe) {
  let avail = SHAPE_CLASSES
    .map((cls, i) => i)
    .filter((i) => !requireRotSafe || SHAPE_CLASSES[i].some((s) => rotSteps(s) >= 4));
  if (avail.length < 2) avail = SHAPE_CLASSES.map((cls, i) => i);
  const want = Math.max(2, Math.min(k, avail.length));
  const chosen = sampleK(rng, avail, want);
  return chosen.map((ci) => {
    const members = requireRotSafe
      ? SHAPE_CLASSES[ci].filter((s) => rotSteps(s) >= 4)
      : SHAPE_CLASSES[ci];
    return rng.pick(members.length ? members : SHAPE_CLASSES[ci]);
  });
}

function makeCtx(rng, plan) {
  const rotActive = plan.opKeys.includes('rotate');
  const countActive = plan.opKeys.some((k) => COUNT_OPS.has(k));
  const shapePool = pickShapePool(rng, plan.struct === 'row' ? 3 : 3, rotActive);
  if (shapePool.length < 2) return null;
  const fillPool = rotActive ? FILL_ROT_SAFE : FILL_ALL;
  const hollowFills = rotActive ? FILL_HOLLOW_ROT_SAFE : FILL_HOLLOW;
  if (!fillPool.length || !hollowFills.length) return null;
  const colorPool = [];
  for (let i = 0; i <= COLOR_MAX; i++) colorPool.push(i);
  return {
    struct: plan.struct,
    rotActive,
    countActive,
    shapePool,
    fillPool,
    hollowFills,
    colorPool,
    rotStates: Math.min(...shapePool.map(rotSteps))
  };
}

function baseGlyph(rng, ctx, opts) {
  const o = opts || {};
  const size = Number.isInteger(o.size) ? o.size : 0;
  const count = o.count || 1;
  return {
    shape: o.shape || rng.pick(ctx.shapePool),
    size,
    fill: o.fill || rng.pick(o.hollow ? ctx.hollowFills : ctx.fillPool),
    color: Number.isInteger(o.color) ? o.color : rng.pick(ctx.colorPool),
    rotation: ctx.rotActive && ctx.rotStates >= 2 ? rng.int(0, ctx.rotStates) * 45 : 0,
    lineWeight: rng.int(0, LW_MAX + 1),
    dx: 0,
    dy: 0,
    count
  };
}

function randomCell(rng, ctx) {
  if (ctx.struct === 'single') {
    const count = ctx.countActive ? rng.int(1, 3) : 1;
    const size = count > 1 ? 0 : (ctx.countActive ? 0 : rng.int(1, SIZE_MAX));
    const g = baseGlyph(rng, ctx, { size, count });
    return finishCell({ struct: 'single', glyphs: [g] });
  }
  if (ctx.struct === 'nested') {
    const outer = baseGlyph(rng, ctx, { size: SIZE_MAX, shape: ctx.shapePool[0], hollow: true });
    const innerCount = ctx.countActive ? rng.int(1, 3) : 1;
    const innerSize = innerCount > 1 ? 0 : (ctx.countActive ? 0 : rng.int(0, Math.min(1, SIZE_MAX) + 1));
    const inner = baseGlyph(rng, ctx, { size: innerSize, shape: ctx.shapePool[1], count: innerCount });
    if (inner.size >= outer.size) inner.size = 0;
    if (outer.fill !== 'empty' && inner.color === outer.color) {
      inner.color = mod(outer.color + 1 + rng.int(0, COLOR_MAX), COLOR_MAX + 1);
    }
    return finishCell({ struct: 'nested', glyphs: [outer, inner] });
  }
  // row: three glyphs with three distinct sizes and at least two distinct shapes
  const sizes = rng.shuffle([0, 1, Math.min(2, SIZE_MAX)]);
  const shapes = [];
  for (let i = 0; i < 3; i++) shapes.push(rng.pick(ctx.shapePool));
  if (shapes.every((s) => s === shapes[0])) shapes[rng.int(0, 3)] = ctx.shapePool[(ctx.shapePool.indexOf(shapes[0]) + 1) % ctx.shapePool.length];
  const glyphs = [];
  for (let i = 0; i < 3; i++) glyphs.push(baseGlyph(rng, ctx, { size: sizes[i], shape: shapes[i] }));
  return finishCell({ struct: 'row', glyphs });
}

const SIBLING_ATTRS = ['shape', 'color', 'fill', 'size', 'lineWeight', 'rotation', 'order'];

function siblingCell(rng, cell, ctx, nDiff) {
  const c = cloneCell(cell);
  const attrs = sampleK(rng, SIBLING_ATTRS, Math.max(1, nDiff));
  for (const attr of attrs) {
    const i = rng.int(0, c.glyphs.length);
    const g = c.glyphs[i];
    switch (attr) {
      case 'shape': {
        const alts = ctx.shapePool.filter((s) => s !== g.shape);
        if (alts.length) g.shape = rng.pick(alts);
        break;
      }
      case 'color': {
        const alts = ctx.colorPool.filter((v) => v !== g.color);
        if (alts.length) g.color = rng.pick(alts);
        break;
      }
      case 'fill': {
        const source = c.struct === 'nested' && i === 0 ? ctx.hollowFills : ctx.fillPool;
        const alts = source.filter((v) => v !== g.fill);
        if (alts.length) g.fill = rng.pick(alts);
        break;
      }
      case 'size': {
        if (c.struct === 'row') {
          const sizes = rng.shuffle(c.glyphs.map((x) => x.size));
          c.glyphs.forEach((x, k) => { x.size = sizes[k]; });
        } else if (c.struct === 'nested') {
          if (g.count === 1 && i === 1) c.glyphs[1].size = c.glyphs[1].size === 0 ? Math.min(1, SIZE_MAX) : 0;
        } else if (g.count === 1) {
          const alts = [];
          for (let s = 1; s <= SIZE_MAX; s++) if (s !== g.size) alts.push(s);
          if (alts.length && g.size > 0) g.size = rng.pick(alts);
        }
        break;
      }
      case 'lineWeight': {
        const alts = [];
        for (let w = 0; w <= LW_MAX; w++) if (w !== g.lineWeight) alts.push(w);
        if (alts.length) g.lineWeight = rng.pick(alts);
        break;
      }
      case 'rotation': {
        if (!ctx.rotActive || ctx.rotStates < 2) break;
        const alts = [];
        for (let r = 0; r < ctx.rotStates; r++) if (r * 45 !== g.rotation) alts.push(r * 45);
        if (alts.length) g.rotation = rng.pick(alts);
        break;
      }
      case 'order': {
        if (c.struct !== 'row') break;
        c.glyphs = rng.shuffle(c.glyphs);
        reflowRow(c);
        break;
      }
      default:
        break;
    }
  }
  return finishCell(c);
}

function countDiffs(a, b) {
  if (a.glyphs.length !== b.glyphs.length) return 3;
  let n = 0;
  for (let i = 0; i < a.glyphs.length; i++) {
    for (const k of ['shape', 'size', 'fill', 'color', 'rotation', 'lineWeight', 'count']) {
      if (a.glyphs[i][k] !== b.glyphs[i][k]) n++;
    }
  }
  return n;
}

/* ------------------------------------------------------------ op planning */

function makeOp(rng, key, cell, ctx) {
  const sels = selsFor(cell.struct, key).filter((s) => selectIdx(cell, s).length > 0);
  if (!sels.length && OP_INFO[key] && !OP_INFO[key].changesStruct) return null;
  const sel = sels.length ? rng.pick(sels) : 'all';
  switch (key) {
    case 'sizeShift':
      return { key, sel, k: rng.bool(0.6) ? 1 : -1 };
    case 'rotate':
      return { key, sel, deg: rng.pick([45, 90, 135, 180]) };
    case 'colorShift':
      return { key, sel, k: rng.int(1, COLOR_MAX + 1) };
    case 'fillSet':
      return { key, sel, fill: rng.pick(cell.struct === 'nested' ? ctx.hollowFills : ctx.fillPool) };
    case 'lwShift':
      return { key, sel, k: rng.bool(0.6) ? 1 : -1 };
    case 'shapeMap':
      return { key, sel, shift: rng.int(1, ctx.shapePool.length) };
    case 'countShift':
      return { key, sel, k: rng.bool(0.7) ? 1 : -1 };
    case 'countDouble':
      return { key, sel: 'all' };
    case 'sortBySize':
      return { key, sel: 'all', dir: rng.bool(0.5) ? 'asc' : 'desc' };
    case 'wrapInto':
      return { key, sel: 'all', shape: rng.pick(ctx.shapePool) };
    default:
      return { key, sel: 'all' };
  }
}

function composeOps(rng, opKeys, A, C, ctx) {
  const ops = [];
  let a = A;
  let c = C;
  for (const key of opKeys) {
    let placed = null;
    for (let t = 0; t < 12 && !placed; t++) {
      const op = makeOp(rng, key, a, ctx);
      if (!op) continue;
      const a2 = runOp(op, a, ctx);
      if (!a2) continue;
      const c2 = runOp(op, c, ctx);
      if (!c2) continue;
      if (keyOf(a2) === keyOf(a) || rkeyOf(a2) === rkeyOf(a)) continue;
      if (keyOf(c2) === keyOf(c) || rkeyOf(c2) === rkeyOf(c)) continue;
      placed = { op, a2, c2 };
    }
    if (!placed) return null;
    ops.push(placed.op);
    a = placed.a2;
    c = placed.c2;
  }
  return { ops, B: a, D: c };
}

function planOpKeys(rng, struct, opCount, relationalCount) {
  const pools = OPS_BY_STRUCT[struct];
  const rel = sampleK(rng, pools.rel, Math.min(relationalCount, pools.rel.length));
  const attr = sampleK(rng, pools.attr, Math.max(0, opCount - rel.length));
  let keys = rel.concat(attr).slice(0, opCount);
  if (!keys.length) keys = [rng.pick(pools.attr)];
  // At most one structure-changing op, and it must run last.
  const changers = keys.filter((k) => OP_INFO[k].changesStruct);
  const rest = keys.filter((k) => !OP_INFO[k].changesStruct);
  const ordered = rng.shuffle(rest);
  if (changers.length) ordered.push(changers[0]);
  return ordered.slice(0, opCount).length ? ordered.slice(0, opCount) : [rng.pick(pools.attr)];
}

function samplePlan(rng, p) {
  const r = rng.next();
  let struct;
  if (r < 0.55 - 0.42 * p) struct = 'single';
  else if (r < 0.80 - 0.10 * p) struct = 'nested';
  else struct = 'row';
  const opCount = clampInt(1 + p * 2 + (rng.next() - 0.5) * 1.1, 1, 3);
  const relationalCount = clampInt(p * opCount + (rng.next() - 0.5) * 0.9, 0, opCount);
  const nDiff = clampInt(1 + p * 2 + (rng.next() - 0.5), 1, 3);
  return { struct, opCount, relationalCount, nDiff, opKeys: planOpKeys(rng, struct, opCount, relationalCount), p };
}

/* ------------------------------------------------------------------ build */

function buildItemModel(rng, plan) {
  const ctx = makeCtx(rng, plan);
  if (!ctx) return null;
  const A = randomCell(rng, ctx);
  if (!A) return null;
  const C = siblingCell(rng, A, ctx, plan.nDiff);
  if (!C) return null;
  if (keyOf(A) === keyOf(C) || rkeyOf(A) === rkeyOf(C)) return null;

  const composed = composeOps(rng, plan.opKeys, A, C, ctx);
  if (!composed) return null;
  const { ops, B, D } = composed;

  if (keyOf(B) === keyOf(D) || rkeyOf(B) === rkeyOf(D)) return null;
  if (keyOf(C) === keyOf(D) || rkeyOf(C) === rkeyOf(D)) return null;
  if (keyOf(A) === keyOf(B)) return null;

  let orderDependent = false;
  if (ops.length >= 2) {
    const reversed = applyOps(ops.slice().reverse(), A, ctx);
    orderDependent = !reversed || keyOf(reversed) !== keyOf(B);
  }

  return { ctx, ops, A, B, C, D, struct: plan.struct, nDiff: countDiffs(A, C), orderDependent };
}

function metaFor(model, optionCount) {
  const ruleTypes = model.ops.map((op) => OP_INFO[op.key].ruleType);
  const tag = STRUCT_TAG[model.struct];
  if (tag) ruleTypes.push(tag);
  const relationalCount = model.ops.reduce((n, op) => n + (OP_INFO[op.key].relational ? 1 : 0), 0);
  // A composition whose result depends on the order of its parts genuinely has
  // to be traced step by step rather than read off as a bag of changes.
  if (model.orderDependent) ruleTypes.push('ruleChaining');

  const ruleCount = ruleTypes.length;
  const abstractness = abstractnessOf(ruleTypes);
  // Marks painted in the prompt; the blank fourth cell contributes nothing.
  let elementCount = 0;
  for (const cell of [model.A, model.B, model.C]) {
    for (const g of cell.glyphs) elementCount += g.count;
  }
  elementCount = Math.max(1, elementCount);

  const wmLoad = clampInt(model.ops.length + (model.struct === 'single' ? 0 : 1) + relationalCount, 1, 6);

  const opBonus = model.ops.reduce((s, op) => s + (Number.isFinite(OP_SALIENCE[op.key]) ? OP_SALIENCE[op.key] : 0), 0);
  let salience = 0.34 + opBonus;
  salience -= 0.085 * relationalCount;
  salience -= 0.05 * (model.ops.length - 1);
  if (model.struct !== 'single') salience -= 0.07;
  if (model.orderDependent) salience -= 0.05;
  salience -= 0.035 * Math.max(0, model.nDiff - 1);
  salience = Math.max(0.03, Math.min(0.44, salience));

  return {
    ruleCount,
    ruleTypes,
    abstractness: round3(abstractness),
    elementCount,
    distractorSystematicity: 0,
    wmLoad,
    perceptualSalience: round3(salience),
    optionCount,
    generatorVersion: GENERATOR_VERSION,
    relationalCount
  };
}

/* ------------------------------------------------------------ distractors */

function altSel(sel, struct) {
  if (struct === 'nested') {
    if (sel === 'outer') return 'inner';
    if (sel === 'inner') return 'outer';
    return 'inner';
  }
  if (struct === 'row') {
    if (sel === 'largest') return 'smallest';
    if (sel === 'smallest') return 'largest';
    if (sel === 'middle') return 'largest';
    return 'largest';
  }
  return 'all';
}

/** Round-robin over lure categories so every error mode is represented. */
function interleaveCategories(rng, categories) {
  const lists = categories.map((c) => rng.shuffle(c));
  const out = [];
  let more = true;
  for (let round = 0; more; round++) {
    more = false;
    for (const list of lists) {
      if (round < list.length) {
        out.push(list[round]);
        more = true;
      }
    }
  }
  return out;
}

function collectDistractors(rng, model) {
  const { ctx, ops, A, B, C, D } = model;
  const keyB = keyOf(B);
  const unchanged = [];
  const wrongElement = [];
  const wrongTransform = [];
  const misapplied = [];
  const surfaceMatch = [];
  const push = (list, cell) => { if (cell) list.push(cell); };
  const defeated = (alt) => {
    const r = applyOps(alt, A, ctx);
    return !r || keyOf(r) !== keyB;
  };

  // (i) the C item unchanged, and (ii) B itself - the two canonical analogy lures
  push(unchanged, C);
  push(unchanged, B);

  // (iii) the transformation applied to the wrong element of C
  for (let i = 0; i < ops.length; i++) {
    const alt = ops.map((op, j) => (j === i ? { ...op, sel: altSel(op.sel, A.struct) } : op));
    if (alt[i].sel === ops[i].sel) continue;
    if (!defeated(alt)) continue;
    push(wrongElement, applyOps(alt, C, ctx));
  }

  // (iv) a valid transformation, but the wrong one - a different operation, or
  // the same operation carrying a different parameter
  const pools = OPS_BY_STRUCT[A.struct];
  const allKeys = pools.attr.concat(pools.rel);
  for (let i = 0; i < ops.length; i++) {
    for (const key of rng.shuffle(allKeys).slice(0, 4)) {
      if (key === ops[i].key) continue;
      const swapOp = makeOp(rng, key, A, ctx);
      if (!swapOp) continue;
      const alt = ops.map((op, j) => (j === i ? swapOp : op));
      if (!defeated(alt)) continue;
      push(wrongTransform, applyOps(alt, C, ctx));
    }
    for (let t = 0; t < 5; t++) {
      const variant = makeOp(rng, ops[i].key, A, ctx);
      if (!variant) continue;
      const alt = ops.map((op, j) => (j === i ? variant : op));
      if (!defeated(alt)) continue;
      push(wrongTransform, applyOps(alt, C, ctx));
    }
  }

  // the mapping applied to the wrong source cell entirely
  push(wrongElement, applyOps(ops, B, ctx));

  // the right transformation run the wrong way round
  for (let i = 0; i < ops.length; i++) {
    const op = ops[i];
    let inv = null;
    if (op.key === 'sizeShift' || op.key === 'lwShift' || op.key === 'countShift') inv = { ...op, k: -op.k };
    else if (op.key === 'colorShift') inv = { ...op, k: -op.k };
    else if (op.key === 'rotate') inv = { ...op, deg: mod(-op.deg, 360) };
    else if (op.key === 'sortBySize') inv = { ...op, dir: op.dir === 'asc' ? 'desc' : 'asc' };
    if (!inv) continue;
    const alt = ops.map((o, j) => (j === i ? inv : o));
    if (!defeated(alt)) continue;
    push(wrongTransform, applyOps(alt, C, ctx));
  }

  // partial application: only the first k operations
  for (let k = 1; k < ops.length; k++) {
    const alt = ops.slice(0, k);
    if (!defeated(alt)) continue;
    push(misapplied, applyOps(alt, C, ctx));
  }

  // over-application: the whole mapping run twice
  const twice = ops.concat(ops);
  if (defeated(twice)) push(misapplied, applyOps(twice, C, ctx));

  // over-application of a single step, leaving the rest correct
  for (let i = 0; i < ops.length; i++) {
    const alt = ops.slice(0, i + 1).concat([ops[i]], ops.slice(i + 1));
    if (!defeated(alt)) continue;
    push(misapplied, applyOps(alt, C, ctx));
  }

  // the composition traced in the wrong order
  if (ops.length >= 2) {
    const rev = ops.slice().reverse();
    if (defeated(rev)) push(misapplied, applyOps(rev, C, ctx));
  }

  // one step of the mapping simply skipped
  for (let i = 0; i < ops.length && ops.length > 1; i++) {
    const alt = ops.filter((op, j) => j !== i);
    if (!defeated(alt)) continue;
    push(misapplied, applyOps(alt, C, ctx));
  }

  // (v) an attribute match to B rather than a relational match
  for (const attr of ['color', 'fill', 'shape', 'lineWeight']) {
    const c = cloneCell(C);
    const src = B.glyphs[0][attr];
    for (let i = 0; i < c.glyphs.length; i++) {
      if (c.struct === 'nested' && i === 0 && attr === 'fill' && !FILL_HOLLOW.includes(src)) continue;
      c.glyphs[i][attr] = src;
    }
    push(surfaceMatch, finishCell(c));
  }
  // A itself - a weak but genuine surface lure
  push(surfaceMatch, A);

  // the mapping carried out, but with an invariant copied from the first pair
  // instead of from C - the near-miss of a solver who fixed on the wrong source
  const carryover = [];
  for (const attr of ['shape', 'size', 'fill', 'color', 'lineWeight', 'count']) {
    for (const src of [A, B]) {
      const c = cloneCell(D);
      for (let i = 0; i < c.glyphs.length; i++) {
        const g = src.glyphs[Math.min(i, src.glyphs.length - 1)];
        if (c.struct === 'nested' && i === 0 && attr === 'fill' && !FILL_HOLLOW.includes(g[attr])) continue;
        c.glyphs[i][attr] = g[attr];
      }
      push(carryover, finishCell(c));
    }
  }

  const ordered = unchanged.concat(interleaveCategories(rng, [
    wrongElement, wrongTransform, surfaceMatch, misapplied, carryover
  ]));
  return ordered.filter((c) => c && keyOf(c) !== keyOf(D));
}

function randomLure(rng, model) {
  const c = cloneCell(model.D);
  const i = rng.int(0, c.glyphs.length);
  const g = c.glyphs[i];
  const attr = rng.pick(['color', 'fill', 'lineWeight', 'shape', 'size']);
  if (attr === 'color') g.color = mod(g.color + rng.int(1, COLOR_MAX + 1), COLOR_MAX + 1);
  else if (attr === 'fill') {
    const source = c.struct === 'nested' && i === 0 ? model.ctx.hollowFills : model.ctx.fillPool;
    const alts = source.filter((f) => f !== g.fill);
    if (!alts.length) return null;
    g.fill = rng.pick(alts);
  } else if (attr === 'lineWeight') g.lineWeight = mod(g.lineWeight + 1, LW_MAX + 1);
  else if (attr === 'shape') {
    const alts = model.ctx.shapePool.filter((s) => s !== g.shape);
    if (!alts.length) return null;
    g.shape = rng.pick(alts);
  } else {
    if (g.count > 1) return null;
    const alts = [];
    for (let s = 0; s <= SIZE_MAX; s++) if (s !== g.size) alts.push(s);
    g.size = rng.pick(alts);
  }
  return finishCell(c);
}

function buildOptions(rng, model, optionCount) {
  const need = optionCount - 1;
  const keys = new Set([keyOf(model.D)]);
  const rkeys = new Set([rkeyOf(model.D)]);
  const chosen = [];

  const tryPush = (cell, systematic) => {
    if (!cell || chosen.length >= need) return;
    const sk = keyOf(cell);
    const rk = rkeyOf(cell);
    if (keys.has(sk) || rkeys.has(rk)) return;
    keys.add(sk);
    rkeys.add(rk);
    chosen.push({ cell, systematic });
  };

  for (const c of collectDistractors(rng, model)) tryPush(c, true);
  for (let i = 0; i < 60 && chosen.length < need; i++) tryPush(randomLure(rng, model), false);
  if (chosen.length < need) return null;

  const systematicCount = chosen.reduce((n, c) => n + (c.systematic ? 1 : 0), 0);
  const answerIndex = rng.int(0, optionCount);
  const cells = [];
  let di = 0;
  for (let i = 0; i < optionCount; i++) cells.push(i === answerIndex ? model.D : chosen[di++].cell);
  return { cells, answerIndex, systematicity: need > 0 ? systematicCount / need : 1 };
}

/* -------------------------------------------------------------------- svg */

function blankSlot(cx, cy) {
  const s = CELL * 0.86;
  return el('rect', {
    x: round3(cx - s / 2),
    y: round3(cy - s / 2),
    width: round3(s),
    height: round3(s),
    rx: round3(CELL * 0.1),
    ry: round3(CELL * 0.1),
    fill: 'none',
    stroke: 'var(--line-strong, #7c8797)',
    'stroke-width': 2.5,
    'stroke-dasharray': '7 7',
    opacity: 0.9
  }, []);
}

function pairBar(cx, cy) {
  const half = BAR * 0.26;
  return el('line', {
    x1: round3(cx - half),
    y1: round3(cy),
    x2: round3(cx + half),
    y2: round3(cy),
    stroke: 'var(--stim-2, #8d99ab)',
    'stroke-width': 6,
    'stroke-linecap': 'round'
  }, []);
}

function promptSvg(model) {
  const scale = STRUCT_SCALE[model.struct] || 1;
  const width = PAD * 2 + 4 * CELL + 2 * BAR + RULE;
  const height = PAD * 2 + CELL;
  const cy = PAD + CELL / 2;

  const xA = PAD + CELL / 2;
  const xBarL = PAD + CELL + BAR / 2;
  const xB = PAD + CELL + BAR + CELL / 2;
  const xRule = PAD + 2 * CELL + BAR + RULE / 2;
  const xC = PAD + 2 * CELL + BAR + RULE + CELL / 2;
  const xBarR = PAD + 3 * CELL + BAR + RULE + BAR / 2;
  const xD = PAD + 3 * CELL + 2 * BAR + RULE + CELL / 2;

  // svgRoot prepends the shared <defs> itself; emitting it again here would put
  // two copies of the same pattern ids in one document.
  const parts = [];
  parts.push(pairBar(xBarL, cy));
  parts.push(pairBar(xBarR, cy));
  parts.push(el('line', {
    x1: round3(xRule),
    y1: round3(PAD * 0.4),
    x2: round3(xRule),
    y2: round3(height - PAD * 0.4),
    stroke: 'var(--stim-2, #8d99ab)',
    'stroke-width': 3,
    'stroke-linecap': 'round'
  }, []));

  parts.push(drawCell(model.A.glyphs, xA, cy, CELL * scale));
  parts.push(drawCell(model.B.glyphs, xB, cy, CELL * scale));
  parts.push(drawCell(model.C.glyphs, xC, cy, CELL * scale));
  parts.push(blankSlot(xD, cy));

  return {
    svg: svgRoot({
      width,
      height,
      viewBox: '0 0 ' + width + ' ' + height,
      className: 'stim stim-analogy',
      body: parts.join('')
    }),
    width,
    height
  };
}

function optionRender(glyphs, scale) {
  const size = CELL + OPT_PAD * 2;
  const body = drawCell(glyphs, size / 2, size / 2, CELL * scale);
  return {
    svg: svgRoot({
      width: size,
      height: size,
      viewBox: '0 0 ' + size + ' ' + size,
      className: 'stim stim-option',
      body
    }),
    width: size,
    height: size
  };
}

/* --------------------------------------------------------------- generate */

/**
 * CONTRACTS.md section 9 admits exactly two option counts, and registry.auditItem
 * rejects anything else, so an odd request is snapped to the nearer legal value
 * rather than honoured into an unauditable item.
 */
function normaliseOptionCount(optionCount) {
  if (!Number.isFinite(optionCount)) return 8;
  return Math.round(optionCount) <= 6 ? 6 : 8;
}

function chooseModel(rng, target, optionCount) {
  const lo = bRange[0];
  const hi = bRange[1];
  const wanted = Math.max(lo, Math.min(hi, target));
  const p = (wanted - lo) / (hi - lo);
  let best = null;
  let bestErr = Infinity;
  let fallback = null;
  let fallbackErr = Infinity;

  for (let i = 0; i < PLAN_SAMPLES; i++) {
    // Explore either side of the point estimate: the plan space is discrete, so
    // a single pressure value can miss the band that actually brackets targetB.
    const pj = Math.max(0, Math.min(1, p + (rng.next() - 0.5) * 0.44));
    const plan = samplePlan(rng, pj);
    const model = buildItemModel(rng, plan);
    if (!model) continue;
    const meta = metaFor(model, optionCount);
    const b = predictB(meta);
    const err = Math.abs(b - wanted);
    if (err < fallbackErr) { fallbackErr = err; fallback = { model, meta, b }; }
    // bRange is what the family guarantees to cover. The search may drift past it
    // by at most registry.RANGE_TOLERANCE so an extreme target is still hit sharply.
    if (b < lo - RANGE_TOLERANCE || b > hi + RANGE_TOLERANCE) continue;
    if (err < bestErr) { bestErr = err; best = { model, meta, b }; }
    if (bestErr < 0.08) break;
  }
  return best || fallback;
}

export function generate(rng, spec) {
  const options = spec || {};
  const optionCount = normaliseOptionCount(options.optionCount);
  const target = Number.isFinite(options.targetB) ? options.targetB : 0;
  const seed = rng.int(1, 2147483647);

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const picked = chooseModel(rng, target, optionCount);
    if (!picked) continue;
    const model = picked.model;
    const built = buildOptions(rng, model, optionCount);
    if (!built) continue;
    // The contract targets systematic distractors; a thin lure space means this
    // particular mapping does not discriminate, so try a different one.
    if (built.systematicity < 0.7 && attempt < MAX_ATTEMPTS - 6) continue;

    const scale = STRUCT_SCALE[model.struct] || 1;
    const prompt = promptSvg(model);
    const optionList = built.cells.map((cell, i) => {
      const r = optionRender(cell.glyphs, scale);
      return { id: 'o' + i, svg: r.svg, width: r.width, height: r.height };
    });

    const correctKey = keyOf(model.D);
    let matches = 0;
    for (const cell of built.cells) if (keyOf(cell) === correctKey) matches++;
    if (matches !== 1) continue;
    if (keyOf(built.cells[built.answerIndex]) !== correctKey) continue;

    const sKeys = new Set(built.cells.map(keyOf));
    const rKeys = new Set(built.cells.map(rkeyOf));
    if (sKeys.size !== optionCount || rKeys.size !== optionCount) continue;

    if (prompt.svg.indexOf('<text') !== -1) continue;
    if (optionList.some((o) => o.svg.indexOf('<text') !== -1)) continue;

    const meta = picked.meta;
    delete meta.relationalCount;
    meta.distractorSystematicity = round3(built.systematicity);
    meta.optionCount = optionCount;

    return {
      id: family + ':' + seed + ':' + attempt,
      family,
      seed,
      prompt,
      options: optionList,
      answerId: 'o' + built.answerIndex,
      meta,
      irt: null
    };
  }

  throw new Error('analogy.generate: could not build a valid item after ' + MAX_ATTEMPTS + ' attempts');
}
