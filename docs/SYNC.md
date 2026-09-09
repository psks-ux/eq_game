# Cross-device profiles

The app keeps a profile in `localStorage` and works entirely offline. Sync is an
optional layer on top: linking a device never becomes a requirement, and nothing
about the assessment or the training changes when it is switched off.

## Identity: a sync code, not an account

A sync code is 20 characters drawn from a 31-symbol alphabet with the look-alikes
removed (`O/0`, `I/1/L` never appear), displayed in groups of four:

    K7M2-4XQP-9B3F-R8TW-2NCD

That is roughly 99 bits of entropy from `crypto.getRandomValues`, mapped without
modulo bias — bytes that would skew the alphabet are resampled rather than folded in.

The code **is** the identity. There is no email, no password, no OAuth provider and
no personal data anywhere in the system. This was chosen deliberately:

- The product claim is that a person from any country starts equal. A login form is
  the one screen that cannot be made language-neutral, and an email field is the one
  place the app would start collecting personal data.
- The server stores only `sha256(code)`. A database leak yields hashes, not codes,
  and therefore no access to any profile.
- The code travels in an `x-sync-code` header, never in a URL. Query strings end up
  in server logs, proxy logs and browser history.

**The trade-off, stated plainly:** lose the code and you lose the ability to reach
that profile from a new device — there is no recovery flow, because a recovery flow
requires an identity we deliberately do not collect. Anyone who has the code has the
profile. The UI says exactly this next to the code.

## The merge

Two devices can both train offline and then both sync. Neither may erase the other,
so `src/core/merge.js` is written as a join-semilattice: every rule is **idempotent**,
**commutative** and **associative**. Those three properties are what make a repeating
sync loop converge on a fixed point instead of oscillating, and they are enforced by
property tests in `test/merge.test.js` rather than assumed.

| Field | Rule | Why |
|---|---|---|
| `assessments` | union, keyed by `at` | Append-only history; the same administration seen twice is one record. |
| `status`, `currentIndex` | derived from the newest assessment | The most recent measurement is the truth. |
| `peakIndex` | max over both sides and all assessments | A historical best never regresses. |
| `tier` | max | A merge must never re-lock content already unlocked elsewhere. |
| `xp` | max | See "counters" below. |
| `levels.*` | `unlocked` OR; `stars`/`bestScore`/`bestLevel`/`attempts`/`lastAt` max | Best-of; progress only moves forward. |
| `drillStats.*` | counts max; `accuracy`/`msPerTrial` from the side with more trials | Rates should come from more evidence, not from whoever synced last. |
| `factorScores.*` | max per factor | Training progress does not regress on a merge. |
| `bank.*` | winner under the total order (`n` desc, then `b` asc) | More observations means a better difficulty estimate; a total order keeps the choice commutative. |
| `settings` | last write wins, ties broken on value | Preferences express what someone wants *now*, not work they accumulated. |
| `streak` | max | |

### Counters are "max", not "sum"

`xp`, `attempts` and `sessions` take the maximum rather than the sum. Summing is not
idempotent: because a sync loop merges the same pair repeatedly, sums would inflate
without bound. The honest reading of `attempts` is therefore "the most attempts seen
on any one device", not a true cross-device total. Correctness of the loop was worth
more than the cosmetic accuracy of a counter.

### Elimination cannot be escaped by merging

Standing is derived from the newest assessment in the merged history, never from the
recorded `status` field and never from the device clock. If someone qualified on one
device, re-tested later and fell below 100, the newer result stands after a merge in
either direction. A stale qualified record with a newer wall clock does not resurrect
access — there is a test for exactly that case.

## Where the merge runs

Both sides, and that is intentional:

1. The client `POST`s its local profile.
2. The server loads the stored row, merges, and writes back under an optimistic
   `rev` check, retrying on a lost race. Because the merge is associative, replaying
   it against a newer row is always safe.
3. The client merges the response into whatever is local *now* — the user may have
   finished a drill while the request was in flight. The merge is idempotent, so
   doing it twice costs nothing.

## Failure behaviour

Local storage is the source of truth and every read and write in the app stays
synchronous and offline. Sync is best-effort in every direction:

- No network, a timeout, a 5xx, or no `DATABASE_URL` configured → the local profile is
  untouched and the UI says so. Training is never interrupted by a failed sync.
- `file://` or the standalone single-file build → `syncAvailable()` is false, the card
  explains that this copy runs offline only, and nothing else changes.
- A profile over 1 MB is rejected with 413 rather than silently truncated.

## Schema

```sql
create table profiles (
  code_hash  text primary key,      -- sha256 of the sync code, never the code
  profile    jsonb       not null,
  rev        bigint      not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index profiles_updated_at_idx on profiles (updated_at desc);
```

## Deployment

Set one environment variable in the hosting project:

    DATABASE_URL = postgresql://<user>:<password>@<host>/<db>?sslmode=require

`api/_db.js` talks to Neon over its HTTP SQL endpoint with plain `fetch`, so the
project keeps its no-dependency property on the server as well as the client. Without
`DATABASE_URL` the endpoint returns 503 and the app degrades to local-only —
deploying without a database is a supported configuration, not a broken one.

## What this is not

There is no account recovery, no server-side history, no admin view, and no analytics.
The server holds one JSON document per code hash and nothing else. If a profile needs
to move without sync, Settings → Export still writes a single JSON file.
