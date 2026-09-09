/**
 * Authentication primitives: password hashing, opaque sessions, signed OAuth state
 * and cookie handling. Uses only node:crypto, so the project keeps its
 * no-dependency property. Underscore-prefixed, so Vercel does not route to it.
 */

import {
  randomBytes, scrypt as scryptCb, timingSafeEqual, createHash, createHmac
} from 'node:crypto';
import { promisify } from 'node:util';
import { query } from './_db.js';

const scrypt = promisify(scryptCb);

export const SESSION_COOKIE = 'eq_session';
const STATE_COOKIE = 'eq_oauth';
const SESSION_DAYS = 60;

/* scrypt cost. N=16384 keeps a single hash near ~100ms on serverless hardware,
   which is the point: it makes offline guessing expensive. maxmem must be raised
   explicitly or Node refuses these parameters (128 * N * r * 2). */
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64, maxmem: 64 * 1024 * 1024 };

const MAX_FAILED_ATTEMPTS = 8;
const LOCKOUT_MINUTES = 15;

/* ----------------------------------------------------------------- secrets */

export function sessionSecret() {
  const s = process.env.SESSION_SECRET || '';
  /* Fail closed. A default or derived secret would let anyone who knows the
     scheme forge a session, which is worse than the endpoint being unavailable. */
  return s.length >= 32 ? s : null;
}

/**
 * Which configuration is present, by name and never by value. Callers surface this
 * only while something is broken, so a healthy deployment reveals nothing it did
 * not already reveal through `providers`. It exists because "unconfigured" on its
 * own does not say WHICH variable is wrong, and a secret that is merely too short
 * looks identical from outside to one that was never set.
 */
export function configReport() {
  const secret = process.env.SESSION_SECRET || '';
  const id = process.env.GOOGLE_CLIENT_ID || '';
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET || '';

  const report = {
    DATABASE_URL: process.env.DATABASE_URL ? 'ok' : 'missing',
    SESSION_SECRET: !secret ? 'missing'
      : secret.length < 32 ? `too_short (${secret.length} chars, need 32)` : 'ok',
    GOOGLE_CLIENT_ID: id ? 'ok' : 'missing',
    GOOGLE_CLIENT_SECRET: clientSecret ? 'ok' : 'missing'
  };
  /* Google is genuinely optional -- .env.example and docs/AUTH.md both say a
     password-only deployment is supported -- so only the two variables that are
     always required decide whether this deployment is healthy. Reading `ok` back
     out of the object it is being assigned to would also always be undefined. */
  report.ok = report.DATABASE_URL === 'ok' && report.SESSION_SECRET === 'ok';
  return report;
}

/**
 * Refuse state-changing requests that a cross-origin page could have forged.
 *
 * `SameSite=Lax` governs when the browser SENDS our cookie, not whether it may
 * accept a `Set-Cookie` on a top-level cross-site POST -- so login CSRF needs its
 * own guard. Requiring `application/json` is the load-bearing half: an HTML form
 * cannot send that content type without a preflight the attacker's page will fail.
 * The Origin and Sec-Fetch-Site checks are the belt to that braces, and both are
 * skipped when absent so that non-browser callers still work.
 */
export function crossSiteProblem(req, options) {
  const opts = options || {};
  if (opts.requireJson !== false) {
    const ct = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
    if (ct !== 'application/json') return 'bad_content_type';
  }

  const site = req.headers['sec-fetch-site'];
  if (site && site !== 'same-origin' && site !== 'none') return 'cross_site';

  const origin = req.headers.origin;
  if (origin) {
    const allowed = [originOf(req)];
    if (process.env.PUBLIC_ORIGIN) allowed.push(process.env.PUBLIC_ORIGIN.replace(/\/+$/, ''));
    if (!allowed.includes(origin)) return 'cross_site';
  }
  return null;
}

/* --------------------------------------------------------------- passwords */

/** At least 10 characters. Length beats composition rules for real-world strength. */
export function passwordProblem(password) {
  if (typeof password !== 'string') return 'Password is required.';
  if (password.length < 10) return 'Use at least 10 characters.';
  if (password.length > 200) return 'That password is too long.';
  if (!password.trim()) return 'Password cannot be only spaces.';
  return null;
}

export async function hashPassword(password) {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, SCRYPT.keylen, SCRYPT);
  return ['scrypt', SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString('base64'), key.toString('base64')].join('$');
}

export async function verifyPassword(password, stored) {
  if (typeof stored !== 'string') return false;
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, n, r, p, saltB64, keyB64] = parts;
  try {
    const salt = Buffer.from(saltB64, 'base64');
    const expected = Buffer.from(keyB64, 'base64');
    /* The derived length is read from the stored value, so a row truncated in the
       database would otherwise still verify -- scrypt's shorter output is just a
       prefix of the longer one. Anything under 256 bits is not a hash we wrote. */
    if (expected.length < 32 || salt.length < 8) return false;
    const actual = await scrypt(password, salt, expected.length, {
      N: Number(n), r: Number(r), p: Number(p), maxmem: SCRYPT.maxmem
    });
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  } catch (err) {
    return false;
  }
}

/* ------------------------------------------------------------------- email */

export function normaliseEmail(raw) {
  if (typeof raw !== 'string') return null;
  const email = raw.trim().toLowerCase();
  if (email.length < 3 || email.length > 254) return null;
  /* Deliberately permissive: the only authority on whether an address exists is
     the mail server. This rejects the shapes that are certainly not addresses. */
  if (!/^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(email)) return null;
  return email;
}

/* ---------------------------------------------------------------- sessions */

function hashToken(token) {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export async function createSession(userId, userAgent) {
  const token = randomBytes(32).toString('base64url');
  const expires = new Date(Date.now() + SESSION_DAYS * 86400_000);
  await query(
    'insert into sessions (token_hash, user_id, expires_at, user_agent) values ($1, $2, $3, $4)',
    [hashToken(token), userId, expires.toISOString(), String(userAgent || '').slice(0, 200)]
  );
  return { token, expires };
}

/** The signed-in user for this request, or null. Expired rows are treated as absent. */
export async function readSession(req) {
  const token = readCookie(req, SESSION_COOKIE);
  if (!token) return null;
  const rows = await query(
    `select u.id, u.email, u.google_sub, s.expires_at
       from sessions s join users u on u.id = s.user_id
      where s.token_hash = $1 and s.expires_at > now()`,
    [hashToken(token)]
  );
  if (!rows.length) return null;
  return { userId: rows[0].id, email: rows[0].email, viaGoogle: !!rows[0].google_sub, token };
}

export async function destroySession(token) {
  if (!token) return;
  await query('delete from sessions where token_hash = $1', [hashToken(token)]);
}

/**
 * Revoke every session a user holds. Not wired to a route yet, but the moment a
 * password change or reset exists it is mandatory -- and `sessions_user_id_idx`
 * was already created for exactly this query.
 */
export async function destroyAllSessions(userId) {
  if (!userId) return;
  await query('delete from sessions where user_id = $1', [userId]);
}

/* ----------------------------------------------------------------- lockout */

/**
 * Claim one attempt slot: gate, increment, and arm the lock in ONE statement.
 *
 * The original shape read `locked_until`, then spent ~100ms in scrypt, then
 * incremented -- a check-then-act window held open by the deliberately slow hash,
 * through which any number of concurrent requests all passed the gate. `_db.js`
 * sends one statement per HTTP round trip with no transaction available, so the
 * gate and the increment have to be the same statement or they are not a gate.
 *
 * Arming the lock here rather than after the verify is what makes it hold under
 * concurrency. Postgres serialises concurrent UPDATEs of one row, and re-checks
 * the WHERE predicate against the committed value, so once the Nth caller sets
 * `locked_until` every queued caller behind it fails the predicate and is
 * refused. Waiting for a failed verify to arm it would let a burst of parallel
 * requests all pass the gate before any of them had finished.
 *
 * The `case` also decays: an expired lock resets the counter instead of leaving
 * the account one mistyped password away from being re-locked forever.
 */
export async function claimLoginAttempt(userId) {
  const claimed = await query(
    `with next as (
       select case when locked_until is not null and locked_until <= now()
                   then 0 else failed_attempts end + 1 as n
         from users where id = $1
     )
     update users
        set failed_attempts = (select n from next),
            locked_until = case when (select n from next) >= $2
                                then now() + ($3 || ' minutes')::interval
                                else null end,
            updated_at = now()
      where id = $1 and (locked_until is null or locked_until <= now())
  returning failed_attempts`,
    [userId, MAX_FAILED_ATTEMPTS, String(LOCKOUT_MINUTES)]
  );
  if (claimed.length) return { allowed: true, attempts: Number(claimed[0].failed_attempts) };

  const rows = await query(
    'select extract(epoch from (locked_until - now())) as secs from users where id = $1',
    [userId]
  );
  const secs = rows.length ? Number(rows[0].secs) : 0;
  return { allowed: false, minutes: Math.max(1, Math.ceil((secs > 0 ? secs : 60) / 60)) };
}

export async function clearFailedLogins(userId) {
  await query(
    'update users set failed_attempts = 0, locked_until = null, updated_at = now() where id = $1',
    [userId]
  );
}

/* ----------------------------------------------------------------- cookies */

export function readCookie(req, name) {
  const header = req.headers && req.headers.cookie;
  if (!header) return null;
  for (const part of String(header).split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) {
      try {
        return decodeURIComponent(part.slice(eq + 1).trim());
      } catch (err) {
        return null;
      }
    }
  }
  return null;
}

function isSecure(req) {
  const proto = req.headers['x-forwarded-proto'];
  const first = Array.isArray(proto) ? proto[0] : proto;
  /* Localhost development runs plain http; everywhere else must be https or the
     cookie is not sent at all and sign-in silently fails. */
  return String(first || '').split(',')[0].trim() === 'https';
}

function appendCookie(res, value) {
  const prev = res.getHeader('Set-Cookie');
  if (!prev) res.setHeader('Set-Cookie', [value]);
  else res.setHeader('Set-Cookie', [].concat(prev, value));
}

export function setSessionCookie(req, res, token, expires) {
  const bits = [
    `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    /* Lax, not Strict: the Google callback is a top-level cross-site redirect and
       a Strict cookie would not be sent with it. */
    'SameSite=Lax',
    `Expires=${expires.toUTCString()}`
  ];
  if (isSecure(req)) bits.push('Secure');
  appendCookie(res, bits.join('; '));
}

export function clearSessionCookie(req, res) {
  const bits = [`${SESSION_COOKIE}=`, 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0'];
  if (isSecure(req)) bits.push('Secure');
  appendCookie(res, bits.join('; '));
}

/* ------------------------------------------------------- OAuth state (CSRF) */

function sign(value, secret) {
  return createHmac('sha256', secret).update(value).digest('base64url');
}

/**
 * The OAuth `state` is stored in a short-lived signed cookie and echoed through
 * Google. Comparing the two on the way back is what stops an attacker from
 * feeding us their own authorisation code.
 */
export function setOAuthState(req, res, payload) {
  const secret = sessionSecret();
  if (!secret) return null;
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const token = `${body}.${sign(body, secret)}`;
  const bits = [
    `${STATE_COOKIE}=${encodeURIComponent(token)}`,
    'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=600'
  ];
  if (isSecure(req)) bits.push('Secure');
  appendCookie(res, bits.join('; '));
  return payload.state;
}

export function readOAuthState(req) {
  const secret = sessionSecret();
  if (!secret) return null;
  const raw = readCookie(req, STATE_COOKIE);
  if (!raw) return null;
  const dot = raw.lastIndexOf('.');
  if (dot === -1) return null;
  const body = raw.slice(0, dot);
  const mac = raw.slice(dot + 1);
  const expected = sign(body, secret);
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    return JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch (err) {
    return null;
  }
}

export function clearOAuthState(req, res) {
  const bits = [`${STATE_COOKIE}=`, 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0'];
  if (isSecure(req)) bits.push('Secure');
  appendCookie(res, bits.join('; '));
}

export function randomToken(bytes = 32) {
  return randomBytes(bytes).toString('base64url');
}

export function sha256Base64Url(input) {
  return createHash('sha256').update(input, 'utf8').digest('base64url');
}

/** The origin this request arrived on, used to build the OAuth redirect URI. */
export function originOf(req) {
  const proto = isSecure(req) ? 'https' : 'http';
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  return `${proto}://${Array.isArray(host) ? host[0] : host}`;
}

export function json(res, status, payload) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.status(status).send(JSON.stringify(payload));
}
