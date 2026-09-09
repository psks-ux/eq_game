/**
 * The drill session engine: wires a curriculum level to its drill run and a staircase,
 * serves trials, records responses and computes the Outcome (stars, XP, factor delta).
 * Pure logic - no DOM, no timers, no clock. The UI supplies rtMs and drives the clock.
 */

import { makeStaircase, weightedUpDown, PRESETS } from '../core/staircase.js';
import { drillById } from './drills/index.js';

const MIN_FACTOR_DELTA = -3;
const MAX_FACTOR_DELTA = 6;

/**
 * factorDelta weights. See `computeFactorDelta` for the formula and for why this is a
 * training-progress number and not an ability estimate.
 */
const DELTA_ACCURACY_WEIGHT = 12;
const DELTA_LEVEL_WEIGHT = 0.9;

function num(v, fallback) {
  const x = Number(v);
  return Number.isFinite(x) ? x : fallback;
}

function clamp(x, lo, hi) {
  return x < lo ? lo : x > hi ? hi : x;
}

function round2(x) {
  return Math.round(x * 100) / 100;
}

/** A per-session rng branch, so replaying one level never disturbs another. */
function forkRng(rng, tag) {
  if (rng && typeof rng.fork === 'function') return rng.fork(tag);
  return rng;
}

/**
 * Drills receive their own copy of `params`: the curriculum tables are frozen shared
 * data and a drill that writes to its params must not corrupt the ladder.
 */
function copyParams(params) {
  const src = params && typeof params === 'object' ? params : {};
  const out = {};
  for (const key of Object.keys(src)) {
    const v = src[key];
    out[key] = Array.isArray(v) ? v.slice() : v;
  }
  return out;
}

/** Never let a drill's own bookkeeping take down the session. */
function safeSummary(run, records) {
  if (!run || typeof run.summary !== 'function') return null;
  try {
    const s = run.summary(records);
    return s && typeof s === 'object' ? s : null;
  } catch (err) {
    return null;
  }
}

/**
 * Build the staircase for this level. The drill's `staircasePreset` fixes the response
 * rule (how many correct answers make it harder); the level's params fix where the
 * ladder starts and how far it reaches. When a drill names no known preset we fall back
 * to a Kaernbach-weighted 1-up/1-down rule aimed at the level's own pass accuracy.
 */
function buildStaircase(drill, level, profile) {
  const params = level.params || {};
  const goal = level.goal || {};
  const preset = (PRESETS && drill && PRESETS[drill.staircasePreset]) || null;

  const min = Math.max(1, Math.round(num(params.levelMin, preset ? num(preset.min, 1) : 1)));
  const baseStart = Math.round(num(params.startLevel, preset ? num(preset.start, min) : min));
  const maxRaw = Math.round(num(params.levelMax, preset ? num(preset.max, baseStart + 8) : baseStart + 8));
  const max = Math.max(min + 1, maxRaw);
  const step = Math.abs(num(params.levelStep, preset ? num(preset.step, 1) : 1)) || 1;

  // Returning learners resume at their best level on this drill rather than replaying
  // rungs they have already cleared.
  const stats = profile && profile.drillStats ? profile.drillStats[level.drill] : null;
  const best = stats ? Number(stats.bestLevel) : NaN;
  const start = clamp(Number.isFinite(best) ? Math.round(best) : baseStart, min, max);

  const config = { start, min, max, step };
  if (preset) {
    config.up = num(preset.up, 1);
    config.down = num(preset.down, 3);
    config.targetAccuracy = num(preset.targetAccuracy, Math.pow(0.5, 1 / config.down));
  } else {
    const target = clamp(num(goal.accuracy, 0.75), 0.5, 0.95);
    const w = weightedUpDown(target);
    config.up = 1;
    config.down = 1;
    config.targetAccuracy = target;
    config.step = { up: step * w.up, down: step * w.down };
  }

  return { staircase: makeStaircase(config), start, baseStart, min, max };
}

/**
 * Resolve the runs this session serves trials from.
 * Normal levels run one drill. A capstone samples several: one run per drill named in
 * `params.mixDrills`, each with that drill's own parameters, served round-robin.
 * An injected `drillModule` always wins and always produces a single run - that is the
 * seam unit tests use to avoid loading the whole drill registry.
 */
function buildRuns(level, rng, injected) {
  const params = level.params || {};
  const runs = [];

  const make = (mod, drillParams, tag) => {
    const run = mod.makeRun(forkRng(rng, `${level.id}:${tag}`), copyParams(drillParams));
    if (!run || typeof run.nextTrial !== 'function' || typeof run.grade !== 'function') {
      throw new Error(`Drill ${tag} returned an invalid Run for level ${level.id}`);
    }
    return { id: typeof mod.id === 'string' ? mod.id : tag, mod, run, served: 0 };
  };

  if (injected) {
    runs.push(make(injected, params, level.drill));
    return runs;
  }

  const primary = drillById(level.drill);
  const mix = level.capstone && Array.isArray(params.mixDrills) ? params.mixDrills : null;
  if (!mix || mix.length === 0) {
    runs.push(make(primary, params, level.drill));
    return runs;
  }

  const mixParams = params.mixParams && typeof params.mixParams === 'object' ? params.mixParams : {};
  const problems = [];
  for (const drillId of mix) {
    try {
      const mod = drillId === level.drill ? primary : drillById(drillId);
      runs.push(make(mod, mixParams[drillId] || params, drillId));
    } catch (err) {
      // One broken drill must not sink a capstone; the mix simply gets smaller.
      problems.push(`${drillId}: ${err && err.message ? err.message : String(err)}`);
    }
  }
  if (runs.length === 0) {
    throw new Error(`Capstone ${level.id} could not start any drill (${problems.join('; ')})`);
  }
  return runs;
}

/**
 * A session must be substantially complete to score. Without this, answering one trial
 * correctly and quitting would satisfy every star threshold and pass the level.
 */
const MIN_COMPLETION = 0.8;

/**
 * Stars: walk `level.stars` in order and award the highest band whose every threshold is
 * met. A band may require accuracy, a staircase level, and a mean pace.
 */
function computeStars(level, accuracy, finalLevel, meanMs) {
  const bands = Array.isArray(level.stars) ? level.stars : [];
  let awarded = 0;
  for (let i = 0; i < bands.length; i++) {
    const band = bands[i] || {};
    if (Number.isFinite(Number(band.accuracy)) && accuracy < Number(band.accuracy)) continue;
    if (Number.isFinite(Number(band.minLevel)) && finalLevel < Number(band.minLevel)) continue;
    if (Number.isFinite(Number(band.maxMsPerTrial))) {
      if (!Number.isFinite(meanMs) || meanMs > Number(band.maxMsPerTrial)) continue;
    }
    awarded = i + 1;
  }
  return awarded;
}

/**
 * A small, bounded nudge to one factor score.
 *
 *   raw   = 12 * (accuracy - goal.accuracy) + 0.9 * (finalLevel - expectedLevel)
 *   delta = clamp(raw * completeness, -3, +6),  completeness = min(1, trials / goal.trials)
 *
 * `expectedLevel` is the level a solid run of this rung reaches, shifted by however far
 * above the rung's nominal start the learner actually began, so resuming at a high best
 * level neither pays a bonus nor incurs a penalty. The asymmetric clamp is deliberate:
 * progress should be able to outrun regression, and one bad session should not erase a
 * week of work. Truncated sessions are scaled down so quitting early cannot farm points.
 *
 * This is a TRAINING-PROGRESS metric on the 0-100 factorScores scale. It is NOT an IQ
 * estimate, not an ability estimate and not comparable with the assessment index: only
 * `core/irt.js` + `core/scale.js` produce a measured index, and only from a CAT session.
 */
function computeFactorDelta(level, accuracy, finalLevel, expectedLevel, trials) {
  if (!Number.isFinite(trials) || trials <= 0) return 0;
  const goal = level.goal || {};
  const target = num(goal.accuracy, 0.75);
  const wanted = Math.max(1, num(goal.trials, trials));
  const completeness = clamp(trials / wanted, 0, 1);
  const raw = DELTA_ACCURACY_WEIGHT * (accuracy - target)
    + DELTA_LEVEL_WEIGHT * (finalLevel - expectedLevel);
  return round2(clamp(raw * completeness, MIN_FACTOR_DELTA, MAX_FACTOR_DELTA));
}

/**
 * Create a drill session for one curriculum level.
 *
 * `opts.drillModule` is optional and is the unit-test seam: pass a drill module directly
 * and the session skips the registry lookup entirely (and skips capstone mixing, since a
 * single module is all it has). Production callers omit it and get `drillById(level.drill)`.
 */
export function createDrillSession({ rng, level, profile, drillModule } = {}) {
  if (!level || typeof level !== 'object' || typeof level.id !== 'string') {
    throw new Error('createDrillSession: a curriculum Level is required');
  }
  if (!rng || typeof rng.next !== 'function') {
    throw new Error(`createDrillSession: an rng is required for level ${level.id}`);
  }

  const goal = level.goal || {};
  const prof = profile && typeof profile === 'object' ? profile : {};
  const runs = buildRuns(level, rng, drillModule || null);
  const wiring = buildStaircase(drillModule || drillById(level.drill), level, prof);
  const staircase = wiring.staircase;

  // How far above the rung's nominal start this learner began; the pass bar moves with it.
  const startOffset = wiring.start - wiring.baseStart;
  const expectedLevel = num(level.params && level.params.expectedLevel, wiring.baseStart + 2) + startOffset;

  const declared = runs.length === 1 ? Number(runs[0].run.totalTrials) : NaN;
  const totalTrials = Number.isFinite(declared) && declared > 0
    ? Math.floor(declared)
    : Math.max(1, Math.floor(num(goal.trials, 1)));

  const records = [];
  let started = false;
  let done = false;
  let served = 0;
  let correctCount = 0;
  let nextRunIndex = 0;
  let active = null;      // { trial, servedTrial, entry, level }
  let outcome = null;

  function pullTrial() {
    if (served >= totalTrials) return null;
    const at = staircase.level;
    // Round-robin over the runs, skipping any that have run dry.
    for (let attempt = 0; attempt < runs.length; attempt++) {
      const entry = runs[nextRunIndex % runs.length];
      nextRunIndex += 1;
      let trial = null;
      try {
        trial = entry.run.nextTrial(at);
      } catch (err) {
        trial = null;
      }
      if (!trial) continue;
      entry.served += 1;
      served += 1;
      // Namespace ids when mixing so two drills cannot collide on trial 1.
      const id = runs.length > 1 ? `${entry.id}:${String(trial.id)}` : String(trial.id);
      const servedTrial = runs.length > 1
        ? Object.assign({}, trial, { id, drill: entry.id, level: at })
        : trial;
      active = { trial, servedTrial, entry, level: at };
      return servedTrial;
    }
    return null;
  }

  function snapshot() {
    return {
      levelId: level.id,
      drill: level.drill,
      started,
      done,
      index: records.length,
      served,
      total: totalTrials,
      correct: correctCount,
      accuracy: records.length === 0 ? 0 : correctCount / records.length,
      level: staircase.level,
      reversals: staircase.reversals.length,
      records: records.slice()
    };
  }

  return {
    /** Begin the session and return the first trial (null if the drill produced none). */
    start() {
      if (started) return active ? active.servedTrial : null;
      started = true;
      const first = pullTrial();
      if (!first) done = true;
      return first;
    },

    /** The trial awaiting a response, or null. */
    current() {
      return active ? active.servedTrial : null;
    },

    /**
     * Grade a response and advance. `rtMs` comes from the UI clock; a missing or
     * non-finite value is recorded as null and excluded from the pace statistics.
     */
    respond(responseId, rtMs) {
      if (!started) throw new Error(`Session for ${level.id} was not started`);
      if (done) throw new Error(`Session for ${level.id} has already finished`);
      if (!active) throw new Error(`Session for ${level.id} has no trial awaiting a response`);

      const { trial, servedTrial, entry, level: at } = active;
      let graded;
      try {
        graded = entry.run.grade(trial, responseId);
      } catch (err) {
        graded = { correct: false, detail: { error: 'gradeThrew' } };
      }
      const correct = !!(graded && graded.correct);
      const detail = graded && graded.detail !== undefined ? graded.detail : null;

      const rt = Number(rtMs);
      const rtValue = Number.isFinite(rt) && rt >= 0 ? rt : null;
      records.push({ trialId: servedTrial.id, correct, rtMs: rtValue, level: at });
      if (correct) correctCount += 1;

      const nextLevel = staircase.record(correct);
      active = null;
      const next = pullTrial();
      if (!next) done = true;

      return {
        correct,
        detail,
        drill: entry.id,
        level: at,
        nextLevel,
        index: records.length,
        remaining: Math.max(0, totalTrials - records.length),
        done,
        next
      };
    },

    /** Live snapshot of the run. Safe to read at any time. */
    get state() {
      return snapshot();
    },

    /**
     * End the session and compute the Outcome. Idempotent: calling it twice returns the
     * same object, and calling it early scores only the trials actually completed.
     */
    finish() {
      if (outcome) return outcome;
      done = true;
      active = null;

      const trials = records.length;
      const accuracy = trials === 0 ? 0 : correctCount / trials;
      const times = records.map((r) => r.rtMs).filter((ms) => Number.isFinite(ms));
      const meanMs = times.length === 0
        ? 0
        : Math.round(times.reduce((a, b) => a + b, 0) / times.length);

      // Threshold estimate: the mean of the recent reversals once the ladder has turned
      // around enough to be meaningful, otherwise wherever the ladder ended up.
      let finalLevel = staircase.reversals.length >= 4
        ? staircase.meanOfLastReversals(6)
        : staircase.level;
      if (!Number.isFinite(finalLevel)) {
        const fromDrill = safeSummary(runs[0] && runs[0].run, records);
        const fallback = fromDrill ? Number(fromDrill.level) : NaN;
        finalLevel = Number.isFinite(fallback) ? fallback : wiring.start;
      }
      finalLevel = round2(finalLevel);

      const needed = Math.max(1, Math.ceil(MIN_COMPLETION * num(goal.trials, totalTrials)));
      const stars = trials < needed
        ? 0
        : computeStars(level, accuracy, finalLevel, times.length === 0 ? Infinity : meanMs);
      const passed = stars >= 1
        && accuracy >= num(goal.accuracy, 0)
        && finalLevel >= num(goal.minLevel, 0);

      // Contract XP formula. Effort is paid for, mastery is paid for more.
      const tierMult = 1 + num(level.tier, 0) * 0.25;
      const xp = trials === 0
        ? 0
        : Math.round(trials * (0.5 + accuracy) * (1 + finalLevel / 10) * tierMult);

      const factorDelta = computeFactorDelta(level, accuracy, finalLevel, expectedLevel, trials);

      outcome = {
        levelId: level.id,
        drill: level.drill,
        accuracy: round2(accuracy),
        trials,
        meanMs,
        finalLevel,
        stars,
        xp,
        factorDelta,
        passed
      };
      return outcome;
    }
  };
}
