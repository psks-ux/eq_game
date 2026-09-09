# Sign-in

Signing in is **recommended, never required**. The app measures and trains exactly the
same way for a guest, the assessment is identical, and no screen refuses to open because
someone declined an account. The whole feature exists for one reason: a browser's local
storage is not a safe place to keep a result somebody worked for.

Three identities can carry a profile, and they are ordered:

| identity | where the profile lives | recovery |
|---|---|---|
| signed-in account | `user_profiles`, keyed by user id | email + password, or Google |
| sync code | `profiles`, keyed by `sha256(code)` | none by design |
| neither (guest) | `localStorage` only | export the JSON file |

A session always wins over a sync code. Someone who links a code and then signs in gets
the obvious result — the account carries the profile, the code goes unused — and the
settings screen says so rather than leaving them to guess.

## Why accounts at all, given the sync code

`docs/SYNC.md` argues that a code beats an account: no personal data, nothing to leak,
and no login form to translate. That argument still holds, and the code has not been
removed. What it cannot do is survive being forgotten. There is no recovery flow for a
sync code, because recovery needs an identity, and people lose codes. An account is the
answer for anyone who would rather trade an email address for the ability to get back in.

Both are offered. Neither is required.

## The one screen with words

The rest of the app is deliberately language-free: no words, no number names, no cultural
symbols, so that a person from any country starts on equal footing. An email field and a
password field cannot honour that — two unlabelled boxes are not a fair test of anything,
they are just a puzzle nobody consented to.

So `#/signin` opts out of the labels-off setting (`.screen-signin` in `screens.css`) and
always shows its text. **Nothing about the measurement or the training changes.** The
assessment and every drill remain wordless whether someone is signed in or not, and the
sign-in screen is never on the path to either.

## Password storage

scrypt via `node:crypto`, `N=16384, r=8, p=1`, 64-byte key, 16-byte random salt, with
`maxmem` raised because Node refuses those parameters at its default. Roughly 100 ms per
hash on serverless hardware — the cost is the point: it is what makes offline guessing
expensive if the table ever leaks.

The stored value records its own parameters, so the cost can be raised later without
invalidating existing rows:

    scrypt$16384$8$1$<salt base64>$<key base64>

Comparison is `timingSafeEqual`. A stored key shorter than 32 bytes is rejected outright
rather than verified: scrypt's shorter output is a *prefix* of its longer output, so a row
truncated in the database would otherwise still verify against the right password, at a
fraction of the intended work. There is a test for that case.

The only password rule is length — at least 10 characters. Composition rules (one upper,
one digit, one symbol) push people toward `Password1!` and buy less than length does.

## Online guessing

Eight consecutive failures lock an account for fifteen minutes; a success clears the
counter. The lock is per account, stored on the row, so it survives across serverless
instances where an in-memory rate limiter would not.

Failed sign-in always answers with the same sentence, whether the address is unknown, the
password is wrong, or the account has only ever used Google — those three facts are
exactly what an attacker is probing for. When the address is unknown the endpoint still
spends a full scrypt hash before answering, so response time does not leak the answer that
the message withholds.

**Registration does reveal that an address is taken**, and that is a deliberate exception.
Hiding it properly requires sending a verification email, which this deployment has no
mail service for; the alternative is to accept a registration that silently does nothing,
which is worse for the person and no better for anyone else. The disclosure is one bit
about an address the requester already typed.

## Sessions

An opaque 256-bit random token, `base64url`, stored in the database as `sha256(token)` and
in the browser as an `HttpOnly; Secure; SameSite=Lax` cookie for 60 days. Not a JWT: an
opaque token can be revoked by deleting a row, and sign-out has to actually sign someone
out.

`SameSite=Lax` rather than `Strict` because the Google callback is a top-level cross-site
redirect, and a `Strict` cookie is not sent with one — sign-in would appear to succeed and
then not have happened. `Secure` is set whenever `x-forwarded-proto` is `https`, and
omitted otherwise so that `http://localhost` development works at all.

Signing out deletes the row and clears the cookie. It does **not** touch local storage:
ending a session is not the same as discarding the work done on that device, and treating
it as such would lose someone's training the first time they signed out to switch accounts.

## Google

Authorisation-code flow with PKCE (S256), server-side, in a single route:

```
GET /api/auth/google              -> 302 to accounts.google.com
GET /api/auth/google?code=...     -> exchange, sign in, 302 back to the app
```

One route means **one redirect URI to register**, which is the whole reason it is shaped
this way.

- **Scope is `openid email` only.** No `profile`: the app has no use for a name or a
  photograph, and collecting them would contradict everything else in this document.
- **`state` lives in a short-lived HMAC-signed cookie** and is compared in constant time
  against what Google echoes back. This is what stops an attacker from feeding the app an
  authorisation code they obtained themselves.
- **PKCE** covers the case where the code is intercepted before the exchange.
- **`next`** is carried inside the signed state and is only ever honoured if it is a
  same-document hash route (`#/...`). An open redirector is a phishing primitive, and one
  attached to a sign-in flow is the worst kind.

### The ID token is not signature-checked, on purpose

The `id_token` arrives in the response body of a direct server-to-server POST to
`https://oauth2.googleapis.com/token`, over TLS, authenticated with the client secret.
The transport already establishes that Google produced it, which is precisely the case
OpenID Connect Core §3.1.3.7 exempts from signature verification. Fetching JWKS would add
a network round trip and a key-rotation failure mode to prove something TLS has already
proven.

The *claims* are still checked, because "Google sent it" is not the same as "it is for
us": `aud` must equal our client id, `iss` must be Google, `exp` must be in the future,
and `iat` must not be implausibly far ahead.

### Linking a Google sign-in to an existing password account

Only when Google reports `email_verified: true`. Linking on an unverified claim would let
anyone able to register that address at Google take over the matching local account. When
the claim is unverified, a separate account is created with no email stored at all.

## What the server keeps

```sql
create table users (
  id              uuid primary key default gen_random_uuid(),
  email           text unique,
  email_verified  boolean     not null default false,
  password_hash   text,
  google_sub      text unique,
  failed_attempts integer     not null default 0,
  locked_until    timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint users_has_a_credential
    check (password_hash is not null or google_sub is not null)
);

create table sessions (
  token_hash text primary key,          -- sha256 of the token, never the token
  user_id    uuid not null references users(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  user_agent text
);
create index sessions_user_id_idx on sessions (user_id);

create table user_profiles (
  user_id    uuid primary key references users(id) on delete cascade,
  profile    jsonb       not null,
  rev        bigint      not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```

An email address, a password hash, a Google subject id, a truncated user agent, and the
profile document. No name, no photograph, no analytics, no history beyond the profile's
own assessment list. `on delete cascade` means deleting a user row removes their sessions
and their stored profile with it.

## Endpoints

| route | method | does |
|---|---|---|
| `/api/auth/session` | `GET` | who am I, and which providers this deployment has |
| `/api/auth/session` | `DELETE` | sign out on this device |
| `/api/auth/password` | `POST` | `{ mode: "register" \| "signin", email, password }` |
| `/api/auth/google` | `GET` | start the flow, and receive its callback |
| `/api/profile` | `GET`/`POST` | read and merge the profile for the current identity |

`GET /api/auth/session` reports `providers`, so the sign-in screen can hide a button that
could not work rather than offering it and failing. With nothing configured it reports
both as false and the screen says accounts are unavailable on this deployment.

## Configuration

| variable | required for | notes |
|---|---|---|
| `DATABASE_URL` | everything | Postgres, `?sslmode=require` |
| `SESSION_SECRET` | sessions, Google | ≥ 32 characters; shorter fails closed |
| `GOOGLE_CLIENT_ID` | Google | from the Google Cloud console |
| `GOOGLE_CLIENT_SECRET` | Google | set it in the host's env, never in the repo |
| `PUBLIC_ORIGIN` | Google, optionally | pins the redirect URI when the host varies |

`SESSION_SECRET` under 32 characters is treated as absent rather than used weakly: an
endpoint that is unavailable is better than one anybody can forge a session against.

Register this redirect URI on the Google client, exactly:

    https://<your-domain>/api/auth/google

and, for local work, `http://localhost:<port>/api/auth/google`. Google matches it byte for
byte. On a host that serves preview deployments under changing domains, set
`PUBLIC_ORIGIN` to the one canonical origin so the URI sent to Google never drifts.

## Failure behaviour

Everything degrades to guest play, never to a broken screen:

- no `DATABASE_URL`, or no `SESSION_SECRET` → endpoints report 503, the sign-in screen
  says accounts are unavailable, and the prompt on the home screen never appears
- no Google credentials → the Google button is not rendered at all
- `file://` or the standalone single-file build → `authAvailable()` is false and the
  screen explains that this copy runs offline only
- a cancelled or failed Google flow → back to the app with `?auth=cancelled`, still a
  guest, nothing lost
- a failed sync after signing in → the sign-in still counts; local storage is unchanged
  and the next sync carries the same data

## Tests

- `test/auth.test.js` — scrypt round-trip and the truncated-hash rejection, email
  normalisation, cookie flags per protocol, OAuth state signing including two forgery
  attempts, the RFC 7636 PKCE S256 test vector, and the short-secret fail-closed path.
- `test/clientAuth.test.js` — the client module with no backend: signed out, no provider
  advertised, sign-in attempts that fail cleanly instead of throwing, and `googleUrl`
  refusing every `next` that is not a hash route.
