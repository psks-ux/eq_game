/**
 * Unit tests for src/core/store.js: schema defaults, round-trip, corrupt-JSON
 * recovery, forward-compatible migration from a v0-shaped record, the
 * in-memory fallback when storage throws, and export/import.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  defaultProfile,
  loadProfile,
  saveProfile,
  resetProfile,
  exportProfile,
  importProfile
} from '../src/core/store.js';

const STORAGE_KEY = 'eqgame.profile.v1';

/** Stand-in for the DOMException browsers throw when storage is denied. */
class StorageDenied extends Error {
  constructor(message) {
    super(message);
    this.name = 'QuotaExceededError';
  }
}

/** A minimal, inspectable localStorage double. */
function makeFakeStorage() {
  const map = new Map();
  const api = {
    profileWrites: 0,
    get length() {
      return map.size;
    },
    key(i) {
      const keys = Array.from(map.keys());
      return i >= 0 && i < keys.length ? keys[i] : null;
    },
    getItem(k) {
      const key = String(k);
      return map.has(key) ? map.get(key) : null;
    },
    setItem(k, v) {
      const key = String(k);
      if (key === STORAGE_KEY) api.profileWrites += 1;
      map.set(key, String(v));
    },
    removeItem(k) {
      map.delete(String(k));
    },
    clear() {
      map.clear();
    },
    raw: map
  };
  return api;
}

/** A localStorage double that throws on every operation (Safari private mode). */
function makeThrowingStorage() {
  const boom = () => {
    throw new StorageDenied('storage is disabled');
  };
  return {
    get length() {
      return 0;
    },
    key: boom,
    getItem: boom,
    setItem: boom,
    removeItem: boom,
    clear: boom
  };
}

function installStorage(value) {
  Object.defineProperty(globalThis, 'localStorage', {
    value,
    configurable: true,
    writable: true
  });
}

// Installed before any test runs; store.js resolves its backend lazily inside
// getStorage(), so the static import above never touches localStorage at load.
let storage = makeFakeStorage();
installStorage(storage);

/** Fresh, healthy storage for a test. */
function freshStorage() {
  storage = makeFakeStorage();
  installStorage(storage);
  return storage;
}

const FACTOR_KEYS = [
  'induction', 'spatial', 'workingMemory', 'relational', 'speed', 'flexibility'
];

test('defaultProfile returns the full v1 schema', () => {
  const p = defaultProfile();
  assert.equal(p.version, 1);
  assert.equal(typeof p.createdAt, 'number');
  assert.equal(typeof p.updatedAt, 'number');
  assert.equal(p.status, 'new');
  assert.deepEqual(p.assessments, []);
  assert.equal(p.currentIndex, null);
  assert.equal(p.peakIndex, null);
  assert.equal(p.tier, 0);
  assert.equal(p.xp, 0);
  assert.deepEqual(p.levels, {});
  assert.deepEqual(p.drillStats, {});
  assert.deepEqual(Object.keys(p.factorScores).sort(), [...FACTOR_KEYS].sort());
  assert.deepEqual(p.bank, {});
  assert.deepEqual(p.settings, {
    reducedMotion: false,
    highContrast: false,
    showLabels: true,
    language: 'en',
    soundOn: true
  });
  assert.deepEqual(p.streak, { days: 0, lastDay: null });
});

test('defaultProfile hands out independent objects', () => {
  const a = defaultProfile();
  const b = defaultProfile();
  a.settings.language = 'hi';
  a.factorScores.speed = 9;
  a.levels.L01 = { unlocked: true, stars: 3, bestScore: 1, attempts: 1, lastAt: 1, bestLevel: 2 };
  assert.equal(b.settings.language, 'en');
  assert.equal(b.factorScores.speed, 0);
  assert.deepEqual(b.levels, {});
});

test('loadProfile with no stored key returns a default profile', () => {
  freshStorage();
  const p = loadProfile();
  assert.equal(p.version, 1);
  assert.equal(p.status, 'new');
  assert.equal(p.currentIndex, null);
});

test('save then load round-trips the profile', () => {
  freshStorage();
  const p = defaultProfile();
  p.status = 'qualified';
  p.currentIndex = 137;
  p.peakIndex = 137;
  p.tier = 2;
  p.xp = 1280;
  p.factorScores.induction = 0.42;
  p.levels.L07 = {
    unlocked: true, stars: 2, bestScore: 0.88, attempts: 4, lastAt: 1700000000000, bestLevel: 6
  };
  p.drillStats.nback = {
    sessions: 3, totalTrials: 90, accuracy: 0.81, bestLevel: 4, msPerTrial: 1450
  };
  p.bank['matrix#a1b2'] = { n: 12, b: 1.75, sumInfo: 6.2 };
  p.settings.language = 'ar';
  p.settings.showLabels = false;
  p.streak = { days: 5, lastDay: '2026-09-08' };
  p.assessments.push({
    at: 1700000000000,
    index: 137,
    ci: { lo: 129, hi: 145 },
    theta: 2.47,
    se: 0.31,
    itemsUsed: 28,
    reliability: 0.9,
    byFamily: { matrix: { n: 9, pctCorrect: 0.77, meanB: 1.9 } }
  });

  saveProfile(p);
  const back = loadProfile();

  assert.equal(back.status, 'qualified');
  assert.equal(back.currentIndex, 137);
  assert.equal(back.peakIndex, 137);
  assert.equal(back.tier, 2);
  assert.equal(back.xp, 1280);
  assert.equal(back.factorScores.induction, 0.42);
  assert.deepEqual(back.levels.L07, p.levels.L07);
  assert.deepEqual(back.drillStats.nback, p.drillStats.nback);
  assert.deepEqual(back.bank['matrix#a1b2'], { n: 12, b: 1.75, sumInfo: 6.2 });
  assert.equal(back.settings.language, 'ar');
  assert.equal(back.settings.showLabels, false);
  assert.deepEqual(back.streak, { days: 5, lastDay: '2026-09-08' });
  assert.equal(back.assessments.length, 1);
  assert.deepEqual(back.assessments[0].ci, { lo: 129, hi: 145 });
  assert.deepEqual(back.assessments[0].byFamily.matrix, { n: 9, pctCorrect: 0.77, meanB: 1.9 });
});

test('saveProfile sets updatedAt and is debounce-safe (idempotent)', () => {
  const s = freshStorage();
  const p = defaultProfile();
  p.updatedAt = 0;

  const saved = saveProfile(p);
  assert.ok(saved.updatedAt > 0, 'updatedAt is stamped on save');
  assert.equal(p.updatedAt, saved.updatedAt, 'caller object is stamped too');
  const writesAfterFirst = s.profileWrites;
  assert.equal(writesAfterFirst, 1);

  const again = saveProfile(p);
  assert.equal(s.profileWrites, writesAfterFirst, 'identical content is not rewritten');
  assert.equal(again.updatedAt, saved.updatedAt, 'updatedAt does not churn');

  p.xp = 25;
  const changed = saveProfile(p);
  assert.equal(s.profileWrites, writesAfterFirst + 1, 'changed content is written');
  assert.equal(changed.xp, 25);
  assert.equal(loadProfile().xp, 25);
});

test('loadProfile recovers from corrupt JSON', () => {
  const s = freshStorage();
  s.raw.set(STORAGE_KEY, '{"version":1,"xp":');
  const p = loadProfile();
  assert.equal(p.version, 1);
  assert.equal(p.xp, 0);
  assert.equal(p.status, 'new');
});

test('loadProfile recovers from a non-object payload', () => {
  const s = freshStorage();
  for (const junk of ['null', '42', '"hello"', '[1,2,3]', '']) {
    s.raw.set(STORAGE_KEY, junk);
    const p = loadProfile();
    assert.equal(p.version, 1);
    assert.equal(p.status, 'new');
    assert.deepEqual(p.assessments, []);
  }
});

test('migrates a v0-shaped record without discarding data', () => {
  const s = freshStorage();
  s.raw.set(STORAGE_KEY, JSON.stringify({
    version: 0,
    createdAt: 1600000000000,
    xp: 340,
    index: 128,
    best: 131,
    history: [{ at: 1600000000000, index: 128, theta: 1.87, se: 0.33 }],
    lang: 'sw',
    sound: false,
    settings: { highContrast: true },
    factorScores: { spatial: 0.5, unknownFactor: 3 },
    levels: { L01: { unlocked: true, stars: 2 }, bogus: 'nope' },
    strayField: 'ignored'
  }));

  const p = loadProfile();

  assert.equal(p.version, 1, 'version is upgraded');
  assert.equal(p.createdAt, 1600000000000, 'createdAt is preserved');
  assert.equal(p.xp, 340, 'known values survive');
  assert.equal(p.currentIndex, 128, 'legacy "index" maps to currentIndex');
  assert.equal(p.peakIndex, 131, 'legacy "best" maps to peakIndex');
  assert.equal(p.assessments.length, 1, 'legacy "history" maps to assessments');
  assert.deepEqual(p.assessments[0].ci, { lo: null, hi: null }, 'missing sub-fields filled');
  assert.equal(p.assessments[0].itemsUsed, 0);
  assert.equal(p.status, 'qualified', 'status derived from the index');
  assert.equal(p.settings.language, 'sw', 'legacy "lang" maps into settings');
  assert.equal(p.settings.soundOn, false, 'legacy "sound" maps into settings');
  assert.equal(p.settings.highContrast, true);
  assert.equal(p.settings.showLabels, true, 'missing settings come from defaults');
  assert.equal(p.factorScores.spatial, 0.5);
  assert.equal(p.factorScores.relational, 0, 'missing factors filled with defaults');
  assert.equal(Object.prototype.hasOwnProperty.call(p.factorScores, 'unknownFactor'), false);
  assert.equal(p.levels.L01.unlocked, true);
  assert.equal(p.levels.L01.attempts, 0, 'missing level fields filled');
  assert.equal(Object.prototype.hasOwnProperty.call(p.levels, 'bogus'), false);
  assert.deepEqual(p.streak, { days: 0, lastDay: null });
  assert.deepEqual(p.bank, {});
  assert.equal(Object.prototype.hasOwnProperty.call(p, 'strayField'), false);
});

test('a sub-100 legacy record migrates to the eliminated state', () => {
  const s = freshStorage();
  s.raw.set(STORAGE_KEY, JSON.stringify({ version: 0, index: 88 }));
  const p = loadProfile();
  assert.equal(p.currentIndex, 88);
  assert.equal(p.status, 'eliminated');
  assert.equal(p.peakIndex, 88);
});

test('falls back to memory when localStorage throws', () => {
  installStorage(makeThrowingStorage());

  const p = loadProfile();
  assert.equal(p.version, 1, 'a hostile storage still yields a valid profile');
  assert.equal(p.status, 'new');

  p.xp = 77;
  p.status = 'qualified';
  p.currentIndex = 112;
  const saved = saveProfile(p);
  assert.equal(saved.xp, 77, 'saving does not throw');

  const back = loadProfile();
  assert.equal(back.xp, 77, 'the in-memory fallback keeps the profile usable');
  assert.equal(back.currentIndex, 112);
  assert.equal(back.status, 'qualified');

  // A completely absent storage object behaves the same way.
  installStorage(undefined);
  const noStorage = loadProfile();
  assert.equal(noStorage.xp, 77);
  assert.doesNotThrow(() => saveProfile(noStorage));

  freshStorage();
});

test('export/import round-trips through JSON', () => {
  freshStorage();
  const p = defaultProfile();
  p.status = 'qualified';
  p.currentIndex = 151;
  p.peakIndex = 151;
  p.tier = 3;
  p.xp = 4200;
  p.settings.language = 'zh';
  p.streak = { days: 11, lastDay: '2026-09-01' };
  saveProfile(p);

  const json = exportProfile();
  assert.equal(typeof json, 'string');
  const parsed = JSON.parse(json);
  assert.equal(parsed.currentIndex, 151);

  resetProfile();
  assert.equal(loadProfile().currentIndex, null, 'reset clears the profile');

  const res = importProfile(json);
  assert.equal(res.ok, true);
  assert.equal(res.error, null);

  const back = loadProfile();
  assert.equal(back.currentIndex, 151);
  assert.equal(back.peakIndex, 151);
  assert.equal(back.tier, 3);
  assert.equal(back.xp, 4200);
  assert.equal(back.settings.language, 'zh');
  assert.deepEqual(back.streak, { days: 11, lastDay: '2026-09-01' });
  assert.equal(back.status, 'qualified');
});

test('importProfile reports bad input instead of throwing', () => {
  freshStorage();
  const before = saveProfile(defaultProfile());

  for (const bad of [undefined, null, 42, '', '   ', 'not json', '[1,2,3]', '"str"', '{}', '{"a":1}']) {
    const res = importProfile(bad);
    assert.equal(res.ok, false, `expected rejection for ${JSON.stringify(bad)}`);
    assert.equal(typeof res.error, 'string');
  }
  const res = importProfile(JSON.stringify({ version: 'x', status: 'new', xp: 1 }));
  assert.equal(res.ok, false);
  assert.equal(res.error, 'bad-version');

  const res2 = importProfile(JSON.stringify({ version: 1, assessments: 'nope', xp: 3 }));
  assert.equal(res2.ok, false);
  assert.equal(res2.error, 'bad-assessments');

  const after = loadProfile();
  assert.equal(after.xp, before.xp, 'a rejected import leaves the profile untouched');
  assert.equal(after.status, 'new');
});

test('importProfile accepts a newer, unknown version by salvaging fields', () => {
  freshStorage();
  const res = importProfile(JSON.stringify({
    version: 99,
    status: 'qualified',
    currentIndex: 144,
    xp: 10,
    futureField: { anything: true }
  }));
  assert.equal(res.ok, true);
  const p = loadProfile();
  assert.equal(p.version, 1);
  assert.equal(p.currentIndex, 144);
  assert.equal(p.xp, 10);
  assert.equal(Object.prototype.hasOwnProperty.call(p, 'futureField'), false);
});

test('resetProfile wipes stored data and persists a fresh profile', () => {
  const s = freshStorage();
  const p = defaultProfile();
  p.xp = 999;
  p.status = 'eliminated';
  p.currentIndex = 74;
  saveProfile(p);
  assert.equal(loadProfile().xp, 999);

  const fresh = resetProfile();
  assert.equal(fresh.xp, 0);
  assert.equal(fresh.status, 'new');
  assert.equal(fresh.currentIndex, null);
  assert.ok(s.raw.has(STORAGE_KEY), 'the fresh profile is persisted');
  assert.equal(loadProfile().xp, 0);
});

test('importProfile accepts a pre-v1 record, matching loadProfile migration', () => {
  freshStorage();
  const legacy = JSON.stringify({
    version: 0,
    index: 128,
    best: 131,
    history: [{ at: 1600000000000, index: 128, theta: 1.87, se: 0.33 }],
    lang: 'sw',
    sound: false
  });

  const res = importProfile(legacy);
  assert.equal(res.ok, true, 'a legacy export is not rejected as "not a profile"');
  assert.equal(res.error, null);

  const p = loadProfile();
  assert.equal(p.version, 1);
  assert.equal(p.currentIndex, 128);
  assert.equal(p.peakIndex, 131);
  assert.equal(p.assessments.length, 1);
  assert.equal(p.settings.language, 'sw');
  assert.equal(p.settings.soundOn, false);
  assert.equal(p.status, 'qualified');

  // Records with no recognisable field at all are still rejected.
  assert.equal(importProfile(JSON.stringify({ a: 1, b: 2 })).ok, false);
});

test('a "__proto__" key in a stored map cannot rewrite a prototype', () => {
  freshStorage();
  const hostile = JSON.parse(
    '{"version":1,"xp":5,'
    + '"levels":{"__proto__":{"unlocked":true,"stars":3},"L01":{"unlocked":true}},'
    + '"drillStats":{"__proto__":{"sessions":9}},'
    + '"bank":{"__proto__":{"n":1,"b":2,"sumInfo":3}}}'
  );

  const saved = saveProfile(hostile);
  for (const map of [saved.levels, saved.drillStats, saved.bank]) {
    assert.equal(Object.getPrototypeOf(map), Object.prototype, 'prototype is untouched');
  }
  assert.equal(saved.levels.stars, undefined, 'no inherited data leaks through');
  assert.deepEqual(Object.keys(saved.levels), ['L01'], 'legitimate ids survive');
  assert.equal(saved.levels.L01.unlocked, true);
  assert.deepEqual(Object.keys(saved.drillStats), []);
  assert.deepEqual(Object.keys(saved.bank), []);
  assert.equal({}.stars, undefined, 'Object.prototype is clean');

  // for..in must not surface an injected entry either.
  const seen = [];
  for (const k in saved.levels) seen.push(k);
  assert.deepEqual(seen, ['L01']);
});

test('the idempotent save path still stamps the caller object', () => {
  const s = freshStorage();
  const p = defaultProfile();
  const first = saveProfile(p);
  assert.equal(s.profileWrites, 1);

  p.updatedAt = 0; // stale timestamp, does not change the content signature
  const again = saveProfile(p);
  assert.equal(s.profileWrites, 1, 'still no rewrite');
  assert.equal(again.updatedAt, first.updatedAt);
  assert.equal(p.updatedAt, first.updatedAt, 'caller is re-stamped, not left stale');

  const frozen = Object.freeze(defaultProfile());
  assert.doesNotThrow(() => saveProfile(frozen), 'a frozen caller object is tolerated');
});

test('saveProfile survives hostile input', () => {
  freshStorage();
  for (const bad of [undefined, null, 0, 'x', []]) {
    const p = saveProfile(bad);
    assert.equal(p.version, 1);
    assert.equal(p.status, 'new');
  }
  const cyclic = defaultProfile();
  cyclic.levels.L01 = { unlocked: true, stars: 1, bestScore: 0, attempts: 1, lastAt: 0, bestLevel: 0 };
  cyclic.self = cyclic;
  const stored = saveProfile(cyclic);
  assert.equal(stored.version, 1);
  assert.doesNotThrow(() => loadProfile());
});
