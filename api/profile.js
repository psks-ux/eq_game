/**
 * Cross-device profile sync.
 *
 *   GET  -> return the stored profile for this identity, or 404.
 *   POST -> merge the caller's profile into the stored one and return the result.
 *
 * Two identities are accepted, and a signed-in account always wins over a sync
 * code so that signing in on a device that already had a code does the obvious
 * thing:
 *
 *   1. A session cookie  -> the profile belongs to a user account.
 *   2. An `x-sync-code`  -> the anonymous, account-free path that came first.
 *      The server holds only sha256(code), so a leak yields no usable codes.
 */

import { createHash } from 'node:crypto';
import { query, databaseConfigured } from './_db.js';
import { readSession, sessionSecret } from './_auth.js';
import { mergeProfiles } from '../src/core/merge.js';

/* Codes are 20 chars from a 31-symbol alphabet with look-alikes removed. */
const CODE_RE = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{20}$/;
const MAX_BODY_BYTES = 1_000_000;
const MAX_WRITE_RETRIES = 4;

/* Both identities store the same document in the same shape; only the table and
   the key column differ. Held as literals, never built from request data. */
const STORES = {
  user: { table: 'user_profiles', key: 'user_id', castKey: '$1::uuid' },
  code: { table: 'profiles', key: 'code_hash', castKey: '$1' }
};

function normaliseCode(raw) {
  if (typeof raw !== 'string') return null;
  const code = raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return CODE_RE.test(code) ? code : null;
}

function hashCode(code) {
  return createHash('sha256').update(code, 'utf8').digest('hex');
}

function readCode(req) {
  const header = req.headers['x-sync-code'];
  const fromHeader = Array.isArray(header) ? header[0] : header;
  // The code never travels in the URL: query strings land in server logs,
  // proxy logs and browser history.
  return normaliseCode(fromHeader) || normaliseCode(req.body && req.body.code);
}

function send(res, status, payload) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.status(status).send(JSON.stringify(payload));
}

/**
 * A jsonb column can arrive already parsed or as a string depending on the
 * driver's output mode. Normalise here rather than trusting one shape: a string
 * reaching the merge would be treated as a non-object and silently dropped.
 */
function asProfile(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
    } catch (err) {
      return null;
    }
  }
  return null;
}

/** Which identity is this request using? A session beats a sync code. */
async function identify(req) {
  if (sessionSecret()) {
    try {
      const session = await readSession(req);
      if (session) return { kind: 'user', key: session.userId, email: session.email };
    } catch (err) {
      /* A database hiccup during session lookup should not silently downgrade
         someone to their old anonymous profile, so fail rather than fall back. */
      throw err;
    }
  }
  const code = readCode(req);
  if (code) return { kind: 'code', key: hashCode(code) };
  return null;
}

async function loadRow(who) {
  const store = STORES[who.kind];
  const rows = await query(
    `select profile, rev, extract(epoch from updated_at) * 1000 as updated_ms
       from ${store.table} where ${store.key} = ${store.castKey}`,
    [who.key]
  );
  if (!rows.length) return null;
  const row = rows[0];
  const profile = asProfile(row.profile);
  if (!profile) return null;
  return { profile, rev: Number(row.rev), updatedMs: Number(row.updated_ms) };
}

async function insertRow(who, profile) {
  const store = STORES[who.kind];
  return query(
    `insert into ${store.table} (${store.key}, profile, rev)
     values (${store.castKey}, $2::jsonb, 1)
     on conflict (${store.key}) do nothing
     returning rev, extract(epoch from updated_at) * 1000 as updated_ms`,
    [who.key, JSON.stringify(profile)]
  );
}

async function updateRow(who, profile, rev) {
  const store = STORES[who.kind];
  return query(
    `update ${store.table}
        set profile = $2::jsonb, rev = rev + 1, updated_at = now()
      where ${store.key} = ${store.castKey} and rev = $3
  returning rev, extract(epoch from updated_at) * 1000 as updated_ms`,
    [who.key, JSON.stringify(profile), rev]
  );
}

export default async function handler(req, res) {
  if (!databaseConfigured()) {
    return send(res, 503, { error: 'sync_unconfigured' });
  }

  let who;
  try {
    who = await identify(req);
  } catch (err) {
    console.error('identity lookup failed:', err && err.message, err && err.detail);
    return send(res, 500, { error: 'sync_failed' });
  }
  if (!who) return send(res, 401, { error: 'no_identity' });

  const identity = { via: who.kind === 'user' ? 'account' : 'code' };

  try {
    if (req.method === 'GET') {
      const row = await loadRow(who);
      if (!row) return send(res, 404, { error: 'not_found', ...identity });
      return send(res, 200, {
        profile: row.profile, rev: row.rev, updatedAt: row.updatedMs, ...identity
      });
    }

    if (req.method === 'POST') {
      const incoming = req.body && req.body.profile;
      if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming)) {
        return send(res, 400, { error: 'bad_profile' });
      }
      if (Buffer.byteLength(JSON.stringify(incoming), 'utf8') > MAX_BODY_BYTES) {
        return send(res, 413, { error: 'profile_too_large' });
      }

      /* Optimistic concurrency: re-read and retry if another device committed
         between our read and our write. The merge is associative, so replaying it
         against the newer row is always safe. */
      for (let attempt = 0; attempt < MAX_WRITE_RETRIES; attempt++) {
        const row = await loadRow(who);

        if (!row) {
          const inserted = await insertRow(who, incoming);
          if (!inserted.length) continue; // someone inserted first; re-read and merge
          return send(res, 200, {
            profile: incoming,
            rev: Number(inserted[0].rev),
            updatedAt: Number(inserted[0].updated_ms),
            merged: false,
            ...identity
          });
        }

        const merged = mergeProfiles(incoming, row.profile);
        /* Measure what is actually STORED, not merely what arrived. Every
           container in the merge is a union, so repeated under-the-limit POSTs
           for one identity grow the row without bound until it stops being
           readable at all -- and any 20-character string is a valid identity. */
        if (Buffer.byteLength(JSON.stringify(merged), 'utf8') > MAX_BODY_BYTES) {
          return send(res, 413, { error: 'profile_too_large' });
        }
        const updated = await updateRow(who, merged, row.rev);
        if (!updated.length) continue; // lost the race; merge again against the new row

        return send(res, 200, {
          profile: merged,
          rev: Number(updated[0].rev),
          updatedAt: Number(updated[0].updated_ms),
          merged: true,
          ...identity
        });
      }

      return send(res, 409, { error: 'write_conflict' });
    }

    res.setHeader('Allow', 'GET, POST');
    return send(res, 405, { error: 'method_not_allowed' });
  } catch (err) {
    // Log server-side; return nothing that could describe the database.
    console.error('profile sync failed:', err && err.message, err && err.detail);
    return send(res, 500, { error: 'sync_failed' });
  }
}
