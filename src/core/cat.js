/**
 * Computerised adaptive test: maximum-information item selection with randomesque
 * exposure control and content balancing, WLE re-estimation after every response, and
 * the index-100 elimination cut, which must be *resolved* before the session may stop.
 */

import {
  info3pl,
  testInfo,
  seFromInfo,
  bForMaxInfoAt,
  estimateWLE,
  reliability
} from './irt.js';
import { thetaToIndex, confidenceInterval } from './scale.js';
import { makeRng } from './rng.js';
import { FAMILIES, generateItemAtDifficulty } from '../items/registry.js';
import { blendedParams, itemKey } from '../items/calibration.js';

/** Contract defaults; every one of these may be overridden per session. */
export const CAT_DEFAULTS = Object.freeze({
  minItems: 18,
  maxItems: 40,
  targetSE: 0.30,
  optionCount: 8,
  cutIndex: 100,
  ciLevel: 0.90,
  warmup: 4
});

/** Warmup targets a slightly-above-average ability so a first wrong answer is not fatal. */
const WARMUP_THETA = 0.3;
/** Randomesque exposure control: rank this many candidates, pick among the best few. */
const CANDIDATES = 6;
const TOP_K = 3;
/** Typical discrimination, used only to place the target b. */
const A_TYPICAL = 1.20;
/** Content-balance caps from the contract. */
const GROUP_CAP = 0.40;
const FAMILY_CAP = 0.25;
/** Reported information curve. */
const CURVE_MIN = -3;
const CURVE_MAX = 6;
const CURVE_STEP = 0.25;
/** Only used when the caller supplies neither `rng` nor `seed` (it should supply one). */
const DEFAULT_SEED = 'eqgame:cat:v1';

function num(v, fallback) {
  const x = Number(v);
  return Number.isFinite(x) ? x : fallback;
}

function clamp(x, lo, hi) {
  return x < lo ? lo : x > hi ? hi : x;
}

function finiteOrNull(x) {
  return Number.isFinite(x) ? x : null;
}

/** Median of a list; 0 when nothing was timed (skips and untimed items are excluded). */
function median(values) {
  if (values.length === 0) return 0;
  const sorted = values.slice().sort((p, q) => p - q);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Normalise whatever the registry (or a test seam) offers into `{family, contentGroup}`. */
function normaliseCatalog(list) {
  const out = [];
  if (!Array.isArray(list)) return out;
  for (const entry of list) {
    if (!entry || typeof entry !== 'object') continue;
    const family = typeof entry.family === 'string' ? entry.family : null;
    if (!family) continue;
    const group = typeof entry.contentGroup === 'string' && entry.contentGroup
      ? entry.contentGroup
      : 'other';
    out.push({ family, contentGroup: group });
  }
  return out;
}

function usableItem(item) {
  return !!item
    && typeof item === 'object'
    && typeof item.id === 'string'
    && typeof item.answerId === 'string'
    && Array.isArray(item.options)
    && item.options.length > 0;
}

/**
 * Create an adaptive session.
 *
 * `opts`:
 *   rng | seed          - the session's randomness (pass one; the default seed is fixed)
 *   minItems, maxItems, targetSE, optionCount, cutIndex, ciLevel, warmup
 *   bank                - profile item bank, used to blend learned difficulties
 *   families            - optional whitelist of family keys
 *   exclude             - optional Set of item ids never to administer
 *   itemSource          - TEST SEAM: `(rng, spec) => Item`. Optional; defaults to
 *                         `registry.generateItemAtDifficulty`, so production behaviour is
 *                         unchanged. Tests inject a fake bank of items with known IRT
 *                         parameters, which keeps the CAT suite independent of the
 *                         generators.
 *   familyCatalog       - TEST SEAM: `[{family, contentGroup}]` used for content balance.
 *                         Optional; defaults to the registry's `FAMILIES`.
 */
export function createSession(opts) {
  const options = opts && typeof opts === 'object' ? opts : {};

  const minItems = Math.max(1, Math.round(num(options.minItems, CAT_DEFAULTS.minItems)));
  const maxItems = Math.max(minItems, Math.round(num(options.maxItems, CAT_DEFAULTS.maxItems)));
  const targetSE = Math.max(1e-6, num(options.targetSE, CAT_DEFAULTS.targetSE));
  const optionCount = Math.max(2, Math.round(num(options.optionCount, CAT_DEFAULTS.optionCount)));
  const cutIndex = num(options.cutIndex, CAT_DEFAULTS.cutIndex);
  const ciLevel = clamp(num(options.ciLevel, CAT_DEFAULTS.ciLevel), 0.5, 0.999);
  const warmup = clamp(Math.round(num(options.warmup, CAT_DEFAULTS.warmup)), 0, maxItems);

  const config = { minItems, maxItems, targetSE, optionCount, cutIndex, ciLevel, warmup };

  const rng = options.rng && typeof options.rng.next === 'function'
    ? options.rng
    : makeRng(options.seed === undefined || options.seed === null ? DEFAULT_SEED : options.seed);
  const seedLabel = options.seed === undefined || options.seed === null
    ? (options.rng ? null : DEFAULT_SEED)
    : String(options.seed);

  const itemSource = typeof options.itemSource === 'function'
    ? options.itemSource
    : generateItemAtDifficulty;

  const catalog = normaliseCatalog(
    Array.isArray(options.familyCatalog) ? options.familyCatalog : FAMILIES
  );
  const whitelist = Array.isArray(options.families) && options.families.length
    ? new Set(options.families.filter((f) => typeof f === 'string'))
    : null;
  const catalogFamilies = catalog
    .map((f) => f.family)
    .filter((f) => !whitelist || whitelist.has(f));
  const groupOf = new Map(catalog.map((f) => [f.family, f.contentGroup]));

  // c of a typical item at this option count: it only shifts the target b slightly.
  const cTypical = 0.85 / optionCount;

  const excluded = options.exclude instanceof Set
    ? new Set(options.exclude)
    : new Set(Array.isArray(options.exclude) ? options.exclude : []);

  const history = [];
  const familyCounts = new Map();
  const groupCounts = new Map();
  const usedKeys = new Set();

  let n = 0;
  let theta = 0;
  let se = Infinity;
  let done = false;
  let reason = null;
  let pending = null;        // the Item currently on screen
  let pendingRecord = null;  // its light, JSON-safe record
  let precisionMetAt = null; // first n at which minItems + targetSE were both satisfied

  function groupFor(family) {
    return groupOf.get(family) || 'other';
  }

  function countOf(map, key) {
    return map.get(key) || 0;
  }

  /**
   * Caps are enforced prospectively against `max(n + 1, minItems)`: measuring a 25% cap
   * against a handful of items would block every family on item one. Because the
   * denominator never shrinks, this still guarantees the exact caps hold for the final
   * set whenever the session reaches `minItems` - which it always does.
   */
  function capDenominator() {
    return Math.max(n + 1, minItems);
  }

  function allowedFamilies(useFamilyCap, useGroupCap) {
    const denom = capDenominator();
    const out = [];
    for (const family of catalogFamilies) {
      if (useFamilyCap && countOf(familyCounts, family) + 1 > FAMILY_CAP * denom) continue;
      if (useGroupCap) {
        const group = groupFor(family);
        if (countOf(groupCounts, group) + 1 > GROUP_CAP * denom) continue;
      }
      out.push(family);
    }
    return out;
  }

  /** The caller's whitelist, used whenever content balancing has nothing to say. */
  function whitelistOnly() {
    return whitelist ? Array.from(whitelist) : null;
  }

  /** Families to offer the generator, plus which cap (if any) had to be relaxed. */
  function familyPlan() {
    // No catalogue to balance against - but an explicit whitelist is still a caller
    // instruction, so pass it through rather than silently opening the pool up.
    if (catalogFamilies.length === 0) return { families: whitelistOnly(), relaxed: null };
    let families = allowedFamilies(true, true);
    if (families.length) return { families, relaxed: null };
    families = allowedFamilies(false, true);
    if (families.length) return { families, relaxed: 'family' };
    return { families: catalogFamilies.slice(), relaxed: 'group' };
  }

  /** Item parameters used for ranking: the item's own priors (bank blending is for theta). */
  function priorOf(item) {
    return blendedParams(item, null);
  }

  function targetBFor(atTheta) {
    return bForMaxInfoAt(atTheta, A_TYPICAL, cTypical);
  }

  function generateCandidates(spec, index) {
    const out = [];
    for (let i = 0; i < CANDIDATES; i++) {
      const tag = `cat:item:${index}:${i}`;
      const forked = typeof rng.fork === 'function' ? rng.fork(tag) : rng;
      let item = null;
      try {
        item = itemSource(forked, spec);
      } catch (err) {
        item = null;
      }
      if (usableItem(item)) out.push(item);
    }
    return out;
  }

  function selectItem() {
    const atTheta = n < warmup ? WARMUP_THETA : theta;
    const targetB = targetBFor(atTheta);
    const plan = familyPlan();

    const spec = {
      targetB,
      optionCount,
      families: plan.families,
      exclude: excluded,
      bank: options.bank || null,
      maxTries: 24
    };

    let candidates = generateCandidates(spec, n);
    if (candidates.length === 0 && plan.families) {
      // The families the caps left us produced nothing usable: drop the caps rather than
      // strand the session. A caller-supplied whitelist is NOT a cap and is never dropped -
      // widening past it would answer a question the caller did not ask.
      const widest = whitelist ? (catalogFamilies.length ? catalogFamilies : whitelistOnly()) : null;
      if (!(widest && plan.families.length === widest.length)) {
        candidates = generateCandidates({ ...spec, families: widest }, n);
        if (candidates.length) plan.relaxed = 'group';
      }
    }
    if (candidates.length === 0) {
      throw new Error('cat: item source produced no usable item');
    }

    // Prefer structures this session has not shown yet; fall back if that empties the pool.
    const fresh = candidates.filter((it) => !excluded.has(it.id) && !usedKeys.has(itemKey(it)));
    const pool = fresh.length ? fresh : candidates;

    const ranked = pool
      .map((item) => ({ item, info: info3pl(atTheta, priorOf(item)) }))
      .sort((p, q) => q.info - p.info);
    const top = ranked.slice(0, Math.min(TOP_K, ranked.length));
    const chosen = top[rng.int(0, top.length)] || top[0];

    return { item: chosen.item, targetB, relaxed: plan.relaxed, atTheta };
  }

  function reestimate() {
    if (history.length === 0) {
      theta = 0;
      se = Infinity;
      return;
    }
    const responses = history.map((r) => ({
      a: r.params.a,
      b: r.params.b,
      c: r.params.c,
      correct: r.correct
    }));
    const est = estimateWLE(responses);
    if (est && Number.isFinite(est.theta)) theta = est.theta;
    se = est && Number.isFinite(est.se) ? est.se : Infinity;
  }

  function currentCi() {
    const ci = confidenceInterval(theta, se, ciLevel);
    return {
      lo: Number.isFinite(ci.lo) ? ci.lo : 40,
      hi: Number.isFinite(ci.hi) ? ci.hi : 200
    };
  }

  /**
   * Stopping rule. Precision alone is never enough: while `n < maxItems`, a confidence
   * interval that still contains the cut keeps the session running, because the whole
   * product decision hangs on which side of 100 the candidate is.
   *
   * `finishedReason` distinguishes the two precision stops: 'precision' when the session
   * stopped on the very item that first reached `targetSE` (the cut was never in doubt),
   * 'decisive' when precision had already been met earlier and the extra items were spent
   * clearing the interval off the cut.
   */
  function evaluateStop() {
    const precise = n >= minItems && se <= targetSE;
    if (precise && precisionMetAt === null) precisionMetAt = n;

    if (precise) {
      const ci = currentCi();
      const excludesCut = ci.lo > cutIndex || ci.hi < cutIndex;
      if (excludesCut) {
        done = true;
        reason = precisionMetAt === n ? 'precision' : 'decisive';
        return;
      }
    }
    if (n >= maxItems) {
      done = true;
      reason = 'maxItems';
    }
  }

  function recordResponse(chosenId, rtMs, skipped) {
    if (!pending || !pendingRecord) {
      throw new Error('cat: no item is pending; call nextItem() first');
    }
    const item = pending;
    const record = pendingRecord;
    pending = null;
    pendingRecord = null;

    // An absent or nonsensical reaction time is recorded as "not measured", never as 0.
    const rt = rtMs === null || rtMs === undefined || rtMs === '' ? NaN : Number(rtMs);
    record.chosenId = typeof chosenId === 'string' ? chosenId : null;
    record.correct = !skipped && typeof chosenId === 'string' && chosenId === item.answerId;
    record.skipped = !!skipped;
    record.rtMs = Number.isFinite(rt) && rt >= 0 ? rt : null;

    history.push(record);
    n += 1;
    familyCounts.set(record.family, countOf(familyCounts, record.family) + 1);
    groupCounts.set(record.contentGroup, countOf(groupCounts, record.contentGroup) + 1);
    usedKeys.add(record.itemKey);

    reestimate();
    record.thetaAfter = theta;
    record.seAfter = finiteOrNull(se);
    evaluateStop();

    return {
      correct: record.correct,
      theta,
      se,
      index: thetaToIndex(theta),
      done
    };
  }

  function paramsList() {
    return history.map((r) => r.params);
  }

  function breakdown(pick) {
    const out = {};
    for (const record of history) {
      const key = pick(record);
      let bucket = out[key];
      if (!bucket) {
        bucket = { n: 0, correct: 0, sumB: 0 };
        out[key] = bucket;
      }
      bucket.n += 1;
      if (record.correct) bucket.correct += 1;
      bucket.sumB += record.params.b;
    }
    const result = {};
    for (const key of Object.keys(out)) {
      const bucket = out[key];
      result[key] = {
        n: bucket.n,
        pctCorrect: bucket.n ? bucket.correct / bucket.n : 0, // proportion in [0, 1]
        meanB: bucket.n ? bucket.sumB / bucket.n : 0
      };
    }
    return result;
  }

  function informationCurve() {
    const items = paramsList();
    const points = [];
    const steps = Math.round((CURVE_MAX - CURVE_MIN) / CURVE_STEP);
    for (let i = 0; i <= steps; i++) {
      const t = CURVE_MIN + i * CURVE_STEP;
      const info = testInfo(t, items);
      points.push({ theta: t, info, se: finiteOrNull(seFromInfo(info)) });
    }
    return points;
  }

  const session = {
    /** The next item to administer, or null once the session is finished. */
    nextItem() {
      if (done) return null;
      if (pending) return pending;

      const picked = selectItem();
      const item = picked.item;
      const params = blendedParams(item, options.bank || null);
      const prior = priorOf(item);
      const key = itemKey(item);
      const family = typeof item.family === 'string' ? item.family : 'unknown';

      pending = item;
      pendingRecord = {
        order: n + 1,
        itemId: item.id,
        itemKey: key,
        family,
        contentGroup: groupFor(family),
        irt: { a: prior.a, b: prior.b, c: prior.c },
        params: { a: params.a, b: params.b, c: params.c },
        targetB: picked.targetB,
        atTheta: picked.atTheta,
        relaxed: picked.relaxed,
        chosenId: null,
        correct: false,
        skipped: false,
        rtMs: null,
        thetaAfter: theta,
        seAfter: finiteOrNull(se)
      };
      excluded.add(item.id);
      return item;
    },

    /** Grade the pending item. Anything that is not the key counts as incorrect. */
    submit(optionId, rtMs) {
      return recordResponse(optionId, rtMs, false);
    },

    /** A skipped item counts as incorrect and is flagged as such in the history. */
    skip() {
      return recordResponse(null, null, true);
    },

    get state() {
      return {
        n,
        theta,
        se,
        done,
        reason,
        history: history.map((r) => ({ ...r, irt: { ...r.irt }, params: { ...r.params } }))
      };
    },

    result() {
      const index = thetaToIndex(theta);
      const ci = currentCi();
      const rts = history
        .filter((r) => !r.skipped && Number.isFinite(r.rtMs))
        .map((r) => r.rtMs);
      return {
        index,
        ci,
        theta,
        se,
        reliability: reliability(se),
        eliminated: index < cutIndex,
        itemsUsed: n,
        medianRtMs: median(rts),
        byFamily: breakdown((r) => r.family),
        byContentGroup: breakdown((r) => r.contentGroup),
        informationCurve: informationCurve(),
        finishedReason: reason
      };
    },

    /** Plain JSON-safe state: ids, IRT parameters, family, correctness, timing. */
    serialize() {
      return {
        version: 1,
        seed: seedLabel,
        config: { ...config },
        n,
        theta,
        se: finiteOrNull(se),
        done,
        reason,
        pendingItemId: pending ? pending.id : null,
        precisionMetAt,
        familyCounts: Object.fromEntries(familyCounts),
        groupCounts: Object.fromEntries(groupCounts),
        responses: history.map((r) => ({
          order: r.order,
          itemId: r.itemId,
          itemKey: r.itemKey,
          family: r.family,
          contentGroup: r.contentGroup,
          irt: { ...r.irt },
          params: { ...r.params },
          targetB: r.targetB,
          relaxed: r.relaxed,
          chosenId: r.chosenId,
          correct: r.correct,
          skipped: r.skipped,
          rtMs: r.rtMs,
          thetaAfter: r.thetaAfter,
          seAfter: r.seAfter
        }))
      };
    }
  };

  return session;
}
