/**
 * Unit tests for the reported-index scale: theta <-> index round trips, the six band
 * boundaries (including the elimination cut at 100), and confidence intervals in index
 * units - plus the normal-quantile accuracy the interval depends on.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  IQ_MEAN,
  IQ_SD,
  FLOOR_INDEX,
  CEILING_INDEX,
  BANDS,
  thetaToIndex,
  indexToTheta,
  confidenceInterval,
  bandFor,
  tierFor
} from '../src/core/scale.js';
import { normQuantile, normCdf } from '../src/core/stats.js';
import { THETA_MIN, THETA_MAX } from '../src/core/irt.js';

test('scale constants match the contract', () => {
  assert.equal(IQ_MEAN, 100);
  assert.equal(IQ_SD, 15);
  assert.equal(FLOOR_INDEX, 100);
  assert.equal(CEILING_INDEX, 200);
});

test('thetaToIndex is 100 + 15*theta, rounded and clamped to [40, 200]', () => {
  assert.equal(thetaToIndex(0), 100);
  assert.equal(thetaToIndex(1), 115);
  assert.equal(thetaToIndex(-1), 85);
  assert.equal(thetaToIndex(2), 130);
  assert.equal(thetaToIndex(4), 160);
  assert.equal(thetaToIndex(-4), 40);
  assert.equal(thetaToIndex(20 / 3), 200);

  // Clamping, including the theta range the IRT engine can emit.
  assert.equal(thetaToIndex(THETA_MAX), 200);
  assert.equal(thetaToIndex(THETA_MIN), 40);
  assert.equal(thetaToIndex(50), 200);
  assert.equal(thetaToIndex(-50), 40);
  assert.equal(thetaToIndex(Infinity), 200);
  assert.equal(thetaToIndex(-Infinity), 40);
  assert.ok(Number.isNaN(thetaToIndex(NaN)));

  // Rounding, not truncation.
  assert.equal(thetaToIndex(0.04), 101);
  assert.equal(thetaToIndex(-0.04), 99);
  assert.equal(thetaToIndex(0.0666), 101);
  for (let t = -3; t <= 6; t += 0.013) {
    assert.ok(Number.isInteger(thetaToIndex(t)), `index not an integer at theta=${t}`);
  }
});

test('indexToTheta is the exact linear inverse', () => {
  assert.equal(indexToTheta(100), 0);
  assert.equal(indexToTheta(115), 1);
  assert.equal(indexToTheta(130), 2);
  assert.equal(indexToTheta(85), -1);
  assert.equal(indexToTheta(40), -4);
  assert.ok(Number.isNaN(indexToTheta(NaN)));
  assert.ok(Number.isNaN(indexToTheta(Infinity)));
});

test('index -> theta -> index round trips exactly across the whole scale', () => {
  for (let i = 40; i <= 200; i++) {
    assert.equal(thetaToIndex(indexToTheta(i)), i, `round trip failed at index ${i}`);
  }
});

test('theta -> index -> theta round trips within half an index point', () => {
  const tol = 0.5 / IQ_SD + 1e-12;
  for (let t = -4; t <= 6.6; t += 0.017) {
    const back = indexToTheta(thetaToIndex(t));
    assert.ok(Math.abs(back - t) <= tol, `round trip drift at theta=${t}: ${back}`);
  }
});

test('BANDS are the six contract tiers, contiguous and gap-free from 100 to 200', () => {
  assert.equal(BANDS.length, 6);
  const expected = [
    ['entry', 100, 114],
    ['strong', 115, 129],
    ['advanced', 130, 144],
    ['exceptional', 145, 159],
    ['elite', 160, 179],
    ['apex', 180, 200]
  ];
  const colors = new Set();
  BANDS.forEach((band, i) => {
    const [key, min, max] = expected[i];
    assert.equal(band.key, key);
    assert.equal(band.min, min);
    assert.equal(band.max, max);
    assert.equal(band.tier, i);
    assert.equal(typeof band.color, 'string');
    assert.ok(band.color.startsWith('--'), `band color must be a CSS custom property: ${band.color}`);
    colors.add(band.color);
    if (i > 0) assert.equal(BANDS[i - 1].max + 1, band.min, 'bands must be contiguous');
  });
  assert.equal(colors.size, 6, 'each band needs its own colour token');
  assert.equal(BANDS[0].min, FLOOR_INDEX);
  assert.equal(BANDS[BANDS.length - 1].max, CEILING_INDEX);
});

test('bandFor honours every boundary and returns null below 100', () => {
  assert.equal(bandFor(99), null);
  assert.equal(bandFor(0), null);
  assert.equal(bandFor(40), null);
  assert.equal(bandFor(-5), null);
  assert.equal(bandFor(NaN), null);
  assert.equal(bandFor(Infinity), BANDS[5]);
  assert.equal(bandFor(undefined), null);

  assert.equal(bandFor(100).key, 'entry');
  assert.equal(bandFor(114).key, 'entry');
  assert.equal(bandFor(115).key, 'strong');
  assert.equal(bandFor(129).key, 'strong');
  assert.equal(bandFor(130).key, 'advanced');
  assert.equal(bandFor(144).key, 'advanced');
  assert.equal(bandFor(145).key, 'exceptional');
  assert.equal(bandFor(159).key, 'exceptional');
  assert.equal(bandFor(160).key, 'elite');
  assert.equal(bandFor(179).key, 'elite');
  assert.equal(bandFor(180).key, 'apex');
  assert.equal(bandFor(200).key, 'apex');
  assert.equal(bandFor(250).key, 'apex');

  // Non-integer indices fall into the band that contains them.
  assert.equal(bandFor(99.9), null);
  assert.equal(bandFor(100.0), BANDS[0]);
  assert.equal(bandFor(114.6).key, 'entry');
  assert.equal(bandFor(179.9).key, 'elite');
});

test('every index from 100 to 200 lands in exactly one band', () => {
  for (let i = 100; i <= 200; i++) {
    const band = bandFor(i);
    assert.ok(band, `no band for index ${i}`);
    const matches = BANDS.filter((b) => i >= b.min && i <= b.max);
    assert.equal(matches.length, 1, `index ${i} matched ${matches.length} bands`);
    assert.equal(band.key, matches[0].key);
  }
});

test('tierFor is -1 below the cut and 0..5 above it', () => {
  assert.equal(tierFor(99), -1);
  assert.equal(tierFor(40), -1);
  assert.equal(tierFor(NaN), -1);
  assert.equal(tierFor(100), 0);
  assert.equal(tierFor(114), 0);
  assert.equal(tierFor(115), 1);
  assert.equal(tierFor(130), 2);
  assert.equal(tierFor(145), 3);
  assert.equal(tierFor(160), 4);
  assert.equal(tierFor(179), 4);
  assert.equal(tierFor(180), 5);
  assert.equal(tierFor(200), 5);

  let prev = -1;
  for (let i = 95; i <= 200; i++) {
    const tier = tierFor(i);
    assert.ok(tier === -1 || (Number.isInteger(tier) && tier >= 0 && tier <= 5));
    assert.ok(tier >= prev, 'tiers must be non-decreasing in index');
    prev = tier;
  }
});

test('the elimination cut sits exactly at index 100', () => {
  // 99 is eliminated, 100 qualifies - this is the product rule, stated numerically.
  assert.equal(bandFor(thetaToIndex(indexToTheta(99))), null);
  assert.ok(bandFor(thetaToIndex(indexToTheta(100))));
  // The largest theta that still eliminates rounds to 99.
  assert.equal(thetaToIndex(-0.034), 99);
  assert.equal(bandFor(thetaToIndex(-0.034)), null);
  assert.equal(thetaToIndex(-0.033), 100);
  assert.ok(bandFor(thetaToIndex(-0.033)));
});

test('normQuantile is accurate enough to place a confidence interval', () => {
  const known = [
    [0.975, 1.959963984540054],
    [0.95, 1.6448536269514722],
    [0.995, 2.5758293035489004],
    [0.75, 0.6744897501960817],
    [0.5, 0],
    [0.025, -1.959963984540054]
  ];
  for (const [p, z] of known) {
    assert.ok(Math.abs(normQuantile(p) - z) < 1e-9, `normQuantile(${p}) = ${normQuantile(p)}`);
  }
  assert.equal(normQuantile(0), -Infinity);
  assert.equal(normQuantile(1), Infinity);
  assert.ok(Number.isNaN(normQuantile(NaN)));
  // Round trip against the CDF across the whole open interval.
  for (let i = 1; i < 2000; i++) {
    const p = i / 2000;
    assert.ok(Math.abs(normCdf(normQuantile(p)) - p) < 1e-9, `round trip failed at p=${p}`);
  }
  // Location/scale arguments.
  assert.ok(Math.abs(normQuantile(0.975, 100, 15) - (100 + 15 * 1.959963984540054)) < 1e-7);
});

test('confidenceInterval converts theta +/- z*se into index units', () => {
  const ci = confidenceInterval(1, 0.3, 0.90);
  assert.deepEqual(ci, { lo: 108, hi: 122 });

  // Brackets the point estimate.
  const point = thetaToIndex(1);
  assert.ok(ci.lo <= point && ci.hi >= point);

  // Roughly symmetric in index units (rounding can move each end by half a point).
  assert.ok(Math.abs(point - ci.lo - (ci.hi - point)) <= 1);

  // Default level is 0.90.
  assert.deepEqual(confidenceInterval(1, 0.3), confidenceInterval(1, 0.3, 0.90));
});

test('confidenceInterval widens with se and with the confidence level', () => {
  let prev = -1;
  for (const se of [0, 0.1, 0.2, 0.3, 0.5, 0.8, 1.2]) {
    const { lo, hi } = confidenceInterval(2, se, 0.90);
    const width = hi - lo;
    assert.ok(width >= prev, `width did not grow at se=${se}: ${width} < ${prev}`);
    assert.ok(lo <= hi);
    prev = width;
  }

  const w50 = confidenceInterval(1, 0.35, 0.50);
  const w90 = confidenceInterval(1, 0.35, 0.90);
  const w99 = confidenceInterval(1, 0.35, 0.99);
  assert.ok(w50.hi - w50.lo < w90.hi - w90.lo);
  assert.ok(w90.hi - w90.lo < w99.hi - w99.lo);
});

test('confidenceInterval degrades honestly on degenerate inputs', () => {
  // Zero se: the interval collapses onto the point estimate.
  assert.deepEqual(confidenceInterval(1, 0), { lo: 115, hi: 115 });
  // No information at all: the full scale, never a falsely narrow band.
  assert.deepEqual(confidenceInterval(1, Infinity), { lo: 40, hi: 200 });
  assert.deepEqual(confidenceInterval(1, NaN), { lo: 40, hi: 200 });
  assert.deepEqual(confidenceInterval(1, -1), { lo: 40, hi: 200 });
  assert.deepEqual(confidenceInterval(1, 0.3, 1), { lo: 40, hi: 200 });
  assert.deepEqual(confidenceInterval(1, 0.3, 0), { lo: 115, hi: 115 });
  const nan = confidenceInterval(NaN, 0.3);
  assert.ok(Number.isNaN(nan.lo) && Number.isNaN(nan.hi));
  // Extreme abilities stay inside the reportable window.
  const top = confidenceInterval(7, 0.5);
  assert.equal(top.hi, 200);
  assert.ok(top.lo <= 200 && top.lo >= 40);
  const bottom = confidenceInterval(-4, 0.5);
  assert.equal(bottom.lo, 40);
});

test('a borderline candidate has an interval that straddles the cut', () => {
  // This is what the CAT needs in order to keep testing rather than eliminate early.
  const { lo, hi } = confidenceInterval(0, 0.3, 0.90);
  assert.ok(lo < FLOOR_INDEX, `lo ${lo} should sit below the cut`);
  assert.ok(hi > FLOOR_INDEX, `hi ${hi} should sit above the cut`);
  // A precise measurement well above the cut must not straddle it.
  const sure = confidenceInterval(1.5, 0.2, 0.90);
  assert.ok(sure.lo > FLOOR_INDEX);
});
