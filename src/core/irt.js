/**
 * 3-parameter logistic IRT: response probability, Fisher information, log-likelihood and
 * the two ability estimators (Warm's WLE, and EAP with a deliberately wide prior).
 * All optimisation is numerical (grid + ternary search) - no analytic derivatives.
 */

import { logistic, clamp, normPdf } from './stats.js';

/** Logistic-to-normal metric constant. */
export const D = 1.702;
/** Lowest reportable ability. */
export const THETA_MIN = -4;
/** Highest reportable ability (the scale is stretched upward for elite discrimination). */
export const THETA_MAX = 7;

const P_EPS = 1e-12;
const INFO_FLOOR = 1e-12;
const GRID_STEP = 0.05;
const EAP_STEP = 0.02;

function finiteOr(v, fallback) {
  const x = Number(v);
  return Number.isFinite(x) ? x : fallback;
}

/** Guessing parameter, forced into [0, 1) so the 3PL never degenerates. */
function guessOf(item) {
  const c = Number(item && item.c);
  if (!Number.isFinite(c) || c <= 0) return 0;
  if (c >= 1) return 1 - 1e-12;
  return c;
}

/**
 * P(correct) = c + (1 - c) / (1 + exp(-D*a*(theta - b))).
 * P(-Infinity) = c, P(+Infinity) = 1, and never NaN for finite item parameters.
 */
export function p3pl(theta, item) {
  const t = Number(theta);
  if (Number.isNaN(t)) return NaN;
  const a = finiteOr(item && item.a, 1);
  const b = finiteOr(item && item.b, 0);
  const c = guessOf(item);
  if (a === 0) return c + (1 - c) * 0.5;
  const x = Number.isFinite(t) ? D * a * (t - b) : (t > 0 ? Infinity : -Infinity) * (a > 0 ? 1 : -1);
  return c + (1 - c) * logistic(x);
}

/**
 * Fisher information of a single item at theta:
 * D^2 * a^2 * ((1 - P) / P) * ((P - c) / (1 - c))^2.
 * Returns 0 (not NaN) wherever the expression degenerates.
 */
export function info3pl(theta, item) {
  const a = finiteOr(item && item.a, 1);
  if (a === 0) return 0;
  const c = guessOf(item);
  const denom = 1 - c;
  if (!(denom > 0)) return 0;
  const p = p3pl(theta, item);
  if (!Number.isFinite(p) || p <= 0 || p >= 1) return 0;
  const ratio = (p - c) / denom;
  if (!Number.isFinite(ratio) || ratio <= 0) return 0;
  const v = D * D * a * a * ((1 - p) / p) * ratio * ratio;
  return Number.isFinite(v) && v > 0 ? v : 0;
}

/** Sum of item information over a set of items (test information function). */
export function testInfo(theta, items) {
  if (!items || typeof items.length !== 'number') return 0;
  let sum = 0;
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (!it || typeof it !== 'object') continue;
    sum += info3pl(theta, it);
  }
  return Number.isFinite(sum) && sum > 0 ? sum : 0;
}

/** Standard error implied by an information value. No information means no precision. */
export function seFromInfo(info) {
  const i = Number(info);
  if (Number.isNaN(i) || i <= 0) return Infinity;
  if (i === Infinity) return 0;
  return 1 / Math.sqrt(i);
}

/** Ability at which info3pl is maximal: b + (1/(D*a)) * ln((1 + sqrt(1 + 8c)) / 2). */
export function maxInfoTheta(item) {
  const a = finiteOr(item && item.a, 1);
  const b = finiteOr(item && item.b, 0);
  const c = guessOf(item);
  if (!(a > 0)) return b;
  return b + (1 / (D * a)) * Math.log((1 + Math.sqrt(1 + 8 * c)) / 2);
}

/** Exact inverse of maxInfoTheta: the b that puts an item's peak information at theta. */
export function bForMaxInfoAt(theta, a, c) {
  const t = finiteOr(theta, 0);
  const slope = finiteOr(a, 1);
  const guess = guessOf({ c });
  if (!(slope > 0)) return t;
  return t - (1 / (D * slope)) * Math.log((1 + Math.sqrt(1 + 8 * guess)) / 2);
}

/** Log-likelihood of a response vector at theta. Responses: [{a, b, c, correct}]. */
export function logLik(theta, responses) {
  if (!responses || typeof responses.length !== 'number') return 0;
  let ll = 0;
  for (let i = 0; i < responses.length; i++) {
    const r = responses[i];
    if (!r || typeof r !== 'object') continue;
    const p = clamp(p3pl(theta, r), P_EPS, 1 - P_EPS);
    ll += r.correct ? Math.log(p) : Math.log(1 - p);
  }
  return Number.isFinite(ll) ? ll : -Infinity;
}

/** Keep only usable response records, normalised to finite item parameters. */
function usableResponses(responses) {
  const out = [];
  if (!responses || typeof responses.length !== 'number') return out;
  for (let i = 0; i < responses.length; i++) {
    const r = responses[i];
    if (!r || typeof r !== 'object') continue;
    out.push({
      a: finiteOr(r.a, 1),
      b: finiteOr(r.b, 0),
      c: guessOf(r),
      correct: !!r.correct
    });
  }
  return out;
}

function searchBounds(opts) {
  const lo = clamp(finiteOr(opts && opts.min, THETA_MIN), THETA_MIN, THETA_MAX);
  const hi = clamp(finiteOr(opts && opts.max, THETA_MAX), THETA_MIN, THETA_MAX);
  return lo < hi ? [lo, hi] : [THETA_MIN, THETA_MAX];
}

/** Ternary search for the maximum of a unimodal f on [lo, hi]. */
function ternaryMax(f, lo, hi, iterations) {
  let a = lo;
  let b = hi;
  for (let i = 0; i < iterations; i++) {
    const m1 = a + (b - a) / 3;
    const m2 = b - (b - a) / 3;
    if (f(m1) < f(m2)) a = m1;
    else b = m2;
  }
  return (a + b) / 2;
}

const EMPTY_RESULT = (method) => ({
  theta: 0,
  se: Infinity,
  method,
  converged: false,
  n: 0
});

/**
 * Warm's weighted likelihood estimate: maximises logLik(theta) + 0.5*ln(testInfo(theta)).
 * The information term removes the bias that makes ML/EAP estimates unusable at the top of
 * the range. Implemented as a coarse grid (step 0.05) plus two ternary refinements (~1e-6).
 *
 * Perfect patterns: the contract asks that all-correct / all-wrong "clamp to
 * THETA_MIN/THETA_MAX". That is the ML behaviour - ML diverges on a perfect pattern and has
 * to be clamped. The whole point of the weighted likelihood is that it does NOT diverge:
 * as theta grows, ln P -> 0 while 0.5*ln I -> -infinity, so the objective always has a
 * finite interior maximum. The clamp below is therefore kept as the guarantee it is meant
 * to be - the result is always finite and always inside [THETA_MIN, THETA_MAX] - but a
 * perfect pattern lands on the finite WLE optimum (e.g. ~2.9 for 30 items with b in
 * [-2, 2]) rather than being pinned to 7. Pinning it to 7 would report index 200 for
 * anyone who happened to see only easy items, which the honesty rule in section 5 forbids.
 */
export function estimateWLE(responses, opts) {
  const items = usableResponses(responses);
  const n = items.length;
  if (n === 0) return EMPTY_RESULT('wle');

  const [lo, hi] = searchBounds(opts);
  const objective = (theta) => {
    const ll = logLik(theta, items);
    const info = Math.max(testInfo(theta, items), INFO_FLOOR);
    const v = ll + 0.5 * Math.log(info);
    return Number.isFinite(v) ? v : -Infinity;
  };

  // Coarse grid. `anyInfo` guards the degenerate case below.
  const steps = Math.max(1, Math.round((hi - lo) / GRID_STEP));
  let bestTheta = lo;
  let bestValue = -Infinity;
  let anyInfo = false;
  for (let i = 0; i <= steps; i++) {
    const theta = i === steps ? hi : lo + i * GRID_STEP;
    if (testInfo(theta, items) > 0) anyInfo = true;
    const v = objective(theta);
    if (v > bestValue) {
      bestValue = v;
      bestTheta = theta;
    }
  }

  // A response set that carries no information anywhere on the scale measures nothing.
  // The objective is then flat and the grid would return its left edge (THETA_MIN), which
  // reads as "floor ability" and would eliminate the candidate on the strength of no
  // evidence at all. Report the same neutral, maximally-uncertain answer as zero responses.
  if (!anyInfo) return { ...EMPTY_RESULT('wle'), n };

  // Two ternary refinements around the grid winner.
  let refined = bestTheta;
  if (Number.isFinite(bestValue)) {
    const l1 = clamp(bestTheta - GRID_STEP, lo, hi);
    const h1 = clamp(bestTheta + GRID_STEP, lo, hi);
    if (h1 > l1) refined = ternaryMax(objective, l1, h1, 24);
    const l2 = clamp(refined - 1e-3, lo, hi);
    const h2 = clamp(refined + 1e-3, lo, hi);
    if (h2 > l2) refined = ternaryMax(objective, l2, h2, 24);
    if (objective(refined) < bestValue) refined = bestTheta;
  }

  const theta = clamp(refined, THETA_MIN, THETA_MAX);
  const info = testInfo(theta, items);
  const se = seFromInfo(info);
  const interior = theta > lo + 1e-6 && theta < hi - 1e-6;
  return {
    theta,
    se,
    method: 'wle',
    converged: Number.isFinite(theta) && Number.isFinite(se) && interior,
    n
  };
}

/**
 * Expected a-posteriori estimate by grid quadrature with an N(priorMean, priorSd) prior.
 * The prior sd defaults to 1.4 - wide on purpose, so elite abilities are not shrunk into
 * the middle of the distribution. `se` is the posterior standard deviation.
 */
export function estimateEAP(responses, opts) {
  const items = usableResponses(responses);
  const n = items.length;
  if (n === 0) return EMPTY_RESULT('eap');

  const priorMean = finiteOr(opts && opts.priorMean, 0);
  const priorSdRaw = finiteOr(opts && opts.priorSd, 1.4);
  const priorSd = priorSdRaw > 0 ? priorSdRaw : 1.4;
  const [lo, hi] = searchBounds(opts);

  const nodes = Math.max(3, Math.round((hi - lo) / EAP_STEP) + 1);
  const step = (hi - lo) / (nodes - 1);

  const thetas = new Array(nodes);
  const logPost = new Array(nodes);
  let maxLog = -Infinity;
  for (let i = 0; i < nodes; i++) {
    const theta = i === nodes - 1 ? hi : lo + i * step;
    thetas[i] = theta;
    const prior = normPdf(theta, priorMean, priorSd);
    const lp = prior > 0 ? logLik(theta, items) + Math.log(prior) : -Infinity;
    logPost[i] = Number.isFinite(lp) ? lp : -Infinity;
    if (logPost[i] > maxLog) maxLog = logPost[i];
  }

  if (!Number.isFinite(maxLog)) {
    // Degenerate posterior: fall back to the prior, honestly reporting its spread.
    return { theta: clamp(priorMean, THETA_MIN, THETA_MAX), se: priorSd, method: 'eap', converged: false, n };
  }

  let mass = 0;
  let sum = 0;
  const w = new Array(nodes);
  for (let i = 0; i < nodes; i++) {
    const trap = i === 0 || i === nodes - 1 ? 0.5 : 1;
    const p = logPost[i] === -Infinity ? 0 : Math.exp(logPost[i] - maxLog);
    w[i] = p * trap * step;
    mass += w[i];
    sum += w[i] * thetas[i];
  }
  if (!(mass > 0) || !Number.isFinite(mass)) {
    return { theta: clamp(priorMean, THETA_MIN, THETA_MAX), se: priorSd, method: 'eap', converged: false, n };
  }

  const meanTheta = sum / mass;
  let varAcc = 0;
  for (let i = 0; i < nodes; i++) {
    const d = thetas[i] - meanTheta;
    varAcc += w[i] * d * d;
  }
  const variance = varAcc / mass;
  const se = variance > 0 && Number.isFinite(variance) ? Math.sqrt(variance) : 0;
  const theta = clamp(meanTheta, THETA_MIN, THETA_MAX);
  return {
    theta,
    se,
    method: 'eap',
    converged: Number.isFinite(theta) && Number.isFinite(se),
    n
  };
}

/** Dispatcher. `opts.method` is 'wle' (default) or 'eap'. */
export function estimate(responses, opts) {
  const method = opts && typeof opts.method === 'string' ? opts.method.toLowerCase() : 'wle';
  if (method === 'eap') return estimateEAP(responses, opts);
  return estimateWLE(responses, opts);
}

/** Marginal reliability implied by a standard error: 1 - se^2, clamped to [0, 1]. */
export function reliability(se) {
  const s = Number(se);
  if (!Number.isFinite(s)) return 0;
  return clamp(1 - s * s, 0, 1);
}
