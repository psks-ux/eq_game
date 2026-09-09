/**
 * Deterministic, seedable pseudo-random number generator (sfc32 core, xmur3 seeding).
 * Every stochastic decision in item generation, CAT and drills flows through here, so a
 * given (seed, tag) pair always reproduces exactly the same stream on every machine.
 */

const UINT32 = 4294967296;

/**
 * xmur3-style avalanche hash. Stable across engines: only Math.imul, xor and shifts.
 * @param {string} str
 * @returns {number} uint32
 */
export function hashSeed(str) {
  const s = typeof str === 'string' ? str : String(str);
  let h = 1779033703 ^ s.length;
  for (let i = 0; i < s.length; i++) {
    h = Math.imul(h ^ s.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^ (h >>> 16)) >>> 0;
}

/** splitmix32: expands one uint32 seed into a decorrelated stream of uint32 state words. */
function splitmix32(seed) {
  let s = seed >>> 0;
  return function nextState() {
    s = (s + 0x9e3779b9) | 0;
    let z = s;
    z = Math.imul(z ^ (z >>> 16), 0x21f0aaad);
    z = Math.imul(z ^ (z >>> 15), 0x735a2d97);
    return (z ^ (z >>> 15)) >>> 0;
  };
}

/** Canonical string key for any accepted seed value; fork() extends this key with a tag. */
function seedKeyOf(seed) {
  if (typeof seed === 'string') return seed;
  if (typeof seed === 'number') return Number.isFinite(seed) ? `n:${seed}` : 'n:nonfinite';
  if (typeof seed === 'bigint') return `n:${seed.toString()}`;
  if (typeof seed === 'boolean') return `b:${seed ? 1 : 0}`;
  if (seed === null || seed === undefined) return 'eqgame:default';
  return `o:${String(seed)}`;
}

/**
 * Length-prefixed derivation key for fork(). Prefixing with the tag length makes the
 * encoding injective, so two different (seed, tag) pairs can never share a stream.
 */
function forkKey(key, tag) {
  const t = tag === undefined ? '' : String(tag);
  return `${key}|fork:${t.length}:${t}`;
}

function rngFromKey(key) {
  const nextState = splitmix32(hashSeed(key));
  let a = nextState() | 0;
  let b = nextState() | 0;
  let c = nextState() | 0;
  let d = nextState() | 0;

  // sfc32
  const nextUint = () => {
    a |= 0;
    b |= 0;
    c |= 0;
    d |= 0;
    const t = (((a + b) | 0) + d) | 0;
    d = (d + 1) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    c = (c + t) | 0;
    return t >>> 0;
  };

  // Warm up so that closely related seed keys diverge immediately.
  for (let i = 0; i < 16; i++) nextUint();

  const next = () => nextUint() / UINT32;

  const int = (minInclusive, maxExclusive) => {
    const lo = Math.ceil(Number(minInclusive));
    const hi = Math.floor(Number(maxExclusive));
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) return 0;
    const span = hi - lo;
    if (span <= 0) return lo;
    return lo + Math.floor(next() * span);
  };

  const pick = (array) => {
    if (!array || typeof array.length !== 'number' || array.length === 0) return undefined;
    return array[Math.floor(next() * array.length)];
  };

  const shuffle = (array) => {
    const out = array && typeof array.length === 'number' ? Array.prototype.slice.call(array) : [];
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(next() * (i + 1));
      const tmp = out[i];
      out[i] = out[j];
      out[j] = tmp;
    }
    return out;
  };

  const sample = (array, k) => {
    const src = array && typeof array.length === 'number' ? Array.prototype.slice.call(array) : [];
    const n = src.length;
    const want = Math.min(Math.max(Math.floor(Number(k) || 0), 0), n);
    if (want === 0) return [];
    // Partial Fisher-Yates: only `want` swaps, result order is already randomised.
    for (let i = 0; i < want; i++) {
      const j = i + Math.floor(next() * (n - i));
      const tmp = src[i];
      src[i] = src[j];
      src[j] = tmp;
    }
    return src.slice(0, want);
  };

  const bool = (p = 0.5) => {
    const q = Number(p);
    if (!Number.isFinite(q)) return next() < 0.5;
    if (q <= 0) return false;
    if (q >= 1) return true;
    return next() < q;
  };

  // Box-Muller with a cached second variate.
  let spare = null;
  const gauss = (mean = 0, sd = 1) => {
    const mu = Number.isFinite(Number(mean)) ? Number(mean) : 0;
    const sigma = Number.isFinite(Number(sd)) ? Number(sd) : 1;
    if (spare !== null) {
      const z = spare;
      spare = null;
      return mu + sigma * z;
    }
    let u1 = next();
    while (u1 <= Number.MIN_VALUE) u1 = next();
    const u2 = next();
    const r = Math.sqrt(-2 * Math.log(u1));
    const theta = 2 * Math.PI * u2;
    spare = r * Math.sin(theta);
    return mu + sigma * r * Math.cos(theta);
  };

  const fork = (tag) => rngFromKey(forkKey(key, tag));

  return { next, int, pick, sample, shuffle, bool, gauss, fork };
}

/**
 * @param {number|string} seed
 * @returns {{next:Function,int:Function,pick:Function,sample:Function,shuffle:Function,
 *            bool:Function,gauss:Function,fork:Function}}
 */
export function makeRng(seed) {
  return rngFromKey(seedKeyOf(seed));
}
