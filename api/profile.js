/**
 * Cross-device profile sync, keyed by a sync code and nothing else.
 *
 * GET  -> return the stored profile for a code, or 404.
 * POST -> merge the caller's profile into the stored one and return the result.
 *
 * The server holds only sha256(code), so a database leak yields no usable codes.
 * No email, no password, no personal data: the code IS the identity.
 */

import { createHash } from 'node:crypto';
import { query, databaseConfigured } from './_db.js';
import { mergeProfiles } from '../src/core/merge.js';

/* Codes are 20 chars from a 32-symbol alphabet with look-alikes removed. */
const CODE_RE = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{20}$/;
const MAX_BODY_BYTES = 1_000_000;
const MAX_WRITE_RETRIES = 4;

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

async function loadRow(codeHash) {
  const rows = await query(
    'select profile, rev, extract(epoch from updated_at) * 1000 as updated_ms from profiles where code_hash = $1',
    [codeHash]
  );
  if (!rows.length) return null;
  const row = rows[0];
  const profile = asProfile(row.profile);
  if (!profile) return null;
  return { profile, rev: Number(row.rev), updatedMs: Number(row.updated_ms) };
}

export default async function handler(req, res) {
  if (!databaseConfigured()) {
    return send(res, 503, { error: 'sync_unconfigured' });
  }

  const code = readCode(req);
  if (!code) return send(res, 400, { error: 'bad_code' });
  const codeHash = hashCode(code);

  try {
    if (req.method === 'GET') {
      const row = await loadRow(codeHash);
      if (!row) return send(res, 404, { error: 'not_found' });
      return send(res, 200, { profile: row.profile, rev: row.rev, updatedAt: row.updatedMs });
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
        const row = await loadRow(codeHash);

        if (!row) {
          const inserted = await query(
            `insert into profiles (code_hash, profile, rev)
             values ($1, $2::jsonb, 1)
             on conflict (code_hash) do nothing
             returning rev, extract(epoch from updated_at) * 1000 as updated_ms`,
            [codeHash, JSON.stringify(incoming)]
          );
          if (!inserted.length) continue; // someone inserted first; re-read and merge
          return send(res, 200, {
            profile: incoming,
            rev: Number(inserted[0].rev),
            updatedAt: Number(inserted[0].updated_ms),
            merged: false
          });
        }

        const merged = mergeProfiles(incoming, row.profile);
        const updated = await query(
          `update profiles
              set profile = $2::jsonb, rev = rev + 1, updated_at = now()
            where code_hash = $1 and rev = $3
        returning rev, extract(epoch from updated_at) * 1000 as updated_ms`,
          [codeHash, JSON.stringify(merged), row.rev]
        );
        if (!updated.length) continue; // lost the race; merge again against the new row

        return send(res, 200, {
          profile: merged,
          rev: Number(updated[0].rev),
          updatedAt: Number(updated[0].updated_ms),
          merged: true
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
