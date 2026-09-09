/**
 * Unit tests for the 3PL IRT engine: probability/information identities, the
 * maxInfoTheta <-> bForMaxInfoAt inverse pair, numerical guards, and a Monte-Carlo
 * ability-recovery study including the WLE-vs-EAP shrinkage comparison at theta = 3.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  D,
  THETA_MIN,
  THETA_MAX,
  p3pl,
  info3pl,
  testInfo,
  seFromInfo,
  maxInfoTheta,
  bForMaxInfoAt,
  logLik,
  estimateWLE,
  estimateEAP,
  estimate,
  reliability
} from '../src/core/irt.js';
import { makeRng } from '../src/core/rng.js';
import { mean, pearson, auc, linspace } from '../src/core/stats.js';

const ITEMS = [
  { a: 0.6, b: -2.0, c: 0.0 },
  { a: 1.0, b: -0.5, c: 0.1 },
  { a: 1.4, b: 0.7, c: 0.15 },
  { a: 2.0, b: 2.4, c: 0.106 },
  { a: 2.55, b: 4.5, c: 0.2 }
];

test('constants match the contract', () => {
  assert.equal(D, 1.702);
  assert.equal(THETA_MIN, -4);
  assert.equal(THETA_MAX, 7);
});

test('p3pl is strictly increasing in theta for every item', () => {
  for (const item of ITEMS) {
    let prev = -Infinity;
    let strictSteps = 0;
    for (let t = -8; t <= 10; t += 0.05) {
      const p = p3pl(t, item);
      assert.ok(Number.isFinite(p), `non-finite P at theta=${t}`);
      assert.ok(p >= prev, `p3pl decreased at theta=${t} (${p} < ${prev})`);
      assert.ok(p >= item.c - 1e-12 && p <= 1, `P outside [c,1] at theta=${t}: ${p}`);
      // Away from the numerically saturated asymptotes the rise must be strict.
      if (p > item.c + 1e-9 && p < 1 - 1e-9) {
        assert.ok(p > prev, `p3pl not strictly increasing at theta=${t} (${p} <= ${prev})`);
        strictSteps++;
      }
      prev = p;
    }
    assert.ok(strictSteps > 20, `too little resolvable range for a=${item.a} b=${item.b}`);
  }
});

test('p3pl asymptotes: P(-Infinity) = c and P(+Infinity) = 1', () => {
  for (const item of ITEMS) {
    assert.equal(p3pl(-Infinity, item), item.c);
    assert.equal(p3pl(Infinity, item), 1);
    // At theta = b the logistic term is exactly 1/2.
    assert.ok(Math.abs(p3pl(item.b, item) - (item.c + (1 - item.c) / 2)) < 1e-12);
  }
});

test('p3pl follows the contract formula exactly', () => {
  const item = { a: 1.3, b: 0.4, c: 0.12 };
  for (const t of [-3, -1, 0, 0.4, 2, 5]) {
    const expected = item.c + (1 - item.c) / (1 + Math.exp(-D * item.a * (t - item.b)));
    assert.ok(Math.abs(p3pl(t, item) - expected) < 1e-12, `mismatch at theta=${t}`);
  }
});

test('info3pl peaks exactly at maxInfoTheta', () => {
  const cases = [
    { a: 0.5, b: -1.5, c: 0 },
    { a: 1.0, b: 0, c: 0.1 },
    { a: 1.3, b: 0.7, c: 0.15 },
    { a: 1.8, b: 2.2, c: 0.106 },
    { a: 2.6, b: -3.0, c: 0.25 }
  ];
  for (const item of cases) {
    const peak = maxInfoTheta(item);
    assert.ok(Number.isFinite(peak));
    let bestT = peak - 3;
    let bestV = -Infinity;
    for (let t = peak - 3; t <= peak + 3; t += 0.002) {
      const v = info3pl(t, item);
      if (v > bestV) {
        bestV = v;
        bestT = t;
      }
    }
    assert.ok(
      Math.abs(bestT - peak) < 0.01,
      `argmax ${bestT} differs from maxInfoTheta ${peak} for a=${item.a} c=${item.c}`
    );
    // The peak really is a maximum, not a plateau edge.
    assert.ok(info3pl(peak, item) >= info3pl(peak - 0.5, item));
    assert.ok(info3pl(peak, item) >= info3pl(peak + 0.5, item));
  }
});

test('maxInfoTheta equals b when c = 0 and shifts right as c grows', () => {
  const base = { a: 1.2, b: 0.5, c: 0 };
  assert.ok(Math.abs(maxInfoTheta(base) - base.b) < 1e-12);
  let prev = maxInfoTheta(base);
  for (const c of [0.05, 0.1, 0.2, 0.3]) {
    const v = maxInfoTheta({ ...base, c });
    assert.ok(v > prev, 'peak must move right as guessing rises');
    prev = v;
  }
});

test('bForMaxInfoAt inverts maxInfoTheta', () => {
  for (const target of [-3.5, -1, 0, 0.25, 2.5, 4, 6.5]) {
    for (const a of [0.45, 1, 1.42, 2.6]) {
      for (const c of [0, 0.106, 0.14, 0.25]) {
        const b = bForMaxInfoAt(target, a, c);
        const back = maxInfoTheta({ a, b, c });
        assert.ok(
          Math.abs(back - target) < 1e-10,
          `inverse failed: target=${target} a=${a} c=${c} -> b=${b} -> ${back}`
        );
      }
    }
  }
});

test('an item placed by bForMaxInfoAt really is most informative at the target', () => {
  const target = 2.5;
  const a = 1.5;
  const c = 0.106;
  const tuned = { a, b: bForMaxInfoAt(target, a, c), c };
  const here = info3pl(target, tuned);
  for (const other of [-1, 0, 1, 2, 3, 4]) {
    if (Math.abs(other - target) < 1e-9) continue;
    assert.ok(info3pl(other, tuned) < here, `item beat its own peak at theta=${other}`);
  }
});

test('testInfo is additive over items and zero for an empty set', () => {
  for (const t of [-2, 0, 1.5, 3]) {
    let sum = 0;
    for (const item of ITEMS) sum += info3pl(t, item);
    assert.ok(Math.abs(testInfo(t, ITEMS) - sum) < 1e-12, `additivity failed at theta=${t}`);
    // Splitting the set and adding must give the same total.
    const left = ITEMS.slice(0, 2);
    const right = ITEMS.slice(2);
    assert.ok(Math.abs(testInfo(t, ITEMS) - (testInfo(t, left) + testInfo(t, right))) < 1e-12);
  }
  assert.equal(testInfo(0, []), 0);
  assert.equal(testInfo(0, null), 0);
  assert.equal(testInfo(0, [null, undefined]), 0);
});

test('seFromInfo and reliability behave at the edges', () => {
  assert.ok(Math.abs(seFromInfo(4) - 0.5) < 1e-12);
  assert.equal(seFromInfo(0), Infinity);
  assert.equal(seFromInfo(-3), Infinity);
  assert.equal(seFromInfo(NaN), Infinity);
  assert.equal(seFromInfo(Infinity), 0);

  assert.equal(reliability(0), 1);
  assert.ok(Math.abs(reliability(0.3) - 0.91) < 1e-12);
  assert.equal(reliability(1), 0);
  assert.equal(reliability(5), 0);
  assert.equal(reliability(Infinity), 0);
  assert.equal(reliability(NaN), 0);
});

test('degenerate item parameters never produce NaN or Infinity', () => {
  const bad = [
    { a: 0, b: 0, c: 0.1 },
    { a: 1, b: 0, c: 1 },
    { a: 1, b: 0, c: 1.5 },
    { a: 1, b: 0, c: -0.5 },
    { a: NaN, b: 0, c: 0.1 },
    { a: 1, b: NaN, c: 0.1 },
    { a: 1, b: 0, c: NaN },
    { a: Infinity, b: 0, c: 0.1 },
    {}
  ];
  for (const item of bad) {
    for (const t of [-4, 0, 3, 7]) {
      const p = p3pl(t, item);
      const i = info3pl(t, item);
      assert.ok(Number.isFinite(p) && p >= 0 && p <= 1, `bad P ${p} for ${JSON.stringify(item)}`);
      assert.ok(Number.isFinite(i) && i >= 0, `bad info ${i} for ${JSON.stringify(item)}`);
    }
  }
  // a = 0 carries no information but still yields a probability.
  assert.equal(info3pl(1, { a: 0, b: 0, c: 0.1 }), 0);
  assert.ok(Math.abs(p3pl(1, { a: 0, b: 0, c: 0.1 }) - 0.55) < 1e-12);
});

test('logLik is finite everywhere and is maximised near the generating theta', () => {
  const responses = ITEMS.map((it) => ({ ...it, correct: it.b < 1 }));
  for (let t = THETA_MIN; t <= THETA_MAX; t += 0.1) {
    assert.ok(Number.isFinite(logLik(t, responses)), `logLik non-finite at theta=${t}`);
  }
  assert.equal(logLik(0, []), 0);
  assert.equal(logLik(0, null), 0);

  // A single very easy item answered correctly should favour high theta over low theta.
  const one = [{ a: 1.5, b: -1, c: 0.1, correct: true }];
  assert.ok(logLik(2, one) > logLik(-2, one));
  const oneWrong = [{ a: 1.5, b: -1, c: 0.1, correct: false }];
  assert.ok(logLik(-2, oneWrong) > logLik(2, oneWrong));
});

test('estimators handle empty, all-correct and all-incorrect patterns', () => {
  for (const fn of [estimateWLE, estimateEAP]) {
    const empty = fn([]);
    assert.equal(empty.theta, 0);
    assert.equal(empty.se, Infinity);
    assert.equal(empty.converged, false);
    assert.equal(empty.n, 0);
    assert.equal(fn(null).theta, 0);
    assert.equal(fn(undefined).se, Infinity);
  }
  assert.equal(estimateWLE([]).method, 'wle');
  assert.equal(estimateEAP([]).method, 'eap');

  const bank = linspace(-2, 2, 30).map((b) => ({ a: 1.3, b, c: 0.12 }));
  const allRight = bank.map((it) => ({ ...it, correct: true }));
  const allWrong = bank.map((it) => ({ ...it, correct: false }));

  for (const fn of [estimateWLE, estimateEAP]) {
    const hi = fn(allRight);
    const lo = fn(allWrong);
    for (const r of [hi, lo]) {
      assert.ok(Number.isFinite(r.theta), 'estimate produced a non-finite theta');
      assert.ok(!Number.isNaN(r.se), 'estimate produced a NaN se');
      assert.ok(r.theta >= THETA_MIN && r.theta <= THETA_MAX, `theta escaped bounds: ${r.theta}`);
      assert.equal(r.n, bank.length);
    }
    assert.ok(hi.theta > 2, `all-correct should land high, got ${hi.theta}`);
    assert.ok(lo.theta < -2, `all-incorrect should land low, got ${lo.theta}`);
    assert.ok(hi.theta > lo.theta);
  }
});

test('estimators are deterministic and tolerate malformed response records', () => {
  const responses = ITEMS.map((it, i) => ({ ...it, correct: i % 2 === 0 }));
  assert.deepEqual(estimateWLE(responses), estimateWLE(responses));
  assert.deepEqual(estimateEAP(responses), estimateEAP(responses));

  const messy = [
    null,
    { a: 1.2, b: 0.2, c: 0.1, correct: true },
    'junk',
    { a: NaN, b: NaN, c: NaN, correct: false },
    { correct: true }
  ];
  const r = estimateWLE(messy);
  assert.ok(Number.isFinite(r.theta));
  assert.equal(r.n, 3, 'only object-shaped records count toward n');
});

test('a response set carrying zero information never reports a floor ability', () => {
  // a = 0 items are flat: the response vector is evidence-free. The weighted likelihood is
  // then constant, so a naive grid search returns its left edge (THETA_MIN) and the scale
  // would report index 40 and eliminate the candidate on the strength of no evidence.
  const flat = [
    { a: 0, b: 0, c: 0.1, correct: true },
    { a: 0, b: 1.5, c: 0.1, correct: false },
    { a: 0, b: -1.5, c: 0.1, correct: true }
  ];
  for (const t of [THETA_MIN, -1, 0, 3, THETA_MAX]) assert.equal(testInfo(t, flat), 0);

  const w = estimateWLE(flat);
  assert.equal(w.theta, 0, 'zero information must not produce a point estimate');
  assert.equal(w.se, Infinity, 'zero information means infinite standard error');
  assert.equal(w.converged, false);
  assert.equal(w.n, 3, 'the responses were still seen');
  assert.equal(w.method, 'wle');
  assert.notEqual(w.theta, THETA_MIN);

  // EAP already answers correctly here: the posterior is exactly the prior.
  const e = estimateEAP(flat);
  assert.ok(Math.abs(e.theta) < 0.05, `EAP should fall back to the prior mean, got ${e.theta}`);
  assert.ok(e.se > 1.2, `EAP should report the prior spread, got ${e.se}`);

  // One informative item is enough to switch the estimator back on.
  const oneReal = flat.concat([{ a: 1.4, b: 0.5, c: 0.1, correct: true }]);
  const r = estimateWLE(oneReal);
  assert.ok(Number.isFinite(r.se) && r.se > 0, `expected a finite se, got ${r.se}`);
  assert.equal(r.n, 4);
  assert.ok(r.theta > THETA_MIN + 1e-6, 'an informative item must move the estimate off the floor');
});

test('estimate() dispatches to WLE by default and to EAP on request', () => {
  const responses = ITEMS.map((it, i) => ({ ...it, correct: i > 1 }));
  assert.equal(estimate(responses).method, 'wle');
  assert.equal(estimate(responses, {}).method, 'wle');
  assert.equal(estimate(responses, { method: 'wle' }).method, 'wle');
  assert.equal(estimate(responses, { method: 'eap' }).method, 'eap');
  assert.deepEqual(estimate(responses, { method: 'eap' }), estimateEAP(responses));
  assert.deepEqual(estimate(responses, { method: 'wle' }), estimateWLE(responses));
});

test('EAP honours the prior mean and the wide default prior sd', () => {
  const responses = [{ a: 1.2, b: 0, c: 0.1, correct: true }];
  const wide = estimateEAP(responses, { priorSd: 1.4 });
  const tight = estimateEAP(responses, { priorSd: 0.5 });
  assert.ok(wide.theta > tight.theta, 'a tighter prior must shrink harder toward 0');
  assert.ok(wide.se > tight.se, 'a tighter prior must give a smaller posterior sd');

  const shifted = estimateEAP(responses, { priorMean: 2 });
  assert.ok(shifted.theta > wide.theta, 'the prior mean must move the posterior');
  assert.ok(estimateEAP(responses).se > 0, 'posterior sd must be positive');
});

// --- Monte-Carlo ability recovery ------------------------------------------------

function fixedForm(n) {
  const items = [];
  for (let i = 0; i < n; i++) {
    items.push({
      a: 1.6 + 0.6 * ((i % 4) / 3),
      b: -1.8 + (3.6 * i) / (n - 1),
      c: 0.1
    });
  }
  return items;
}

test('recovery: 300 examinees x 40 items, WLE tracks true theta', () => {
  const bank = fixedForm(40);
  const rng = makeRng('irt-recovery-fixed');
  const trues = [];
  const ests = [];
  const ses = [];

  for (let e = 0; e < 300; e++) {
    const theta = Math.max(-2.2, Math.min(2.2, rng.gauss(0, 1)));
    const responses = bank.map((it) => ({ ...it, correct: rng.next() < p3pl(theta, it) }));
    const r = estimateWLE(responses);
    assert.ok(Number.isFinite(r.theta), 'recovery produced a non-finite estimate');
    assert.ok(Number.isFinite(r.se) && r.se > 0, 'recovery produced a bad se');
    assert.equal(r.n, 40);
    trues.push(theta);
    ests.push(r.theta);
    ses.push(r.se);
  }

  const errs = ests.map((v, i) => v - trues[i]);
  const r = pearson(trues, ests);
  // "mean absolute bias" = the magnitude of the mean signed error. The mean absolute
  // ERROR cannot beat 0.15 on a 40-item fixed form: it is floored by the standard error.
  const bias = Math.abs(mean(errs));
  const mae = mean(errs.map(Math.abs));
  const rmse = Math.sqrt(mean(errs.map((x) => x * x)));

  assert.ok(r > 0.95, `recovery correlation too low: ${r}`);
  assert.ok(bias < 0.15, `mean bias too large: ${bias}`);
  assert.ok(mae < 0.22, `mean absolute error too large: ${mae}`);
  assert.ok(rmse < 0.28, `rmse too large: ${rmse}`);
  // The reported SE must be an honest description of the observed error spread.
  assert.ok(Math.abs(mean(ses) - rmse) < 0.08, `se ${mean(ses)} misdescribes rmse ${rmse}`);
});

test('recovery under adaptive administration is tighter still', () => {
  const rng = makeRng('irt-recovery-adaptive');
  const trues = [];
  const ests = [];
  const a = 1.5;
  const c = 0.106;

  for (let e = 0; e < 80; e++) {
    const theta = Math.max(-2.5, Math.min(2.5, rng.gauss(0, 1)));
    const responses = [];
    let hat = 0.3;
    for (let k = 0; k < 40; k++) {
      // Warmup at 0.3, then aim each item's information peak at the running estimate.
      const item = { a, b: bForMaxInfoAt(k < 4 ? 0.3 : hat, a, c), c };
      responses.push({ ...item, correct: rng.next() < p3pl(theta, item) });
      hat = estimateWLE(responses).theta;
    }
    trues.push(theta);
    ests.push(hat);
  }

  const errs = ests.map((v, i) => v - trues[i]);
  assert.ok(pearson(trues, ests) > 0.97, `adaptive correlation too low: ${pearson(trues, ests)}`);
  assert.ok(Math.abs(mean(errs)) < 0.1, `adaptive bias too large: ${mean(errs)}`);
  assert.ok(mean(errs.map(Math.abs)) < 0.15, `adaptive MAE too large: ${mean(errs.map(Math.abs))}`);
});

test('estimates separate high ability from low ability (AUC at theta = 2)', () => {
  const bank = fixedForm(40);
  const rng = makeRng('irt-separation');
  const labels = [];
  const scores = [];
  for (let e = 0; e < 400; e++) {
    const theta = rng.bool(0.5) ? rng.gauss(2.6, 0.4) : rng.gauss(0.4, 0.8);
    const responses = bank.map((it) => ({ ...it, correct: rng.next() < p3pl(theta, it) }));
    labels.push(theta >= 2 ? 1 : 0);
    scores.push(estimateWLE(responses).theta);
  }
  const area = auc(labels, scores);
  assert.ok(area > 0.95, `elite separation AUC too low: ${area}`);
});

test('WLE shrinks LESS than EAP at theta = 3 (the reason WLE is the default)', () => {
  const bank = [];
  for (let i = 0; i < 40; i++) bank.push({ a: 1.4, b: 1.0 + (2.5 * i) / 39, c: 0.1 });

  const rng = makeRng('irt-elite-shrinkage');
  const wles = [];
  const eaps = [];
  let wleAbove = 0;

  for (let e = 0; e < 60; e++) {
    const responses = bank.map((it) => ({ ...it, correct: rng.next() < p3pl(3, it) }));
    const w = estimateWLE(responses).theta;
    const p = estimateEAP(responses).theta;
    wles.push(w);
    eaps.push(p);
    if (w > p) wleAbove++;
  }

  const mw = mean(wles);
  const me = mean(eaps);
  assert.ok(mw > me, `WLE (${mw}) should sit above EAP (${me}) at theta = 3`);
  assert.ok(Math.abs(mw - 3) < Math.abs(me - 3), `WLE ${mw} should be closer to 3 than EAP ${me}`);
  assert.ok(wleAbove >= 57, `WLE beat EAP in only ${wleAbove}/60 replications`);
  // Both must still be sane elite estimates, not runaway values.
  assert.ok(mw > 2.5 && mw < 3.5, `WLE mean out of range: ${mw}`);
});

test('shrinkage is a prior effect: a wider EAP prior pulls elite scores down less', () => {
  const bank = [];
  for (let i = 0; i < 30; i++) bank.push({ a: 1.4, b: 1.0 + (2.5 * i) / 29, c: 0.1 });
  const rng = makeRng('irt-prior-width');
  const responses = bank.map((it) => ({ ...it, correct: rng.next() < p3pl(3, it) }));
  const narrow = estimateEAP(responses, { priorSd: 1.0 }).theta;
  const wide = estimateEAP(responses, { priorSd: 1.4 }).theta;
  const wider = estimateEAP(responses, { priorSd: 2.5 }).theta;
  assert.ok(narrow < wide, 'a narrower prior must shrink more');
  assert.ok(wide < wider, 'a wider prior must shrink less');
});
