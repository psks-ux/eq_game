/**
 * SVG construction for every stimulus in the app: string builders for glyphs,
 * cells, option tiles and matrix grids, plus the canonical keys used for answer
 * comparison and de-duplication. Never emits a <text> element.
 */

import {
  SHAPE_KEYS,
  FILLS,
  COLORS,
  SIZES,
  LINE_WEIGHTS,
  shapePath
} from './shapes.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const FILL_SET = new Set(FILLS);
const SHAPE_SET = new Set(SHAPE_KEYS);

/** Escape a value for use inside a double-quoted XML attribute. */
function escapeAttr(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Round to 3 decimals, normalising -0. */
function n(v) {
  const x = typeof v === 'number' && isFinite(v) ? v : 0;
  const r = Math.round(x * 1000) / 1000;
  return Object.is(r, -0) ? '0' : String(r);
}

function clamp(x, lo, hi) {
  return x < lo ? lo : x > hi ? hi : x;
}

function flatten(children, out) {
  if (children === null || children === undefined || children === false) return out;
  if (Array.isArray(children)) {
    for (let i = 0; i < children.length; i += 1) flatten(children[i], out);
    return out;
  }
  out.push(String(children));
  return out;
}

/**
 * Build an element string. `attrs` entries whose value is null/undefined are
 * skipped; every remaining value is escaped. Omitting `children` self-closes.
 */
export function el(tag, attrs, children) {
  const name = String(tag);
  let s = `<${name}`;
  if (attrs && typeof attrs === 'object') {
    const keys = Object.keys(attrs);
    for (let i = 0; i < keys.length; i += 1) {
      const k = keys[i];
      const v = attrs[k];
      if (v === null || v === undefined || v === false) continue;
      s += ` ${k}="${escapeAttr(v === true ? '' : v)}"`;
    }
  }
  const kids = flatten(children, []);
  if (kids.length === 0) return `${s}/>`;
  return `${s}>${kids.join('')}</${name}>`;
}

/**
 * Shared <defs> emitted inside EVERY svg root so ids always resolve locally.
 * Contents are byte-identical in every root, so the duplicate ids that result
 * from several stimuli coexisting on one page are harmless.
 *
 * - `p-hStripe` / `p-vStripe` / `p-dStripe` / `p-dots` paint with `currentColor`,
 *   so any consumer can set CSS `color` on an ancestor and get tinted texture.
 * - `p-halfClip` is an objectBoundingBox clip covering the left half of whatever
 *   it is applied to; `drawGlyph` uses it for the 'half' fill.
 */
export function defsPatterns() {
  const stroke = { stroke: 'currentColor', 'stroke-width': 2.4, fill: 'none' };
  const hStripe = el(
    'pattern',
    { id: 'p-hStripe', patternUnits: 'userSpaceOnUse', width: 8, height: 8 },
    el('path', { ...stroke, d: 'M0 2 H8 M0 6 H8' })
  );
  const vStripe = el(
    'pattern',
    { id: 'p-vStripe', patternUnits: 'userSpaceOnUse', width: 8, height: 8 },
    el('path', { ...stroke, d: 'M2 0 V8 M6 0 V8' })
  );
  const dStripe = el(
    'pattern',
    { id: 'p-dStripe', patternUnits: 'userSpaceOnUse', width: 8, height: 8 },
    el('path', { ...stroke, d: 'M-2 2 L2 -2 M0 8 L8 0 M6 10 L10 6' })
  );
  const dots = el(
    'pattern',
    { id: 'p-dots', patternUnits: 'userSpaceOnUse', width: 9, height: 9 },
    el('circle', { cx: 4.5, cy: 4.5, r: 1.9, fill: 'currentColor' })
  );
  const halfClip = el(
    'clipPath',
    { id: 'p-halfClip', clipPathUnits: 'objectBoundingBox' },
    el('rect', { x: 0, y: 0, width: 0.5, height: 1 })
  );
  return el('defs', null, [hStripe, vStripe, dStripe, dots, halfClip]);
}

/**
 * Wrap `body` in an <svg> root. `defsPatterns()` is prepended automatically so
 * every stimulus is self-contained.
 */
export function svgRoot({ width, height, viewBox, className, body } = {}) {
  const w = typeof width === 'number' && width > 0 ? width : 100;
  const h = typeof height === 'number' && height > 0 ? height : 100;
  return el(
    'svg',
    {
      xmlns: SVG_NS,
      width: n(w),
      height: n(h),
      viewBox: viewBox || `0 0 ${n(w)} ${n(h)}`,
      class: className || null,
      role: 'img',
      focusable: 'false',
      'shape-rendering': 'geometricPrecision'
    },
    [defsPatterns(), body || '']
  );
}

/* ------------------------------------------------------------------ glyphs */

/**
 * Fixed symmetric arrangements for `count` 1..5. `o` entries are offsets as a
 * fraction of half the cell; `f` shrinks each copy so the group fits the cell.
 * The layouts are point-symmetric so no count implies a reading direction.
 */
const ARRANGEMENTS = {
  1: { f: 1, o: [[0, 0]] },
  2: { f: 0.42, o: [[-0.5, 0], [0.5, 0]] },
  3: { f: 0.4, o: [[0, -0.5], [-0.46, 0.32], [0.46, 0.32]] },
  4: { f: 0.4, o: [[-0.48, -0.48], [0.48, -0.48], [-0.48, 0.48], [0.48, 0.48]] },
  5: {
    f: 0.29,
    o: [[-0.56, -0.56], [0.56, -0.56], [0, 0], [-0.56, 0.56], [0.56, 0.56]]
  }
};

/** Fill in defaults and coerce every Glyph field into its legal range. */
function normalizeGlyph(g) {
  const src = g && typeof g === 'object' ? g : {};
  const shape = SHAPE_SET.has(src.shape) ? src.shape : SHAPE_KEYS[0];
  const size = Number.isInteger(src.size) ? clamp(src.size, 0, SIZES.length - 1) : 2;
  const fill = FILL_SET.has(src.fill) ? src.fill : FILLS[0];
  const lineWeight = Number.isInteger(src.lineWeight)
    ? clamp(src.lineWeight, 0, LINE_WEIGHTS.length - 1)
    : 1;
  let rotation = typeof src.rotation === 'number' && isFinite(src.rotation) ? src.rotation : 0;
  rotation = ((rotation % 360) + 360) % 360;
  // Contract 1.2 allows rotation only in multiples of 45 degrees. Snapping here,
  // at the single rendering chokepoint, keeps that invariant true for every
  // stimulus in the app and keeps glyphKey consistent with what is drawn.
  rotation = (Math.round(rotation / 45) * 45) % 360;
  const count = Number.isInteger(src.count) ? clamp(src.count, 1, 5) : 1;
  const dx = typeof src.dx === 'number' && isFinite(src.dx) ? clamp(src.dx, -1, 1) : 0;
  const dy = typeof src.dy === 'number' && isFinite(src.dy) ? clamp(src.dy, -1, 1) : 0;
  // color may be omitted (or -1) to request neutral stimulus ink instead of a hue.
  const hasColor = Number.isInteger(src.color) && src.color >= 0;
  const color = hasColor ? src.color % COLORS.length : -1;
  return { shape, size, fill, color, rotation, lineWeight, dx, dy, count };
}

function paintFor(colorIndex) {
  return colorIndex >= 0 ? COLORS[colorIndex] : 'var(--stim, currentColor)';
}

/** Deterministic, collision-free clip id: identical geometry -> identical id. */
function clipId(shape, extent) {
  return `cl-${shape}-${n(extent).replace(/[.-]/g, '_')}`;
}

/** Horizontal / vertical / diagonal hatch lines covering a 2h x 2h box. */
function hatchLines(kind, h, gap) {
  const parts = [];
  const guard = 64;
  if (kind === 'hStripe') {
    let k = 0;
    for (let y = -h + gap / 2; y < h && k < guard; y += gap, k += 1) {
      parts.push(`M ${n(-h)} ${n(y)} H ${n(h)}`);
    }
  } else if (kind === 'vStripe') {
    let k = 0;
    for (let x = -h + gap / 2; x < h && k < guard; x += gap, k += 1) {
      parts.push(`M ${n(x)} ${n(-h)} V ${n(h)}`);
    }
  } else {
    let k = 0;
    for (let c = -2 * h + gap / 2; c < 2 * h && k < guard; c += gap, k += 1) {
      parts.push(`M ${n(-h)} ${n(-h + c)} L ${n(h)} ${n(h + c)}`);
    }
  }
  return parts.join(' ');
}

/** A grid of dots covering a 2h x 2h box. */
function dotField(h, gap, r) {
  const parts = [];
  const guard = 24;
  let ky = 0;
  for (let y = -h + gap / 2; y < h && ky < guard; y += gap, ky += 1) {
    let kx = 0;
    for (let x = -h + gap / 2; x < h && kx < guard; x += gap, kx += 1) {
      parts.push(
        `M ${n(x - r)} ${n(y)} a ${n(r)} ${n(r)} 0 1 0 ${n(2 * r)} 0 ` +
          `a ${n(r)} ${n(r)} 0 1 0 ${n(-2 * r)} 0 Z`
      );
    }
  }
  return parts.join(' ');
}

/**
 * One copy of the glyph's shape at the origin, `extent` px across, with its
 * fill treatment. Texture is drawn as explicit lines clipped to the outline,
 * which keeps the texture phase locked to the glyph (a pattern fill would let
 * two identical glyphs differ by their position in the coordinate system).
 */
function shapeBody(shape, extent, fill, paint, strokeWidth) {
  const d = shapePath(shape, extent / 100);
  const h = extent / 2;
  const layers = [];

  if (fill === 'solid') {
    layers.push(el('path', { d, fill: paint, 'fill-rule': 'nonzero' }));
  } else if (fill === 'half') {
    layers.push(
      el('path', { d, fill: paint, 'fill-rule': 'nonzero', 'clip-path': 'url(#p-halfClip)' })
    );
  } else if (fill === 'hStripe' || fill === 'vStripe' || fill === 'dStripe' || fill === 'dots') {
    const id = clipId(shape, extent);
    layers.push(el('defs', null, el('clipPath', { id }, el('path', { d }))));
    if (fill === 'dots') {
      const gap = clamp(extent / 4.4, 5, 20);
      const r = clamp(gap * 0.24, 1, 4.5);
      layers.push(
        el('path', {
          d: dotField(h, gap, r),
          fill: paint,
          'clip-path': `url(#${id})`
        })
      );
    } else {
      const gap = clamp(extent / 6.5, 3.5, 16);
      layers.push(
        el('path', {
          d: hatchLines(fill, h, gap),
          fill: 'none',
          stroke: paint,
          'stroke-width': n(clamp(gap * 0.32, 0.9, 4)),
          'stroke-linecap': 'butt',
          'clip-path': `url(#${id})`
        })
      );
    }
  }

  layers.push(
    el('path', {
      d,
      fill: 'none',
      stroke: paint,
      'stroke-width': n(strokeWidth),
      'stroke-linejoin': 'round',
      'stroke-linecap': 'round'
    })
  );
  return layers.join('');
}

/**
 * Render one Glyph centred at (cx, cy) inside a cell of `cell` px.
 * Honours shape, size, fill, color, rotation, lineWeight, dx/dy and count.
 */
export function drawGlyph(glyph, cx, cy, cell) {
  const g = normalizeGlyph(glyph);
  const side = typeof cell === 'number' && cell > 0 ? cell : 100;
  const x = (typeof cx === 'number' && isFinite(cx) ? cx : 0) + (g.dx * side) / 2;
  const y = (typeof cy === 'number' && isFinite(cy) ? cy : 0) + (g.dy * side) / 2;

  const arrangement = ARRANGEMENTS[g.count] || ARRANGEMENTS[1];
  const extent = SIZES[g.size] * side * arrangement.f;
  const paint = paintFor(g.color);
  // The nominal weight is relative to the cell, but a small multi-copy glyph
  // (e.g. size 0 at count 5) would be swallowed by its own outline. When the
  // HEAVIEST weight would be too heavy for the drawn extent, all three weights
  // are rescaled by the same factor — never clamped individually, which would
  // merge two of them into one stroke and destroy `lineWeight` as a dimension.
  const nominal = LINE_WEIGHTS[g.lineWeight] * (side / 100);
  const heaviest = LINE_WEIGHTS[LINE_WEIGHTS.length - 1] * (side / 100);
  const weightScale = clamp(heaviest > 0 ? (extent * 0.2) / heaviest : 1, 0.35, 1);
  const strokeWidth = Math.max(0.25, nominal * weightScale);
  const body = shapeBody(g.shape, extent, g.fill, paint, strokeWidth);

  const copies = arrangement.o.map(([ox, oy]) => {
    const tx = (ox * side) / 2;
    const ty = (oy * side) / 2;
    const transform =
      tx === 0 && ty === 0 ? null : `translate(${n(tx)} ${n(ty)})`;
    return transform ? el('g', { transform }, body) : body;
  });

  const outer = [`translate(${n(x)} ${n(y)})`];
  if (g.rotation !== 0) outer.push(`rotate(${n(g.rotation)})`);
  return el('g', { transform: outer.join(' ') }, copies);
}

/** Render every glyph of one cell, centred at (cx, cy). */
export function drawCell(glyphs, cx, cy, cell) {
  if (!Array.isArray(glyphs) || glyphs.length === 0) return '';
  return glyphs.map((g) => drawGlyph(g, cx, cy, cell)).join('');
}

/* -------------------------------------------------------------- composites */

function cellFrame(x, y, side, dashed) {
  return el('rect', {
    x: n(x),
    y: n(y),
    width: n(side),
    height: n(side),
    rx: n(Math.max(4, side * 0.08)),
    ry: n(Math.max(4, side * 0.08)),
    fill: 'none',
    stroke: dashed ? 'var(--accent, #7aa2f7)' : 'var(--line, #2a2f3a)',
    'stroke-width': dashed ? n(Math.max(1.5, side * 0.022)) : n(Math.max(1, side * 0.012)),
    'stroke-dasharray': dashed ? `${n(side * 0.09)} ${n(side * 0.07)}` : null
  });
}

/**
 * A rows x cols matrix of cells. `cells[i]` is a Glyph[] (or null/empty).
 * `missingIndex` renders a dashed empty slot: no glyph, no marker, no text.
 * `frame` (default true) draws an outer boundary around the whole matrix.
 *
 * Callers that need the Item's `prompt.width` / `prompt.height` can either read
 * the `width="..."` / `height="..."` attributes off the returned string or use
 * the exact formula: pad = max(gap, 6); width = cols*cell + (cols-1)*gap + 2*pad
 * and height = rows*cell + (rows-1)*gap + 2*pad. Defaults: cell 96, gap
 * round(cell*0.18).
 */
export function gridSvg({ rows, cols, cells, cell, gap, missingIndex, frame } = {}) {
  const r = Number.isInteger(rows) && rows > 0 ? rows : 3;
  const c = Number.isInteger(cols) && cols > 0 ? cols : 3;
  const side = typeof cell === 'number' && cell > 0 ? cell : 96;
  const g = typeof gap === 'number' && gap >= 0 ? gap : Math.round(side * 0.18);
  const pad = Math.max(g, 6);
  const width = c * side + (c - 1) * g + 2 * pad;
  const height = r * side + (r - 1) * g + 2 * pad;
  const list = Array.isArray(cells) ? cells : [];
  const miss = Number.isInteger(missingIndex) ? missingIndex : -1;
  const showFrame = frame === undefined ? true : Boolean(frame);

  const parts = [];
  if (showFrame) {
    parts.push(
      el('rect', {
        x: n(pad * 0.35),
        y: n(pad * 0.35),
        width: n(width - pad * 0.7),
        height: n(height - pad * 0.7),
        rx: n(Math.max(6, side * 0.1)),
        ry: n(Math.max(6, side * 0.1)),
        fill: 'none',
        stroke: 'var(--line, #2a2f3a)',
        'stroke-width': n(Math.max(1, side * 0.012))
      })
    );
  }

  for (let i = 0; i < r * c; i += 1) {
    const row = Math.floor(i / c);
    const col = i % c;
    const x = pad + col * (side + g);
    const y = pad + row * (side + g);
    const isMissing = i === miss;
    parts.push(cellFrame(x, y, side, isMissing));
    if (!isMissing) {
      parts.push(drawCell(list[i], x + side / 2, y + side / 2, side));
    }
  }

  return svgRoot({
    width,
    height,
    className: 'stim stim-grid',
    body: parts.join('')
  });
}

/**
 * A single answer tile, drawn exactly like the cell it would fill so the right
 * option is a literal match for the blank. Size: pad = max(4, round(cell*0.1)),
 * width = height = cell + 2*pad (cell defaults to 96, giving 116).
 */
export function optionSvg(glyphs, { cell } = {}) {
  const side = typeof cell === 'number' && cell > 0 ? cell : 96;
  const pad = Math.max(4, Math.round(side * 0.1));
  const total = side + 2 * pad;
  const body =
    cellFrame(pad, pad, side, false) +
    drawCell(glyphs, pad + side / 2, pad + side / 2, side);
  return svgRoot({
    width: total,
    height: total,
    className: 'stim stim-option',
    body
  });
}

/* ------------------------------------------------------------------- keys */

/**
 * Canonical string for one glyph. Field order is fixed, values are normalised,
 * so two glyphs that render identically always produce the same key.
 */
export function glyphKey(glyph) {
  const g = normalizeGlyph(glyph);
  return [
    g.shape,
    g.size,
    g.fill,
    g.color,
    n(g.rotation),
    g.lineWeight,
    n(g.dx),
    n(g.dy),
    g.count
  ].join('|');
}

/**
 * Canonical string for a cell. Glyph keys are sorted, so two cells holding the
 * same glyphs in a different array order compare equal.
 */
export function cellKey(glyphs) {
  if (!Array.isArray(glyphs) || glyphs.length === 0) return '_empty_';
  return glyphs.map(glyphKey).sort().join('+');
}
