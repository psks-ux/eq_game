/**
 * Profile persistence. Owns the `eqgame.profile.v1` record: schema defaults,
 * forward-compatible migration, export/import, and a storage backend that
 * degrades to an in-memory store when localStorage is missing or throws.
 */

const STORAGE_KEY = 'eqgame.profile.v1';
const PROBE_KEY = 'eqgame.probe.v1';
const CURRENT_VERSION = 1;

/* Assigning this as a data key on a plain object literal rewrites its
 * prototype instead of adding an entry, so hostile JSON is dropped on sight. */
const PROTO_KEY = '__proto__';

const STATUSES = ['new', 'qualified', 'eliminated'];
const FACTOR_KEYS = [
  'induction', 'spatial', 'workingMemory', 'relational', 'speed', 'flexibility'
];
const MAX_TIER = 5;
const QUALIFY_INDEX = 100;

/* ------------------------------------------------------------------ *
 * Storage backends
 * ------------------------------------------------------------------ */

/** Always-available fallback used when the real storage is unusable. */
const memoryStorage = (() => {
  const map = new Map();
  return {
    kind: 'memory',
    getItem(key) {
      const k = String(key);
      return map.has(k) ? map.get(k) : null;
    },
    setItem(key, value) {
      map.set(String(key), String(value));
    },
    removeItem(key) {
      map.delete(String(key));
    }
  };
})();

let probedRef = null;
let probedOk = false;

/**
 * Testable seam: resolve the storage backend lazily, every call, guarding the
 * `globalThis.localStorage` access itself (it throws in some sandboxes) and
 * probing with a real write (Safari private mode accepts the object but throws
 * on `setItem`). Returns `memoryStorage` whenever the real one is unusable.
 * @returns {{getItem:Function,setItem:Function,removeItem:Function}}
 */
function getStorage() {
  let ls = null;
  try {
    ls = globalThis.localStorage || null;
  } catch (_err) {
    return memoryStorage;
  }
  if (!ls || typeof ls.getItem !== 'function' || typeof ls.setItem !== 'function') {
    return memoryStorage;
  }
  if (ls === probedRef) return probedOk ? ls : memoryStorage;

  probedRef = ls;
  probedOk = false;
  try {
    ls.setItem(PROBE_KEY, '1');
    if (ls.getItem(PROBE_KEY) !== '1') return memoryStorage;
    if (typeof ls.removeItem === 'function') ls.removeItem(PROBE_KEY);
    probedOk = true;
    return ls;
  } catch (_err) {
    return memoryStorage;
  }
}

/**
 * Read the raw stored string, falling back to memory if the backend breaks
 * after the probe (quota, revoked permission, another tab clearing storage).
 * @returns {string|null}
 */
function readRaw() {
  const storage = getStorage();
  if (storage !== memoryStorage) {
    try {
      const value = storage.getItem(STORAGE_KEY);
      return typeof value === 'string' ? value : null;
    } catch (_err) {
      probedOk = false;
    }
  }
  try {
    const value = memoryStorage.getItem(STORAGE_KEY);
    return typeof value === 'string' ? value : null;
  } catch (_err) {
    return null;
  }
}

/** The backend object that received the most recent successful write. */
let lastBackend = null;

/**
 * Write the raw string. Always succeeds: a failing real backend is demoted and
 * the value is kept in memory for the rest of the page's life.
 * @param {string} raw
 * @returns {'local'|'memory'}
 */
function writeRaw(raw) {
  const storage = getStorage();
  if (storage !== memoryStorage) {
    try {
      storage.setItem(STORAGE_KEY, raw);
      lastBackend = storage;
      return 'local';
    } catch (_err) {
      probedOk = false;
    }
  }
  try {
    memoryStorage.setItem(STORAGE_KEY, raw);
    lastBackend = memoryStorage;
  } catch (_err) {
    // memoryStorage cannot throw, but never let persistence break the app.
  }
  return 'memory';
}

/** Remove the stored record from whichever backends hold it. */
function removeRaw() {
  const storage = getStorage();
  if (storage !== memoryStorage) {
    try {
      storage.removeItem(STORAGE_KEY);
    } catch (_err) {
      probedOk = false;
    }
  }
  try {
    memoryStorage.removeItem(STORAGE_KEY);
  } catch (_err) {
    // ignored
  }
  lastBackend = null;
}

/* ------------------------------------------------------------------ *
 * Coercion helpers
 * ------------------------------------------------------------------ */

function isPlainObject(v) {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function hasOwn(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

function nowMs() {
  return Date.now();
}

function numOr(value, fallback) {
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  return typeof n === 'number' && Number.isFinite(n) ? n : fallback;
}

function numOrNull(value) {
  return numOr(value, null);
}

function intOr(value, fallback, lo, hi) {
  let n = numOr(value, fallback);
  if (!Number.isFinite(n)) n = fallback;
  n = Math.round(n);
  if (typeof lo === 'number' && n < lo) n = lo;
  if (typeof hi === 'number' && n > hi) n = hi;
  return n;
}

function boolOr(value, fallback) {
  if (typeof value === 'boolean') return value;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return fallback;
}

function strOr(value, fallback) {
  return typeof value === 'string' && value.length > 0 ? value : fallback;
}

/** First defined (non-null) value among the arguments. */
function firstDefined(...values) {
  for (let i = 0; i < values.length; i += 1) {
    if (values[i] !== undefined && values[i] !== null) return values[i];
  }
  return undefined;
}

/* ------------------------------------------------------------------ *
 * Schema
 * ------------------------------------------------------------------ */

/**
 * A brand new, valid profile.
 * @returns {object}
 */
export function defaultProfile() {
  const at = nowMs();
  return {
    version: CURRENT_VERSION,
    createdAt: at,
    updatedAt: at,
    status: 'new',
    assessments: [],
    currentIndex: null,
    peakIndex: null,
    tier: 0,
    xp: 0,
    levels: {},
    drillStats: {},
    factorScores: {
      induction: 0,
      spatial: 0,
      workingMemory: 0,
      relational: 0,
      speed: 0,
      flexibility: 0
    },
    bank: {},
    settings: {
      reducedMotion: false,
      highContrast: false,
      showLabels: true,
      language: 'en',
      soundOn: true
    },
    streak: { days: 0, lastDay: null }
  };
}

function normalizeCi(raw) {
  if (!isPlainObject(raw)) return { lo: null, hi: null };
  return { lo: numOrNull(raw.lo), hi: numOrNull(raw.hi) };
}

function normalizeAssessment(raw) {
  if (!isPlainObject(raw)) return null;
  const index = numOrNull(firstDefined(raw.index, raw.iq, raw.score));
  const entry = { ...raw };
  entry.at = numOr(raw.at, 0);
  entry.index = index;
  entry.ci = normalizeCi(raw.ci);
  entry.theta = numOrNull(raw.theta);
  entry.se = numOrNull(raw.se);
  entry.itemsUsed = intOr(raw.itemsUsed, 0, 0);
  entry.reliability = numOrNull(raw.reliability);
  entry.byFamily = isPlainObject(raw.byFamily) ? { ...raw.byFamily } : {};
  return entry;
}

function normalizeLevels(raw) {
  const out = {};
  if (!isPlainObject(raw)) return out;
  for (const id of Object.keys(raw)) {
    if (id === PROTO_KEY) continue;
    const v = raw[id];
    if (!isPlainObject(v)) continue;
    out[id] = {
      unlocked: boolOr(v.unlocked, false),
      stars: intOr(v.stars, 0, 0, 3),
      bestScore: numOr(v.bestScore, 0),
      attempts: intOr(v.attempts, 0, 0),
      lastAt: numOr(v.lastAt, 0),
      bestLevel: numOr(v.bestLevel, 0)
    };
  }
  return out;
}

function normalizeDrillStats(raw) {
  const out = {};
  if (!isPlainObject(raw)) return out;
  for (const id of Object.keys(raw)) {
    if (id === PROTO_KEY) continue;
    const v = raw[id];
    if (!isPlainObject(v)) continue;
    out[id] = {
      sessions: intOr(v.sessions, 0, 0),
      totalTrials: intOr(v.totalTrials, 0, 0),
      accuracy: numOr(v.accuracy, 0),
      bestLevel: numOr(v.bestLevel, 0),
      msPerTrial: numOr(v.msPerTrial, 0)
    };
  }
  return out;
}

function normalizeBank(raw) {
  const out = {};
  if (!isPlainObject(raw)) return out;
  for (const key of Object.keys(raw)) {
    if (key === PROTO_KEY) continue;
    const v = raw[key];
    if (!isPlainObject(v)) continue;
    const b = numOrNull(v.b);
    if (b === null) continue;
    out[key] = {
      n: intOr(v.n, 0, 0),
      b,
      sumInfo: numOr(v.sumInfo, 0)
    };
  }
  return out;
}

function normalizeFactorScores(raw, fallback) {
  const out = {};
  for (const key of FACTOR_KEYS) {
    const value = isPlainObject(raw) ? raw[key] : undefined;
    out[key] = numOr(value, fallback[key]);
  }
  return out;
}

function normalizeSettings(raw, legacy, fallback) {
  const src = isPlainObject(raw) ? raw : {};
  const alt = isPlainObject(legacy) ? legacy : {};
  return {
    reducedMotion: boolOr(firstDefined(src.reducedMotion, alt.reducedMotion, alt.motionReduced), fallback.reducedMotion),
    highContrast: boolOr(firstDefined(src.highContrast, alt.highContrast), fallback.highContrast),
    showLabels: boolOr(firstDefined(src.showLabels, alt.showLabels, alt.labels), fallback.showLabels),
    language: strOr(firstDefined(src.language, src.lang, alt.language, alt.lang), fallback.language),
    soundOn: boolOr(firstDefined(src.soundOn, src.sound, alt.soundOn, alt.sound), fallback.soundOn)
  };
}

function normalizeStreak(raw, fallback) {
  if (!isPlainObject(raw)) return { ...fallback };
  const lastDayRaw = raw.lastDay;
  let lastDay = null;
  if (typeof lastDayRaw === 'string' && lastDayRaw.length > 0) lastDay = lastDayRaw;
  else if (typeof lastDayRaw === 'number' && Number.isFinite(lastDayRaw)) lastDay = lastDayRaw;
  return { days: intOr(raw.days, fallback.days, 0), lastDay };
}

/**
 * Forward-compatible migration: every recognised field is salvaged from `raw`
 * (including a few pre-v1 aliases) and everything missing is filled from
 * `defaultProfile()`. Nothing is discarded because the version is unknown.
 * @param {*} raw
 * @returns {object} a valid v1 profile
 */
function migrate(raw) {
  const base = defaultProfile();
  if (!isPlainObject(raw)) return base;

  const out = base;
  out.version = CURRENT_VERSION;
  out.createdAt = numOr(firstDefined(raw.createdAt, raw.created), base.createdAt);
  out.updatedAt = numOr(firstDefined(raw.updatedAt, raw.updated), out.createdAt);

  const assessmentsSrc = Array.isArray(raw.assessments)
    ? raw.assessments
    : (Array.isArray(raw.history) ? raw.history : []);
  out.assessments = assessmentsSrc
    .map(normalizeAssessment)
    .filter((a) => a !== null);

  out.currentIndex = numOrNull(firstDefined(raw.currentIndex, raw.index, raw.iq));
  const peak = numOrNull(firstDefined(raw.peakIndex, raw.bestIndex, raw.best));
  out.peakIndex = peak;

  // Peak can never be below the values we actually hold.
  const knownIndices = [];
  if (out.currentIndex !== null) knownIndices.push(out.currentIndex);
  for (const a of out.assessments) {
    if (typeof a.index === 'number') knownIndices.push(a.index);
  }
  if (knownIndices.length > 0) {
    const maxKnown = Math.max(...knownIndices);
    out.peakIndex = out.peakIndex === null ? maxKnown : Math.max(out.peakIndex, maxKnown);
  }

  const status = strOr(raw.status, '');
  if (STATUSES.indexOf(status) >= 0) {
    out.status = status;
  } else if (out.currentIndex !== null) {
    out.status = out.currentIndex >= QUALIFY_INDEX ? 'qualified' : 'eliminated';
  } else {
    out.status = 'new';
  }

  out.tier = intOr(raw.tier, base.tier, 0, MAX_TIER);
  out.xp = intOr(raw.xp, base.xp, 0);
  out.levels = normalizeLevels(raw.levels);
  out.drillStats = normalizeDrillStats(raw.drillStats);
  out.factorScores = normalizeFactorScores(raw.factorScores, base.factorScores);
  out.bank = normalizeBank(raw.bank);
  out.settings = normalizeSettings(raw.settings, raw, base.settings);
  out.streak = normalizeStreak(raw.streak, base.streak);

  return out;
}

/* ------------------------------------------------------------------ *
 * Public API
 * ------------------------------------------------------------------ */

/** Signature of the last payload written, used to make saves idempotent. */
let lastSignature = null;
/** The profile object matching `lastSignature` (kept for debounced saves). */
let lastSaved = null;

/**
 * Mirror the stored timestamp onto the caller's own object, for callers that
 * keep mutating it. Frozen inputs are left alone.
 * @param {*} target
 * @param {number} at
 */
function stampUpdatedAt(target, at) {
  if (!isPlainObject(target)) return;
  try {
    target.updatedAt = at;
  } catch (_err) {
    // Frozen input; the returned profile still carries the timestamp.
  }
}

/** JSON of the profile with the volatile `updatedAt` stripped. */
function signatureOf(profile) {
  const copy = { ...profile };
  delete copy.updatedAt;
  try {
    return JSON.stringify(copy);
  } catch (_err) {
    return null;
  }
}

/**
 * Load the stored profile. Never throws: a missing key, corrupt JSON, a
 * non-object payload, an older/newer version or a hostile storage object all
 * yield a valid default profile.
 * @returns {object}
 */
export function loadProfile() {
  let raw = null;
  try {
    raw = readRaw();
  } catch (_err) {
    raw = null;
  }
  if (typeof raw !== 'string' || raw.length === 0) {
    const fresh = defaultProfile();
    lastSignature = null;
    lastSaved = null;
    return fresh;
  }
  let parsed = null;
  try {
    parsed = JSON.parse(raw);
  } catch (_err) {
    parsed = null;
  }
  if (!isPlainObject(parsed)) {
    const fresh = defaultProfile();
    lastSignature = null;
    lastSaved = null;
    return fresh;
  }
  const profile = migrate(parsed);
  lastSignature = signatureOf(profile);
  lastSaved = profile;
  return profile;
}

/**
 * Persist the profile. Sets `updatedAt`, and is debounce-safe: saving the same
 * content repeatedly performs no further writes and does not churn
 * `updatedAt`. Never throws.
 * @param {object} p
 * @returns {object} the profile as stored
 */
export function saveProfile(p) {
  const profile = migrate(p);
  const signature = signatureOf(profile);

  if (
    signature !== null &&
    signature === lastSignature &&
    lastSaved &&
    lastBackend !== null &&
    lastBackend === getStorage()
  ) {
    // Idempotent no-op: identical content is already persisted in this backend.
    profile.updatedAt = lastSaved.updatedAt;
    stampUpdatedAt(p, lastSaved.updatedAt);
    return lastSaved;
  }

  profile.updatedAt = nowMs();
  let payload = null;
  try {
    payload = JSON.stringify(profile);
  } catch (_err) {
    payload = null;
  }
  if (payload === null) {
    // Unserialisable input (cycles); fall back to a clean, storable profile.
    const safe = defaultProfile();
    safe.updatedAt = nowMs();
    writeRaw(JSON.stringify(safe));
    lastSignature = signatureOf(safe);
    lastSaved = safe;
    return safe;
  }

  writeRaw(payload);
  lastSignature = signature;
  lastSaved = profile;

  // Convenience for callers that keep mutating their own object.
  stampUpdatedAt(p, profile.updatedAt);
  return profile;
}

/**
 * Wipe the stored profile and install a fresh one.
 * @returns {object} the new default profile
 */
export function resetProfile() {
  removeRaw();
  lastSignature = null;
  lastSaved = null;
  const fresh = defaultProfile();
  return saveProfile(fresh);
}

/**
 * Serialise the current profile for download / clipboard.
 * @returns {string} pretty-printed JSON
 */
export function exportProfile() {
  const profile = loadProfile();
  try {
    return JSON.stringify(profile, null, 2);
  } catch (_err) {
    return JSON.stringify(defaultProfile(), null, 2);
  }
}

/**
 * Import a previously exported profile. Validates the shape and reports
 * failure instead of throwing.
 * @param {string} json
 * @returns {{ ok: boolean, error: (string|null), profile?: object }}
 */
export function importProfile(json) {
  if (typeof json !== 'string' || json.trim().length === 0) {
    return { ok: false, error: 'empty-input' };
  }
  let parsed = null;
  try {
    parsed = JSON.parse(json);
  } catch (_err) {
    return { ok: false, error: 'invalid-json' };
  }
  if (!isPlainObject(parsed)) {
    return { ok: false, error: 'not-a-profile' };
  }
  const recognised = [
    'version', 'status', 'assessments', 'currentIndex', 'peakIndex', 'tier',
    'xp', 'levels', 'drillStats', 'factorScores', 'bank', 'settings', 'streak'
  ];
  // Pre-v1 aliases that `migrate` salvages. Import must accept exactly the
  // shapes `loadProfile` already migrates out of storage, or a file exported
  // by an older build would be rejected as "not a profile".
  const legacyAliases = [
    'index', 'iq', 'best', 'bestIndex', 'history',
    'created', 'updated', 'lang', 'sound', 'motionReduced'
  ];
  const hits = recognised.concat(legacyAliases).filter((k) => hasOwn(parsed, k));
  if (hits.length < 2) {
    return { ok: false, error: 'not-a-profile' };
  }
  if (hasOwn(parsed, 'version') && numOrNull(parsed.version) === null) {
    return { ok: false, error: 'bad-version' };
  }
  if (hasOwn(parsed, 'assessments') && !Array.isArray(parsed.assessments)) {
    return { ok: false, error: 'bad-assessments' };
  }
  let profile = null;
  try {
    profile = migrate(parsed);
  } catch (_err) {
    return { ok: false, error: 'migration-failed' };
  }
  // Force a write even if the content matches the last save.
  lastSignature = null;
  lastSaved = null;
  const stored = saveProfile(profile);
  return { ok: true, error: null, profile: stored };
}
