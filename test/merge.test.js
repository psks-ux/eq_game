/* Property tests for the cross-device profile merge. The algebraic laws here are
   what make a repeating sync loop converge rather than oscillate. */

import test from 'node:test';
import assert from 'node:assert/strict';

import { mergeProfiles } from '../src/core/merge.js';
import { makeRng } from '../src/core/rng.js';
import { defaultProfile } from '../src/core/store.js';

const FACTORS = ['induction', 'spatial', 'workingMemory', 'relational', 'speed', 'flexibility'];

/* A random but well-formed profile, so the laws are tested on realistic shapes. */
function randomProfile(rng, seedTag) {
  const p = defaultProfile();
  p.createdAt = rng.int(1_000_000, 2_000_000);
  p.updatedAt = p.createdAt + rng.int(1, 500_000);
  p.xp = rng.int(0, 5000);
  p.tier = rng.int(0, 6);

  const nAssess = rng.int(0, 4);
  p.assessments = [];
  for (let i = 0; i < nAssess; i++) {
    const index = rng.int(60, 190);
    p.assessments.push({
      at: rng.int(1_000_000, 2_000_000),
      index,
      ci: { lo: index - 7, hi: index + 7 },
      theta: (index - 100) / 15,
      se: 0.3,
      itemsUsed: rng.int(18, 40),
      reliability: 0.9,
      byFamily: {}
    });
  }
  if (p.assessments.length) {
    const latest = p.assessments.slice().sort((a, b) => a.at - b.at).pop();
    p.currentIndex = latest.index;
    p.peakIndex = Math.max(...p.assessments.map((a) => a.index));
    p.status = latest.index >= 100 ? 'qualified' : 'eliminated';
  }

  for (const id of ['L01', 'L02', 'L07', 'L23']) {
    if (rng.bool(0.6)) {
      p.levels[id] = {
        unlocked: true,
        stars: rng.int(0, 4),
        bestScore: rng.int(0, 100) / 100,
        bestLevel: rng.int(1, 9),
        attempts: rng.int(1, 12),
        lastAt: rng.int(1_000_000, 2_000_000)
      };
    }
  }
  for (const id of ['nback', 'corsi', 'matrixForge']) {
    if (rng.bool(0.6)) {
      p.drillStats[id] = {
        sessions: rng.int(1, 20),
        totalTrials: rng.int(10, 400),
        accuracy: rng.int(40, 99) / 100,
        bestLevel: rng.int(1, 9),
        msPerTrial: rng.int(700, 6000)
      };
    }
  }
  for (const f of FACTORS) p.factorScores[f] = rng.int(0, 100);
  for (const key of ['matrix|3|2', 'series|2|1', 'analogy|4|3']) {
    if (rng.bool(0.5)) {
      p.bank[key] = { n: rng.int(1, 30), b: rng.int(-200, 500) / 100, sumInfo: rng.int(1, 50) / 10 };
    }
  }
  p.settings.language = rng.pick(['en', 'hi', 'ar', 'zh']);
  p.settings.highContrast = rng.bool();
  p.streak = { days: rng.int(0, 40), lastDay: rng.int(20260101, 20260909) };
  p.__tag = seedTag;
  delete p.__tag;
  return p;
}

const canon = (v) => JSON.stringify(sortDeep(v));

/* Key order must not affect equality comparisons between merge results. */
function sortDeep(v) {
  if (Array.isArray(v)) return v.map(sortDeep);
  if (v && typeof v === 'object') {
    const out = {};
    for (const k of Object.keys(v).sort()) out[k] = sortDeep(v[k]);
    return out;
  }
  return v;
}

function pairs(n, seed) {
  const rng = makeRng(seed);
  const out = [];
  for (let i = 0; i < n; i++) out.push([randomProfile(rng, 'a' + i), randomProfile(rng, 'b' + i)]);
  return out;
}

test('merge is idempotent: merge(a, a) === a-normalised', () => {
  for (const [a] of pairs(60, 'idem')) {
    const once = mergeProfiles(a, a);
    const twice = mergeProfiles(once, once);
    assert.equal(canon(once), canon(twice), 'merging a profile with itself must be stable');
  }
});

test('merge is commutative: merge(a, b) === merge(b, a)', () => {
  for (const [a, b] of pairs(80, 'comm')) {
    const ab = mergeProfiles(a, b);
    const ba = mergeProfiles(b, a);
    // Settings are deliberately last-write-wins, so compare everything else.
    delete ab.settings;
    delete ba.settings;
    assert.equal(canon(ab), canon(ba), 'device order must not change the merged result');
  }
});

test('merge is associative: merge(merge(a,b),c) === merge(a,merge(b,c))', () => {
  const rng = makeRng('assoc');
  for (let i = 0; i < 60; i++) {
    const a = randomProfile(rng, 'a');
    const b = randomProfile(rng, 'b');
    const c = randomProfile(rng, 'c');
    const left = mergeProfiles(mergeProfiles(a, b), c);
    const right = mergeProfiles(a, mergeProfiles(b, c));
    delete left.settings;
    delete right.settings;
    assert.equal(canon(left), canon(right), 'grouping must not change the merged result');
  }
});

test('a repeated sync loop reaches a fixed point', () => {
  for (const [a, b] of pairs(40, 'loop')) {
    let localA = a;
    let localB = b;
    let server = null;
    for (let round = 0; round < 5; round++) {
      server = mergeProfiles(server, localA);
      localA = mergeProfiles(localA, server);
      server = mergeProfiles(server, localB);
      localB = mergeProfiles(localB, server);
    }
    delete localA.settings;
    delete localB.settings;
    assert.equal(canon(localA), canon(localB), 'both devices must converge on the same profile');
  }
});

test('merge never loses training progress', () => {
  for (const [a, b] of pairs(60, 'monotone')) {
    const m = mergeProfiles(a, b);
    assert.ok(m.xp >= a.xp && m.xp >= b.xp, 'xp regressed');
    assert.ok(m.tier >= a.tier && m.tier >= b.tier, 'tier regressed');
    for (const src of [a, b]) {
      for (const [id, lvl] of Object.entries(src.levels)) {
        assert.ok(m.levels[id], `level ${id} vanished`);
        assert.ok(m.levels[id].stars >= lvl.stars, `stars regressed on ${id}`);
        assert.ok(m.levels[id].bestLevel >= lvl.bestLevel, `bestLevel regressed on ${id}`);
        if (lvl.unlocked) assert.equal(m.levels[id].unlocked, true, `${id} became re-locked`);
      }
      for (const f of FACTORS) {
        assert.ok(m.factorScores[f] >= src.factorScores[f], `factor ${f} regressed`);
      }
      for (const rec of src.assessments) {
        assert.ok(
          m.assessments.some((x) => x.at === rec.at && x.index === rec.index),
          'an assessment was dropped'
        );
      }
      assert.ok(m.peakIndex === null || m.peakIndex >= (src.peakIndex ?? -Infinity), 'peak regressed');
    }
  }
});

test('the most recent assessment decides standing, not the luckier device', () => {
  const base = defaultProfile();
  const qualified = {
    ...base,
    updatedAt: 10,
    status: 'qualified',
    currentIndex: 140,
    peakIndex: 140,
    assessments: [{ at: 1000, index: 140, ci: { lo: 133, hi: 147 }, theta: 2.7, se: 0.3, itemsUsed: 22, reliability: 0.9, byFamily: {} }]
  };
  const laterEliminated = {
    ...base,
    updatedAt: 20,
    status: 'eliminated',
    currentIndex: 88,
    peakIndex: 88,
    assessments: [{ at: 2000, index: 88, ci: { lo: 81, hi: 95 }, theta: -0.8, se: 0.3, itemsUsed: 31, reliability: 0.9, byFamily: {} }]
  };

  const merged = mergeProfiles(qualified, laterEliminated);
  assert.equal(merged.status, 'eliminated', 'a newer sub-100 re-test must stand');
  assert.equal(merged.currentIndex, 88);
  assert.equal(merged.peakIndex, 140, 'the historical peak is still recorded');
  assert.equal(merged.assessments.length, 2, 'both administrations are kept');

  // And the reverse order must agree.
  const reversed = mergeProfiles(laterEliminated, qualified);
  assert.equal(reversed.status, 'eliminated');
  assert.equal(reversed.currentIndex, 88);
});

test('an older qualified record cannot resurrect access after elimination', () => {
  const base = defaultProfile();
  const stale = { ...base, updatedAt: 999999, status: 'qualified', currentIndex: 155, peakIndex: 155,
    assessments: [{ at: 500, index: 155, ci: { lo: 148, hi: 162 }, theta: 3.7, se: 0.3, itemsUsed: 20, reliability: 0.9, byFamily: {} }] };
  const fresh = { ...base, updatedAt: 1, status: 'eliminated', currentIndex: 92, peakIndex: 92,
    assessments: [{ at: 9000, index: 92, ci: { lo: 85, hi: 99 }, theta: -0.5, se: 0.3, itemsUsed: 34, reliability: 0.9, byFamily: {} }] };
  // Note the stale record has the NEWER updatedAt clock; standing must still follow
  // the assessment history, not the device clock.
  assert.equal(mergeProfiles(stale, fresh).status, 'eliminated');
});

test('merging a fresh empty profile changes nothing', () => {
  const rng = makeRng('empty');
  const rich = randomProfile(rng, 'rich');
  const empty = defaultProfile();
  const merged = mergeProfiles(rich, empty);
  assert.equal(merged.xp, rich.xp);
  assert.equal(merged.tier, rich.tier);
  assert.equal(merged.assessments.length, rich.assessments.length);
  assert.equal(Object.keys(merged.levels).length, Object.keys(rich.levels).length);
});

test('merge tolerates junk and never throws', () => {
  const good = defaultProfile();
  const junk = [null, undefined, 42, 'nope', [], { levels: 'no' }, { assessments: {} },
    { bank: null }, { factorScores: 7 }, { __proto__: { polluted: true } }];
  for (const j of junk) {
    const m = mergeProfiles(good, j);
    assert.ok(m === null || typeof m === 'object', 'merge returned a non-object');
  }
  assert.equal(mergeProfiles(null, null), null);
  assert.equal({}.polluted, undefined, 'prototype was polluted');
});

test('a stored __proto__ key cannot pollute the prototype', () => {
  const a = defaultProfile();
  const b = JSON.parse('{"levels": {"__proto__": {"polluted": true}}, "bank": {"__proto__": {"x": 1}}}');
  const m = mergeProfiles(a, b);
  assert.equal({}.polluted, undefined);
  assert.equal(Object.prototype.polluted, undefined);
  assert.ok(m && typeof m === 'object');
});

test('merge does not mutate its inputs', () => {
  const rng = makeRng('nomutate');
  const a = randomProfile(rng, 'a');
  const b = randomProfile(rng, 'b');
  const beforeA = canon(a);
  const beforeB = canon(b);
  mergeProfiles(a, b);
  assert.equal(canon(a), beforeA, 'local input was mutated');
  assert.equal(canon(b), beforeB, 'remote input was mutated');
});
