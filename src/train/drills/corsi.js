/**
 * corsi — visuo-spatial span drill. A sequence of cells in a 4x4 field lights up one at
 * a time; the learner reproduces the order by tapping cells. Level is the span length
 * (3..9); above level 6 the sequence must be reproduced in reverse.
 */

/*
 * Feedback contract: grade() never bakes a colour. `detail.feedback` is 'good' | 'bad'
 * and `detail.feedbackClass` is 'fb-good' | 'fb-bad' — the class the UI puts on the
 * stimulus SVG root, so the stylesheet can resolve it to var(--good) / var(--bad) and
 * both themes work. Correctness is also carried by shape/position, never by colour alone.
 */

/*
 * RESPONSE PROTOCOL (kind 'span')
 * -------------------------------
 * `stimulus.frames` is the full presentation: an opening frame showing the empty field,
 * then, for each item, an "illuminated" frame followed by a blank frame, then a closing
 * frame that marks the start of the response window. `options` is always null and
 * `isiMs` is 0 (the gaps are explicit frames so the UI just plays the list in order).
 *
 * The response is an ARRAY OF CELL INDICES, 0..15, row-major in a 4x4 field, in the
 * order the learner tapped them: grade(trial, [5, 2, 11]). Objects are tolerated too
 * ([{index:5}, ...]) as are numeric strings. `trial.answer` holds the expected array,
 * already reversed when `trial.mode === 'reverse'`.
 *
 * Reverse trials are marked visually by a second, outer frame drawn around the whole
 * field (present on every frame of a reverse trial and absent on forward ones) and by
 * `trial.mode`; the UI is free to add its own wordless indicator.
 *
 * summary(records) expects { trial, correct, rtMs, level }-shaped records.
 */

import { SHAPE_KEYS, FILLS, SIZES, LINE_WEIGHTS } from '../../items/shapes.js';
import { svgRoot, drawCell, el } from '../../items/svg.js';

export const id = 'corsi';
export const factor = 'workingMemory';
export const staircasePreset = 'span';

const MAX_LEVEL = 9;
const DEFAULT_TRIALS = 14;
const GRID = 4;
const CELLS = GRID * GRID;
const CELL = 66;
const GAP = 12;
const PAD = 18;
const BOARD = PAD * 2 + GRID * CELL + (GRID - 1) * GAP;

function asArray(v, fallback) {
  return Array.isArray(v) && v.length ? v : fallback;
}

const ALL_SHAPES = asArray(SHAPE_KEYS, ['roundedSquare', 'square', 'circle']);
const LIT_SHAPE = ['roundedSquare', 'square', 'circle'].find((k) => ALL_SHAPES.indexOf(k) !== -1)
  || ALL_SHAPES[0];
const N_WEIGHT = asArray(LINE_WEIGHTS, [0, 1, 2]).length;
const N_SIZE = asArray(SIZES, [0, 1, 2, 3]).length;
const FILL_POOL = asArray(FILLS, ['solid']);
const LIT_FILL = FILL_POOL.indexOf('solid') !== -1 ? 'solid' : FILL_POOL[0];

function clamp(x, lo, hi) {
  return x < lo ? lo : (x > hi ? hi : x);
}

function num(v) {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function intParam(value, fallback, lo, hi) {
  const raw = typeof value === 'string' ? Number(value) : value;
  const n = num(raw);
  return clamp(Math.round(n === null ? fallback : n), lo, hi);
}

function round3(x) {
  return Math.round(x * 1000) / 1000;
}

function cellCentre(index) {
  const row = Math.floor(index / GRID);
  const col = index % GRID;
  return {
    cx: PAD + col * (CELL + GAP) + CELL / 2,
    cy: PAD + row * (CELL + GAP) + CELL / 2
  };
}

function boardSvg(activeIndex, reverse) {
  let body = '';
  if (reverse) {
    body += el('rect', {
      x: 4,
      y: 4,
      width: BOARD - 8,
      height: BOARD - 8,
      rx: 16,
      fill: 'none',
      stroke: 'var(--line-strong)',
      'stroke-width': 3
    });
  }
  for (let i = 0; i < CELLS; i += 1) {
    const row = Math.floor(i / GRID);
    const col = i % GRID;
    body += el('rect', {
      x: PAD + col * (CELL + GAP),
      y: PAD + row * (CELL + GAP),
      width: CELL,
      height: CELL,
      rx: 12,
      fill: 'none',
      stroke: 'var(--line)',
      'stroke-width': 2
    });
  }
  if (activeIndex !== null && activeIndex >= 0 && activeIndex < CELLS) {
    const c = cellCentre(activeIndex);
    body += drawCell([{
      shape: LIT_SHAPE,
      size: clamp(3, 0, N_SIZE - 1),
      fill: LIT_FILL,
      color: -1,
      rotation: 0,
      lineWeight: clamp(1, 0, N_WEIGHT - 1),
      dx: 0,
      dy: 0,
      count: 1
    }], c.cx, c.cy, CELL);
  }
  return svgRoot({
    width: BOARD,
    height: BOARD,
    viewBox: `0 0 ${BOARD} ${BOARD}`,
    className: `stim stim-corsi${reverse ? ' is-reverse' : ''}`,
    body
  });
}

function normaliseSpanResponse(response) {
  const out = [];
  const push = (v) => {
    if (typeof v === 'number' && Number.isFinite(v)) {
      out.push(Math.round(v));
      return;
    }
    if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) {
      out.push(Math.round(Number(v)));
      return;
    }
    if (v && typeof v === 'object') {
      for (const k of ['index', 'cell', 'id', 'value']) {
        const n = typeof v[k] === 'number' ? v[k] : (typeof v[k] === 'string' ? Number(v[k]) : NaN);
        if (Number.isFinite(n)) { out.push(Math.round(n)); return; }
      }
    }
  };
  if (response === null || response === undefined) return out;
  if (Array.isArray(response)) { response.forEach(push); return out; }
  if (typeof response === 'object' && Array.isArray(response.cells)) {
    response.cells.forEach(push);
    return out;
  }
  if (typeof response === 'object' && Array.isArray(response.response)) {
    response.response.forEach(push);
    return out;
  }
  push(response);
  return out;
}

function readRecords(records) {
  const rows = Array.isArray(records) ? records : [];
  const out = [];
  for (const r of rows) {
    if (!r || typeof r !== 'object') continue;
    let correct = false;
    if (r.correct === true) correct = true;
    else if (r.correct === false) correct = false;
    else if (r.detail && r.detail.correct === true) correct = true;
    const ms = num(r.rtMs) !== null ? num(r.rtMs)
      : num(r.ms) !== null ? num(r.ms)
        : num(r.timeMs) !== null ? num(r.timeMs) : num(r.durationMs);
    const lvl = num(r.level) !== null ? num(r.level) : num(r.trial && r.trial.level);
    const tid = (r.trial && typeof r.trial.id === 'string') ? r.trial.id
      : (typeof r.trialId === 'string' ? r.trialId : (typeof r.id === 'string' ? r.id : null));
    out.push({ correct, ms, level: lvl, id: tid });
  }
  return out;
}

function levelSpec(level) {
  const span = clamp(Math.round(level), 3, 9);
  return {
    span,
    reverse: level > 6,
    presentMs: clamp(720 - span * 30, 420, 720),
    gapMs: clamp(320 - span * 12, 180, 320)
  };
}

function isMonotone(seq) {
  if (seq.length < 3) return false;
  let up = true;
  let down = true;
  for (let i = 1; i < seq.length; i += 1) {
    if (seq[i] <= seq[i - 1]) up = false;
    if (seq[i] >= seq[i - 1]) down = false;
  }
  return up || down;
}

export function makeRun(rng, params) {
  if (!rng || typeof rng.fork !== 'function') {
    throw new Error('corsi.makeRun: an rng with fork() is required');
  }
  const p = (params && typeof params === 'object') ? params : {};
  // `levelMax` is the vocabulary curriculum.js/session.js use for the staircase
  // ceiling; `maxLevel` is accepted as a synonym.
  const maxLevel = intParam(
    p.maxLevel !== undefined ? p.maxLevel : p.levelMax, MAX_LEVEL, 1, 20
  );
  const totalTrials = intParam(
    p.trials !== undefined ? p.trials : p.totalTrials, DEFAULT_TRIALS, 1, 300
  );

  let issued = 0;
  let lastLevel = intParam(p.startLevel, 3, 1, maxLevel);
  const issuedTrials = new Map();

  function sequenceFor(r, span) {
    const all = [];
    for (let i = 0; i < CELLS; i += 1) all.push(i);
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const seq = [];
      let prev = -1;
      for (let i = 0; i < span; i += 1) {
        const pool = all.filter((c) => c !== prev && seq.indexOf(c) === -1);
        const usable = pool.length ? pool : all.filter((c) => c !== prev);
        const cell = r.pick(usable.length ? usable : all);
        seq.push(cell);
        prev = cell;
      }
      if (!isMonotone(seq)) return seq;
    }
    // Deterministic last resort: a shuffled prefix can never be rejected forever.
    return r.shuffle(all).slice(0, span);
  }

  function build(level, index) {
    const spec = levelSpec(level);
    const r = rng.fork(`${id}:${index}:${level}`);
    const seq = sequenceFor(r, spec.span);
    const expected = spec.reverse ? seq.slice().reverse() : seq.slice();
    const frames = [{ svg: boardSvg(null, spec.reverse), ms: spec.gapMs * 2 }];
    for (const cell of seq) {
      frames.push({ svg: boardSvg(cell, spec.reverse), ms: spec.presentMs });
      frames.push({ svg: boardSvg(null, spec.reverse), ms: spec.gapMs });
    }
    frames.push({ svg: boardSvg(null, spec.reverse), ms: spec.gapMs * 2 });
    return { spec, seq, expected, frames };
  }

  return {
    kind: 'span',
    totalTrials,

    nextTrial(level) {
      if (issued >= totalTrials) return null;
      const lv = intParam(level, lastLevel, 1, maxLevel);
      lastLevel = lv;
      const index = issued;
      issued += 1;
      const built = build(lv, index);
      const trialId = `${id}:${index}`;
      issuedTrials.set(trialId, built);
      const showMs = built.frames.reduce((a, f) => a + f.ms, 0);
      return {
        id: trialId,
        level: lv,
        mode: built.spec.reverse ? 'reverse' : 'forward',
        stimulus: { frames: built.frames },
        options: null,
        answerId: null,
        answer: built.expected.slice(),
        /* The board this sequence was shown on. Without it the response UI has
           to guess from the answer indices, and a sequence that happens to stay
           inside the first nine cells makes it guess 3x3 -- so the person is
           asked to reproduce a 4x4 pattern on a 9-cell board, where the indices
           mean entirely different cells. It happened on roughly one trial in
           six. A stimulus must state its own geometry; it is the only thing
           that knows it. */
        grid: { rows: GRID, cols: GRID },
        timeLimitMs: showMs + built.spec.span * 2500 + 4000,
        isiMs: 0
      };
    },

    grade(trial, response) {
      const rec = trial && issuedTrials.get(trial.id);
      const expected = rec
        ? rec.expected
        : (trial && Array.isArray(trial.answer) ? trial.answer.slice() : []);
      const given = normaliseSpanResponse(response);
      let positionsCorrect = 0;
      for (let i = 0; i < expected.length; i += 1) {
        if (given[i] === expected[i]) positionsCorrect += 1;
      }
      let prefix = 0;
      while (prefix < expected.length && given[prefix] === expected[prefix]) prefix += 1;
      const correct = expected.length > 0
        && given.length === expected.length
        && prefix === expected.length;
      return {
        correct,
        detail: {
          expected: expected.slice(),
          given: given.slice(),
          span: rec ? rec.spec.span : expected.length,
          reverse: rec ? rec.spec.reverse : (trial && trial.mode === 'reverse'),
          positionsCorrect,
          longestCorrectPrefix: prefix,
          partial: expected.length ? round3(positionsCorrect / expected.length) : 0,
          feedback: correct ? 'good' : 'bad',
          feedbackClass: correct ? 'fb-good' : 'fb-bad'
        }
      };
    },

    summary(records) {
      const rows = readRecords(records);
      const n = rows.length;
      let hits = 0;
      let msSum = 0;
      let msN = 0;
      for (const r of rows) {
        if (r.correct) hits += 1;
        if (r.ms !== null && r.ms >= 0) { msSum += r.ms; msN += 1; }
      }
      const accuracy = n ? hits / n : 0;
      const meanMs = msN ? msSum / msN : 0;
      const levels = rows.filter((r) => r.level !== null).slice(-8);
      let level = lastLevel;
      if (levels.length) {
        level = Math.round(levels.reduce((a, r) => a + r.level, 0) / levels.length);
      }
      if (!Number.isFinite(level)) level = 1;
      const factorDelta = n === 0
        ? 0
        : clamp(round3((accuracy - 0.70) * 1.2 + (level - 4) * 0.07), -1, 1);
      return {
        accuracy: round3(accuracy),
        meanMs: Math.round(meanMs),
        level,
        factorDelta,
        span: levelSpec(level).span,
        reverse: levelSpec(level).reverse
      };
    }
  };
}
