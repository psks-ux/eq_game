/**
 * Assembles the deployable static site into dist/. The app needs no compilation --
 * it is browser-native ESM -- so this copies the runtime files and leaves the
 * repository's tests, docs, simulation and tooling out of the published output.
 * Also emits standalone.html, the single-file build, alongside the normal app.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const OUT = path.join(ROOT, 'dist');

/* Only these ship. Anything not listed stays out of the deployment. */
const FILES = ['index.html'];
const DIRS = ['src'];
const ASSET_EXT = new Set(['.js', '.css', '.html', '.svg', '.json', '.webmanifest', '.woff2']);

function rimraf(target) {
  fs.rmSync(target, { recursive: true, force: true });
}

function copyTree(from, to) {
  let count = 0;
  let bytes = 0;
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const src = path.join(from, entry.name);
    const dst = path.join(to, entry.name);
    if (entry.isDirectory()) {
      const nested = copyTree(src, dst);
      count += nested.count;
      bytes += nested.bytes;
      continue;
    }
    if (!ASSET_EXT.has(path.extname(entry.name).toLowerCase())) continue;
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(src, dst);
    count += 1;
    bytes += fs.statSync(dst).size;
  }
  return { count, bytes };
}

function kib(n) {
  return (n / 1024).toFixed(1) + ' KiB';
}

function main() {
  rimraf(OUT);
  fs.mkdirSync(OUT, { recursive: true });

  let files = 0;
  let bytes = 0;

  for (const name of FILES) {
    const src = path.join(ROOT, name);
    if (!fs.existsSync(src)) {
      process.stderr.write(`build-static: missing required file ${name}\n`);
      return 1;
    }
    fs.copyFileSync(src, path.join(OUT, name));
    files += 1;
    bytes += fs.statSync(path.join(OUT, name)).size;
  }

  for (const dir of DIRS) {
    const src = path.join(ROOT, dir);
    if (!fs.existsSync(src)) {
      process.stderr.write(`build-static: missing required directory ${dir}\n`);
      return 1;
    }
    const res = copyTree(src, path.join(OUT, dir));
    files += res.count;
    bytes += res.bytes;
  }

  /* The single-file build is useful offline (open it straight from disk), so ship
     it next to the app rather than making it a separate command for the deployer. */
  const single = spawnSync(
    process.execPath,
    [path.join(HERE, 'build-single.mjs'), '--out', path.join(OUT, 'standalone.html')],
    { cwd: ROOT, encoding: 'utf8' }
  );
  if (single.status !== 0) {
    process.stderr.write(`build-static: single-file build failed\n${single.stderr || ''}\n`);
    return 1;
  }
  const standalone = fs.statSync(path.join(OUT, 'standalone.html')).size;

  /* Fail loudly rather than deploying a site whose entry point cannot boot. */
  const entry = fs.readFileSync(path.join(OUT, 'index.html'), 'utf8');
  const mainPath = path.join(OUT, 'src', 'main.js');
  if (!/type="module"/.test(entry) || !fs.existsSync(mainPath)) {
    process.stderr.write('build-static: dist/index.html does not reference a present src/main.js\n');
    return 1;
  }

  process.stdout.write(
    'build-static: dist/\n' +
    `  app files       ${files}\n` +
    `  app size        ${kib(bytes)}\n` +
    `  standalone.html ${kib(standalone)}\n` +
    `  entry           dist/index.html\n`
  );
  return 0;
}

process.exit(main());
