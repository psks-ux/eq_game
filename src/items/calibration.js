/**
 * Design-time IRT priors for generated items (the difficulty model), plus the online
 * Bayesian item bank that learns each item *structure's* difficulty from real
 * administrations and blends the learned b with the model prior by precision weighting.
 */

import { D, THETA_MIN, THETA_MAX, p3pl, info3pl } from '../core/irt.js';

function num(v, fallback) {
  const x = Number(v);
  return Number.isFinite(x) ? x : fallback;
}

function clamp(x, lo, hi) {
  return x < lo ? lo : x > hi ? hi : x;
}

function clamp01(x) {
  return clamp(x, 0, 1);
}

/**
 * Per-family difficulty offsets for b, each within [-0.5, 0.5].
 * Rationale: what the family costs *beyond* what ruleCount / abstractness / wmLoad /
 * elementCount / salience already account for.
 */
const B_FAMILY = {
  // A full grid must be verified across rows AND columns, doubling the checking work.
  matrix: 0.15,
  // A single track shows the whole progression at once, so the relation is easy to locate.
  series: -0.12,
  // The first two steps state the rule outright; only the extrapolation is left to do.
  progression: -0.08,
  // The rule is implicit, but the candidate set is small and simultaneously visible.
  oddOneOut: -0.05,
  // Mapping one relation onto a second pair adds an extra binding step over a plain series.
  analogy: 0.08,
  // Union/intersection/difference are perceptually available once the overlay is seen.
  overlay: -0.18,
  // Symmetry pops out pre-attentively; almost no deliberate search is required.
  symmetry: -0.30,
  // The rotated result must be simulated internally rather than read off the display.
  rotation: 0.10,
  // Same as rotation, plus the mirror ambiguity that makes the wrong parity attractive.
  mentalRotation: 0.12,
  // Several folds compose, and the intermediate states are never shown.
  paperFolding: 0.35,
  // Same simulation cost as paperFolding under a different registry name.
  folding: 0.35,
  // Several constraints must hold at once; a locally valid choice can still be globally wrong.
  constraint: 0.20,
  // Same as constraint, with the extra bookkeeping of a full grid of cells.
  constraintGrid: 0.26,
  // Two relations must be held and combined before either can be evaluated.
  relational: 0.24,
  // The defining case of integration load: relations *between* relations.
  relationalIntegration: 0.32,
  // Sorting by a single ordered attribute is the shallowest relational judgement we ship.
  sizeOrdering: -0.34,
  // Category membership is a one-step abstraction over the visible attributes.
  classification: -0.08,
  // Extrapolating past the shown steps needs the rule to be explicit in the solver's head.
  sequenceExtrapolation: 0.18
};

/**
 * Per-family discrimination offsets for a, each within [-0.25, 0.35].
 * Rationale: how sharply the family separates people who have the rule from those who
 * do not (high a) versus how much strategy/luck noise it lets through (low a).
 */
const A_FAMILY = {
  // Rich rule structure supports true near-miss distractors, so partial insight fails cleanly.
  matrix: 0.20,
  // Clean, but a single axis leaves fewer ways to build a convincing near-miss.
  series: 0.05,
  // Off-by-one-step distractors sort solvers cleanly: the step size is read right or not.
  progression: 0.08,
  // Surface oddity sometimes finds the answer without the rule, blunting the slope.
  oddOneOut: -0.15,
  // The A:B :: C:? frame makes partial mappings land on a distractor, not the key.
  analogy: 0.12,
  // Overlay outcomes are visually checkable, so lucky perceptual matches happen.
  overlay: -0.08,
  // Even low ability detects symmetry, which flattens the lower half of the curve.
  symmetry: -0.22,
  // Unambiguous answer, but speed/strategy differences add response noise.
  rotation: 0.00,
  // Mirror distractors split solvers sharply into those tracking parity and those not.
  mentalRotation: 0.06,
  // Wildly different strategies (simulate vs. reason about symmetry) flatten the curve.
  paperFolding: -0.10,
  // Same strategy spread as paperFolding.
  folding: -0.10,
  // Either you hold every constraint or you do not: an unusually sharp threshold.
  constraint: 0.15,
  // Same threshold effect, amplified by the number of interacting cells.
  constraintGrid: 0.18,
  // Integration succeeds or fails; there is little middle ground.
  relational: 0.22,
  // The steepest family we ship, for the same reason.
  relationalIntegration: 0.28,
  // Nearly everyone above the floor gets it, so it discriminates weakly.
  sizeOrdering: -0.20,
  // Middling: category errors are systematic but recoverable by elimination.
  classification: 0.02,
  // Extrapolation errors are systematic, which keeps the slope respectable.
  sequenceExtrapolation: 0.10
};

/**
 * The documented difficulty model. `docs/PSYCHOMETRICS.md` explains the derivation;
 * these are design-time priors, refined per item structure by `updateBank`.
 */
export const DIFFICULTY_MODEL = {
  B0: -1.10,
  B_RULES: 0.92,
  B_ABSTRACT: 0.55,
  B_WM: 0.38,
  B_ELEMENTS: 0.30,
  B_SALIENCE: 1.20,
  A0: 0.80,
  A_SYS: 1.10,
  A_SAL: 0.45,
  A_MIN: 0.45,
  A_MAX: 2.60,
  /** c = C_NUMERATOR / optionCount: deliberately below uniform chance. */
  C_NUMERATOR: 0.85,
  /** Prior sd of the b posterior held in the bank. */
  PRIOR_SD: 0.60,
  /** Damping of the online Newton step is 1 / (n + DAMPING). */
  DAMPING: 4,
  /** Hard cap on one undamped Newton step, so a single fluke cannot move b far. */
  MAX_STEP: 2.0,
  /** Fallbacks used when an observation does not carry the item's a / c. */
  A_TYPICAL: 1.20,
  C_TYPICAL: 0.85 / 8,
  B_FAMILY,
  A_FAMILY
};

const PRIOR_PRECISION = 1 / (DIFFICULTY_MODEL.PRIOR_SD * DIFFICULTY_MODEL.PRIOR_SD);

// Case-insensitive fallback lookup, so 'MentalRotation' and 'mentalrotation' both resolve.
const B_FAMILY_LC = lowerKeyed(B_FAMILY);
const A_FAMILY_LC = lowerKeyed(A_FAMILY);

function lowerKeyed(map) {
  const out = {};
  for (const k of Object.keys(map)) out[k.toLowerCase()] = map[k];
  return out;
}

function familyOffset(map, lcMap, family) {
  if (typeof family !== 'string' || family === '') return 0;
  if (Object.prototype.hasOwnProperty.call(map, family)) return map[family];
  const lc = family.toLowerCase();
  if (Object.prototype.hasOwnProperty.call(lcMap, lc)) return lcMap[lc];
  return 0;
}

/**
 * Element-count buckets for the structural item key. Two items with 7 and 9 elements are
 * the same kind of load, so they must pool their statistics; 4 and 16 must not.
 */
const ELEMENT_BUCKET_EDGES = [2, 4, 6, 9, 12, 16];

function elementBucket(count) {
  const n = Math.max(0, Math.round(num(count, 4)));
  for (let i = 0; i < ELEMENT_BUCKET_EDGES.length; i++) {
    if (n <= ELEMENT_BUCKET_EDGES[i]) return i;
  }
  return ELEMENT_BUCKET_EDGES.length;
}

/**
 * Design-time 3PL parameters for an item, from its meta and family.
 * `family` is optional: it falls back to `meta.family` when the caller omits it.
 */
export function priorIrtParams(meta, family) {
  const m = meta && typeof meta === 'object' ? meta : {};
  const fam = typeof family === 'string' && family ? family : (typeof m.family === 'string' ? m.family : '');
  const M = DIFFICULTY_MODEL;

  const ruleCount = Math.max(0, num(m.ruleCount, 1));
  const abstractness = Math.max(0, num(m.abstractness, 1));
  const wmLoad = Math.max(0, num(m.wmLoad, 1));
  const elementCount = Math.max(1, num(m.elementCount, 4));
  const salience = clamp01(num(m.perceptualSalience, 0));
  const systematicity = clamp01(num(m.distractorSystematicity, 0));
  const optionCount = Math.max(2, Math.round(num(m.optionCount, 8)));

  const bRaw = M.B0
    + M.B_RULES * (ruleCount - 1)
    + M.B_ABSTRACT * (abstractness - 1)
    + M.B_WM * (wmLoad - 1)
    + M.B_ELEMENTS * Math.log2(elementCount / 4)
    - M.B_SALIENCE * salience
    + familyOffset(M.B_FAMILY, B_FAMILY_LC, fam);

  const aRaw = M.A0
    + M.A_SYS * systematicity
    - M.A_SAL * salience
    + familyOffset(M.A_FAMILY, A_FAMILY_LC, fam);

  return {
    a: clamp(Number.isFinite(aRaw) ? aRaw : M.A0, M.A_MIN, M.A_MAX),
    b: clamp(Number.isFinite(bRaw) ? bRaw : M.B0, THETA_MIN, THETA_MAX),
    c: M.C_NUMERATOR / optionCount
  };
}

/**
 * Structural signature of an item: family, sorted rule types, rule count, wm load,
 * element-count bucket and option count. The seed is deliberately absent so that every
 * instance of the same structure pools its statistics in the bank.
 */
export function itemKey(item) {
  const it = item && typeof item === 'object' ? item : {};
  const meta = it.meta && typeof it.meta === 'object' ? it.meta : {};
  const family = typeof it.family === 'string' && it.family
    ? it.family
    : (typeof meta.family === 'string' && meta.family ? meta.family : 'unknown');

  const ruleTypes = Array.isArray(meta.ruleTypes)
    ? meta.ruleTypes.filter((t) => typeof t === 'string' && t !== '').slice().sort()
    : [];
  const ruleCount = Math.max(0, Math.round(num(meta.ruleCount, ruleTypes.length)));
  const wmLoad = Math.max(0, Math.round(num(meta.wmLoad, 1)));
  const bucket = elementBucket(meta.elementCount);
  const optionCount = Math.max(
    0,
    Math.round(num(meta.optionCount, Array.isArray(it.options) ? it.options.length : 8))
  );

  return [
    family,
    ruleTypes.length ? ruleTypes.join('+') : '-',
    `r${ruleCount}`,
    `w${wmLoad}`,
    `e${bucket}`,
    `o${optionCount}`
  ].join('|');
}

/**
 * One damped Newton step of the b posterior for a single administration.
 *
 * With P = c + (1-c)*Q, Q = logistic(D*a*(theta-b)):
 *   dP/db  = -D*a*(1-c)*Q*(1-Q) = -D*a*(P-c)*(1-P)/(1-c)
 *   dl/db  = (u-P)/(P*(1-P)) * dP/db = -D*a*(P-c)*(u-P) / ((1-c)*P)
 * and the Fisher information for b equals `info3pl` (dP/db = -dP/dtheta).
 *
 * The step is `score / (info + priorPrecision)` - the prior precision only regularises the
 * step size, the prior *mean* is applied later by `blendedParams` - damped by 1/(n+4).
 *
 * `bank` is mutated in place and returned. Beyond the contract's `{ key, theta, correct }`
 * the observation may optionally carry the item's `a`, `c` (used for the likelihood) and
 * `b` (the model prior, used only to seed a brand-new entry); all three have safe defaults.
 */
export function updateBank(bank, observation) {
  const target = bank && typeof bank === 'object' ? bank : {};
  const obs = observation && typeof observation === 'object' ? observation : {};
  const key = typeof obs.key === 'string' ? obs.key : '';
  if (!key) return target;

  const M = DIFFICULTY_MODEL;
  const prev = target[key] && typeof target[key] === 'object' ? target[key] : null;
  const n = prev ? Math.max(0, Math.round(num(prev.n, 0))) : 0;
  const startB = prev && Number.isFinite(Number(prev.b))
    ? Number(prev.b)
    : clamp(num(obs.b, 0), THETA_MIN, THETA_MAX);
  const sumInfo = prev ? Math.max(0, num(prev.sumInfo, 0)) : 0;

  const a = num(obs.a, M.A_TYPICAL) > 0 ? num(obs.a, M.A_TYPICAL) : M.A_TYPICAL;
  const cRaw = num(obs.c, M.C_TYPICAL);
  const c = cRaw >= 0 && cRaw < 0.95 ? cRaw : M.C_TYPICAL;
  const theta = clamp(num(obs.theta, 0), THETA_MIN, THETA_MAX);
  const u = obs.correct ? 1 : 0;

  const params = { a, b: startB, c };
  const p = clamp(p3pl(theta, params), 1e-9, 1 - 1e-9);
  const score = -D * a * (p - c) * (u - p) / ((1 - c) * p);
  const info = info3pl(theta, params);
  const denom = info + PRIOR_PRECISION;
  const raw = Number.isFinite(score) && denom > 0 ? score / denom : 0;
  const step = clamp(raw, -M.MAX_STEP, M.MAX_STEP) / (n + M.DAMPING);

  target[key] = {
    n: n + 1,
    b: clamp(startB + step, THETA_MIN, THETA_MAX),
    sumInfo: sumInfo + (Number.isFinite(info) ? info : 0)
  };
  return target;
}

/** Aggregate view of the bank, for the progress screen and the simulation report. */
export function bankSummary(bank) {
  const entries = bank && typeof bank === 'object' ? Object.keys(bank) : [];
  let items = 0;
  let observations = 0;
  let sumB = 0;
  let sumSq = 0;
  let sumSe = 0;
  let minB = Infinity;
  let maxB = -Infinity;
  let wellEstimated = 0;

  for (const key of entries) {
    const e = bank[key];
    if (!e || typeof e !== 'object') continue;
    const b = Number(e.b);
    if (!Number.isFinite(b)) continue;
    const n = Math.max(0, Math.round(num(e.n, 0)));
    const info = Math.max(0, num(e.sumInfo, 0));
    items += 1;
    observations += n;
    sumB += b;
    sumSq += b * b;
    sumSe += 1 / Math.sqrt(info + PRIOR_PRECISION);
    if (b < minB) minB = b;
    if (b > maxB) maxB = b;
    if (n >= 10) wellEstimated += 1;
  }

  if (items === 0) {
    return {
      items: 0, observations: 0, meanN: 0, meanB: 0, sdB: 0,
      minB: null, maxB: null, meanSe: null, wellEstimated: 0
    };
  }
  const meanB = sumB / items;
  const variance = items > 1 ? Math.max(0, (sumSq - items * meanB * meanB) / (items - 1)) : 0;
  return {
    items,
    observations,
    meanN: observations / items,
    meanB,
    sdB: Math.sqrt(variance),
    minB,
    maxB,
    meanSe: sumSe / items,
    wellEstimated
  };
}

/**
 * Model prior blended with whatever the bank has learned, by precision weighting:
 * b = (priorPrecision*bPrior + sumInfo*bPosterior) / (priorPrecision + sumInfo).
 * An unseen structure returns the prior unchanged. Only b is learned; a and c stay at
 * their design values (the bank never sees enough data per structure to move them).
 */
export function blendedParams(item, bank) {
  const it = item && typeof item === 'object' ? item : {};
  const irt = it.irt && typeof it.irt === 'object' ? it.irt : null;
  const prior = irt && Number.isFinite(Number(irt.a)) && Number.isFinite(Number(irt.b))
    && Number.isFinite(Number(irt.c))
    ? { a: Number(irt.a), b: Number(irt.b), c: Number(irt.c) }
    : priorIrtParams(it.meta, it.family);

  if (!bank || typeof bank !== 'object') return prior;
  const entry = bank[itemKey(it)];
  if (!entry || typeof entry !== 'object') return prior;
  const posteriorB = Number(entry.b);
  const n = Math.max(0, Math.round(num(entry.n, 0)));
  if (!Number.isFinite(posteriorB) || n <= 0) return prior;

  const dataPrecision = Math.max(0, num(entry.sumInfo, 0));
  const b = (PRIOR_PRECISION * prior.b + dataPrecision * posteriorB) / (PRIOR_PRECISION + dataPrecision);
  return {
    a: prior.a,
    b: clamp(Number.isFinite(b) ? b : prior.b, THETA_MIN, THETA_MAX),
    c: prior.c
  };
}
