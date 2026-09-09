/**
 * setShifting — cognitive-flexibility drill. A probe card must be sorted onto one of four
 * key cards; the sorting dimension (shape / colour / fill / count) changes silently after
 * a run of correct responses, so the shift can only be detected from feedback.
 * Perseverative errors — sorting by the dimension that has just stopped working — are
 * counted and reported by summary().
 */

/*
 * Feedback contract: grade() never bakes a colour. `detail.feedback` is 'good' | 'bad'
 * and `detail.feedbackClass` is 'fb-good' | 'fb-bad' — the class the UI puts on the
 * stimulus SVG root, so the stylesheet can resolve it to var(--good) / var(--bad) and
 * both themes work. Correctness is also carried by shape/position, never by colour alone.
 */

/*
 * kind 'choice'. The four key cards are the options and never change during a run, so
 * the response mapping stays stable; only the probe card changes. Every key differs from
 * every other key on ALL four dimensions, and the probe is built so that each dimension
 * points at a DIFFERENT key — therefore exactly one key is correct under each candidate
 * rule and the currently active rule is fully identified by the feedback.
 *
 * grade(trial, response) accepts an option id string ('k0'..'k3'), an option object
 * ({id}) or an index into trial.options; null/undefined grades as incorrect (a miss) and
 * breaks the correct-run streak without triggering a shift.
 * summary(records) expects { trial, correct, rtMs, level }-shaped records.
 */

import { SHAPE_KEYS, FILLS, COLORS, SIZES, LINE_WEIGHTS } from '../../items/shapes.js';
import { svgRoot, drawCell, el } from '../../items/svg.js';

export const id = 'setShifting';
export const factor = 'flexibility';
export const staircasePreset = 'speed';

const MAX_LEVEL = 8;
const DEFAULT_TRIALS = 40;
const KEYS = 4;
const CELL = 96;
const PAD = 12;
const DIMS = ['shape', 'color', 'fill', 'count'];

function asArray(v, fallback) {
  return Array.isArray(v) && v.length ? v : fallback;
}

const ALL_SHAPES = asArray(SHAPE_KEYS, ['circle', 'square', 'triangleUp', 'hexagon']);
const PREFERRED_SHAPES = ['circle', 'square', 'triangleUp', 'hexagon', 'diamond', 'pentagon',
  'trapezoid', 'octagon'].filter((k) => ALL_SHAPES.indexOf(k) !== -1);
const SHAPE_POOL = PREFERRED_SHAPES.length >= KEYS ? PREFERRED_SHAPES : ALL_SHAPES;
const ALL_FILLS = asArray(FILLS, ['empty', 'solid', 'hStripe', 'vStripe', 'dStripe', 'dots', 'half']);
const PREFERRED_FILLS = ['solid', 'empty', 'hStripe', 'dots', 'vStripe', 'dStripe', 'half']
  .filter((k) => ALL_FILLS.indexOf(k) !== -1);
const FILL_POOL = PREFERRED_FILLS.length >= KEYS ? PREFERRED_FILLS : ALL_FILLS;
const N_COLOR = asArray(COLORS, [0, 1, 2, 3, 4, 5, 6]).length;
const N_SIZE = asArray(SIZES, [0, 1, 2, 3]).length;
const N_WEIGHT = asArray(LINE_WEIGHTS, [0, 1, 2]).length;
const CARD_SIZE = clampIndex(1, N_SIZE);
const CARD_WEIGHT = clampIndex(1, N_WEIGHT);

function clampIndex(i, n) {
  return i < 0 ? 0 : (i > n - 1 ? n - 1 : i);
}

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

function cardSvg(glyph, extraClass) {
  const size = CELL + PAD * 2;
  let body = '';
  body += el('rect', {
    x: 2, y: 2, width: size - 4, height: size - 4, rx: 14,
    fill: 'none', stroke: 'var(--line)', 'stroke-width': 2
  });
  body += drawCell([glyph], size / 2, size / 2, CELL);
  return {
    svg: svgRoot({
      width: size,
      height: size,
      viewBox: `0 0 ${size} ${size}`,
      className: `stim stim-sort${extraClass ? ` ${extraClass}` : ''}`,
      body
    }),
    width: size,
    height: size
  };
}

function makeGlyph(shape, color, fill, count) {
  return {
    shape,
    size: CARD_SIZE,
    fill,
    color,
    rotation: 0,
    lineWeight: CARD_WEIGHT,
    dx: 0,
    dy: 0,
    count
  };
}

function levelSpec(level) {
  return {
    candidateRules: clamp(2 + Math.floor((level - 1) / 2), 2, DIMS.length),
    runLength: clamp(8 - level, 3, 8),
    timeLimitMs: clamp(6500 - level * 450, 2500, 6500)
  };
}

export function makeRun(rng, params) {
  if (!rng || typeof rng.fork !== 'function') {
    throw new Error('setShifting.makeRun: an rng with fork() is required');
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

  // The four key cards are built once and never change: every dimension takes four
  // distinct values across them, so any dimension can serve as the sorting rule.
  const setupRng = rng.fork(`${id}:keys`);
  const keyShapes = setupRng.sample(SHAPE_POOL, Math.min(KEYS, SHAPE_POOL.length));
  const keyFills = setupRng.sample(FILL_POOL, Math.min(KEYS, FILL_POOL.length));
  const colorIdx = [];
  for (let i = 0; i < N_COLOR; i += 1) colorIdx.push(i);
  const keyColors = setupRng.sample(colorIdx, Math.min(KEYS, colorIdx.length));
  const keyCounts = setupRng.shuffle([1, 2, 3, 4]);
  if (keyShapes.length < KEYS || keyFills.length < KEYS || keyColors.length < KEYS) {
    throw new Error('setShifting: the shape lexicon is too small to build four key cards');
  }

  const keyGlyphs = [];
  for (let k = 0; k < KEYS; k += 1) {
    keyGlyphs.push(makeGlyph(keyShapes[k], keyColors[k], keyFills[k], keyCounts[k]));
  }
  const keyOptions = keyGlyphs.map((g, k) => {
    const tile = cardSvg(g, 'is-key');
    return { id: `k${k}`, svg: tile.svg, width: tile.width, height: tile.height };
  });

  // A fixed per-run ordering of the candidate rules; higher levels simply enable more of
  // it, so raising the level can only add hypotheses, never swap them out.
  const ruleOrder = setupRng.shuffle(DIMS.slice());

  let issued = 0;
  let lastLevel = intParam(p.startLevel, 1, 1, maxLevel);
  let currentRule = ruleOrder[0];
  let previousRule = null;
  let streak = 0;
  let shifts = 0;
  let shiftedOnLastTrial = false;
  const issuedTrials = new Map();
  const gradedTrials = new Map();
  const gradeLog = [];

  function eligibleRules(level) {
    return ruleOrder.slice(0, levelSpec(level).candidateRules);
  }

  function shiftRule(level) {
    const pool = eligibleRules(level).filter((d) => d !== currentRule);
    if (pool.length === 0) return false;
    const r = rng.fork(`${id}:shift:${shifts}`);
    previousRule = currentRule;
    currentRule = r.pick(pool);
    shifts += 1;
    return true;
  }

  function build(level, index) {
    const r = rng.fork(`${id}:${index}:${level}`);
    // A bijection dimension -> key index: each dimension of the probe matches exactly one
    // key, and no two dimensions match the same key.
    const order = r.shuffle([0, 1, 2, 3]);
    const assign = {};
    DIMS.forEach((dim, i) => { assign[dim] = order[i]; });
    const probe = makeGlyph(
      keyGlyphs[assign.shape].shape,
      keyGlyphs[assign.color].color,
      keyGlyphs[assign.fill].fill,
      keyGlyphs[assign.count].count
    );
    return { assign, probe };
  }

  return {
    kind: 'choice',
    totalTrials,

    nextTrial(level) {
      if (issued >= totalTrials) return null;
      const lv = intParam(level, lastLevel, 1, maxLevel);
      lastLevel = lv;
      const spec = levelSpec(lv);
      if (eligibleRules(lv).indexOf(currentRule) === -1) {
        // The staircase dropped below the level that enabled the active rule. That is
        // still a silent shift from the learner's side, so it is booked as one.
        previousRule = currentRule;
        currentRule = eligibleRules(lv)[0];
        shifts += 1;
        shiftedOnLastTrial = true;
        streak = 0;
      }
      const index = issued;
      issued += 1;
      const built = build(lv, index);
      const tile = cardSvg(built.probe, 'is-probe');
      const trialId = `${id}:${index}`;
      const answerId = `k${built.assign[currentRule]}`;
      issuedTrials.set(trialId, {
        assign: built.assign,
        rule: currentRule,
        previousRule,
        justShifted: shiftedOnLastTrial,
        runLength: spec.runLength,
        candidateRules: spec.candidateRules
      });
      shiftedOnLastTrial = false;
      return {
        id: trialId,
        level: lv,
        stimulus: { svg: tile.svg, width: tile.width, height: tile.height },
        options: keyOptions.map((o) => ({ ...o })),
        answerId,
        answer: answerId,
        timeLimitMs: explicitLimit !== null ? explicitLimit : spec.timeLimitMs,
        isiMs: 0
      };
    },

    grade(trial, response) {
      const trialId = trial && typeof trial.id === 'string' ? trial.id : null;
      if (trialId && gradedTrials.has(trialId)) return gradedTrials.get(trialId);

      const rec = trialId ? issuedTrials.get(trialId) : null;
      const answerId = trial && typeof trial.answerId === 'string' ? trial.answerId : null;
      const chosen = chosenOptionId(trial, response);
      const correct = chosen !== null && answerId !== null && chosen === answerId;

      let perseverative = false;
      let matchedDimension = null;
      if (rec && chosen !== null && !correct) {
        for (const dim of DIMS) {
          if (`k${rec.assign[dim]}` === chosen) { matchedDimension = dim; break; }
        }
        perseverative = rec.previousRule !== null
          && rec.previousRule !== rec.rule
          && matchedDimension === rec.previousRule;
      }

      // Advance the run state: a run of correct responses silently retires the rule.
      let shiftedNow = false;
      if (rec) {
        if (correct) {
          streak += 1;
          if (streak >= rec.runLength) {
            shiftedNow = shiftRule(lastLevel);
            streak = 0;
            shiftedOnLastTrial = shiftedNow;
          }
        } else {
          streak = 0;
        }
      }

      const out = {
        correct,
        detail: {
          chosen,
          answerId,
          timedOut: chosen === null,
          rule: rec ? rec.rule : null,
          previousRule: rec ? rec.previousRule : null,
          matchedDimension,
          perseverative,
          justShifted: rec ? rec.justShifted : false,
          shiftedAfterThisTrial: shiftedNow,
          streak,
          candidateRules: rec ? rec.candidateRules : null,
          feedback: correct ? 'good' : 'bad',
          feedbackClass: correct ? 'fb-good' : 'fb-bad'
        }
      };
      if (trialId) gradedTrials.set(trialId, out);
      gradeLog.push({ correct, perseverative, justShifted: rec ? rec.justShifted : false });
      return out;
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

      let errors = 0;
      let perseverativeErrors = 0;
      for (const g of gradeLog) {
        if (!g.correct) {
          errors += 1;
          if (g.perseverative) perseverativeErrors += 1;
        }
      }
      const perseverativeRate = errors ? perseverativeErrors / errors : 0;
      // Perseveration is the signature failure of this drill, so it is penalised on top
      // of raw accuracy.
      const factorDelta = n === 0
        ? 0
        : clamp(
          round3((accuracy - 0.72) * 1.4 + (level - 3) * 0.05 - perseverativeRate * 0.15),
          -1, 1
        );
      return {
        accuracy: round3(accuracy),
        meanMs: Math.round(meanMs),
        level,
        factorDelta,
        shifts,
        errors,
        perseverativeErrors,
        perseverativeRate: round3(perseverativeRate),
        candidateRules: levelSpec(level).candidateRules
      };
    }
  };
}
