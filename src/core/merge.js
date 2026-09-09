/**
 * Merges two profiles that diverged on different devices. Every rule here is a
 * join-semilattice operation -- idempotent, commutative and associative -- so a
 * sync loop that runs repeatedly converges instead of oscillating, and no device
 * can erase work done on another. See docs/SYNC.md for the reasoning per field.
 */

const FACTORS = ['induction', 'spatial', 'workingMemory', 'relational', 'speed', 'flexibility'];
const STATUSES = ['new', 'qualified', 'eliminated'];
const QUALIFY_INDEX = 100;

function isObj(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function num(v, fallback = 0) {
  return Number.isFinite(v) ? v : fallback;
}

/** max() that treats null/undefined as "no opinion" rather than as zero. */
function maxOrNull(a, b) {
  const av = Number.isFinite(a) ? a : null;
  const bv = Number.isFinite(b) ? b : null;
  if (av === null) return bv;
  if (bv === null) return av;
  return Math.max(av, bv);
}

function minOrNull(a, b) {
  const av = Number.isFinite(a) ? a : null;
  const bv = Number.isFinite(b) ? b : null;
  if (av === null) return bv;
  if (bv === null) return av;
  return Math.min(av, bv);
}

/** Union of two keyed maps, combining shared keys with `combine`. */
function mergeMap(a, b, combine) {
  const out = Object.create(null);
  const left = isObj(a) ? a : {};
  const right = isObj(b) ? b : {};
  for (const key of Object.keys(left)) {
    // Never let a stored key rewrite Object.prototype.
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
    out[key] = left[key];
  }
  for (const key of Object.keys(right)) {
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
    out[key] = Object.prototype.hasOwnProperty.call(out, key)
      ? combine(out[key], right[key])
      : right[key];
  }
  return { ...out };
}

/**
 * Assessments are append-only history: union them, keyed by the instant they were
 * taken. Two records with the same `at` are the same administration seen twice.
 */
function mergeAssessments(a, b) {
  const seen = new Map();
  for (const list of [Array.isArray(a) ? a : [], Array.isArray(b) ? b : []]) {
    for (const rec of list) {
      if (!isObj(rec)) continue;
      const at = num(rec.at, null);
      if (at === null) continue;
      const key = at + ':' + num(rec.index, 0);
      // Prefer the richer record when the same administration arrives twice.
      const prev = seen.get(key);
      if (!prev || Object.keys(rec).length > Object.keys(prev).length) seen.set(key, rec);
    }
  }
  return [...seen.values()].sort((x, y) => num(x.at, 0) - num(y.at, 0));
}

/** One level's progress. Every field takes the better of the two. */
function mergeLevel(x, y) {
  const a = isObj(x) ? x : {};
  const b = isObj(y) ? y : {};
  return {
    unlocked: !!(a.unlocked || b.unlocked),
    stars: Math.max(num(a.stars), num(b.stars)),
    bestScore: Math.max(num(a.bestScore), num(b.bestScore)),
    bestLevel: Math.max(num(a.bestLevel), num(b.bestLevel)),
    // max, not sum: sum is not idempotent, so repeated merges would inflate it
    // without bound. This is "most attempts seen on any one device", and the
    // trade-off is recorded in docs/SYNC.md rather than hidden.
    attempts: Math.max(num(a.attempts), num(b.attempts)),
    lastAt: Math.max(num(a.lastAt), num(b.lastAt))
  };
}

/**
 * Per-drill statistics. Rates come from whichever side has more evidence.
 * Equal evidence is a genuine tie with nothing to choose between the two, so it
 * breaks on the value itself rather than on argument order -- otherwise the merge
 * stops being commutative and two devices never converge.
 */
function mergeDrillStat(x, y) {
  const a = isObj(x) ? x : {};
  const b = isObj(y) ? y : {};
  const aTrials = num(a.totalTrials);
  const bTrials = num(b.totalTrials);
  const richer = bTrials > aTrials ? b
    : bTrials < aTrials ? a
      : (num(b.accuracy) < num(a.accuracy) ? b : a);
  return {
    sessions: Math.max(num(a.sessions), num(b.sessions)),
    totalTrials: Math.max(aTrials, bTrials),
    bestLevel: Math.max(num(a.bestLevel), num(b.bestLevel)),
    accuracy: num(richer.accuracy, num(a.accuracy, num(b.accuracy, 0))),
    msPerTrial: num(richer.msPerTrial, num(a.msPerTrial, num(b.msPerTrial, 0)))
  };
}

/**
 * Item calibration. `n` is an observation count, so the side with more
 * observations carries the better estimate of `b`; taking that record wholesale
 * keeps b and its evidence consistent with each other and stays idempotent.
 */
function mergeBankEntry(x, y) {
  const a = isObj(x) ? x : {};
  const b = isObj(y) ? y : {};
  const an = num(a.n);
  const bn = num(b.n);
  const sumInfo = Math.max(num(a.sumInfo), num(b.sumInfo));
  // Winner is the maximum under the total order (n desc, b asc). A total order
  // makes the choice commutative and associative; picking `a` on a tie would
  // silently make the result depend on which device happened to sync first.
  let win = a;
  if (bn > an) win = b;
  else if (bn === an && num(b.b) < num(a.b)) win = b;
  return { n: Math.max(an, bn), b: num(win.b), sumInfo };
}

function mergeFactorScores(a, b) {
  const left = isObj(a) ? a : {};
  const right = isObj(b) ? b : {};
  const out = {};
  for (const f of FACTORS) out[f] = Math.max(num(left[f]), num(right[f]));
  return out;
}

/**
 * Preferences are the one genuinely last-write-wins field: they express what a
 * person wants right now, not work they accumulated, so "the newer choice" is the
 * correct answer rather than "the larger value".
 */
function mergeSettings(a, b, cmp) {
  const left = isObj(a) ? a : {};
  const right = isObj(b) ? b : {};
  // cmp > 0 means `a` is the newer choice. On an exact clock tie, fall back to a
  // stable comparison of the values so two devices cannot flip-flop forever.
  let aWins = cmp > 0;
  if (cmp === 0) aWins = JSON.stringify(left) <= JSON.stringify(right);
  return aWins ? { ...right, ...left } : { ...left, ...right };
}

function mergeStreak(a, b) {
  const left = isObj(a) ? a : {};
  const right = isObj(b) ? b : {};
  return {
    days: Math.max(num(left.days), num(right.days)),
    lastDay: Math.max(num(left.lastDay), num(right.lastDay))
  };
}

/**
 * Status and current index are DERIVED from the merged assessment history rather
 * than merged directly. The most recent administration is the truth: if someone
 * re-tested and fell below the cut, the newer result stands, and a stale
 * qualified record from another device cannot resurrect access. Peak index is
 * kept separately and never regresses.
 */
function deriveStanding(assessments, a, b) {
  const latest = assessments.length ? assessments[assessments.length - 1] : null;
  const indices = assessments.map((r) => num(r.index, null)).filter((v) => v !== null);

  let currentIndex = latest && Number.isFinite(latest.index)
    ? latest.index
    : maxOrNull(a.currentIndex, b.currentIndex);
  if (!Number.isFinite(currentIndex)) currentIndex = null;

  let peakIndex = maxOrNull(a.peakIndex, b.peakIndex);
  for (const v of indices) peakIndex = maxOrNull(peakIndex, v);
  if (currentIndex !== null) peakIndex = maxOrNull(peakIndex, currentIndex);

  let status;
  if (currentIndex === null) {
    // No measurement anywhere: fall back to whichever recorded status is furthest
    // along, so a fresh device does not reset a known standing.
    const known = [a.status, b.status].filter((s) => STATUSES.indexOf(s) >= 0);
    status = known.includes('qualified') ? 'qualified'
      : known.includes('eliminated') ? 'eliminated' : 'new';
  } else {
    status = currentIndex >= QUALIFY_INDEX ? 'qualified' : 'eliminated';
  }

  return { status, currentIndex, peakIndex };
}

/**
 * Merge two profiles into one that dominates both.
 * Pure: neither input is mutated.
 */
export function mergeProfiles(local, remote) {
  if (!isObj(local) && !isObj(remote)) return null;
  if (!isObj(remote)) return { ...local };
  if (!isObj(local)) return { ...remote };

  const a = local;
  const b = remote;
  const clockCmp = Math.sign(num(a.updatedAt) - num(b.updatedAt));

  const assessments = mergeAssessments(a.assessments, b.assessments);
  const standing = deriveStanding(assessments, a, b);

  return {
    version: Math.max(num(a.version, 1), num(b.version, 1)),
    createdAt: minOrNull(a.createdAt, b.createdAt) ?? num(a.createdAt, num(b.createdAt, 0)),
    updatedAt: Math.max(num(a.updatedAt), num(b.updatedAt)),

    status: standing.status,
    currentIndex: standing.currentIndex,
    peakIndex: standing.peakIndex,
    // Tier gates which levels are open. Taking the max means a merge can never
    // re-lock content a person had already unlocked on another device.
    tier: Math.max(num(a.tier), num(b.tier)),

    assessments,
    // max, not sum -- see mergeLevel.
    xp: Math.max(num(a.xp), num(b.xp)),
    levels: mergeMap(a.levels, b.levels, mergeLevel),
    drillStats: mergeMap(a.drillStats, b.drillStats, mergeDrillStat),
    factorScores: mergeFactorScores(a.factorScores, b.factorScores),
    bank: mergeMap(a.bank, b.bank, mergeBankEntry),
    settings: mergeSettings(a.settings, b.settings, clockCmp),
    streak: mergeStreak(a.streak, b.streak)
  };
}

/** True when `candidate` carries nothing that `base` does not already have. */
export function isSubsumed(base, candidate) {
  const merged = mergeProfiles(base, candidate);
  return JSON.stringify(merged) === JSON.stringify(mergeProfiles(base, base));
}
