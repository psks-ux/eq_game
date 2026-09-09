/**
 * The current session.
 *
 *   GET    /api/auth/session  -> { signedIn, user, providers }
 *   DELETE /api/auth/session  -> sign out on this device
 *
 * The GET also reports which sign-in methods this deployment actually has
 * configured, so the sign-in screen can hide a button that could not work
 * rather than offering it and failing.
 */

import { databaseConfigured } from '../_db.js';
import { env } from '../_env.js';
import {
  sessionSecret, readSession, destroySession, clearSessionCookie,
  SESSION_COOKIE, readCookie, configReport, crossSiteProblem, json
} from '../_auth.js';

function providers() {
  const ready = databaseConfigured() && !!sessionSecret();
  return {
    password: ready,
    google: ready && !!(env('GOOGLE_CLIENT_ID') && env('GOOGLE_CLIENT_SECRET'))
  };
}

/**
 * Attach a per-variable configuration report, but only while something is wrong.
 * A working deployment therefore says nothing it was not already saying through
 * `providers`, and a broken one says exactly which variable to go and fix.
 */
function withConfig(payload) {
  const report = configReport();
  if (report.ok) return payload;
  const { ok, ...detail } = report;
  return { ...payload, config: detail };
}

export default async function handler(req, res) {
  const available = providers();

  if (req.method === 'DELETE') {
    /* A forced sign-out is a milder forgery than a forced sign-in, but it is still
       not something another origin gets to do. No body, so no content-type rule. */
    const forged = crossSiteProblem(req, { requireJson: false });
    if (forged) return json(res, 403, { error: forged });

    /* Delete FIRST. Clearing the cookie and then failing would strand a row that
       nothing can ever reach again -- the client no longer holds the token, and
       destroySession(null) returns early. Revocation must not depend on the caller
       still holding the credential being revoked. */
    let revoked = true;
    try {
      if (available.password) await destroySession(readCookie(req, SESSION_COOKIE));
    } catch (err) {
      revoked = false;
      console.error('sign-out revocation failed:', err && err.message);
    }
    /* Clear it either way: someone who asked to sign out must end up signed out
       locally even when the server could not revoke. */
    clearSessionCookie(req, res);
    return json(res, revoked ? 200 : 502,
      withConfig({ ok: revoked, revoked, signedIn: false, providers: available }));
  }

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET, DELETE');
    return json(res, 405, { error: 'method_not_allowed' });
  }

  if (!available.password) return json(res, 200, withConfig({ signedIn: false, providers: available }));

  try {
    const session = await readSession(req);
    if (!session) return json(res, 200, withConfig({ signedIn: false, providers: available }));
    return json(res, 200, withConfig({
      signedIn: true,
      user: { email: session.email, viaGoogle: session.viaGoogle },
      providers: available
    }));
  } catch (err) {
    console.error('session lookup failed:', err && err.message);
    return json(res, 200, withConfig({ signedIn: false, providers: available }));
  }
}
