/**
 * Tests for the training staircase: transformed up/down mechanics, reversal tracking,
 * Kaernbach weighted steps, and convergence of a 1-up/3-down rule to ~79% correct on a
 * simulated logistic observer.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { makeStaircase, weightedUpDown, PRESETS } from '../src/core/staircase.js';

/** Deterministic LCG: this suite depends on nothing but the module under test. */
function lcg(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/**
 * Simulated observer: accuracy falls logistically as the level rises.
 * threshold = the level at which the observer is right half the time.
 */
function observer(threshold, spread) {
  return (level) => 1 / (1 + Math.exp((level - threshold) / spread));
}

/** Level at which the observer is correct with probability p. */
function levelAt(threshold, spread, p) {
  return threshold + spread * Math.log(1 / p - 1);
}

function runStaircase(cfg, { threshold, spread, trials, seed }) {
  const s = makeStaircase(cfg);
  const p = observer(threshold, spread);
  const rand = lcg(seed);
  const outcomes = [];
  for (let i = 0; i < trials; i++) {
    const level = s.level;
    const correct = rand() < p(level);
    outcomes.push({ level, correct });
    s.record(correct);
  }
  return { s, outcomes };
}

function accuracyOfLast(outcomes, k) {
  const tail = outcomes.slice(-k);
  return tail.filter((o) => o.correct).length / tail.length;
}

// --- mechanics --------------------------------------------------------------------

test('a 1-up/3-down rule needs three correct answers to step up and one error to step down', () => {
  const s = makeStaircase({ start: 5, min: 1, max: 10, step: 1, up: 1, down: 3 });
  assert.equal(s.level, 5);
  assert.equal(s.record(true), 5);
  assert.equal(s.record(true), 5);
  assert.equal(s.record(true), 6); // third consecutive correct -> harder
  assert.equal(s.record(true), 6); // the run counter reset after the step
  assert.equal(s.record(false), 5); // one error is enough to step down
  assert.equal(s.record(true), 5);
  assert.equal(s.record(false), 4); // the correct answer reset the error run
  assert.equal(s.history.length, 7);
  assert.equal(s.history[2].level, 5);
  assert.equal(s.history[2].next, 6);
  assert.equal(s.history[2].delta, 1);
});

test('a 1-up/2-down rule steps up after two correct answers', () => {
  const s = makeStaircase({ start: 3, min: 1, max: 9, step: 1, up: 1, down: 2 });
  s.record(true);
  assert.equal(s.level, 3);
  s.record(true);
  assert.equal(s.level, 4);
});

test('an n-up rule needs n consecutive errors', () => {
  const s = makeStaircase({ start: 6, min: 1, max: 9, step: 1, up: 2, down: 2 });
  s.record(false);
  assert.equal(s.level, 6);
  s.record(false);
  assert.equal(s.level, 5);
  s.record(false);
  assert.equal(s.level, 5);
  s.record(false);
  assert.equal(s.level, 4);
});

test('levels are clamped, and clamped non-moves create no phantom reversals', () => {
  const s = makeStaircase({ start: 9, min: 1, max: 9, step: 1, up: 1, down: 1 });
  for (let i = 0; i < 5; i++) s.record(true);
  assert.equal(s.level, 9);
  assert.equal(s.reversals.length, 0);
  s.record(false);
  assert.equal(s.level, 8);
  assert.equal(s.reversals.length, 0); // first actual move: no direction to reverse yet
  s.record(true);
  assert.equal(s.level, 9);
  assert.equal(s.reversals.length, 1);
  assert.equal(s.reversals[0], 8); // the turning point is the extreme reached

  const low = makeStaircase({ start: 1, min: 1, max: 9, step: 1, up: 1, down: 1 });
  for (let i = 0; i < 5; i++) low.record(false);
  assert.equal(low.level, 1);
});

test('start is clamped into range and an inverted range is repaired', () => {
  assert.equal(makeStaircase({ start: 99, min: 1, max: 5, step: 1 }).level, 5);
  assert.equal(makeStaircase({ start: -99, min: 1, max: 5, step: 1 }).level, 1);
  const swapped = makeStaircase({ start: 3, min: 8, max: 2, step: 1, up: 1, down: 1 });
  assert.equal(swapped.level, 3);
  for (let i = 0; i < 20; i++) swapped.record(true);
  assert.equal(swapped.level, 8);
  assert.equal(makeStaircase().level, 1); // no config at all must still work
});

test('meanOfLastReversals averages the requested tail', () => {
  const s = makeStaircase({ start: 5, min: 1, max: 10, step: 1, up: 1, down: 1 });
  assert.equal(s.meanOfLastReversals(6), 5); // no reversals yet -> current level

  // Drive a known pattern: up, up, down, up, down ...
  const pattern = [true, true, false, true, false, false, true, true, false];
  for (const ok of pattern) s.record(ok);
  assert.ok(s.reversals.length >= 3);
  const last2 = s.reversals.slice(-2);
  assert.ok(Math.abs(s.meanOfLastReversals(2) - (last2[0] + last2[1]) / 2) < 1e-12);
  // Asking for more reversals than exist uses every one available.
  const all = s.reversals.reduce((acc, v) => acc + v, 0) / s.reversals.length;
  assert.ok(Math.abs(s.meanOfLastReversals(999) - all) < 1e-12);
  assert.equal(s.meanOfLastReversals(0), s.level);
});

// --- weighted up/down -------------------------------------------------------------

test('weightedUpDown implements the Kaernbach step ratio', () => {
  for (const p of [0.6, 0.7071, 0.75, 0.7937, 0.85]) {
    const w = weightedUpDown(p);
    assert.ok(Math.abs(w.down / w.up - p / (1 - p)) < 1e-12, `p=${p}`);
    assert.equal(w.up, 1);
    assert.ok(w.down > 0);
  }
  assert.equal(weightedUpDown(0.5).down, 1); // symmetric at 50%
  // Degenerate inputs are clamped, never NaN or infinite.
  for (const bad of [0, 1, -3, 7, NaN, undefined, 'x']) {
    const w = weightedUpDown(bad);
    assert.ok(Number.isFinite(w.up) && Number.isFinite(w.down) && w.down > 0);
  }
});

test('a 1-up/1-down rule with a target accuracy adopts weighted steps', () => {
  const s = makeStaircase({ start: 5, min: 0, max: 20, step: 1, up: 1, down: 1, targetAccuracy: 0.75 });
  s.record(true);
  assert.ok(Math.abs(s.level - 6) < 1e-12); // step up = 1 * 1
  s.record(false);
  assert.ok(Math.abs(s.level - 3) < 1e-12); // step down = 1 * 0.75/0.25 = 3
});

test('explicit asymmetric step sizes are honoured', () => {
  const s = makeStaircase({ start: 5, min: 0, max: 20, step: { up: 0.5, down: 2 }, up: 1, down: 1 });
  s.record(true);
  assert.ok(Math.abs(s.level - 5.5) < 1e-12);
  s.record(false);
  assert.ok(Math.abs(s.level - 3.5) < 1e-12);
});

// --- convergence ------------------------------------------------------------------

test('a 1-up/3-down staircase converges on the 79% point of a logistic observer', () => {
  const threshold = 6;
  const spread = 1;
  const target = levelAt(threshold, spread, Math.pow(0.5, 1 / 3)); // ~4.65 for these settings

  const estimates = [];
  const accuracies = [];
  for (let seed = 1; seed <= 24; seed++) {
    const { s, outcomes } = runStaircase(
      { start: threshold, min: 0, max: 12, step: 0.2, up: 1, down: 3, targetAccuracy: 0.7937 },
      { threshold, spread, trials: 400, seed: seed * 7919 }
    );
    assert.ok(s.reversals.length >= 20, `too few reversals: ${s.reversals.length}`);
    const estimate = s.meanOfLastReversals(20);
    estimates.push(estimate);
    accuracies.push(accuracyOfLast(outcomes, 300));
    assert.ok(Math.abs(estimate - target) < 1.0, `run ${seed}: estimate ${estimate} vs ${target}`);
  }

  const meanEstimate = estimates.reduce((a, b) => a + b, 0) / estimates.length;
  const meanAccuracy = accuracies.reduce((a, b) => a + b, 0) / accuracies.length;
  assert.ok(
    Math.abs(meanEstimate - target) < 0.3,
    `mean threshold estimate ${meanEstimate} should sit at ${target}`
  );
  assert.ok(
    Math.abs(meanAccuracy - 0.7937) < 0.04,
    `1-up/3-down should hold accuracy near 79%, got ${meanAccuracy}`
  );
});

test('a 1-up/2-down staircase converges on the 70.7% point instead', () => {
  const threshold = 6;
  const spread = 1;
  const target = levelAt(threshold, spread, Math.pow(0.5, 1 / 2));

  const estimates = [];
  const accuracies = [];
  for (let seed = 1; seed <= 16; seed++) {
    const { s, outcomes } = runStaircase(
      { start: threshold, min: 0, max: 12, step: 0.2, up: 1, down: 2 },
      { threshold, spread, trials: 400, seed: seed * 104729 }
    );
    estimates.push(s.meanOfLastReversals(20));
    accuracies.push(accuracyOfLast(outcomes, 300));
  }
  const meanEstimate = estimates.reduce((a, b) => a + b, 0) / estimates.length;
  const meanAccuracy = accuracies.reduce((a, b) => a + b, 0) / accuracies.length;
  assert.ok(Math.abs(meanEstimate - target) < 0.3, `${meanEstimate} vs ${target}`);
  assert.ok(Math.abs(meanAccuracy - 0.7071) < 0.04, `got ${meanAccuracy}`);
  // The easier rule must settle at a strictly harder level than the 79% rule.
  assert.ok(target > levelAt(threshold, spread, Math.pow(0.5, 1 / 3)));
});

test('a weighted 1-up/1-down staircase converges on its target accuracy', () => {
  const threshold = 6;
  const spread = 1;
  const targetAccuracy = 0.75;
  const target = levelAt(threshold, spread, targetAccuracy);

  const accuracies = [];
  const estimates = [];
  for (let seed = 1; seed <= 16; seed++) {
    const { s, outcomes } = runStaircase(
      { start: threshold, min: 0, max: 12, step: 0.15, up: 1, down: 1, targetAccuracy },
      { threshold, spread, trials: 500, seed: seed * 15485863 }
    );
    estimates.push(s.meanOfLastReversals(30));
    accuracies.push(accuracyOfLast(outcomes, 400));
  }
  const meanEstimate = estimates.reduce((a, b) => a + b, 0) / estimates.length;
  const meanAccuracy = accuracies.reduce((a, b) => a + b, 0) / accuracies.length;
  assert.ok(Math.abs(meanEstimate - target) < 0.35, `${meanEstimate} vs ${target}`);
  assert.ok(Math.abs(meanAccuracy - targetAccuracy) < 0.05, `got ${meanAccuracy}`);
});

// --- presets ----------------------------------------------------------------------

test('PRESETS are frozen, since every drill shares the same objects', () => {
  assert.ok(Object.isFrozen(PRESETS));
  for (const key of Object.keys(PRESETS)) {
    assert.ok(Object.isFrozen(PRESETS[key]), `${key} must be frozen`);
  }
  // A drill that overrides a preset must spread it; writing through must not stick.
  const before = PRESETS.nback.down;
  try {
    PRESETS.nback.down = 99;
  } catch (err) {
    // strict mode throws; either way the value must be unchanged
  }
  assert.equal(PRESETS.nback.down, before);
});

test('PRESETS cover the drill styles and are directly usable', () => {
  for (const key of ['nback', 'precision', 'speed', 'span']) {
    const preset = PRESETS[key];
    assert.ok(preset, `missing preset ${key}`);
    assert.ok(Number.isFinite(preset.start));
    assert.ok(preset.min <= preset.start && preset.start <= preset.max);
    assert.ok(preset.up >= 1 && preset.down >= 1);
    assert.ok(preset.targetAccuracy > 0.5 && preset.targetAccuracy < 1);
    // The declared target accuracy must be the one the rule actually converges to.
    assert.ok(
      Math.abs(preset.targetAccuracy - Math.pow(0.5, 1 / preset.down)) < 0.005,
      `${key}: ${preset.targetAccuracy} vs ${Math.pow(0.5, 1 / preset.down)}`
    );

    const s = makeStaircase(preset);
    assert.equal(s.level, preset.start);
    for (let i = 0; i < 30; i++) s.record(i % 4 !== 3);
    assert.ok(s.level >= preset.min && s.level <= preset.max);
    assert.equal(s.history.length, 30);
  }

  assert.equal(PRESETS.nback.up, 1);
  assert.equal(PRESETS.nback.down, 3);
  assert.equal(PRESETS.precision.up, 1);
  assert.equal(PRESETS.precision.down, 2);
});
