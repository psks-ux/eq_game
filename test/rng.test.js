/**
 * Unit tests for the deterministic RNG: reproducibility, stream independence under fork,
 * unbiased shuffling (chi-square over all 24 permutations of 4 elements) and gauss moments.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { makeRng, hashSeed } from '../src/core/rng.js';
import { mean, sd, pearson } from '../src/core/stats.js';

const draw = (rng, n) => {
  const out = new Array(n);
  for (let i = 0; i < n; i++) out[i] = rng.next();
  return out;
};

test('hashSeed is a deterministic uint32', () => {
  const a = hashSeed('abc');
  const b = hashSeed('abc');
  assert.equal(a, b);
  assert.ok(Number.isInteger(a));
  assert.ok(a >= 0 && a <= 0xffffffff);
  assert.notEqual(hashSeed('abc'), hashSeed('abd'));
  assert.notEqual(hashSeed(''), hashSeed('a'));
  assert.ok(Number.isInteger(hashSeed('')));
  // Non-string input must not throw.
  assert.ok(Number.isInteger(hashSeed(12345)));
});

test('hashSeed avalanches: single-character changes give unrelated hashes', () => {
  const base = hashSeed('matrix:0001');
  const near = hashSeed('matrix:0002');
  assert.notEqual(base, near);
  // At least 8 of 32 bits should differ between two near-identical keys.
  let bits = 0;
  let x = (base ^ near) >>> 0;
  while (x) {
    bits += x & 1;
    x >>>= 1;
  }
  assert.ok(bits >= 8, `expected avalanche, only ${bits} bits differ`);
});

test('rng exposes the full contract surface', () => {
  const rng = makeRng('surface');
  for (const key of ['next', 'int', 'pick', 'sample', 'shuffle', 'bool', 'gauss', 'fork']) {
    assert.equal(typeof rng[key], 'function', `missing ${key}`);
  }
});

test('the same seed reproduces the same stream (string and numeric seeds)', () => {
  const a = draw(makeRng('abc'), 200);
  const b = draw(makeRng('abc'), 200);
  assert.deepEqual(a, b);

  const n1 = draw(makeRng(123), 200);
  const n2 = draw(makeRng(123), 200);
  assert.deepEqual(n1, n2);

  // Different seeds must not produce the same stream.
  assert.notDeepEqual(a, n1);
  assert.notDeepEqual(draw(makeRng('abc'), 50), draw(makeRng('abd'), 50));
  assert.notDeepEqual(draw(makeRng(123), 50), draw(makeRng(124), 50));

  // Undefined / null seeds are accepted and stable.
  assert.deepEqual(draw(makeRng(), 20), draw(makeRng(), 20));
});

test('next() stays in [0,1) and is uniform across 10 bins', () => {
  const rng = makeRng('uniform-check');
  const bins = new Array(10).fill(0);
  const N = 100000;
  for (let i = 0; i < N; i++) {
    const v = rng.next();
    assert.ok(v >= 0 && v < 1, `next() out of range: ${v}`);
    bins[Math.floor(v * 10)]++;
  }
  const expected = N / 10;
  let chi2 = 0;
  for (const b of bins) chi2 += ((b - expected) * (b - expected)) / expected;
  // df = 9; the 0.1% critical value is 27.9. Anything past 40 is a broken generator.
  assert.ok(chi2 < 40, `uniformity chi2 too large: ${chi2}`);
});

test('int() respects [min, max) and degenerate ranges', () => {
  const rng = makeRng('ints');
  const seen = new Set();
  for (let i = 0; i < 5000; i++) {
    const v = rng.int(3, 7);
    assert.ok(Number.isInteger(v));
    assert.ok(v >= 3 && v < 7, `int out of range: ${v}`);
    seen.add(v);
  }
  assert.deepEqual([...seen].sort(), [3, 4, 5, 6]);
  assert.equal(rng.int(5, 5), 5);
  assert.equal(rng.int(5, 2), 5);
  assert.equal(rng.int(0, 1), 0);
});

test('pick() returns a member, and undefined for an empty array', () => {
  const rng = makeRng('pick');
  const pool = ['a', 'b', 'c'];
  const counts = { a: 0, b: 0, c: 0 };
  for (let i = 0; i < 3000; i++) {
    const v = rng.pick(pool);
    assert.ok(pool.includes(v));
    counts[v]++;
  }
  for (const key of pool) assert.ok(counts[key] > 800, `pick starved ${key}: ${counts[key]}`);
  assert.equal(rng.pick([]), undefined);
  assert.equal(rng.pick(null), undefined);
});

test('sample() returns k distinct positions without mutating the source', () => {
  const rng = makeRng('sample');
  const src = [0, 1, 2, 3, 4, 5, 6, 7];
  const frozen = src.slice();
  for (let i = 0; i < 500; i++) {
    const s = rng.sample(src, 3);
    assert.equal(s.length, 3);
    assert.equal(new Set(s).size, 3);
    for (const v of s) assert.ok(src.includes(v));
  }
  assert.deepEqual(src, frozen);
  assert.equal(rng.sample(src, 0).length, 0);
  assert.equal(rng.sample(src, -2).length, 0);
  assert.equal(rng.sample(src, 99).length, src.length);
  assert.equal(new Set(rng.sample(src, 8)).size, 8);
  assert.deepEqual(rng.sample([], 3), []);
});

test('shuffle() returns a NEW array that is a permutation of the input', () => {
  const rng = makeRng('shuffle-basic');
  const src = [1, 2, 3, 4, 5];
  const out = rng.shuffle(src);
  assert.notEqual(out, src, 'shuffle must not return the same array reference');
  assert.deepEqual(src, [1, 2, 3, 4, 5], 'shuffle must not mutate its input');
  assert.deepEqual(out.slice().sort((a, b) => a - b), [1, 2, 3, 4, 5]);
  assert.deepEqual(rng.shuffle([]), []);
  assert.deepEqual(rng.shuffle([9]), [9]);
});

test('shuffle() is unbiased: chi-square over the 24 permutations of 4 elements', () => {
  const rng = makeRng('shuffle-uniformity');
  const counts = new Map();
  const N = 20000;
  for (let i = 0; i < N; i++) {
    const key = rng.shuffle([0, 1, 2, 3]).join('');
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  assert.equal(counts.size, 24, 'not every permutation was produced');

  const expected = N / 24;
  let chi2 = 0;
  let min = Infinity;
  let max = -Infinity;
  for (const v of counts.values()) {
    chi2 += ((v - expected) * (v - expected)) / expected;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  // df = 23; the 0.1% critical value is 49.7. A biased shuffle (e.g. j in [0,n)) blows
  // far past this. 60 is the "absurd deviation" threshold.
  assert.ok(chi2 < 60, `shuffle chi2 too large: ${chi2}`);
  // Each bucket should sit near 833; a 25% deviation in either direction is already extreme.
  assert.ok(min > expected * 0.75, `permutation starved: ${min}`);
  assert.ok(max < expected * 1.25, `permutation over-represented: ${max}`);
});

test('bool() honours p at the boundaries and in between', () => {
  const rng = makeRng('bool');
  for (let i = 0; i < 100; i++) {
    assert.equal(rng.bool(0), false);
    assert.equal(rng.bool(1), true);
  }
  let hits = 0;
  const N = 20000;
  for (let i = 0; i < N; i++) if (rng.bool(0.3)) hits++;
  const p = hits / N;
  assert.ok(Math.abs(p - 0.3) < 0.02, `bool(0.3) frequency off: ${p}`);

  let half = 0;
  for (let i = 0; i < N; i++) if (rng.bool()) half++;
  assert.ok(Math.abs(half / N - 0.5) < 0.02, `default bool() frequency off: ${half / N}`);
});

test('gauss() has the right mean and sd, and scales correctly', () => {
  const rng = makeRng('gauss');
  const xs = [];
  for (let i = 0; i < 50000; i++) xs.push(rng.gauss());
  assert.ok(Math.abs(mean(xs)) < 0.02, `gauss mean off: ${mean(xs)}`);
  assert.ok(Math.abs(sd(xs) - 1) < 0.02, `gauss sd off: ${sd(xs)}`);

  const ys = [];
  for (let i = 0; i < 50000; i++) ys.push(rng.gauss(5, 2));
  assert.ok(Math.abs(mean(ys) - 5) < 0.05, `scaled gauss mean off: ${mean(ys)}`);
  assert.ok(Math.abs(sd(ys) - 2) < 0.05, `scaled gauss sd off: ${sd(ys)}`);

  for (const v of xs) assert.ok(Number.isFinite(v), 'gauss produced a non-finite value');

  // The Box-Muller cache must not break reproducibility.
  const a = makeRng('gauss-repro');
  const b = makeRng('gauss-repro');
  const seqA = [];
  const seqB = [];
  for (let i = 0; i < 100; i++) {
    seqA.push(a.gauss());
    seqB.push(b.gauss());
  }
  assert.deepEqual(seqA, seqB);
});

test('fork() is reproducible for the same (seed, tag) and independent of the parent', () => {
  const tagged = () => makeRng('parent-seed').fork('items');
  assert.deepEqual(draw(tagged(), 100), draw(tagged(), 100));

  // Different tags give different streams.
  const f1 = makeRng('parent-seed').fork('items');
  const f2 = makeRng('parent-seed').fork('distractors');
  assert.notDeepEqual(draw(f1, 50), draw(f2, 50));

  // A fork must differ from its parent's own stream.
  const parent = makeRng('parent-seed');
  const child = makeRng('parent-seed').fork('items');
  assert.notDeepEqual(draw(parent, 50), draw(child, 50));

  // Different parents with the same tag differ too.
  assert.notDeepEqual(
    draw(makeRng('seedA').fork('x'), 50),
    draw(makeRng('seedB').fork('x'), 50)
  );

  // Statistical independence: parent vs fork, and fork vs fork.
  const p = makeRng('seedX');
  const c1 = makeRng('seedX').fork('a');
  const c2 = makeRng('seedX').fork('b');
  const P = [];
  const C1 = [];
  const C2 = [];
  for (let i = 0; i < 20000; i++) {
    P.push(p.next());
    C1.push(c1.next());
    C2.push(c2.next());
  }
  // With n = 20000 the sd of a null correlation is ~0.007, so 0.05 is a 7-sigma bound.
  assert.ok(Math.abs(pearson(P, C1)) < 0.05, `parent/fork correlated: ${pearson(P, C1)}`);
  assert.ok(Math.abs(pearson(C1, C2)) < 0.05, `fork/fork correlated: ${pearson(C1, C2)}`);

  // Forks of forks keep working and stay reproducible.
  const deep = () => makeRng('root').fork('a').fork('b');
  assert.deepEqual(draw(deep(), 40), draw(deep(), 40));
  assert.notDeepEqual(draw(deep(), 40), draw(makeRng('root').fork('a'), 40));
});

test('a forked stream does not disturb the parent stream', () => {
  const a = makeRng('interleave');
  const first = draw(a, 20);

  const b = makeRng('interleave');
  const beforeFork = draw(b, 10);
  const side = b.fork('side');
  draw(side, 500);
  const afterFork = draw(b, 10);

  assert.deepEqual(beforeFork.concat(afterFork), first);
});
