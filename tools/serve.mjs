/**
 * Zero-dependency static file server for local development on http://localhost:5173.
 * Correct MIME types, no caching at all, directory-index resolution, and no path escapes.
 */

import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = path.resolve(HERE, '..');
const DEFAULT_PORT = 5173;
const DEFAULT_HOST = 'localhost';

const USAGE = [
  'Usage: node tools/serve.mjs [options]',
  '',
  '  --root <dir>   directory to serve (default: the repository root)',
  '  --port <n>     port (default: 5173, or $PORT)',
  '  --host <name>  interface to bind (default: localhost)',
  '  --quiet        do not log requests',
  '  --help         this text',
  ''
].join('\n');

/**
 * Content types. Anything not listed is served as application/octet-stream, which is the
 * safe default: a browser will download it rather than guess and execute it.
 */
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.wasm': 'application/wasm'
};

function parseArgs(argv) {
  const opts = {
    root: DEFAULT_ROOT,
    port: Number(process.env.PORT) || DEFAULT_PORT,
    host: DEFAULT_HOST,
    quiet: false,
    help: false,
    error: false
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') opts.help = true;
    else if (a === '--quiet' || a === '-q') opts.quiet = true;
    else if (a === '--root') opts.root = path.resolve(argv[++i] || '.');
    else if (a === '--port') opts.port = Number(argv[++i]);
    else if (a === '--host') opts.host = argv[++i] || DEFAULT_HOST;
    else if (a.startsWith('--root=')) opts.root = path.resolve(a.slice(7));
    else if (a.startsWith('--port=')) opts.port = Number(a.slice(7));
    else if (a.startsWith('--host=')) opts.host = a.slice(7);
    else {
      process.stderr.write(`serve: unknown argument ${a}\n`);
      opts.help = true;
      opts.error = true;
    }
  }
  if (!Number.isInteger(opts.port) || opts.port < 0 || opts.port > 65535) {
    process.stderr.write('serve: --port must be an integer in 0..65535\n');
    opts.help = true;
    opts.error = true;
  }
  return opts;
}

function mimeFor(filePath) {
  return MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
}

async function statOrNull(p) {
  try {
    return await fsp.stat(p);
  } catch {
    return null;
  }
}

function sendText(res, status, body, extraHeaders) {
  const buf = Buffer.from(body, 'utf8');
  res.writeHead(status, {
    'content-type': 'text/plain; charset=utf-8',
    'content-length': buf.length,
    'cache-control': 'no-store, no-cache, must-revalidate',
    ...(extraHeaders || {})
  });
  res.end(buf);
}

/**
 * Maps a request path to a file inside the root. Returns null for anything that escapes
 * the root, and a redirect instruction for a directory without a trailing slash (otherwise
 * relative URLs inside its index.html would resolve one level too high).
 */
async function resolveTarget(root, urlPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    return { kind: 'bad' };
  }
  if (decoded.includes('\0')) return { kind: 'bad' };

  const normalised = path.posix.normalize(decoded);
  if (normalised.startsWith('../')) return { kind: 'forbidden' };

  const abs = path.resolve(root, `.${normalised.startsWith('/') ? '' : '/'}${normalised}`);
  const rel = path.relative(root, abs);
  if (rel.startsWith('..') || path.isAbsolute(rel)) return { kind: 'forbidden' };

  const st = await statOrNull(abs);
  if (st && st.isDirectory()) {
    if (!decoded.endsWith('/')) return { kind: 'redirect', to: `${urlPath}/` };
    const index = path.join(abs, 'index.html');
    const ist = await statOrNull(index);
    if (ist && ist.isFile()) return { kind: 'file', file: index, stat: ist };
    return { kind: 'directory', dir: abs };
  }
  if (st && st.isFile()) return { kind: 'file', file: abs, stat: st };
  return { kind: 'missing' };
}

async function directoryListing(root, dir, urlPath) {
  const entries = await fsp.readdir(dir, { withFileTypes: true });
  const rows = entries
    .filter((e) => !e.name.startsWith('.'))
    .sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name))
    .map((e) => `${e.isDirectory() ? '[dir] ' : '      '}${e.name}${e.isDirectory() ? '/' : ''}`);
  const rel = path.relative(root, dir).split(path.sep).join('/') || '.';
  return [`index of /${rel === '.' ? '' : `${rel}/`}`, '', ...rows, '', `(no index.html here; ${urlPath})`].join('\n');
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    process.stdout.write(USAGE);
    if (opts.error) process.exitCode = 1;
    return;
  }

  const root = path.resolve(opts.root);
  if (!fs.existsSync(root)) {
    process.stderr.write(`serve: root ${root} does not exist\n`);
    process.exitCode = 1;
    return;
  }

  const server = http.createServer(async (req, res) => {
    const started = Date.now();
    const method = (req.method || 'GET').toUpperCase();
    const rawUrl = req.url || '/';
    const urlPath = rawUrl.split('?')[0].split('#')[0] || '/';

    const log = (status, note) => {
      if (opts.quiet) return;
      const ms = Date.now() - started;
      process.stdout.write(`${String(status).padEnd(3)} ${method.padEnd(4)} ${urlPath}${note ? `  ${note}` : ''}  ${ms}ms\n`);
    };

    if (method !== 'GET' && method !== 'HEAD') {
      log(405);
      sendText(res, 405, 'method not allowed\n', { allow: 'GET, HEAD' });
      return;
    }

    let target;
    try {
      target = await resolveTarget(root, urlPath);
    } catch (err) {
      log(500, err.message);
      sendText(res, 500, 'internal error\n');
      return;
    }

    if (target.kind === 'bad') {
      log(400);
      sendText(res, 400, 'bad request\n');
      return;
    }
    if (target.kind === 'forbidden') {
      log(403);
      sendText(res, 403, 'forbidden\n');
      return;
    }
    if (target.kind === 'redirect') {
      log(301, `-> ${target.to}`);
      res.writeHead(301, { location: target.to, 'cache-control': 'no-store' });
      res.end();
      return;
    }
    if (target.kind === 'missing') {
      log(404);
      sendText(res, 404, `not found: ${urlPath}\n`);
      return;
    }
    if (target.kind === 'directory') {
      const body = await directoryListing(root, target.dir, urlPath);
      log(200, 'listing');
      sendText(res, 200, `${body}\n`);
      return;
    }

    const headers = {
      'content-type': mimeFor(target.file),
      'content-length': target.stat.size,
      // Development server: never cache anything, ever. A stale module is a lost hour.
      'cache-control': 'no-store, no-cache, must-revalidate, max-age=0',
      pragma: 'no-cache',
      expires: '0',
      'x-content-type-options': 'nosniff'
    };
    res.writeHead(200, headers);
    if (method === 'HEAD') {
      log(200, 'head');
      res.end();
      return;
    }
    const stream = fs.createReadStream(target.file);
    stream.on('error', (err) => {
      log(500, err.message);
      res.destroy();
    });
    stream.on('end', () => log(200, mimeFor(target.file).split(';')[0]));
    stream.pipe(res);
  });

  server.on('error', (err) => {
    if (err && err.code === 'EADDRINUSE') {
      process.stderr.write(
        `serve: port ${opts.port} is already in use.\n` +
          `       Stop the other server, or run: node tools/serve.mjs --port ${opts.port + 1}\n`
      );
    } else {
      process.stderr.write(`serve: ${err && err.message ? err.message : String(err)}\n`);
    }
    process.exitCode = 1;
  });

  server.listen(opts.port, opts.host, () => {
    const addr = server.address();
    const port = addr && typeof addr === 'object' ? addr.port : opts.port;
    process.stdout.write(
      [
        '',
        `  Fluid Intelligence Engine - dev server`,
        `  serving   ${root}`,
        `  open      http://${opts.host}:${port}/`,
        '',
        '  Ctrl+C to stop.',
        ''
      ].join('\n') + '\n'
    );
  });

  const shutdown = () => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 500).unref();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main();
