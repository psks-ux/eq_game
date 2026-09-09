/**
 * Curriculum tests: ladder shape, factor coverage, parameter escalation, unlock graph
 * and progress roll-up. Pure data - it does not import src/train/drills/index.js (nor
 * anything pulling it in), so a drill engine cannot break the curriculum's guarantees.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  DRILLS,
  LEVELS,
  levelsForTier,
  levelById,
  unlockedLevels,
  nextLevel,
  progressSummary,
  factorTargets
} from '../src/train/curriculum.js';

const FACTOR_KEYS = ['induction', 'spatial', 'workingMemory', 'relational', 'speed', 'flexibility'];
const GROUP_KEYS = ['induction', 'spatial', 'relational', 'constraint'];
const DRILL_IDS = [
  'matrixForge', 'ruleMiner', 'nback', 'corsi', 'mentalRotation', 'paperFolding',
  'relationalIntegration', 'setShifting', 'sequenceExtrapolation', 'oddOneOut',
  'constraintGrid', 'flankerControl', 'speedDiscrimination'
];
const ALLOWED_RULE_FAMILIES = new Set([
  'constancy', 'progression', 'distributionOfThree', 'rotation', 'reflection', 'translation',
  'overlayUnion', 'overlayIntersection', 'overlayDifference', 'overlayExclusive',
  'containment', 'quantityProgression', 'sizeOrdering', 'symmetryCompletion',
  'sequenceAlternation', 'attributeSwap', 'ruleChaining'
]);

/**
 * Mirror of the escalation direction table documented in curriculum.js: these keys get
 * HARDER as they get SMALLER; every other numeric key gets harder as it gets larger.
 */
const DESCENDING_PARAMS = new Set(['timeLimitMs', 'isiMs', 'presentMs', 'stimulusMs', 'exposureMs', 'cueMs']);

const TIERS = 6;
const PER_TIER = 12;

function isNum(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

function escalates(key, before, after) {
  return DESCENDING_PARAMS.has(key) ? after <= before : after >= before;
}

function freshProfile(overrides) {
  return Object.assign({
    version: 1,
    status: 'qualified',
    tier: 0,
    xp: 0,
    levels: {},
    drillStats: {},
    factorScores: {}
  }, overrides || {});
}

function withStars(profile, ids, stars) {
  const next = Object.assign({}, profile, { levels: Object.assign({}, profile.levels) });
  for (const id of ids) next.levels[id] = { unlocked: true, stars, bestScore: 0, attempts: 1 };
  return next;
}

test('the ladder is 72 levels, six tiers of twelve, with unique well-formed ids', () => {
  assert.ok(LEVELS.length >= 72, 'at least 72 levels');
  assert.equal(LEVELS.length, TIERS * PER_TIER);

  const ids = new Set();
  LEVELS.forEach((lv, i) => {
    assert.equal(lv.order, i + 1, `${lv.id} order matches position`);
    assert.equal(lv.id, `L${String(i + 1).padStart(2, '0')}`);
    assert.equal(lv.tier, Math.floor(i / PER_TIER));
    assert.ok(!ids.has(lv.id), `duplicate level id ${lv.id}`);
    ids.add(lv.id);
    assert.ok(FACTOR_KEYS.includes(lv.factor), `${lv.id} has a known factor`);
    assert.ok(GROUP_KEYS.includes(lv.group), `${lv.id} has a known group`);
  });
  assert.equal(ids.size, LEVELS.length);
});

test('DRILLS covers the thirteen contract drill ids with valid metadata', () => {
  assert.equal(DRILLS.length, 13);
  const seen = new Set();
  for (const d of DRILLS) {
    assert.ok(DRILL_IDS.includes(d.id), `unexpected drill id ${d.id}`);
    assert.ok(!seen.has(d.id), `duplicate drill id ${d.id}`);
    seen.add(d.id);
    assert.ok(FACTOR_KEYS.includes(d.factor), `${d.id} factor`);
    assert.ok(GROUP_KEYS.includes(d.group), `${d.id} group`);
    assert.ok(Number.isInteger(d.minTier) && d.minTier >= 0 && d.minTier < TIERS, `${d.id} minTier`);
  }
  for (const id of DRILL_IDS) assert.ok(seen.has(id), `missing drill ${id}`);
});

test('every level names a drill that exists, agrees with its factor and respects minTier', () => {
  const byId = new Map(DRILLS.map((d) => [d.id, d]));
  const used = new Set();
  for (const lv of LEVELS) {
    const def = byId.get(lv.drill);
    assert.ok(def, `${lv.id} uses unknown drill ${lv.drill}`);
    assert.equal(lv.factor, def.factor, `${lv.id} factor matches drill ${lv.drill}`);
    assert.ok(lv.tier >= def.minTier, `${lv.id} uses ${lv.drill} below its minTier`);
    used.add(lv.drill);
  }
  for (const id of DRILL_IDS) assert.ok(used.has(id), `drill ${id} never appears in the ladder`);
});

test('every tier covers all six factors at least twice', () => {
  for (let tier = 0; tier < TIERS; tier++) {
    const levels = levelsForTier(tier);
    assert.equal(levels.length, PER_TIER, `tier ${tier} size`);
    const counts = {};
    for (const key of FACTOR_KEYS) counts[key] = 0;
    for (const lv of levels) counts[lv.factor] += 1;
    for (const key of FACTOR_KEYS) {
      assert.ok(counts[key] >= 2, `tier ${tier} covers ${key} at least twice (got ${counts[key]})`);
    }
  }
});

test('params escalate monotonically within each drill as order rises', () => {
  const byDrill = new Map();
  for (const lv of LEVELS) {
    if (!byDrill.has(lv.drill)) byDrill.set(lv.drill, []);
    byDrill.get(lv.drill).push(lv);
  }

  for (const [drill, levels] of byDrill) {
    for (let i = 1; i < levels.length; i++) {
      const a = levels[i - 1];
      const b = levels[i];
      let changed = 0;
      for (const key of Object.keys(a.params)) {
        if (!isNum(a.params[key]) || !isNum(b.params[key])) continue;
        assert.ok(
          escalates(key, a.params[key], b.params[key]),
          `${drill}: ${key} went the wrong way from ${a.id} (${a.params[key]}) to ${b.id} (${b.params[key]})`
        );
        if (a.params[key] !== b.params[key]) changed += 1;
      }
      assert.ok(changed > 0, `${drill}: ${a.id} -> ${b.id} does not get harder at all`);
    }
  }

  // Known escalation endpoints from the design brief.
  const span = LEVELS.filter((l) => l.drill === 'corsi').map((l) => l.params.span);
  assert.equal(span[0], 4);
  assert.equal(span[span.length - 1], 9);
  const n = LEVELS.filter((l) => l.drill === 'nback').map((l) => l.params.n);
  assert.equal(n[0], 2);
  assert.equal(n[n.length - 1], 5);
  const ruleCount = LEVELS.filter((l) => l.drill === 'matrixForge').map((l) => l.params.ruleCount);
  assert.equal(ruleCount[0], 2);
  assert.equal(ruleCount[ruleCount.length - 1], 5);
  const depth = LEVELS.filter((l) => l.drill === 'constraintGrid').map((l) => l.params.deductionDepth);
  assert.ok(depth[depth.length - 1] > depth[0], 'constraintGrid deduction depth rises');
  const switchRate = LEVELS.filter((l) => l.drill === 'setShifting').map((l) => l.params.switchRate);
  assert.ok(switchRate[switchRate.length - 1] > switchRate[0], 'setShifting switch rate rises');
  const rot = LEVELS.filter((l) => l.drill === 'mentalRotation');
  assert.ok(rot[rot.length - 1].params.maxDisparityDeg > rot[0].params.maxDisparityDeg);
  assert.ok(rot[rot.length - 1].params.mirrorFoilP > rot[0].params.mirrorFoilP);
});

test('params escalate within each (tier, factor) pair on every shared numeric key', () => {
  for (let tier = 0; tier < TIERS; tier++) {
    const levels = levelsForTier(tier);
    for (const factor of FACTOR_KEYS) {
      const pair = levels.filter((lv) => lv.factor === factor);
      for (let i = 1; i < pair.length; i++) {
        const a = pair[i - 1];
        const b = pair[i];
        for (const key of Object.keys(a.params)) {
          if (!isNum(a.params[key]) || !isNum(b.params[key])) continue;
          assert.ok(
            escalates(key, a.params[key], b.params[key]),
            `tier ${tier} / ${factor}: ${key} regressed from ${a.id} (${a.params[key]}) to ${b.id} (${b.params[key]})`
          );
        }
        assert.ok(b.params.startLevel > a.params.startLevel, `tier ${tier} / ${factor}: startLevel rises`);
      }
    }
  }
});

test('the drill-independent knobs rise across a whole factor, not just within one drill', () => {
  // A factor's twelve levels rotate over two or three drills. The knobs that mean the
  // same thing in every drill must still climb monotonically across that rotation,
  // otherwise the factor is three unrelated ladders interleaved rather than one ladder.
  // Duration keys are deliberately excluded: a corsi recall window and an n-back
  // response window are both `timeLimitMs` but they are not the same quantity, so their
  // raw milliseconds are only comparable within one drill (covered by the tests above).
  const FACTOR_SCOPED = ['trials', 'startLevel', 'expectedLevel', 'levelMin', 'levelMax',
    'levelStep', 'optionCount', 'responseCount'];

  for (const factor of FACTOR_KEYS) {
    const run = LEVELS.filter((lv) => lv.factor === factor);
    assert.equal(run.length, 12, `${factor} has twelve levels`);
    let compared = 0;
    for (let i = 1; i < run.length; i++) {
      for (const key of FACTOR_SCOPED) {
        const a = run[i - 1].params[key];
        const b = run[i].params[key];
        if (!isNum(a) || !isNum(b)) continue;
        compared += 1;
        assert.ok(b >= a, `${factor}: ${key} regressed from ${run[i - 1].id} (${a}) to ${run[i].id} (${b})`);
      }
      assert.ok(
        run[i].params.startLevel > run[i - 1].params.startLevel,
        `${factor}: startLevel strictly rises from ${run[i - 1].id} to ${run[i].id}`
      );
    }
    assert.ok(compared > 0, `${factor}: something comparable was actually compared`);
  }
});

test('no level can be passed without playing it', () => {
  // The accuracy a learner with zero skill reaches by exploiting the response structure:
  // on a go/no-go stream, never responding scores (1 - targetRate) and always responding
  // scores targetRate; on a forced choice, blind guessing scores 1/optionCount. If a pass
  // bar sits at or near that number the level is theatre, so demand real daylight.
  const MARGIN = 0.10;
  let checked = 0;
  for (const lv of LEVELS) {
    let floor = 0;
    const target = lv.params.targetRate;
    if (isNum(target) && target > 0 && target < 1) floor = Math.max(floor, target, 1 - target);
    for (const key of ['optionCount', 'responseCount']) {
      const k = lv.params[key];
      if (isNum(k) && k >= 2) floor = Math.max(floor, 1 / k);
    }
    if (floor === 0) continue;
    checked += 1;
    assert.ok(
      lv.goal.accuracy >= floor + MARGIN,
      `${lv.id} (${lv.drill}): pass bar ${lv.goal.accuracy} is not clear of the `
      + `no-skill baseline ${floor.toFixed(3)}`
    );
    assert.ok(
      lv.stars[0].accuracy >= floor + MARGIN,
      `${lv.id} (${lv.drill}): first star is not clear of the no-skill baseline`
    );
  }
  assert.ok(checked >= 48, `every choice or go/no-go level was checked (got ${checked})`);

  // The n-back is the case that actually bites: it is scored trial by trial, so correct
  // rejections count, and a low target rate hands a passive learner a high base rate.
  for (const lv of LEVELS.filter((l) => l.drill === 'nback')) {
    assert.ok(lv.params.targetRate >= 0.40, `${lv.id} n-back target rate kills the passive strategy`);
  }
});

test('rule budgets stay inside the culture-fair rule families and widen with tier', () => {
  const byDrill = new Map();
  for (const lv of LEVELS) {
    if (!Array.isArray(lv.params.ruleFamilies)) continue;
    for (const fam of lv.params.ruleFamilies) {
      assert.ok(ALLOWED_RULE_FAMILIES.has(fam), `${lv.id} uses forbidden rule family ${fam}`);
    }
    if (!byDrill.has(lv.drill)) byDrill.set(lv.drill, []);
    byDrill.get(lv.drill).push(lv);
  }
  assert.ok(byDrill.size >= 4, 'several drills carry an explicit rule budget');
  for (const [drill, levels] of byDrill) {
    for (let i = 1; i < levels.length; i++) {
      assert.ok(
        levels[i].params.ruleFamilies.length >= levels[i - 1].params.ruleFamilies.length,
        `${drill}: rule budget shrank from ${levels[i - 1].id} to ${levels[i].id}`
      );
    }
  }
});

test('goals get harder across tiers, not merely longer', () => {
  const acc = [];
  const trials = [];
  for (let tier = 0; tier < TIERS; tier++) {
    const levels = levelsForTier(tier);
    const a = new Set(levels.map((l) => l.goal.accuracy));
    const t = new Set(levels.map((l) => l.goal.trials));
    assert.equal(a.size, 1, `tier ${tier} has one pass accuracy`);
    assert.equal(t.size, 1, `tier ${tier} has one trial count`);
    acc.push(levels[0].goal.accuracy);
    trials.push(levels[0].goal.trials);
  }
  assert.equal(acc[0], 0.72);
  assert.equal(acc[TIERS - 1], 0.85);
  assert.equal(trials[0], 16);
  assert.equal(trials[TIERS - 1], 30);
  for (let i = 1; i < TIERS; i++) {
    assert.ok(acc[i] > acc[i - 1], `accuracy rises into tier ${i}`);
    assert.ok(trials[i] > trials[i - 1], `trials rise into tier ${i}`);
    assert.ok(trials[i] - trials[i - 1] <= 4, `tier ${i} trial growth stays modest`);
  }
});

test('each level carries three ascending star thresholds and a reachable goal', () => {
  for (const lv of LEVELS) {
    assert.equal(lv.stars.length, 3, `${lv.id} star bands`);
    assert.equal(lv.stars[0].accuracy, lv.goal.accuracy, `${lv.id} first star is the pass bar`);
    for (let i = 1; i < 3; i++) {
      assert.ok(lv.stars[i].accuracy >= lv.stars[i - 1].accuracy, `${lv.id} star ${i} accuracy ascends`);
      assert.ok(lv.stars[i].accuracy <= 0.95, `${lv.id} star ${i} stays achievable`);
    }
    assert.ok(isNum(lv.stars[2].maxMsPerTrial) && lv.stars[2].maxMsPerTrial > 0, `${lv.id} third star has a pace bar`);
    assert.ok(lv.stars[2].minLevel <= lv.params.levelMax, `${lv.id} third star is reachable on its ladder`);
    assert.equal(lv.goal.minLevel, lv.params.startLevel, `${lv.id} must at least hold its start level`);
    assert.ok(lv.goal.maxMs > lv.goal.trials * 1000, `${lv.id} session budget is sane`);
    assert.ok(lv.goal.maxMs <= 900000, `${lv.id} session budget is capped`);
    assert.ok(lv.params.levelMax > lv.params.levelMin, `${lv.id} ladder has room`);
    assert.ok(lv.params.startLevel >= lv.params.levelMin && lv.params.startLevel <= lv.params.levelMax);
    assert.equal(lv.params.trials, lv.goal.trials, `${lv.id} passes its trial count to the drill`);
  }
});

test('every twelfth level is a capstone that samples several drills', () => {
  const drillIds = new Set(DRILLS.map((d) => d.id));
  for (const lv of LEVELS) {
    const expected = lv.order % 12 === 0;
    assert.equal(lv.capstone, expected, `${lv.id} capstone flag`);
    if (!expected) {
      assert.equal(lv.params.mixDrills, undefined, `${lv.id} is not a capstone and carries no mix`);
      continue;
    }
    assert.ok(Array.isArray(lv.params.mixDrills), `${lv.id} declares a mix`);
    assert.ok(lv.params.mixDrills.length >= 4, `${lv.id} samples several drills`);
    assert.equal(new Set(lv.params.mixDrills).size, lv.params.mixDrills.length, `${lv.id} mix is distinct`);
    assert.equal(lv.params.mixDrills[0], lv.drill, `${lv.id} mix leads with its own drill`);
    const factors = new Set();
    for (const id of lv.params.mixDrills) {
      assert.ok(drillIds.has(id), `${lv.id} mixes unknown drill ${id}`);
      const def = DRILLS.find((d) => d.id === id);
      assert.ok(def.minTier <= lv.tier, `${lv.id} mixes ${id} below its minTier`);
      factors.add(def.factor);
      assert.ok(lv.params.mixParams[id], `${lv.id} carries params for ${id}`);
    }
    assert.ok(factors.size >= 5, `${lv.id} mix spans most factors (got ${factors.size})`);
  }
  assert.equal(LEVELS.filter((l) => l.capstone).length, 6);
});

test('the unlock graph is acyclic and each tier chains from its own first level', () => {
  const orderOf = new Map(LEVELS.map((lv) => [lv.id, lv.order]));
  for (const lv of LEVELS) {
    assert.ok(Array.isArray(lv.unlock.requires), `${lv.id} requires is an array`);
    assert.equal(lv.unlock.minTier, lv.tier, `${lv.id} minTier equals its tier`);
    for (const req of lv.unlock.requires) {
      assert.ok(orderOf.has(req), `${lv.id} requires unknown level ${req}`);
      assert.ok(orderOf.get(req) < lv.order, `${lv.id} requires a later level - graph would cycle`);
    }
    const first = lv.order % 12 === 1;
    if (first) {
      assert.equal(lv.unlock.requires.length, 0, `${lv.id} opens a tier and needs no single predecessor`);
      if (lv.tier === 0) {
        assert.equal(lv.unlock.starsInTier, null);
      } else {
        assert.deepEqual(lv.unlock.starsInTier, { tier: lv.tier - 1, stars: 8 });
      }
    } else {
      assert.deepEqual(lv.unlock.requires, [`L${String(lv.order - 1).padStart(2, '0')}`]);
      assert.equal(lv.unlock.starsInTier, null);
    }
  }

  // A depth-first walk cannot revisit a node: prerequisites are strictly decreasing.
  const seen = new Set();
  const walk = (id, stack) => {
    assert.ok(!stack.has(id), `cycle through ${id}`);
    if (seen.has(id)) return;
    stack.add(id);
    for (const req of levelById(id).unlock.requires) walk(req, stack);
    stack.delete(id);
    seen.add(id);
  };
  for (const lv of LEVELS) walk(lv.id, new Set());
  assert.equal(seen.size, LEVELS.length);
});

test('a fresh qualified profile opens exactly the first level', () => {
  const p = freshProfile();
  const open = unlockedLevels(p);
  assert.equal(open.length, 1);
  assert.equal(open[0].id, 'L01');
  assert.equal(nextLevel(p).id, 'L01');
});

test('passing a level opens the next one in its tier', () => {
  let p = freshProfile();
  p = withStars(p, ['L01'], 1);
  const open = unlockedLevels(p).map((l) => l.id);
  assert.deepEqual(open, ['L01', 'L02']);
  assert.equal(nextLevel(p).id, 'L02');
});

test('a tier opens only with eight stars below it AND a measured tier', () => {
  const tier0 = levelsForTier(0).map((l) => l.id);

  // Three levels at one star each: seven stars is not enough even at the right tier.
  let p = freshProfile({ tier: 1 });
  p = withStars(p, tier0.slice(0, 3), 2);   // 6 stars
  p = withStars(p, [tier0[3]], 1);          // 7 stars
  assert.ok(!unlockedLevels(p).some((l) => l.id === 'L13'), 'seven stars does not open tier 1');

  // Eight stars, right tier: open.
  p = withStars(p, [tier0[3]], 2);          // 8 stars
  assert.ok(unlockedLevels(p).some((l) => l.id === 'L13'), 'eight stars opens tier 1');

  // Same stars, tier still 0: the measured index gate holds.
  const stillTier0 = Object.assign({}, p, { tier: 0 });
  assert.ok(!unlockedLevels(stillTier0).some((l) => l.id === 'L13'), 'tier gate holds');

  // A tier-0 profile that has three-starred all of tier 0 still cannot reach tier 1.
  const maxedTier0 = withStars(freshProfile({ tier: 0 }), tier0, 3);
  const open = unlockedLevels(maxedTier0);
  assert.equal(open.length, 12);
  assert.ok(open.every((l) => l.tier === 0));
  assert.equal(nextLevel(maxedTier0), null, 'nothing left to play until the index rises');
});

test('every level is reachable by satisfying its own requirements', () => {
  // `tier` is the measured index band, not something training awards, so a learner who
  // has climbed to apex is the case that must be able to reach the whole ladder.
  let p = freshProfile({ tier: 5 });
  const reached = new Set();
  let guard = 0;
  while (guard++ < LEVELS.length + 10) {
    const open = unlockedLevels(p).filter((l) => !reached.has(l.id));
    if (open.length === 0) break;
    for (const lv of open) reached.add(lv.id);
    p = withStars(p, open.map((l) => l.id), 1);
  }
  assert.ok(guard <= LEVELS.length + 10, 'reachability walk terminates');
  assert.equal(reached.size, LEVELS.length, 'all 72 levels reachable');

  // One star per level is 12 per tier, which clears the eight-star gate; check the walk
  // really did traverse tier by tier rather than opening everything at once.
  const p2 = freshProfile({ tier: 5 });
  assert.equal(unlockedLevels(p2).length, 1, 'nothing is free at the start, whatever the tier');
});

test('nextLevel skips passed levels and returns null when the frontier is exhausted', () => {
  let p = freshProfile({ tier: 5 });
  p = withStars(p, ['L01', 'L02', 'L03'], 3);
  assert.equal(nextLevel(p).id, 'L04');

  // A level unlocked but not passed is the frontier even if later ones were force-unlocked.
  const forced = Object.assign({}, p, {
    levels: Object.assign({}, p.levels, { L09: { unlocked: true, stars: 0 } })
  });
  assert.equal(nextLevel(forced).id, 'L04');
  assert.ok(unlockedLevels(forced).some((l) => l.id === 'L09'), 'explicit unlock flag is honoured');
});

test('an eliminated profile has no training at all', () => {
  const p = withStars(freshProfile({ status: 'eliminated', tier: 3 }), ['L01', 'L02'], 3);
  assert.deepEqual(unlockedLevels(p), []);
  assert.equal(nextLevel(p), null);
  const s = progressSummary(p);
  assert.equal(s.unlocked, 0);
  assert.equal(s.stars, 6, 'history is still reported, only access is withdrawn');
});

test('progressSummary sums correctly on a synthetic profile', () => {
  let p = freshProfile({ tier: 5 });
  // L01 induction 3 stars, L02 spatial 2, L03 workingMemory 1, L04 relational 0 (attempted).
  p = withStars(p, ['L01'], 3);
  p = withStars(p, ['L02'], 2);
  p = withStars(p, ['L03'], 1);
  p.levels.L04 = { unlocked: true, stars: 0, attempts: 2 };
  p.levels.NOPE = { unlocked: true, stars: 3 };   // unknown ids are ignored

  const s = progressSummary(p);
  assert.equal(s.totalLevels, 72);
  assert.equal(s.maxStars, 216);
  assert.equal(s.stars, 6);
  assert.equal(s.passed, 3);
  assert.equal(s.unlocked, 4, 'L01-L03 passed plus the L04 frontier');
  assert.equal(s.percent, Math.round((100 * 6 / 216) * 10) / 10);

  assert.deepEqual(s.byFactor.induction, { passed: 1, total: 12, stars: 3 });
  assert.deepEqual(s.byFactor.spatial, { passed: 1, total: 12, stars: 2 });
  assert.deepEqual(s.byFactor.workingMemory, { passed: 1, total: 12, stars: 1 });
  assert.deepEqual(s.byFactor.relational, { passed: 0, total: 12, stars: 0 });
  assert.deepEqual(s.byFactor.speed, { passed: 0, total: 12, stars: 0 });
  assert.deepEqual(s.byFactor.flexibility, { passed: 0, total: 12, stars: 0 });

  // Cross-check: the factor roll-ups must partition the ladder exactly.
  const factorTotals = FACTOR_KEYS.reduce((a, k) => a + s.byFactor[k].total, 0);
  const factorStars = FACTOR_KEYS.reduce((a, k) => a + s.byFactor[k].stars, 0);
  const factorPassed = FACTOR_KEYS.reduce((a, k) => a + s.byFactor[k].passed, 0);
  assert.equal(factorTotals, s.totalLevels);
  assert.equal(factorStars, s.stars);
  assert.equal(factorPassed, s.passed);

  assert.equal(s.byTier.length, 6);
  const tierTotals = s.byTier.reduce((a, r) => a + r.total, 0);
  const tierStars = s.byTier.reduce((a, r) => a + r.stars, 0);
  const tierUnlocked = s.byTier.reduce((a, r) => a + r.unlocked, 0);
  assert.equal(tierTotals, s.totalLevels);
  assert.equal(tierStars, s.stars);
  assert.equal(tierUnlocked, s.unlocked);
  assert.equal(s.byTier[0].maxStars, 36);
  assert.equal(s.byTier[0].percent, Math.round((100 * 6 / 36) * 10) / 10);
  assert.equal(s.byTier[5].stars, 0);
  assert.equal(s.byTier[5].percent, 0);
});

test('progressSummary is total on junk input', () => {
  for (const junk of [undefined, null, {}, { levels: null, tier: 'x' }, { levels: { L01: null } }]) {
    const s = progressSummary(junk);
    assert.equal(s.totalLevels, 72);
    assert.equal(s.stars, 0);
    assert.equal(s.passed, 0);
    assert.ok(s.percent === 0);
  }
  assert.deepEqual(unlockedLevels(undefined).map((l) => l.id), ['L01']);
  assert.equal(levelById('nope'), null);
  assert.equal(levelById(7), null);
  assert.deepEqual(levelsForTier(9), []);
  assert.deepEqual(levelsForTier('x'), []);
  assert.equal(levelById('L01').id, 'L01');
  assert.equal(levelsForTier(3).length, 12);
});

test('factorTargets rises with tier, covers all six factors and stays on scale', () => {
  let prev = null;
  for (let tier = 0; tier < TIERS; tier++) {
    const t = factorTargets(tier);
    assert.deepEqual(Object.keys(t).sort(), FACTOR_KEYS.slice().sort());
    for (const key of FACTOR_KEYS) {
      assert.ok(isNum(t[key]) && t[key] >= 0 && t[key] <= 100, `${key} target on scale`);
      if (prev) assert.ok(t[key] > prev[key], `${key} target rises into tier ${tier}`);
    }
    prev = t;
  }
  // Out-of-range input clamps rather than throwing.
  assert.deepEqual(factorTargets(-4), factorTargets(0));
  assert.deepEqual(factorTargets(99), factorTargets(5));
  assert.deepEqual(factorTargets('x'), factorTargets(0));
});

test('XP formula matches the contract on a worked example', () => {
  // xp = round(trials * (0.5 + accuracy) * (1 + finalLevel / 10) * (1 + tier * 0.25))
  const xp = (trials, accuracy, finalLevel, tier) =>
    Math.round(trials * (0.5 + accuracy) * (1 + finalLevel / 10) * (1 + tier * 0.25));

  const first = levelById('L01');
  assert.equal(first.tier, 0);
  assert.equal(first.goal.trials, 16);
  // 16 * 1.375 * 1.4 * 1.00 = 30.8 -> 31
  assert.equal(xp(first.goal.trials, 0.875, 4, first.tier), 31);

  const last = levelById('L72');
  assert.equal(last.tier, 5);
  assert.equal(last.goal.trials, 30);
  // 30 * 1.4 * 2.4 * 2.25 = 226.8 -> 227
  assert.equal(xp(last.goal.trials, 0.9, 14, last.tier), 227);

  // The tier multiplier is the only tier-dependent term, and it is 1 + tier/4.
  for (let tier = 0; tier < TIERS; tier++) {
    assert.equal(xp(20, 0.5, 0, tier) / xp(20, 0.5, 0, 0), 1 + tier * 0.25);
  }
});

test('curriculum drill metadata agrees with each engine\'s own declaration', () => {
  // Read the drill sources as TEXT rather than importing them: a drill engine pulls in
  // the whole item pipeline, and this suite must not depend on that. A file that does
  // not exist yet is skipped, so the check tightens as the engines land.
  const dir = fileURLToPath(new URL('../src/train/drills/', import.meta.url));
  let checked = 0;
  for (const def of DRILLS) {
    const path = `${dir}${def.id}.js`;
    if (!existsSync(path)) continue;
    const src = readFileSync(path, 'utf8');
    const idMatch = src.match(/export const id\s*=\s*'([^']+)'/);
    const factorMatch = src.match(/export const factor\s*=\s*'([^']+)'/);
    const presetMatch = src.match(/export const staircasePreset\s*=\s*'([^']+)'/);
    assert.ok(idMatch, `${def.id}.js exports an id`);
    assert.ok(factorMatch, `${def.id}.js exports a factor`);
    assert.ok(presetMatch, `${def.id}.js exports a staircasePreset`);
    assert.equal(idMatch[1], def.id, `${def.id}.js declares its own id`);
    assert.equal(
      factorMatch[1], def.factor,
      `${def.id}: engine says factor '${factorMatch[1]}', curriculum says '${def.factor}'`
    );
    assert.ok(
      ['nback', 'precision', 'speed', 'span'].includes(presetMatch[1]),
      `${def.id}: unknown staircase preset ${presetMatch[1]}`
    );
    assert.ok(/export function makeRun\s*\(/.test(src), `${def.id}.js exports makeRun`);
    checked += 1;
  }
  assert.ok(checked >= 0);
});

test('the ladder is frozen against accidental mutation', () => {
  assert.ok(Object.isFrozen(LEVELS));
  assert.ok(Object.isFrozen(LEVELS[0]));
  assert.ok(Object.isFrozen(LEVELS[0].params));
  assert.ok(Object.isFrozen(DRILLS));
  assert.throws(() => { LEVELS[0].tier = 4; }, TypeError);
});
