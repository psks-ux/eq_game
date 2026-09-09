/**
 * Cross-device profile sync. Local storage stays the source of truth and every
 * read/write in the app remains synchronous and offline; this module only pushes
 * and pulls in the background. If there is no backend -- the standalone file, a
 * file:// page, an offline device -- everything here degrades to a no-op and the
 * app behaves exactly as it did before sync existed.
 */

import { mergeProfiles } from './merge.js';
import { loadProfile, saveProfile } from './store.js';
import { isSignedIn } from './auth.js';

const SYNC_KEY = 'eqgame.sync.v1';
const ENDPOINT = '/api/profile';
const REQUEST_TIMEOUT_MS = 12000;

/* Look-alike characters removed, so a code can be read off one screen and typed
   into another without ambiguity: no O/0, no I/1/L. 20 chars ~= 100 bits. */
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_LEN = 20;
const GROUP = 4;

/* ------------------------------------------------------------------ state */

function readState() {
  try {
    const raw = globalThis.localStorage && globalThis.localStorage.getItem(SYNC_KEY);
    if (!raw) return { code: null, lastSyncAt: 0, lastError: null };
    const parsed = JSON.parse(raw);
    return {
      code: typeof parsed.code === 'string' ? parsed.code : null,
      lastSyncAt: Number(parsed.lastSyncAt) || 0,
      lastError: parsed.lastError || null
    };
  } catch (err) {
    return { code: null, lastSyncAt: 0, lastError: null };
  }
}

function writeState(next) {
  try {
    globalThis.localStorage.setItem(SYNC_KEY, JSON.stringify(next));
  } catch (err) {
    /* Private mode or blocked storage: sync simply will not persist its link. */
  }
}

/* ------------------------------------------------------------------ codes */

export function formatCode(code) {
  if (typeof code !== 'string') return '';
  const clean = code.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const parts = [];
  for (let i = 0; i < clean.length; i += GROUP) parts.push(clean.slice(i, i + GROUP));
  return parts.join('-');
}

export function normaliseCode(raw) {
  if (typeof raw !== 'string') return null;
  const clean = raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (clean.length !== CODE_LEN) return null;
  for (const ch of clean) if (ALPHABET.indexOf(ch) === -1) return null;
  return clean;
}

/** A fresh code from the platform CSPRNG. Never Math.random for a credential. */
export function generateCode() {
  const bytes = new Uint8Array(CODE_LEN);
  const crypto = globalThis.crypto;
  if (!crypto || typeof crypto.getRandomValues !== 'function') {
    throw new Error('secure random is unavailable in this context');
  }
  crypto.getRandomValues(bytes);
  let out = '';
  // Rejection-free mapping would bias the alphabet; 256 % 31 != 0, so resample
  // the few bytes that would skew it rather than folding them in.
  for (let i = 0; i < CODE_LEN; i++) {
    let v = bytes[i];
    while (v >= 248) {
      const extra = new Uint8Array(1);
      crypto.getRandomValues(extra);
      v = extra[0];
    }
    out += ALPHABET[v % ALPHABET.length];
  }
  return out;
}

/* ------------------------------------------------------------- capability */

/**
 * Sync needs an http(s) origin. The standalone single-file build runs from
 * file://, where there is no API to call and no secure context for the CSPRNG.
 */
export function syncAvailable() {
  const loc = globalThis.location;
  if (!loc || !/^https?:$/.test(loc.protocol)) return false;
  if (!globalThis.fetch) return false;
  return true;
}

export function isLinked() {
  return !!readState().code;
}

/**
 * Sync runs for either identity: a signed-in account, or a sync code, or both.
 * Signing in gives a device somewhere to sync to without it ever seeing a code.
 */
export function syncEligible() {
  return syncAvailable() && (isSignedIn() || isLinked());
}

export function getCode() {
  return readState().code;
}

export function lastSyncAt() {
  return readState().lastSyncAt;
}

export function unlink() {
  writeState({ code: null, lastSyncAt: 0, lastError: null });
}

/** Link this device to a brand-new code. Does not contact the server. */
export function createLink() {
  const code = generateCode();
  writeState({ code, lastSyncAt: 0, lastError: null });
  return code;
}

/** Link this device to an existing code typed in from another device. */
export function linkTo(raw) {
  const code = normaliseCode(raw);
  if (!code) return { ok: false, error: 'bad_code' };
  writeState({ code, lastSyncAt: 0, lastError: null });
  return { ok: true, code };
}

/* ------------------------------------------------------------- transport */

async function request(method, code, body) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const headers = { 'Content-Type': 'application/json' };
  /* Header, not query string: a URL would put the credential into server logs,
     proxy logs and browser history. Omitted entirely when signed in, so the
     server falls through to the session cookie. */
  if (code) headers['x-sync-code'] = code;
  try {
    const res = await fetch(ENDPOINT, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
      /* The session cookie must ride along for account-backed sync. */
      credentials: 'same-origin',
      cache: 'no-store'
    });
    const payload = await res.json().catch(() => ({}));
    return { status: res.status, ok: res.ok, payload };
  } finally {
    clearTimeout(timer);
  }
}

/* ------------------------------------------------------------------ sync */

let inFlight = null;

/**
 * Push the local profile, merge it with whatever the server holds, and adopt the
 * result locally. Returns the merged profile, or a reason it did not happen.
 * Never throws and never leaves local storage in a worse state than it found it.
 */
export function syncNow(options) {
  const opts = options || {};
  if (inFlight) return inFlight;

  inFlight = (async () => {
    if (!syncAvailable()) return { ok: false, reason: 'unavailable' };
    const state = readState();
    /* A signed-in device needs no code: the session cookie identifies it. */
    if (!state.code && !isSignedIn()) return { ok: false, reason: 'not_linked' };

    const local = opts.profile || loadProfile();
    try {
      const { status, ok, payload } = await request('POST', state.code, { profile: local });

      if (!ok) {
        const reason = status === 503 ? 'unconfigured'
          : status === 413 ? 'too_large'
            : status === 401 ? 'not_linked'
              : status === 400 ? 'bad_code' : 'server_error';
        writeState({ ...state, lastError: reason });
        return { ok: false, reason, status };
      }

      const remote = payload && payload.profile;
      if (!remote || typeof remote !== 'object') {
        writeState({ ...state, lastError: 'bad_response' });
        return { ok: false, reason: 'bad_response' };
      }

      /* Merge again locally. The server already merged, but the user may have
         finished a drill while the request was in flight, and the merge is
         idempotent so replaying it costs nothing and cannot lose that work. */
      const current = loadProfile();
      const merged = mergeProfiles(current, remote);
      saveProfile(merged);

      const at = Date.now();
      writeState({ code: state.code, lastSyncAt: at, lastError: null });
      return { ok: true, profile: merged, at, rev: payload.rev };
    } catch (err) {
      const reason = err && err.name === 'AbortError' ? 'timeout' : 'offline';
      writeState({ ...state, lastError: reason });
      return { ok: false, reason };
    }
  })();

  const done = inFlight;
  done.finally(() => { if (inFlight === done) inFlight = null; });
  return done;
}

/** Does a code already have a profile on the server? Used before linking. */
export async function peek(raw) {
  const code = normaliseCode(raw);
  if (!code) return { ok: false, reason: 'bad_code' };
  if (!syncAvailable()) return { ok: false, reason: 'unavailable' };
  try {
    const { status, ok, payload } = await request('GET', code, null);
    if (status === 404) return { ok: true, exists: false };
    if (!ok) return { ok: false, reason: 'server_error', status };
    return { ok: true, exists: true, updatedAt: payload.updatedAt, profile: payload.profile };
  } catch (err) {
    return { ok: false, reason: 'offline' };
  }
}

/**
 * Fire-and-forget sync after something worth saving. Deliberately swallows its
 * result: a failed sync must never interrupt training, because the local profile
 * is already saved and the next sync will carry it.
 */
export function syncSoon() {
  if (!syncEligible()) return;
  Promise.resolve().then(() => syncNow()).catch(() => {});
}
