/**
 * Email + password sign-in.
 *
 *   POST /api/auth/password  { mode: "register" | "signin", email, password }
 *
 * Passwords are stored as scrypt hashes and compared in constant time. Repeated
 * failures lock an account for a few minutes so that an online guessing attack
 * costs far more than it can win.
 */

import { query, databaseConfigured } from '../_db.js';
import {
  sessionSecret, hashPassword, verifyPassword, passwordProblem, normaliseEmail,
  createSession, setSessionCookie, lockoutRemaining, noteFailedLogin,
  clearFailedLogins, json
} from '../_auth.js';

const MAX_BODY_BYTES = 8 * 1024;

/* Deliberately identical for "no such account", "wrong password" and "this
   account only has Google". Which of the three it was is exactly the fact an
   attacker is probing for. */
const GENERIC = 'That email and password do not match an account.';

async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) return null;
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch (err) {
    return null;
  }
}

async function register(req, res, email, password) {
  const problem = passwordProblem(password);
  if (problem) return json(res, 400, { error: 'weak_password', message: problem });

  const existing = await query('select id, password_hash, google_sub from users where email = $1', [email]);
  if (existing.length) {
    /* This does reveal that the address is registered. Hiding it properly needs
       a verification email, which this app has no mail service for; telling
       someone to sign in instead is worth more than the small disclosure. */
    const viaGoogle = !existing[0].password_hash && existing[0].google_sub;
    return json(res, 409, {
      error: 'email_taken',
      message: viaGoogle
        ? 'That email is already registered through Google. Use "Continue with Google".'
        : 'That email is already registered. Sign in instead.'
    });
  }

  const hash = await hashPassword(password);
  const created = await query(
    `insert into users (email, password_hash) values ($1, $2)
     on conflict (email) do nothing
     returning id`,
    [email, hash]
  );
  if (!created.length) {
    // Lost a race with a simultaneous registration of the same address.
    return json(res, 409, { error: 'email_taken', message: 'That email is already registered. Sign in instead.' });
  }

  const { token, expires } = await createSession(created[0].id, req.headers['user-agent']);
  setSessionCookie(req, res, token, expires);
  return json(res, 201, { ok: true, user: { email, viaGoogle: false } });
}

async function signin(req, res, email, password) {
  const rows = await query(
    'select id, password_hash, google_sub, locked_until from users where email = $1',
    [email]
  );
  if (!rows.length) {
    /* Spend roughly the same time as a real verification would, so response
       latency does not answer "does this address exist?". */
    await hashPassword(password);
    return json(res, 401, { error: 'bad_credentials', message: GENERIC });
  }

  const user = rows[0];
  const locked = await lockoutRemaining(user);
  if (locked > 0) {
    return json(res, 429, {
      error: 'locked',
      message: `Too many attempts. Try again in ${locked} minute${locked === 1 ? '' : 's'}.`
    });
  }

  const ok = user.password_hash && await verifyPassword(password, user.password_hash);
  if (!ok) {
    await noteFailedLogin(user.id);
    return json(res, 401, { error: 'bad_credentials', message: GENERIC });
  }

  await clearFailedLogins(user.id);
  const { token, expires } = await createSession(user.id, req.headers['user-agent']);
  setSessionCookie(req, res, token, expires);
  return json(res, 200, { ok: true, user: { email, viaGoogle: !!user.google_sub } });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return json(res, 405, { error: 'method_not_allowed' });
  }
  if (!databaseConfigured() || !sessionSecret()) {
    return json(res, 503, { error: 'auth_unconfigured' });
  }

  const body = await readBody(req);
  if (!body) return json(res, 400, { error: 'bad_request' });

  const email = normaliseEmail(body.email);
  if (!email) return json(res, 400, { error: 'bad_email', message: 'Enter a valid email address.' });
  const password = typeof body.password === 'string' ? body.password : '';

  try {
    if (body.mode === 'register') return await register(req, res, email, password);
    return await signin(req, res, email, password);
  } catch (err) {
    console.error('password auth failed:', err && err.message, err && err.detail);
    return json(res, 500, { error: 'auth_failed' });
  }
}
