/**
 * nback — working-memory updating drill. A stream of glyphs appears in cells of a 3x3
 * field; the learner reports whether the current item repeats the one n steps back.
 * The staircase level sets n (2..5) and, from level 4, makes the task dual (shape and
 * position judged independently).
 */

/*
 * Feedback contract: grade() never bakes a colour. `detail.feedback` is 'good' | 'bad'
 * and `detail.feedbackClass` is 'fb-good' | 'fb-bad' — the class the UI puts on the
 * stimulus SVG root, so the stylesheet can resolve it to var(--good) / var(--bad) and
 * both themes work. Correctness is also carried by shape/position, never by colour alone.
 */

/*
 * RESPONSE PROTOCOL (kind 'stream')
 * ---------------------------------
 * Each Trial is ONE stream position. `stimulus.frames` holds a single frame:
 *   frames[0] = { svg, ms }   the glyph shown in its cell for `ms` milliseconds
 * `isiMs` is the blank gap the UI must show after the frame before the next trial.
 * `options` is always null.
 *
 * The UI calls respond(responseId) with:
 *   'match'           -> "this repeats n back"          (single mode)
 *   'nomatch'         -> "this does not repeat"          (single mode; also the value
 *                        implied by making no response at all)
 *   'match:shape'     -> "the SHAPE repeats n back"      (dual mode)
 *   'match:position'  -> "the CELL repeats n back"       (dual mode)
 * In dual mode the two channels are independent: the UI may send neither, either, or
 * both before the response window closes. grade(trial, response) accepts a single id,
 * an array of ids, a Set of ids, or an object { shape: boolean, position: boolean }.
 * A bare 'match' in dual mode is read as 'match:shape'.
 * Not responding at all == 'nomatch' on every channel; that is the correct answer on
 * non-target trials, exactly as in a standard go/no-go n-back.
 *
 * summary(records) expects { trial, correct, rtMs, level }-shaped records and also
 * reports hitRate / falseAlarmRate / sensitivity from this run's own grade() log.
 */

import { SHAPE_KEYS, FILLS, COLORS, SIZES, LINE_WEIGHTS } from '../../items/shapes.js';
import { svgRoot, drawCell, el } from '../../items/svg.js';

export const id = 'nback';
export const factor = 'workingMemory';
export const staircasePreset = 'nback';

const MAX_LEVEL = 8;
const DEFAULT_TRIALS = 40;
const GRID = 3;
const CELL = 78;
const GAP = 10;
const PAD = 12;
const BOARD = PAD * 2 + GRID * CELL + (GRID - 1) * GAP;
const TARGET_RATE = 0.25;
const LURE_RATE = 0.22;

function asArray(v, fallback) {
  return Array.isArray(v) && v.length ? v : fallback;
}

const ALL_SHAPES = asArray(SHAPE_KEYS, ['circle', 'square', 'triangleUp', 'hexagon']);
const PREFERRED = ['circle', 'square', 'triangleUp', 'hexagon', 'diamond', 'trapezoid', 'uShape', 'zShape'];
const STREAM_SHAPES = (() => {
  const f = PREFERRED.filter((k) => ALL_SHAPES.indexOf(k) !== -1);
  return f.length >= 4 ? f : ALL_SHAPES.slice(0, Math.max(4, Math.min(8, ALL_SHAPES.length)));
})();
const FILL_POOL = asArray(FILLS, ['solid']);
const STREAM_FILL = FILL_POOL.indexOf('solid') !== -1 ? 'solid' : FILL_POOL[0];
const N_SIZE = asArray(SIZES, [0, 1, 2, 3]).length;
const N_WEIGHT = asArray(LINE_WEIGHTS, [0, 1, 2]).length;
const N_COLOR = asArray(COLORS, [0]).length;

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

function boardBody(activeIndex, shape) {
  let body = '';
  for (let i = 0; i < GRID * GRID; i += 1) {
    const row = Math.floor(i / GRID);
    const col = i % GRID;
    body += el('rect', {
      x: PAD + col * (CELL + GAP),
      y: PAD + row * (CELL + GAP),
      width: CELL,
      height: CELL,
      rx: 10,
      fill: 'none',
      stroke: 'var(--line)',
      'stroke-width': 2
    });
  }
  if (activeIndex !== null && shape !== null) {
    const c = cellCentre(activeIndex);
    body += drawCell([{
      shape,
      size: clamp(2, 0, N_SIZE - 1),
      fill: STREAM_FILL,
      color: -1,
      rotation: 0,
      lineWeight: clamp(1, 0, N_WEIGHT - 1),
      dx: 0,
      dy: 0,
      count: 1
    }], c.cx, c.cy, CELL);
  }
  return body;
}

function boardSvg(activeIndex, shape) {
  return svgRoot({
    width: BOARD,
    height: BOARD,
    viewBox: `0 0 ${BOARD} ${BOARD}`,
    className: 'stim stim-nback',
    body: boardBody(activeIndex, shape)
  });
}

function normaliseResponse(response) {
  const out = new Set();
  const add = (v) => {
    if (typeof v === 'string' && v.length) out.add(v);
  };
  if (response === null || response === undefined) return out;
  if (typeof response === 'string') { add(response); return out; }
  if (Array.isArray(response)) { response.forEach(add); return out; }
  if (typeof Set !== 'undefined' && response instanceof Set) {
    response.forEach(add);
    return out;
  }
  if (typeof response === 'object') {
    if (response.shape === true) add('match:shape');
    if (response.position === true) add('match:position');
    for (const k of ['id', 'responseId', 'optionId', 'value']) add(response[k]);
    if (Array.isArray(response.responses)) response.responses.forEach(add);
  }
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

/**
 * `allowDual` mirrors curriculum.js's `streamModality`: 1 keeps the stream single-channel
 * however high the staircase climbs, 2 (or an absent value) lets the level rule decide.
 * Without this the drill would go dual a whole tier before the ladder intends it to.
 */
function levelSpec(level, allowDual) {
  const n = clamp(2 + Math.floor((level - 1) / 2), 2, 5);
  const dual = level >= 4 && allowDual !== false;
  return {
    n,
    dual,
    presentMs: clamp(1000 - level * 45, 620, 1000),
    isiMs: clamp(1500 - level * 90, 700, 1500)
  };
}

export function makeRun(rng, params) {
  if (!rng || typeof rng.fork !== 'function') {
    throw new Error('nback.makeRun: an rng with fork() is required');
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
  // Only an explicit single-channel request suppresses the dual stream; anything else
  // (absent, junk, 2 or more) leaves the decision to the level rule.
  const allowDual = num(p.streamModality) === null ? true : num(p.streamModality) >= 2;

  let issued = 0;
  let lastLevel = intParam(p.startLevel, 1, 1, maxLevel);
  const history = [];               // { shape, pos } in presentation order
  const issuedTrials = new Map();   // trialId -> { expected, n, dual, isTarget, isLure }
  const graded = new Map();         // trialId -> grade detail (for summary())
  const counts = { shapeEligible: 0, shapeTargets: 0, posEligible: 0, posTargets: 0 };

  function wantTarget(r, eligible, targets) {
    const rate = eligible > 0 ? targets / eligible : TARGET_RATE;
    const p2 = clamp(TARGET_RATE + 0.6 * (TARGET_RATE - rate), 0.08, 0.45);
    return r.bool(p2);
  }

  function pickChannel(r, values, backValue, lureValues, wantT, wantL) {
    if (wantT && backValue !== null && backValue !== undefined) {
      return { value: backValue, target: true, lure: false };
    }
    if (wantL) {
      const usable = lureValues.filter((v) => v !== null && v !== undefined && v !== backValue);
      if (usable.length) {
        return { value: r.pick(usable), target: false, lure: true };
      }
    }
    const banned = new Set([backValue].concat(lureValues));
    let pool = values.filter((v) => !banned.has(v));
    if (pool.length === 0) pool = values.filter((v) => v !== backValue);
    if (pool.length === 0) pool = values.slice();
    return { value: r.pick(pool), target: false, lure: false };
  }

  function build(level, index) {
    const spec = levelSpec(level, allowDual);
    const r = rng.fork(`${id}:${index}:${level}`);
    const n = spec.n;
    const len = history.length;
    const backIdx = len - n;
    const back = backIdx >= 0 ? history[backIdx] : null;
    const lureIdx = [len - (n - 1), len - (n + 1)].filter((i) => i >= 0 && i < len);
    const lures = lureIdx.map((i) => history[i]);

    const positions = [];
    for (let i = 0; i < GRID * GRID; i += 1) positions.push(i);

    const eligible = back !== null;
    const shapeWantT = eligible && wantTarget(r, counts.shapeEligible, counts.shapeTargets);
    const shapeWantL = eligible && !shapeWantT && r.bool(LURE_RATE);
    const shapeSel = eligible
      ? pickChannel(r, STREAM_SHAPES, back.shape, lures.map((l) => l.shape), shapeWantT, shapeWantL)
      : { value: r.pick(STREAM_SHAPES), target: false, lure: false };

    let posSel;
    if (spec.dual && eligible) {
      const posWantT = wantTarget(r, counts.posEligible, counts.posTargets);
      const posWantL = !posWantT && r.bool(LURE_RATE);
      posSel = pickChannel(r, positions, back.pos, lures.map((l) => l.pos), posWantT, posWantL);
    } else if (eligible) {
      // Single mode: position is an irrelevant, freely varying dimension. It is kept off
      // the n-back cell so that it cannot be mistaken for the judged channel.
      const pool = positions.filter((v) => v !== back.pos);
      posSel = { value: r.pick(pool.length ? pool : positions), target: false, lure: false };
    } else {
      posSel = { value: r.pick(positions), target: false, lure: false };
    }

    if (eligible) {
      counts.shapeEligible += 1;
      if (shapeSel.target) counts.shapeTargets += 1;
      if (spec.dual) {
        counts.posEligible += 1;
        if (posSel.target) counts.posTargets += 1;
      }
    }

    history.push({ shape: shapeSel.value, pos: posSel.value });

    return {
      spec,
      shape: shapeSel.value,
      pos: posSel.value,
      expected: { shape: !!shapeSel.target, position: spec.dual ? !!posSel.target : false },
      isLure: !!(shapeSel.lure || (spec.dual && posSel.lure)),
      warmup: !eligible
    };
  }

  return {
    kind: 'stream',
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
      return {
        id: trialId,
        level: lv,
        stimulus: {
          frames: [{ svg: boardSvg(built.pos, built.shape), ms: built.spec.presentMs }]
        },
        options: null,
        answerId: null,
        answer: built.spec.dual
          ? { shape: built.expected.shape, position: built.expected.position }
          : (built.expected.shape ? 'match' : 'nomatch'),
        timeLimitMs: built.spec.presentMs + built.spec.isiMs,
        isiMs: built.spec.isiMs
      };
    },

    grade(trial, response) {
      const rec = trial && issuedTrials.get(trial.id);
      const dual = rec ? rec.spec.dual : (trial && trial.answer && typeof trial.answer === 'object');
      const expected = rec
        ? rec.expected
        : {
          shape: trial && trial.answer && typeof trial.answer === 'object'
            ? !!trial.answer.shape
            : trial && trial.answer === 'match',
          position: !!(trial && trial.answer && typeof trial.answer === 'object' && trial.answer.position)
        };
      const set = normaliseResponse(response);
      const gaveShape = set.has('match:shape') || set.has('match');
      const gavePosition = set.has('match:position');

      const shapeCorrect = gaveShape === expected.shape;
      const positionCorrect = dual ? (gavePosition === expected.position) : true;
      const correct = shapeCorrect && positionCorrect;
      const channels = {
        shape: { expected: expected.shape, given: gaveShape, correct: shapeCorrect }
      };
      if (dual) {
        channels.position = {
          expected: expected.position, given: gavePosition, correct: positionCorrect
        };
      }
      const channelCount = dual ? 2 : 1;
      const channelsCorrect = (shapeCorrect ? 1 : 0) + (dual && positionCorrect ? 1 : 0);
      const detail = {
        dual,
        n: rec ? rec.spec.n : null,
        channels,
        channelsCorrect,
        channelScore: round3(channelsCorrect / channelCount),
        isTarget: expected.shape || expected.position,
        isLure: rec ? rec.isLure : false,
        warmup: rec ? rec.warmup : false,
        responded: set.size > 0 && !(set.size === 1 && set.has('nomatch')),
        feedback: correct ? 'good' : 'bad',
        feedbackClass: correct ? 'fb-good' : 'fb-bad'
      };
      if (trial && typeof trial.id === 'string') graded.set(trial.id, detail);
      return { correct, detail };
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

      let targets = 0;
      let hitCount = 0;
      let nonTargets = 0;
      let falseAlarms = 0;
      let lures = 0;
      let lureErrors = 0;
      for (const detail of graded.values()) {
        const gaveAny = detail.channels.shape.given
          || (detail.channels.position ? detail.channels.position.given : false);
        if (detail.isTarget) {
          targets += 1;
          if (detail.channelsCorrect === (detail.dual ? 2 : 1)) hitCount += 1;
        } else {
          nonTargets += 1;
          if (gaveAny) falseAlarms += 1;
        }
        if (detail.isLure) {
          lures += 1;
          if (!detail.isTarget && gaveAny) lureErrors += 1;
        }
      }
      const hitRate = targets ? hitCount / targets : 0;
      const falseAlarmRate = nonTargets ? falseAlarms / nonTargets : 0;
      const factorDelta = n === 0
        ? 0
        : clamp(round3((accuracy - 0.75) * 1.4 + (level - 3) * 0.06), -1, 1);
      return {
        accuracy: round3(accuracy),
        meanMs: Math.round(meanMs),
        level,
        factorDelta,
        hitRate: round3(hitRate),
        falseAlarmRate: round3(falseAlarmRate),
        sensitivity: round3(hitRate - falseAlarmRate),
        lureErrorRate: round3(lures ? lureErrors / lures : 0),
        n: levelSpec(level, allowDual).n,
        dual: levelSpec(level, allowDual).dual
      };
    }
  };
}
