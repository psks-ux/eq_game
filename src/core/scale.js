/**
 * Reported-index scale: converts the latent ability theta into the 100-200 product index,
 * defines the six qualification bands, and turns a standard error into a confidence
 * interval in index units. Below index 100 there is no band - that is the eliminated state.
 */

import { normQuantile, clamp } from './stats.js';

export const IQ_MEAN = 100;
export const IQ_SD = 15;
/** Qualification cut: an index below this is the eliminated state. */
export const FLOOR_INDEX = 100;
/** Top of the reportable scale. */
export const CEILING_INDEX = 200;

// The reportable index is clamped to this window; 40 corresponds to THETA_MIN = -4.
const MIN_INDEX = 40;

/**
 * Six qualification tiers. `min`/`max` are inclusive index bounds, `color` is the name of a
 * CSS custom property the stylesheet defines, `tier` is the curriculum tier index.
 */
export const BANDS = [
  { key: 'entry', tier: 0, min: 100, max: 114, color: '--band-entry' },
  { key: 'strong', tier: 1, min: 115, max: 129, color: '--band-strong' },
  { key: 'advanced', tier: 2, min: 130, max: 144, color: '--band-advanced' },
  { key: 'exceptional', tier: 3, min: 145, max: 159, color: '--band-exceptional' },
  { key: 'elite', tier: 4, min: 160, max: 179, color: '--band-elite' },
  { key: 'apex', tier: 5, min: 180, max: 200, color: '--band-apex' }
];

/** theta -> reported index: 100 + 15*theta, rounded, clamped to [40, 200]. */
export function thetaToIndex(theta) {
  const t = Number(theta);
  if (Number.isNaN(t)) return NaN;
  const raw = IQ_MEAN + IQ_SD * t;
  if (raw <= MIN_INDEX) return MIN_INDEX;
  if (raw >= CEILING_INDEX) return CEILING_INDEX;
  return clamp(Math.round(raw), MIN_INDEX, CEILING_INDEX);
}

/** Exact inverse of the linear part of thetaToIndex (no clamping, no rounding). */
export function indexToTheta(index) {
  const i = Number(index);
  if (!Number.isFinite(i)) return NaN;
  return (i - IQ_MEAN) / IQ_SD;
}

/**
 * Two-sided confidence interval for a theta estimate, expressed in index units.
 * A non-finite or negative se means "we know nothing" and yields the full scale, which is
 * the honest answer; the UI must always show this interval next to the point estimate.
 */
export function confidenceInterval(theta, se, level = 0.90) {
  const t = Number(theta);
  if (Number.isNaN(t)) return { lo: NaN, hi: NaN };

  let lvl = Number(level);
  if (!Number.isFinite(lvl)) lvl = 0.90;
  lvl = clamp(lvl, 0, 1);

  const s = Number(se);
  if (!Number.isFinite(s) || s < 0) {
    return { lo: MIN_INDEX, hi: CEILING_INDEX };
  }
  if (lvl <= 0 || s === 0) {
    const point = thetaToIndex(t);
    return { lo: point, hi: point };
  }
  if (lvl >= 1) return { lo: MIN_INDEX, hi: CEILING_INDEX };

  const z = normQuantile(0.5 + lvl / 2, 0, 1);
  if (!Number.isFinite(z)) return { lo: MIN_INDEX, hi: CEILING_INDEX };
  const half = z * s;
  return { lo: thetaToIndex(t - half), hi: thetaToIndex(t + half) };
}

/**
 * Band for an index, or null below 100 (the eliminated state). An unclassifiable index
 * (NaN) is also null; -Infinity falls below the cut, +Infinity is not below it.
 */
export function bandFor(index) {
  const i = Number(index);
  if (Number.isNaN(i) || i < FLOOR_INDEX) return null;
  for (let k = BANDS.length - 1; k >= 0; k--) {
    if (i >= BANDS[k].min) return BANDS[k];
  }
  return null;
}

/** Curriculum tier 0..5 for an index, or -1 below 100. */
export function tierFor(index) {
  const band = bandFor(index);
  return band ? band.tier : -1;
}
