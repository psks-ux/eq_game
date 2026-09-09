/**
 * flankerControl — interference-control drill. A central target glyph sits in a row of
 * flanking distractors that are either identical to it (congruent), identical to a
 * different response (incongruent) or outside the response set (neutral). The learner
 * reports the CENTRE glyph. Level raises flanker similarity, adds a competing dimension
 * and shortens the deadline; summary() reports the congruency effect.
 */

/*
 * Feedback contract: grade() never bakes a colour. `detail.feedback` is 'good' | 'bad'
 * and `detail.feedbackClass` is 'fb-good' | 'fb-bad' — the class the UI puts on the
 * stimulus SVG root, so the stylesheet can resolve it to var(--good) / var(--bad) and
 * both themes work. Correctness is also carried by shape/position, never by colour alone.
 */

/*
 * kind 'choice'. The options are the possible centre glyphs drawn in isolation; their
 * ids are stable for a given level so the motor mapping does not move underneath the
 * learner. Below level 4 the response set varies on shape alone; from level 4 a second
 * dimension (fill) competes, so the answer is a conjunction and a flanker can capture
 * one half of it.
 *
 * grade(trial, response) accepts an option id string, an option object ({id}) or an index
 * into trial.options; null/undefined grades as incorrect (deadline miss).
 * summary(records) expects { trial, correct, rtMs, level }-shaped records; the congruency
 * effect is computed by joining those records to this run's own trial log by trial id.
 */

import { SHAPE_KEYS, FILLS, SIZES, LINE_WEIGHTS } from '../../items/shapes.js';
import { svgRoot, drawCell } from '../../items/svg.js';

export const id = 'flankerControl';
export const factor = 'flexibility';
export const staircasePreset = 'speed';

const MAX_LEVEL = 8;
const DEFAULT_TRIALS = 48;
const CELL = 64;
const GAP = 10;
const PAD = 14;
const OPT_PAD = 12;

function asArray(v, fallback) {
  return Array.isArray(v) && v.length ? v : fallback;
}

const ALL_SHAPES = asArray(SHAPE_KEYS, ['circle', 'square', 'triangleUp', 'hexagon']);
const ALL_FILLS = asArray(FILLS, ['solid', 'empty', 'hStripe', 'dots']);
const N_SIZE = asArray(SIZES, [0, 1, 2, 3]).length;
const N_WEIGHT = asArray(LINE_WEIGHTS, [0, 1, 2]).length;

// Ordered from easily separable to hard to separate at a glance.
const RAW_PAIRS = [
  ['circle', 'square'],
  ['triangleUp', 'square'],
  ['square', 'diamond'],
  ['hexagon', 'circle'],
  ['hexagon', 'octagon'],
  ['pentagon', 'hexagon'],
  ['octagon', 'circle'],
  ['octagon', 'circle']
];
const SIM_PAIRS = (() => {
  const ok = RAW_PAIRS.filter(
    (p) => ALL_SHAPES.indexOf(p[0]) !== -1 && ALL_SHAPES.indexOf(p[1]) !== -1 && p[0] !== p[1]
  );
  if (ok.length) return ok;
  return [[ALL_SHAPES[0], ALL_SHAPES[1 % ALL_SHAPES.length]]];
})();

const FILL_A = ['solid', 'empty'].find((f) => ALL_FILLS.indexOf(f) !== -1) || ALL_FILLS[0];
const FILL_B = ALL_FILLS.find((f) => f !== FILL_A) || FILL_A;
const NEUTRAL_FILL = ALL_FILLS.find((f) => f !== FILL_A && f !== FILL_B) || FILL_A;

function clamp(x, lo, hi) {
  return x < lo ? lo : (x > hi ? hi : x);
}

function clampIndex(i, n) {
  return i < 0 ? 0 : (i > n - 1 ? n - 1 : i);
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

function glyph(shape, fill) {
  return {
    shape,
    size: clampIndex(2, N_SIZE),
    fill,
    color: -1,
    rotation: 0,
    lineWeight: clampIndex(1, N_WEIGHT),
    dx: 0,
    dy: 0,
    count: 1
  };
}

function rowSvg(glyphs) {
  const n = glyphs.length;
  const width = PAD * 2 + n * CELL + (n - 1) * GAP;
  const height = PAD * 2 + CELL;
  let body = '';
  for (let i = 0; i < n; i += 1) {
    const cx = PAD + i * (CELL + GAP) + CELL / 2;
    body += drawCell([glyphs[i]], cx, PAD + CELL / 2, CELL);
  }
  return {
    svg: svgRoot({
      width,
      height,
      viewBox: `0 0 ${width} ${height}`,
      className: 'stim stim-flanker',
      body
    }),
    width,
    height
  };
}

function optionTile(g) {
  const size = CELL + OPT_PAD * 2;
  return {
    svg: svgRoot({
      width: size,
      height: size,
      viewBox: `0 0 ${size} ${size}`,
      className: 'stim stim-option',
      body: drawCell([g], size / 2, size / 2, CELL)
    }),
    width: size,
    height: size
  };
}

function levelSpec(level) {
  const pair = SIM_PAIRS[clampIndex(level - 1, SIM_PAIRS.length)];
  return {
    pair,
    flankPerSide: level <= 2 ? 1 : (level <= 5 ? 2 : 3),
    twoDimensions: level >= 4,
    timeLimitMs: clamp(2600 - level * 170, 900, 2600)
  };
}

function optionSetFor(level) {
  const spec = levelSpec(level);
  const glyphs = [];
  if (spec.twoDimensions) {
    glyphs.push({ id: 'a0', g: glyph(spec.pair[0], FILL_A) });
    glyphs.push({ id: 'a1', g: glyph(spec.pair[0], FILL_B) });
    glyphs.push({ id: 'a2', g: glyph(spec.pair[1], FILL_A) });
    glyphs.push({ id: 'a3', g: glyph(spec.pair[1], FILL_B) });
  } else {
    glyphs.push({ id: 'a0', g: glyph(spec.pair[0], FILL_A) });
    glyphs.push({ id: 'a2', g: glyph(spec.pair[1], FILL_A) });
  }
  const neutralShape = ALL_SHAPES.find(
    (s) => s !== spec.pair[0] && s !== spec.pair[1]
  ) || spec.pair[0];
  return {
    spec,
    entries: glyphs.map((e) => {
      const tile = optionTile(e.g);
      return {
        id: e.id, glyph: e.g, svg: tile.svg, width: tile.width, height: tile.height
      };
    }),
    neutral: glyph(neutralShape, spec.twoDimensions ? NEUTRAL_FILL : FILL_A)
  };
}

export function makeRun(rng, params) {
  if (!rng || typeof rng.fork !== 'function') {
    throw new Error('flankerControl.makeRun: an rng with fork() is required');
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

  // Fixed congruency plan: 50% congruent, 40% incongruent, 10% neutral, shuffled once so
  // the proportions hold exactly however the staircase moves.
  const planRng = rng.fork(`${id}:plan`);
  const plan = (() => {
    const nInc = Math.round(totalTrials * 0.4);
    const nNeu = Math.max(totalTrials >= 10 ? 1 : 0, Math.round(totalTrials * 0.1));
    const nCon = Math.max(0, totalTrials - nInc - nNeu);
    const list = [];
    for (let i = 0; i < nCon; i += 1) list.push('congruent');
    for (let i = 0; i < nInc; i += 1) list.push('incongruent');
    for (let i = 0; i < nNeu; i += 1) list.push('neutral');
    while (list.length < totalTrials) list.push('congruent');
    return planRng.shuffle(list).slice(0, totalTrials);
  })();

  const optionCache = new Map();
  function optionsFor(level) {
    if (!optionCache.has(level)) optionCache.set(level, optionSetFor(level));
    return optionCache.get(level);
  }

  let issued = 0;
  let lastLevel = intParam(p.startLevel, 1, 1, maxLevel);
  const issuedTrials = new Map();

  return {
    kind: 'choice',
    totalTrials,

    nextTrial(level) {
      if (issued >= totalTrials) return null;
      const lv = intParam(level, lastLevel, 1, maxLevel);
      lastLevel = lv;
      const index = issued;
      issued += 1;
      const set = optionsFor(lv);
      const spec = set.spec;
      const r = rng.fork(`${id}:${index}:${lv}`);
      const condition = plan[index];

      const targetEntry = r.pick(set.entries);
      let flankerGlyph;
      if (condition === 'congruent') {
        flankerGlyph = targetEntry.glyph;
      } else if (condition === 'neutral') {
        flankerGlyph = set.neutral;
      } else {
        const others = set.entries.filter((e) => e.id !== targetEntry.id);
        flankerGlyph = (others.length ? r.pick(others) : targetEntry).glyph;
      }

      const rowGlyphs = [];
      for (let i = 0; i < spec.flankPerSide; i += 1) rowGlyphs.push({ ...flankerGlyph });
      rowGlyphs.push({ ...targetEntry.glyph });
      for (let i = 0; i < spec.flankPerSide; i += 1) rowGlyphs.push({ ...flankerGlyph });
      const row = rowSvg(rowGlyphs);

      const trialId = `${id}:${index}`;
      issuedTrials.set(trialId, {
        condition,
        answerId: targetEntry.id,
        flankPerSide: spec.flankPerSide,
        twoDimensions: spec.twoDimensions,
        pair: spec.pair.slice()
      });
      return {
        id: trialId,
        level: lv,
        stimulus: { svg: row.svg, width: row.width, height: row.height },
        options: set.entries.map((e) => ({
          id: e.id, svg: e.svg, width: e.width, height: e.height
        })),
        answerId: targetEntry.id,
        answer: targetEntry.id,
        timeLimitMs: explicitLimit !== null ? explicitLimit : spec.timeLimitMs,
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
          condition: rec ? rec.condition : null,
          flankPerSide: rec ? rec.flankPerSide : null,
          twoDimensions: rec ? rec.twoDimensions : null,
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
      const byCond = {
        congruent: { n: 0, correct: 0, msSum: 0, msN: 0 },
        incongruent: { n: 0, correct: 0, msSum: 0, msN: 0 },
        neutral: { n: 0, correct: 0, msSum: 0, msN: 0 }
      };
      for (const r of rows) {
        if (r.correct) hits += 1;
        if (r.ms !== null && r.ms >= 0) { msSum += r.ms; msN += 1; }
        const rec = r.id ? issuedTrials.get(r.id) : null;
        const bucket = rec ? byCond[rec.condition] : null;
        if (bucket) {
          bucket.n += 1;
          if (r.correct) bucket.correct += 1;
          // Only correct responses contribute to the RT contrast, as is standard.
          if (r.correct && r.ms !== null && r.ms >= 0) { bucket.msSum += r.ms; bucket.msN += 1; }
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

      const conMs = byCond.congruent.msN ? byCond.congruent.msSum / byCond.congruent.msN : 0;
      const incMs = byCond.incongruent.msN ? byCond.incongruent.msSum / byCond.incongruent.msN : 0;
      const bothTimed = byCond.congruent.msN > 0 && byCond.incongruent.msN > 0;
      const congruencyMs = bothTimed ? incMs - conMs : 0;
      const conAcc = byCond.congruent.n ? byCond.congruent.correct / byCond.congruent.n : 0;
      const incAcc = byCond.incongruent.n ? byCond.incongruent.correct / byCond.incongruent.n : 0;
      const congruencyAccuracy = (byCond.congruent.n && byCond.incongruent.n)
        ? conAcc - incAcc
        : 0;

      // A small congruency cost is itself evidence of control, so it nudges the factor.
      const interferencePenalty = bothTimed
        ? clamp(congruencyMs / 4000, 0, 0.2)
        : 0;
      const factorDelta = n === 0
        ? 0
        : clamp(
          round3((accuracy - 0.78) * 1.4 + (level - 3) * 0.05 - interferencePenalty),
          -1, 1
        );

      return {
        accuracy: round3(accuracy),
        meanMs: Math.round(meanMs),
        level,
        factorDelta,
        congruencyMs: Math.round(congruencyMs),
        congruencyAccuracy: round3(congruencyAccuracy),
        byCondition: {
          congruent: {
            n: byCond.congruent.n,
            accuracy: round3(conAcc),
            meanMs: Math.round(conMs)
          },
          incongruent: {
            n: byCond.incongruent.n,
            accuracy: round3(incAcc),
            meanMs: Math.round(incMs)
          },
          neutral: {
            n: byCond.neutral.n,
            accuracy: round3(byCond.neutral.n ? byCond.neutral.correct / byCond.neutral.n : 0),
            meanMs: Math.round(byCond.neutral.msN ? byCond.neutral.msSum / byCond.neutral.msN : 0)
          }
        }
      };
    }
  };
}
