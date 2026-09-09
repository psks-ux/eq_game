/**
 * Transformation rule library: the 17 perceptual/relational rule families every
 * item generator and drill composes matrices and series from. Every rule is a
 * pure function of (glyphs, ctx) and never mutates its input.
 *
 * ctx = { step, row, col, rng, params }.
 *   `step`  - how far this cell is from the base cell (absolute, not incremental),
 *             so cell(r,c) = applyRule(key, baseGlyphs, { step: c, row: r, col: c }).
 *   `row`/`col` - matrix coordinates; distributionOfThree needs both so the Latin
 *             square constraint holds down columns as well as across rows.
 *   `params` - per-rule options, documented on each rule below. The binary
 *             overlay rules read their second operand from `params.other`
 *             (a Glyph[]); a missing operand is treated as the empty cell.
 *
 * `canApply(glyphs)` answers "does ONE application of this rule visibly change
 * this cell?" — never a proxy for it, because a rule that reports a change it
 * does not make yields two identical-looking options. It accepts an OPTIONAL
 * second argument, the same `params` object `apply` would receive; called with
 * one argument (the contract's form) it assumes each rule's documented defaults,
 * which is exactly what `applyRule(key, glyphs, { params: {} })` then performs.
 */

import { SIZES, FILLS, COLORS, LINE_WEIGHTS, SHAPE_KEYS } from './shapes.js';

/* --------------------------------------------------------------- utilities */

function isObj(v) {
  return v !== null && typeof v === 'object';
}

/** Structural copy; Glyphs are flat but generators may attach extra fields. */
function copyValue(v) {
  if (Array.isArray(v)) return v.map(copyValue);
  if (isObj(v)) {
    const out = {};
    const keys = Object.keys(v);
    for (let i = 0; i < keys.length; i += 1) out[keys[i]] = copyValue(v[keys[i]]);
    return out;
  }
  return v;
}

function copyGlyphs(glyphs) {
  if (!Array.isArray(glyphs)) return [];
  return glyphs.filter(isObj).map(copyValue);
}

function wrap(i, len) {
  if (!(len > 0)) return 0;
  return ((i % len) + len) % len;
}

/** Wrap a continuous offset into [-1, 1) with period 2 (used by translation). */
function wrapUnit(v) {
  const p = ((v + 1) % 2 + 2) % 2;
  return p - 1;
}

function clampInt(v, lo, hi) {
  const x = Number.isFinite(v) ? Math.round(v) : lo;
  return x < lo ? lo : x > hi ? hi : x;
}

function normDeg(d) {
  const x = Number.isFinite(d) ? d : 0;
  return ((x % 360) + 360) % 360;
}

/**
 * Rotational symmetry order of each shape's silhouette. Infinity means a turn
 * is invisible; canApply uses this so a rule never claims a change nobody
 * could see.
 */
const ROT_ORDER = {
  circle: Infinity,
  ring: Infinity,
  dot: Infinity,
  ellipse: 2,
  semicircle: 1,
  quarterDisc: 1,
  square: 4,
  roundedSquare: 4,
  rectangle: 2,
  triangleUp: 1,
  triangleDown: 1,
  triangleRight: 1,
  triangleLeft: 1,
  rightTriangle: 1,
  diamond: 4,
  trapezoid: 1,
  parallelogram: 2,
  pentagon: 5,
  hexagon: 6,
  octagon: 8,
  arc: 1,
  bar: 2,
  lShape: 1,
  tShape: 1,
  zShape: 2,
  uShape: 1,
  notchedSquare: 1,
  notchedCircle: 1
};

function rotOrder(shape) {
  const o = ROT_ORDER[shape];
  return o === undefined ? 1 : o;
}

/**
 * True when turning `shape` by `deg` actually changes its silhouette, i.e. when
 * `deg` is not a whole multiple of the shape's symmetry period. This is what
 * `canApply` must answer: a rule that claims to transform a cell but leaves it
 * looking identical produces duplicate options and an unanswerable item.
 */
function turnVisible(shape, deg) {
  const order = rotOrder(shape);
  if (!Number.isFinite(order) || order <= 0) return false;
  const period = 360 / order;
  const d = normDeg(deg);
  return Math.abs(d % period) > 1e-9;
}

/** Ranked attribute accessors: every progression-style rule goes through these. */
const RANKS = {
  size: {
    len: SIZES.length,
    get: (g) => clampInt(g.size, 0, SIZES.length - 1),
    set: (g, i) => {
      g.size = i;
    }
  },
  fill: {
    len: FILLS.length,
    get: (g) => {
      const i = FILLS.indexOf(g.fill);
      return i < 0 ? 0 : i;
    },
    set: (g, i) => {
      g.fill = FILLS[i];
    }
  },
  color: {
    len: COLORS.length,
    get: (g) => (Number.isInteger(g.color) && g.color >= 0 ? g.color % COLORS.length : 0),
    set: (g, i) => {
      g.color = i;
    }
  },
  lineWeight: {
    len: LINE_WEIGHTS.length,
    get: (g) => clampInt(g.lineWeight, 0, LINE_WEIGHTS.length - 1),
    set: (g, i) => {
      g.lineWeight = i;
    }
  },
  count: {
    len: 5,
    get: (g) => clampInt(g.count, 1, 5) - 1,
    set: (g, i) => {
      g.count = i + 1;
    }
  },
  rotation: {
    len: 8,
    get: (g) => Math.round(normDeg(g.rotation) / 45) % 8,
    set: (g, i) => {
      g.rotation = wrap(i, 8) * 45;
    }
  }
};

/** Categorical domains used when a rule sets an attribute to a literal value. */
const DOMAINS = {
  size: [0, 1, 2, 3],
  fill: FILLS.slice(),
  color: [0, 1, 2, 3, 4, 5, 6],
  lineWeight: [0, 1, 2],
  count: [1, 2, 3, 4, 5],
  rotation: [0, 45, 90, 135, 180, 225, 270, 315],
  shape: SHAPE_KEYS.slice()
};

function setAttr(g, attr, value) {
  g[attr] = value;
}

function getStep(ctx) {
  return Number.isFinite(ctx.step) ? Math.round(ctx.step) : 0;
}

function getRowCol(ctx) {
  const row = Number.isFinite(ctx.row) ? Math.round(ctx.row) : 0;
  const col = Number.isFinite(ctx.col) ? Math.round(ctx.col) : getStep(ctx);
  return [row, col];
}

/* ------------------------------------------------------- overlay set logic */

/** Element identity for the overlay family is the shape field alone. */
function shapeOf(g) {
  return typeof g.shape === 'string' ? g.shape : '';
}

function overlay(mode, a, b) {
  const bShapes = new Set(b.map(shapeOf));
  const aShapes = new Set(a.map(shapeOf));
  const out = [];
  const taken = new Set();
  for (let i = 0; i < a.length; i += 1) {
    const s = shapeOf(a[i]);
    if (taken.has(s)) continue;
    const inB = bShapes.has(s);
    const keep =
      mode === 'union' ||
      (mode === 'intersection' && inB) ||
      (mode === 'difference' && !inB) ||
      (mode === 'exclusive' && !inB);
    if (keep) {
      taken.add(s);
      out.push(copyValue(a[i]));
    }
  }
  if (mode === 'union' || mode === 'exclusive') {
    for (let i = 0; i < b.length; i += 1) {
      const s = shapeOf(b[i]);
      if (taken.has(s)) continue;
      if (mode === 'union' || !aShapes.has(s)) {
        taken.add(s);
        out.push(copyValue(b[i]));
      }
    }
  }
  return out;
}

function otherOperand(ctx) {
  const p = ctx.params;
  const o = p.other !== undefined ? p.other : p.b;
  return copyGlyphs(o);
}

/* ------------------------------------------------------------------ rules */

const constancy = {
  key: 'constancy',
  arity: 1,
  dimension: 'shape',
  abstractness: 1,
  apply(glyphs) {
    return glyphs;
  },
  /** The one rule whose applicability is invariance itself: true here means the
   *  cell can carry a "nothing changes" relation, not that it will change. */
  canApply(glyphs) {
    return Array.isArray(glyphs) && glyphs.some(isObj);
  }
};

const progression = {
  key: 'progression',
  arity: 1,
  dimension: 'size',
  abstractness: 1,
  /** params: { attr = 'size', delta = 1, pool } — advances a ranked attribute,
   *  wrapping at the end of the range so a 3x3 matrix never runs out of values. */
  apply(glyphs, ctx) {
    const p = ctx.params;
    const step = getStep(ctx);
    const delta = Number.isFinite(p.delta) ? Math.round(p.delta) : 1;
    const shift = delta * step;
    if (shift === 0) return glyphs;
    const pool = Array.isArray(p.pool) && p.pool.length >= 2 ? p.pool : null;
    const attr = p.attr === 'shape' && pool ? 'shape' : RANKS[p.attr] ? p.attr : 'size';
    if (attr === 'shape') {
      for (let i = 0; i < glyphs.length; i += 1) {
        const cur = pool.indexOf(glyphs[i].shape);
        glyphs[i].shape = pool[wrap((cur < 0 ? 0 : cur) + shift, pool.length)];
      }
      return glyphs;
    }
    const rank = RANKS[attr];
    for (let i = 0; i < glyphs.length; i += 1) {
      rank.set(glyphs[i], wrap(rank.get(glyphs[i]) + shift, rank.len));
    }
    return glyphs;
  },
  canApply(glyphs) {
    return Array.isArray(glyphs) && glyphs.length > 0;
  }
};

const distributionOfThree = {
  key: 'distributionOfThree',
  arity: 1,
  dimension: 'fill',
  abstractness: 3,
  /** params: { attr = 'fill', values = first three of the domain }.
   *  value = values[(row + col) % 3] — a Latin square, so each of the three
   *  values appears exactly once per row AND once per column. Verifiable in
   *  both directions, which is what keeps the item reading-order neutral. */
  apply(glyphs, ctx) {
    const p = ctx.params;
    const attr = DOMAINS[p.attr] ? p.attr : 'fill';
    const domain = DOMAINS[attr];
    const values =
      Array.isArray(p.values) && p.values.length >= 3 ? p.values.slice(0, 3) : domain.slice(0, 3);
    const [row, col] = getRowCol(ctx);
    const v = values[wrap(row + col, 3)];
    for (let i = 0; i < glyphs.length; i += 1) setAttr(glyphs[i], attr, copyValue(v));
    return glyphs;
  },
  canApply(glyphs) {
    return Array.isArray(glyphs) && glyphs.length > 0;
  }
};

/** The turn one application of `rotation` performs, snapped to a multiple of 45. */
function rotationDeg(params) {
  const p = isObj(params) ? params : {};
  const raw = Number.isFinite(p.deg) ? p.deg : 90;
  return Math.round(raw / 45) * 45 || 45;
}

const rotation = {
  key: 'rotation',
  arity: 1,
  dimension: 'rotation',
  abstractness: 2,
  /** params: { deg = 90, direction = 1 } — deg is snapped to a multiple of 45. */
  apply(glyphs, ctx) {
    const p = ctx.params;
    const dir = p.direction === -1 ? -1 : 1;
    const turn = rotationDeg(p) * dir * getStep(ctx);
    if (turn === 0) return glyphs;
    for (let i = 0; i < glyphs.length; i += 1) {
      glyphs[i].rotation = normDeg(normDeg(glyphs[i].rotation) + turn);
    }
    return glyphs;
  },
  /**
   * True when one application of the turn `params` describes (default 90 degrees)
   * is visible on at least one glyph. Testing the actual turn matters in both
   * directions: an octagon or a square is unchanged by 90 degrees, while a
   * pentagon or a hexagon plainly is not.
   */
  canApply(glyphs, params) {
    const deg = rotationDeg(params);
    return (
      Array.isArray(glyphs) && glyphs.some((g) => isObj(g) && turnVisible(g.shape, deg))
    );
  }
};

const reflection = {
  key: 'reflection',
  arity: 1,
  dimension: 'rotation',
  abstractness: 2,
  /** params: { axis = 'v', mirrorPosition = false }. Mirrors the orientation
   *  attribute about the chosen axis; on even steps the cell is unmirrored, so
   *  the rule reads the same scanned in either direction. */
  apply(glyphs, ctx) {
    const p = ctx.params;
    if (wrap(getStep(ctx), 2) === 0) return glyphs;
    const axis = p.axis === 'h' ? 'h' : 'v';
    for (let i = 0; i < glyphs.length; i += 1) {
      const g = glyphs[i];
      const r = normDeg(g.rotation);
      g.rotation = axis === 'v' ? normDeg(180 - r) : normDeg(360 - r);
      if (p.mirrorPosition) {
        if (axis === 'v') g.dx = -(Number.isFinite(g.dx) ? g.dx : 0);
        else g.dy = -(Number.isFinite(g.dy) ? g.dy : 0);
      }
    }
    return glyphs;
  },
  /**
   * A mirror about `axis` maps rotation r to (180 - r) for 'v' and (360 - r) for
   * 'h', so the turn it induces is (180 - 2r) or (-2r). The rule is applicable
   * only when that turn is visible on some glyph, or when it moves a glyph that
   * sits off-centre. Checking the induced turn rather than a proxy matters: a
   * 2-fold shape (bar, ellipse, rectangle) at 0 degrees is mirrored onto itself,
   * which the old shape-order proxy wrongly reported as a change.
   */
  canApply(glyphs, params) {
    const p = isObj(params) ? params : {};
    const axis = p.axis === 'h' ? 'h' : 'v';
    return (
      Array.isArray(glyphs) &&
      glyphs.some((g) => {
        if (!isObj(g)) return false;
        const r = normDeg(g.rotation);
        const turn = axis === 'v' ? 180 - 2 * r : -2 * r;
        if (turnVisible(g.shape, turn)) return true;
        if (!p.mirrorPosition) return false;
        const off = axis === 'v' ? g.dx : g.dy;
        return Number.isFinite(off) && Math.abs(off) > 1e-3;
      })
    );
  }
};

const translation = {
  key: 'translation',
  arity: 1,
  dimension: 'position',
  abstractness: 2,
  /** params: { ddx = 0.5, ddy = 0 } — slides along a track, wrapping in [-1,1). */
  apply(glyphs, ctx) {
    const p = ctx.params;
    const step = getStep(ctx);
    const ddx = Number.isFinite(p.ddx) ? p.ddx : 0.5;
    const ddy = Number.isFinite(p.ddy) ? p.ddy : 0;
    if (step === 0 || (ddx === 0 && ddy === 0)) return glyphs;
    for (let i = 0; i < glyphs.length; i += 1) {
      const g = glyphs[i];
      g.dx = wrapUnit((Number.isFinite(g.dx) ? g.dx : 0) + ddx * step);
      g.dy = wrapUnit((Number.isFinite(g.dy) ? g.dy : 0) + ddy * step);
    }
    return glyphs;
  },
  canApply(glyphs) {
    return Array.isArray(glyphs) && glyphs.length > 0;
  }
};

function makeOverlay(key, mode, abstractness) {
  return {
    key,
    arity: 2,
    dimension: 'set',
    abstractness,
    /** params: { other } — the second operand cell (Glyph[]); missing means []. */
    apply(glyphs, ctx) {
      return overlay(mode, glyphs, otherOperand(ctx));
    },
    /**
     * With the second operand supplied, answer exactly: does combining the two
     * cells produce something different from the left one? Without it — the
     * contract's one-argument form, used while a generator is still choosing
     * rules — answer whether this cell is a usable left operand at all.
     */
    canApply(glyphs, params) {
      if (!Array.isArray(glyphs) || !glyphs.some(isObj)) return false;
      const p = isObj(params) ? params : {};
      if (p.other === undefined && p.b === undefined) return true;
      const a = copyGlyphs(glyphs);
      const out = overlay(mode, a, otherOperand({ params: p }));
      if (out.length !== a.length) return true;
      for (let i = 0; i < out.length; i += 1) {
        if (positionKey(out[i]) !== positionKey(a[i])) return true;
      }
      return false;
    }
  };
}

const overlayUnion = makeOverlay('overlayUnion', 'union', 3);
const overlayIntersection = makeOverlay('overlayIntersection', 'intersection', 3);
const overlayDifference = makeOverlay('overlayDifference', 'difference', 4);
const overlayExclusive = makeOverlay('overlayExclusive', 'exclusive', 4);

const containment = {
  key: 'containment',
  arity: 1,
  dimension: 'set',
  abstractness: 3,
  /** params: { depth = 1, shellShape } — nests the cell inside 1..2 shells. */
  apply(glyphs, ctx) {
    const p = ctx.params;
    // Absent depth means the documented default of 1. clampInt alone would have
    // turned it into 0, which made containment silently do nothing.
    const depth = Number.isFinite(p.depth) ? clampInt(p.depth, 0, 2) : 1;
    if (depth === 0 || glyphs.length === 0) return glyphs;
    const inner = glyphs.map((g) => {
      const c = copyValue(g);
      c.size = clampInt(RANKS.size.get(c) - depth, 0, SIZES.length - 1);
      c.dx = (Number.isFinite(c.dx) ? c.dx : 0) * 0.45;
      c.dy = (Number.isFinite(c.dy) ? c.dy : 0) * 0.45;
      return c;
    });
    let maxSize = 0;
    for (let i = 0; i < inner.length; i += 1) maxSize = Math.max(maxSize, inner[i].size);
    const base = glyphs[0];
    const shellShape =
      typeof p.shellShape === 'string' && SHAPE_KEYS.indexOf(p.shellShape) >= 0
        ? p.shellShape
        : base.shape === 'circle'
          ? 'square'
          : 'circle';
    const shells = [];
    for (let d = depth; d >= 1; d -= 1) {
      shells.push({
        shape: shellShape,
        size: clampInt(maxSize + d, 0, SIZES.length - 1),
        fill: 'empty',
        color: Number.isInteger(base.color) ? base.color : -1,
        rotation: 0,
        lineWeight: Number.isInteger(base.lineWeight)
          ? clampInt(base.lineWeight, 0, LINE_WEIGHTS.length - 1)
          : DEFAULT_LINE_WEIGHT,
        dx: 0,
        dy: 0,
        count: 1
      });
    }
    return shells.concat(inner);
  },
  /**
   * Any non-empty cell can be nested: the inner glyphs shrink and an enclosing
   * shell is added, so the cell always changes. (An earlier size-headroom test
   * rejected cells whose glyphs were already at the largest size, but those are
   * shrunk by `apply` and still gain a shell.)
   */
  canApply(glyphs) {
    return Array.isArray(glyphs) && glyphs.some(isObj);
  }
};

const quantityProgression = {
  key: 'quantityProgression',
  arity: 1,
  dimension: 'count',
  abstractness: 2,
  /** params: { delta = 1 } — count cycles 1..5, always subitizable. */
  apply(glyphs, ctx) {
    const delta = Number.isFinite(ctx.params.delta) ? Math.round(ctx.params.delta) : 1;
    const shift = delta * getStep(ctx);
    if (shift === 0) return glyphs;
    for (let i = 0; i < glyphs.length; i += 1) {
      RANKS.count.set(glyphs[i], wrap(RANKS.count.get(glyphs[i]) + shift, 5));
    }
    return glyphs;
  },
  canApply(glyphs) {
    return Array.isArray(glyphs) && glyphs.length > 0;
  }
};

const sizeOrdering = {
  key: 'sizeOrdering',
  arity: 1,
  dimension: 'size',
  abstractness: 2,
  /** params: { startIndex = 0, spread = 1, ascending = true }. Glyphs are ranked
   *  by their position in the cell and given sizes along that ranking; `step`
   *  rotates which glyph starts the ramp. */
  apply(glyphs, ctx) {
    const p = ctx.params;
    const m = glyphs.length;
    if (m < 2) return glyphs;
    const spread = clampInt(p.spread, 1, 3);
    const start = clampInt(p.startIndex, 0, SIZES.length - 1);
    const ascending = p.ascending === false ? false : true;
    const order = glyphs
      .map((g, i) => ({
        i,
        x: Number.isFinite(g.dx) ? g.dx : 0,
        y: Number.isFinite(g.dy) ? g.dy : 0
      }))
      .sort((a, b) => a.x - b.x || a.y - b.y || a.i - b.i);
    const step = getStep(ctx);
    for (let k = 0; k < order.length; k += 1) {
      const rank = wrap(k + step, m);
      const idx = ascending ? start + rank * spread : start + (m - 1 - rank) * spread;
      glyphs[order[k].i].size = clampInt(idx, 0, SIZES.length - 1);
    }
    return glyphs;
  },
  canApply(glyphs) {
    return Array.isArray(glyphs) && glyphs.length >= 2;
  }
};

const symmetryCompletion = {
  key: 'symmetryCompletion',
  arity: 1,
  dimension: 'position',
  abstractness: 3,
  /** params: { axis = 'v' | 'h' | 'both' } — adds the mirrored partners needed
   *  to make the cell's arrangement symmetric about the axis. */
  apply(glyphs, ctx) {
    const axis = ctx.params.axis === 'h' ? 'h' : ctx.params.axis === 'both' ? 'both' : 'v';
    const axes = axis === 'both' ? ['v', 'h'] : [axis];
    let out = glyphs;
    for (let a = 0; a < axes.length; a += 1) {
      const seen = new Set(out.map(positionKey));
      const added = [];
      for (let i = 0; i < out.length; i += 1) {
        const g = out[i];
        const m = copyValue(g);
        if (axes[a] === 'v') {
          m.dx = -(Number.isFinite(g.dx) ? g.dx : 0);
          m.rotation = normDeg(180 - normDeg(g.rotation));
        } else {
          m.dy = -(Number.isFinite(g.dy) ? g.dy : 0);
          m.rotation = normDeg(360 - normDeg(g.rotation));
        }
        const k = positionKey(m);
        if (!seen.has(k)) {
          seen.add(k);
          added.push(m);
        }
      }
      out = out.concat(added);
    }
    return out;
  },
  /**
   * Applicable exactly when the mirror actually adds a partner. Asking `apply`
   * is cheaper than restating its rules and can never disagree with it: a glyph
   * on the axis but rotated (dx 0, rotation 45) still produces a new partner,
   * which a dx/dy-only test would have missed.
   */
  canApply(glyphs, params) {
    if (!Array.isArray(glyphs) || !glyphs.some(isObj)) return false;
    const src = copyGlyphs(glyphs);
    const out = symmetryCompletion.apply(src, {
      step: 0,
      row: 0,
      col: 0,
      rng: null,
      params: isObj(params) ? params : {}
    });
    return Array.isArray(out) && out.length > src.length;
  }
};

function positionKey(g) {
  const r = (v) => Math.round((Number.isFinite(v) ? v : 0) * 1000) / 1000;
  return `${g.shape}|${g.size}|${g.fill}|${g.color}|${normDeg(g.rotation)}|${r(g.dx)}|${r(g.dy)}|${g.count}`;
}

const sequenceAlternation = {
  key: 'sequenceAlternation',
  arity: 1,
  dimension: 'color',
  abstractness: 2,
  /** params: { attr = 'color', values = first two of the domain } — the value
   *  flips with the parity of `step`, so it reads the same in either direction. */
  apply(glyphs, ctx) {
    const p = ctx.params;
    const attr = DOMAINS[p.attr] ? p.attr : 'color';
    const domain = DOMAINS[attr];
    const values =
      Array.isArray(p.values) && p.values.length >= 2 ? p.values.slice(0, 2) : domain.slice(0, 2);
    const v = values[wrap(getStep(ctx), 2)];
    for (let i = 0; i < glyphs.length; i += 1) setAttr(glyphs[i], attr, copyValue(v));
    return glyphs;
  },
  canApply(glyphs) {
    return Array.isArray(glyphs) && glyphs.length > 0;
  }
};

const attributeSwap = {
  key: 'attributeSwap',
  arity: 1,
  dimension: 'shape',
  abstractness: 3,
  /** params: { attr = 'shape' } — cyclically permutes one attribute's values
   *  among the glyphs of the cell by `step` places. */
  apply(glyphs, ctx) {
    const attr = DOMAINS[ctx.params.attr] ? ctx.params.attr : 'shape';
    const m = glyphs.length;
    if (m < 2) return glyphs;
    const shift = wrap(getStep(ctx), m);
    if (shift === 0) return glyphs;
    const values = glyphs.map((g) => copyValue(g[attr]));
    for (let i = 0; i < m; i += 1) setAttr(glyphs[i], attr, values[wrap(i + shift, m)]);
    return glyphs;
  },
  /**
   * A cyclic permutation is only visible when the attribute being swapped
   * actually differs between glyphs — checked on the attribute `params` names
   * (default 'shape'), not on `shape` unconditionally, so a fill or colour swap
   * between two same-shaped glyphs is no longer rejected.
   */
  canApply(glyphs, params) {
    if (!Array.isArray(glyphs) || glyphs.length < 2) return false;
    const p = isObj(params) ? params : {};
    const attr = DOMAINS[p.attr] ? p.attr : 'shape';
    const first = isObj(glyphs[0]) ? glyphs[0][attr] : undefined;
    return glyphs.some((g) => isObj(g) && g[attr] !== first);
  }
};

const ruleChaining = {
  key: 'ruleChaining',
  arity: 1,
  dimension: 'set',
  abstractness: 4,
  /** params: { chain = ['rotation','progression'], chainParams = [{}, {}] } —
   *  composes two rules in order; nested ruleChaining is stripped. */
  apply(glyphs, ctx) {
    const p = ctx.params;
    const chain = (Array.isArray(p.chain) && p.chain.length > 0
      ? p.chain
      : DEFAULT_CHAIN
    ).filter((k) => k !== 'ruleChaining' && Object.prototype.hasOwnProperty.call(RULES, k));
    const chainParams = Array.isArray(p.chainParams) ? p.chainParams : [];
    let out = glyphs;
    for (let i = 0; i < chain.length; i += 1) {
      const sub = RULES[chain[i]];
      const subCtx = {
        step: ctx.step,
        row: ctx.row,
        col: ctx.col,
        rng: ctx.rng,
        params: isObj(chainParams[i]) ? chainParams[i] : {}
      };
      out = sub.apply(out, subCtx);
      if (!Array.isArray(out)) out = [];
    }
    return out;
  },
  canApply(glyphs) {
    return Array.isArray(glyphs) && glyphs.length > 0;
  }
};

const DEFAULT_CHAIN = ['rotation', 'progression'];

/* --------------------------------------------------------------- registry */

export const RULES = Object.freeze({
  constancy,
  progression,
  distributionOfThree,
  rotation,
  reflection,
  translation,
  overlayUnion,
  overlayIntersection,
  overlayDifference,
  overlayExclusive,
  containment,
  quantityProgression,
  sizeOrdering,
  symmetryCompletion,
  sequenceAlternation,
  attributeSwap,
  ruleChaining
});

export const RULE_KEYS = Object.freeze(Object.keys(RULES));

/**
 * Dimensions a rule occupies beyond its declared `dimension`. ruleChaining
 * composes two sub-rules, so it also consumes their dimensions; declaring that
 * here keeps pickRuleSet's compatibility promise honest without adding a
 * non-contract field to RuleDef.
 */
const EXTRA_BLOCKS = {
  ruleChaining: ['rotation', 'size']
};

function requireRule(ruleKey) {
  const def = RULES[ruleKey];
  if (!def) throw new Error(`rules: unknown rule key '${String(ruleKey)}'`);
  return def;
}

/**
 * Clamp a rule's output back into the legal Glyph ranges. Defaults for absent
 * fields MUST match `svg.js -> normalizeGlyph`, otherwise a partially specified
 * glyph would render one way and key another once it had passed through a rule.
 */
const DEFAULT_SIZE = 2;
const DEFAULT_LINE_WEIGHT = 1;

function normalizeOut(glyphs) {
  const out = [];
  for (let i = 0; i < glyphs.length; i += 1) {
    const g = glyphs[i];
    if (!isObj(g)) continue;
    if (SHAPE_KEYS.indexOf(g.shape) < 0) g.shape = SHAPE_KEYS[0];
    g.size = Number.isInteger(g.size) ? clampInt(g.size, 0, SIZES.length - 1) : DEFAULT_SIZE;
    g.lineWeight = Number.isInteger(g.lineWeight)
      ? clampInt(g.lineWeight, 0, LINE_WEIGHTS.length - 1)
      : DEFAULT_LINE_WEIGHT;
    g.count = clampInt(g.count, 1, 5);
    // Contract 1.2: rotation only ever varies in multiples of 45 degrees.
    g.rotation = normDeg(Math.round(normDeg(g.rotation) / 45) * 45);
    if (FILLS.indexOf(g.fill) < 0) g.fill = FILLS[0];
    if (Number.isInteger(g.color) && g.color >= 0) g.color %= COLORS.length;
    g.dx = Math.max(-1, Math.min(1, Number.isFinite(g.dx) ? g.dx : 0));
    g.dy = Math.max(-1, Math.min(1, Number.isFinite(g.dy) ? g.dy : 0));
    out.push(g);
  }
  return out;
}

/**
 * Apply one rule. Pure: the input array and its glyphs are deep-copied before
 * the rule runs, so a rule can never reach the caller's data.
 */
export function applyRule(ruleKey, glyphs, ctx) {
  const def = requireRule(ruleKey);
  const source = isObj(ctx) ? ctx : {};
  const safeCtx = {
    step: Number.isFinite(source.step) ? Math.round(source.step) : 0,
    row: Number.isFinite(source.row) ? Math.round(source.row) : 0,
    col: Number.isFinite(source.col) ? Math.round(source.col) : undefined,
    rng: source.rng || null,
    params: isObj(source.params) ? copyValue(source.params) : {}
  };
  if (safeCtx.col === undefined) safeCtx.col = safeCtx.step;
  const result = def.apply(copyGlyphs(glyphs), safeCtx);
  return normalizeOut(Array.isArray(result) ? result.map(copyValue) : []);
}

/** Abstractness weight 1..4 of a rule. Throws on an unknown key. */
export function ruleCost(ruleKey) {
  return requireRule(ruleKey).abstractness;
}

function toSet(v) {
  if (!v) return null;
  if (v instanceof Set) return v.size ? v : null;
  if (Array.isArray(v)) return v.length ? new Set(v) : null;
  return null;
}

/**
 * Choose `count` mutually compatible rule keys: no two rules in the result may
 * occupy the same dimension, so a matrix never carries two contradictory rules
 * on one attribute. Honours `allow` / `deny` (array or Set). Returns fewer keys
 * than requested when the compatible pool runs out; never throws, never calls
 * Math.random.
 */
export function pickRuleSet(rng, { count, allow, deny } = {}) {
  const want = clampInt(count, 1, RULE_KEYS.length);
  const allowSet = toSet(allow);
  const denySet = toSet(deny);
  let pool = RULE_KEYS.filter(
    (k) => (!allowSet || allowSet.has(k)) && (!denySet || !denySet.has(k))
  );
  if (rng && typeof rng.shuffle === 'function') {
    const shuffled = rng.shuffle(pool);
    if (Array.isArray(shuffled) && shuffled.length === pool.length) pool = shuffled;
  }
  const used = new Set();
  const picked = [];
  for (let i = 0; i < pool.length && picked.length < want; i += 1) {
    const key = pool[i];
    const dims = [RULES[key].dimension].concat(EXTRA_BLOCKS[key] || []);
    if (dims.some((d) => used.has(d))) continue;
    dims.forEach((d) => used.add(d));
    picked.push(key);
  }
  return picked;
}

/**
 * Summarise a rule set for an item's `meta`. Unknown keys are ignored; an empty
 * set reports abstractness 1 (the difficulty model's neutral baseline).
 */
export function describeRuleSet(keys) {
  const list = Array.isArray(keys) ? keys : [];
  const seen = new Set();
  const ruleTypes = [];
  for (let i = 0; i < list.length; i += 1) {
    const k = list[i];
    if (RULES[k] && !seen.has(k)) {
      seen.add(k);
      ruleTypes.push(k);
    }
  }
  if (ruleTypes.length === 0) return { ruleCount: 0, ruleTypes: [], abstractness: 1 };
  let total = 0;
  for (let i = 0; i < ruleTypes.length; i += 1) total += RULES[ruleTypes[i]].abstractness;
  return {
    ruleCount: ruleTypes.length,
    ruleTypes,
    abstractness: Math.round((total / ruleTypes.length) * 100) / 100
  };
}
