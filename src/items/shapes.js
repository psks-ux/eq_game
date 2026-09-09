/**
 * Culture-fair shape lexicon: the only stimulus primitives the whole app may draw.
 * Every path is pure geometry, centred on (0,0) and inscribed in a size*100 box.
 * Contains no glyph, letter, digit, arrow or culturally loaded emblem of any script.
 */

/** Round to 3 decimals and normalise -0 so path strings are stable/canonical. */
function n(v) {
  const r = Math.round(v * 1000) / 1000;
  return Object.is(r, -0) ? '0' : String(r);
}

/** points: [[x,y], ...] -> closed polygon path data. */
function poly(points) {
  let d = `M ${n(points[0][0])} ${n(points[0][1])}`;
  for (let i = 1; i < points.length; i += 1) {
    d += ` L ${n(points[i][0])} ${n(points[i][1])}`;
  }
  return `${d} Z`;
}

/** Regular polygon, circumradius r, first vertex at startDeg (screen degrees). */
function regular(sides, r, startDeg) {
  const pts = [];
  for (let i = 0; i < sides; i += 1) {
    const a = ((startDeg + (360 / sides) * i) * Math.PI) / 180;
    pts.push([r * Math.cos(a), r * Math.sin(a)]);
  }
  return poly(pts);
}

/** Full circle as two half arcs (works with any fill-rule). */
function circleD(r, cx = 0, cy = 0, sweep = 1) {
  return (
    `M ${n(cx - r)} ${n(cy)} ` +
    `A ${n(r)} ${n(r)} 0 0 ${sweep} ${n(cx + r)} ${n(cy)} ` +
    `A ${n(r)} ${n(r)} 0 0 ${sweep} ${n(cx - r)} ${n(cy)} Z`
  );
}

/** Rounded rectangle centred on origin. */
function roundRectD(hw, hh, r) {
  const rr = Math.min(r, hw, hh);
  return (
    `M ${n(-hw + rr)} ${n(-hh)} ` +
    `L ${n(hw - rr)} ${n(-hh)} A ${n(rr)} ${n(rr)} 0 0 1 ${n(hw)} ${n(-hh + rr)} ` +
    `L ${n(hw)} ${n(hh - rr)} A ${n(rr)} ${n(rr)} 0 0 1 ${n(hw - rr)} ${n(hh)} ` +
    `L ${n(-hw + rr)} ${n(hh)} A ${n(rr)} ${n(rr)} 0 0 1 ${n(-hw)} ${n(hh - rr)} ` +
    `L ${n(-hw)} ${n(-hh + rr)} A ${n(rr)} ${n(rr)} 0 0 1 ${n(-hw + rr)} ${n(-hh)} Z`
  );
}

/** Half-extent of the nominal box for a given relative size. */
function half(size) {
  const s = typeof size === 'number' && isFinite(size) && size > 0 ? size : 1;
  return (s * 100) / 2;
}

/**
 * SHAPES — the canonical lexicon. Each entry exposes `path(size)` returning SVG
 * path data centred on the origin, and `aspect` (bbox width / bbox height).
 */
export const SHAPES = {
  circle: {
    aspect: 1,
    path(size) {
      return circleD(half(size));
    }
  },

  ring: {
    aspect: 1,
    path(size) {
      const R = half(size);
      // Outer ring clockwise, inner ring counter-clockwise -> hole under nonzero.
      return `${circleD(R, 0, 0, 1)} ${circleD(R * 0.6, 0, 0, 0)}`;
    }
  },

  ellipse: {
    aspect: 1 / 0.62,
    path(size) {
      const R = half(size);
      const ry = R * 0.62;
      return (
        `M ${n(-R)} 0 A ${n(R)} ${n(ry)} 0 0 1 ${n(R)} 0 ` +
        `A ${n(R)} ${n(ry)} 0 0 1 ${n(-R)} 0 Z`
      );
    }
  },

  semicircle: {
    aspect: 2,
    path(size) {
      const R = half(size);
      const y = R / 2;
      return `M ${n(-R)} ${n(y)} A ${n(R)} ${n(R)} 0 0 1 ${n(R)} ${n(y)} Z`;
    }
  },

  quarterDisc: {
    aspect: 1,
    path(size) {
      const R = half(size);
      // Right angle at the bottom-left of the box, radius spans the whole box.
      return (
        `M ${n(-R)} ${n(R)} L ${n(R)} ${n(R)} ` +
        `A ${n(2 * R)} ${n(2 * R)} 0 0 0 ${n(-R)} ${n(-R)} Z`
      );
    }
  },

  square: {
    aspect: 1,
    path(size) {
      const R = half(size);
      return poly([[-R, -R], [R, -R], [R, R], [-R, R]]);
    }
  },

  roundedSquare: {
    aspect: 1,
    path(size) {
      const R = half(size);
      return roundRectD(R, R, R * 0.42);
    }
  },

  rectangle: {
    aspect: 2 / 1.24,
    path(size) {
      const R = half(size);
      const hh = R * 0.62;
      return poly([[-R, -hh], [R, -hh], [R, hh], [-R, hh]]);
    }
  },

  triangleUp: {
    aspect: 1,
    path(size) {
      const R = half(size);
      return poly([[0, -R], [R, R], [-R, R]]);
    }
  },

  triangleDown: {
    aspect: 1,
    path(size) {
      const R = half(size);
      return poly([[0, R], [-R, -R], [R, -R]]);
    }
  },

  triangleRight: {
    aspect: 1,
    path(size) {
      const R = half(size);
      return poly([[R, 0], [-R, R], [-R, -R]]);
    }
  },

  triangleLeft: {
    aspect: 1,
    path(size) {
      const R = half(size);
      return poly([[-R, 0], [R, -R], [R, R]]);
    }
  },

  rightTriangle: {
    aspect: 1,
    path(size) {
      const R = half(size);
      // Right angle at the bottom-left corner: legs on the left and bottom edges.
      return poly([[-R, -R], [-R, R], [R, R]]);
    }
  },

  diamond: {
    aspect: 1,
    path(size) {
      const R = half(size);
      return poly([[0, -R], [R, 0], [0, R], [-R, 0]]);
    }
  },

  trapezoid: {
    aspect: 2 / 1.5,
    path(size) {
      const R = half(size);
      const hh = R * 0.75;
      return poly([[-R * 0.5, -hh], [R * 0.5, -hh], [R, hh], [-R, hh]]);
    }
  },

  parallelogram: {
    aspect: 2 / 1.4,
    path(size) {
      const R = half(size);
      const hh = R * 0.7;
      const s = R * 0.55;
      return poly([[-R + s, -hh], [R, -hh], [R - s, hh], [-R, hh]]);
    }
  },

  pentagon: {
    aspect: 1,
    path(size) {
      return regular(5, half(size), -90);
    }
  },

  hexagon: {
    aspect: 1,
    path(size) {
      return regular(6, half(size), -90);
    }
  },

  octagon: {
    aspect: 1,
    path(size) {
      return regular(8, half(size), -67.5);
    }
  },

  arc: {
    aspect: 2,
    path(size) {
      const R = half(size);
      const ri = R * 0.6;
      const cy = R / 2;
      return (
        `M ${n(-R)} ${n(cy)} A ${n(R)} ${n(R)} 0 0 1 ${n(R)} ${n(cy)} ` +
        `L ${n(ri)} ${n(cy)} A ${n(ri)} ${n(ri)} 0 0 0 ${n(-ri)} ${n(cy)} Z`
      );
    }
  },

  bar: {
    aspect: 2 / 0.44,
    path(size) {
      const R = half(size);
      const hh = R * 0.22;
      return poly([[-R, -hh], [R, -hh], [R, hh], [-R, hh]]);
    }
  },

  dot: {
    aspect: 1,
    path(size) {
      // Deliberately a point marker, ~30% of the box, not a scaled circle.
      return circleD(half(size) * 0.3);
    }
  },

  lShape: {
    aspect: 1,
    path(size) {
      const R = half(size);
      const t = R * 0.8;
      return poly([
        [-R, -R],
        [-R + t, -R],
        [-R + t, R - t],
        [R, R - t],
        [R, R],
        [-R, R]
      ]);
    }
  },

  tShape: {
    aspect: 1,
    path(size) {
      const R = half(size);
      const t = R * 0.8;
      const hw = t / 2;
      return poly([
        [-R, -R],
        [R, -R],
        [R, -R + t],
        [hw, -R + t],
        [hw, R],
        [-hw, R],
        [-hw, -R + t],
        [-R, -R + t]
      ]);
    }
  },

  zShape: {
    aspect: 1,
    path(size) {
      const R = half(size);
      const w = (2 * R) / 3;
      const x0 = -R;
      const x1 = -R + w;
      const x2 = -R + 2 * w;
      const x3 = R;
      // Two offset bars forming a step; purely geometric, not a letterform.
      return poly([
        [x0, -R],
        [x2, -R],
        [x2, 0],
        [x3, 0],
        [x3, R],
        [x1, R],
        [x1, 0],
        [x0, 0]
      ]);
    }
  },

  uShape: {
    aspect: 1,
    path(size) {
      const R = half(size);
      const t = R * 0.62;
      return poly([
        [-R, -R],
        [-R + t, -R],
        [-R + t, R - t],
        [R - t, R - t],
        [R - t, -R],
        [R, -R],
        [R, R],
        [-R, R]
      ]);
    }
  },

  notchedSquare: {
    aspect: 1,
    path(size) {
      const R = half(size);
      const k = R * 0.66;
      // Square with a rectangular bite taken out of the top-right corner.
      return poly([
        [-R, -R],
        [R - k, -R],
        [R - k, -R + k],
        [R, -R + k],
        [R, R],
        [-R, R]
      ]);
    }
  },

  notchedCircle: {
    aspect: 1,
    path(size) {
      const R = half(size);
      const hh = R * 0.26;
      const d = R * 0.4;
      const xs = Math.sqrt(Math.max(R * R - hh * hh, 0));
      // Disc with a rectangular slot cut into its right edge.
      return (
        `M ${n(xs)} ${n(-hh)} L ${n(xs - d)} ${n(-hh)} ` +
        `L ${n(xs - d)} ${n(hh)} L ${n(xs)} ${n(hh)} ` +
        `A ${n(R)} ${n(R)} 0 1 1 ${n(xs)} ${n(-hh)} Z`
      );
    }
  }
};

/** The canonical allowed lexicon (contract 1.2), in declaration order. */
export const SHAPE_KEYS = Object.freeze(Object.keys(SHAPES));

export const FILLS = Object.freeze([
  'empty',
  'solid',
  'hStripe',
  'vStripe',
  'dStripe',
  'dots',
  'half'
]);

/**
 * Okabe-Ito colourblind-safe palette (the seven chromatic values; the achromatic
 * eighth is reserved for stimulus ink and is not selectable as a `color` index).
 */
export const COLORS = Object.freeze([
  '#E69F00', // orange
  '#56B4E9', // sky blue
  '#009E73', // bluish green
  '#F0E442', // yellow
  '#0072B2', // blue
  '#D55E00', // vermillion
  '#CC79A7' // reddish purple
]);

export const SIZES = Object.freeze([0.42, 0.6, 0.78, 0.96]);

export const LINE_WEIGHTS = Object.freeze([2, 3.5, 5]);

/**
 * Culturally loaded or notational glyphs that may never enter the lexicon.
 * The audit test asserts SHAPE_KEYS and FORBIDDEN_KEYS are disjoint.
 */
export const FORBIDDEN_KEYS = Object.freeze([
  'star5',
  'star6',
  'crescent',
  'cross',
  'plus',
  'check',
  'arrow',
  'heart',
  'yinYang',
  'suitHeart',
  'suitSpade',
  'suitClub',
  'suitDiamond',
  'note',
  'swastika',
  'digit',
  'letter'
]);

const FORBIDDEN_SET = new Set(FORBIDDEN_KEYS);
const SHAPE_SET = new Set(SHAPE_KEYS);

/**
 * SVG path data for `key` at relative `size` (1 = a full 100x100 box),
 * centred on the origin. Unknown keys throw — silent fallbacks would let a
 * forbidden glyph slip into a stimulus unnoticed.
 */
export function shapePath(key, size = 1) {
  const def = SHAPES[key];
  if (!def) throw new Error(`shapePath: unknown shape key '${String(key)}'`);
  const s = typeof size === 'number' && isFinite(size) && size > 0 ? size : 1;
  return def.path(s);
}

/** True only for keys in the allowed lexicon and never for a forbidden glyph. */
export function isCultureSafe(key) {
  if (typeof key !== 'string' || key.length === 0) return false;
  if (FORBIDDEN_SET.has(key)) return false;
  return SHAPE_SET.has(key);
}
