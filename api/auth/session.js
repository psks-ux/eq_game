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
import {
  sessionSecret, readSession, destroySession, clearSessionCookie,
  SESSION_COOKIE, readCookie, json
} from '../_auth.js';

function providers() {
  const ready = databaseConfigured() && !!sessionSecret();
  return {
    password: ready,
    google: ready && !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET)
  };
}

export default async function handler(req, res) {
  const available = providers();

  if (req.method === 'DELETE') {
    /* Clear the cookie whatever happens: a client asking to sign out must end up
       signed out even if the row could not be deleted. */
    clearSessionCookie(req, res);
    try {
      if (available.password) await destroySession(readCookie(req, SESSION_COOKIE));
    } catch (err) {
      console.error('sign-out cleanup failed:', err && err.message);
    }
    return json(res, 200, { ok: true, signedIn: false, providers: available });
  }

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET, DELETE');
    return json(res, 405, { error: 'method_not_allowed' });
  }

  if (!available.password) return json(res, 200, { signedIn: false, providers: available });

  try {
    const session = await readSession(req);
    if (!session) return json(res, 200, { signedIn: false, providers: available });
    return json(res, 200, {
      signedIn: true,
      user: { email: session.email, viaGoogle: session.viaGoogle },
      providers: available
    });
  } catch (err) {
    console.error('session lookup failed:', err && err.message);
    return json(res, 200, { signedIn: false, providers: available });
  }
}
