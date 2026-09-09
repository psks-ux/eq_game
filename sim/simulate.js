/**
 * Psychometric simulation for the fluid-intelligence engine: theta recovery, test
 * information, elite separation, item exposure and cut accuracy at index 100.
 * Deterministic given --seed. `node sim/simulate.js` (full) / `--fast` (mock only).
 */

import { makeRng } from '../src/core/rng.js';
import { mean, sd, quantile, clamp, linspace, auc, pearson, pointBiserial } from '../src/core/stats.js';
import { p3pl, testInfo, seFromInfo, reliability } from '../src/core/irt.js';
import { thetaToIndex, tierFor, IQ_SD } from '../src/core/scale.js';
import { CAT_DEFAULTS, createSession } from '../src/core/cat.js';
import { FAMILIES, familyByKey } from '../src/items/registry.js';

/* ------------------------------------------------------------------ *
 * Configuration
 * ------------------------------------------------------------------ */

/** Sample sizes mandated by CONTRACTS.md section 23 (divided by 5 under --quick). */
const SAMPLES = {
  population: 4000,
  elitePerSpike: 400,
  eliteSpikes: [2.5, 3.5, 4.5],
  gridPerPoint: 16, // examinees per theta grid point for the realised information curve
  sweepPerSetting: 800, // examinees per maxItems setting in the cut-accuracy sweep
  misspecPopulation: 1500, // model-misspecification stress test
  misspecPerSpike: 150,
  real: 300 // examinees driven through the real registry
};

/** maxItems values explored in analysis 5. The operating point is CAT_DEFAULTS.maxItems. */
const MAXITEMS_SWEEP = [12, 20, 28, 40, 60];

/** Theta grid for the information function: -3..6 step 0.25 (37 points). */
const GRID_LO = -3;
const GRID_HI = 6;
const GRID_STEP = 0.25;
const GRID_N = Math.round((GRID_HI - GRID_LO) / GRID_STEP) + 1;

/**
 * Indifference zone around the cut, in index points. No instrument can classify a candidate
 * whose true index is 100.4 as reliably above 100 - the question is not answerable. The
 * gated error rate therefore excludes candidates within +/- INDIFFERENCE_INDEX of the cut.
 * The raw, unconditional rates are printed too, and they are always the larger numbers.
 */
const INDIFFERENCE_INDEX = 5;
const INDIFFERENCE_THETA = INDIFFERENCE_INDEX / IQ_SD;

/** Pass/fail gates from CONTRACTS.md section 23. */
const THRESHOLDS = {
  coreRmse: 0.40, // RMSE of theta over the core range
  coreLo: -2, // "core range" = theta in [-2, 2] = index [70, 130], ~95% of N(0,1)
  coreHi: 2,
  cutErrorRate: 0.05, // consequential misclassification rate at the index-100 cut
  misspecSlack: 0.15 // extra RMSE allowed when the difficulty model is wrong
};

/**
 * Mock item bank. Discrimination is drawn from the distribution the calibration model
 * implies for a typical item (a = 0.80 + 1.10*systematicity - 0.45*salience + family
 * offset); it is deliberately not flattered upward.
 */
const MOCK_BANK = {
  aMean: 1.45,
  aSd: 0.28,
  aLo: 0.65,
  aHi: 2.45,
  bJitter: 0.30 // how close generateItemAtDifficulty lands to the requested b
};

/**
 * Fallback family table, used only when the registry exposes no usable FAMILIES metadata
 * (during development, before the generators land). bRange values span the difficulty
 * reach the generators are contracted to cover.
 */
const FALLBACK_FAMILIES = [
  { family: 'matrix', contentGroup: 'induction', lo: -2.0, hi: 5.0 },
  { family: 'series', contentGroup: 'induction', lo: -2.4, hi: 3.6 },
  { family: 'oddOneOut', contentGroup: 'relational', lo: -2.2, hi: 3.2 },
  { family: 'analogy', contentGroup: 'relational', lo: -1.6, hi: 4.2 },
  { family: 'rotation', contentGroup: 'spatial', lo: -2.0, hi: 3.8 },
  { family: 'paperFolding', contentGroup: 'spatial', lo: -1.2, hi: 4.4 },
  { family: 'constraint', contentGroup: 'constraint', lo: -0.8, hi: 5.2 },
  { family: 'overlay', contentGroup: 'constraint', lo: -2.0, hi: 3.4 }
];

/* ------------------------------------------------------------------ *
 * CLI
 * ------------------------------------------------------------------ */

const USAGE = [
  'Usage: node sim/simulate.js [--fast] [--quick] [--seed=N] [--real-n=N]',
  '',
  '  --fast      mock item source only; skip the real-registry pass',
  '  --quick     smoke run at 1/5 sample sizes (numbers are not the reported ones)',
  '  --seed=N    master seed (default 20240917); the whole report is a function of it',
  '  --real-n=N  examinees in the real-registry pass (default 300)',
  ''
].join('\n');

function parseArgs(argv) {
  const opts = { fast: false, quick: false, seed: 20240917, realN: SAMPLES.real, help: false, error: false };
  for (const raw of argv) {
    if (raw === '--fast') opts.fast = true;
    else if (raw === '--quick') opts.quick = true;
    else if (raw === '--help' || raw === '-h') opts.help = true;
    else if (raw.startsWith('--seed=')) {
      const v = Number(raw.slice(7));
      if (Number.isFinite(v)) opts.seed = v;
    } else if (raw.startsWith('--real-n=')) {
      const v = Number(raw.slice(9));
      if (Number.isFinite(v) && v > 0) opts.realN = Math.floor(v);
    } else {
      process.stderr.write(`simulate: unknown argument ${raw}\n`);
      opts.help = true;
      opts.error = true;
    }
  }
  return opts;
}

/* ------------------------------------------------------------------ *
 * Formatting
 * ------------------------------------------------------------------ */

const out = [];
function say(line = '') {
  out.push(line);
}
function flush() {
  if (out.length) process.stdout.write(out.join('\n') + '\n');
  out.length = 0;
}

function rule(char = '=', width = 78) {
  return char.repeat(width);
}

function heading(title) {
  say('');
  say(rule('='));
  say(title);
  say(rule('='));
}

function subheading(title) {
  say('');
  say(title);
  say(rule('-', Math.max(title.length, 40)));
}

function f(x, digits = 2) {
  return Number.isFinite(x) ? x.toFixed(digits) : 'n/a';
}

function sgn(x, digits = 3) {
  if (!Number.isFinite(x)) return 'n/a';
  const s = x.toFixed(digits);
  return s.startsWith('-') ? s : `+${s}`;
}

function pct(x, digits = 1) {
  return Number.isFinite(x) ? `${(100 * x).toFixed(digits)}%` : 'n/a';
}

/** Aligned text table. A `null` row draws a horizontal rule. */
function renderTable(headers, rows, align) {
  const cols = headers.length;
  const al = align || headers.map((_, i) => (i === 0 ? 'l' : 'r'));
  const width = headers.map((h) => String(h).length);
  for (const row of rows) {
    if (!row) continue;
    for (let i = 0; i < cols; i++) {
      const s = row[i] === undefined || row[i] === null ? '' : String(row[i]);
      if (s.length > width[i]) width[i] = s.length;
    }
  }
  const line = (cells) =>
    ('  ' +
      cells
        .map((c, i) => {
          const s = c === undefined || c === null ? '' : String(c);
          return al[i] === 'l' ? s.padEnd(width[i]) : s.padStart(width[i]);
        })
        .join('  ')).replace(/\s+$/, '');
  const lines = [line(headers), '  ' + width.map((w) => '-'.repeat(w)).join('  ')];
  for (const row of rows) {
    lines.push(row ? line(row) : '  ' + width.map((w) => '-'.repeat(w)).join('  '));
  }
  return lines.join('\n');
}

function niceCeil(x) {
  if (!Number.isFinite(x) || x <= 0) return 1;
  const base = Math.pow(10, Math.floor(Math.log10(x)));
  const scaled = x / base;
  const step = scaled <= 1 ? 1 : scaled <= 2 ? 2 : scaled <= 5 ? 5 : 10;
  return step * base;
}

/**
 * Vertical ASCII plot. Pure ASCII on purpose: this report has to survive cmd.exe,
 * PowerShell, a CI log and a paste into an email.
 */
function asciiPlot(xs, ys, opts) {
  const o = opts || {};
  const height = o.height || 16;
  const finite = ys.filter((y) => Number.isFinite(y));
  const rawMax = finite.length ? Math.max(...finite) : 1;
  const top = niceCeil(rawMax);
  const labelWidth = 7;
  const lines = [];
  if (o.title) lines.push(o.title);
  if (o.yLabel) lines.push(`  y: ${o.yLabel}`);
  for (let r = height; r >= 1; r--) {
    const hi = (top * r) / height;
    const mid = (top * (r - 0.5)) / height;
    let row = '';
    for (const y of ys) {
      if (!Number.isFinite(y)) row += ' ';
      else if (y >= hi) row += '#';
      else if (y >= mid) row += ':';
      else row += ' ';
    }
    const showLabel = r === height || r === Math.round(height / 2) || r === 1;
    lines.push((showLabel ? hi.toFixed(top >= 10 ? 1 : 2) : '').padStart(labelWidth) + ' |' + row);
  }
  let axis = '';
  for (const x of xs) axis += Math.abs(x - Math.round(x)) < 1e-9 ? '+' : '-';
  lines.push((0).toFixed(top >= 10 ? 1 : 2).padStart(labelWidth) + ' +' + axis);
  const labelRow = new Array(xs.length).fill(' ');
  for (let i = 0; i < xs.length; i++) {
    if (Math.abs(xs[i] - Math.round(xs[i])) > 1e-9) continue;
    const text = String(Math.round(xs[i]));
    const start = Math.max(0, Math.min(i - Math.floor((text.length - 1) / 2), xs.length - text.length));
    for (let k = 0; k < text.length; k++) labelRow[start + k] = text[k];
  }
  lines.push(' '.repeat(labelWidth) + '  ' + labelRow.join(''));
  lines.push(' '.repeat(labelWidth) + '  ' + (o.xLabel || 'theta').padStart(Math.floor(xs.length / 2)));
  return lines.join('\n');
}

/* ------------------------------------------------------------------ *
 * Small statistics helpers
 * ------------------------------------------------------------------ */

function rmse(errors) {
  if (!errors.length) return NaN;
  let acc = 0;
  for (const e of errors) acc += e * e;
  return Math.sqrt(acc / errors.length);
}

/** Trapezoidal integral over an evenly spaced grid. */
function integrate(ys, step, fromIndex, toIndex) {
  let acc = 0;
  for (let i = fromIndex; i < toIndex; i++) {
    const a = Number.isFinite(ys[i]) ? ys[i] : 0;
    const b = Number.isFinite(ys[i + 1]) ? ys[i + 1] : 0;
    acc += 0.5 * (a + b) * step;
  }
  return acc;
}

/** Wilson score interval, so small-sample rates are never quoted as if they were exact. */
function wilson(k, n, z = 1.96) {
  if (!n) return { lo: NaN, hi: NaN };
  const p = k / n;
  const d = 1 + (z * z) / n;
  const centre = p + (z * z) / (2 * n);
  const half = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return { lo: Math.max(0, (centre - half) / d), hi: Math.min(1, (centre + half) / d) };
}

/* ------------------------------------------------------------------ *
 * Mock item source
 * ------------------------------------------------------------------ */

/**
 * Family metadata for the mock bank, taken from the real registry whenever it exposes
 * usable FamilyModule metadata. Only item *generation* is mocked; the content structure
 * and the difficulty reach are the real ones.
 */
function familyTable() {
  const table = [];
  if (Array.isArray(FAMILIES)) {
    for (const fam of FAMILIES) {
      if (!fam || typeof fam.family !== 'string') continue;
      const range = Array.isArray(fam.bRange) ? fam.bRange : null;
      if (!range || range.length !== 2) continue;
      const lo = Number(range[0]);
      const hi = Number(range[1]);
      if (!Number.isFinite(lo) || !Number.isFinite(hi) || hi <= lo) continue;
      table.push({
        family: fam.family,
        contentGroup: typeof fam.contentGroup === 'string' ? fam.contentGroup : 'induction',
        lo,
        hi
      });
    }
  }
  if (table.length >= 3) return { table, source: 'registry FAMILIES metadata' };
  return { table: FALLBACK_FAMILIES.slice(), source: 'built-in fallback (registry metadata unusable)' };
}

function makeMockBank(table, optionCount) {
  const c = 0.85 / optionCount;
  const bankLo = Math.min(...table.map((t) => t.lo));
  const bankHi = Math.max(...table.map((t) => t.hi));

  function pool(targetB, allow) {
    const usable = allow ? table.filter((t) => allow.has(t.family)) : table;
    const source = usable.length ? usable : table;
    const covering = source.filter((t) => targetB >= t.lo - 0.8 && targetB <= t.hi + 0.8);
    if (covering.length) return covering;
    let best = Infinity;
    for (const t of source) {
      const dist = targetB < t.lo ? t.lo - targetB : targetB - t.hi;
      if (dist < best) best = dist;
    }
    return source.filter((t) => {
      const dist = targetB < t.lo ? t.lo - targetB : targetB - t.hi;
      return dist <= best + 1e-9;
    });
  }

  return {
    bankLo,
    bankHi,
    c,
    table,
    sampleNear(rng, targetB, allow) {
      const candidates = pool(targetB, allow);
      const fam = candidates[rng.int(0, candidates.length)];
      const b = clamp(targetB + rng.gauss(0, MOCK_BANK.bJitter), fam.lo, fam.hi);
      const a = clamp(rng.gauss(MOCK_BANK.aMean, MOCK_BANK.aSd), MOCK_BANK.aLo, MOCK_BANK.aHi);
      return { a, b, c, family: fam.family, contentGroup: fam.contentGroup };
    },
    /** A fixed, evenly spread sample of the whole bank: the bank information function. */
    reference(rng, perFamily) {
      const items = [];
      for (const fam of table) {
        for (let i = 0; i < perFamily; i++) {
          const b = fam.lo + ((fam.hi - fam.lo) * (i + 0.5)) / perFamily;
          const a = clamp(rng.gauss(MOCK_BANK.aMean, MOCK_BANK.aSd), MOCK_BANK.aLo, MOCK_BANK.aHi);
          items.push({ a, b, c });
        }
      }
      return items;
    }
  };
}

/** Option stubs are shared and frozen: the CAT only needs ids, and 13k sessions add up. */
const OPTION_STUBS = new Map();
function optionStubs(count) {
  const k = Math.max(2, Math.round(count) || 8);
  let stubs = OPTION_STUBS.get(k);
  if (!stubs) {
    stubs = Object.freeze(Array.from({ length: k }, (_, i) => Object.freeze({ id: `o${i}`, svg: '', width: 1, height: 1 })));
    OPTION_STUBS.set(k, stubs);
  }
  return stubs;
}

/**
 * A drop-in for registry.generateItemAtDifficulty that costs microseconds instead of
 * milliseconds. It honours `spec.families` (the CAT's content-balance whitelist) and
 * `spec.targetB`, and carries a plausible structural `meta` so the engine's per-session
 * item-key de-duplication behaves the way it will in production.
 */
function makeMockItemSource(bank) {
  return (rng, spec) => {
    const targetB = Number.isFinite(spec && spec.targetB) ? spec.targetB : 0;
    const optionCount = Math.max(2, Math.round((spec && spec.optionCount) || 8));
    const allow = spec && Array.isArray(spec.families) && spec.families.length ? new Set(spec.families) : null;
    const drawn = bank.sampleNear(rng, targetB, allow);
    // Recover a plausible structure from the difficulty, so item keys vary as they will
    // in production: harder items carry more rules and more working-memory load.
    const ruleCount = clamp(Math.round(1 + (drawn.b + 1.1) / 0.92 / 2 + rng.gauss(0, 0.6)), 1, 5);
    const wmLoad = clamp(Math.round(1 + (drawn.b + 1.1) / 1.4 + rng.gauss(0, 0.5)), 1, 6);
    const elementCount = [4, 6, 9, 12, 16][clamp(Math.round(rng.gauss(2, 1)), 0, 4)];
    return {
      id: `mock:${drawn.family}:${rng.int(0, 2147483647)}`,
      family: drawn.family,
      seed: 0,
      prompt: { svg: '', width: 1, height: 1 },
      options: optionStubs(optionCount),
      answerId: 'o0',
      meta: {
        ruleCount,
        ruleTypes: [],
        abstractness: 1 + ruleCount * 0.3,
        elementCount,
        distractorSystematicity: 0.8,
        wmLoad,
        perceptualSalience: 0.2,
        optionCount,
        generatorVersion: 0
      },
      irt: { a: drawn.a, b: drawn.b, c: drawn.c }
    };
  };
}

/* ------------------------------------------------------------------ *
 * Session driver - the REAL src/core/cat.js in every pass
 * ------------------------------------------------------------------ */

/**
 * The Item contract carries `family` but not `contentGroup`; the registry's FamilyModule
 * carries both, so the group is looked up rather than guessed.
 */
function registryGroupOf(family) {
  const fam = typeof family === 'string' ? familyByKey(family) : null;
  return fam && typeof fam.contentGroup === 'string' ? fam.contentGroup : 'unknown';
}

function firstWrongOption(item) {
  if (!item || !Array.isArray(item.options)) return 'x';
  for (const opt of item.options) {
    if (opt && opt.id !== item.answerId) return opt.id;
  }
  return 'x';
}

/**
 * Administers one adaptive test to a simulated examinee of known true theta, through the
 * production CAT engine. `env.itemSource` selects mock or real items; `env.truth` may
 * perturb the parameters used to GENERATE responses away from the ones used to SCORE them,
 * which is how the misspecification stress test works.
 */
function driveSession(trueTheta, rng, env, overrides) {
  // Two independent streams. If the examinee's responses were drawn from the same stream
  // the engine selects items with, then changing how many random draws cat.js makes would
  // silently reshuffle every simulated response, and no two runs across a code change
  // would be comparable. Forking keeps the examinee fixed while the engine varies.
  const sessionRng = rng.fork('session');
  const responseRng = rng.fork('responses');
  const opts = {
    rng: sessionRng,
    minItems: CAT_DEFAULTS.minItems,
    maxItems: CAT_DEFAULTS.maxItems,
    targetSE: CAT_DEFAULTS.targetSE,
    optionCount: CAT_DEFAULTS.optionCount,
    cutIndex: CAT_DEFAULTS.cutIndex,
    ciLevel: CAT_DEFAULTS.ciLevel,
    warmup: CAT_DEFAULTS.warmup,
    ...(overrides || {})
  };
  if (env.itemSource) opts.itemSource = env.itemSource;
  if (env.familyCatalog) opts.familyCatalog = env.familyCatalog;

  const session = createSession(opts);
  const items = [];
  const guard = (opts.maxItems || CAT_DEFAULTS.maxItems) + 8;

  for (let i = 0; i < guard; i++) {
    const item = session.nextItem();
    if (!item) break;
    const model =
      item.irt && Number.isFinite(item.irt.a) && Number.isFinite(item.irt.b) && Number.isFinite(item.irt.c)
        ? item.irt
        : { a: 1, b: 0, c: 0.106 };
    const real = env.truth ? env.truth(model) : model;
    const correct = responseRng.next() < p3pl(trueTheta, real);
    const optionId = correct ? item.answerId : firstWrongOption(item);
    const rtMs = Math.round(
      3500 * Math.exp(responseRng.gauss(0, 0.45)) * (1 + 0.12 * Math.max(0, model.b - trueTheta))
    );
    items.push({
      a: model.a,
      b: model.b,
      c: model.c,
      family: typeof item.family === 'string' ? item.family : 'unknown',
      contentGroup: env.groupOf(item.family)
    });
    const step = session.submit(optionId, rtMs);
    if (step && step.done) break;
  }

  const res = session.result();
  let relaxed = 0;
  const state = session.state;
  if (state && Array.isArray(state.history)) {
    for (const rec of state.history) if (rec && rec.relaxed) relaxed++;
  }
  return {
    trueTheta,
    theta: Number.isFinite(res.theta) ? res.theta : 0,
    se: Number.isFinite(res.se) ? res.se : 99,
    index: res.index,
    eliminated: Boolean(res.eliminated),
    itemsUsed: Number.isFinite(res.itemsUsed) ? res.itemsUsed : items.length,
    reason: res.finishedReason || 'unknown',
    relaxed,
    items
  };
}

/** Progress on stderr only, so a piped report stays byte-identical to a terminal one. */
function progress(label, done, total, startedAt) {
  if (!process.stderr.isTTY) return;
  const width = 24;
  const filled = Math.round((done / total) * width);
  let eta = '';
  if (startedAt && done > 0 && done < total) {
    const remain = ((performance.now() - startedAt) / done) * (total - done);
    eta = `  ~${f(remain / 1000, 0)}s left`;
  }
  process.stderr.write(
    `\r  ${label.padEnd(22)} [${'#'.repeat(filled)}${' '.repeat(width - filled)}] ${done}/${total}${eta}      `
  );
  if (done >= total) process.stderr.write('\n');
}

function runCohort(thetas, rng, env, overrides, tag) {
  const recs = new Array(thetas.length);
  const step = Math.max(1, Math.round(thetas.length / 40));
  const startedAt = performance.now();
  for (let i = 0; i < thetas.length; i++) {
    recs[i] = driveSession(thetas[i], rng.fork(`${tag}:${i}`), env, overrides);
    if (thetas.length >= 200 && (i % step === step - 1 || i === thetas.length - 1)) {
      progress(tag, i + 1, thetas.length, startedAt);
    }
  }
  return recs;
}

function runRealCohort(thetas, rng, env) {
  const recs = [];
  const failures = [];
  const startedAt = performance.now();
  for (let i = 0; i < thetas.length; i++) {
    try {
      recs.push(driveSession(thetas[i], rng.fork(`real:${i}`), env, null));
    } catch (err) {
      failures.push(`examinee ${i} (theta ${f(thetas[i], 2)}): ${err && err.message ? err.message : String(err)}`);
      if (failures.length > 5) break;
    }
    if (i % 5 === 4 || i === thetas.length - 1) progress('real-registry pass', i + 1, thetas.length, startedAt);
  }
  return { recs, failures };
}

/* ------------------------------------------------------------------ *
 * Examinee sampling
 * ------------------------------------------------------------------ */

function drawPopulation(rng, n) {
  const xs = new Array(n);
  for (let i = 0; i < n; i++) xs[i] = rng.gauss(0, 1);
  return xs;
}

function scaled(n, quick) {
  return quick ? Math.min(n, Math.max(6, Math.round(n / 5))) : n;
}

/* ------------------------------------------------------------------ *
 * Analysis 1 - theta recovery
 * ------------------------------------------------------------------ */

const RECOVERY_BANDS = [
  { key: 'theta < -2.0', lo: -Infinity, hi: -2 },
  { key: '-2.0 to -1.0', lo: -2, hi: -1 },
  { key: '-1.0 to  0.0', lo: -1, hi: 0 },
  { key: ' 0.0 to  1.0', lo: 0, hi: 1 },
  { key: ' 1.0 to  2.0', lo: 1, hi: 2 },
  { key: ' 2.0 to  3.0', lo: 2, hi: 3 },
  { key: ' 3.0 to  4.0', lo: 3, hi: 4 },
  { key: 'theta >= 4.0', lo: 4, hi: Infinity }
];

function recoveryRow(label, recs) {
  if (!recs.length) return [label, '0', '-', '-', '-', '-', '-'];
  const errs = recs.map((r) => r.theta - r.trueTheta);
  return [
    label,
    String(recs.length),
    sgn(mean(errs), 3),
    f(rmse(errs), 3),
    f(mean(recs.map((r) => r.se)), 3),
    f(mean(recs.map((r) => r.itemsUsed)), 1),
    f(mean(recs.map((r) => reliability(r.se))), 3)
  ];
}

function analyseRecovery(popRecs, spikeGroups, label) {
  const rows = [];
  for (const band of RECOVERY_BANDS) {
    rows.push(recoveryRow(band.key, popRecs.filter((r) => r.trueTheta >= band.lo && r.trueTheta < band.hi)));
  }
  rows.push(null);
  rows.push(recoveryRow('all N(0,1)', popRecs));
  const core = popRecs.filter((r) => r.trueTheta >= THRESHOLDS.coreLo && r.trueTheta <= THRESHOLDS.coreHi);
  rows.push(recoveryRow(`core [${THRESHOLDS.coreLo}, ${THRESHOLDS.coreHi}]`, core));
  if (spikeGroups && spikeGroups.length) {
    rows.push(null);
    for (const group of spikeGroups) rows.push(recoveryRow(`spike theta ${f(group.theta, 1)}`, group.recs));
  }
  say(label);
  say('');
  say(renderTable(['true theta band', 'n', 'bias', 'RMSE', 'mean SE', 'items', 'rel.'], rows));
  const coreErrs = core.map((r) => r.theta - r.trueTheta);
  return { coreRmse: rmse(coreErrs), coreBias: mean(coreErrs), n: popRecs.length };
}

/* ------------------------------------------------------------------ *
 * Analysis 2 - test information
 * ------------------------------------------------------------------ */

function analyseInformation(bank, rng, env, quick) {
  const thetas = linspace(GRID_LO, GRID_HI, GRID_N);
  const referenceBank = bank.reference(rng.fork('bank-reference'), 40);
  const perPoint = scaled(SAMPLES.gridPerPoint, quick);

  const bankInfo = thetas.map((t) => (testInfo(t, referenceBank) * 100) / referenceBank.length);
  const realised = new Array(thetas.length).fill(0);
  const itemsAt = new Array(thetas.length).fill(0);
  const maxedAt = new Array(thetas.length).fill(0);

  for (let i = 0; i < thetas.length; i++) {
    const theta = thetas[i];
    let infoAcc = 0;
    let itemAcc = 0;
    let maxed = 0;
    for (let k = 0; k < perPoint; k++) {
      const r = driveSession(theta, rng.fork(`grid:${i}:${k}`), env, null);
      infoAcc += testInfo(theta, r.items);
      itemAcc += r.itemsUsed;
      if (r.reason === 'maxItems') maxed++;
    }
    realised[i] = infoAcc / perPoint;
    itemsAt[i] = itemAcc / perPoint;
    maxedAt[i] = maxed / perPoint;
  }

  const idxOf = (theta) => Math.round((theta - GRID_LO) / GRID_STEP);
  const last = thetas.length - 1;
  const bankTotal = integrate(bankInfo, GRID_STEP, 0, last);
  const bankAbove2 = integrate(bankInfo, GRID_STEP, idxOf(2), last);
  const bankAbove4 = integrate(bankInfo, GRID_STEP, idxOf(4), last);
  const testTotal = integrate(realised, GRID_STEP, 0, last);
  const testAbove2 = integrate(realised, GRID_STEP, idxOf(2), last);
  const testAbove4 = integrate(realised, GRID_STEP, idxOf(4), last);

  say(
    asciiPlot(thetas, realised, {
      title: 'REALISED ADAPTIVE-TEST INFORMATION - what a session actually collects',
      yLabel: 'Fisher information of the administered test, evaluated at the true theta',
      height: 16
    })
  );
  say('');
  say(
    asciiPlot(thetas, bankInfo, {
      title: 'ITEM-BANK INFORMATION PROFILE - where the bank can measure at all',
      yLabel: 'information carried by a representative 100 items of the bank',
      height: 10
    })
  );
  say('');

  const rows = thetas.map((t, i) => {
    const se = seFromInfo(realised[i]);
    return [
      f(t, 2),
      String(thetaToIndex(t)),
      f(bankInfo[i], 2),
      f(realised[i], 2),
      f(se, 3),
      f(se * IQ_SD, 1),
      f(reliability(se), 3),
      f(itemsAt[i], 1),
      pct(maxedAt[i], 0)
    ];
  });
  say(
    renderTable(
      ['theta', 'index', 'I_bank/100', 'I_test', 'SE', 'SEM_idx', 'rel.', 'items', 'at max'],
      rows,
      ['r', 'r', 'r', 'r', 'r', 'r', 'r', 'r', 'r']
    )
  );

  const se2 = seFromInfo(realised[idxOf(2)]);
  const se4 = seFromInfo(realised[idxOf(4)]);
  const peakIndex = bankInfo.indexOf(Math.max(...bankInfo));
  say('');
  say(
    renderTable(
      ['ceiling metric', 'value'],
      [
        ['bank information above theta 2 (index 130)', pct(bankAbove2 / bankTotal, 1)],
        ['bank information above theta 4 (index 160)', pct(bankAbove4 / bankTotal, 1)],
        ['realised test information above theta 2', pct(testAbove2 / testTotal, 1)],
        ['realised test information above theta 4', pct(testAbove4 / testTotal, 1)],
        ['SE at theta 2 (index 130)', `${f(se2, 3)}  -> 90% band +/- ${f(1.645 * se2 * IQ_SD, 1)} index points`],
        ['SE at theta 4 (index 160)', `${f(se4, 3)}  -> 90% band +/- ${f(1.645 * se4 * IQ_SD, 1)} index points`],
        ['highest b available in the bank', f(bank.bankHi, 2)],
        ['peak of the bank information profile', `theta ${f(thetas[peakIndex], 2)}`]
      ],
      ['l', 'l']
    )
  );
  return { bankAbove2: bankAbove2 / bankTotal, bankAbove4: bankAbove4 / bankTotal, se2, se4 };
}

/* ------------------------------------------------------------------ *
 * Analysis 3 - elite separation
 * ------------------------------------------------------------------ */

const TIER_NAMES = ['entry', 'strong', 'advanced', 'exceptional', 'elite', 'apex'];

function analyseSeparation(recs) {
  const scores = recs.map((r) => r.index);
  const thetas = recs.map((r) => r.trueTheta);

  const eliteLabels = recs.map((r) => (r.trueTheta >= 2 ? 1 : 0));
  const upper = recs.filter((r) => r.trueTheta >= 2);
  const upperScores = upper.map((r) => r.index);
  const upperLabels = upper.map((r) => (r.trueTheta >= 4 ? 1 : 0));
  const qualLabels = recs.map((r) => (r.trueTheta >= 0 ? 1 : 0));

  const aucElite = auc(eliteLabels, scores);
  const aucApex = upper.length > 1 ? auc(upperLabels, upperScores) : NaN;
  const aucCut = auc(qualLabels, scores);
  const r = pearson(scores, thetas);
  const rpbElite = pointBiserial(eliteLabels, scores);
  const rpbApex = upper.length > 1 ? pointBiserial(upperLabels, upperScores) : NaN;

  say(
    renderTable(
      ['separation statistic', 'n', 'value'],
      [
        ['AUC  theta >= 2  vs  theta < 2', String(recs.length), f(aucElite, 4)],
        ['AUC  theta >= 4  vs  2 <= theta < 4', String(upper.length), f(aucApex, 4)],
        ['AUC  theta >= 0  vs  theta < 0  (the elimination cut)', String(recs.length), f(aucCut, 4)],
        null,
        ['Pearson r(reported index, true theta)', String(recs.length), f(r, 4)],
        ['r^2 - index variance explained by true theta', String(recs.length), f(r * r, 4)],
        ['point-biserial r(elite indicator, index)', String(recs.length), f(rpbElite, 4)],
        ['point-biserial r(apex indicator, index | theta >= 2)', String(upper.length), f(rpbApex, 4)]
      ],
      ['l', 'r', 'r']
    )
  );

  let exact = 0;
  let within1 = 0;
  const confusion = new Map();
  for (const rec of recs) {
    const trueTier = tierFor(thetaToIndex(rec.trueTheta));
    const gotTier = tierFor(rec.index);
    if (trueTier === gotTier) exact++;
    if (Math.abs(trueTier - gotTier) <= 1) within1++;
    if (!confusion.has(trueTier)) confusion.set(trueTier, { n: 0, exact: 0, low: 0, high: 0 });
    const cell = confusion.get(trueTier);
    cell.n++;
    if (gotTier === trueTier) cell.exact++;
    else if (gotTier < trueTier) cell.low++;
    else cell.high++;
  }

  const rows = Array.from(confusion.keys())
    .sort((a, b) => a - b)
    .map((key) => {
      const cell = confusion.get(key);
      return [
        `${key < 0 ? ' -' : ` ${key}`}  ${key < 0 ? 'eliminated' : TIER_NAMES[key] || `tier ${key}`}`,
        String(cell.n),
        pct(cell.exact / cell.n, 1),
        pct(cell.low / cell.n, 1),
        pct(cell.high / cell.n, 1)
      ];
    });
  rows.push(null);
  rows.push(['ALL', String(recs.length), pct(exact / recs.length, 1), '', '']);
  say('');
  say('Tier assignment: true tier (from true theta) against reported tier (from the index)');
  say('');
  say(renderTable(['true tier', 'n', 'exact', 'placed lower', 'placed higher'], rows, ['l', 'r', 'r', 'r', 'r']));
  say('');
  say(`  exact tier agreement ${pct(exact / recs.length, 1)}, within one tier ${pct(within1 / recs.length, 1)}.`);
  say('  Tiers are 15 index points wide and the SEM is around 4 to 5 points, so boundary');
  say('  churn is arithmetically unavoidable. The product consequence is bounded because');
  say('  adjacent tiers share most of their curriculum.');

  return { aucElite, aucApex, aucCut, r, exactTier: exact / recs.length, within1: within1 / recs.length };
}

/* ------------------------------------------------------------------ *
 * Analysis 4 - item exposure
 * ------------------------------------------------------------------ */

function analyseExposure(recs, label) {
  const famStats = new Map();
  const grpStats = new Map();
  const bs = [];
  let total = 0;
  let maxGroupShare = 0;
  let maxFamilyShare = 0;
  let relaxedSessions = 0;

  for (const rec of recs) {
    const perGroup = new Map();
    const perFamily = new Map();
    if (rec.relaxed) relaxedSessions++;
    for (const it of rec.items) {
      total++;
      bs.push(it.b);
      const fam = it.family || 'unknown';
      const grp = it.contentGroup || 'unknown';
      if (!famStats.has(fam)) famStats.set(fam, { n: 0, bSum: 0, sessions: 0 });
      if (!grpStats.has(grp)) grpStats.set(grp, { n: 0, bSum: 0 });
      const fs = famStats.get(fam);
      fs.n++;
      fs.bSum += it.b;
      const gs = grpStats.get(grp);
      gs.n++;
      gs.bSum += it.b;
      perGroup.set(grp, (perGroup.get(grp) || 0) + 1);
      perFamily.set(fam, (perFamily.get(fam) || 0) + 1);
    }
    const n = rec.items.length || 1;
    for (const v of perGroup.values()) maxGroupShare = Math.max(maxGroupShare, v / n);
    for (const v of perFamily.values()) maxFamilyShare = Math.max(maxFamilyShare, v / n);
    for (const fam of perFamily.keys()) famStats.get(fam).sessions++;
  }

  if (!total) {
    say(`${label}: no administered items recorded.`);
    return { maxGroupShare: NaN, maxFamilyShare: NaN, hardShare: NaN };
  }

  say(`${label} - ${total} administered items across ${recs.length} sessions`);
  say('');
  say(
    renderTable(
      ['family', 'items', 'share', 'mean b', 'sessions using it'],
      Array.from(famStats.entries())
        .sort((a, b) => b[1].n - a[1].n)
        .map(([fam, s]) => [fam, String(s.n), pct(s.n / total, 1), f(s.bSum / s.n, 2), pct(s.sessions / recs.length, 1)]),
      ['l', 'r', 'r', 'r', 'r']
    )
  );
  say('');
  say(
    renderTable(
      ['content group', 'items', 'share', 'mean b'],
      Array.from(grpStats.entries())
        .sort((a, b) => b[1].n - a[1].n)
        .map(([grp, s]) => [grp, String(s.n), pct(s.n / total, 1), f(s.bSum / s.n, 2)]),
      ['l', 'r', 'r', 'r']
    )
  );
  say('');
  say(
    renderTable(
      ['content-balance constraint', 'worst session', 'limit', 'status'],
      [
        ['content-group share within one session', pct(maxGroupShare, 1), '40.0%', maxGroupShare <= 0.4001 ? 'ok' : 'VIOLATED'],
        ['family share within one session', pct(maxFamilyShare, 1), '25.0%', maxFamilyShare <= 0.2501 ? 'ok' : 'VIOLATED'],
        ['sessions where a cap had to be relaxed', pct(relaxedSessions / recs.length, 1), '-', relaxedSessions ? 'see note' : 'none']
      ],
      ['l', 'r', 'r', 'l']
    )
  );
  if (relaxedSessions) {
    say('');
    say('  A relaxation means no family under the cap could supply an item at the target');
    say('  difficulty - normally at the extremes, where only a few families reach. The');
    say('  engine relaxes the family cap first and the group cap only as a last resort.');
  }

  const lo = -3;
  const hi = 6;
  const width = 0.5;
  const nBins = Math.round((hi - lo) / width);
  const bins = new Array(nBins).fill(0);
  let below = 0;
  let above = 0;
  for (const b of bs) {
    if (b < lo) below++;
    else if (b >= hi) above++;
    else bins[Math.min(nBins - 1, Math.floor((b - lo) / width))]++;
  }
  const peak = Math.max(1, ...bins);
  const histRows = [];
  if (below) histRows.push([`below ${f(lo, 1)}`, String(below), pct(below / total, 1), '']);
  for (let i = 0; i < nBins; i++) {
    const a = lo + i * width;
    histRows.push([
      `${f(a, 2)} .. ${f(a + width, 2)}`,
      String(bins[i]),
      pct(bins[i] / total, 1),
      '#'.repeat(Math.round((bins[i] / peak) * 44))
    ]);
  }
  if (above) histRows.push([`${f(hi, 1)} and up`, String(above), pct(above / total, 1), '']);
  say('');
  say('Histogram of administered item difficulty b');
  say('');
  say(renderTable(['b range', 'items', 'share', ''], histRows, ['r', 'r', 'r', 'l']));

  const sorted = bs.slice().sort((a, b) => a - b);
  const hardShare = bs.filter((b) => b >= 3).length / total;
  const eliteRecs = recs.filter((r) => r.trueTheta >= 3);
  let eliteHard = 0;
  let eliteTotal = 0;
  for (const rec of eliteRecs) {
    for (const it of rec.items) {
      eliteTotal++;
      if (it.b >= 3) eliteHard++;
    }
  }
  say('');
  say(
    renderTable(
      ['difficulty reach', 'value'],
      [
        ['median administered b', f(quantile(sorted, 0.5), 2)],
        ['90th percentile administered b', f(quantile(sorted, 0.9), 2)],
        ['99th percentile administered b', f(quantile(sorted, 0.99), 2)],
        ['maximum administered b', f(sorted[sorted.length - 1], 2)],
        ['share of all administered items with b >= 3.0', pct(hardShare, 2)],
        [
          'share with b >= 3.0 among examinees at true theta >= 3',
          eliteTotal ? `${pct(eliteHard / eliteTotal, 1)} over ${eliteRecs.length} sessions` : 'n/a'
        ],
        ['spread of administered b (sd)', f(sd(bs), 2)]
      ],
      ['l', 'l']
    )
  );
  return { maxGroupShare, maxFamilyShare, hardShare };
}

/* ------------------------------------------------------------------ *
 * Analysis 5 - cut accuracy at index 100
 * ------------------------------------------------------------------ */

function cutRates(recs) {
  const above = recs.filter((r) => r.trueTheta >= 0);
  const below = recs.filter((r) => r.trueTheta < 0);
  const falseElim = above.filter((r) => r.eliminated).length;
  const falseQual = below.filter((r) => !r.eliminated).length;

  const zAbove = recs.filter((r) => r.trueTheta >= INDIFFERENCE_THETA);
  const zBelow = recs.filter((r) => r.trueTheta <= -INDIFFERENCE_THETA);
  const zFalseElim = zAbove.filter((r) => r.eliminated).length;
  const zFalseQual = zBelow.filter((r) => !r.eliminated).length;
  const zN = zAbove.length + zBelow.length;
  const zErr = zFalseElim + zFalseQual;

  return {
    n: recs.length,
    rawFalseElim: above.length ? falseElim / above.length : NaN,
    rawFalseElimN: above.length,
    rawFalseQual: below.length ? falseQual / below.length : NaN,
    rawFalseQualN: below.length,
    rawOverall: recs.length ? (falseElim + falseQual) / recs.length : NaN,
    zFalseElim: zAbove.length ? zFalseElim / zAbove.length : NaN,
    zFalseElimN: zAbove.length,
    zFalseQual: zBelow.length ? zFalseQual / zBelow.length : NaN,
    zFalseQualN: zBelow.length,
    consequential: zN ? zErr / zN : NaN,
    consequentialN: zN,
    consequentialK: zErr,
    meanItems: recs.length ? mean(recs.map((r) => r.itemsUsed)) : NaN,
    meanSe: recs.length ? mean(recs.map((r) => r.se)) : NaN
  };
}

function analyseCut(recs, label) {
  const r = cutRates(recs);
  const ci = wilson(r.consequentialK, r.consequentialN);
  say(label);
  say('');
  say(
    renderTable(
      ['classification against the index-100 cut', 'n', 'rate'],
      [
        ['false ELIMINATION   true index >= 100, reported < 100', String(r.rawFalseElimN), pct(r.rawFalseElim, 2)],
        ['false QUALIFICATION true index <  100, reported >= 100', String(r.rawFalseQualN), pct(r.rawFalseQual, 2)],
        ['overall misclassification across the whole sample', String(r.n), pct(r.rawOverall, 2)],
        null,
        [`false ELIMINATION,   true index >= ${100 + INDIFFERENCE_INDEX}`, String(r.zFalseElimN), pct(r.zFalseElim, 2)],
        [`false QUALIFICATION, true index <= ${100 - INDIFFERENCE_INDEX}`, String(r.zFalseQualN), pct(r.zFalseQual, 2)],
        [
          `CONSEQUENTIAL error rate, outside +/-${INDIFFERENCE_INDEX} index of the cut`,
          String(r.consequentialN),
          `${pct(r.consequential, 2)}  [95% CI ${pct(ci.lo, 2)} .. ${pct(ci.hi, 2)}]`
        ]
      ],
      ['l', 'r', 'r']
    )
  );
  say('');
  say('  The raw rates are dominated by candidates sitting essentially ON the cut. At a true');
  say('  index of 100.3 no instrument can be reliably right, and being wrong there is not a');
  say('  wrong decision in any product sense - the candidate is at the boundary. The gated');
  say('  number is the consequential rate, which excludes a +/-5 index indifference zone.');
  say('  Both are printed. Neither is hidden.');
  return r;
}

function analyseCutSweep(thetas, rng, env) {
  const rows = [];
  const detail = [];
  for (const maxItems of MAXITEMS_SWEEP) {
    const overrides = { maxItems, minItems: Math.min(CAT_DEFAULTS.minItems, maxItems) };
    const recs = runCohort(thetas, rng, env, overrides, `sweep:${maxItems}`);
    const r = cutRates(recs);
    rows.push([
      `${maxItems}${maxItems === CAT_DEFAULTS.maxItems ? ' *' : ''}`,
      f(r.meanItems, 1),
      f(r.meanSe, 3),
      f(r.meanSe * IQ_SD, 1),
      pct(r.rawFalseElim, 2),
      pct(r.rawFalseQual, 2),
      pct(r.consequential, 2)
    ]);
    detail.push({ maxItems, r });
  }
  say(
    renderTable(
      ['maxItems', 'mean used', 'mean SE', 'SEM idx', 'raw false-elim', 'raw false-qual', 'consequential'],
      rows,
      ['r', 'r', 'r', 'r', 'r', 'r', 'r']
    )
  );
  say('');
  say('  * operating point. minItems is capped at maxItems for the short settings, so the');
  say('  12-item row also loses the "keep testing while the interval straddles 100" rule,');
  say('  which is most of what the longer tests actually buy at the cut.');
  return detail;
}

/* ------------------------------------------------------------------ *
 * Main
 * ------------------------------------------------------------------ */

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(USAGE);
    return args.error ? 1 : 0;
  }

  const t0 = performance.now();
  const root = makeRng(args.seed);
  const { table, source } = familyTable();
  const bank = makeMockBank(table, CAT_DEFAULTS.optionCount);
  const quick = args.quick;

  const groupOfMock = new Map(table.map((t) => [t.family, t.contentGroup]));
  const mockEnv = {
    itemSource: makeMockItemSource(bank),
    familyCatalog: table.map((t) => ({ family: t.family, contentGroup: t.contentGroup })),
    groupOf: (fam) => groupOfMock.get(fam) || 'unknown',
    truth: null
  };
  const realEnv = { itemSource: null, familyCatalog: null, groupOf: registryGroupOf, truth: null };

  const nPop = scaled(SAMPLES.population, quick);
  const nSpike = scaled(SAMPLES.elitePerSpike, quick);
  const nSweep = scaled(SAMPLES.sweepPerSetting, quick);
  const nMis = scaled(SAMPLES.misspecPopulation, quick);
  const nMisSpike = scaled(SAMPLES.misspecPerSpike, quick);
  const nReal = quick ? Math.max(20, Math.round(args.realN / 5)) : args.realN;

  say(rule('='));
  say('FLUID INTELLIGENCE ENGINE - PSYCHOMETRIC SIMULATION');
  say(rule('='));
  say('');
  say(
    renderTable(
      ['run parameter', 'value'],
      [
        ['mode', args.fast ? 'FAST - mock item source only' : 'FULL - mock item source plus real registry'],
        ['sample scaling', quick ? 'QUICK - 1/5 sizes, smoke run, do not quote' : 'full contract sizes'],
        ['master seed', String(args.seed)],
        ['engine', 'src/core/cat.js in every pass; only the item SOURCE is ever mocked'],
        ['estimator', "Warm's WLE (src/core/irt.js)"],
        [
          'operating point',
          `minItems ${CAT_DEFAULTS.minItems}, maxItems ${CAT_DEFAULTS.maxItems}, targetSE ${f(CAT_DEFAULTS.targetSE, 2)}, ${CAT_DEFAULTS.optionCount} options`
        ],
        ['cut / interval', `index ${CAT_DEFAULTS.cutIndex}, ${pct(CAT_DEFAULTS.ciLevel, 0)} interval`],
        ['mock family metadata', source],
        ['mock bank b range', `${f(bank.bankLo, 2)} to ${f(bank.bankHi, 2)} across ${table.length} families`],
        ['mock guessing asymptote c', f(bank.c, 4)]
      ],
      ['l', 'l']
    )
  );
  say('');
  say('  Every number below is a deterministic function of the master seed. Responses are');
  say('  generated from the 3PL using the parameters the system itself assigns to an item,');
  say('  so this validates the estimator, the adaptive algorithm and the reach of the item');
  say('  bank. It cannot validate the difficulty model against human data, because no such');
  say('  data exists yet; section 1b is the closest available substitute.');
  flush();

  const popThetas = drawPopulation(root.fork('population'), nPop);
  const spikeGroups = SAMPLES.eliteSpikes.map((theta) => ({ theta, thetas: new Array(nSpike).fill(theta) }));

  const tPop = performance.now();
  const popRecs = runCohort(popThetas, root.fork('main-pop'), mockEnv, null, 'pop');
  for (const group of spikeGroups) {
    group.recs = runCohort(group.thetas, root.fork(`spike-${group.theta}`), mockEnv, null, `spike${group.theta}`);
  }
  const allRecs = popRecs.concat(...spikeGroups.map((g) => g.recs));
  const popMs = performance.now() - tPop;

  heading('1. THETA RECOVERY');
  say('');
  const recovery = analyseRecovery(
    popRecs,
    spikeGroups,
    `MOCK ITEM SOURCE - ${nPop} examinees from N(0,1), plus ${nSpike} each at theta 2.5 / 3.5 / 4.5`
  );
  say('');
  say('  bias = mean(theta_hat - theta_true). RMSE folds bias and noise together. rel. is');
  say('  the marginal reliability implied by the SE. Bias at the extremes is the item bank');
  say('  running out of items, not an estimator defect: once every remaining item is easier');
  say('  (or harder) than the examinee, further responses stop carrying information.');
  say('');
  say('  Read the two edge bands with care. Below the bank floor and above the bank ceiling');
  say('  the mean SE is OPTIMISTIC relative to the RMSE, because the standard error is');
  say('  conditional on the model being right about the items that were administered and');
  say('  says nothing about the items that could not be. Those bands are also where the');
  say('  90% interval is widest, which is the part the user actually sees.');
  flush();

  subheading('1b. Misspecification stress test');
  say('');
  say('  Responses are GENERATED from perturbed parameters (b shifted by N(0, 0.50), a');
  say('  multiplied by exp(N(0, 0.20))) while the engine SCORES them with the design-time');
  say('  priors. This is what happens if the difficulty model in calibration.js is wrong.');
  say('');
  const misRng = root.fork('misspec');
  const perturbRng = misRng.fork('perturb');
  const truthCache = new Map();
  const misEnv = {
    ...mockEnv,
    truth: (model) => {
      const key = `${model.a.toFixed(4)}|${model.b.toFixed(4)}`;
      let t = truthCache.get(key);
      if (!t) {
        t = {
          a: clamp(model.a * Math.exp(perturbRng.gauss(0, 0.2)), 0.35, 3.0),
          b: model.b + perturbRng.gauss(0, 0.5),
          c: model.c
        };
        truthCache.set(key, t);
      }
      return t;
    }
  };
  const misPop = runCohort(drawPopulation(misRng.fork('draw'), nMis), misRng.fork('run'), misEnv, null, 'mis');
  const misSpikes = SAMPLES.eliteSpikes.map((theta) => ({
    theta,
    recs: runCohort(new Array(nMisSpike).fill(theta), misRng.fork(`spike-${theta}`), misEnv, null, `mis${theta}`)
  }));
  const misRecovery = analyseRecovery(misPop, misSpikes, 'MOCK ITEM SOURCE, perturbed truth');
  flush();

  heading('2. TEST INFORMATION AND THE CEILING CLAIM');
  say('');
  const tInfo = performance.now();
  const info = analyseInformation(bank, root.fork('information'), mockEnv, quick);
  const infoMs = performance.now() - tInfo;
  say('');
  say('  I_bank is the information a representative 100-item slice of the bank carries at');
  say('  each theta - the raw material. I_test is what one adaptive session actually');
  say('  collects about someone who truly sits there, which is the number that matters.');
  say('  The ceiling is real and finite: past theta 4 the bank runs short of hard items and');
  say('  the interval widens. The app never shows a point estimate without that interval.');
  flush();

  heading('3. ELITE SEPARATION');
  say('');
  say(`MOCK ITEM SOURCE - ${allRecs.length} examinees (population plus elite over-sample)`);
  say('');
  const separation = analyseSeparation(allRecs);
  say('');
  say('  AUC is the probability that a randomly drawn member of the higher group scores');
  say('  above a randomly drawn member of the lower group. The second row is the hard one:');
  say('  it asks the test to rank the top of the distribution against itself, which is the');
  say('  entire point of building a high-ceiling instrument.');
  flush();

  heading('4. ITEM EXPOSURE AND CONTENT BALANCE');
  say('');
  const exposure = analyseExposure(allRecs, 'MOCK ITEM SOURCE');
  flush();

  heading('5. CUT ACCURACY AT INDEX 100');
  say('');
  const cut = analyseCut(popRecs, `MOCK ITEM SOURCE at the operating point - ${popRecs.length} examinees from N(0,1)`);
  subheading('5b. Sensitivity to maxItems');
  say('');
  const tSweep = performance.now();
  analyseCutSweep(drawPopulation(root.fork('sweep-pop'), nSweep), root.fork('sweep'), mockEnv);
  const sweepMs = performance.now() - tSweep;
  flush();

  let realRecovery = null;
  let realFailures = [];
  let realMs = 0;
  let realDone = false;
  if (!args.fast) {
    heading('6. REAL ITEM REGISTRY');
    say('');
    say(`The same engine, now generating real items: ${nReal} examinees through`);
    say('src/items/registry.js. This is the slow pass - real generation costs milliseconds');
    say('per candidate item and a session asks for six per administered item - and it is');
    say('what turns the numbers above into claims about THIS item bank rather than about a');
    say('plausible one. Use --fast to skip it, or --real-n to shorten it.');
    flush();

    const tReal = performance.now();
    const perSpike = Math.max(1, Math.round(nReal * 0.1));
    const nRealPop = Math.max(1, nReal - 3 * perSpike);
    const realThetas = drawPopulation(root.fork('real-pop'), nRealPop).concat(
      ...SAMPLES.eliteSpikes.map((t) => new Array(perSpike).fill(t))
    );
    const { recs, failures } = runRealCohort(realThetas, root.fork('real'), realEnv);
    realFailures = failures;
    realMs = performance.now() - tReal;

    if (recs.length) {
      realDone = true;
      const realPop = recs.slice(0, Math.min(nRealPop, recs.length));
      const realSpikes = SAMPLES.eliteSpikes.map((theta) => ({
        theta,
        recs: recs.filter((r) => Math.abs(r.trueTheta - theta) < 1e-9)
      }));
      say('');
      realRecovery = analyseRecovery(
        realPop,
        realSpikes,
        `REAL REGISTRY - ${realPop.length} population examinees plus ${perSpike} per elite spike`
      );
      say('');
      say(`  ${f(realMs / recs.length, 0)} ms per examinee, ${f(realMs / 1000, 1)} s for the pass.`);
      say('');
      subheading('6b. Real-registry exposure');
      say('');
      analyseExposure(recs, 'REAL REGISTRY');
      say('');
      subheading('6c. Real-registry separation');
      say('');
      analyseSeparation(recs);
      say('');
      subheading('6d. Real-registry cut accuracy');
      say('');
      analyseCut(realPop, `REAL REGISTRY - ${realPop.length} examinees from N(0,1)`);
      say('');
      say('  A few hundred examinees: read the confidence interval, not the point estimate.');
      say('  The mock pass is the one with the sample size to gate on.');
      const reasons = new Map();
      for (const r of recs) reasons.set(r.reason, (reasons.get(r.reason) || 0) + 1);
      say('');
      say(
        renderTable(
          ['finishedReason', 'sessions', 'share'],
          Array.from(reasons.entries())
            .sort((a, b) => b[1] - a[1])
            .map(([k, v]) => [k, String(v), pct(v / recs.length, 1)]),
          ['l', 'r', 'r']
        )
      );
    }
    if (failures.length) {
      say('');
      say('REAL-REGISTRY FAILURES - the app is broken while this list is non-empty:');
      for (const msg of failures) say(`  - ${msg}`);
    }
    flush();
  }

  heading('VERDICT');
  say('');
  const checks = [
    {
      name: `theta RMSE, core range [${THRESHOLDS.coreLo}, ${THRESHOLDS.coreHi}], mock source`,
      shown: f(recovery.coreRmse, 3),
      limit: f(THRESHOLDS.coreRmse, 3),
      ok: Number.isFinite(recovery.coreRmse) && recovery.coreRmse <= THRESHOLDS.coreRmse
    },
    {
      name: 'consequential error rate at the index-100 cut, mock source',
      shown: pct(cut.consequential, 2),
      limit: pct(THRESHOLDS.cutErrorRate, 2),
      ok: Number.isFinite(cut.consequential) && cut.consequential <= THRESHOLDS.cutErrorRate
    },
    {
      name: 'theta RMSE, core range, difficulty model misspecified',
      shown: f(misRecovery.coreRmse, 3),
      limit: f(THRESHOLDS.coreRmse + THRESHOLDS.misspecSlack, 3),
      ok: Number.isFinite(misRecovery.coreRmse) && misRecovery.coreRmse <= THRESHOLDS.coreRmse + THRESHOLDS.misspecSlack
    }
  ];
  if (!args.fast) {
    checks.push({
      name: 'real-registry pass completed without errors',
      shown: realFailures.length ? `${realFailures.length} failures` : 'clean',
      limit: '0 failures',
      ok: realDone && realFailures.length === 0
    });
    if (realRecovery) {
      checks.push({
        name: 'theta RMSE, core range, REAL registry',
        shown: f(realRecovery.coreRmse, 3),
        limit: f(THRESHOLDS.coreRmse, 3),
        ok: Number.isFinite(realRecovery.coreRmse) && realRecovery.coreRmse <= THRESHOLDS.coreRmse
      });
    }
  }

  say(
    renderTable(
      ['gate', 'observed', 'limit', 'result'],
      checks.map((c) => [c.name, c.shown, c.limit, c.ok ? 'PASS' : 'FAIL']),
      ['l', 'r', 'r', 'l']
    )
  );
  say('');
  say(
    renderTable(
      ['headline figure (mock source, not gated)', 'value'],
      [
        ['AUC, elite (theta >= 2) against the rest', f(separation.aucElite, 4)],
        ['AUC, apex (theta >= 4) within the elite', f(separation.aucApex, 4)],
        ['r(reported index, true theta)', f(separation.r, 4)],
        ['exact tier agreement', pct(separation.exactTier, 1)],
        ['bank information above theta 4 (index 160)', pct(info.bankAbove4, 1)],
        ['SE at theta 4 (index 160)', f(info.se4, 3)],
        ['administered items with b >= 3', pct(exposure.hardShare, 2)],
        ['worst within-session content-group share', pct(exposure.maxGroupShare, 1)]
      ],
      ['l', 'r']
    )
  );
  say('');
  say(
    renderTable(
      ['timing', 'seconds'],
      [
        ['main mock cohort', f(popMs / 1000, 1)],
        ['information grid', f(infoMs / 1000, 1)],
        ['maxItems sweep', f(sweepMs / 1000, 1)],
        ['real-registry pass', args.fast ? 'skipped' : f(realMs / 1000, 1)],
        ['total', f((performance.now() - t0) / 1000, 1)]
      ],
      ['l', 'r']
    )
  );

  const failed = checks.filter((c) => !c.ok);
  say('');
  if (failed.length) {
    say(`RESULT: FAIL - ${failed.length} gate(s) not met.`);
    for (const c of failed) say(`  - ${c.name}`);
  } else {
    say('RESULT: PASS - all gates met.');
  }
  say('');
  flush();
  return failed.length ? 1 : 0;
}

process.exitCode = main();
