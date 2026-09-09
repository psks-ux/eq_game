/**
 * speedDiscrimination — processing-speed drill. Two abstract figures are shown side by
 * side and judged identical or not under a tight deadline. Level shortens the deadline
 * and raises figure complexity while making the single difference more subtle.
 */

/*
 * Feedback contract: grade() never bakes a colour. `detail.feedback` is 'good' | 'bad'
 * and `detail.feedbackClass` is 'fb-good' | 'fb-bad' — the class the UI puts on the
 * stimulus SVG root, so the stylesheet can resolve it to var(--good) / var(--bad) and
 * both themes work. Correctness is also carried by shape/position, never by colour alone.
 */

/*
 * kind 'choice'. Two response tiles carry the judgement wordlessly: the "identical" tile
 * shows two matching neutral marks, the "not identical" tile shows two different ones.
 * Their order is fixed for the whole run so the motor mapping never moves. Stimulus
 * figures are drawn only from rotation-revealing shapes, so a difference of orientation
 * is always visible.
 *
 * grade(trial, response) accepts an option id string ('same' | 'diff'), an option object
 * ({id}) or an index into trial.options; null/undefined grades as incorrect (a miss).
 * summary(records) expects { trial, correct, rtMs, level }-shaped records and reports the
 * achieved deadline alongside the achieved level.
 */

import { SHAPE_KEYS, FILLS, COLORS, SIZES, LINE_WEIGHTS } from '../../items/shapes.js';
import { svgRoot, drawCell, el, cellKey } from '../../items/svg.js';

export const id = 'speedDiscrimination';
export const factor = 'speed';
export const staircasePreset = 'speed';

const MAX_LEVEL = 8;
const DEFAULT_TRIALS = 40;
const CELL = 108;
const GAP = 34;
const PAD = 14;
const OPT_CELL = 96;
const OPT_PAD = 10;
const BUILD_ATTEMPTS = 24;

function asArray(v, fallback) {
  return Array.isArray(v) && v.length ? v : fallback;
}

const ALL_SHAPES = asArray(SHAPE_KEYS, ['triangleUp', 'trapezoid', 'lShape', 'zShape']);
const ALL_FILLS = asArray(FILLS, ['empty', 'solid', 'hStripe', 'vStripe', 'dStripe', 'dots', 'half']);
const N_COLOR = asArray(COLORS, [0, 1, 2, 3, 4, 5, 6]).length;
const N_SIZE = asArray(SIZES, [0, 1, 2, 3]).length;
const N_WEIGHT = asArray(LINE_WEIGHTS, [0, 1, 2]).length;

// Only shapes without rotational symmetry, so a rotated copy always looks different.
const ASYMMETRIC = ['triangleUp', 'triangleDown', 'triangleRight', 'triangleLeft',
  'rightTriangle', 'trapezoid', 'parallelogram', 'lShape', 'tShape', 'zShape', 'uShape',
  'semicircle', 'quarterDisc', 'notchedSquare', 'notchedCircle', 'pentagon'];
const FIG_SHAPES = (() => {
  const f = ASYMMETRIC.filter((k) => ALL_SHAPES.indexOf(k) !== -1);
  return f.length >= 3 ? f : ALL_SHAPES.slice(0, Math.max(3, ALL_SHAPES.length));
})();

const MARK_A = ['circle', 'ring', 'dot'].find((k) => ALL_SHAPES.indexOf(k) !== -1)
  || ALL_SHAPES[0];
const MARK_B = ['square', 'roundedSquare', 'diamond'].find(
  (k) => ALL_SHAPES.indexOf(k) !== -1 && k !== MARK_A
) || ALL_SHAPES.find((k) => k !== MARK_A) || MARK_A;

const LAYOUTS = {
  1: [[0, 0]],
  2: [[-0.42, 0], [0.42, 0]],
  3: [[0, -0.44], [-0.42, 0.3], [0.42, 0.3]],
  4: [[-0.4, -0.4], [0.4, -0.4], [-0.4, 0.4], [0.4, 0.4]]
};
const LAYOUT_SIZE = { 1: 2, 2: 1, 3: 1, 4: 0 };

function clamp(x, lo, hi) {
  return x < lo ? lo : (x > hi ? hi : x);
}

function clampIndex(i, n) {
  return i < 0 ? 0 : (i > n - 1 ? n - 1 : i);
}

function cyc(i, n) {
  return ((i % n) + n) % n;
}

function normRot(r) {
  return ((Math.round(r / 45) * 45) % 360 + 360) % 360;
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

function chosenOptionId(trial, response) {
  if (response === null || response === undefined) return null;
  if (typeof response === 'string') return response;
  if (typeof response === 'number' && Number.isFinite(response)) {
    const opts = trial && Array.isArray(trial.options) ? trial.options : null;
    if (opts && response >= 0 && response < opts.length) return opts[response].id;
    return null;
  }
  if (typeof response === 'object') {
    for (const k of ['id', 'optionId', 'responseId', 'value']) {
      if (typeof response[k] === 'string') return response[k];
    }
  }
  return null;
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

/* --- stimulus construction --------------------------------------------------------- */

const DIFF_TIERS = [
  ['shape'],
  ['shape', 'fill'],
  ['fill', 'color'],
  ['color', 'size'],
  ['size', 'rotation90'],
  ['rotation90', 'weight'],
  ['rotation45', 'weight'],
  ['rotation45', 'weight']
];

function levelSpec(level) {
  const parts = clamp(1 + Math.floor(level / 2), 1, 4);
  return {
    parts,
    diffKinds: DIFF_TIERS[clampIndex(level - 1, DIFF_TIERS.length)],
    timeLimitMs: clamp(2400 - level * 190, 650, 2400)
  };
}

function makeFigure(r, parts) {
  const layout = LAYOUTS[parts];
  const sizeIdx = clampIndex(LAYOUT_SIZE[parts], N_SIZE);
  return layout.map((pos) => ({
    shape: r.pick(FIG_SHAPES),
    size: sizeIdx,
    fill: r.pick(ALL_FILLS),
    color: r.int(0, N_COLOR),
    rotation: 45 * r.int(0, 8),
    lineWeight: clampIndex(r.int(0, N_WEIGHT), N_WEIGHT),
    dx: pos[0],
    dy: pos[1],
    count: 1
  }));
}

function mutate(glyph, kind, r) {
  const g = { ...glyph };
  if (kind === 'shape') {
    const pool = FIG_SHAPES.filter((s) => s !== g.shape);
    g.shape = pool.length ? r.pick(pool) : g.shape;
  } else if (kind === 'fill') {
    const pool = ALL_FILLS.filter((f) => f !== g.fill);
    g.fill = pool.length ? r.pick(pool) : g.fill;
  } else if (kind === 'color') {
    g.color = cyc(g.color + 1 + r.int(0, Math.max(1, N_COLOR - 1)), N_COLOR);
    if (g.color === glyph.color) g.color = cyc(glyph.color + 1, N_COLOR);
  } else if (kind === 'size') {
    g.size = clampIndex(g.size + (g.size >= N_SIZE - 1 ? -1 : 1), N_SIZE);
  } else if (kind === 'rotation90') {
    g.rotation = normRot(g.rotation + 90);
  } else if (kind === 'rotation45') {
    g.rotation = normRot(g.rotation + 45);
  } else if (kind === 'weight') {
    g.lineWeight = clampIndex(g.lineWeight + (g.lineWeight >= N_WEIGHT - 1 ? -1 : 1), N_WEIGHT);
  }
  return g;
}

function pairSvg(left, right) {
  const width = PAD * 2 + CELL * 2 + GAP;
  const height = PAD * 2 + CELL;
  let body = '';
  for (let i = 0; i < 2; i += 1) {
    body += el('rect', {
      x: PAD + i * (CELL + GAP),
      y: PAD,
      width: CELL,
      height: CELL,
      rx: 12,
      fill: 'none',
      stroke: 'var(--line)',
      'stroke-width': 2
    });
  }
  body += drawCell(left, PAD + CELL / 2, PAD + CELL / 2, CELL);
  body += drawCell(right, PAD + CELL + GAP + CELL / 2, PAD + CELL / 2, CELL);
  return {
    svg: svgRoot({
      width,
      height,
      viewBox: `0 0 ${width} ${height}`,
      className: 'stim stim-speed',
      body
    }),
    width,
    height
  };
}

function markGlyph(shape, dx) {
  return {
    shape,
    size: clampIndex(1, N_SIZE),
    fill: ALL_FILLS.indexOf('solid') !== -1 ? 'solid' : ALL_FILLS[0],
    color: -1,
    rotation: 0,
    lineWeight: clampIndex(1, N_WEIGHT),
    dx,
    dy: 0,
    count: 1
  };
}

function responseTile(kind) {
  const size = OPT_CELL + OPT_PAD * 2;
  const glyphs = kind === 'same'
    ? [markGlyph(MARK_A, -0.42), markGlyph(MARK_A, 0.42)]
    : [markGlyph(MARK_A, -0.42), markGlyph(MARK_B, 0.42)];
  return {
    svg: svgRoot({
      width: size,
      height: size,
      viewBox: `0 0 ${size} ${size}`,
      className: `stim stim-option is-${kind}`,
      body: drawCell(glyphs, size / 2, size / 2, OPT_CELL)
    }),
    width: size,
    height: size
  };
}

export function makeRun(rng, params) {
  if (!rng || typeof rng.fork !== 'function') {
    throw new Error('speedDiscrimination.makeRun: an rng with fork() is required');
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
  const explicitLimit = num(p.timeLimitMs);

  const setupRng = rng.fork(`${id}:setup`);
  const sameTile = responseTile('same');
  const diffTile = responseTile('diff');
  const baseOptions = setupRng.bool()
    ? [
      { id: 'same', ...sameTile },
      { id: 'diff', ...diffTile }
    ]
    : [
      { id: 'diff', ...diffTile },
      { id: 'same', ...sameTile }
    ];

  // Exactly balanced same/different plan, shuffled once.
  const plan = (() => {
    const half = Math.floor(totalTrials / 2);
    const list = [];
    for (let i = 0; i < half; i += 1) list.push('same');
    for (let i = 0; i < totalTrials - half; i += 1) list.push('diff');
    return setupRng.shuffle(list).slice(0, totalTrials);
  })();

  let issued = 0;
  let lastLevel = intParam(p.startLevel, 1, 1, maxLevel);
  const issuedTrials = new Map();

  function build(level, index) {
    const spec = levelSpec(level);
    const kind = plan[index];
    for (let a = 0; a < BUILD_ATTEMPTS; a += 1) {
      const r = rng.fork(`${id}:${index}:${level}:${a}`);
      const left = makeFigure(r, spec.parts);
      if (kind === 'same') {
        const right = left.map((g) => ({ ...g }));
        return { spec, kind, left, right, diffKind: null, diffIndex: -1 };
      }
      const diffKind = r.pick(spec.diffKinds);
      const idx = r.int(0, left.length);
      const right = left.map((g, i) => (i === idx ? mutate(g, diffKind, r) : { ...g }));
      if (cellKey(right) !== cellKey(left)) {
        return { spec, kind, left, right, diffKind, diffIndex: idx };
      }
    }
    // Fall back to the always-visible difference so a trial is never impossible.
    const r = rng.fork(`${id}:${index}:${level}:fallback`);
    const left = makeFigure(r, spec.parts);
    const right = left.map((g, i) => (i === 0 ? mutate(g, 'shape', r) : { ...g }));
    return { spec, kind: 'diff', left, right, diffKind: 'shape', diffIndex: 0 };
  }

  return {
    kind: 'choice',
    totalTrials,

    nextTrial(level) {
      if (issued >= totalTrials) return null;
      const lv = intParam(level, lastLevel, 1, maxLevel);
      lastLevel = lv;
      const index = issued;
      issued += 1;
      const built = build(lv, index);
      const pair = pairSvg(built.left, built.right);
      const trialId = `${id}:${index}`;
      const answerId = built.kind === 'same' ? 'same' : 'diff';
      const timeLimitMs = explicitLimit !== null ? explicitLimit : built.spec.timeLimitMs;
      issuedTrials.set(trialId, {
        kind: built.kind,
        diffKind: built.diffKind,
        parts: built.spec.parts,
        timeLimitMs
      });
      return {
        id: trialId,
        level: lv,
        stimulus: { svg: pair.svg, width: pair.width, height: pair.height },
        options: baseOptions.map((o) => ({
          id: o.id, svg: o.svg, width: o.width, height: o.height
        })),
        answerId,
        answer: answerId,
        timeLimitMs,
        isiMs: 0
      };
    },

    grade(trial, response) {
      const answerId = trial && typeof trial.answerId === 'string' ? trial.answerId : null;
      const chosen = chosenOptionId(trial, response);
      const correct = chosen !== null && answerId !== null && chosen === answerId;
      const rec = trial && issuedTrials.get(trial.id);
      return {
        correct,
        detail: {
          chosen,
          answerId,
          timedOut: chosen === null,
          kind: rec ? rec.kind : null,
          diffKind: rec ? rec.diffKind : null,
          parts: rec ? rec.parts : null,
          deadlineMs: rec ? rec.timeLimitMs : null,
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
      let correctMsSum = 0;
      let correctMsN = 0;
      let deadlineSum = 0;
      let deadlineN = 0;
      const byKind = { same: { n: 0, correct: 0 }, diff: { n: 0, correct: 0 } };
      for (const r of rows) {
        if (r.correct) hits += 1;
        if (r.ms !== null && r.ms >= 0) {
          msSum += r.ms;
          msN += 1;
          if (r.correct) { correctMsSum += r.ms; correctMsN += 1; }
        }
        const rec = r.id ? issuedTrials.get(r.id) : null;
        if (rec) {
          deadlineSum += rec.timeLimitMs;
          deadlineN += 1;
          if (byKind[rec.kind]) {
            byKind[rec.kind].n += 1;
            if (r.correct) byKind[rec.kind].correct += 1;
          }
        }
      }
      const accuracy = n ? hits / n : 0;
      const meanMs = msN ? msSum / msN : 0;
      const levels = rows.filter((r) => r.level !== null).slice(-8);
      let level = lastLevel;
      if (levels.length) {
        level = Math.round(levels.reduce((a, r) => a + r.level, 0) / levels.length);
      }
      if (!Number.isFinite(level)) level = 1;
      // The achieved level is the level whose deadline the learner actually sustained.
      const achievedDeadline = deadlineN
        ? Math.round(deadlineSum / deadlineN)
        : levelSpec(level).timeLimitMs;
      const factorDelta = n === 0
        ? 0
        : clamp(round3((accuracy - 0.80) * 1.3 + (level - 3) * 0.05), -1, 1);
      return {
        accuracy: round3(accuracy),
        meanMs: Math.round(meanMs),
        level,
        factorDelta,
        meanMsCorrect: Math.round(correctMsN ? correctMsSum / correctMsN : 0),
        deadlineMs: achievedDeadline,
        byKind: {
          same: {
            n: byKind.same.n,
            accuracy: round3(byKind.same.n ? byKind.same.correct / byKind.same.n : 0)
          },
          different: {
            n: byKind.diff.n,
            accuracy: round3(byKind.diff.n ? byKind.diff.correct / byKind.diff.n : 0)
          }
        }
      };
    }
  };
}
