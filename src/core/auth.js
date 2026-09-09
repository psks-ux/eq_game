/**
 * Client-side session state. Sign-in is a convenience, never a requirement: every
 * function here degrades to "signed out, nothing available" when there is no
 * backend (the standalone file, file://, an offline device), and the app carries
 * on exactly as it did before accounts existed.
 *
 * The session itself lives in an HttpOnly cookie the browser sends automatically.
 * Nothing here ever holds a token, so nothing here can leak one.
 */

const SESSION_URL = '/api/auth/session';
const PASSWORD_URL = '/api/auth/password';
const GOOGLE_URL = '/api/auth/google';
const REQUEST_TIMEOUT_MS = 12000;

/* Signed-out with nothing configured is the safe assumption everywhere. */
const EMPTY = { signedIn: false, user: null, providers: { password: false, google: false } };

let state = { ...EMPTY, loaded: false };
let inFlight = null;
const listeners = new Set();

export function authAvailable() {
  const loc = globalThis.location;
  if (!loc || !/^https?:$/.test(loc.protocol)) return false;
  return !!globalThis.fetch;
}

export function session() {
  return state;
}

export function isSignedIn() {
  return !!state.signedIn;
}

export function currentUser() {
  return state.user;
}

/** Has any sign-in method at all? Used to decide whether to offer the screen. */
export function authConfigured() {
  return !!(state.providers && (state.providers.password || state.providers.google));
}

export function onAuthChange(fn) {
  if (typeof fn !== 'function') return () => {};
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function announce() {
  for (const fn of Array.from(listeners)) {
    try {
      fn(state);
    } catch (err) {
      /* A broken listener must not break sign-in for everyone else. */
    }
  }
}

function apply(payload) {
  state = {
    signedIn: !!(payload && payload.signedIn),
    user: (payload && payload.user) || null,
    providers: (payload && payload.providers) || { password: false, google: false },
    loaded: true
  };
  announce();
  return state;
}

async function request(url, options) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      ...options,
      /* The session cookie is the whole point of every call in this module. */
      credentials: 'same-origin',
      cache: 'no-store'
    });
    const payload = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, payload };
  } finally {
    clearTimeout(timer);
  }
}

/** Ask the server who we are. Cached; pass `true` to force a fresh look. */
export function loadSession(force) {
  if (!authAvailable()) return Promise.resolve(apply(EMPTY));
  if (!force && state.loaded) return Promise.resolve(state);
  if (inFlight) return inFlight;

  inFlight = request(SESSION_URL, { method: 'GET' })
    .then(({ ok, payload }) => apply(ok ? payload : EMPTY))
    .catch(() => apply(EMPTY));

  const done = inFlight;
  done.finally(() => { if (inFlight === done) inFlight = null; });
  return done;
}

/**
 * Sign in or register with an email and a password.
 * Returns `{ ok }` or `{ ok: false, error, message }` — never throws, because a
 * failed sign-in is an ordinary outcome, not an exception.
 */
export async function withPassword(mode, email, password) {
  if (!authAvailable()) return { ok: false, error: 'unavailable' };
  try {
    const { ok, status, payload } = await request(PASSWORD_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode, email, password })
    });
    if (!ok) {
      return {
        ok: false,
        status,
        error: (payload && payload.error) || 'failed',
        message: (payload && payload.message) || 'Sign-in could not be completed.'
      };
    }
    await loadSession(true);
    return { ok: true, user: payload && payload.user };
  } catch (err) {
    const offline = err && err.name === 'AbortError' ? 'timeout' : 'offline';
    return { ok: false, error: offline, message: 'No connection to the server.' };
  }
}

/**
 * Where to send the browser for Google sign-in. A full navigation, not a popup:
 * popups are blocked often enough that the redirect is the reliable path, and it
 * keeps the whole flow server-side where the client secret lives.
 */
export function googleUrl(next) {
  const target = typeof next === 'string' && next.startsWith('#/') ? next : '#/';
  return `${GOOGLE_URL}?next=${encodeURIComponent(target)}`;
}

export function startGoogle(next) {
  if (!authAvailable()) return false;
  globalThis.location.assign(googleUrl(next));
  return true;
}

export async function signOut() {
  if (!authAvailable()) return { ok: false, error: 'unavailable' };
  try {
    await request(SESSION_URL, { method: 'DELETE' });
  } catch (err) {
    /* Fall through: refreshing below is what actually settles the state. */
  }
  await loadSession(true);
  return { ok: !state.signedIn };
}

/**
 * Read and clear the `?auth=` marker the Google callback leaves behind.
 * The query string is stripped with replaceState so a refresh or a shared link
 * cannot replay a stale outcome, and the hash route is preserved untouched.
 */
export function consumeRedirectResult() {
  const loc = globalThis.location;
  if (!loc || !loc.search) return null;
  let value = null;
  try {
    value = new URLSearchParams(loc.search).get('auth');
  } catch (err) {
    return null;
  }
  if (!value) return null;
  try {
    const history = globalThis.history;
    if (history && typeof history.replaceState === 'function') {
      history.replaceState(null, '', `${loc.pathname}${loc.hash || ''}`);
    }
  } catch (err) {
    /* Cosmetic only; the marker below is still returned and acted on. */
  }
  return value;
}
