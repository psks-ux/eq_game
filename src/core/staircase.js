/**
 * Adaptive difficulty for training: a transformed up/down staircase with reversal
 * tracking, Kaernbach weighted steps, and the presets the drill engines run on.
 * Levels are difficulty: "up" always means harder.
 */

function num(v, fallback) {
  const x = Number(v);
  return Number.isFinite(x) ? x : fallback;
}

function clamp(x, lo, hi) {
  return x < lo ? lo : x > hi ? hi : x;
}

/**
 * Kaernbach's weighted up-down step ratio for a target accuracy.
 * At equilibrium the expected drift is zero: p * stepUp = (1 - p) * stepDown, i.e.
 * stepDown / stepUp = p / (1 - p). Returned normalised to stepUp = 1.
 *
 * These are step *sizes* (multipliers on `step`), not the response counts used by the
 * transformed rule - pair them with a 1-up/1-down rule.
 */
export function weightedUpDown(targetAccuracy) {
  const p = clamp(num(targetAccuracy, 0.75), 0.01, 0.99);
  return { up: 1, down: p / (1 - p) };
}

/**
 * Ready-made staircases, one per drill style. `up` / `down` are the transformed-rule
 * response counts (`down` consecutive correct answers make it harder; `up` consecutive
 * errors make it easier), which fixes the target accuracy at 0.5^(1/down):
 *   1-up/3-down -> 0.794, 1-up/2-down -> 0.707, 1-up/1-down -> 0.500.
 * Frozen: every drill reads the same shared object, so spread a preset before overriding
 * fields rather than writing into it.
 */
export const PRESETS = Object.freeze({
  // Working-memory load: coarse integer levels, held near 79% so the load stays hard but
  // not demoralising, and the ceiling is the highest n anyone realistically reaches.
  nback: Object.freeze(
    { start: 2, min: 1, max: 9, step: 1, up: 1, down: 3, targetAccuracy: 0.7937 }),
  // Discrimination/accuracy work: the classic 2-down/1-up 70.7% point, fine steps.
  precision: Object.freeze(
    { start: 3, min: 1, max: 16, step: 1, up: 1, down: 2, targetAccuracy: 0.7071 }),
  // Time pressure: accuracy must stay high while the clock tightens, so 79% with a wide
  // ladder of time-limit steps.
  speed: Object.freeze(
    { start: 3, min: 1, max: 20, step: 1, up: 1, down: 3, targetAccuracy: 0.7937 }),
  // Span tasks move one item at a time and start above the floor, since a span of 2 is
  // free for almost everyone.
  span: Object.freeze(
    { start: 3, min: 2, max: 12, step: 1, up: 1, down: 2, targetAccuracy: 0.7071 })
});

/**
 * Transformed up/down staircase.
 *
 * `up`   - consecutive incorrect answers required to step DOWN in difficulty (default 1)
 * `down` - consecutive correct answers required to step UP in difficulty (default 3)
 * `step` - step size; either a number, or `{ up, down }` for weighted (unequal) steps.
 *
 * If a 1-up/1-down rule is combined with a `targetAccuracy` other than 0.5, the step
 * sizes are derived automatically with `weightedUpDown`, which is the only way a
 * 1-up/1-down rule can converge anywhere but 50%.
 */
export function makeStaircase(config) {
  const cfg = config && typeof config === 'object' ? config : {};

  let min = num(cfg.min, 1);
  let max = num(cfg.max, 10);
  if (max < min) {
    const swap = min;
    min = max;
    max = swap;
  }
  const start = clamp(num(cfg.start, min), min, max);

  const upCount = Math.max(1, Math.round(num(cfg.up, 1)));
  const downCount = Math.max(1, Math.round(num(cfg.down, 3)));
  const targetAccuracy = clamp(num(cfg.targetAccuracy, Math.pow(0.5, 1 / downCount)), 0.01, 0.99);

  const baseStep = typeof cfg.step === 'object' && cfg.step !== null
    ? null
    : Math.abs(num(cfg.step, 1)) || 1;

  let stepUp;
  let stepDown;
  if (baseStep === null) {
    stepUp = Math.abs(num(cfg.step.up, 1)) || 1;
    stepDown = Math.abs(num(cfg.step.down, 1)) || 1;
  } else if (upCount === 1 && downCount === 1 && Math.abs(targetAccuracy - 0.5) > 1e-9) {
    const w = weightedUpDown(targetAccuracy);
    stepUp = baseStep * w.up;
    stepDown = baseStep * w.down;
  } else {
    stepUp = baseStep;
    stepDown = baseStep;
  }

  let level = start;
  let correctRun = 0;
  let errorRun = 0;
  let direction = 0; // +1 = last move made it harder, -1 = easier, 0 = no move yet
  let trial = 0;

  /** One entry per response; `level` is where the trial was presented. */
  const history = [];
  /** Levels at which the staircase turned around - the classic threshold estimate. */
  const reversals = [];

  function record(correct) {
    const ok = !!correct;
    trial += 1;
    const presentedAt = level;

    if (ok) {
      correctRun += 1;
      errorRun = 0;
    } else {
      errorRun += 1;
      correctRun = 0;
    }

    let delta = 0;
    if (ok && correctRun >= downCount) {
      delta = stepUp;
      correctRun = 0;
    } else if (!ok && errorRun >= upCount) {
      delta = -stepDown;
      errorRun = 0;
    }

    const next = clamp(level + delta, min, max);
    let reversal = false;
    if (next !== level) {
      const dir = next > level ? 1 : -1;
      if (direction !== 0 && dir !== direction) {
        reversal = true;
        // The turning point is the extreme just reached, i.e. the level before the move.
        reversals.push(level);
      }
      direction = dir;
      level = next;
    }

    history.push({
      trial,
      level: presentedAt,
      correct: ok,
      delta: level - presentedAt,
      reversal,
      next: level
    });
    return level;
  }

  return {
    get level() {
      return level;
    },
    record,
    history,
    reversals,
    /**
     * Mean of the last k reversal levels - the standard threshold estimate. Uses every
     * reversal available when there are fewer than k, and the current level when there
     * are none. Prefer an even k: it cancels the up/down asymmetry.
     */
    meanOfLastReversals(k = 6) {
      const want = Math.floor(num(k, 6));
      if (want <= 0 || reversals.length === 0) return level;
      const take = Math.min(want, reversals.length);
      let sum = 0;
      for (let i = reversals.length - take; i < reversals.length; i++) sum += reversals[i];
      return sum / take;
    }
  };
}
