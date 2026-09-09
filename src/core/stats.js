/**
 * Numerical statistics helpers shared by the IRT engine, the scale, the CAT and the
 * simulation harness. Everything here is pure, dependency-free and deterministic.
 * Accuracy targets: erf/normCdf near machine precision, normQuantile ~1e-9.
 */

const SQRT_2PI = 2.5066282746310002;
const LN_GAMMA_HALF = 0.5723649429247001; // ln(Gamma(1/2)) = ln(sqrt(pi))

/** Numerically stable standard logistic; never overflows. */
export function logistic(x) {
  const v = Number(x);
  if (Number.isNaN(v)) return NaN;
  if (v >= 0) {
    const e = Math.exp(-v);
    return 1 / (1 + e);
  }
  const e = Math.exp(v);
  return e / (1 + e);
}

/** Regularised lower incomplete gamma P(1/2, x) by series expansion (x small). */
function gammaHalfSeries(x) {
  if (x <= 0) return 0;
  let ap = 0.5;
  let del = 1 / 0.5;
  let sum = del;
  for (let i = 0; i < 400; i++) {
    ap += 1;
    del *= x / ap;
    sum += del;
    if (Math.abs(del) < Math.abs(sum) * 1e-17) break;
  }
  return sum * Math.exp(-x + 0.5 * Math.log(x) - LN_GAMMA_HALF);
}

/** Regularised upper incomplete gamma Q(1/2, x) by Lentz continued fraction (x large). */
function gammaHalfCf(x) {
  const FPMIN = 1e-300;
  const a = 0.5;
  let b = x + 1 - a;
  let c = 1 / FPMIN;
  let d = 1 / b;
  let h = d;
  for (let i = 1; i <= 400; i++) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = b + an / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 1e-16) break;
  }
  return Math.exp(-x + a * Math.log(x) - LN_GAMMA_HALF) * h;
}

/**
 * Complementary error function, full double precision. Internal: the tail form is what
 * keeps normCdf accurate far out in the left tail, which normQuantile depends on.
 */
function erfcCore(y) {
  if (Number.isNaN(y)) return NaN;
  if (y === Infinity) return 0;
  if (y === -Infinity) return 2;
  if (y < 0) return 2 - erfcCore(-y);
  const t = y * y;
  if (t < 1.5) return 1 - gammaHalfSeries(t);
  return gammaHalfCf(t);
}

/** Error function. */
export function erf(x) {
  const v = Number(x);
  if (Number.isNaN(v)) return NaN;
  if (v === Infinity) return 1;
  if (v === -Infinity) return -1;
  if (v === 0) return 0;
  const ax = Math.abs(v);
  const t = ax * ax;
  const p = t < 1.5 ? gammaHalfSeries(t) : 1 - gammaHalfCf(t);
  return v < 0 ? -p : p;
}

/** Normal probability density. Returns NaN for a non-positive or non-finite sd. */
export function normPdf(x, mu = 0, sd = 1) {
  const s = Number(sd);
  const v = Number(x);
  const m = Number(mu);
  if (!(s > 0) || !Number.isFinite(s) || !Number.isFinite(m)) return NaN;
  if (Number.isNaN(v)) return NaN;
  if (!Number.isFinite(v)) return 0;
  const z = (v - m) / s;
  return Math.exp(-0.5 * z * z) / (s * SQRT_2PI);
}

/** Normal cumulative distribution, accurate in both tails. */
export function normCdf(x, mu = 0, sd = 1) {
  const s = Number(sd);
  const v = Number(x);
  const m = Number(mu);
  if (!(s > 0) || !Number.isFinite(s) || !Number.isFinite(m)) return NaN;
  if (Number.isNaN(v)) return NaN;
  if (v === Infinity) return 1;
  if (v === -Infinity) return 0;
  const z = (v - m) / s;
  return 0.5 * erfcCore(-z / Math.SQRT2);
}

// Acklam's inverse-normal rational approximation coefficients.
const AK_A = [
  -3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2,
  1.38357751867269e2, -3.066479806614716e1, 2.506628277459239
];
const AK_B = [
  -5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2,
  6.680131188771972e1, -1.328068155288572e1
];
const AK_C = [
  -7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838,
  -2.549732539343734, 4.374664141464968, 2.938163982698783
];
const AK_D = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
const AK_P_LOW = 0.02425;

/** Acklam's approximation for the standard-normal quantile on (0, 0.5]. */
function acklamLower(p) {
  if (p < AK_P_LOW) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (((((AK_C[0] * q + AK_C[1]) * q + AK_C[2]) * q + AK_C[3]) * q + AK_C[4]) * q + AK_C[5]) /
      ((((AK_D[0] * q + AK_D[1]) * q + AK_D[2]) * q + AK_D[3]) * q + 1);
  }
  const q = p - 0.5;
  const r = q * q;
  return ((((((AK_A[0] * r + AK_A[1]) * r + AK_A[2]) * r + AK_A[3]) * r + AK_A[4]) * r + AK_A[5]) * q) /
    (((((AK_B[0] * r + AK_B[1]) * r + AK_B[2]) * r + AK_B[3]) * r + AK_B[4]) * r + 1);
}

/**
 * Inverse normal CDF: Acklam's rational approximation refined by one Halley step against
 * normCdf, giving roughly 1e-9 absolute accuracy across the representable range.
 * The problem is always solved in the lower tail and mirrored, so no cancellation.
 */
export function normQuantile(p, mu = 0, sd = 1) {
  const prob = Number(p);
  const m = Number(mu);
  const s = Number(sd);
  if (Number.isNaN(prob) || Number.isNaN(m) || Number.isNaN(s)) return NaN;
  if (prob <= 0) return -Infinity;
  if (prob >= 1) return Infinity;
  const flip = prob > 0.5;
  const q = flip ? 1 - prob : prob;
  let z = acklamLower(q);
  // One Halley refinement: e = Phi(z) - q, u = e * sqrt(2pi) * exp(z^2/2).
  const e = normCdf(z, 0, 1) - q;
  const u = e * SQRT_2PI * Math.exp((z * z) / 2);
  if (Number.isFinite(u)) {
    const denom = 1 + (z * u) / 2;
    if (denom !== 0) {
      const refined = z - u / denom;
      if (Number.isFinite(refined)) z = refined;
    }
  }
  const out = flip ? -z : z;
  return m + s * out;
}

/** Arithmetic mean; NaN for an empty list. */
export function mean(xs) {
  if (!xs || typeof xs.length !== 'number' || xs.length === 0) return NaN;
  let sum = 0;
  for (let i = 0; i < xs.length; i++) sum += Number(xs[i]);
  return sum / xs.length;
}

/** Sample standard deviation (n - 1 denominator); NaN when fewer than 2 values. */
export function sd(xs) {
  if (!xs || typeof xs.length !== 'number' || xs.length < 2) return NaN;
  const n = xs.length;
  const m = mean(xs);
  let acc = 0;
  for (let i = 0; i < n; i++) {
    const d = Number(xs[i]) - m;
    acc += d * d;
  }
  return Math.sqrt(acc / (n - 1));
}

/** Type-7 (linear interpolation) quantile. Copies and sorts internally. */
export function quantile(xs, p) {
  if (!xs || typeof xs.length !== 'number' || xs.length === 0) return NaN;
  const sorted = Array.prototype.slice.call(xs).map(Number).sort((x, y) => x - y);
  const n = sorted.length;
  if (n === 1) return sorted[0];
  let prob = Number(p);
  if (Number.isNaN(prob)) return NaN;
  prob = prob < 0 ? 0 : prob > 1 ? 1 : prob;
  const h = (n - 1) * prob;
  const lo = Math.floor(h);
  const hi = Math.min(lo + 1, n - 1);
  const frac = h - lo;
  return sorted[lo] + (sorted[hi] - sorted[lo]) * frac;
}

/** Clamp x into [lo, hi]; tolerates swapped bounds. */
export function clamp(x, lo, hi) {
  const a = Number(lo);
  const b = Number(hi);
  const low = a < b ? a : b;
  const high = a < b ? b : a;
  const v = Number(x);
  if (v < low) return low;
  if (v > high) return high;
  return v;
}

/** n evenly spaced values from a to b, endpoints inclusive. */
export function linspace(a, b, n) {
  const count = Math.floor(Number(n));
  if (!Number.isFinite(count) || count <= 0) return [];
  const start = Number(a);
  const end = Number(b);
  if (count === 1) return [start];
  const out = new Array(count);
  const step = (end - start) / (count - 1);
  for (let i = 0; i < count; i++) out[i] = start + step * i;
  out[count - 1] = end; // exact endpoint, no accumulated drift
  return out;
}

/** Pearson product-moment correlation; NaN when undefined (n < 2 or zero variance). */
export function pearson(xs, ys) {
  if (!xs || !ys || typeof xs.length !== 'number' || typeof ys.length !== 'number') return NaN;
  const n = Math.min(xs.length, ys.length);
  if (n < 2) return NaN;
  let sx = 0;
  let sy = 0;
  for (let i = 0; i < n; i++) {
    sx += Number(xs[i]);
    sy += Number(ys[i]);
  }
  const mx = sx / n;
  const my = sy / n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = Number(xs[i]) - mx;
    const dy = Number(ys[i]) - my;
    sxy += dx * dy;
    sxx += dx * dx;
    syy += dy * dy;
  }
  const denom = Math.sqrt(sxx * syy);
  if (!(denom > 0)) return NaN;
  const r = sxy / denom;
  return r < -1 ? -1 : r > 1 ? 1 : r;
}

/**
 * Point-biserial correlation between a binary variable (truthy -> 1) and a continuous one.
 * Mathematically identical to Pearson on the 0/1 coding, so it is computed that way.
 */
export function pointBiserial(binaryXs, ys) {
  if (!binaryXs || typeof binaryXs.length !== 'number') return NaN;
  const coded = new Array(binaryXs.length);
  for (let i = 0; i < binaryXs.length; i++) coded[i] = binaryXs[i] ? 1 : 0;
  return pearson(coded, ys);
}

/**
 * ROC AUC via the Mann-Whitney rank identity with mid-ranks for ties.
 * labels are 0/1 (truthy -> positive). NaN if either class is empty.
 */
export function auc(labels, scores) {
  if (!labels || !scores || typeof labels.length !== 'number' || typeof scores.length !== 'number') {
    return NaN;
  }
  const n = Math.min(labels.length, scores.length);
  if (n === 0) return NaN;
  const idx = new Array(n);
  for (let i = 0; i < n; i++) idx[i] = i;
  idx.sort((i, j) => Number(scores[i]) - Number(scores[j]));

  const ranks = new Array(n);
  let i = 0;
  while (i < n) {
    let j = i;
    const s = Number(scores[idx[i]]);
    while (j + 1 < n && Number(scores[idx[j + 1]]) === s) j++;
    // Average rank (1-based) for the whole tie block.
    const avg = (i + j + 2) / 2;
    for (let k = i; k <= j; k++) ranks[idx[k]] = avg;
    i = j + 1;
  }

  let n1 = 0;
  let rankSumPos = 0;
  for (let k = 0; k < n; k++) {
    if (labels[k]) {
      n1++;
      rankSumPos += ranks[k];
    }
  }
  const n0 = n - n1;
  if (n1 === 0 || n0 === 0) return NaN;
  return (rankSumPos - (n1 * (n1 + 1)) / 2) / (n1 * n0);
}
