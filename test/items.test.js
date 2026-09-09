/**
 * Heavyweight validity suite for the item generators: culture-fairness audit,
 * difficulty targeting, distractor quality, coverage, determinism and speed
 * over 500+ freshly generated items spanning all eight families.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  FAMILIES,
  familyByKey,
  generateItem,
  generateItemAtDifficulty,
  auditItem
} from '../src/items/registry.js';
import { makeRng } from '../src/core/rng.js';
import { maxInfoTheta } from '../src/core/irt.js';
import { pearson } from '../src/core/stats.js';
import {
  SHAPE_KEYS,
  FORBIDDEN_KEYS,
  FILLS,
  COLORS,
  SIZES,
  LINE_WEIGHTS
} from '../src/items/shapes.js';

const EXPECTED_FAMILIES = [
  'matrix', 'progression', 'series', 'analogy',
  'oddOneOut', 'constraintGrid', 'paperFolding', 'mentalRotation'
];
const CONTENT_GROUPS = new Set(['induction', 'spatial', 'relational', 'constraint']);

/** CONTRACTS.md §1.2 — the ONLY primitives any stimulus may be built from. */
const ALLOWED_SHAPE_LEXICON = [
  'circle', 'ring', 'ellipse', 'semicircle', 'quarterDisc', 'square',
  'roundedSquare', 'rectangle', 'triangleUp', 'triangleDown', 'triangleRight',
  'triangleLeft', 'rightTriangle', 'diamond', 'trapezoid', 'parallelogram',
  'pentagon', 'hexagon', 'octagon', 'arc', 'bar', 'dot', 'lShape', 'tShape',
  'zShape', 'uShape', 'notchedSquare', 'notchedCircle'
];

const TARGET_MIN = -1.5;
const TARGET_MAX = 5.5;
const PER_FAMILY = 64;
const REGISTRY_PASS = 32;
const MIN_SYSTEMATICITY = 0.7;
const MIN_CORRELATION = 0.85;
const PERF_ITEMS = 200;
const PERF_BUDGET_MS = 10000;

/* ------------------------------------------------------------------ *
 * Shared sample (built once at import; every test reads from it)
 * ------------------------------------------------------------------ */

function msgOf(err) {
  if (!err) return 'unknown error';
  return err instanceof Error && err.message ? err.message : String(err);
}

function familyKey(mod, idx) {
  if (mod && typeof mod.family === 'string' && mod.family.length > 0) return mod.family;
  return `FAMILIES[${idx}]<no family export>`;
}

function familyRange(mod) {
  const r = mod && mod.bRange;
  if (
    Array.isArray(r) && r.length >= 2 &&
    Number.isFinite(r[0]) && Number.isFinite(r[1]) && r[1] > r[0]
  ) {
    return [r[0], r[1]];
  }
  return [TARGET_MIN, TARGET_MAX];
}

function spread(lo, hi, i, n) {
  if (n <= 1) return lo;
  return lo + (hi - lo) * (i / (n - 1));
}

function buildSample() {
  const rows = [];
  const errors = [];
  const rng = makeRng('items.test.js/sample/v1');

  FAMILIES.forEach((mod, idx) => {
    const key = familyKey(mod, idx);
    const [rawLo, rawHi] = familyRange(mod);
    /* Ask each family only for difficulties it declares it can reach, but keep
     * the union of requests spanning the full -1.5 .. 5.5 assessment window. */
    let lo = Math.max(TARGET_MIN, rawLo);
    let hi = Math.min(TARGET_MAX, rawHi);
    if (!(hi > lo)) {
      lo = rawLo;
      hi = rawHi;
    }
    for (let i = 0; i < PER_FAMILY; i += 1) {
      const targetB = spread(lo, hi, i, PER_FAMILY);
      const optionCount = i % 8 === 5 ? 6 : 8;
      try {
        const item = generateItemAtDifficulty(rng, { targetB, optionCount, families: [key] });
        rows.push({ item, targetB, optionCount, requested: key, scope: 'family' });
      } catch (err) {
        errors.push(
          `${key} @ targetB=${targetB.toFixed(2)} optionCount=${optionCount}: ${msgOf(err)}`
        );
      }
    }
  });

  for (let i = 0; i < REGISTRY_PASS; i += 1) {
    const targetB = spread(TARGET_MIN, TARGET_MAX, i, REGISTRY_PASS);
    try {
      const item = generateItemAtDifficulty(rng, { targetB, optionCount: 8 });
      rows.push({ item, targetB, optionCount: 8, requested: null, scope: 'registry' });
    } catch (err) {
      errors.push(`<registry, all families> @ targetB=${targetB.toFixed(2)}: ${msgOf(err)}`);
    }
  }

  return { rows, errors };
}

const SAMPLE = buildSample();

function list(lines, n = 10) {
  const shown = lines.slice(0, n);
  if (lines.length > n) shown.push(`... and ${lines.length - n} more`);
  return `\n  ${shown.join('\n  ')}`;
}

function rowsOfFamily(key) {
  return SAMPLE.rows.filter((row) => row.item && row.item.family === key);
}

function mean(xs) {
  if (xs.length === 0) return NaN;
  let sum = 0;
  for (const x of xs) sum += x;
  return sum / xs.length;
}

function signature(item) {
  return JSON.stringify({
    id: item.id,
    svg: item.prompt.svg,
    answerId: item.answerId,
    options: item.options.map((o) => `${o.id}|${o.svg}`),
    irt: item.irt
  });
}

/* ------------------------------------------------------------------ *
 * Shape lexicon (CONTRACTS.md §1.2 and §6: "an automated audit test asserts
 * it does not intersect FORBIDDEN_KEYS")
 * ------------------------------------------------------------------ */

test('SHAPE_KEYS does not intersect FORBIDDEN_KEYS', () => {
  const forbidden = new Set(FORBIDDEN_KEYS);
  const intersection = SHAPE_KEYS.filter((key) => forbidden.has(key));
  assert.equal(
    intersection.length, 0,
    `the shape lexicon offers culturally loaded primitives: ${intersection.join(', ')}`
  );
  assert.ok(FORBIDDEN_KEYS.length > 0, 'FORBIDDEN_KEYS must not be empty — it is the audit list');
  for (const banned of ['star5', 'star6', 'cross', 'plus', 'check', 'arrow', 'crescent', 'heart']) {
    assert.ok(forbidden.has(banned), `FORBIDDEN_KEYS is missing '${banned}' (CONTRACTS.md §1.1)`);
  }
});

test('SHAPE_KEYS is exactly the allowed lexicon, with no extras', () => {
  const extra = SHAPE_KEYS.filter((k) => !ALLOWED_SHAPE_LEXICON.includes(k));
  const missing = ALLOWED_SHAPE_LEXICON.filter((k) => !SHAPE_KEYS.includes(k));
  assert.equal(extra.length, 0, `SHAPE_KEYS contains primitives outside §1.2: ${extra.join(', ')}`);
  assert.equal(missing.length, 0, `SHAPE_KEYS is missing §1.2 primitives: ${missing.join(', ')}`);

  assert.deepEqual(
    [...FILLS],
    ['empty', 'solid', 'hStripe', 'vStripe', 'dStripe', 'dots', 'half'],
    'FILLS must match CONTRACTS.md §6 exactly'
  );
  assert.deepEqual([...SIZES], [0.42, 0.6, 0.78, 0.96], 'SIZES must match CONTRACTS.md §6');
  assert.deepEqual([...LINE_WEIGHTS], [2, 3.5, 5], 'LINE_WEIGHTS must match CONTRACTS.md §6');
  assert.equal(COLORS.length, 7, 'COLORS must hold exactly 7 colourblind-safe values');
  for (const hex of COLORS) {
    assert.match(String(hex), /^#[0-9a-fA-F]{6}$/, `COLORS entry '${hex}' is not a 6-digit hex value`);
  }
});

/* ------------------------------------------------------------------ *
 * Registry shape
 * ------------------------------------------------------------------ */

test('registry exposes all eight families as valid FamilyModules', () => {
  const problems = [];
  const seen = [];

  FAMILIES.forEach((mod, idx) => {
    const key = familyKey(mod, idx);
    seen.push(key);
    if (typeof mod.family !== 'string' || mod.family.length === 0) {
      problems.push(`FAMILIES[${idx}]: missing string export 'family'`);
    }
    const r = mod && mod.bRange;
    if (!Array.isArray(r) || r.length < 2 || !Number.isFinite(r[0]) || !Number.isFinite(r[1])) {
      problems.push(`${key}: bRange must be [min, max] finite numbers, got ${JSON.stringify(r)}`);
    } else if (!(r[1] > r[0])) {
      problems.push(`${key}: bRange max (${r[1]}) must exceed min (${r[0]})`);
    }
    if (!CONTENT_GROUPS.has(mod.contentGroup)) {
      problems.push(
        `${key}: contentGroup '${String(mod.contentGroup)}' must be one of ${[...CONTENT_GROUPS].join('|')}`
      );
    }
    if (typeof mod.generate !== 'function') {
      problems.push(`${key}: missing export generate(rng, spec)`);
    }
  });

  for (const key of EXPECTED_FAMILIES) {
    if (!seen.includes(key)) problems.push(`missing family '${key}' from FAMILIES`);
  }
  for (const key of seen) {
    if (!EXPECTED_FAMILIES.includes(key)) problems.push(`unexpected family '${key}' in FAMILIES`);
  }

  assert.equal(problems.length, 0, `FamilyModule contract violations:${list(problems)}`);
  assert.equal(FAMILIES.length, EXPECTED_FAMILIES.length);
});

test('familyByKey resolves every family and rejects unknown keys', () => {
  for (const key of EXPECTED_FAMILIES) {
    const mod = familyByKey(key);
    assert.ok(mod, `familyByKey('${key}') returned nothing`);
    assert.equal(mod.family, key);
  }
  assert.equal(familyByKey('notAFamily'), null);
  assert.equal(familyByKey(''), null);
  assert.equal(familyByKey(null), null);
  assert.equal(familyByKey(undefined), null);
  assert.equal(familyByKey(42), null);
});

/* ------------------------------------------------------------------ *
 * Sample integrity
 * ------------------------------------------------------------------ */

test('the sample generates 500+ items with no generator errors', () => {
  assert.equal(
    SAMPLE.errors.length, 0,
    `generateItemAtDifficulty threw for ${SAMPLE.errors.length} request(s):${list(SAMPLE.errors)}`
  );
  assert.ok(
    SAMPLE.rows.length >= 500,
    `expected 500+ sampled items, got ${SAMPLE.rows.length}`
  );

  const wrongFamily = SAMPLE.rows
    .filter((row) => row.scope === 'family' && row.item.family !== row.requested)
    .map((row) => `requested '${row.requested}' but got '${row.item.family}'`);
  assert.equal(wrongFamily.length, 0, `spec.families was not respected:${list(wrongFamily)}`);

  for (const key of EXPECTED_FAMILIES) {
    assert.ok(
      rowsOfFamily(key).length >= PER_FAMILY,
      `family '${key}' contributed only ${rowsOfFamily(key).length} items to the sample`
    );
  }

  const targets = SAMPLE.rows.map((row) => row.targetB);
  assert.ok(Math.min(...targets) <= TARGET_MIN + 1e-9, 'sample does not reach targetB -1.5');
  assert.ok(Math.max(...targets) >= TARGET_MAX - 1e-9, 'sample does not reach targetB 5.5');
});

/* ------------------------------------------------------------------ *
 * Culture-fairness + validity
 * ------------------------------------------------------------------ */

test('every sampled item passes auditItem', () => {
  const failures = [];
  for (const row of SAMPLE.rows) {
    const verdict = auditItem(row.item);
    if (!verdict.ok) {
      const who = (row.item && row.item.family) || row.requested || 'unknown';
      failures.push(
        `${who} @ targetB=${row.targetB.toFixed(2)} id=${String(row.item && row.item.id)} :: ` +
        verdict.problems.slice(0, 4).join(' ; ')
      );
    }
  }
  assert.equal(
    failures.length, 0,
    `${failures.length}/${SAMPLE.rows.length} items failed auditItem:${list(failures, 12)}`
  );
});

test('no two options inside an item are identical strings', () => {
  const failures = [];
  for (const row of SAMPLE.rows) {
    const item = row.item;
    const seen = new Map();
    item.options.forEach((opt, i) => {
      const svg = opt && typeof opt.svg === 'string' ? opt.svg : `<<missing svg at ${i}>>`;
      if (seen.has(svg)) {
        failures.push(
          `${item.family} @ targetB=${row.targetB.toFixed(2)} id=${item.id}: ` +
          `options[${seen.get(svg)}] and options[${i}] are byte-identical`
        );
      } else {
        seen.set(svg, i);
      }
    });
  }
  assert.equal(failures.length, 0, `duplicate options found:${list(failures)}`);
});

test('exactly one option is keyed correct in every item', () => {
  const failures = [];
  for (const row of SAMPLE.rows) {
    const item = row.item;
    const matches = item.options.filter((opt) => opt && opt.id === item.answerId);
    if (matches.length !== 1) {
      failures.push(
        `${item.family} id=${item.id}: answerId '${item.answerId}' matches ${matches.length} option(s)`
      );
    }
    const ids = new Set(item.options.map((opt) => opt && opt.id));
    if (ids.size !== item.options.length) {
      failures.push(`${item.family} id=${item.id}: option ids are not unique`);
    }
  }
  assert.equal(failures.length, 0, `answer-key problems:${list(failures)}`);
});

test('the requested optionCount is honoured', () => {
  const failures = [];
  for (const row of SAMPLE.rows) {
    const item = row.item;
    if (item.options.length !== row.optionCount) {
      failures.push(
        `${item.family} @ targetB=${row.targetB.toFixed(2)}: asked for ${row.optionCount} options, got ${item.options.length}`
      );
    }
    if (item.meta.optionCount !== row.optionCount) {
      failures.push(
        `${item.family} @ targetB=${row.targetB.toFixed(2)}: meta.optionCount ${item.meta.optionCount} != requested ${row.optionCount}`
      );
    }
  }
  assert.equal(failures.length, 0, `optionCount was not honoured:${list(failures)}`);
});

/* ------------------------------------------------------------------ *
 * Distractor quality
 * ------------------------------------------------------------------ */

test('mean distractorSystematicity is at least 0.7 in every family', () => {
  const failures = [];
  const report = [];
  for (const key of EXPECTED_FAMILIES) {
    const rows = rowsOfFamily(key);
    if (rows.length === 0) {
      failures.push(`${key}: no items in the sample`);
      continue;
    }
    const values = rows.map((row) => row.item.meta.distractorSystematicity);
    const m = mean(values);
    report.push(`${key}=${m.toFixed(3)}`);
    if (!Number.isFinite(m) || m < MIN_SYSTEMATICITY - 1e-9) {
      failures.push(
        `${key}: mean distractorSystematicity ${Number.isFinite(m) ? m.toFixed(3) : String(m)} ` +
        `< ${MIN_SYSTEMATICITY} over ${rows.length} items ` +
        `(min ${Math.min(...values).toFixed(2)}, max ${Math.max(...values).toFixed(2)})`
      );
    }
  }
  assert.equal(
    failures.length, 0,
    `distractors are not systematic enough to discriminate:${list(failures)}\n  observed: ${report.join(' ')}`
  );
});

/* ------------------------------------------------------------------ *
 * Difficulty targeting
 * ------------------------------------------------------------------ */

test('predicted difficulty tracks the requested targetB (pearson >= 0.85)', () => {
  const xs = [];
  const ys = [];
  const perFamily = new Map();

  for (const row of SAMPLE.rows) {
    const peak = maxInfoTheta(row.item.irt);
    assert.ok(
      Number.isFinite(peak),
      `${row.item.family} id=${row.item.id}: maxInfoTheta(${JSON.stringify(row.item.irt)}) is not finite`
    );
    xs.push(row.targetB);
    ys.push(peak);
    const key = row.item.family;
    if (!perFamily.has(key)) perFamily.set(key, { xs: [], ys: [] });
    perFamily.get(key).xs.push(row.targetB);
    perFamily.get(key).ys.push(peak);
  }

  const diagnostics = [];
  for (const [key, data] of perFamily) {
    const r = pearson(data.xs, data.ys);
    const bias = mean(data.ys.map((y, i) => y - data.xs[i]));
    diagnostics.push(`${key}: r=${Number.isFinite(r) ? r.toFixed(3) : String(r)} bias=${bias.toFixed(2)}`);
  }

  const r = pearson(xs, ys);
  assert.ok(
    Number.isFinite(r) && r >= MIN_CORRELATION,
    `pearson(targetB, maxInfoTheta) = ${Number.isFinite(r) ? r.toFixed(4) : String(r)} ` +
    `over ${xs.length} items, need >= ${MIN_CORRELATION}. Per family:${list(diagnostics, 8)}`
  );
});

test('every family generates across its declared bRange', () => {
  const failures = [];
  FAMILIES.forEach((mod, idx) => {
    const key = familyKey(mod, idx);
    if (typeof mod.generate !== 'function') {
      failures.push(`${key}: no generate() to exercise`);
      return;
    }
    const [lo, hi] = familyRange(mod);
    const points = [['bRange[0]', lo], ['midpoint', (lo + hi) / 2], ['bRange[1]', hi]];
    for (const [label, targetB] of points) {
      for (const optionCount of [6, 8]) {
        const rng = makeRng(`items.test.js/endpoint/${key}/${label}/${optionCount}`);
        let item;
        try {
          item = mod.generate(rng, { targetB, optionCount });
        } catch (err) {
          failures.push(
            `${key}.generate at ${label} (targetB=${targetB}) optionCount=${optionCount} threw: ${msgOf(err)}`
          );
          continue;
        }
        if (!item || typeof item !== 'object') {
          failures.push(`${key}.generate at ${label} returned ${String(item)}`);
          continue;
        }
        if (!item.prompt || typeof item.prompt.svg !== 'string' || item.prompt.svg.length === 0) {
          failures.push(`${key}.generate at ${label}: prompt.svg missing`);
        }
        if (!Array.isArray(item.options) || item.options.length !== optionCount) {
          failures.push(
            `${key}.generate at ${label}: expected ${optionCount} options, got ` +
            `${Array.isArray(item.options) ? item.options.length : String(item.options)}`
          );
        }
        if (!item.meta || typeof item.meta !== 'object') {
          failures.push(`${key}.generate at ${label}: meta missing`);
        }
      }
    }
  });
  assert.equal(failures.length, 0, `bRange coverage failures:${list(failures, 12)}`);
});

/* ------------------------------------------------------------------ *
 * Determinism
 * ------------------------------------------------------------------ */

test('the same seed and spec produce a byte-identical item', () => {
  const failures = [];

  for (const key of EXPECTED_FAMILIES) {
    const mod = familyByKey(key);
    if (!mod) continue;
    const [lo, hi] = familyRange(mod);
    const targetB = lo + (hi - lo) * 0.5;
    const spec = { targetB, optionCount: 8, families: [key] };
    const a = generateItemAtDifficulty(makeRng(20250908), spec);
    const b = generateItemAtDifficulty(makeRng(20250908), spec);
    if (JSON.stringify({ svg: a.prompt.svg, answerId: a.answerId }) !==
      JSON.stringify({ svg: b.prompt.svg, answerId: b.answerId })) {
      failures.push(`${key}: prompt.svg / answerId differ between identical seeds`);
    }
    if (signature(a) !== signature(b)) {
      failures.push(`${key}: full item signature differs between identical seeds`);
    }
  }

  const specAll = { targetB: 1.75, optionCount: 8 };
  const r1 = generateItemAtDifficulty(makeRng('determinism/registry'), specAll);
  const r2 = generateItemAtDifficulty(makeRng('determinism/registry'), specAll);
  if (signature(r1) !== signature(r2)) {
    failures.push('registry-level generateItemAtDifficulty is not deterministic');
  }

  const g1 = generateItem(makeRng('determinism/generateItem'), {});
  const g2 = generateItem(makeRng('determinism/generateItem'), {});
  if (signature(g1) !== signature(g2)) {
    failures.push('generateItem is not deterministic');
  }

  assert.equal(failures.length, 0, `determinism violations:${list(failures)}`);
});

test('consecutive draws from one rng stream vary (exposure control)', () => {
  const rng = makeRng('variety/stream');
  const seen = new Set();
  const families = new Set();
  for (let i = 0; i < 24; i += 1) {
    const item = generateItemAtDifficulty(rng, { targetB: 1.0, optionCount: 8 });
    seen.add(item.prompt.svg);
    families.add(item.family);
  }
  assert.ok(
    seen.size >= 10,
    `24 consecutive draws at targetB=1.0 produced only ${seen.size} distinct prompts ` +
    `across families [${[...families].join(', ')}]; the adaptive test administers up to 40 ` +
    'items and would visibly repeat itself'
  );
});

/* ------------------------------------------------------------------ *
 * Registry behaviour
 * ------------------------------------------------------------------ */

test('generateItem produces audit-clean items from every family', () => {
  const failures = [];
  const seenFamilies = new Set();
  const rng = makeRng('generateItem/sweep');
  for (let i = 0; i < 120; i += 1) {
    const item = generateItem(rng, {});
    seenFamilies.add(item.family);
    const verdict = auditItem(item);
    if (!verdict.ok) {
      failures.push(`${item.family} id=${item.id}: ${verdict.problems.slice(0, 3).join(' ; ')}`);
    }
  }
  assert.equal(failures.length, 0, `generateItem produced invalid items:${list(failures)}`);
  assert.ok(
    seenFamilies.size >= 6,
    `generateItem only reached ${seenFamilies.size} families in 120 draws: ${[...seenFamilies].join(', ')}`
  );

  const scoped = generateItem(makeRng('generateItem/scoped'), { families: ['matrix'], optionCount: 6 });
  assert.equal(scoped.family, 'matrix');
  assert.equal(scoped.options.length, 6);
});

test('spec.exclude makes the registry regenerate', () => {
  const first = generateItemAtDifficulty(makeRng('exclude/seed'), { targetB: 1.0, families: ['matrix'] });
  const again = generateItemAtDifficulty(makeRng('exclude/seed'), { targetB: 1.0, families: ['matrix'] });
  assert.equal(first.id, again.id, 'precondition: the same seed must reproduce the same item');

  const avoided = generateItemAtDifficulty(makeRng('exclude/seed'), {
    targetB: 1.0,
    families: ['matrix'],
    exclude: new Set([first.id])
  });
  assert.notEqual(avoided.id, first.id, 'spec.exclude did not force a regeneration');
  assert.ok(auditItem(avoided).ok, 'the regenerated item failed the audit');
});

test('generateItemAtDifficulty never returns null and tolerates hostile specs', () => {
  const rng = makeRng('robustness');
  const specs = [
    {},
    { targetB: -9 },
    { targetB: 12 },
    { targetB: 0, optionCount: 7 },
    { targetB: 0, optionCount: null },
    { targetB: 2, families: [] },
    { targetB: 2, families: ['nope', 'matrix'] },
    { targetB: 2, families: ['nope'] },
    { targetB: 2, maxTries: 1 },
    { targetB: 2, maxTries: 0 },
    { targetB: 2, exclude: null },
    { targetB: 2, exclude: ['not-a-real-id'] },
    { targetB: 2, bank: {} },
    { targetB: Number.NaN }
  ];
  for (const spec of specs) {
    const item = generateItemAtDifficulty(rng, spec);
    assert.ok(item && item.prompt, `spec ${JSON.stringify(spec)} produced ${String(item)}`);
    assert.ok(
      item.options.length === 6 || item.options.length === 8,
      `spec ${JSON.stringify(spec)} produced ${item.options.length} options`
    );
    const verdict = auditItem(item);
    assert.ok(verdict.ok, `spec ${JSON.stringify(spec)} produced an invalid item: ${verdict.problems.join(' ; ')}`);
  }
  assert.ok(generateItemAtDifficulty(rng, undefined).prompt, 'undefined spec must still yield an item');
});

/* ------------------------------------------------------------------ *
 * auditItem itself
 * ------------------------------------------------------------------ */

test('auditItem rejects the defects it exists to catch', () => {
  assert.ok(
    SAMPLE.rows.length > 0,
    `no item could be generated, so auditItem has nothing to mutate:${list(SAMPLE.errors, 4)}`
  );
  const clean = SAMPLE.rows[0].item;
  assert.ok(auditItem(clean).ok, 'precondition: sample item must be clean');

  const clone = () => JSON.parse(JSON.stringify(clean));
  const mutate = (fn) => {
    const item = clone();
    fn(item);
    return auditItem(item);
  };

  assert.equal(auditItem(null).ok, false);
  assert.equal(auditItem(undefined).ok, false);
  assert.equal(auditItem({}).ok, false);
  assert.equal(auditItem('nope').ok, false);

  const svgHead = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10" width="10" height="10">';
  const cases = [
    ['<text> element', (i) => { i.prompt.svg = `${svgHead}<text x="1" y="2">A</text></svg>`; }],
    ['digit in a text node', (i) => { i.prompt.svg = `${svgHead}<g>7</g></svg>`; }],
    ['CJK glyph', (i) => { i.prompt.svg = `${svgHead}<g>三</g></svg>`; }],
    ['numeric entity', (i) => { i.prompt.svg = `${svgHead}<g fill="none">&#65;</g></svg>`; }],
    ['font attribute', (i) => { i.prompt.svg = `${svgHead}<g font-family="Arial"/></svg>`; }],
    ['aria-label words', (i) => { i.prompt.svg = `${svgHead.slice(0, -1)} aria-label="pick one"/>`; }],
    ['foreign object', (i) => { i.prompt.svg = `${svgHead}<foreignObject/></svg>`; }],
    ['option svg text', (i) => { i.options[1].svg = `${svgHead}<g>1</g></svg>`; }],
    ['duplicate option id', (i) => { i.options[1].id = i.options[0].id; }],
    ['duplicate option svg', (i) => { i.options[1].svg = i.options[0].svg; }],
    ['unknown answerId', (i) => { i.answerId = 'nope'; }],
    ['seven options', (i) => { i.options = i.options.slice(0, 7); i.meta.optionCount = 7; }],
    ['missing meta field', (i) => { delete i.meta.wmLoad; }],
    ['out-of-range meta', (i) => { i.meta.distractorSystematicity = 1.4; }],
    ['empty ruleTypes', (i) => { i.meta.ruleTypes = []; }],
    ['irt.a too high', (i) => { i.irt.a = 3.1; }],
    ['irt.a too low', (i) => { i.irt.a = 0.2; }],
    ['irt.b not finite', (i) => { i.irt.b = null; }],
    ['irt.c at chance ceiling', (i) => { i.irt.c = 0.3; }],
    ['irt.c zero', (i) => { i.irt.c = 0; }],
    ['unregistered family', (i) => { i.family = 'astrology'; i.id = 'astrology:1:1'; }],
    ['id not namespaced by family', (i) => { i.id = 'something-else'; }],
    ['missing prompt', (i) => { delete i.prompt; }]
  ];

  const missed = [];
  for (const [name, fn] of cases) {
    const verdict = mutate(fn);
    if (verdict.ok) missed.push(name);
    else if (!Array.isArray(verdict.problems) || verdict.problems.length === 0) {
      missed.push(`${name} (flagged but reported no problems)`);
    }
  }
  assert.equal(missed.length, 0, `auditItem failed to detect:${list(missed)}`);
});

/* ------------------------------------------------------------------ *
 * Performance — a slow generator makes the adaptive test unusable
 * ------------------------------------------------------------------ */

test(`generation performance: ${PERF_ITEMS} items in under ${PERF_BUDGET_MS}ms`, () => {
  const rng = makeRng('perf/v1');
  const started = performance.now();
  for (let i = 0; i < PERF_ITEMS; i += 1) {
    const targetB = spread(TARGET_MIN, TARGET_MAX, i, PERF_ITEMS);
    const item = generateItemAtDifficulty(rng, { targetB, optionCount: 8 });
    assert.ok(item && item.prompt && typeof item.prompt.svg === 'string');
  }
  const elapsed = performance.now() - started;
  assert.ok(
    elapsed < PERF_BUDGET_MS,
    `${PERF_ITEMS} items took ${elapsed.toFixed(0)}ms ` +
    `(${(elapsed / PERF_ITEMS).toFixed(1)}ms each); budget is ${PERF_BUDGET_MS}ms`
  );
});
