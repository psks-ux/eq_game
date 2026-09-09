/**
 * Tests for the item difficulty model and the online item bank. The 3PL algebra is
 * re-derived here from contract constants only, so the analytic Newton step is checked
 * against a finite-difference gradient rather than against itself.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  DIFFICULTY_MODEL,
  priorIrtParams,
  itemKey,
  updateBank,
  bankSummary,
  blendedParams
} from '../src/items/calibration.js';

// --- independent 3PL reference (contract section 4) -------------------------------

const D = 1.702;

function P(theta, a, b, c) {
  return c + (1 - c) / (1 + Math.exp(-D * a * (theta - b)));
}

function fisherInfo(theta, a, b, c) {
  const p = P(theta, a, b, c);
  const ratio = (p - c) / (1 - c);
  return D * D * a * a * ((1 - p) / p) * ratio * ratio;
}

/** Log-likelihood of one response as a function of b. */
function logLikOfB(b, theta, a, c, correct) {
  const p = P(theta, a, b, c);
  return correct ? Math.log(p) : Math.log(1 - p);
}

function fdGradient(b, theta, a, c, correct, h = 1e-5) {
  return (logLikOfB(b + h, theta, a, c, correct) - logLikOfB(b - h, theta, a, c, correct)) / (2 * h);
}

/** The contract's damped Newton step, expressed with the finite-difference gradient. */
function expectedB(b0, n, theta, a, c, correct) {
  const priorPrecision = 1 / (DIFFICULTY_MODEL.PRIOR_SD * DIFFICULTY_MODEL.PRIOR_SD);
  const grad = fdGradient(b0, theta, a, c, correct);
  const denom = fisherInfo(theta, a, b0, c) + priorPrecision;
  const raw = grad / denom;
  const capped = Math.max(-DIFFICULTY_MODEL.MAX_STEP, Math.min(DIFFICULTY_MODEL.MAX_STEP, raw));
  return b0 + capped / (n + DIFFICULTY_MODEL.DAMPING);
}

/** Deterministic LCG so this suite depends on nothing but the module under test. */
function lcg(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function metaOf(over) {
  return {
    ruleCount: 2,
    ruleTypes: ['progression', 'rotation'],
    abstractness: 2,
    elementCount: 9,
    distractorSystematicity: 0.8,
    wmLoad: 3,
    perceptualSalience: 0.2,
    optionCount: 8,
    generatorVersion: 1,
    ...over
  };
}

// --- difficulty model -------------------------------------------------------------

test('difficulty model reproduces the documented formula', () => {
  const M = DIFFICULTY_MODEL;
  const meta = metaOf({});
  const { a, b, c } = priorIrtParams(meta, 'matrix');

  const expectB = M.B0
    + M.B_RULES * (2 - 1)
    + M.B_ABSTRACT * (2 - 1)
    + M.B_WM * (3 - 1)
    + M.B_ELEMENTS * Math.log2(9 / 4)
    - M.B_SALIENCE * 0.2
    + M.B_FAMILY.matrix;
  const expectA = M.A0 + M.A_SYS * 0.8 - M.A_SAL * 0.2 + M.A_FAMILY.matrix;

  assert.ok(Math.abs(b - expectB) < 1e-12, `b ${b} vs ${expectB}`);
  assert.ok(Math.abs(a - expectA) < 1e-12, `a ${a} vs ${expectA}`);
  assert.equal(c, 0.85 / 8);
});

test('b is strictly increasing in ruleCount and in wmLoad', () => {
  let prevRules = -Infinity;
  for (let ruleCount = 1; ruleCount <= 6; ruleCount++) {
    const b = priorIrtParams(metaOf({ ruleCount }), 'matrix').b;
    assert.ok(b > prevRules, `ruleCount ${ruleCount}: ${b} !> ${prevRules}`);
    prevRules = b;
  }

  let prevWm = -Infinity;
  for (let wmLoad = 1; wmLoad <= 6; wmLoad++) {
    const b = priorIrtParams(metaOf({ wmLoad }), 'series').b;
    assert.ok(b > prevWm, `wmLoad ${wmLoad}: ${b} !> ${prevWm}`);
    prevWm = b;
  }

  // ...and in abstractness and element count, which the same model term drives.
  const low = priorIrtParams(metaOf({ abstractness: 1 }), 'series').b;
  const high = priorIrtParams(metaOf({ abstractness: 3.5 }), 'series').b;
  assert.ok(high > low);
  assert.ok(
    priorIrtParams(metaOf({ elementCount: 16 }), 'series').b
      > priorIrtParams(metaOf({ elementCount: 4 }), 'series').b
  );
});

test('b and a both decrease as perceptual salience rises', () => {
  let prevB = Infinity;
  let prevA = Infinity;
  for (const salience of [0, 0.25, 0.5, 0.75, 1]) {
    const { a, b } = priorIrtParams(metaOf({ perceptualSalience: salience }), 'matrix');
    assert.ok(b < prevB, `salience ${salience}: b ${b} !< ${prevB}`);
    assert.ok(a < prevA, `salience ${salience}: a ${a} !< ${prevA}`);
    prevB = b;
    prevA = a;
  }
});

test('a stays inside [0.45, 2.60] and rises with distractor systematicity', () => {
  const families = [null, 'matrix', 'series', 'relationalIntegration', 'symmetry', 'nonexistentFamily'];
  for (const family of families) {
    for (const sys of [0, 0.25, 0.5, 0.7, 0.9, 1]) {
      for (const sal of [0, 0.5, 1]) {
        const { a } = priorIrtParams(
          metaOf({ distractorSystematicity: sys, perceptualSalience: sal }),
          family
        );
        assert.ok(a >= DIFFICULTY_MODEL.A_MIN - 1e-12, `a too low: ${a}`);
        assert.ok(a <= DIFFICULTY_MODEL.A_MAX + 1e-12, `a too high: ${a}`);
      }
    }
  }
  const lowSys = priorIrtParams(metaOf({ distractorSystematicity: 0.2 }), 'matrix').a;
  const highSys = priorIrtParams(metaOf({ distractorSystematicity: 0.95 }), 'matrix').a;
  assert.ok(highSys > lowSys);
});

test('c is exactly 0.85 / optionCount', () => {
  for (const optionCount of [2, 4, 5, 6, 8, 10]) {
    assert.equal(priorIrtParams(metaOf({ optionCount }), 'matrix').c, 0.85 / optionCount);
  }
  // 8 options -> 0.10625, below the 0.125 uniform-guessing rate, as designed.
  assert.ok(priorIrtParams(metaOf({ optionCount: 8 }), 'matrix').c < 1 / 8);
});

test('family offsets stay inside their contract bounds', () => {
  for (const [family, offset] of Object.entries(DIFFICULTY_MODEL.B_FAMILY)) {
    assert.ok(offset >= -0.5 && offset <= 0.5, `B_FAMILY.${family} = ${offset}`);
  }
  for (const [family, offset] of Object.entries(DIFFICULTY_MODEL.A_FAMILY)) {
    assert.ok(offset >= -0.25 && offset <= 0.35, `A_FAMILY.${family} = ${offset}`);
  }
  // An unknown family must not blow up: it simply carries no offset.
  const known = priorIrtParams(metaOf({}), 'matrix');
  const unknown = priorIrtParams(metaOf({}), 'totallyUnknownFamily');
  assert.ok(Math.abs((known.b - unknown.b) - DIFFICULTY_MODEL.B_FAMILY.matrix) < 1e-12);
});

test('priorIrtParams survives absent or malformed meta', () => {
  for (const meta of [undefined, null, {}, { ruleCount: NaN, elementCount: 0, optionCount: 'x' }]) {
    const p = priorIrtParams(meta, undefined);
    assert.ok(Number.isFinite(p.a) && Number.isFinite(p.b) && Number.isFinite(p.c));
    assert.ok(p.c > 0 && p.c < 1);
  }
  // meta.family is used when the family argument is omitted.
  const viaMeta = priorIrtParams(metaOf({ family: 'paperFolding' }));
  const viaArg = priorIrtParams(metaOf({}), 'paperFolding');
  assert.equal(viaMeta.b, viaArg.b);
});

// --- structural item key ----------------------------------------------------------

function itemOf(over) {
  return {
    id: 'matrix:12345:7',
    family: 'matrix',
    seed: 12345,
    options: new Array(8).fill(0).map((_, i) => ({ id: `o${i}` })),
    answerId: 'o3',
    meta: metaOf({}),
    ...over
  };
}

test('itemKey is structural: it pools across seeds but splits on structure', () => {
  const a = itemOf({});
  const b = itemOf({ id: 'matrix:999:2', seed: 999 });
  assert.equal(itemKey(a), itemKey(b));
  assert.ok(!itemKey(a).includes('12345'), itemKey(a));
  assert.ok(!itemKey(b).includes('999'), itemKey(b));

  // Rule order must not matter; rule identity must.
  const reordered = itemOf({ meta: metaOf({ ruleTypes: ['rotation', 'progression'] }) });
  assert.equal(itemKey(a), itemKey(reordered));
  const different = itemOf({ meta: metaOf({ ruleTypes: ['rotation', 'containment'] }) });
  assert.notEqual(itemKey(a), itemKey(different));

  // Each structural dimension separates.
  assert.notEqual(itemKey(a), itemKey(itemOf({ family: 'series' })));
  assert.notEqual(itemKey(a), itemKey(itemOf({ meta: metaOf({ ruleCount: 3 }) })));
  assert.notEqual(itemKey(a), itemKey(itemOf({ meta: metaOf({ wmLoad: 5 }) })));
  assert.notEqual(itemKey(a), itemKey(itemOf({ meta: metaOf({ optionCount: 6 }) })));
  assert.notEqual(itemKey(a), itemKey(itemOf({ meta: metaOf({ elementCount: 25 }) })));

  // Element counts inside one bucket pool together (7 and 9 are the same kind of load).
  assert.equal(
    itemKey(itemOf({ meta: metaOf({ elementCount: 7 }) })),
    itemKey(itemOf({ meta: metaOf({ elementCount: 9 }) }))
  );

  // Never throws on junk.
  assert.equal(typeof itemKey(null), 'string');
  assert.equal(typeof itemKey({}), 'string');
});

// --- online bank update -----------------------------------------------------------

test('the damped Newton step matches a finite-difference gradient', () => {
  const cases = [
    { theta: 1.0, a: 1.3, b: 0.4, c: 0.125, correct: true },
    { theta: 1.0, a: 1.3, b: 0.4, c: 0.125, correct: false },
    { theta: -1.4, a: 0.7, b: 0.9, c: 0.10625, correct: true },
    { theta: 2.6, a: 2.1, b: 2.0, c: 0.10625, correct: false },
    { theta: 0.0, a: 1.0, b: 0.0, c: 0.0, correct: true },
    { theta: 3.5, a: 1.5, b: 1.0, c: 0.17, correct: true }
  ];

  for (const k of cases) {
    const bank = updateBank({}, { key: 'k', theta: k.theta, correct: k.correct, a: k.a, b: k.b, c: k.c });
    const got = bank.k.b;
    const want = expectedB(k.b, 0, k.theta, k.a, k.c, k.correct);
    assert.ok(
      Math.abs(got - want) < 1e-7,
      `theta=${k.theta} correct=${k.correct}: got ${got}, finite-difference expects ${want}`
    );
    // Direction sanity: a correct answer says the item is easier than we thought.
    if (k.correct) assert.ok(got < k.b, `correct answer must lower b (${got} vs ${k.b})`);
    else assert.ok(got > k.b, `wrong answer must raise b (${got} vs ${k.b})`);
  }
});

test('the step is damped by 1 / (n + 4)', () => {
  const obs = { key: 'k', theta: 0.8, correct: true, a: 1.2, b: 0.3, c: 0.10625 };
  const fresh = updateBank({}, obs);
  const seasoned = updateBank({ k: { n: 6, b: 0.3, sumInfo: 4 } }, obs);

  const freshStep = fresh.k.b - 0.3;
  const seasonedStep = seasoned.k.b - 0.3;
  assert.ok(Math.abs(freshStep) > 0);
  // Same score and information, so the ratio is exactly (0 + 4) / (6 + 4).
  assert.ok(Math.abs(seasonedStep / freshStep - 4 / 10) < 1e-9, `${seasonedStep / freshStep}`);

  assert.equal(fresh.k.n, 1);
  assert.equal(seasoned.k.n, 7);
  assert.ok(fresh.k.sumInfo > 0);
  assert.ok(seasoned.k.sumInfo > 4);
});

test('updateBank tracks a mis-specified difficulty toward the truth', () => {
  const trueB = 1.5;
  const a = 1.3;
  const c = 0.10625;
  const rand = lcg(20250908);
  const bank = { hard: { n: 0, b: 0, sumInfo: 0 } };

  for (let i = 0; i < 200; i++) {
    // Examinees drawn around the item's true difficulty, as an adaptive test would.
    const theta = trueB - 0.6 + 1.2 * rand();
    const p = P(theta, a, trueB, c);
    updateBank(bank, { key: 'hard', theta, correct: rand() < p, a, c });
  }

  const learned = bank.hard.b;
  assert.equal(bank.hard.n, 200);
  assert.ok(learned > 0.9, `posterior b should climb toward 1.5, got ${learned}`);
  assert.ok(learned < 2.1, `posterior b should not overshoot, got ${learned}`);
  assert.ok(bank.hard.sumInfo > 0);
});

test('updateBank is defensive about junk input', () => {
  assert.deepEqual(updateBank({}, {}), {});
  assert.deepEqual(updateBank({}, { key: '' }), {});
  assert.deepEqual(updateBank(null, {}), {});

  const bank = updateBank(undefined, { key: 'k', theta: NaN, correct: true });
  assert.ok(Number.isFinite(bank.k.b));
  assert.equal(bank.k.n, 1);

  // Ridiculous theta must not produce a ridiculous step.
  const wild = updateBank({}, { key: 'k', theta: 1e9, correct: false, a: 1.2, b: 0, c: 0.1 });
  assert.ok(Number.isFinite(wild.k.b));
  assert.ok(Math.abs(wild.k.b) <= 7);
});

// --- blending and summary ---------------------------------------------------------

test('blendedParams precision-weights the prior and posterior b', () => {
  const item = itemOf({});
  const prior = priorIrtParams(item.meta, item.family);
  item.irt = prior;

  assert.deepEqual(blendedParams(item, null), prior);
  assert.deepEqual(blendedParams(item, {}), prior);
  assert.deepEqual(blendedParams(item, { [itemKey(item)]: { n: 0, b: 5, sumInfo: 0 } }), prior);

  const key = itemKey(item);
  const posteriorB = prior.b + 1.5;
  const sumInfo = 5;
  const priorPrecision = 1 / (DIFFICULTY_MODEL.PRIOR_SD * DIFFICULTY_MODEL.PRIOR_SD);
  const expect = (priorPrecision * prior.b + sumInfo * posteriorB) / (priorPrecision + sumInfo);

  const blended = blendedParams(item, { [key]: { n: 12, b: posteriorB, sumInfo } });
  assert.ok(Math.abs(blended.b - expect) < 1e-12, `${blended.b} vs ${expect}`);
  assert.equal(blended.a, prior.a);
  assert.equal(blended.c, prior.c);
  // More data pulls further toward the posterior.
  const heavier = blendedParams(item, { [key]: { n: 200, b: posteriorB, sumInfo: 200 } });
  assert.ok(heavier.b > blended.b);
  assert.ok(heavier.b < posteriorB);
});

test('blendedParams falls back to the model when an item carries no irt block', () => {
  const item = itemOf({});
  delete item.irt;
  const p = blendedParams(item, null);
  assert.deepEqual(p, priorIrtParams(item.meta, item.family));
});

test('bankSummary aggregates the bank', () => {
  const empty = bankSummary({});
  assert.equal(empty.items, 0);
  assert.equal(empty.observations, 0);
  assert.equal(bankSummary(null).items, 0);

  const bank = {
    one: { n: 3, b: 1.0, sumInfo: 2 },
    two: { n: 12, b: 2.0, sumInfo: 9 },
    junk: { n: 4, b: NaN, sumInfo: 1 }
  };
  const s = bankSummary(bank);
  assert.equal(s.items, 2);
  assert.equal(s.observations, 15);
  assert.ok(Math.abs(s.meanB - 1.5) < 1e-12);
  assert.equal(s.minB, 1.0);
  assert.equal(s.maxB, 2.0);
  assert.equal(s.wellEstimated, 1);
  assert.ok(s.meanSe > 0 && s.meanSe < 1);
});
