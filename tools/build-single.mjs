/**
 * Bundles the app into one self-contained dist/eq-game.html: walks the ESM graph from the
 * entry module, rewrites relative specifiers to bare `app:` specifiers backed by an
 * importmap of data: URLs, and inlines the CSS. No dependencies, no transform of exports.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = path.resolve(HERE, '..');

/* ------------------------------------------------------------------ *
 * CLI
 * ------------------------------------------------------------------ */

const USAGE = [
  'Usage: node tools/build-single.mjs [options]',
  '',
  '  --root <dir>    project root (default: the repository containing this script)',
  '  --entry <file>  entry module, relative to root (default: read from index.html)',
  '  --html <file>   shell HTML (default: index.html)',
  '  --out <file>    output path (default: <root>/dist/eq-game.html)',
  '  --verbose       list every module with its size',
  '  --help          this text',
  ''
].join('\n');

function parseArgs(argv) {
  const opts = { root: DEFAULT_ROOT, entry: null, html: 'index.html', out: null, verbose: false, help: false, error: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') opts.help = true;
    else if (a === '--verbose' || a === '-v') opts.verbose = true;
    else if (a === '--root') opts.root = path.resolve(argv[++i] || '.');
    else if (a === '--entry') opts.entry = argv[++i] || null;
    else if (a === '--html') opts.html = argv[++i] || 'index.html';
    else if (a === '--out') opts.out = argv[++i] || null;
    // Body-only output for hosts that supply their own document skeleton
    // (Claude Artifacts wraps the file in <!doctype>/<head>/<body> at publish
    // time, so emitting our own would nest a second document).
    else if (a === '--fragment') opts.fragment = true;
    else if (a.startsWith('--root=')) opts.root = path.resolve(a.slice(7));
    else if (a.startsWith('--entry=')) opts.entry = a.slice(8);
    else if (a.startsWith('--html=')) opts.html = a.slice(7);
    else if (a.startsWith('--out=')) opts.out = a.slice(6);
    else {
      process.stderr.write(`build-single: unknown argument ${a}\n`);
      opts.help = true;
      opts.error = true;
    }
  }
  return opts;
}

/* ------------------------------------------------------------------ *
 * Source masking: find real specifier strings, ignore strings/comments/regexes
 * ------------------------------------------------------------------ */

const REGEX_PRECEDING_PUNCT = new Set([
  '(', ',', '=', ':', '[', '!', '&', '|', '?', '{', '}', ';', '+', '-', '*', '%', '<', '>', '~', '^', '\n'
]);
const REGEX_PRECEDING_WORDS = new Set([
  'return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void', 'case', 'do', 'else', 'yield', 'await'
]);

function regexAllowedAt(src, index) {
  let i = index - 1;
  while (i >= 0 && (src[i] === ' ' || src[i] === '\t' || src[i] === '\r')) i--;
  if (i < 0) return true;
  const ch = src[i];
  if (REGEX_PRECEDING_PUNCT.has(ch)) return true;
  if (/[A-Za-z0-9_$]/.test(ch)) {
    let j = i;
    while (j >= 0 && /[A-Za-z0-9_$]/.test(src[j])) j--;
    return REGEX_PRECEDING_WORDS.has(src.slice(j + 1, i + 1));
  }
  return false;
}

/**
 * Returns a same-length copy of `src` with the *contents* of strings, comments and regex
 * literals replaced by filler, plus the spans of every complete string literal. Delimiters
 * and all real code survive, so a regex over the masked text sees only real syntax while
 * offsets still address the original source.
 */
function maskSource(src) {
  const masked = src.split('');
  const strings = new Map();
  const n = src.length;
  let i = 0;
  while (i < n) {
    const ch = src[i];
    if (ch === '/' && src[i + 1] === '/') {
      masked[i] = ' ';
      masked[i + 1] = ' ';
      let j = i + 2;
      while (j < n && src[j] !== '\n') {
        masked[j] = ' ';
        j++;
      }
      i = j;
      continue;
    }
    if (ch === '/' && src[i + 1] === '*') {
      masked[i] = ' ';
      masked[i + 1] = ' ';
      let j = i + 2;
      while (j < n && !(src[j] === '*' && src[j + 1] === '/')) {
        if (src[j] !== '\n') masked[j] = ' ';
        j++;
      }
      if (j < n) {
        masked[j] = ' ';
        masked[j + 1] = ' ';
        j += 2;
      }
      i = j;
      continue;
    }
    if (ch === '/' && regexAllowedAt(src, i)) {
      let j = i + 1;
      let inClass = false;
      let closed = false;
      while (j < n) {
        const c = src[j];
        if (c === '\n') break;
        if (c === '\\') {
          masked[j] = 'x';
          if (j + 1 < n) masked[j + 1] = 'x';
          j += 2;
          continue;
        }
        if (c === '[') inClass = true;
        else if (c === ']') inClass = false;
        else if (c === '/' && !inClass) {
          closed = true;
          break;
        }
        masked[j] = 'x';
        j++;
      }
      if (closed) {
        i = j + 1;
        continue;
      }
      i++;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      const quote = ch;
      let j = i + 1;
      let closed = false;
      while (j < n) {
        const c = src[j];
        if (c === '\\') {
          masked[j] = 'x';
          // Keep line-continuation newlines so offsets still line up with source lines.
          if (j + 1 < n) masked[j + 1] = src[j + 1] === '\n' ? '\n' : 'x';
          j += 2;
          continue;
        }
        if (c === quote) {
          closed = true;
          break;
        }
        if (quote !== '`' && c === '\n') break;
        masked[j] = c === '\n' ? '\n' : 'x';
        j++;
      }
      if (closed) {
        strings.set(i, { start: i, end: j + 1, quote });
        i = j + 1;
        continue;
      }
      i++;
      continue;
    }
    i++;
  }
  return { masked: masked.join(''), strings };
}

/**
 * Every module specifier string in `src`, as {start, end, value}. Only `from '...'` and
 * side-effect `import '...'` are matched - export bindings are never touched.
 */
function findSpecifiers(src) {
  const { masked, strings } = maskSource(src);
  const found = new Map();
  const collect = (afterKeyword) => {
    let i = afterKeyword;
    while (i < masked.length && /\s/.test(masked[i])) i++;
    const span = strings.get(i);
    if (span) found.set(span.start, span);
  };
  let m;
  const fromRe = /\bfrom\b/g;
  while ((m = fromRe.exec(masked)) !== null) collect(m.index + 4);
  const importRe = /\bimport\b/g;
  while ((m = importRe.exec(masked)) !== null) collect(m.index + 6);
  const dynamicRe = /\bimport\s*\(/g;
  const dynamic = [];
  while ((m = dynamicRe.exec(masked)) !== null) dynamic.push(m.index);
  return {
    specs: Array.from(found.values())
      .sort((a, b) => a.start - b.start)
      .map((s) => ({ ...s, value: src.slice(s.start + 1, s.end - 1) })),
    dynamic
  };
}

/* ------------------------------------------------------------------ *
 * Module graph
 * ------------------------------------------------------------------ */

function isFile(p) {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

function isDir(p) {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function isRelative(spec) {
  return spec.startsWith('./') || spec.startsWith('../') || spec === '.' || spec === '..' || spec.startsWith('/');
}

/**
 * Resolves a relative specifier to an absolute file. Handles `./x.js`, nested `../a/b.js`,
 * a directory (`./drills` or `./drills/`) via its index.js, and an extensionless path.
 * Returns null for bare specifiers, which are left exactly as written.
 */
function resolveSpecifier(spec, importerAbs, rootAbs) {
  if (!isRelative(spec)) return null;
  const clean = spec.split('?')[0].split('#')[0];
  const wantsDir = clean.endsWith('/') || clean === '.' || clean === '..';
  const base = clean.startsWith('/')
    ? path.join(rootAbs, clean)
    : path.resolve(path.dirname(importerAbs), clean);

  const candidates = [];
  if (wantsDir) {
    candidates.push(path.join(base, 'index.js'));
  } else {
    candidates.push(base);
    candidates.push(`${base}.js`);
    candidates.push(path.join(base, 'index.js'));
  }
  for (const c of candidates) {
    if (isFile(c)) return c;
  }
  if (isDir(base)) {
    const idx = path.join(base, 'index.js');
    if (isFile(idx)) return idx;
  }
  throw new Error(
    `cannot resolve '${spec}' from ${path.relative(rootAbs, importerAbs) || importerAbs}\n` +
      `  tried: ${candidates.map((c) => path.relative(rootAbs, c)).join(', ')}`
  );
}

function moduleIdFor(abs, rootAbs) {
  const rel = path.relative(rootAbs, abs);
  if (rel.startsWith('..')) {
    throw new Error(`module ${abs} is outside the project root ${rootAbs}`);
  }
  return `app:${rel.split(path.sep).join('/')}`;
}

/**
 * Walks the graph from `entryAbs`, rewriting specifiers in place. Returns modules in
 * discovery order; each carries its rewritten source and its dependency ids.
 */
function buildGraph(entryAbs, rootAbs, warn) {
  const modules = new Map();
  const stack = [entryAbs];
  const order = [];

  while (stack.length) {
    const abs = stack.pop();
    if (modules.has(abs)) continue;
    let raw;
    try {
      raw = fs.readFileSync(abs, 'utf8');
    } catch (err) {
      throw new Error(`cannot read module ${path.relative(rootAbs, abs)}: ${err.message}`);
    }
    const source = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
    const { specs, dynamic } = findSpecifiers(source);
    if (dynamic.length) {
      warn(`${path.relative(rootAbs, abs)}: dynamic import() found - it will NOT be bundled`);
    }

    const deps = [];
    let rewritten = source;
    for (let i = specs.length - 1; i >= 0; i--) {
      const spec = specs[i];
      const target = resolveSpecifier(spec.value, abs, rootAbs);
      if (!target) continue; // already bare: leave it exactly as it is
      const id = moduleIdFor(target, rootAbs);
      deps.push({ id, abs: target });
      rewritten = rewritten.slice(0, spec.start) + spec.quote + id + spec.quote + rewritten.slice(spec.end);
      stack.push(target);
    }

    const record = {
      abs,
      id: moduleIdFor(abs, rootAbs),
      source: rewritten,
      bytes: Buffer.byteLength(rewritten, 'utf8'),
      deps: deps.map((d) => d.id).reverse()
    };
    modules.set(abs, record);
    order.push(record);
  }
  return order;
}

/* ------------------------------------------------------------------ *
 * CSS
 * ------------------------------------------------------------------ */

const CSS_IMPORT_PATTERN = "@import\\s+(?:url\\(\\s*(['\"]?)([^'\")]+)\\1\\s*\\)|(['\"])([^'\"]+)\\3)([^;]*);";


/** Inlines a stylesheet and everything it @imports, recursively and once each. */
function inlineCss(absPath, rootAbs, seen, warn) {
  const key = path.resolve(absPath);
  if (seen.has(key)) return '';
  seen.add(key);
  let css;
  try {
    css = fs.readFileSync(key, 'utf8');
  } catch (err) {
    warn(`stylesheet ${path.relative(rootAbs, key)} could not be read: ${err.message}`);
    return '';
  }
  if (css.charCodeAt(0) === 0xfeff) css = css.slice(1);

  const parts = [];
  let last = 0;
  let m;
  // A fresh regex per call: this function recurses, and a shared /g regex would have its
  // lastIndex clobbered by the nested scan.
  const importRe = new RegExp(CSS_IMPORT_PATTERN, 'g');
  while ((m = importRe.exec(css)) !== null) {
    parts.push(css.slice(last, m.index));
    last = m.index + m[0].length;
    const href = (m[2] || m[4] || '').trim();
    const media = (m[5] || '').trim();
    if (!href || /^[a-z]+:/i.test(href) || href.startsWith('//')) {
      warn(`external @import '${href}' left in place; the bundle will not be self-contained`);
      parts.push(m[0]);
      continue;
    }
    const target = href.startsWith('/') ? path.join(rootAbs, href) : path.resolve(path.dirname(key), href);
    const nested = inlineCss(target, rootAbs, seen, warn);
    parts.push(media ? `@media ${media} {\n${nested}\n}` : nested);
  }
  parts.push(css.slice(last));
  const body = parts.join('');

  for (const ref of body.matchAll(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g)) {
    const href = ref[2].trim();
    if (/^(data:|https?:|#)/i.test(href)) continue;
    warn(`stylesheet references local asset '${href}'; it will not resolve in the single file`);
  }
  const rel = path.relative(rootAbs, key).split(path.sep).join('/');
  return `/* ${rel} */\n${body.trim()}\n`;
}

/* ------------------------------------------------------------------ *
 * HTML assembly
 * ------------------------------------------------------------------ */

const LINK_RE = /<link\b[^>]*>/gi;
const SCRIPT_RE = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;

function attr(tag, name) {
  const re = new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s"'>]+))`, 'i');
  const m = tag.match(re);
  if (!m) return null;
  return m[2] !== undefined ? m[2] : m[3] !== undefined ? m[3] : m[4] || '';
}

function isExternal(href) {
  return /^[a-z]+:/i.test(href) || href.startsWith('//');
}

function escapeForStyle(css) {
  return css.replace(/<\/(style)/gi, '<\\/$1');
}

function escapeForScript(json) {
  return json.replace(/<\/(script)/gi, '<\\/$1');
}

/** data: URL for one module. encodeURIComponent, not base64: smaller for ASCII sources. */
function dataUrl(source) {
  return `data:text/javascript;charset=utf-8,${encodeURIComponent(source)}`;
}

function humanBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KiB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MiB`;
}

/* ------------------------------------------------------------------ *
 * Main
 * ------------------------------------------------------------------ */

function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    process.stdout.write(USAGE);
    return opts.error ? 1 : 0;
  }

  const warnings = [];
  const warn = (msg) => warnings.push(msg);

  const rootAbs = path.resolve(opts.root);
  const htmlPath = path.resolve(rootAbs, opts.html);
  if (!isFile(htmlPath)) {
    process.stderr.write(`build-single: shell HTML not found at ${htmlPath}\n`);
    return 1;
  }
  let html = fs.readFileSync(htmlPath, 'utf8');
  if (html.charCodeAt(0) === 0xfeff) html = html.slice(1);

  // ---- find the module entry and the stylesheets ----
  const scripts = Array.from(html.matchAll(SCRIPT_RE));
  let entryRel = opts.entry;
  let entryTag = null;
  for (const s of scripts) {
    const tag = s[0];
    const type = (attr(tag, 'type') || '').toLowerCase();
    const src = attr(tag, 'src');
    if (type === 'module' && src && !isExternal(src)) {
      if (!entryRel) entryRel = src;
      entryTag = tag;
      break;
    }
    if (type === 'module' && !src) {
      warn('inline <script type="module"> in the shell HTML is copied verbatim and not bundled');
    }
  }
  if (!entryRel) {
    entryRel = 'src/main.js';
    warn(`no module entry found in ${opts.html}; falling back to ${entryRel}`);
  }
  const entryAbs = path.resolve(rootAbs, entryRel.replace(/^\.\//, ''));
  if (!isFile(entryAbs)) {
    process.stderr.write(`build-single: entry module not found at ${entryAbs}\n`);
    return 1;
  }

  // ---- walk the graph ----
  let modules;
  try {
    modules = buildGraph(entryAbs, rootAbs, warn);
  } catch (err) {
    process.stderr.write(`build-single: ${err.message}\n`);
    return 1;
  }

  // ---- verify: nothing relative may survive ----
  const known = new Set(modules.map((m) => m.id));
  const leftovers = [];
  const unmappedBare = new Set();
  for (const mod of modules) {
    for (const spec of findSpecifiers(mod.source).specs) {
      if (isRelative(spec.value)) leftovers.push(`${mod.id}: '${spec.value}'`);
      else if (spec.value.startsWith('app:') && !known.has(spec.value)) leftovers.push(`${mod.id}: unmapped '${spec.value}'`);
      else if (!spec.value.startsWith('app:') && !isExternal(spec.value)) unmappedBare.add(`${spec.value} (in ${mod.id})`);
    }
  }
  for (const spec of unmappedBare) {
    warn(`bare specifier left as written: ${spec} - the browser must be able to resolve it`);
  }
  if (leftovers.length) {
    process.stderr.write(`build-single: unrewritten specifiers remain:\n  ${leftovers.join('\n  ')}\n`);
    return 1;
  }

  // ---- stylesheets ----
  const cssSeen = new Set();
  const cssChunks = [];
  const linkTags = Array.from(html.matchAll(LINK_RE)).map((m) => m[0]);
  const droppedLinks = [];
  for (const tag of linkTags) {
    const rel = (attr(tag, 'rel') || '').toLowerCase();
    const href = attr(tag, 'href');
    if (!rel.split(/\s+/).includes('stylesheet') || !href) continue;
    if (isExternal(href)) {
      warn(`external stylesheet ${href} left as a <link>; the bundle needs the network for it`);
      continue;
    }
    const abs = href.startsWith('/') ? path.join(rootAbs, href) : path.resolve(path.dirname(htmlPath), href);
    cssChunks.push(inlineCss(abs, rootAbs, cssSeen, warn));
    droppedLinks.push(tag);
  }
  const css = cssChunks.join('\n');

  // ---- importmap ----
  const imports = {};
  for (const mod of modules) imports[mod.id] = dataUrl(mod.source);
  const importMapJson = JSON.stringify({ imports }, null, 0);

  // ---- assemble ----
  for (const tag of droppedLinks) html = html.split(tag).join('');
  if (entryTag) html = html.split(entryTag).join('');
  html = html.replace(/^[ \t]*\n(?=[ \t]*\n)/gm, '');

  const styleBlock = css.trim() ? `<style>\n${escapeForStyle(css.trim())}\n</style>\n` : '';
  const bootBlock =
    `<script type="importmap">${escapeForScript(importMapJson)}</script>\n` +
    `<script type="module">import ${JSON.stringify(modules[0].id)};</script>\n`;

  // Function replacements: module sources and CSS may contain `$&`-style patterns.
  if (/<\/head\s*>/i.test(html)) html = html.replace(/<\/head\s*>/i, () => `${styleBlock}</head>`);
  else html = styleBlock + html;

  if (/<\/body\s*>/i.test(html)) html = html.replace(/<\/body\s*>/i, () => `${bootBlock}</body>`);
  else html += `\n${bootBlock}`;

  // In fragment mode emit only what belongs inside a host-provided document:
  // the <title> (hosts scan for it), the inlined <style>, the app container and
  // the boot scripts. The body carries no static classes -- main.js applies them
  // from the profile at runtime -- so nothing is lost by dropping the <body> tag.
  let output = html;
  if (opts.fragment) {
    const titleTag = (/<title[^>]*>[\s\S]*?<\/title>/i.exec(html) || [''])[0]
      || '<title>Fluid Intelligence Engine</title>';
    const bodyInner = (/<body[^>]*>([\s\S]*?)<\/body>/i.exec(html) || [null, html])[1];
    output = `${titleTag}\n${styleBlock}${bodyInner.trim()}\n`;
  }

  const defaultName = opts.fragment ? 'eq-game.fragment.html' : 'eq-game.html';
  const outPath = opts.out ? path.resolve(opts.out) : path.join(rootAbs, 'dist', defaultName);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, output, 'utf8');

  // ---- report ----
  const sourceBytes = modules.reduce((acc, m) => acc + m.bytes, 0);
  const encodedBytes = Object.values(imports).reduce((acc, u) => acc + Buffer.byteLength(u, 'utf8'), 0);
  const outBytes = Buffer.byteLength(output, 'utf8');
  const lines = [];
  lines.push(`build-single: ${path.relative(process.cwd(), outPath).split(path.sep).join('/') || outPath}`);
  lines.push(`  entry           ${modules[0].id}`);
  lines.push(`  modules         ${modules.length}`);
  lines.push(`  module source   ${humanBytes(sourceBytes)}`);
  lines.push(`  encoded (URI)   ${humanBytes(encodedBytes)}  (${((encodedBytes / Math.max(1, sourceBytes)) * 100).toFixed(0)}% of source)`);
  lines.push(`  inlined CSS     ${humanBytes(Buffer.byteLength(css, 'utf8'))} from ${cssSeen.size} file(s)`);
  lines.push(`  output          ${humanBytes(outBytes)}  (${outBytes} bytes)`);
  if (opts.verbose) {
    lines.push('  modules by size:');
    for (const m of modules.slice().sort((a, b) => b.bytes - a.bytes)) {
      lines.push(`    ${String(m.bytes).padStart(7)}  ${m.id}`);
    }
  } else {
    const top = modules.slice().sort((a, b) => b.bytes - a.bytes).slice(0, 5);
    lines.push('  largest modules:');
    for (const m of top) lines.push(`    ${String(m.bytes).padStart(7)}  ${m.id}`);
  }
  for (const w of warnings) lines.push(`  WARNING: ${w}`);
  process.stdout.write(lines.join('\n') + '\n');
  return 0;
}

process.exitCode = main();
