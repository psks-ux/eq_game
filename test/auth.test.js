/* Authentication primitives. The database is never touched here: every function
   under test is pure or purely cryptographic, which is exactly the part that has
   to be right before a single row is written. */

import test from 'node:test';
import assert from 'node:assert/strict';

/* Must be set before the module is imported: sessionSecret() reads the
   environment, and a short secret makes the OAuth state helpers fail closed. */
process.env.SESSION_SECRET = 'test-secret-that-is-comfortably-long-enough';

const {
  hashPassword, verifyPassword, passwordProblem, normaliseEmail,
  readCookie, setOAuthState, readOAuthState, sessionSecret,
  randomToken, sha256Base64Url, originOf, configReport
} = await import('../api/_auth.js');

/* ------------------------------------------------------------- harness */

function fakeReq(headers = {}) {
  return { headers, url: '/api/auth/google', method: 'GET' };
}

function fakeRes() {
  const headers = new Map();
  return {
    headers,
    getHeader: (k) => headers.get(k),
    setHeader: (k, v) => headers.set(k, v),
    cookies() {
      return [].concat(headers.get('Set-Cookie') || []);
    }
  };
}

/** Turn the Set-Cookie values a response collected into a Cookie request header. */
function cookieHeader(res) {
  return res.cookies()
    .map((c) => String(c).split(';')[0])
    .join('; ');
}

/* ----------------------------------------------------------- passwords */

test('a password round-trips through scrypt', async () => {
  const hash = await hashPassword('correct horse battery');
  assert.ok(hash.startsWith('scrypt$'), 'hash records its own parameters');
  assert.equal(await verifyPassword('correct horse battery', hash), true);
  assert.equal(await verifyPassword('correct horse batteru', hash), false);
});

test('the same password hashes differently every time', async () => {
  // A per-password salt is what stops one rainbow table from covering every row.
  const a = await hashPassword('the same password');
  const b = await hashPassword('the same password');
  assert.notEqual(a, b);
  assert.equal(await verifyPassword('the same password', a), true);
  assert.equal(await verifyPassword('the same password', b), true);
});

test('verifyPassword refuses malformed stored values instead of throwing', async () => {
  for (const bad of [null, undefined, '', 'not-a-hash', 'scrypt$1$2$3', 42, {}]) {
    assert.equal(await verifyPassword('anything', bad), false, `rejected: ${String(bad)}`);
  }
});

test('verifyPassword is not fooled by a truncated key', async () => {
  const hash = await hashPassword('a real password here');
  const parts = hash.split('$');
  parts[5] = parts[5].slice(0, 20);
  assert.equal(await verifyPassword('a real password here', parts.join('$')), false);
});

test('passwordProblem enforces length, not composition rules', () => {
  assert.equal(passwordProblem('a-long-enough-one'), null);
  assert.ok(passwordProblem('short'), 'nine characters or fewer is rejected');
  assert.ok(passwordProblem('         '), 'whitespace only is rejected');
  assert.ok(passwordProblem('x'.repeat(201)), 'absurd lengths are rejected');
  assert.ok(passwordProblem(null));
  // No upper/lower/digit/symbol rule: length is what actually buys strength.
  assert.equal(passwordProblem('aaaaaaaaaaaa'), null);
});

/* --------------------------------------------------------------- email */

test('normaliseEmail lowercases, trims and validates shape', () => {
  assert.equal(normaliseEmail('  Person@Example.COM '), 'person@example.com');
  assert.equal(normaliseEmail('a@b.co'), 'a@b.co');
  for (const bad of ['', 'no-at-sign', 'a@b', 'a@@b.com', 'a b@c.com', null, 42, 'a@b.']) {
    assert.equal(normaliseEmail(bad), null, `rejected: ${String(bad)}`);
  }
});

/* ------------------------------------------------------------- cookies */

test('readCookie finds one value among several', () => {
  const req = fakeReq({ cookie: 'a=1; eq_session=abc%2Fdef; b=2' });
  assert.equal(readCookie(req, 'eq_session'), 'abc/def');
  assert.equal(readCookie(req, 'missing'), null);
  assert.equal(readCookie(fakeReq({}), 'eq_session'), null);
});

test('a cookie value that is not valid percent-encoding does not throw', () => {
  const req = fakeReq({ cookie: 'eq_session=%E0%A4%A' });
  assert.equal(readCookie(req, 'eq_session'), null);
});

test('cookies are HttpOnly and SameSite=Lax, and Secure only behind https', () => {
  const plain = fakeRes();
  setOAuthState(fakeReq({}), plain, { state: 's', verifier: 'v', next: '/' });
  const local = String(plain.cookies()[0]);
  assert.match(local, /HttpOnly/);
  assert.match(local, /SameSite=Lax/);
  assert.ok(!/Secure/.test(local), 'no Secure flag on plain http, or localhost breaks');

  const https = fakeRes();
  setOAuthState(fakeReq({ 'x-forwarded-proto': 'https' }), https, { state: 's', verifier: 'v' });
  assert.match(String(https.cookies()[0]), /Secure/);
});

/* --------------------------------------------------------- OAuth state */

test('OAuth state round-trips through its signed cookie', () => {
  const res = fakeRes();
  const payload = { state: 'abc123', verifier: 'xyz789', next: '#/test', at: 1234 };
  setOAuthState(fakeReq({}), res, payload);

  const back = readOAuthState(fakeReq({ cookie: cookieHeader(res) }));
  assert.deepEqual(back, payload);
});

test('a tampered OAuth state cookie is rejected', () => {
  const res = fakeRes();
  setOAuthState(fakeReq({}), res, { state: 'abc123', verifier: 'xyz789', next: '/' });
  const raw = decodeURIComponent(cookieHeader(res).split('=').slice(1).join('='));
  const [body, mac] = [raw.slice(0, raw.lastIndexOf('.')), raw.slice(raw.lastIndexOf('.') + 1)];

  // Forged payload, original signature: the whole point of signing it.
  const forged = Buffer.from(JSON.stringify({ state: 'attacker', verifier: 'v' }), 'utf8')
    .toString('base64url');
  const withForgedBody = `eq_oauth=${encodeURIComponent(`${forged}.${mac}`)}`;
  assert.equal(readOAuthState(fakeReq({ cookie: withForgedBody })), null);

  // Original payload, mangled signature.
  const flipped = mac.slice(0, -1) + (mac.slice(-1) === 'A' ? 'B' : 'A');
  const withForgedMac = `eq_oauth=${encodeURIComponent(`${body}.${flipped}`)}`;
  assert.equal(readOAuthState(fakeReq({ cookie: withForgedMac })), null);

  assert.equal(readOAuthState(fakeReq({ cookie: 'eq_oauth=nonsense' })), null);
  assert.equal(readOAuthState(fakeReq({})), null);
});

test('a short SESSION_SECRET fails closed rather than signing weakly', async () => {
  const previous = process.env.SESSION_SECRET;
  try {
    process.env.SESSION_SECRET = 'too-short';
    assert.equal(sessionSecret(), null);
    const res = fakeRes();
    assert.equal(setOAuthState(fakeReq({}), res, { state: 's' }), null);
    assert.equal(res.cookies().length, 0, 'no cookie is set at all');
  } finally {
    process.env.SESSION_SECRET = previous;
  }
});

/* ------------------------------------------------------------ PKCE etc */

test('randomToken is url-safe and unique', () => {
  const seen = new Set();
  for (let i = 0; i < 200; i++) {
    const token = randomToken(32);
    assert.match(token, /^[A-Za-z0-9_-]+$/, 'no characters needing escaping in a URL');
    seen.add(token);
  }
  assert.equal(seen.size, 200);
});

test('sha256Base64Url matches the PKCE S256 test vector', () => {
  // RFC 7636 appendix B: the canonical verifier and its expected challenge.
  const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
  assert.equal(sha256Base64Url(verifier), 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
});

test('originOf follows the forwarded protocol and host', () => {
  assert.equal(originOf(fakeReq({ host: 'localhost:5173' })), 'http://localhost:5173');
  assert.equal(
    originOf(fakeReq({ 'x-forwarded-proto': 'https', 'x-forwarded-host': 'eq.example.com' })),
    'https://eq.example.com'
  );
  // Vercel can send a comma-joined list; only the first hop decides.
  assert.equal(
    originOf(fakeReq({ 'x-forwarded-proto': 'https,http', host: 'eq.example.com' })),
    'https://eq.example.com'
  );
});

/* ---------------------------------------------------------- diagnostics */

test('configReport names what is missing, and never a value', () => {
  const saved = {
    DATABASE_URL: process.env.DATABASE_URL,
    SESSION_SECRET: process.env.SESSION_SECRET,
    GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET
  };
  const restore = () => {
    for (const key of Object.keys(saved)) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  };

  try {
    delete process.env.DATABASE_URL;
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;
    process.env.SESSION_SECRET = 'x'.repeat(40);

    let report = configReport();
    assert.equal(report.DATABASE_URL, 'missing');
    assert.equal(report.SESSION_SECRET, 'ok');
    assert.equal(report.GOOGLE_CLIENT_ID, 'missing');
    assert.equal(report.ok, false);

    // The trap this exists for: a secret that is present but too short is
    // treated as absent everywhere else, and looks identical from outside.
    process.env.SESSION_SECRET = 'short-one';
    report = configReport();
    assert.match(report.SESSION_SECRET, /^too_short \(9 chars, need 32\)$/);
    assert.equal(sessionSecret(), null, 'and it still fails closed');

    process.env.DATABASE_URL = 'postgresql://u:p@h/db';
    process.env.SESSION_SECRET = 'y'.repeat(32);
    process.env.GOOGLE_CLIENT_ID = 'id';
    process.env.GOOGLE_CLIENT_SECRET = 'secret';
    report = configReport();
    assert.equal(report.ok, true, 'exactly 32 characters is enough');

    // No value ever appears in the report -- only a verdict per variable.
    const serialised = JSON.stringify(configReport());
    for (const value of ['postgresql://u:p@h/db', 'y'.repeat(32), 'secret']) {
      assert.ok(!serialised.includes(value), `report leaked ${value.slice(0, 12)}`);
    }
  } finally {
    restore();
  }
});
