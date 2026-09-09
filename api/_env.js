/**
 * Environment variables, trimmed.
 *
 * A value pasted into a hosting dashboard routinely arrives with a leading tab
 * or a trailing newline, and every symptom that produces is baffling: a Google
 * client id with one tab in front is sent verbatim, percent-encoded into the
 * authorisation URL, and Google answers `invalid_client` while the value on
 * screen looks perfectly correct. That happened to this deployment.
 *
 * Nothing downstream ever wants the surrounding whitespace, so it is removed
 * once, here, rather than defended against at each of the eight read sites.
 * Underscore-prefixed, so Vercel does not route to it.
 */

/** The trimmed value, or '' when unset. Never returns null or undefined. */
export function env(name) {
  const raw = process.env[name];
  return typeof raw === 'string' ? raw.trim() : '';
}

/** True when the configured value carried whitespace that had to be removed. */
export function envWasPadded(name) {
  const raw = process.env[name];
  return typeof raw === 'string' && raw.length > 0 && raw !== raw.trim();
}
