/**
 * Google sign-in, both halves of the authorisation-code flow in one route so that
 * only a single redirect URI ever has to be registered with Google:
 *
 *   GET /api/auth/google              -> redirect to Google's consent screen
 *   GET /api/auth/google?code=...     -> Google's callback; exchange, sign in, go home
 *
 * PKCE plus an HMAC-signed `state` cookie. The state cookie is what stops someone
 * from feeding us an authorisation code they obtained themselves.
 */

import { timingSafeEqual } from 'node:crypto';
import { query, databaseConfigured } from '../_db.js';
import {
  sessionSecret, createSession, setSessionCookie,
  setOAuthState, readOAuthState, clearOAuthState,
  randomToken, sha256Base64Url, originOf, json
} from '../_auth.js';

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const ISSUERS = new Set(['accounts.google.com', 'https://accounts.google.com']);

export function googleConfigured() {
  return !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

/**
 * Vercel rewrites and preview deployments can both change the host, and Google
 * matches the redirect URI byte for byte. PUBLIC_ORIGIN pins it when set.
 */
function redirectUri(req) {
  const base = process.env.PUBLIC_ORIGIN || originOf(req);
  return `${base.replace(/\/+$/, '')}/api/auth/google`;
}

/** Only same-document hash targets. An open redirector is a phishing primitive. */
function safeNext(raw) {
  if (typeof raw !== 'string') return '/';
  if (!raw.startsWith('#/')) return '/';
  if (/[\s"'<>\\]/.test(raw)) return '/';
  return raw.slice(0, 120);
}

function backToApp(res, next, params) {
  const search = new URLSearchParams(params || {}).toString();
  const hash = next && next !== '/' ? next : '#/';
  res.statusCode = 302;
  res.setHeader('Location', `/${search ? `?${search}` : ''}${hash}`);
  res.setHeader('Cache-Control', 'no-store');
  res.end();
}

/* base64url payload of a JWT. The token came straight from Google's token
   endpoint over TLS, authenticated with our client secret, so the transport
   authenticates it and no JWKS fetch is needed -- but the claims are still
   checked below, because "it parsed" is not the same as "it is for us". */
function decodeIdToken(idToken) {
  const parts = String(idToken || '').split('.');
  if (parts.length !== 3) return null;
  try {
    return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  } catch (err) {
    return null;
  }
}

function claimsValid(claims, clientId) {
  if (!claims || typeof claims !== 'object') return false;
  if (claims.aud !== clientId) return false;
  if (!ISSUERS.has(claims.iss)) return false;
  if (!claims.sub) return false;
  const now = Math.floor(Date.now() / 1000);
  if (!(Number(claims.exp) > now)) return false;
  /* Small skew allowance: serverless clocks are not perfect. */
  if (Number(claims.iat) > now + 300) return false;
  return true;
}

/**
 * Resolve the Google identity to a user row, refusing rather than guessing.
 * Returns a user id, or null meaning "do not sign anyone in".
 *
 * Two directions of takeover have to be closed, and only one of them is obvious:
 *
 *  - Attacker registers a password account at victim@example.com. Registration
 *    proves nothing, because there is no mail service. The victim later signs in
 *    with Google, and linking on a matching address alone would hand them the
 *    ATTACKER's row: the victim's profile syncs into it and the attacker's
 *    password still works. So a local row is linkable only if WE verified it,
 *    not merely because Google verified its own copy of the address.
 *  - Attacker registers the address at Google. Covered by requiring Google's
 *    `email_verified`, which was already the case here.
 */
export async function findOrCreateUser(sub, email, emailVerified) {
  const bySub = await query('select id from users where google_sub = $1', [sub]);
  if (bySub.length) return bySub[0].id;

  if (email && emailVerified) {
    const byEmail = await query(
      'select id, google_sub, password_hash, email_verified from users where email = $1',
      [email]
    );
    if (byEmail.length) {
      const row = byEmail[0];
      /* Reaching here with google_sub set means the row belongs to a DIFFERENT
         Google subject -- the lookup above already missed on this one. That is a
         recycled or reassigned Workspace address, not our user. Refuse. */
      if (row.google_sub) return row.google_sub === sub ? row.id : null;

      /* An unverified local password row is an unproven claim on this address.
         With no mail service there is no way to prove it, so refusing is the only
         honest answer; the person can sign in with their password instead. */
      if (row.password_hash && !row.email_verified) return null;

      await query(
        'update users set google_sub = $2, email_verified = true, updated_at = now() where id = $1',
        [row.id, sub]
      );
      return row.id;
    }
  }

  const stored = emailVerified ? email : null;
  const created = await query(
    `insert into users (email, email_verified, google_sub)
     values ($1, $2, $3)
     on conflict (google_sub) do update set updated_at = now()
     returning id`,
    [stored, !!emailVerified, sub]
  );
  return created[0].id;
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return json(res, 405, { error: 'method_not_allowed' });
  }
  if (!databaseConfigured() || !googleConfigured() || !sessionSecret()) {
    return json(res, 503, { error: 'google_unconfigured' });
  }

  const url = new URL(req.url, 'http://localhost');
  const clientId = process.env.GOOGLE_CLIENT_ID;

  /* ------------------------------------------------------------- start */
  if (!url.searchParams.has('code') && !url.searchParams.has('error')) {
    const state = randomToken(24);
    const verifier = randomToken(32);
    const next = safeNext(url.searchParams.get('next'));
    setOAuthState(req, res, { state, verifier, next, at: Date.now() });

    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri(req),
      response_type: 'code',
      /* `openid email` only. No profile scope: the app has no use for a name or a
         photograph, and collecting them would contradict its own privacy claim. */
      scope: 'openid email',
      state,
      code_challenge: sha256Base64Url(verifier),
      code_challenge_method: 'S256',
      access_type: 'online',
      prompt: 'select_account'
    });
    res.statusCode = 302;
    res.setHeader('Location', `${AUTH_URL}?${params}`);
    res.setHeader('Cache-Control', 'no-store');
    return res.end();
  }

  /* ---------------------------------------------------------- callback */
  const saved = readOAuthState(req);
  clearOAuthState(req, res);
  const next = saved ? safeNext(saved.next) : '/';

  if (url.searchParams.has('error')) {
    /* The person pressed cancel, or Google refused. Not an app error. */
    return backToApp(res, next, { auth: 'cancelled' });
  }
  if (!saved) return backToApp(res, next, { auth: 'expired' });

  const given = Buffer.from(String(url.searchParams.get('state') || ''));
  const expected = Buffer.from(String(saved.state || ''));
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return backToApp(res, next, { auth: 'state' });
  }

  try {
    const body = new URLSearchParams({
      code: url.searchParams.get('code'),
      client_id: clientId,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      redirect_uri: redirectUri(req),
      grant_type: 'authorization_code',
      code_verifier: saved.verifier
    });
    const tokenRes = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body
    });
    if (!tokenRes.ok) {
      console.error('google token exchange failed:', tokenRes.status);
      return backToApp(res, next, { auth: 'failed' });
    }
    const tokens = await tokenRes.json();
    const claims = decodeIdToken(tokens.id_token);
    if (!claimsValid(claims, clientId)) {
      console.error('google id_token rejected');
      return backToApp(res, next, { auth: 'failed' });
    }

    const email = typeof claims.email === 'string' ? claims.email.toLowerCase() : null;
    const userId = await findOrCreateUser(claims.sub, email, claims.email_verified === true);
    if (!userId) {
      /* An existing row claims this address and we cannot prove it belongs to
         the person in front of us. Refusing beats handing over someone's account. */
      return backToApp(res, next, { auth: 'link_conflict' });
    }
    const { token, expires } = await createSession(userId, req.headers['user-agent']);
    setSessionCookie(req, res, token, expires);
    return backToApp(res, next, { auth: 'in' });
  } catch (err) {
    console.error('google sign-in failed:', err && err.message);
    return backToApp(res, next, { auth: 'failed' });
  }
}
