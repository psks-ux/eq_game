/**
 * Constraint-grid item family (contentGroup 'constraint'): a Latin-square / Sudoku
 * puzzle drawn with shapes instead of numbers. One cell is marked blank; difficulty is
 * the number of constraint-propagation steps a real solver needs to force that cell.
 */

import { SHAPE_KEYS } from './shapes.js';
import { svgRoot, el, drawCell, optionSvg, defsPatterns, cellKey } from './svg.js';

export const family = 'constraintGrid';
export const bRange = [-0.8, 5.6];
export const contentGroup = 'constraint';

const GENERATOR_VERSION = 1;
const MAX_ATTEMPTS = 30;
const NODE_BUDGET = 250000;

/* --- geometry ------------------------------------------------------------- */
const CELLPX = 72;
const GAPPX = 6;
const BLOCKGAP = 16;
const PAD = 10;
const OPT_CELL = 84;

/* --- difficulty model mirror (must track calibration.js DIFFICULTY_MODEL) --- */
const B0 = -1.10;
const B_RULES = 0.92;
const B_ABSTRACT = 0.55;
const B_WM = 0.38;
const B_ELEMENTS = 0.30;
const B_SALIENCE = 1.20;
const B_FAMILY = 0.26; // calibration.js B_FAMILY.constraintGrid; kept in sync by hand

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

/* --- symbol alphabet: visually well-separated shapes, identical in every other
 * attribute so that shape alone carries identity (no colour dependence). --- */
const ALPHABET = (() => {
  const wanted = ['circle', 'square', 'triangleUp', 'diamond', 'hexagon', 'uShape',
    'trapezoid', 'tShape', 'triangleDown', 'lShape'];
  if (!Array.isArray(SHAPE_KEYS) || SHAPE_KEYS.length === 0) return wanted;
  const ok = wanted.filter((k) => SHAPE_KEYS.indexOf(k) !== -1);
  return ok.length >= 6 ? ok : wanted;
})();

const SYMBOL_SIZE = 2;
const SYMBOL_FILL = 'solid';
const SYMBOL_COLOR = 0;
const SYMBOL_LW = 1;

function symbolGlyph(shape) {
  return {
    shape,
    size: SYMBOL_SIZE,
    fill: SYMBOL_FILL,
    color: SYMBOL_COLOR,
    rotation: 0,
    lineWeight: SYMBOL_LW,
    dx: 0,
    dy: 0,
    count: 1
  };
}

/* --- bit helpers ---------------------------------------------------------- */
function popcount(m) {
  let c = 0;
  while (m) { m &= m - 1; c++; }
  return c;
}
function lowBitIndex(m) {
  let i = 0;
  while (m > 1) { m >>= 1; i++; }
  return i;
}

/* --- board geometry ------------------------------------------------------- */
function blockShape(N) {
  if (N === 4) return { bh: 2, bw: 2 };
  if (N === 6) return { bh: 2, bw: 3 };
  if (N === 8) return { bh: 2, bw: 4 };
  return null; // 5x5 and 7x7 are plain Latin squares
}

/**
 * Board orders usable for a given option count. The option set is the board's
 * symbol alphabet plus, when that alphabet is smaller than the option count the
 * contract requires, a few shapes that appear nowhere on the board. Those extras
 * are real distractors but weak ones -- a solver drops them just by scanning the
 * alphabet -- so at most three are ever used and they never count towards
 * distractorSystematicity.
 */
function ordersFor(optionCount) {
  const out = [];
  for (const N of [4, 5, 6, 7, 8]) {
    if (N > optionCount) continue;
    // At most two off-alphabet foils. They are the weakest wrong answers the
    // family can offer -- a solver drops them the moment the Latin-square rule
    // is understood -- so the board order is kept close to the option count.
    if (optionCount - N > 2) continue;
    if (optionCount > ALPHABET.length) continue;
    out.push(N);
  }
  return out.length ? out : [Math.min(optionCount, ALPHABET.length)];
}

function makeUnits(N) {
  const units = [];
  for (let r = 0; r < N; r++) {
    const cells = [];
    for (let c = 0; c < N; c++) cells.push(r * N + c);
    units.push({ type: 'row', cells });
  }
  for (let c = 0; c < N; c++) {
    const cells = [];
    for (let r = 0; r < N; r++) cells.push(r * N + c);
    units.push({ type: 'col', cells });
  }
  const bs = blockShape(N);
  if (bs) {
    for (let br = 0; br < N / bs.bh; br++) {
      for (let bc = 0; bc < N / bs.bw; bc++) {
        const cells = [];
        for (let r = 0; r < bs.bh; r++) {
          for (let c = 0; c < bs.bw; c++) cells.push((br * bs.bh + r) * N + bc * bs.bw + c);
        }
        units.push({ type: 'block', cells });
      }
    }
  }
  return units;
}

function makePeers(N, units) {
  const peers = [];
  for (let i = 0; i < N * N; i++) peers.push(new Set());
  for (const u of units) {
    for (const a of u.cells) for (const b of u.cells) if (a !== b) peers[a].add(b);
  }
  return peers.map((s) => Array.from(s));
}

/* --- a random completed board (permutations of a canonical pattern) -------- */
function randomSolution(rng, N) {
  const bs = blockShape(N) || { bh: 1, bw: N };
  const base = [];
  for (let r = 0; r < N; r++) {
    const row = [];
    for (let c = 0; c < N; c++) row.push((bs.bw * (r % bs.bh) + Math.floor(r / bs.bh) + c) % N);
    base.push(row);
  }
  const bandRows = [];
  for (let b = 0; b < N / bs.bh; b++) {
    const g = [];
    for (let i = 0; i < bs.bh; i++) g.push(b * bs.bh + i);
    bandRows.push(rng.shuffle(g));
  }
  const rowOrder = [].concat.apply([], rng.shuffle(bandRows));
  const stackCols = [];
  for (let b = 0; b < N / bs.bw; b++) {
    const g = [];
    for (let i = 0; i < bs.bw; i++) g.push(b * bs.bw + i);
    stackCols.push(rng.shuffle(g));
  }
  const colOrder = [].concat.apply([], rng.shuffle(stackCols));
  const symbolMap = rng.shuffle(range(N));
  const out = new Array(N * N);
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) out[r * N + c] = symbolMap[base[rowOrder[r]][colOrder[c]]];
  }
  return out;
}

function range(n) {
  const a = [];
  for (let i = 0; i < n; i++) a.push(i);
  return a;
}

/* ---------------------------------------------------------------------------
 * Step-counted propagation. One step is one wave: every cell that is currently
 * forced pushes its value out of its peers simultaneously, so a value that only
 * becomes deducible because of an earlier deduction costs an extra step. When a
 * wave changes nothing, one hidden-single (or, at level 2, one naked-pair or
 * intersection) inference is spent instead and also costs a step.
 * ------------------------------------------------------------------------ */
function hiddenSingle(cand, units, N) {
  for (const u of units) {
    for (let v = 0; v < N; v++) {
      const bit = 1 << v;
      let seen = -1;
      let n = 0;
      let solved = false;
      for (const i of u.cells) {
        if (!(cand[i] & bit)) continue;
        if (popcount(cand[i]) === 1) { solved = true; break; }
        seen = i;
        n++;
        if (n > 1) break;
      }
      if (!solved && n === 1 && popcount(cand[seen]) > 1) {
        cand[seen] = bit;
        return 'hiddenSingle';
      }
    }
  }
  return null;
}

function nakedPair(cand, units) {
  for (const u of units) {
    for (let a = 0; a < u.cells.length; a++) {
      const ia = u.cells[a];
      if (popcount(cand[ia]) !== 2) continue;
      for (let b = a + 1; b < u.cells.length; b++) {
        const ib = u.cells[b];
        if (cand[ib] !== cand[ia]) continue;
        let changed = false;
        for (const j of u.cells) {
          if (j === ia || j === ib) continue;
          if (cand[j] & cand[ia]) {
            cand[j] &= ~cand[ia];
            if (!cand[j]) return null;
            changed = true;
          }
        }
        if (changed) return 'nakedPair';
      }
    }
  }
  return null;
}

/** Pointing / claiming pairs, precomputed once per board (this is hot). */
function makeIntersectionPairs(units) {
  const blocks = units.filter((u) => u.type === 'block');
  const lines = units.filter((u) => u.type !== 'block');
  const pairs = [];
  for (const b of blocks) {
    const inB = new Set(b.cells);
    for (const l of lines) {
      const shared = l.cells.filter((c) => inB.has(c));
      if (shared.length >= 2) {
        const set = new Set(shared);
        pairs.push([b, l, set], [l, b, set]);
      }
    }
  }
  return pairs;
}

function intersection(cand, pairs, N) {
  for (const [from, to, shared] of pairs) {
    for (let v = 0; v < N; v++) {
      const bit = 1 << v;
      let confined = true;
      let present = false;
      let placed = false;
      for (const i of from.cells) {
        if (!(cand[i] & bit)) continue;
        if (popcount(cand[i]) === 1) { placed = true; break; }
        present = true;
        if (!shared.has(i)) { confined = false; break; }
      }
      if (placed || !present || !confined) continue;
      let changed = false;
      for (const j of to.cells) {
        if (shared.has(j)) continue;
        if (popcount(cand[j]) === 1) continue;
        if (cand[j] & bit) {
          cand[j] &= ~bit;
          if (!cand[j]) return null;
          changed = true;
        }
      }
      if (changed) return 'intersection';
    }
  }
  return null;
}

function makeBoard(N) {
  const units = makeUnits(N);
  const lines = units.filter((u) => u.type !== 'block');
  return {
    N, units, lines,
    peers: makePeers(N, units),
    linePeers: makePeers(N, lines),
    pairs: makeIntersectionPairs(units)
  };
}

function analyse(given, board, level, targetIdx) {
  const N = board.N;
  const units = level === 0 ? board.lines : board.units;
  const peers = level === 0 ? board.linePeers : board.peers;
  const full = (1 << N) - 1;
  const cand = given.map((v) => (v >= 0 ? 1 << v : full));
  const pushed = given.map(() => false);
  const elimStep = new Array(N).fill(Infinity);
  const techniques = [];
  let steps = 0;

  const recordElims = (s) => {
    for (let v = 0; v < N; v++) {
      if (!(cand[targetIdx] & (1 << v)) && elimStep[v] === Infinity) elimStep[v] = s;
    }
  };

  for (let guard = 0; guard < 300; guard++) {
    steps++;
    let changed = false;
    const wave = [];
    for (let i = 0; i < cand.length; i++) {
      if (!pushed[i] && popcount(cand[i]) === 1) { pushed[i] = true; wave.push(i); }
    }
    for (const i of wave) {
      const bit = cand[i];
      for (const j of peers[i]) {
        if (cand[j] & bit) {
          if (popcount(cand[j]) === 1) return { steps: Infinity };
          cand[j] &= ~bit;
          if (!cand[j]) return { steps: Infinity };
          changed = true;
        }
      }
    }
    recordElims(steps);
    if (popcount(cand[targetIdx]) === 1) {
      return { steps, techniques, value: lowBitIndex(cand[targetIdx]), elimStep };
    }
    if (!changed) {
      let did = level >= 2 ? hiddenSingle(cand, units, N) : null;
      if (!did && level >= 3) did = nakedPair(cand, units) || intersection(cand, board.pairs, N);
      if (!did) return { steps: Infinity, techniques, elimStep };
      techniques.push(did);
      recordElims(steps);
      if (popcount(cand[targetIdx]) === 1) {
        return { steps, techniques, value: lowBitIndex(cand[targetIdx]), elimStep };
      }
    }
  }
  return { steps: Infinity };
}

/* --- exhaustive completion search (the uniqueness proof) ------------------- */
function propagateAll(cand, peers) {
  const done = new Uint8Array(cand.length);
  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 0; i < cand.length; i++) {
      if (done[i] || popcount(cand[i]) !== 1) continue;
      done[i] = 1;
      const bit = cand[i];
      for (const j of peers[i]) {
        if (cand[j] & bit) {
          if (popcount(cand[j]) === 1) return false;
          cand[j] &= ~bit;
          if (!cand[j]) return false;
          changed = true;
        }
      }
    }
  }
  return true;
}

function search(cand, peers, budget) {
  if (budget.n-- <= 0) return null;
  if (!propagateAll(cand, peers)) return false;
  let best = -1;
  let bestC = Infinity;
  for (let i = 0; i < cand.length; i++) {
    const p = popcount(cand[i]);
    if (p > 1 && p < bestC) { bestC = p; best = i; if (p === 2) break; }
  }
  if (best < 0) return true;
  let m = cand[best];
  while (m) {
    const bit = m & -m;
    m ^= bit;
    const copy = cand.slice();
    copy[best] = bit;
    const r = search(copy, peers, budget);
    if (r === null) return null;
    if (r) return true;
  }
  return false;
}

/** Exactly one symbol can occupy the target across every completion. */
function proveUniqueTarget(given, N, peers, targetIdx, answer) {
  const full = (1 << N) - 1;
  const start = () => given.map((v) => (v >= 0 ? 1 << v : full));
  const budget = { n: NODE_BUDGET };
  const withAnswer = start();
  withAnswer[targetIdx] = 1 << answer;
  if (search(withAnswer, peers, budget) !== true) return false;
  for (let v = 0; v < N; v++) {
    if (v === answer) continue;
    const c = start();
    c[targetIdx] = 1 << v;
    const r = search(c, peers, budget);
    if (r === null || r === true) return false;
  }
  return true;
}

/* --- puzzle construction --------------------------------------------------- */
function carve(rng, board, targetIdx, solution, goal) {
  const N = board.N;
  const given = solution.slice();
  given[targetIdx] = -1;
  const peerSet = new Set(board.peers[targetIdx]);
  const order = rng.shuffle(range(N * N).filter((i) => i !== targetIdx));
  const peerFirst = goal.level >= 2 ? rng.bool(0.6) : goal.steps >= 4;
  order.sort((a, b) => {
    const pa = peerSet.has(a) ? 1 : 0;
    const pb = peerSet.has(b) ? 1 : 0;
    return peerFirst ? pb - pa : pa - pb;
  });

  let current = analyse(given, board, 3, targetIdx);
  if (!Number.isFinite(current.steps)) return null;
  // True while a weaker technique set than the one this config asks for still
  // cracks the target -- i.e. the puzzle is not yet hard enough in *kind*.
  const weakerWorks = () =>
    goal.level > 0 && Number.isFinite(analyse(given, board, goal.level - 1, targetIdx).steps);

  // Pass A -- carve until the chain is as deep as asked for and, when the config
  // demands it, until the weaker technique set genuinely fails.
  for (const p of order) {
    const needKind = weakerWorks();
    if (!needKind && current.steps >= goal.steps) break;
    if (given[p] < 0) continue;
    const old = given[p];
    given[p] = -1;
    const next = analyse(given, board, 3, targetIdx);
    const ok = Number.isFinite(next.steps) && (needKind || next.steps <= goal.steps);
    if (ok) current = next;
    else given[p] = old;
  }

  // Pass B -- strip every remaining given the deduction does not need, so the
  // board is not padded with symbols that carry no information.
  const locked = goal.level > 0 && !weakerWorks();
  const cap = Math.max(goal.steps, current.steps);
  for (const p of order) {
    if (given[p] < 0) continue;
    const old = given[p];
    given[p] = -1;
    const next = analyse(given, board, 3, targetIdx);
    let ok = Number.isFinite(next.steps) && next.steps <= cap;
    if (ok && locked) ok = !weakerWorks();
    if (ok) current = next;
    else given[p] = old;
  }
  if (!Number.isFinite(current.steps)) return null;
  if (current.value !== solution[targetIdx]) return null;
  return { given, analysis: current };
}

function metaFor(N, steps, minLevel, hasBlocks, systematicity, advancedKind, optionCount) {
  // minLevel 0 rows+cols, 1 blocks needed, 2 hidden singles needed,
  // 3 naked-pair / intersection needed.
  const types = ['distributionOfThree'];
  if (hasBlocks && minLevel >= 1) types.push('containment');
  if (minLevel >= 2) types.push('overlayExclusive');
  if (minLevel >= 3) types.push(advancedKind === 'nakedPair' ? 'overlayDifference' : 'overlayIntersection');
  if (steps >= 3) types.push('ruleChaining');
  return {
    ruleCount: types.length,
    ruleTypes: types,
    abstractness: Math.round(clamp(1.35 + 0.20 * (N - 4) + 0.40 * (minLevel >= 1 ? 1 : 0) +
      0.45 * (minLevel >= 2 ? 1 : 0) + 0.80 * (minLevel >= 3 ? 1 : 0) + 0.12 * steps, 1, 4) * 100) / 100,
    elementCount: N * N,
    distractorSystematicity: Math.round(systematicity * 1000) / 1000,
    wmLoad: clamp(Math.round(0.6 + 0.7 * steps), 1, 6),
    perceptualSalience: Math.round(clamp(0.82 - 0.115 * steps, 0.03, 0.85) * 1000) / 1000,
    optionCount,
    generatorVersion: GENERATOR_VERSION
  };
}

function buildConfigs(optionCount) {
  const out = [];
  for (const N of ordersFor(optionCount)) {
    const hasBlocks = blockShape(N) !== null;
    for (let steps = 1; steps <= 16; steps++) {
      for (let level = 0; level <= 3; level++) {
        if (level === 1 && !hasBlocks) continue;
        if (level >= 2 && steps < 2) continue;
        const sys = clamp((steps - 1) / Math.max(1, optionCount - 1) + 0.15 * (steps - 1), 0, 1);
        out.push({
          N, steps, level,
          estB: predictB(metaFor(N, steps, level, hasBlocks, sys, 'intersection', optionCount))
        });
      }
    }
  }
  return out;
}

/* --- rendering ------------------------------------------------------------- */
function axisOffsets(N, per, cell, gap, blockGap) {
  const offs = [];
  let x = PAD;
  for (let i = 0; i < N; i++) {
    offs.push(x);
    x += cell + ((i + 1) % per === 0 ? blockGap : gap);
  }
  return offs;
}

function gridPanel(N, given, targetIdx, symbols) {
  const bs = blockShape(N);
  // Bigger boards use smaller cells so the panel stays a sane on-screen size.
  const big = N >= 7;
  const cell = big ? 56 : CELLPX;
  const gap = big ? 5 : GAPPX;
  const bgap = big ? 13 : BLOCKGAP;
  const colOff = axisOffsets(N, bs ? bs.bw : N, cell, gap, bgap);
  const rowOff = axisOffsets(N, bs ? bs.bh : N, cell, gap, bgap);
  const width = colOff[N - 1] + cell + PAD;
  const height = rowOff[N - 1] + cell + PAD;
  let body = defsPatterns();

  if (bs) {
    for (let br = 0; br < N / bs.bh; br++) {
      for (let bc = 0; bc < N / bs.bw; bc++) {
        const x = colOff[bc * bs.bw] - 5;
        const y = rowOff[br * bs.bh] - 5;
        const w = colOff[bc * bs.bw + bs.bw - 1] + cell + 5 - x;
        const h = rowOff[br * bs.bh + bs.bh - 1] + cell + 5 - y;
        body += el('rect', {
          x, y, width: w, height: h, rx: 8, fill: 'none',
          stroke: 'currentColor', 'stroke-width': 2.5, opacity: 0.55, class: 'cg-block'
        });
      }
    }
  }

  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      const i = r * N + c;
      const x = colOff[c];
      const y = rowOff[r];
      const blank = i === targetIdx;
      body += el('rect', {
        x, y, width: cell, height: cell, rx: 6, fill: 'none',
        stroke: 'currentColor', 'stroke-width': blank ? 3 : 1,
        opacity: blank ? 1 : 0.3,
        'stroke-dasharray': blank ? '7 5' : '0',
        class: blank ? 'cg-blank' : 'cg-cell'
      });
      if (!blank && given[i] >= 0) {
        body += drawCell([symbolGlyph(symbols[given[i]])], x + cell / 2, y + cell / 2, cell);
      }
    }
  }
  return {
    svg: svgRoot({ width, height, viewBox: `0 0 ${width} ${height}`, className: 'constraint-grid', body }),
    width,
    height
  };
}

function svgDims(svg, fw, fh) {
  let w = fw;
  let h = fh;
  const vb = /viewBox="\s*[-\d.]+\s+[-\d.]+\s+([\d.]+)\s+([\d.]+)/.exec(svg || '');
  if (vb) { w = parseFloat(vb[1]); h = parseFloat(vb[2]); }
  const mw = /\bwidth="([\d.]+)"/.exec(svg || '');
  const mh = /\bheight="([\d.]+)"/.exec(svg || '');
  if (mw) w = parseFloat(mw[1]);
  if (mh) h = parseFloat(mh[1]);
  return { width: w, height: h };
}

export function generate(rng, opts) {
  const options = opts || {};
  const targetB = Number.isFinite(options.targetB) ? options.targetB : 0;
  const wanted = clamp(targetB, bRange[0], bRange[1]);
  const seed = rng.int(0, 2147483647);
  const optionCount = options.optionCount === 6 ? 6 : 8;

  const configs = buildConfigs(optionCount)
    .filter((c) => c.estB <= bRange[1] + 0.12 && c.estB >= bRange[0] - 0.12)
    .sort((a, b) => Math.abs(a.estB - wanted) - Math.abs(b.estB - wanted));
  if (!configs.length) throw new Error('constraintGrid: no configuration available');
  // A config that demands a particular *kind* of inference is not always realisable
  // on a small board, so the shortlist keeps the nearest candidate from every
  // technique level rather than burning each attempt on a shape that may not exist.
  const shortlist = configs.slice(0, 4);
  for (let level = 0; level <= 3; level++) {
    const c = configs.find((x) => x.level === level);
    if (c && shortlist.indexOf(c) === -1) shortlist.push(c);
  }

  const boards = {};
  let best = null;
  let bestScore = Infinity;
  let bestErr = Infinity;
  let kept = 0;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const cfg = shortlist[attempt % shortlist.length];
    const N = cfg.N;
    const board = boards[N] || (boards[N] = makeBoard(N));
    const peers = board.peers;
    const solution = randomSolution(rng, N);
    const targetIdx = rng.int(0, N * N);
    const carved = carve(rng, board, targetIdx, solution, cfg);
    if (!carved) continue;

    const answer = solution[targetIdx];
    if (!proveUniqueTarget(carved.given, N, peers, targetIdx, answer)) continue;

    const hasBlocks = blockShape(N) !== null;
    const full = analyse(carved.given, board, 3, targetIdx);
    if (!Number.isFinite(full.steps) || full.value !== answer) continue;
    let minLevel = 3;
    for (let L = 0; L <= 2; L++) {
      if (Number.isFinite(analyse(carved.given, board, L, targetIdx).steps)) { minLevel = L; break; }
    }
    const advancedKind = full.techniques.indexOf('intersection') !== -1 ? 'intersection' : 'nakedPair';

    // A constraint grid never *builds* its distractors the way a matrix does --
    // the wrong options are the rest of the alphabet. "Systematic" therefore means
    // "eliminable only by applying the puzzle's rules", graded by what that costs:
    //   1.00  in-alphabet, survives >= 2 propagation rounds (real deduction)
    //   0.80  in-alphabet, falls to the first peer scan (the rules, shallowly)
    //   0.50  off-alphabet foil (only the Latin-square rule itself)
    // No option is a random perturbation, which is what the metric excludes.
    let weighted = 0;
    let late = 0;
    for (let v = 0; v < N; v++) {
      if (v === answer) continue;
      const deep = !Number.isFinite(full.elimStep[v]) || full.elimStep[v] >= 2;
      if (deep) late++;
      weighted += deep ? 1 : 0.8;
    }
    weighted += 0.5 * (optionCount - N);
    const systematicity = Math.min(1, weighted / (optionCount - 1));
    // Kept separate from systematicity: this is item *quality*, and it steers
    // candidate selection below toward grids whose foils need genuine depth.
    const lateFraction = late / Math.max(1, N - 1);

    const meta = metaFor(N, full.steps, minLevel, hasBlocks, systematicity, advancedKind, optionCount);
    const err = Math.abs(predictB(meta) - wanted);
    const score = err - 0.6 * lateFraction;
    if (score < bestScore) {
      bestScore = score;
      bestErr = err;
      best = { N, given: carved.given, targetIdx, answer, meta, steps: full.steps };
    }
    kept++;
    if (bestErr <= 0.35) break;
    if (kept >= 14) break;
  }
  if (!best) throw new Error('constraintGrid: could not construct a uniquely-forced target');

  const drawn = rng.sample(ALPHABET, Math.min(ALPHABET.length, optionCount));
  const symbols = drawn.slice(0, best.N);
  const foils = drawn.slice(best.N, optionCount);
  const panel = gridPanel(best.N, best.given, best.targetIdx, symbols);

  const faces = rng.shuffle(symbols.concat(foils));
  const seenKeys = new Set();
  const optionEls = faces.map((shape, i) => {
    const g = symbolGlyph(shape);
    const key = cellKey([g]);
    if (seenKeys.has(key)) throw new Error('constraintGrid: duplicate option symbol');
    seenKeys.add(key);
    const svg = optionSvg([g], { cell: OPT_CELL });
    const d = svgDims(svg, OPT_CELL, OPT_CELL);
    return { id: `o${i}`, svg, width: d.width, height: d.height };
  });
  const answerId = `o${faces.indexOf(symbols[best.answer])}`;

  return {
    id: `${family}:${seed}:${best.N * 100 + best.steps}`,
    family,
    seed,
    prompt: { svg: panel.svg, width: panel.width, height: panel.height },
    options: optionEls,
    answerId,
    meta: best.meta,
    irt: null
  };
}
