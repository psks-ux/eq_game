/**
 * Visual-series completion: 5-7 cells on a tick-marked geometric rail, one of them
 * blank (often an interior cell). Rules are progressions, alternations, interleaved
 * dual streams and cycles whose period exceeds the visible window.
 */

import { SHAPE_KEYS, FILLS, COLORS, SIZES, LINE_WEIGHTS } from './shapes.js';
import { svgRoot, el, drawCell, cellKey } from './svg.js';
import { describeRuleSet } from './rules.js';
import { priorIrtParams } from './calibration.js';

export const family = 'series';
export const bRange = [-1.5, 5.0];
export const contentGroup = 'induction';

const GENERATOR_VERSION = 1;
const MAX_ATTEMPTS = 50;
const PLAN_SAMPLES = 72;
/** Mirrors registry.js's own out-of-range tolerance when routing a targetB. */
const RANGE_TOLERANCE = 0.25;

/* ------------------------------------------------------------------ layout */

const CELL = 96;
const GAP = 20;
const PAD = 22;
const RAIL_DROP = 20;
const RAIL_TICK = 8;
const OPT_PAD = 10;
const POS_R = 0.34; // offset radius for position tracks, in cell/2 units

/* ------------------------------------------------- attribute value domains */

const SIZE_MAX = Math.max(1, SIZES.length - 1);
const COLOR_MAX = Math.max(1, COLORS.length - 1);
const LW_MAX = Math.max(0, LINE_WEIGHTS.length - 1);

const FILL_ORDER = ['empty', 'solid', 'hStripe', 'vStripe', 'dStripe', 'dots', 'half'];
const FILL_ALL = pickAvailable(FILL_ORDER, FILLS);
/* Striped and half fills read differently once a shape turns, so a varying
   rotation track is only ever paired with orientation-neutral fills. */
const FILL_ROT_SAFE = pickAvailable(['empty', 'solid', 'dots'], FILLS);
/* A nested outer shape must not hide the glyph inside it. */
const FILL_HOLLOW = pickAvailable(['empty', 'hStripe', 'vStripe', 'dStripe', 'dots'], FILLS);
const FILL_HOLLOW_ROT_SAFE = pickAvailable(['empty', 'dots'], FILLS);

/**
 * Rotational self-coincidence measured in 45-degree units: a shape with value s
 * has exactly s visually distinct orientations on our 45-degree rotation grid.
 * Unknown keys default to 1 (assume invisible) so we never build a rule on a
 * rotation the solver cannot see.
 */
const ROT_STEPS = {
  circle: 1, ring: 1, dot: 1, octagon: 1,
  square: 2, roundedSquare: 2, diamond: 2,
  ellipse: 4, rectangle: 4, bar: 4, parallelogram: 4, hexagon: 4, zShape: 4,
  semicircle: 8, quarterDisc: 8, arc: 8, notchedCircle: 8, notchedSquare: 8,
  triangleUp: 8, triangleDown: 8, triangleLeft: 8, triangleRight: 8, rightTriangle: 8,
  trapezoid: 8, pentagon: 8, lShape: 8, tShape: 8, uShape: 8
};

/**
 * Shapes that can render identically to one another under some rotation live in
 * the same class; at most one member of a class is ever used inside one item, so
 * two options can never collide visually through a shape/rotation coincidence.
 */
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

/** Canonical redraw of shapes that are one another under a fixed rotation. */
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

const ATTRS = ['shape', 'size', 'fill', 'color', 'rotation', 'lineWeight', 'count', 'pos'];

const VARY_ATTRS = {
  single: ['shape', 'size', 'fill', 'color', 'rotation', 'lineWeight', 'count', 'pos'],
  outer: ['shape', 'fill', 'color', 'rotation', 'lineWeight'],
  inner: ['shape', 'size', 'fill', 'color', 'rotation', 'count', 'pos']
};

/**
 * How much a surface heuristic ("the obvious thing keeps happening") is worth on
 * each dimension. A growing shape is close to self-evident; a creeping line
 * weight is not. Feeds meta.perceptualSalience.
 */
const ATTR_SALIENCE = {
  size: 0.09,
  count: 0.08,
  shape: 0.04,
  pos: 0.02,
  color: 0.02,
  fill: -0.02,
  rotation: -0.04,
  lineWeight: -0.06
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

/* --------------------------------------------------------------- glyph key */

function baseGlyph() {
  return {
    shape: SHAPE_CLASSES[0][0],
    size: Math.min(2, SIZE_MAX),
    fill: FILL_ALL[0],
    color: 0,
    rotation: 0,
    lineWeight: Math.min(1, LW_MAX),
    dx: 0,
    dy: 0,
    count: 1
  };
}

function canonRotation(glyph) {
  const canon = SHAPE_CANON[glyph.shape];
  const shape = canon ? canon[0] : glyph.shape;
  const base = canon ? canon[1] : 0;
  const steps = rotSteps(shape);
  const units = Math.round((base + (glyph.rotation || 0)) / 45);
  return [shape, mod(units, steps)];
}

/**
 * Visual identity of a cell. Two options that would paint the same pixels share
 * a renderKey even when their raw field values differ: a rotation applied to a
 * rotationally symmetric shape, or a diamond versus a square turned 45 degrees.
 * A line weight carried on a replicated glyph is also folded away: svg.js does
 * keep the three weights apart at every count, but on a size-0 glyph replicated
 * five times the difference is a fraction of a pixel, which is not a difference a
 * solver can be asked to see. Deliberately stricter than cellKey.
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

/* ------------------------------------------------------------------ tracks */

const HORIZON = 48;

function finishTrack(t) {
  t.valueAt = (i) => t.values[t.indexAt(i)];
  t.period = t.kind === 'const' ? 1 : periodOf(t);
  return t;
}

function periodOf(t) {
  const seq = [];
  for (let i = 0; i < HORIZON; i++) seq.push(t.indexAt(i));
  for (let p = 1; p <= HORIZON / 2; p++) {
    let ok = true;
    for (let i = 0; i + p < HORIZON; i++) {
      if (seq[i] !== seq[i + p]) { ok = false; break; }
    }
    if (ok) return p;
  }
  return HORIZON;
}

function constTrack(attr, value) {
  return finishTrack({
    attr,
    kind: 'const',
    ruleType: null,
    varying: false,
    values: [value],
    indexAt: () => 0
  });
}

function stepTrack(attr, values, start, inc, ruleType) {
  const n = values.length;
  return finishTrack({
    attr,
    kind: 'step',
    ruleType,
    varying: true,
    values,
    start,
    inc,
    indexAt: (i) => mod(start + i * inc, n)
  });
}

function bounceTrack(attr, values, start, ruleType) {
  const n = values.length;
  const P = Math.max(1, 2 * n - 2);
  return finishTrack({
    attr,
    kind: 'bounce',
    ruleType,
    varying: true,
    values,
    start,
    indexAt: (i) => {
      const k = mod(start + i, P);
      return k < n ? k : P - k;
    }
  });
}

/** Alternating increments (small turn, big turn, small turn ...) - rule chaining. */
function dualStepTrack(attr, values, start, incA, incB, ruleType) {
  const n = values.length;
  return finishTrack({
    attr,
    kind: 'dualStep',
    ruleType,
    varying: true,
    values,
    start,
    incA,
    incB,
    indexAt: (i) => {
      const whole = Math.floor(i / 2);
      const half = i - whole * 2;
      return mod(start + whole * (incA + incB) + half * incA, n);
    }
  });
}

function ruleTypeFor(attr, kind, poolLen) {
  if (kind === 'dualStep') return 'ruleChaining';
  if (attr === 'rotation') return 'rotation';
  if (attr === 'pos') return 'translation';
  if (attr === 'count') return 'quantityProgression';
  if (attr === 'size') return 'sizeOrdering';
  if (poolLen === 2) return 'sequenceAlternation';
  if (poolLen === 3 && kind === 'step') return 'distributionOfThree';
  return 'progression';
}

/* -------------------------------------------------------------- cell build */

function applyAttr(glyph, attr, value) {
  if (attr === 'pos') {
    if (value < 0) {
      glyph.dx = 0;
      glyph.dy = 0;
    } else {
      const a = (value * Math.PI) / 4;
      glyph.dx = round3(POS_R * Math.cos(a));
      glyph.dy = round3(POS_R * Math.sin(a));
    }
    return;
  }
  glyph[attr] = value;
}

function buildCell(sub, k, override) {
  return sub.layers.map((layer, li) => {
    const g = baseGlyph();
    for (const attr of ATTRS) {
      const track = layer[attr];
      if (!track) continue;
      const key = li + ':' + attr;
      const has = override && Object.prototype.hasOwnProperty.call(override, key);
      applyAttr(g, attr, has ? override[key] : track.valueAt(k));
    }
    return g;
  });
}

/* ----------------------------------------------------------- layer builder */

function pickShapePool(rng, k, usedClasses, requireRotSafe) {
  let avail = SHAPE_CLASSES
    .map((cls, i) => i)
    .filter((i) => !usedClasses.has(i))
    .filter((i) => !requireRotSafe || SHAPE_CLASSES[i].some((s) => rotSteps(s) >= 4));
  if (avail.length === 0) {
    usedClasses.clear();
    avail = SHAPE_CLASSES
      .map((cls, i) => i)
      .filter((i) => !requireRotSafe || SHAPE_CLASSES[i].some((s) => rotSteps(s) >= 4));
  }
  if (avail.length === 0) return null;
  const want = Math.max(1, Math.min(k, avail.length));
  const chosen = sampleK(rng, avail, want);
  const pool = [];
  for (const ci of chosen) {
    usedClasses.add(ci);
    const members = requireRotSafe
      ? SHAPE_CLASSES[ci].filter((s) => rotSteps(s) >= 4)
      : SHAPE_CLASSES[ci];
    pool.push(rng.pick(members.length ? members : SHAPE_CLASSES[ci]));
  }
  return pool;
}

function poolSizeFor(rng, p, lo, hi) {
  const span = hi - lo;
  const v = lo + Math.round(p * span + (rng.next() - 0.5) * 1.2);
  return Math.max(lo, Math.min(hi, v));
}

function chooseKind(rng, attr, poolLen, p, allowChained) {
  if (allowChained && poolLen >= 6 && rng.next() < 0.28 + 0.35 * p) return 'dualStep';
  if (poolLen >= 3 && rng.next() < 0.18 + 0.30 * p) return 'bounce';
  return 'step';
}

/**
 * Builds one layer of one sub-series: a track per attribute, `nVary` of which
 * actually move. Returns null when the constraint solver cannot satisfy the
 * request (e.g. no rotation-safe shape class is left).
 */
function buildLayer(rng, opts) {
  const { role, nVary, p, usedClasses, allowChained } = opts;
  if (!opts.colorPool || !opts.colorPool.length) return null;
  const candidates = VARY_ATTRS[role].slice();
  let vary = sampleK(rng, candidates, Math.min(nVary, candidates.length));

  // Constraint resolution -------------------------------------------------
  const varySet = new Set(vary);
  const rotationVaries = varySet.has('rotation');
  const countVaries = varySet.has('count');
  // Replicated glyphs already fill the cell; do not also slide them around.
  if (countVaries && varySet.has('pos')) {
    varySet.delete('pos');
    vary = vary.filter((a) => a !== 'pos');
  }
  const posVaries = varySet.has('pos');

  const shapePool = pickShapePool(rng, varySet.has('shape') ? poolSizeFor(rng, p, 2, 4) : 1, usedClasses, rotationVaries);
  if (!shapePool) return null;
  const minRot = Math.min(...shapePool.map(rotSteps));
  if (rotationVaries && minRot < 4) return null;

  const fillSource = role === 'outer'
    ? (rotationVaries ? FILL_HOLLOW_ROT_SAFE : FILL_HOLLOW)
    : (rotationVaries ? FILL_ROT_SAFE : FILL_ALL);
  if (fillSource.length < (varySet.has('fill') ? 2 : 1)) return null;

  // size domain
  let sizeLo = 0;
  let sizeHi = SIZE_MAX;
  if (role === 'outer') { sizeLo = Math.max(0, SIZE_MAX - 1); sizeHi = SIZE_MAX; }
  else if (role === 'inner') { sizeLo = 0; sizeHi = Math.min(1, SIZE_MAX); }
  // Replicated glyphs only stay inside their cell at the smallest step.
  if (countVaries) { sizeLo = 0; sizeHi = 0; }
  else if (posVaries) sizeHi = Math.min(sizeHi, Math.min(1, SIZE_MAX));
  if (sizeHi < sizeLo) sizeHi = sizeLo;
  const sizeDomain = [];
  for (let s = sizeLo; s <= sizeHi; s++) sizeDomain.push(s);
  if (varySet.has('size') && sizeDomain.length < 2) {
    vary = vary.filter((a) => a !== 'size');
    varySet.delete('size');
  }
  if (role === 'outer' && varySet.has('size')) {
    vary = vary.filter((a) => a !== 'size');
    varySet.delete('size');
  }

  const layer = {};
  const varyingTracks = [];

  for (const attr of ATTRS) {
    const varies = varySet.has(attr);
    let pool = null;
    switch (attr) {
      case 'shape':
        pool = shapePool;
        break;
      case 'size':
        pool = sizeDomain;
        break;
      case 'fill':
        pool = varies ? sampleK(rng, fillSource, poolSizeFor(rng, p, 2, Math.min(4, fillSource.length))) : [rng.pick(fillSource)];
        break;
      case 'color': {
        const all = opts.colorPool;
        pool = varies ? sampleK(rng, all, poolSizeFor(rng, p, 2, Math.min(4, all.length))) : [rng.pick(all)];
        break;
      }
      case 'rotation': {
        const states = minRot;
        const all = [];
        for (let i = 0; i < states; i++) all.push(i * 45);
        pool = all;
        break;
      }
      case 'lineWeight': {
        const all = [];
        for (let i = 0; i <= LW_MAX; i++) all.push(i);
        pool = all;
        break;
      }
      case 'count': {
        const hi = countVaries ? (rng.bool(0.5) ? 3 : 4) : 1;
        const all = [];
        for (let i = 1; i <= hi; i++) all.push(i);
        pool = all;
        break;
      }
      case 'pos': {
        if (!varies) { pool = [-1]; break; }
        const ring = rng.bool(0.45 + 0.3 * p) ? [0, 1, 2, 3, 4, 5, 6, 7] : [0, 2, 4, 6];
        pool = ring;
        break;
      }
      default:
        pool = [0];
    }

    if (!varies || !pool || pool.length < 2) {
      const v = attr === 'pos' ? -1 : (pool && pool.length ? rng.pick(pool) : baseGlyph()[attr]);
      layer[attr] = constTrack(attr, v);
      continue;
    }

    const n = pool.length;
    const kind = chooseKind(rng, attr, n, p, allowChained && (attr === 'rotation' || attr === 'pos' || attr === 'color'));
    const start = rng.int(0, n);
    const ruleType = ruleTypeFor(attr, kind, n);
    let track;
    if (kind === 'bounce') {
      track = bounceTrack(attr, pool, start, ruleType);
    } else if (kind === 'dualStep') {
      const incA = 1;
      const incB = rng.bool(0.5) ? 2 : 3;
      track = dualStepTrack(attr, pool, start, incA, incB, ruleType);
    } else {
      const incs = [1];
      if (n >= 5) incs.push(2);
      if (n >= 7) incs.push(3);
      const inc = rng.pick(incs) * (rng.bool(0.28) ? -1 : 1);
      track = stepTrack(attr, pool, start, inc, ruleType);
    }
    if (track.period < 2) {
      layer[attr] = constTrack(attr, pool[start % n]);
      continue;
    }
    layer[attr] = track;
    varyingTracks.push(track);
  }

  return { layer, varyingTracks, shapePool, sizeDomain, fillSource, minRot, colorPool: opts.colorPool };
}

/* ------------------------------------------------------------ sub-series */

function buildSub(rng, opts) {
  const { layers, nVary, p, usedClasses, span, allowChained } = opts;
  const roles = layers === 2 ? ['outer', 'inner'] : ['single'];
  const caps = layers === 2 ? [VARY_ATTRS.outer.length, VARY_ATTRS.inner.length] : [VARY_ATTRS.single.length];

  const perLayer = [0, 0];
  if (layers === 2) {
    let outer = rng.int(0, Math.min(nVary, caps[0]) + 1);
    let inner = nVary - outer;
    if (inner > caps[1]) { inner = caps[1]; outer = nVary - inner; }
    if (outer < 0) outer = 0;
    if (outer === 0 && inner === 0) inner = 1;
    perLayer[0] = outer;
    perLayer[1] = inner;
  } else {
    perLayer[0] = Math.max(1, Math.min(nVary, caps[0]));
  }

  // Nested layers draw from disjoint halves of the palette so a patterned
  // container can never camouflage the glyph inside it.
  const allColors = [];
  for (let i = 0; i <= COLOR_MAX; i++) allColors.push(i);
  const shuffled = rng.shuffle(allColors);
  const cut = Math.max(1, Math.floor(shuffled.length / 2));
  const colorPools = layers === 2
    ? [shuffled.slice(0, cut), shuffled.slice(cut)]
    : [shuffled];

  const built = [];
  for (let i = 0; i < roles.length; i++) {
    const b = buildLayer(rng, {
      role: roles[i],
      nVary: perLayer[i],
      p,
      usedClasses,
      allowChained,
      colorPool: colorPools[i]
    });
    if (!b) return null;
    built.push(b);
  }

  const sub = {
    span,
    layers: built.map((b) => b.layer),
    meta: built,
    varyingTracks: []
  };
  built.forEach((b, li) => {
    b.varyingTracks.forEach((t) => sub.varyingTracks.push({ layerIdx: li, attr: t.attr, track: t }));
  });
  if (sub.varyingTracks.length === 0) return null;
  sub.cellAt = (k, override) => buildCell(sub, k, override);
  return sub;
}

/* ---------------------------------------------------------------- model */

function buildModel(rng, plan) {
  const usedClasses = new Set();
  const subs = [];
  if (plan.interleaved) {
    const spanA = Math.ceil(plan.cellCount / 2);
    const spanB = Math.floor(plan.cellCount / 2);
    for (let i = 0; i < 2; i++) {
      const s = buildSub(rng, {
        layers: 1,
        nVary: plan.nVaryPerSub[i],
        p: plan.p,
        usedClasses,
        span: i === 0 ? spanA : spanB,
        allowChained: false
      });
      if (!s) return null;
      subs.push(s);
    }
  } else {
    const s = buildSub(rng, {
      layers: plan.layers,
      nVary: plan.nVary,
      p: plan.p,
      usedClasses,
      span: plan.cellCount,
      allowChained: plan.allowChained
    });
    if (!s) return null;
    subs.push(s);
  }

  const model = {
    cellCount: plan.cellCount,
    missingIndex: plan.missingIndex,
    interleaved: plan.interleaved,
    layers: plan.interleaved ? 1 : plan.layers,
    subs,
    interior: plan.missingIndex > 0 && plan.missingIndex < plan.cellCount - 1
  };
  model.subIndexOf = (t) => (model.interleaved ? mod(t, 2) : 0);
  model.localIndex = (t) => (model.interleaved ? Math.floor(t / 2) : t);
  model.subOf = (t) => model.subs[model.subIndexOf(t)];
  model.cellAt = (t, override) => model.subOf(t).cellAt(model.localIndex(t), override);

  model.varyingCount = subs.reduce((n, s) => n + s.varyingTracks.length, 0);
  model.longPeriod = subs.some((s) => s.varyingTracks.some((v) => v.track.period > s.span));

  if (!evidenceOk(model)) return null;
  if (!distinctCells(model)) return null;
  return model;
}

/** Every visible cell must be distinct, otherwise the rail reads as static. */
function distinctCells(model) {
  const seen = new Set();
  for (let t = 0; t < model.cellCount; t++) {
    const k = renderKey(model.cellAt(t));
    if (seen.has(k)) return false;
    seen.add(k);
  }
  return true;
}

/**
 * Guarantees the blank is recoverable: every sub-stream shows at least three
 * cells and one adjacent pair, bounce tracks show a full period, and chained
 * tracks show a run of three consecutive cells.
 */
function evidenceOk(model) {
  for (let si = 0; si < model.subs.length; si++) {
    const sub = model.subs[si];
    const missLocal = model.subIndexOf(model.missingIndex) === si ? model.localIndex(model.missingIndex) : -1;
    const vis = [];
    for (let k = 0; k < sub.span; k++) if (k !== missLocal) vis.push(k);
    if (vis.length < 3) return false;
    let pair = false;
    for (let i = 0; i + 1 < vis.length; i++) if (vis[i + 1] === vis[i] + 1) pair = true;
    if (!pair) return false;

    for (const v of sub.varyingTracks) {
      const tr = v.track;
      if (tr.kind === 'bounce') {
        if (tr.period > sub.span - 1) return false;
        if (missLocal >= 0 && !(missLocal - tr.period >= 0 || missLocal + tr.period <= sub.span - 1)) return false;
      }
      if (tr.kind === 'dualStep') {
        let run = false;
        for (let k = 0; k + 2 < sub.span; k++) {
          if (k !== missLocal && k + 1 !== missLocal && k + 2 !== missLocal) run = true;
        }
        if (!run) return false;
      }
    }
  }
  return true;
}

/* ------------------------------------------------------------------ plans */

function samplePlan(rng, p) {
  const interleaved = rng.next() < Math.max(0, p - 0.42) * 1.9;
  const layers = interleaved ? 1 : (rng.next() < p * 0.8 ? 2 : 1);
  let cellCount;
  if (interleaved) cellCount = 7;
  else cellCount = clampInt(5 + p * 2 + (rng.next() - 0.5) * 1.4, 5, 7);

  const maxVary = interleaved ? 2 : (layers === 2 ? 3 : 4);
  const nVary = clampInt(1 + p * (maxVary - 1) + (rng.next() - 0.5) * 1.0, 1, maxVary);

  const interior = rng.next() < 0.38 + 0.45 * p;
  let missingIndex;
  if (interleaved) {
    const evens = [];
    for (let i = 0; i < cellCount; i += 2) evens.push(i);
    const pool = interior ? evens.filter((i) => i > 0 && i < cellCount - 1) : evens.filter((i) => i === 0 || i === cellCount - 1);
    missingIndex = rng.pick(pool.length ? pool : evens);
  } else if (interior) {
    const pool = [];
    for (let i = 1; i < cellCount - 1; i++) pool.push(i);
    missingIndex = rng.pick(pool);
  } else {
    missingIndex = rng.bool(0.68) ? cellCount - 1 : 0;
  }

  const nVaryPerSub = interleaved
    ? [clampInt(1 + p + (rng.next() - 0.5), 1, 2), clampInt(1 + p + (rng.next() - 0.5), 1, 2)]
    : [nVary];

  return {
    p,
    cellCount,
    missingIndex,
    interleaved,
    layers,
    nVary,
    nVaryPerSub,
    allowChained: !interleaved && rng.next() < Math.max(0, p - 0.34) * 2.2
  };
}

function metaFor(model, optionCount) {
  const ruleTypes = [];
  for (const sub of model.subs) {
    for (const v of sub.varyingTracks) ruleTypes.push(v.track.ruleType || 'progression');
  }
  if (model.interleaved) ruleTypes.push('sequenceAlternation');
  if (model.layers === 2) ruleTypes.push('containment');

  const ruleCount = ruleTypes.length;
  const abstractness = abstractnessOf(ruleTypes);

  // Marks actually painted in the prompt; the blank cell contributes nothing.
  let elementCount = 0;
  for (let t = 0; t < model.cellCount; t++) {
    if (t === model.missingIndex) continue;
    for (const g of model.cellAt(t)) elementCount += g.count;
  }
  elementCount = Math.max(1, elementCount);

  let wm = model.varyingCount;
  if (model.interleaved) wm += 1;
  if (model.layers === 2) wm += 1;
  const wmLoad = clampInt(wm, 1, 6);

  const varyAttrs = [];
  for (const sub of model.subs) for (const v of sub.varyingTracks) varyAttrs.push(v.attr);
  const attrBonus = meanOf(varyAttrs.map((a) => (Number.isFinite(ATTR_SALIENCE[a]) ? ATTR_SALIENCE[a] : 0)));
  const hasHardKind = model.subs.some((s) => s.varyingTracks.some((v) => v.track.kind !== 'step'));

  let salience = 0.50 + attrBonus;
  if (model.varyingCount === 1) salience += 0.14;
  salience -= 0.09 * Math.max(0, model.varyingCount - 1);
  salience += model.interior ? -0.10 : 0.10;
  if (model.interleaved) salience -= 0.18;
  if (model.longPeriod) salience -= 0.10;
  if (model.layers === 2) salience -= 0.09;
  salience += hasHardKind ? -0.10 : 0.06;
  salience = Math.max(0.03, Math.min(0.85, salience));

  return {
    ruleCount,
    ruleTypes,
    abstractness: round3(abstractness),
    elementCount,
    distractorSystematicity: 0,
    wmLoad,
    perceptualSalience: round3(salience),
    optionCount,
    generatorVersion: GENERATOR_VERSION
  };
}

/* ------------------------------------------------------------ distractors */

function cloneGlyphs(glyphs) {
  return glyphs.map((g) => ({ ...g }));
}

function altValues(rng, model, layerIdx, attr, current, glyph) {
  const sub = model.subOf(model.missingIndex);
  const info = sub.meta[layerIdx];
  const out = [];
  const small = !glyph || (glyph.size <= Math.min(1, SIZE_MAX));
  // Replication and off-centre placement only stay inside the cell at small sizes.
  if (attr === 'count' && !(glyph && glyph.size === 0)) return out;
  if (attr === 'pos' && !(small && (!glyph || glyph.count === 1))) return out;
  if (attr === 'size' && glyph && glyph.count > 1) return out;
  switch (attr) {
    case 'size': {
      const dom = info.sizeDomain.length > 1 ? info.sizeDomain : [0, Math.min(1, SIZE_MAX), Math.min(2, SIZE_MAX), SIZE_MAX];
      for (const s of dom) if (s !== current) out.push(s);
      break;
    }
    case 'color': {
      for (const i of info.colorPool) if (i !== current) out.push(i);
      break;
    }
    case 'fill': {
      for (const f of info.fillSource) if (f !== current) out.push(f);
      break;
    }
    case 'lineWeight': {
      for (let i = 0; i <= LW_MAX; i++) if (i !== current) out.push(i);
      break;
    }
    case 'rotation': {
      if (info.minRot < 2) break;
      for (let i = 0; i < info.minRot; i++) if (i * 45 !== current) out.push(i * 45);
      break;
    }
    case 'count': {
      for (let i = 1; i <= 4; i++) if (i !== current) out.push(i);
      break;
    }
    case 'pos': {
      for (const k of [0, 2, 4, 6]) if (k !== current) out.push(k);
      break;
    }
    case 'shape': {
      const used = new Set(sub.meta.flatMap((m) => m.shapePool));
      for (const cls of SHAPE_CLASSES) {
        if (cls.some((s) => used.has(s))) continue;
        out.push(cls[0]);
      }
      break;
    }
    default:
      break;
  }
  return rng.shuffle(out);
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
  const m = model.missingIndex;
  const sub = model.subOf(m);
  const k = model.localIndex(m);
  const atWrongPosition = [];
  const oneTrackOut = [];
  const parityConfusion = [];
  const kindConfusion = [];
  const roleSwap = [];
  const constancyBreak = [];

  // (a) the sequence read at the wrong position - the classic "off by one" lure
  for (const d of [-1, 1, -2, 2, 3, -3]) {
    const t = m + d;
    if (t < 0 || t >= model.cellCount) continue;
    atWrongPosition.push(model.cellAt(t));
  }

  // (b) all rules right except one, which is read one or two positions out
  for (const v of sub.varyingTracks) {
    for (const d of [-1, 1, -2, 2]) {
      const override = {};
      override[v.layerIdx + ':' + v.attr] = v.track.valueAt(k + d);
      oneTrackOut.push(sub.cellAt(k, override));
    }
  }

  // (c) parity confusion: the other woven stream answered instead
  if (model.interleaved) {
    const other = model.subs[1 - model.subIndexOf(m)];
    for (const d of [0, -1, 1]) {
      const kk = k + d;
      if (kk < 0 || kk >= other.span) continue;
      parityConfusion.push(other.cellAt(kk));
    }
  }

  // (d) a bounce read as if it never turned around
  for (const v of sub.varyingTracks) {
    if (v.track.kind !== 'bounce') continue;
    const i1 = v.track.indexAt(k - 1);
    const i2 = v.track.indexAt(k - 2);
    const cont = mod(2 * i1 - i2, v.track.values.length);
    const override = {};
    override[v.layerIdx + ':' + v.attr] = v.track.values[cont];
    kindConfusion.push(sub.cellAt(k, override));
  }

  // (e) the step taken twice over
  for (const v of sub.varyingTracks) {
    if (v.track.kind !== 'step') continue;
    const dbl = mod(v.track.indexAt(k) + v.track.inc, v.track.values.length);
    const override = {};
    override[v.layerIdx + ':' + v.attr] = v.track.values[dbl];
    kindConfusion.push(sub.cellAt(k, override));
  }

  // (f) the two nested roles exchanged
  if (model.layers === 2) {
    for (const attr of ['shape', 'fill', 'color']) {
      const g = cloneGlyphs(model.cellAt(m));
      if (g.length < 2) break;
      const tmp = g[0][attr];
      g[0][attr] = g[1][attr];
      g[1][attr] = tmp;
      roleSwap.push(g);
    }
  }

  // (g) the right rules plus one spurious change on a dimension that should hold
  const trueCell = model.cellAt(m);
  for (let li = 0; li < sub.layers.length; li++) {
    for (const attr of ATTRS) {
      const track = sub.layers[li][attr];
      if (!track || track.varying) continue;
      const cur = track.valueAt(k);
      const alts = altValues(rng, model, li, attr, cur, trueCell[li]).slice(0, 2);
      for (const a of alts) {
        const override = {};
        override[li + ':' + attr] = a;
        constancyBreak.push(sub.cellAt(k, override));
      }
    }
  }

  const strong = interleaveCategories(rng, [
    atWrongPosition, oneTrackOut, parityConfusion, kindConfusion, roleSwap
  ]);

  return {
    systematic: strong.concat(rng.shuffle(constancyBreak)),
    randomFallback: () => {
      const g = cloneGlyphs(model.cellAt(m));
      const li = rng.int(0, g.length);
      const attr = rng.pick(['size', 'color', 'fill', 'lineWeight', 'count', 'shape']);
      const alts = altValues(rng, model, li, attr, g[li][attr], g[li]);
      if (!alts.length) return null;
      applyAttr(g[li], attr, alts[0]);
      return g;
    }
  };
}

function buildOptions(rng, model, optionCount) {
  const correct = model.cellAt(model.missingIndex);
  const need = optionCount - 1;
  const keys = new Set([structKey(correct)]);
  const rkeys = new Set([renderKey(correct)]);
  const chosen = [];
  const pool = collectDistractors(rng, model);

  const tryPush = (glyphs, systematic) => {
    if (!glyphs || chosen.length >= need) return;
    const sk = structKey(glyphs);
    const rk = renderKey(glyphs);
    if (keys.has(sk) || rkeys.has(rk)) return;
    keys.add(sk);
    rkeys.add(rk);
    chosen.push({ glyphs, systematic });
  };

  for (const g of pool.systematic) tryPush(g, true);
  for (let i = 0; i < 60 && chosen.length < need; i++) tryPush(pool.randomFallback(), false);
  if (chosen.length < need) return null;

  const systematicCount = chosen.reduce((n, c) => n + (c.systematic ? 1 : 0), 0);
  const answerIndex = rng.int(0, optionCount);
  const cells = [];
  let di = 0;
  for (let i = 0; i < optionCount; i++) {
    cells.push(i === answerIndex ? correct : chosen[di++].glyphs);
  }
  return {
    cells,
    answerIndex,
    systematicity: need > 0 ? systematicCount / need : 1
  };
}

/* -------------------------------------------------------------------- svg */

function cellCx(i) {
  return PAD + CELL / 2 + i * (CELL + GAP);
}

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

function promptSvg(model) {
  const n = model.cellCount;
  const width = PAD * 2 + n * CELL + (n - 1) * GAP;
  const height = PAD * 2 + CELL + RAIL_DROP + RAIL_TICK;
  const cy = PAD + CELL / 2;
  const railY = PAD + CELL + RAIL_DROP;
  // svgRoot prepends the shared <defs> itself; emitting it again here would put
  // two copies of the same pattern ids in one document.
  const parts = [];

  parts.push(el('line', {
    x1: round3(cellCx(0) - CELL * 0.44),
    y1: railY,
    x2: round3(cellCx(n - 1) + CELL * 0.44),
    y2: railY,
    stroke: 'var(--stim-2, #8d99ab)',
    'stroke-width': 3,
    'stroke-linecap': 'round'
  }, []));

  for (let i = 0; i < n; i++) {
    const cx = cellCx(i);
    parts.push(el('line', {
      x1: round3(cx),
      y1: railY - RAIL_TICK,
      x2: round3(cx),
      y2: railY + RAIL_TICK,
      stroke: 'var(--stim-2, #8d99ab)',
      'stroke-width': 3,
      'stroke-linecap': 'round'
    }, []));
  }

  for (let i = 0; i < n; i++) {
    const cx = cellCx(i);
    if (i === model.missingIndex) parts.push(blankSlot(cx, cy));
    else parts.push(drawCell(model.cellAt(i), cx, cy, CELL));
  }

  return {
    svg: svgRoot({
      width,
      height,
      viewBox: '0 0 ' + width + ' ' + height,
      className: 'stim stim-series',
      body: parts.join('')
    }),
    width,
    height
  };
}

function optionRender(glyphs) {
  const size = CELL + OPT_PAD * 2;
  const body = drawCell(glyphs, size / 2, size / 2, CELL);
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
    const model = buildModel(rng, plan);
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
    const built = buildOptions(rng, picked.model, optionCount);
    if (!built) continue;
    // The contract targets systematic distractors; a thin lure space means this
    // particular rule set does not discriminate, so try a different one.
    if (built.systematicity < 0.7 && attempt < MAX_ATTEMPTS - 6) continue;

    const prompt = promptSvg(picked.model);
    const optionList = built.cells.map((glyphs, i) => {
      const r = optionRender(glyphs);
      return { id: 'o' + i, svg: r.svg, width: r.width, height: r.height };
    });

    const correctKey = structKey(picked.model.cellAt(picked.model.missingIndex));
    let matches = 0;
    for (let i = 0; i < built.cells.length; i++) {
      if (structKey(built.cells[i]) === correctKey) matches++;
    }
    if (matches !== 1) continue;
    if (structKey(built.cells[built.answerIndex]) !== correctKey) continue;

    const sKeys = new Set(built.cells.map(structKey));
    const rKeys = new Set(built.cells.map(renderKey));
    if (sKeys.size !== optionCount || rKeys.size !== optionCount) continue;

    if (prompt.svg.indexOf('<text') !== -1) continue;
    if (optionList.some((o) => o.svg.indexOf('<text') !== -1)) continue;

    const meta = picked.meta;
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

  throw new Error('series.generate: could not build a valid item after ' + MAX_ATTEMPTS + ' attempts');
}
