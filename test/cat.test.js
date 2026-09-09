/**
 * Tests for the adaptive test engine. Most cases inject a fake item source through
 * `opts.itemSource` to isolate the CAT logic (selection, balancing, estimation, the
 * index-100 cut); the last one drives a whole session through the real registry.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createSession, CAT_DEFAULTS } from '../src/core/cat.js';
import { makeRng } from '../src/core/rng.js';
import { p3pl, bForMaxInfoAt } from '../src/core/irt.js';
import { confidenceInterval, thetaToIndex } from '../src/core/scale.js';
import { auditItem } from '../src/items/registry.js';

// --- mock item bank ---------------------------------------------------------------

const MOCK_FAMILIES = [
  { family: 'mockMatrix', contentGroup: 'induction' },
  { family: 'mockSeries', contentGroup: 'induction' },
  { family: 'mockRotation', contentGroup: 'spatial' },
  { family: 'mockFold', contentGroup: 'spatial' },
  { family: 'mockAnalogy', contentGroup: 'relational' },
  { family: 'mockGrid', contentGroup: 'constraint' }
];

const RULE_POOL = [
  'progression', 'rotation', 'distributionOfThree', 'reflection', 'containment', 'overlayUnion'
];

/** A fake `generateItemAtDifficulty`: deterministic, culture-free, no SVG worth drawing. */
function mockItemSource(rng, spec) {
  const catalogue = MOCK_FAMILIES.map((f) => f.family);
  const pool = Array.isArray(spec.families) && spec.families.length ? spec.families : catalogue;
  const family = rng.pick(pool);
  const optionCount = Math.max(2, Math.round(Number(spec.optionCount) || 8));
  const targetB = Number.isFinite(spec.targetB) ? spec.targetB : 0;

  const b = Math.max(-3.5, Math.min(6, targetB + rng.gauss(0, 0.18)));
  const a = 0.9 + rng.next() * 0.8;
  const c = 0.85 / optionCount;
  const seed = rng.int(0, 1000000);
  const ruleCount = 1 + rng.int(0, 4);
  const ruleTypes = rng.sample(RULE_POOL, ruleCount);
  const answerIndex = rng.int(0, optionCount);

  const options = [];
  for (let i = 0; i < optionCount; i++) {
    options.push({ id: `o${i}`, svg: '<svg></svg>', width: 100, height: 100 });
  }

  return {
    id: `${family}:${seed}:0`,
    family,
    seed,
    prompt: { svg: '<svg></svg>', width: 300, height: 300 },
    options,
    answerId: `o${answerIndex}`,
    meta: {
      ruleCount,
      ruleTypes,
      abstractness: 1 + ruleCount * 0.4,
      elementCount: 9,
      distractorSystematicity: 0.8,
      wmLoad: Math.min(6, ruleCount + 1),
      perceptualSalience: 0.2,
      optionCount,
      generatorVersion: 1
    },
    irt: { a, b, c }
  };
}

function wrongOption(item, rng) {
  const others = item.options.filter((o) => o.id !== item.answerId);
  return others.length ? rng.pick(others).id : null;
}

function newSession(seed, overrides) {
  return createSession({
    seed: `cat:${seed}`,
    itemSource: mockItemSource,
    familyCatalog: MOCK_FAMILIES,
    ...overrides
  });
}

/** Run one whole session against a simulated examinee of known ability. */
function simulate(trueTheta, seed, overrides) {
  const rng = makeRng(`sim:${trueTheta}:${seed}`);
  const session = newSession(seed, overrides);
  let item;
  let guard = 0;
  while ((item = session.nextItem()) !== null) {
    if (++guard > 1000) throw new Error('runaway session');
    const correct = rng.next() < p3pl(trueTheta, item.irt);
    const chosen = correct ? item.answerId : wrongOption(item, rng);
    session.submit(chosen, 1500 + rng.int(0, 6000));
  }
  return { session, result: session.result(), state: session.state };
}

function countBy(list, pick) {
  const out = new Map();
  for (const entry of list) out.set(pick(entry), (out.get(pick(entry)) || 0) + 1);
  return out;
}

/**
 * Re-derive the stopping rule from the recorded history and check the session obeyed it
 * at every single step: it may not stop early, and it may not run on once both the
 * precision target and a cut-clearing interval are in hand.
 */
function assertStoppingRuleObeyed(session, opts) {
  const cfg = { ...CAT_DEFAULTS, ...(opts || {}) };
  const history = session.state.history;
  for (let k = 0; k < history.length; k++) {
    const n = k + 1;
    const se = history[k].seAfter === null ? Infinity : history[k].seAfter;
    const ci = confidenceInterval(history[k].thetaAfter, se, cfg.ciLevel);
    const excludesCut = ci.lo > cfg.cutIndex || ci.hi < cfg.cutIndex;
    const precise = n >= cfg.minItems && se <= cfg.targetSE;
    const mustStop = (precise && excludesCut) || n >= cfg.maxItems;
    const didStop = n === history.length;
    assert.equal(
      didStop,
      mustStop,
      `after item ${n}/${history.length}: se=${se}, ci=[${ci.lo}, ${ci.hi}], `
        + `precise=${precise}, excludesCut=${excludesCut}`
    );
  }
}

// --- session lifecycle ------------------------------------------------------------

test('a session administers between minItems and maxItems and then closes', () => {
  for (const trueTheta of [-2, -0.4, 0.9, 2.5, 4.2]) {
    for (let seed = 0; seed < 8; seed++) {
      const { session, result, state } = simulate(trueTheta, `${trueTheta}:${seed}`);
      assert.ok(
        result.itemsUsed >= CAT_DEFAULTS.minItems && result.itemsUsed <= CAT_DEFAULTS.maxItems,
        `itemsUsed ${result.itemsUsed} outside [${CAT_DEFAULTS.minItems}, ${CAT_DEFAULTS.maxItems}]`
      );
      assert.equal(state.n, result.itemsUsed);
      assert.equal(state.done, true);
      assert.equal(session.nextItem(), null);
      assert.ok(['precision', 'decisive', 'maxItems'].includes(result.finishedReason));
      // Nothing further may be submitted once the session is closed.
      assert.throws(() => session.submit('o0', 100), /no item is pending/);
      assert.throws(() => session.skip(), /no item is pending/);
    }
  }
});

test('nextItem is idempotent until the pending item is answered', () => {
  const session = newSession('idempotent');
  const first = session.nextItem();
  assert.equal(session.nextItem(), first);
  assert.equal(session.state.n, 0);
  session.submit(first.answerId, 1200);
  assert.equal(session.state.n, 1);
  const second = session.nextItem();
  assert.notEqual(second.id, first.id);
});

test('submit reports the graded outcome and skip counts as an error', () => {
  const session = newSession('grading');
  const item = session.nextItem();
  const out = session.submit(item.answerId, 2500);
  assert.equal(out.correct, true);
  assert.equal(out.done, false);
  assert.equal(out.index, thetaToIndex(out.theta));
  assert.ok(Number.isFinite(out.theta));

  const second = session.nextItem();
  const wrong = session.submit(wrongOption(second, makeRng('x')), 900);
  assert.equal(wrong.correct, false);

  session.nextItem();
  const skipped = session.skip();
  assert.equal(skipped.correct, false);
  const history = session.state.history;
  assert.equal(history.length, 3);
  assert.equal(history[2].skipped, true);
  assert.equal(history[2].rtMs, null);
  assert.equal(history[0].skipped, false);
  // An unknown option id is simply wrong, never a crash.
  session.nextItem();
  assert.equal(session.submit('not-an-option', 500).correct, false);
  session.nextItem();
  assert.equal(session.submit(null, NaN).correct, false);
});

test('sessions are deterministic in the seed and differ across seeds', () => {
  const runA = simulate(1.2, 'determinism');
  const runB = simulate(1.2, 'determinism');
  assert.deepEqual(runA.session.serialize(), runB.session.serialize());

  const runC = simulate(1.2, 'determinism-other');
  const idsA = runA.session.serialize().responses.map((r) => r.itemId);
  const idsC = runC.session.serialize().responses.map((r) => r.itemId);
  assert.notDeepEqual(idsA, idsC);
});

// --- warmup and selection ---------------------------------------------------------

test('the warmup targets theta 0.3, then selection tracks the running estimate', () => {
  const { session } = simulate(2.4, 'warmup');
  const history = session.state.history;
  const warmupTarget = bForMaxInfoAt(0.3, 1.2, 0.85 / CAT_DEFAULTS.optionCount);

  for (let i = 0; i < CAT_DEFAULTS.warmup; i++) {
    assert.equal(history[i].atTheta, 0.3);
    assert.ok(Math.abs(history[i].targetB - warmupTarget) < 1e-12);
  }
  for (let i = CAT_DEFAULTS.warmup; i < history.length; i++) {
    assert.equal(history[i].atTheta, history[i - 1].thetaAfter);
  }
  // A high-ability examinee must be driven to hard items.
  const lateB = history.slice(-6).reduce((acc, r) => acc + r.params.b, 0) / 6;
  assert.ok(lateB > 1.4, `late items should be hard for theta 2.4, mean b = ${lateB}`);
});

test('administered difficulty tracks ability across the range', () => {
  const easy = simulate(-1.8, 'tracking-low').session.state.history;
  const hard = simulate(3.6, 'tracking-high').session.state.history;
  const meanLate = (h) => h.slice(-8).reduce((acc, r) => acc + r.params.b, 0) / 8;
  assert.ok(meanLate(easy) < -0.8, `low ability mean b = ${meanLate(easy)}`);
  assert.ok(meanLate(hard) > 2.4, `high ability mean b = ${meanLate(hard)}`);
  assert.ok(meanLate(hard) - meanLate(easy) > 3);
});

// --- accuracy -------------------------------------------------------------------

test('theta is recovered with small bias and RMSE across the reportable range', () => {
  const trueThetas = [-1.5, -0.5, 0.5, 2, 3.5, 5];
  const sessions = 200;

  for (const trueTheta of trueThetas) {
    let sumError = 0;
    let sumSq = 0;
    let sumSe = 0;
    for (let seed = 0; seed < sessions; seed++) {
      const { result } = simulate(trueTheta, `recovery:${trueTheta}:${seed}`);
      const error = result.theta - trueTheta;
      sumError += error;
      sumSq += error * error;
      sumSe += result.se;
    }
    const bias = sumError / sessions;
    const rmse = Math.sqrt(sumSq / sessions);
    const meanSe = sumSe / sessions;

    assert.ok(Math.abs(bias) < 0.25, `theta ${trueTheta}: bias ${bias.toFixed(4)}`);
    assert.ok(rmse < 0.45, `theta ${trueTheta}: RMSE ${rmse.toFixed(4)}`);
    // The reported SE must not be a fantasy: it should be in the neighbourhood of the
    // observed spread rather than wildly optimistic.
    assert.ok(meanSe < rmse + 0.15, `theta ${trueTheta}: meanSe ${meanSe} vs RMSE ${rmse}`);
  }
});

// --- the index-100 cut ------------------------------------------------------------

test('a session never stops while its interval still contains the cut', () => {
  const thetas = [-0.4, -0.2, -0.05, 0, 0.05, 0.2, 0.4, 1.5];
  let atMaxItems = 0;
  let total = 0;

  for (const trueTheta of thetas) {
    for (let seed = 0; seed < 25; seed++) {
      const { session, result } = simulate(trueTheta, `cut:${trueTheta}:${seed}`);
      total += 1;
      const ci = confidenceInterval(result.theta, result.se, CAT_DEFAULTS.ciLevel);
      const containsCut = ci.lo <= 100 && ci.hi >= 100;

      if (result.itemsUsed < CAT_DEFAULTS.maxItems) {
        assert.ok(
          !containsCut,
          `stopped at ${result.itemsUsed} items with CI [${ci.lo}, ${ci.hi}] straddling 100`
        );
        assert.ok(result.se <= CAT_DEFAULTS.targetSE + 1e-12);
        assert.ok(['precision', 'decisive'].includes(result.finishedReason));
      } else {
        assert.equal(result.finishedReason, 'maxItems');
        atMaxItems += 1;
      }
      assert.deepEqual(result.ci, ci);
      assertStoppingRuleObeyed(session);
    }
  }
  // Borderline examinees must actually be pushed to the item limit; if none were, the
  // rule under test would be vacuous.
  assert.ok(atMaxItems > 0.15 * total, `only ${atMaxItems}/${total} borderline sessions used every item`);
});

test('precision alone does not stop a session whose interval covers the cut', () => {
  let continuedPastPrecision = 0;
  const total = 40;

  for (let seed = 0; seed < total; seed++) {
    // Ability sits on (or beside) the cut, so precision arrives long before certainty.
    const trueTheta = seed % 2 === 0 ? 0 : 0.1;
    const { session, result } = simulate(trueTheta, `oncut:${seed}`);
    const snapshot = session.serialize();

    assertStoppingRuleObeyed(session);
    assert.ok(
      snapshot.precisionMetAt !== null,
      'targetSE should be reachable within the item budget for a mid-range examinee'
    );

    if (snapshot.precisionMetAt < result.itemsUsed) {
      continuedPastPrecision += 1;
      // Every extra item after precision was spent resolving the cut, so the session can
      // never be reported as a plain precision stop.
      assert.notEqual(result.finishedReason, 'precision');
      const atPrecision = session.state.history[snapshot.precisionMetAt - 1];
      const ci = confidenceInterval(atPrecision.thetaAfter, atPrecision.seAfter, CAT_DEFAULTS.ciLevel);
      assert.ok(
        ci.lo <= 100 && ci.hi >= 100,
        `kept testing at item ${snapshot.precisionMetAt} although CI [${ci.lo}, ${ci.hi}] cleared the cut`
      );
    } else {
      assert.equal(result.finishedReason, 'precision');
    }
  }

  assert.ok(
    continuedPastPrecision > total / 2,
    `only ${continuedPastPrecision}/${total} on-the-cut sessions were extended past targetSE`
  );
});

test('elimination is exactly "reported index below 100"', () => {
  let eliminated = 0;
  let qualified = 0;
  for (const trueTheta of [-2.5, -1.2, -0.3, 0, 0.3, 1.1, 3]) {
    for (let seed = 0; seed < 12; seed++) {
      const { result } = simulate(trueTheta, `elim:${trueTheta}:${seed}`);
      assert.equal(result.eliminated, result.index < 100);
      assert.equal(result.index, thetaToIndex(result.theta));
      if (result.eliminated) eliminated += 1;
      else qualified += 1;
      if (trueTheta <= -1.2) assert.equal(result.eliminated, true);
      if (trueTheta >= 1.1) assert.equal(result.eliminated, false);
    }
  }
  assert.ok(eliminated > 0 && qualified > 0);
});

// --- content balance --------------------------------------------------------------

test('content-group and family caps hold for every completed session', () => {
  for (const trueTheta of [-1.5, 0, 1, 2.5, 4]) {
    for (let seed = 0; seed < 20; seed++) {
      const { session, result } = simulate(trueTheta, `balance:${trueTheta}:${seed}`);
      const history = session.state.history;
      assert.equal(history.length, result.itemsUsed);

      const relaxations = history.filter((r) => r.relaxed !== null);
      assert.equal(relaxations.length, 0, 'a balanced catalogue should never need relaxing');

      const n = history.length;
      for (const [family, count] of countBy(history, (r) => r.family)) {
        assert.ok(count <= 0.25 * n + 1e-9, `family ${family}: ${count}/${n}`);
      }
      for (const [group, count] of countBy(history, (r) => r.contentGroup)) {
        assert.ok(count <= 0.40 * n + 1e-9, `group ${group}: ${count}/${n}`);
      }
      // Every administered family must belong to the catalogue.
      for (const record of history) {
        assert.ok(MOCK_FAMILIES.some((f) => f.family === record.family));
        assert.equal(
          record.contentGroup,
          MOCK_FAMILIES.find((f) => f.family === record.family).contentGroup
        );
      }
    }
  }
});

test('an impossible cap is relaxed - family first, then group - and recorded', () => {
  const single = [{ family: 'onlyFamily', contentGroup: 'induction' }];
  const { session, result } = simulate(1.0, 'relax', { familyCatalog: single });
  const history = session.state.history;

  assert.equal(result.itemsUsed >= CAT_DEFAULTS.minItems, true);
  assert.ok(history.every((r) => r.family === 'onlyFamily'));

  const relaxations = history.map((r) => r.relaxed);
  assert.ok(relaxations.includes('family'), 'the family cap must be relaxed first');
  assert.ok(relaxations.includes('group'), 'the group cap must be relaxed once family is not enough');
  // The first items fit inside the caps, so they must not be marked as relaxed.
  assert.equal(relaxations[0], null);
  const firstFamilyRelax = relaxations.indexOf('family');
  const firstGroupRelax = relaxations.indexOf('group');
  assert.ok(firstFamilyRelax < firstGroupRelax, 'family relaxation must come before group');
});

test('an explicit family whitelist is respected', () => {
  const { session } = simulate(0.8, 'whitelist', {
    families: ['mockMatrix', 'mockRotation', 'mockGrid']
  });
  const families = new Set(session.state.history.map((r) => r.family));
  for (const family of families) {
    assert.ok(['mockMatrix', 'mockRotation', 'mockGrid'].includes(family), family);
  }
  assert.ok(families.size >= 2);
});

test('a whitelist survives an empty catalogue and every fallback path', () => {
  // The catalogue knows nothing about these families, so content balancing has no opinion.
  // The whitelist is still a caller instruction and must reach the generator regardless.
  const seen = [];
  const spy = (rng, spec) => {
    seen.push(spec.families);
    return mockItemSource(rng, spec);
  };
  const blind = createSession({
    seed: 'cat:whitelist-blind',
    itemSource: spy,
    familyCatalog: [],
    families: ['mockGrid']
  });
  const rng = makeRng('cat:whitelist-blind:responses');
  let item;
  while ((item = blind.nextItem()) !== null) {
    session_submit(blind, item, rng);
  }
  assert.ok(seen.length > 0);
  for (const families of seen) {
    assert.deepEqual(families, ['mockGrid'], 'the whitelist must never be widened away');
  }
  assert.ok(blind.state.history.every((r) => r.family === 'mockGrid'));

  // Same guarantee on the "nothing usable came back" retry path: the engine may drop its
  // own caps to keep the session alive, but it may not reach outside the whitelist.
  const dead = createSession({
    seed: 'cat:whitelist-dead',
    itemSource: () => null,
    familyCatalog: MOCK_FAMILIES,
    families: ['mockMatrix']
  });
  assert.throws(() => dead.nextItem(), /no usable item/);
});

function session_submit(session, item, rng) {
  const correct = rng.next() < p3pl(1.0, item.irt);
  session.submit(correct ? item.answerId : wrongOption(item, rng), 2000);
}

// --- reporting --------------------------------------------------------------------

test('result() reports the full contract payload', () => {
  const { result, session } = simulate(1.8, 'report');

  assert.equal(typeof result.index, 'number');
  assert.ok(result.ci.lo <= result.index && result.index <= result.ci.hi);
  assert.ok(result.reliability >= 0 && result.reliability <= 1);
  assert.equal(result.itemsUsed, session.state.n);
  assert.ok(result.medianRtMs > 0);

  let familyTotal = 0;
  for (const [family, stats] of Object.entries(result.byFamily)) {
    assert.ok(stats.n > 0, family);
    assert.ok(stats.pctCorrect >= 0 && stats.pctCorrect <= 1);
    assert.ok(Number.isFinite(stats.meanB));
    familyTotal += stats.n;
  }
  assert.equal(familyTotal, result.itemsUsed);

  let groupTotal = 0;
  for (const stats of Object.values(result.byContentGroup)) groupTotal += stats.n;
  assert.equal(groupTotal, result.itemsUsed);

  const curve = result.informationCurve;
  assert.equal(curve.length, 37);
  assert.equal(curve[0].theta, -3);
  assert.equal(curve[curve.length - 1].theta, 6);
  assert.ok(Math.abs(curve[1].theta - curve[0].theta - 0.25) < 1e-12);
  for (const point of curve) {
    assert.ok(Number.isFinite(point.info) && point.info >= 0);
    assert.ok(point.se === null || (Number.isFinite(point.se) && point.se > 0));
  }
  // Information must peak near where the test actually measured this examinee.
  const peak = curve.reduce((best, p) => (p.info > best.info ? p : best), curve[0]);
  assert.ok(Math.abs(peak.theta - result.theta) < 1.2, `peak ${peak.theta} vs theta ${result.theta}`);
});

test('a fresh session reports honestly before any item is answered', () => {
  const session = newSession('fresh');
  const state = session.state;
  assert.equal(state.n, 0);
  assert.equal(state.theta, 0);
  assert.equal(state.se, Infinity);
  assert.equal(state.done, false);
  assert.equal(state.reason, null);

  const result = session.result();
  assert.equal(result.itemsUsed, 0);
  assert.equal(result.index, 100);
  assert.equal(result.eliminated, false);
  assert.equal(result.reliability, 0);
  assert.equal(result.finishedReason, null);
  assert.equal(result.medianRtMs, 0);
  // With no evidence the interval is the whole scale - never a fake-narrow one.
  assert.ok(result.ci.lo <= 100 && result.ci.hi >= 100);
  assert.deepEqual(result.byFamily, {});
  assert.equal(result.informationCurve.length, 37);
  assert.throws(() => session.submit('o0', 10), /no item is pending/);
});

test('serialize() is plain, JSON-safe and free of stimulus blobs', () => {
  const { session, result } = simulate(2.2, 'serialize');
  const snapshot = session.serialize();
  const json = JSON.stringify(snapshot);

  assert.ok(!json.includes('<svg'), 'serialised state must not carry SVG');
  assert.ok(!json.includes('svg'), 'serialised state must not carry any svg field');
  assert.deepEqual(JSON.parse(json), snapshot, 'every value must survive a JSON round trip');

  assert.equal(snapshot.version, 1);
  assert.equal(snapshot.done, true);
  assert.equal(snapshot.n, result.itemsUsed);
  assert.equal(snapshot.responses.length, result.itemsUsed);
  assert.equal(snapshot.pendingItemId, null);
  assert.deepEqual(snapshot.config, {
    minItems: CAT_DEFAULTS.minItems,
    maxItems: CAT_DEFAULTS.maxItems,
    targetSE: CAT_DEFAULTS.targetSE,
    optionCount: CAT_DEFAULTS.optionCount,
    cutIndex: CAT_DEFAULTS.cutIndex,
    ciLevel: CAT_DEFAULTS.ciLevel,
    warmup: CAT_DEFAULTS.warmup
  });

  for (const response of snapshot.responses) {
    assert.equal(typeof response.itemId, 'string');
    assert.equal(typeof response.itemKey, 'string');
    const seedPart = response.itemId.split(':')[1];
    // The structural key must not carry the seed, or statistics could never pool.
    if (seedPart.length >= 3) assert.ok(!response.itemKey.includes(seedPart), response.itemKey);
    assert.equal(typeof response.family, 'string');
    assert.equal(typeof response.correct, 'boolean');
    assert.ok(Number.isFinite(response.irt.a) && Number.isFinite(response.irt.b));
    assert.ok(Number.isFinite(response.params.b));
    assert.ok(response.rtMs === null || Number.isFinite(response.rtMs));
    assert.equal(response.options, undefined);
    assert.equal(response.prompt, undefined);
  }

  // A half-finished session serialises too, pending item included.
  const live = newSession('serialize-live');
  const item = live.nextItem();
  const partial = live.serialize();
  assert.equal(partial.pendingItemId, item.id);
  assert.equal(partial.done, false);
  assert.equal(partial.se, null, 'a non-finite SE must serialise as null, not Infinity');
  assert.deepEqual(JSON.parse(JSON.stringify(partial)), partial);
});

// --- configuration ----------------------------------------------------------------

test('overridden stopping parameters are honoured', () => {
  const { result } = simulate(2.0, 'short', { minItems: 6, maxItems: 10, targetSE: 0.9 });
  assert.ok(result.itemsUsed >= 6 && result.itemsUsed <= 10);

  const { result: long } = simulate(2.0, 'long', { minItems: 25, maxItems: 30, targetSE: 0.01 });
  assert.equal(long.itemsUsed, 30);
  assert.equal(long.finishedReason, 'maxItems');

  // A shifted cut moves the elimination decision with it.
  const { result: highCut } = simulate(2.0, 'cut', { cutIndex: 160 });
  assert.equal(highCut.eliminated, highCut.index < 160);
});

test('the bank shifts the parameters used for estimation', () => {
  const plain = simulate(1.0, 'bank-none');
  const keys = plain.session.serialize().responses.map((r) => r.itemKey);
  const bank = {};
  for (const key of keys) bank[key] = { n: 40, b: 4.5, sumInfo: 400 };

  const banked = simulate(1.0, 'bank-none', { bank });
  const bankedRecords = banked.session.serialize().responses;
  const shifted = bankedRecords.filter((r) => Math.abs(r.params.b - r.irt.b) > 0.5);
  assert.ok(shifted.length > 0, 'blended parameters should differ once the bank has data');
  // Items believed much harder than they look push the ability estimate up.
  assert.ok(banked.result.theta > plain.result.theta);
});

// --- integration with the real generators -----------------------------------------

/**
 * Everything above runs on a fake item source. This one uses the DEFAULT source -
 * `registry.generateItemAtDifficulty` with the real generator families - so that a break
 * at the seam between the CAT and the item bank cannot hide behind the mock. `maxItems`
 * is trimmed only to keep the suite quick; the stopping rule itself is untouched.
 */
test('a session runs end to end on the real item registry', () => {
  const session = createSession({ rng: makeRng('cat:real:1'), maxItems: 20 });
  const responder = makeRng('cat:real:responses');
  const administered = [];

  let item;
  let guard = 0;
  while ((item = session.nextItem()) !== null) {
    if (++guard > 100) throw new Error('runaway session');
    administered.push(item);

    // Real items must arrive fit to administer: audited clean, IRT filled, 6 or 8 options.
    const audit = auditItem(item);
    assert.ok(
      audit.ok,
      `${item.family} failed the registry audit: ${(audit.problems || []).join('; ')}`
    );
    assert.ok(item.irt && Number.isFinite(item.irt.a) && Number.isFinite(item.irt.b)
      && Number.isFinite(item.irt.c), `${item.family} arrived without usable irt params`);
    assert.equal(item.options.length, CAT_DEFAULTS.optionCount);
    assert.ok(item.options.some((o) => o.id === item.answerId));

    const correct = responder.next() < p3pl(1.5, item.irt);
    session.submit(correct ? item.answerId : wrongOption(item, responder), 4000);
  }

  // No two administered items may be the same item.
  assert.equal(new Set(administered.map((it) => it.id)).size, administered.length);

  const result = session.result();
  assert.equal(result.itemsUsed, administered.length);
  assert.ok(result.itemsUsed >= CAT_DEFAULTS.minItems && result.itemsUsed <= 20);
  assert.ok(Number.isFinite(result.theta) && Number.isFinite(result.se));
  assert.ok(Number.isFinite(result.index));
  assert.ok(result.ci.lo <= result.index && result.index <= result.ci.hi);
  assert.ok(['precision', 'decisive', 'maxItems'].includes(result.finishedReason));
  assert.equal(result.informationCurve.length, 37);

  // The contract's content caps must hold against the REAL family catalogue too.
  for (const stat of Object.values(result.byFamily)) {
    assert.ok(stat.n <= 0.25 * result.itemsUsed, 'a real family exceeded the 25% cap');
  }
  for (const stat of Object.values(result.byContentGroup)) {
    assert.ok(stat.n <= 0.40 * result.itemsUsed, 'a real content group exceeded the 40% cap');
  }
  // ...and they must hold without the engine having to relax anything.
  const relaxed = session.serialize().responses.filter((r) => r.relaxed !== null);
  assert.equal(relaxed.length, 0, 'the real registry should satisfy both caps unaided');

  // Every administered family is one the registry actually advertises.
  for (const key of Object.keys(result.byFamily)) {
    assert.notEqual(key, 'unknown');
  }
});
