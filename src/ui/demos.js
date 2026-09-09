/* demos.js — wordless animated demonstrations (contract 20). Every item family and
   every drill id gets a looping frame sequence that shows the stimulus, the missing
   piece, a WRONG choice being rejected and the RIGHT choice locking in.
   This is the whole instruction system: not a single word, digit or glyph of any
   script appears in any frame. */

import { svgRoot, drawCell, drawGlyph, defsPatterns } from '../items/svg.js';

/* --------------------------------------------------------------- canvas */

const W = 560;
const H = 360;
const STIM_TOP = 12;
const STIM_H = 232;
const OPT_SIZE = 76;
const OPT_GAP = 18;

/* Demos never carry meaning in hue, so every glyph asks for neutral stimulus ink:
   items/svg.js maps a negative colour index to `var(--stim)`, which is guaranteed
   >= 7:1 on --bg-elev in both themes and maxed under .high-contrast. */
const INK = -1;

/* ---------------------------------------------------------- primitives */

function esc(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function tag(name, attrs, inner) {
  let out = `<${name}`;
  if (attrs) {
    for (const key of Object.keys(attrs)) {
      const v = attrs[key];
      if (v === null || v === undefined || v === false) continue;
      out += ` ${key}="${esc(v)}"`;
    }
  }
  if (inner === null || inner === undefined || inner === '') return `${out}/>`;
  return `${out}>${inner}</${name}>`;
}

function r2(n) {
  const v = Number.isFinite(n) ? n : 0;
  return Math.round(v * 100) / 100;
}

/** A full glyph record with the contract's defaults filled in. */
function g(shape, extra) {
  return Object.assign(
    {
      shape,
      size: 2,
      fill: 'empty',
      color: INK,
      rotation: 0,
      lineWeight: 1,
      dx: 0,
      dy: 0,
      count: 1,
    },
    extra || {}
  );
}

function defs() {
  try {
    const out = defsPatterns();
    return typeof out === 'string' ? out : '';
  } catch (err) {
    return '';
  }
}

/** Render glyphs through the real item renderer so a demo looks like an item. */
function glyphsAt(glyphs, cx, cy, cell) {
  const list = Array.isArray(glyphs) ? glyphs.filter(Boolean) : glyphs ? [glyphs] : [];
  if (!list.length) return '';
  try {
    const out = drawCell(list, cx, cy, cell);
    if (typeof out === 'string' && out.length) return out;
  } catch (err) {
    /* fall through to per-glyph rendering */
  }
  try {
    return list.map((one) => drawGlyph(one, cx, cy, cell)).join('');
  } catch (err) {
    return fallbackGlyphs(list, cx, cy, cell);
  }
}

/* Last-resort rendering if items/svg.js cannot draw a glyph: plain outlines so the
   demo still communicates rather than showing an empty box. */
function fallbackGlyphs(list, cx, cy, cell) {
  return list
    .map((one) => {
      const r = (cell / 2) * 0.7;
      if (one.shape === 'square' || one.shape === 'roundedSquare') {
        return tag('rect', {
          class: 'd-fallback',
          x: r2(cx - r),
          y: r2(cy - r),
          width: r2(r * 2),
          height: r2(r * 2),
          rx: 3,
        });
      }
      if (one.shape === 'triangleUp') {
        return tag('path', {
          class: 'd-fallback',
          d: `M${r2(cx)} ${r2(cy - r)}L${r2(cx + r)} ${r2(cy + r)}L${r2(cx - r)} ${r2(cy + r)}Z`,
        });
      }
      return tag('circle', { class: 'd-fallback', cx: r2(cx), cy: r2(cy), r: r2(r) });
    })
    .join('');
}

function root(body) {
  const inner = tag('g', { class: 'demo-svg' }, body);
  try {
    /* svgRoot already prepends defsPatterns(), so the fill patterns resolve. */
    const out = svgRoot({
      width: W,
      height: H,
      viewBox: `0 0 ${W} ${H}`,
      className: 'demo-root',
      body: inner,
    });
    if (typeof out === 'string' && out.trim().startsWith('<svg')) return out;
  } catch (err) {
    /* fall through to the local wrapper */
  }
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" ` +
    `height="${H}" class="demo-root" role="img" aria-hidden="true">${defs()}${inner}</svg>`
  );
}

function frame(body, ms) {
  return { svg: root(body), ms };
}

/* ------------------------------------------------------------ chrome bits */

const STATE_CLASS = {
  idle: 'd-frame',
  plain: 'd-frame d-frame--plain',
  blank: 'd-frame d-frame--blank',
  focus: 'd-frame d-frame--focus',
  accept: 'd-frame d-frame--good',
  reject: 'd-frame d-frame--bad',
  lit: 'd-frame d-frame--lit',
  ghost: 'd-frame d-frame--ghost',
  hidden: 'd-frame d-frame--hidden',
};

function slot(x, y, size, state, radius) {
  return tag('rect', {
    class: STATE_CLASS[state] || STATE_CLASS.idle,
    x: r2(x),
    y: r2(y),
    width: r2(size),
    height: r2(size),
    rx: radius === undefined ? 10 : radius,
  });
}

function mark(state, x, y, size) {
  if (state === 'accept') {
    return tag('circle', {
      class: 'd-mark-good',
      cx: r2(x + size - 16),
      cy: r2(y + size - 16),
      r: 7,
    });
  }
  if (state === 'reject') {
    return tag('circle', {
      class: 'd-mark-bad',
      cx: r2(x + size - 16),
      cy: r2(y + size - 16),
      r: 6.5,
    });
  }
  return '';
}

/** One framed cell holding glyphs, in one of the demo states. */
function tile(x, y, size, glyphs, state, opts) {
  const st = state || 'idle';
  const pad = (opts && opts.pad) || 0.78;
  const inner =
    slot(x, y, size, st === 'reject' ? 'reject' : st) +
    (st === 'blank' ? '' : glyphsAt(glyphs, x + size / 2, y + size / 2, size * pad)) +
    mark(st, x, y, size);
  if (st === 'reject') {
    const cx = x + size / 2;
    const cy = y + size / 2;
    const k = 0.84;
    return tag(
      'g',
      {
        class: 'd-dim',
        transform: `translate(${r2(cx - k * cx)} ${r2(cy - k * cy)}) scale(${k})`,
      },
      inner
    );
  }
  return tag('g', null, inner);
}

function band(x, y, width, height) {
  return tag('rect', {
    class: 'd-band',
    x: r2(x),
    y: r2(y),
    width: r2(width),
    height: r2(height),
    rx: 14,
  });
}

/** A link between two points: down, across, up. Used for pair and n-back cues. */
function bracket(x1, x2, y, bad) {
  const drop = 12;
  const d =
    `M${r2(x1)} ${r2(y)}L${r2(x1)} ${r2(y + drop)}` +
    `L${r2(x2)} ${r2(y + drop)}L${r2(x2)} ${r2(y)}`;
  return tag('path', { class: bad ? 'd-link d-link--bad' : 'd-link', d });
}

function rowX(count, size, gap) {
  const total = count * size + (count - 1) * gap;
  return (W - total) / 2;
}

function stateFns(wrongIndex) {
  return {
    idle: () => 'idle',
    all: (state) => () => state,
    only: (index, state) => (i) => (i === index ? state : 'idle'),
    after: (index, state) => (i) => {
      if (i === wrongIndex) return 'reject';
      return i === index ? state : 'idle';
    },
  };
}

/* ------------------------------------------------------- generic scripts */

/**
 * The canonical eight-frame lesson: stimulus, the constraint, the options,
 * a wrong pick rejected, the right pick locked in, the solved stimulus.
 */
function choiceFrames(stim, options, correct, wrong, opts) {
  const cfg = opts || {};
  const size = cfg.optionSize || (options.length > 4 ? 62 : OPT_SIZE);
  const gap = cfg.optionGap || OPT_GAP;
  const y = cfg.optionY === undefined ? H - size - 20 : cfg.optionY;
  const x0 = rowX(options.length, size, gap);
  const S = stateFns(wrong);

  const row = (stateOf) =>
    options.map((glyphs, i) => tile(x0 + i * (size + gap), y, size, glyphs, stateOf(i))).join('');

  return {
    frames: [
      frame(stim('idle'), 900),
      frame(stim('cue'), 850),
      frame(stim('idle') + row(S.idle), 850),
      frame(stim('idle') + row(S.only(wrong, 'focus')), 720),
      frame(stim('idle') + row(S.only(wrong, 'reject')), 950),
      frame(stim('idle') + row(S.after(correct, 'focus')), 720),
      frame(stim('idle') + row(S.after(correct, 'accept')), 900),
      frame(stim('solved') + row(S.after(correct, 'accept')), 1050),
    ],
    loop: true,
  };
}

/** For families where the stimulus IS the answer set (odd-one-out style). */
function selectFrames(items, correct, wrong, opts) {
  const cfg = opts || {};
  const size = cfg.size || 78;
  const gap = cfg.gap || 14;
  const x0 = rowX(items.length, size, gap);
  const y = cfg.y === undefined ? STIM_TOP + (STIM_H - size) / 2 + 20 : cfg.y;
  const S = stateFns(wrong);

  const row = (stateOf) =>
    items.map((glyphs, i) => tile(x0 + i * (size + gap), y, size, glyphs, stateOf(i))).join('');

  return {
    frames: [
      frame(row(S.idle), 900),
      frame(row(S.all('focus')), 850),
      frame(row(S.idle), 700),
      frame(row(S.only(wrong, 'focus')), 720),
      frame(row(S.only(wrong, 'reject')), 950),
      frame(row(S.after(correct, 'focus')), 720),
      frame(row(S.after(correct, 'accept')), 950),
      frame(row(S.after(correct, 'accept')), 1050),
    ],
    loop: true,
  };
}

/* ------------------------------------------------------------- layouts */

function gridLayout(rows, cols, cell, gap, top, height) {
  const totalW = cols * cell + (cols - 1) * gap;
  const totalH = rows * cell + (rows - 1) * gap;
  const x0 = (W - totalW) / 2;
  const y0 = (top === undefined ? STIM_TOP : top) +
    ((height === undefined ? STIM_H : height) - totalH) / 2;
  return {
    cell,
    gap,
    x0,
    y0,
    totalW,
    totalH,
    x: (c) => x0 + c * (cell + gap),
    y: (r) => y0 + r * (cell + gap),
  };
}

/* --------------------------------------------------------------- matrix */

/* Rule set: shape is constant along each row, count grows along each column.
   Both readings verify the same missing cell, so nothing depends on reading
   left-to-right. */
function matrixDemo() {
  const shapes = ['circle', 'square', 'triangleUp'];
  const L = gridLayout(3, 3, 68, 12);

  const cellGlyphs = (r, c) => [g(shapes[r], { count: c + 1, size: 1 })];

  const stim = (phase) => {
    let out = '';
    if (phase === 'cue') {
      out += band(L.x0 - 8, L.y(2) - 8, L.totalW + 16, L.cell + 16);
      out += band(L.x(2) - 8, L.y0 - 8, L.cell + 16, L.totalH + 16);
    }
    for (let r = 0; r < 3; r += 1) {
      for (let c = 0; c < 3; c += 1) {
        const last = r === 2 && c === 2;
        if (last) {
          if (phase === 'solved') out += tile(L.x(c), L.y(r), L.cell, cellGlyphs(2, 2), 'accept');
          else out += tile(L.x(c), L.y(r), L.cell, null, 'blank');
        } else {
          out += tile(L.x(c), L.y(r), L.cell, cellGlyphs(r, c), 'plain');
        }
      }
    }
    return out;
  };

  const options = [
    [g('triangleUp', { count: 2, size: 1 })],
    [g('square', { count: 3, size: 1 })],
    [g('triangleUp', { count: 3, size: 1 })],
    [g('circle', { count: 3, size: 1 })],
  ];
  return choiceFrames(stim, options, 2, 0);
}

/* ---------------------------------------------------------- progression */

/* One attribute moves in equal steps along a rail. */
function progressionDemo() {
  const cell = 84;
  const gap = 18;
  const x0 = rowX(4, cell, gap);
  const y = STIM_TOP + (STIM_H - cell) / 2;
  const railY = y + cell + 16;

  const stim = (phase) => {
    let out = tag('line', {
      class: 'd-rail',
      x1: r2(x0 - 10),
      y1: r2(railY),
      x2: r2(x0 + 4 * cell + 3 * gap + 10),
      y2: r2(railY),
    });
    for (let i = 0; i < 4; i += 1) {
      const x = x0 + i * (cell + gap);
      out += tag('line', {
        class: 'd-tick',
        x1: r2(x + cell / 2),
        y1: r2(railY - 6),
        x2: r2(x + cell / 2),
        y2: r2(railY + 6),
      });
      if (i === 3) {
        if (phase === 'solved') out += tile(x, y, cell, [g('hexagon', { size: 3 })], 'accept');
        else out += tile(x, y, cell, null, 'blank');
      } else {
        out += tile(x, y, cell, [g('hexagon', { size: i })], 'plain');
      }
    }
    if (phase === 'cue') {
      out += band(x0 - 8, y - 8, 4 * cell + 3 * gap + 16, cell + 16);
    }
    return out;
  };

  const options = [
    [g('hexagon', { size: 1 })],
    [g('circle', { size: 3 })],
    [g('hexagon', { size: 3 })],
    [g('hexagon', { size: 2 })],
  ];
  return choiceFrames(stim, options, 2, 3);
}

/* ---------------------------------------------------------------- series */

/* Alternation along an explicit geometric track — never an arrow. */
function seriesDemo() {
  const cell = 76;
  const gap = 14;
  const x0 = rowX(5, cell, gap);
  const y = STIM_TOP + (STIM_H - cell) / 2;
  const railY = y + cell + 18;
  const seq = ['circle', 'square', 'circle', 'square'];

  const stim = (phase) => {
    let out = tag('line', {
      class: 'd-rail',
      x1: r2(x0 - 12),
      y1: r2(railY),
      x2: r2(x0 + 5 * cell + 4 * gap + 12),
      y2: r2(railY),
    });
    for (let i = 0; i < 5; i += 1) {
      const x = x0 + i * (cell + gap);
      out += tag('circle', {
        class: 'd-node',
        cx: r2(x + cell / 2),
        cy: r2(railY),
        r: 4,
      });
      if (i === 4) {
        if (phase === 'solved') out += tile(x, y, cell, [g('circle', { size: 2 })], 'accept');
        else out += tile(x, y, cell, null, 'blank');
      } else {
        out += tile(x, y, cell, [g(seq[i], { size: 2 })], 'plain');
      }
    }
    if (phase === 'cue') {
      for (let i = 0; i < 4; i += 2) {
        const x = x0 + i * (cell + gap);
        out += band(x - 6, y - 6, cell + 12, cell + 12);
      }
    }
    return out;
  };

  const options = [
    [g('circle', { size: 2 })],
    [g('square', { size: 2 })],
    [g('triangleUp', { size: 2 })],
    [g('circle', { size: 2, fill: 'solid' })],
  ];
  return choiceFrames(stim, options, 0, 1);
}

/* -------------------------------------------------------------- analogy */

/* Two pairs; the transform learned from the first pair applies to the second. */
function analogyDemo() {
  const cell = 88;
  const gapIn = 54;
  const gapRow = 20;
  const pairW = cell * 2 + gapIn;
  const x0 = (W - pairW) / 2;
  const y0 = STIM_TOP + (STIM_H - (cell * 2 + gapRow)) / 2;
  const xa = x0;
  const xb = x0 + cell + gapIn;
  const y1 = y0;
  const y2 = y0 + cell + gapRow;

  const stim = (phase) => {
    let out = '';
    if (phase === 'cue') {
      out += band(xa - 6, y1 - 6, pairW + 12, cell + 12);
      out += band(xa - 6, y2 - 6, pairW + 12, cell + 12);
    }
    out += tile(xa, y1, cell, [g('square', { size: 2 })], 'plain');
    out += tile(xb, y1, cell, [g('square', { size: 2, fill: 'solid' })], 'plain');
    out += bracket(xa + cell + 6, xb - 6, y1 + cell / 2 - 6);
    out += tile(xa, y2, cell, [g('triangleUp', { size: 2 })], 'plain');
    if (phase === 'solved') {
      out += tile(xb, y2, cell, [g('triangleUp', { size: 2, fill: 'solid' })], 'accept');
    } else {
      out += tile(xb, y2, cell, null, 'blank');
    }
    out += bracket(xa + cell + 6, xb - 6, y2 + cell / 2 - 6);
    return out;
  };

  const options = [
    [g('triangleUp', { size: 2 })],
    [g('square', { size: 2, fill: 'solid' })],
    [g('circle', { size: 2, fill: 'solid' })],
    [g('triangleUp', { size: 2, fill: 'solid' })],
  ];
  return choiceFrames(stim, options, 3, 1);
}

/* ----------------------------------------------------------- oddOneOut */

/* Four share an invariant (count); one breaks it. Shape varies everywhere so
   surface similarity cannot solve it. */
function oddOneOutDemo() {
  const items = [
    [g('circle', { count: 3, size: 1 })],
    [g('square', { count: 3, size: 1 })],
    [g('triangleUp', { count: 4, size: 1 })],
    [g('hexagon', { count: 3, size: 1 })],
    [g('diamond', { count: 3, size: 1 })],
  ];
  return selectFrames(items, 2, 0);
}

/* -------------------------------------------------------- constraintGrid */

/* Every row and every column must hold each shape exactly once. */
function constraintGridDemo() {
  const A = 'circle';
  const B = 'square';
  const C = 'triangleUp';
  const board = [
    [A, B, C],
    [B, C, A],
    [C, A, null],
  ];
  const L = gridLayout(3, 3, 68, 12);

  const stim = (phase) => {
    let out = '';
    if (phase === 'cue') {
      out += band(L.x0 - 8, L.y(2) - 8, L.totalW + 16, L.cell + 16);
      out += band(L.x(2) - 8, L.y0 - 8, L.cell + 16, L.totalH + 16);
    }
    for (let r = 0; r < 3; r += 1) {
      for (let c = 0; c < 3; c += 1) {
        const shape = board[r][c];
        if (shape === null) {
          if (phase === 'solved') out += tile(L.x(c), L.y(r), L.cell, [g(B, { size: 2 })], 'accept');
          else out += tile(L.x(c), L.y(r), L.cell, null, 'blank');
        } else {
          out += tile(L.x(c), L.y(r), L.cell, [g(shape, { size: 2 })], 'plain');
        }
      }
    }
    return out;
  };

  const options = [
    [g('triangleUp', { size: 2 })],
    [g('square', { size: 2 })],
    [g('circle', { size: 2 })],
    [g('hexagon', { size: 2 })],
  ];
  return choiceFrames(stim, options, 1, 2);
}

/* ---------------------------------------------------- relationalIntegration */

/* Two relations must be held at once: fill changes along the row, size along the
   column. Each distractor satisfies exactly one of them. */
function relationalIntegrationDemo() {
  const L = gridLayout(2, 2, 92, 20);
  const cells = [
    [g('circle', { size: 1 }), g('circle', { size: 1, fill: 'solid' })],
    [g('circle', { size: 3 }), g('circle', { size: 3, fill: 'solid' })],
  ];

  const stim = (phase) => {
    let out = '';
    if (phase === 'cue') {
      out += band(L.x0 - 8, L.y(1) - 8, L.totalW + 16, L.cell + 16);
      out += band(L.x(1) - 8, L.y0 - 8, L.cell + 16, L.totalH + 16);
    }
    for (let r = 0; r < 2; r += 1) {
      for (let c = 0; c < 2; c += 1) {
        const last = r === 1 && c === 1;
        if (last) {
          if (phase === 'solved') out += tile(L.x(c), L.y(r), L.cell, [cells[1][1]], 'accept');
          else out += tile(L.x(c), L.y(r), L.cell, null, 'blank');
        } else {
          out += tile(L.x(c), L.y(r), L.cell, [cells[r][c]], 'plain');
        }
      }
    }
    return out;
  };

  const options = [
    [g('circle', { size: 1, fill: 'solid' })],
    [g('circle', { size: 3 })],
    [g('circle', { size: 3, fill: 'solid' })],
    [g('circle', { size: 1 })],
  ];
  return choiceFrames(stim, options, 2, 0);
}

/* -------------------------------------------------------- mentalRotation */

/* The target turns; one option is the same figure at a different angle. */
function mentalRotationDemo() {
  const cell = 132;
  const x = (W - cell) / 2;
  const y = STIM_TOP + (STIM_H - cell) / 2 - 6;

  const stim = (phase) => {
    let out = '';
    if (phase === 'cue') {
      out += tag('g', { class: 'd-ghost-layer' },
        tile(x, y, cell, [g('lShape', { size: 3, rotation: 45 })], 'hidden') +
        tile(x, y, cell, [g('lShape', { size: 3, rotation: 90 })], 'hidden'));
      out += tag('circle', {
        class: 'd-orbit',
        cx: r2(x + cell / 2),
        cy: r2(y + cell / 2),
        r: r2(cell * 0.46),
      });
    }
    out += tile(x, y, cell, [g('lShape', { size: 3 })], phase === 'solved' ? 'accept' : 'plain');
    return out;
  };

  const options = [
    [g('zShape', { size: 2, rotation: 90 })],
    [g('lShape', { size: 2, rotation: 135 })],
    [g('tShape', { size: 2, rotation: 45 })],
    [g('uShape', { size: 2, rotation: 180 })],
  ];
  return choiceFrames(stim, options, 1, 3);
}

/* ---------------------------------------------------------- paperFolding */

/* Fold, punch, unfold. The demo shows the mechanism once, then the choice. */
function paperFoldingDemo() {
  const size = 150;
  const x = (W - size) / 2;
  const y = STIM_TOP + (STIM_H - size) / 2 - 8;
  const mid = x + size / 2;

  const sheet = (attrs) => tag('rect', Object.assign({ class: 'd-sheet', rx: 6 }, attrs));
  const hole = (cx, cy) => tag('circle', { class: 'd-hole', cx: r2(cx), cy: r2(cy), r: 11 });

  const flat = () => sheet({ x: r2(x), y: r2(y), width: r2(size), height: r2(size) });
  const foldLine = () =>
    tag('line', { class: 'd-fold', x1: r2(mid), y1: r2(y), x2: r2(mid), y2: r2(y + size) });
  const folded = () =>
    sheet({ x: r2(x), y: r2(y), width: r2(size / 2), height: r2(size) }) +
    tag('rect', {
      class: 'd-sheet-ghost',
      x: r2(mid),
      y: r2(y),
      width: r2(size / 2),
      height: r2(size),
      rx: 6,
    }) +
    tag('line', { class: 'd-fold-solid', x1: r2(mid), y1: r2(y), x2: r2(mid), y2: r2(y + size) });

  const punchX = x + size * 0.24;
  const punchY = y + size * 0.34;
  const mirrorX = 2 * mid - punchX;

  const optSheet = (holes) => {
    const s = 46;
    const ox = -s / 2;
    const oy = -s / 2;
    let out = tag('rect', { class: 'd-sheet', x: r2(ox), y: r2(oy), width: s, height: s, rx: 4 });
    for (const [hx, hy] of holes) {
      out += tag('circle', { class: 'd-hole', cx: r2(ox + hx * s), cy: r2(oy + hy * s), r: 5.5 });
    }
    return out;
  };

  const optionPatterns = [
    [[0.26, 0.34], [0.44, 0.34]],
    [[0.26, 0.34], [0.74, 0.34]],
    [[0.5, 0.5]],
    [[0.26, 0.3], [0.74, 0.3], [0.26, 0.72], [0.74, 0.72]],
  ];
  const correct = 1;
  const wrong = 0;

  const optSize = OPT_SIZE;
  const optY = H - optSize - 20;
  const optX0 = rowX(4, optSize, OPT_GAP);
  const S = stateFns(wrong);
  const optRow = (stateOf) =>
    optionPatterns
      .map((holes, i) => {
        const ox = optX0 + i * (optSize + OPT_GAP);
        const st = stateOf(i);
        const contents = tag(
          'g',
          { transform: `translate(${r2(ox + optSize / 2)} ${r2(optY + optSize / 2)})` },
          optSheet(holes)
        );
        const inner = slot(ox, optY, optSize, st) + contents + mark(st, ox, optY, optSize);
        if (st === 'reject') {
          const cx = ox + optSize / 2;
          const cy = optY + optSize / 2;
          const k = 0.84;
          return tag(
            'g',
            {
              class: 'd-dim',
              transform: `translate(${r2(cx - k * cx)} ${r2(cy - k * cy)}) scale(${k})`,
            },
            inner
          );
        }
        return tag('g', null, inner);
      })
      .join('');

  const frames = [
    frame(flat() + foldLine(), 900),
    frame(folded(), 850),
    frame(folded() + hole(punchX, punchY), 900),
    frame(folded() + hole(punchX, punchY) + optRow(S.idle), 900),
    frame(folded() + hole(punchX, punchY) + optRow(S.only(wrong, 'focus')), 720),
    frame(folded() + hole(punchX, punchY) + optRow(S.only(wrong, 'reject')), 950),
    frame(folded() + hole(punchX, punchY) + optRow(S.after(correct, 'focus')), 720),
    frame(folded() + hole(punchX, punchY) + optRow(S.after(correct, 'accept')), 900),
    frame(
      flat() + foldLine() + hole(punchX, punchY) + hole(mirrorX, punchY) + optRow(S.after(correct, 'accept')),
      1100
    ),
  ];
  return { frames, loop: true };
}

/* ------------------------------------------------------------- ruleMiner */

/* Three worked pairs expose one transform; the probe applies it. */
function ruleMinerDemo() {
  const cell = 52;
  const gapRow = 6;
  const gapIn = 46;
  const pairW = cell * 2 + gapIn;
  const x0 = (W - pairW) / 2;
  const totalH = 4 * cell + 3 * gapRow;
  const y0 = STIM_TOP + (STIM_H - totalH) / 2;
  const rows = [
    ['lShape', 0, 90],
    ['tShape', 0, 90],
    ['uShape', 45, 135],
    ['zShape', 0, 90],
  ];

  const stim = (phase) => {
    let out = '';
    for (let i = 0; i < rows.length; i += 1) {
      const [shape, from, to] = rows[i];
      const y = y0 + i * (cell + gapRow);
      const probe = i === rows.length - 1;
      if (phase === 'cue' && !probe) out += band(x0 - 6, y - 4, pairW + 12, cell + 8);
      out += tile(x0, y, cell, [g(shape, { size: 3, rotation: from })], 'plain');
      out += bracket(x0 + cell + 5, x0 + cell + gapIn - 5, y + cell / 2 - 6);
      const rx = x0 + cell + gapIn;
      if (probe) {
        if (phase === 'solved') {
          out += tile(rx, y, cell, [g(shape, { size: 3, rotation: to })], 'accept');
        } else {
          out += tile(rx, y, cell, null, 'blank');
        }
      } else {
        out += tile(rx, y, cell, [g(shape, { size: 3, rotation: to })], 'plain');
      }
    }
    return out;
  };

  const options = [
    [g('zShape', { size: 2, rotation: 180 })],
    [g('zShape', { size: 2, rotation: 90 })],
    [g('lShape', { size: 2, rotation: 90 })],
    [g('zShape', { size: 2, rotation: 270 })],
  ];
  return choiceFrames(stim, options, 1, 0);
}

/* ----------------------------------------------------------------- nback */

/* A stream, a memory strip, and one response control. A link joins the current
   item to the item two steps back; matching links accept, mismatching reject. */
function nbackDemo() {
  const main = 118;
  const mx = (W - main) / 2;
  const my = STIM_TOP + 10;
  const cell = 46;
  const gap = 10;
  const strip = 6;
  const sx0 = rowX(strip, cell, gap);
  const sy = my + main + 26;
  const respSize = 84;
  const rx = (W - respSize) / 2;
  const ry = H - respSize - 16;

  const seq = ['circle', 'square', 'circle', 'triangleUp', 'square', 'triangleUp'];
  const shapeAt = (i) => g(seq[i], { size: 2 });

  const stripAt = (count) => {
    let out = '';
    for (let i = 0; i < strip; i += 1) {
      const x = sx0 + i * (cell + gap);
      if (i < count) out += tile(x, sy, cell, [shapeAt(i)], 'plain', { pad: 0.72 });
      else out += tile(x, sy, cell, null, 'blank');
    }
    return out;
  };

  const linkAt = (a, b, bad) => {
    const xa = sx0 + a * (cell + gap) + cell / 2;
    const xb = sx0 + b * (cell + gap) + cell / 2;
    return bracket(xa, xb, sy + cell + 4, bad);
  };

  const mainAt = (i, state) =>
    i === null
      ? tile(mx, my, main, null, 'blank')
      : tile(mx, my, main, [shapeAt(i)], state || 'plain');

  const resp = (state) => tile(rx, ry, respSize, [g('octagon', { size: 2, fill: 'solid' })], state);

  const frames = [
    frame(mainAt(null) + stripAt(0) + resp('idle'), 800),
    frame(mainAt(0) + stripAt(1) + resp('idle'), 850),
    frame(mainAt(1) + stripAt(2) + resp('idle'), 850),
    frame(mainAt(2, 'focus') + stripAt(3) + linkAt(0, 2, false) + resp('focus'), 900),
    frame(mainAt(2, 'accept') + stripAt(3) + linkAt(0, 2, false) + resp('accept'), 900),
    frame(mainAt(3) + stripAt(4) + linkAt(1, 3, true) + resp('reject'), 950),
    frame(mainAt(4) + stripAt(5) + linkAt(2, 4, true) + resp('idle'), 800),
    frame(mainAt(5, 'accept') + stripAt(6) + linkAt(3, 5, false) + resp('accept'), 1050),
  ];
  return { frames, loop: true };
}

/* ----------------------------------------------------------------- corsi */

/* A path is shown, then reproduced. Order is carried by a trail, never a numeral. */
function corsiDemo() {
  const L = gridLayout(3, 3, 58, 16);
  const path = [[0, 1], [1, 2], [2, 0]];
  const centre = (r, c) => [L.x(c) + L.cell / 2, L.y(r) + L.cell / 2];

  /* the lit block matches the drill: a solid rounded square in neutral ink */
  const block = [g('roundedSquare', { size: 3, fill: 'solid' })];

  const boardWith = (lit, marks) => {
    let out = '';
    for (let r = 0; r < 3; r += 1) {
      for (let c = 0; c < 3; c += 1) {
        const key = `${r},${c}`;
        const state = (marks && marks[key]) || (lit && lit === key ? 'lit' : 'plain');
        const filled = state === 'lit' || state === 'accept' || state === 'reject';
        out += tile(L.x(c), L.y(r), L.cell, filled ? block : null, state, { pad: 0.62 });
      }
    }
    return out;
  };

  const trail = (upto) => {
    if (upto < 2) return '';
    let d = '';
    for (let i = 0; i < upto; i += 1) {
      const [px, py] = centre(path[i][0], path[i][1]);
      d += `${i === 0 ? 'M' : 'L'}${r2(px)} ${r2(py)}`;
    }
    return tag('path', { class: 'd-trail', d });
  };

  const litKey = (i) => `${path[i][0]},${path[i][1]}`;

  const frames = [
    frame(boardWith(null, null), 800),
    frame(boardWith(litKey(0), null), 780),
    frame(boardWith(litKey(1), null) + trail(2), 780),
    frame(boardWith(litKey(2), null) + trail(3), 780),
    frame(boardWith(null, null), 850),
    frame(boardWith(null, { '1,1': 'reject' }), 950),
    frame(boardWith(null, { [litKey(0)]: 'accept' }), 780),
    frame(
      boardWith(null, {
        [litKey(0)]: 'accept',
        [litKey(1)]: 'accept',
        [litKey(2)]: 'accept',
      }) + trail(3),
      1050
    ),
  ];
  return { frames, loop: true };
}

/* ----------------------------------------------------------- setShifting */

/* The active sorting dimension changes mid-demo: the key swatch switches from a
   shape key to a fill key, and the previously correct bin is now rejected. */
function setShiftingDemo() {
  const keySize = 62;
  const keyX = (W - keySize) / 2;
  const keyY = STIM_TOP + 4;
  const cardSize = 92;
  const cardX = (W - cardSize) / 2;
  const cardY = keyY + keySize + 22;
  const binSize = 86;
  const binGap = 60;
  const binX0 = rowX(2, binSize, binGap);
  const binY = H - binSize - 18;

  const shapeKey = () => tile(keyX, keyY, keySize, [g('square', { size: 2 })], 'focus', { pad: 0.66 });
  const fillKey = () =>
    tile(keyX, keyY, keySize, [g('circle', { size: 2, fill: 'solid' })], 'focus', { pad: 0.66 });

  const card = () => tile(cardX, cardY, cardSize, [g('square', { size: 2, fill: 'solid' })], 'plain');

  const bins = (a, b) =>
    tile(binX0, binY, binSize, [g('square', { size: 2 })], a) +
    tile(binX0 + binSize + binGap, binY, binSize, [g('circle', { size: 2, fill: 'solid' })], b);

  const frames = [
    frame(shapeKey() + card() + bins('idle', 'idle'), 900),
    frame(shapeKey() + card() + bins('focus', 'idle'), 780),
    frame(shapeKey() + card() + bins('accept', 'idle'), 950),
    frame(fillKey() + card() + bins('idle', 'idle'), 900),
    frame(fillKey() + card() + bins('focus', 'idle'), 760),
    frame(fillKey() + card() + bins('reject', 'idle'), 950),
    frame(fillKey() + card() + bins('reject', 'focus'), 760),
    frame(fillKey() + card() + bins('reject', 'accept'), 1050),
  ];
  return { frames, loop: true };
}

/* --------------------------------------------------------- flankerControl */

/* Respond to the ringed middle element, not to its neighbours. */
function flankerControlDemo() {
  const cell = 74;
  const gap = 8;
  const x0 = rowX(5, cell, gap);
  const y = STIM_TOP + (STIM_H - cell) / 2;

  const rowOf = (flank, centreShape, ringed) => {
    let out = '';
    for (let i = 0; i < 5; i += 1) {
      const x = x0 + i * (cell + gap);
      const middle = i === 2;
      const shape = middle ? centreShape : flank;
      const state = middle && ringed ? 'focus' : 'plain';
      const inner = tile(x, y, cell, [g(shape, { size: 2, fill: 'solid' })], state);
      out += ringed && !middle ? tag('g', { class: 'd-dim' }, inner) : inner;
    }
    return out;
  };

  const stim = (phase) => rowOf('triangleLeft', 'triangleRight', phase !== 'idle');

  const options = [[g('triangleLeft', { size: 2, fill: 'solid' })], [g('triangleRight', { size: 2, fill: 'solid' })]];

  const size = 96;
  const gapO = 40;
  const x0o = rowX(2, size, gapO);
  const yo = H - size - 18;
  const S = stateFns(0);
  const row = (stateOf) =>
    options.map((glyphs, i) => tile(x0o + i * (size + gapO), yo, size, glyphs, stateOf(i))).join('');

  const frames = [
    frame(rowOf('triangleLeft', 'triangleRight', false), 880),
    frame(stim('cue'), 820),
    frame(stim('cue') + row(S.idle), 820),
    frame(stim('cue') + row(S.only(0, 'focus')), 720),
    frame(stim('cue') + row(S.only(0, 'reject')), 950),
    frame(stim('cue') + row(S.after(1, 'focus')), 720),
    frame(stim('cue') + row(S.after(1, 'accept')), 900),
    frame(
      rowOf('triangleRight', 'triangleRight', true) +
        options
          .map((glyphs, i) => tile(x0o + i * (size + gapO), yo, size, glyphs, i === 1 ? 'accept' : 'idle'))
          .join(''),
      1050
    ),
  ];
  return { frames, loop: true };
}

/* ----------------------------------------------------- speedDiscrimination */

/* Same task as always, but a draining bar makes the deadline visible. */
function speedDiscriminationDemo() {
  const barX = 60;
  const barW = W - 120;
  const barY = STIM_TOP + 6;
  const cell = 118;
  const gap = 56;
  const x0 = rowX(2, cell, gap);
  const y = STIM_TOP + 44 + (STIM_H - 44 - cell) / 2;

  const timer = (fraction) =>
    tag('rect', {
      class: 'd-timer-track',
      x: r2(barX),
      y: r2(barY),
      width: r2(barW),
      height: 12,
      rx: 6,
    }) +
    tag('rect', {
      class: 'd-timer-fill',
      x: r2(barX),
      y: r2(barY),
      width: r2(Math.max(0, Math.min(1, fraction)) * barW),
      height: 12,
      rx: 6,
    });

  const pairRow = (small, large, stateOf) => {
    const glyphs = [[g('octagon', { size: small })], [g('octagon', { size: large })]];
    return glyphs
      .map((one, i) => tile(x0 + i * (cell + gap), y, cell, one, stateOf(i)))
      .join('');
  };

  const S = stateFns(0);

  const frames = [
    frame(timer(1), 760),
    frame(timer(0.88) + pairRow(1, 2, S.idle), 860),
    frame(timer(0.72) + pairRow(1, 2, S.only(0, 'focus')), 720),
    frame(timer(0.58) + pairRow(1, 2, S.only(0, 'reject')), 900),
    frame(timer(0.44) + pairRow(1, 2, S.after(1, 'focus')), 720),
    frame(timer(0.32) + pairRow(1, 2, S.after(1, 'accept')), 900),
    frame(timer(1) + pairRow(3, 2, () => 'idle'), 760),
    frame(
      timer(0.86) +
        pairRow(3, 2, (i) => (i === 0 ? 'accept' : 'idle')),
      1050
    ),
  ];
  return { frames, loop: true };
}

/* --------------------------------------------------------------- generic */

/* Used when a caller asks for a demo we do not have a bespoke script for. It still
   teaches the core interaction: a blank, a wrong pick, a right pick. */
function genericDemo() {
  const cell = 120;
  const x = (W - cell) / 2;
  const y = STIM_TOP + (STIM_H - cell) / 2;

  const stim = (phase) => {
    if (phase === 'solved') return tile(x, y, cell, [g('hexagon', { size: 2 })], 'accept');
    let out = tile(x, y, cell, null, 'blank');
    if (phase === 'cue') out = band(x - 10, y - 10, cell + 20, cell + 20) + out;
    return out;
  };

  const options = [
    [g('circle', { size: 2 })],
    [g('hexagon', { size: 2 })],
    [g('square', { size: 2 })],
    [g('triangleUp', { size: 2 })],
  ];
  return choiceFrames(stim, options, 1, 0);
}

/* -------------------------------------------------------------- registry */

const BUILDERS = {
  matrix: matrixDemo,
  matrixForge: matrixDemo,
  progression: progressionDemo,
  series: seriesDemo,
  sequenceExtrapolation: seriesDemo,
  analogy: analogyDemo,
  oddOneOut: oddOneOutDemo,
  constraintGrid: constraintGridDemo,
  relationalIntegration: relationalIntegrationDemo,
  mentalRotation: mentalRotationDemo,
  paperFolding: paperFoldingDemo,
  ruleMiner: ruleMinerDemo,
  nback: nbackDemo,
  corsi: corsiDemo,
  setShifting: setShiftingDemo,
  flankerControl: flankerControlDemo,
  speedDiscrimination: speedDiscriminationDemo,
};

const LOWER = (() => {
  const map = {};
  for (const key of Object.keys(BUILDERS)) map[key.toLowerCase()] = BUILDERS[key];
  map['n-back'] = BUILDERS.nback;
  map['odd-one-out'] = BUILDERS.oddOneOut;
  map['paper-folding'] = BUILDERS.paperFolding;
  map['mental-rotation'] = BUILDERS.mentalRotation;
  map['constraint-grid'] = BUILDERS.constraintGrid;
  map['set-shifting'] = BUILDERS.setShifting;
  map['rule-miner'] = BUILDERS.ruleMiner;
  map['matrix-forge'] = BUILDERS.matrixForge;
  map.spatial = BUILDERS.mentalRotation;
  map.induction = BUILDERS.matrix;
  map.workingmemory = BUILDERS.nback;
  map.relational = BUILDERS.relationalIntegration;
  map.speed = BUILDERS.speedDiscrimination;
  map.flexibility = BUILDERS.setShifting;
  return map;
})();

/**
 * demoFor(kindId) -> { frames: [{ svg, ms }], loop: true }
 * Defined for every item family and every drill id. Never throws and never
 * returns fewer than six frames: an unknown id falls back to the generic lesson.
 */
export function demoFor(kindId) {
  const key = typeof kindId === 'string' ? kindId.trim() : '';
  let builder = null;
  if (key && Object.prototype.hasOwnProperty.call(BUILDERS, key)) builder = BUILDERS[key];
  else if (key && Object.prototype.hasOwnProperty.call(LOWER, key.toLowerCase())) {
    builder = LOWER[key.toLowerCase()];
  }

  if (builder) {
    try {
      const demo = builder();
      if (demo && Array.isArray(demo.frames) && demo.frames.length >= 6) {
        return { frames: demo.frames, loop: true };
      }
    } catch (err) {
      if (typeof console !== 'undefined' && console && typeof console.error === 'function') {
        console.error(`[demos] ${key} failed to build`, err);
      }
    }
  }

  try {
    const fallback = genericDemo();
    return { frames: fallback.frames, loop: true };
  } catch (err) {
    /* absolute last resort: an empty but valid, still wordless, single frame set */
    const blank = { svg: root(''), ms: 900 };
    return { frames: [blank, blank, blank, blank, blank, blank], loop: true };
  }
}
