/**
 * Minimal Postgres access over Neon's HTTP SQL endpoint. Uses plain fetch so the
 * project keeps its no-dependency property on the server as well as the client.
 * Underscore-prefixed, so Vercel does not expose it as a route.
 */

const RAW = process.env.DATABASE_URL || '';

let endpoint = null;
function sqlEndpoint() {
  if (endpoint) return endpoint;
  if (!RAW) throw new Error('DATABASE_URL is not set');
  endpoint = `https://${new URL(RAW).host}/sql`;
  return endpoint;
}

/**
 * Runs one parameterised statement. Parameters are always sent out of band, so
 * values can never be interpreted as SQL.
 */
export async function query(text, params = []) {
  const res = await fetch(sqlEndpoint(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Neon-Connection-String': RAW,
      /* Must stay false: raw text output returns every column as a string, which
         turns a jsonb profile into a string and makes the merge silently discard
         it as a non-object. */
      'Neon-Raw-Text-Output': 'false',
      'Neon-Array-Mode': 'false'
    },
    body: JSON.stringify({ query: text, params })
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    const err = new Error(`neon http ${res.status}`);
    err.status = res.status;
    // Never surface the connection string or raw driver output to a caller.
    err.detail = detail.slice(0, 300);
    throw err;
  }

  const body = await res.json();
  return body.rows || [];
}

export function databaseConfigured() {
  return !!RAW;
}
