#!/usr/bin/env node
/**
 * Standalone culture-fairness auditor (`node tools/audit-culture.mjs [n]`, n = 400
 * by default): samples items across every family, the first trial of every drill and
 * every wordless demo, and reports markup that could show a letter, digit or glyph.
 */

import { FAMILIES, auditItem, generateItemAtDifficulty } from '../src/items/registry.js';
import { makeRng } from '../src/core/rng.js';
/* Static imports only — CONTRACTS.md 0.1 forbids dynamic import() everywhere,
 * tools included. Missing or malformed exports are reported as SKIPPED rows below
 * rather than by failing to load. */
import * as drillsIndex from '../src/train/drills/index.js';
import * as curriculum from '../src/train/curriculum.js';
import * as demos from '../src/ui/demos.js';

const DEFAULT_N = 400;
const MAX_N = 20000;
const MAX_DETAIL_PER_ROW = 6;

const COLS = [
  { head: 'GROUP', width: 8 },
  { head: 'SUBJECT', width: 26 },
  { head: 'CHECKED', width: 8, right: true },
  { head: 'FAILED', width: 7, right: true },
  { head: 'STATUS', width: 6 }
];

/* ------------------------------------------------------------------ *
 * Small helpers
 * ------------------------------------------------------------------ */

function msgOf(err) {
  if (!err) return 'unknown error';
  return err instanceof Error && err.message ? err.message : String(err);
}

/** First line of an error, short enough to sit in a report line. */
function briefMsg(err, limit = 110) {
  const first = msgOf(err).split('\n')[0].trim();
  return first.length > limit ? `${first.slice(0, limit)}...` : first;
}

function pad(text, width, right) {
  const s = String(text);
  if (s.length >= width) return s.slice(0, width);
  const fill = ' '.repeat(width - s.length);
  return right ? fill + s : s + fill;
}

function familyKeyOf(mod, idx) {
  if (mod && typeof mod.family === 'string' && mod.family.length > 0) return mod.family;
  return `family#${idx}`;
}

function bRangeOf(mod) {
  const r = mod && mod.bRange;
  if (
    Array.isArray(r) && r.length >= 2 &&
    Number.isFinite(r[0]) && Number.isFinite(r[1]) && r[1] > r[0]
  ) {
    return [r[0], r[1]];
  }
  return [-1.5, 5.5];
}

function parseCount(argv) {
  const raw = argv.find((a) => !a.startsWith('-'));
  if (raw === undefined) return DEFAULT_N;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_N;
  return Math.min(n, MAX_N);
}

/* ------------------------------------------------------------------ *
 * Raw-SVG probe
 *
 * Reuses `auditItem` so the CLI and the library share exactly one scanner:
 * the svg under test is mounted as the prompt of an otherwise-valid synthetic
 * item, and only the prompt-scoped problems are kept.
 * ------------------------------------------------------------------ */

const PROBE_FAMILY = familyKeyOf(FAMILIES[0], 0);

function probeOption(i) {
  return {
    id: `o${i}`,
    width: 40,
    height: 40,
    svg:
      '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 40 40">' +
      `<circle cx="20" cy="20" r="${6 + i}" fill="none" stroke="#111111" stroke-width="2"/></svg>`
  };
}

const PROBE_OPTIONS = [0, 1, 2, 3, 4, 5].map(probeOption);

function probeSvg(svg) {
  const item = {
    id: `${PROBE_FAMILY}:0:0`,
    family: PROBE_FAMILY,
    seed: 0,
    prompt: { svg, width: 100, height: 100 },
    options: PROBE_OPTIONS.map((o) => ({ ...o })),
    answerId: 'o0',
    meta: {
      ruleCount: 1,
      ruleTypes: ['constancy'],
      abstractness: 1,
      elementCount: 1,
      distractorSystematicity: 1,
      wmLoad: 1,
      perceptualSalience: 0,
      optionCount: 6,
      generatorVersion: 1
    },
    irt: { a: 1, b: 0, c: 0.1 }
  };
  return auditItem(item).problems
    .filter((p) => p.startsWith('prompt.svg'))
    .map((p) => p.replace(/^prompt\.svg:\s*/, ''));
}

const CLEAN_PROBE =
  '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 10 10">' +
  '<circle cx="5" cy="5" r="3" fill="none" stroke="#112233" stroke-width="1"/></svg>';

const DIRTY_PROBE =
  '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 10 10">' +
  '<text x="1" y="8">A</text></svg>';

function selfCheck() {
  const clean = probeSvg(CLEAN_PROBE);
  const dirty = probeSvg(DIRTY_PROBE);
  const notes = [];
  if (clean.length > 0) notes.push(`the scanner flags a known-clean svg: ${clean.join(' ; ')}`);
  if (dirty.length === 0) notes.push('the scanner does not flag a known-dirty svg (<text>)');
  return notes;
}

/* ------------------------------------------------------------------ *
 * Rows
 * ------------------------------------------------------------------ */

function makeRow(group, subject) {
  return { group, subject, checked: 0, failed: 0, details: [], notes: [] };
}

function recordSvg(row, where, svg) {
  row.checked += 1;
  let problems;
  try {
    problems = probeSvg(svg);
  } catch (err) {
    problems = [`scanner threw: ${briefMsg(err, 200)}`];
  }
  if (problems.length > 0) {
    row.failed += 1;
    row.details.push(`${where}: ${problems.join(' ; ')}`);
  }
}

/* ------------------------------------------------------------------ *
 * Item families
 * ------------------------------------------------------------------ */

function auditFamilies(total) {
  const rows = [];
  const famCount = FAMILIES.length;
  if (famCount === 0) return rows;
  const base = Math.floor(total / famCount);
  const extra = total % famCount;

  FAMILIES.forEach((mod, idx) => {
    const key = familyKeyOf(mod, idx);
    const row = makeRow('family', key);
    const count = base + (idx < extra ? 1 : 0);
    const [lo, hi] = bRangeOf(mod);
    const rng = makeRng(`audit-culture/${key}`);

    for (let i = 0; i < count; i += 1) {
      const targetB = count <= 1 ? (lo + hi) / 2 : lo + (hi - lo) * (i / (count - 1));
      const optionCount = i % 5 === 4 ? 6 : 8;
      row.checked += 1;
      let item;
      try {
        item = generateItemAtDifficulty(rng, { targetB, optionCount, families: [key] });
      } catch (err) {
        row.failed += 1;
        row.details.push(`targetB=${targetB.toFixed(2)}: generation threw: ${briefMsg(err, 200)}`);
        continue;
      }
      const verdict = auditItem(item);
      if (!verdict.ok) {
        row.failed += 1;
        row.details.push(
          `targetB=${targetB.toFixed(2)} id=${String(item.id)}: ${verdict.problems.slice(0, 5).join(' ; ')}`
        );
      }
    }
    rows.push(row);
  });

  return rows;
}

/* ------------------------------------------------------------------ *
 * Drills and demos
 *
 * These modules are imported statically (CONTRACTS.md §0.1 forbids dynamic
 * import()). Degradation therefore happens on the *exports*, not on the load:
 * a module whose contracted export is absent or the wrong type is reported as
 * a SKIPPED row instead of aborting the audit.
 * ------------------------------------------------------------------ */

function svgsOfTrial(trial) {
  const out = [];
  if (!trial || typeof trial !== 'object') return out;
  const stim = trial.stimulus;
  if (stim && typeof stim === 'object') {
    if (typeof stim.svg === 'string') out.push(['stimulus.svg', stim.svg]);
    if (Array.isArray(stim.frames)) {
      stim.frames.forEach((frame, i) => {
        if (frame && typeof frame.svg === 'string') out.push([`stimulus.frames[${i}].svg`, frame.svg]);
      });
    }
  }
  if (Array.isArray(trial.options)) {
    trial.options.forEach((opt, i) => {
      if (opt && typeof opt.svg === 'string') out.push([`options[${i}].svg`, opt.svg]);
    });
  }
  return out;
}

function auditDrills() {
  const modules = drillsIndex.DRILL_MODULES;
  if (!Array.isArray(modules)) {
    return {
      rows: [],
      skipped: 'drills: src/train/drills/index.js does not export a DRILL_MODULES array',
      ids: []
    };
  }

  const levels = Array.isArray(curriculum.LEVELS) ? curriculum.LEVELS : [];
  const paramsFor = (id) => {
    const level = levels.find((lv) => lv && lv.drill === id && lv.params && typeof lv.params === 'object');
    return level ? level.params : {};
  };

  const rows = [];
  const ids = [];
  for (const drill of modules) {
    const id = drill && typeof drill.id === 'string' && drill.id ? drill.id : '<unnamed drill>';
    ids.push(id);
    const row = makeRow('drill', id);
    if (!drill || typeof drill.makeRun !== 'function') {
      row.failed += 1;
      row.checked += 1;
      row.details.push('does not export makeRun(rng, params)');
      rows.push(row);
      continue;
    }
    let trial = null;
    try {
      const run = drill.makeRun(makeRng(`audit-culture/drill/${id}`), paramsFor(id));
      if (!run || typeof run.nextTrial !== 'function') throw new Error('makeRun did not return a Run with nextTrial()');
      trial = run.nextTrial(1);
    } catch (err) {
      row.failed += 1;
      row.checked += 1;
      row.details.push(`first trial threw: ${briefMsg(err, 200)}`);
      rows.push(row);
      continue;
    }
    if (trial === null || trial === undefined) {
      row.notes.push('first trial was null (nothing to scan)');
      rows.push(row);
      continue;
    }
    const svgs = svgsOfTrial(trial);
    if (svgs.length === 0) {
      row.failed += 1;
      row.checked += 1;
      row.details.push('first trial carries no svg stimulus or options');
      rows.push(row);
      continue;
    }
    for (const [where, svg] of svgs) recordSvg(row, where, svg);
    rows.push(row);
  }
  return { rows, skipped: null, ids };
}

function auditDemos(drillIds) {
  const demoFor = demos.demoFor;
  if (typeof demoFor !== 'function') {
    return { rows: [], skipped: 'demos: src/ui/demos.js does not export demoFor()' };
  }

  const kinds = [
    ...FAMILIES.map((mod, idx) => familyKeyOf(mod, idx)),
    ...drillIds
  ];
  const rows = [];
  for (const kind of kinds) {
    const row = makeRow('demo', kind);
    let demo;
    try {
      demo = demoFor(kind);
    } catch (err) {
      row.failed += 1;
      row.checked += 1;
      row.details.push(`demoFor('${kind}') threw: ${briefMsg(err, 200)}`);
      rows.push(row);
      continue;
    }
    if (!demo || !Array.isArray(demo.frames) || demo.frames.length === 0) {
      row.failed += 1;
      row.checked += 1;
      row.details.push(
        `demoFor('${kind}') returned no frames; every family and drill needs a wordless demo (CONTRACTS.md 20)`
      );
      rows.push(row);
      continue;
    }
    demo.frames.forEach((frame, i) => {
      if (!frame || typeof frame.svg !== 'string') {
        row.checked += 1;
        row.failed += 1;
        row.details.push(`frames[${i}]: missing svg`);
        return;
      }
      recordSvg(row, `frames[${i}].svg`, frame.svg);
    });
    rows.push(row);
  }
  return { rows, skipped: null };
}

/* ------------------------------------------------------------------ *
 * Output
 * ------------------------------------------------------------------ */

function headerLine() {
  return COLS.map((c) => pad(c.head, c.width, c.right)).join('  ').trimEnd();
}

function ruleLine() {
  return COLS.map((c) => '-'.repeat(c.width)).join('  ');
}

function rowLine(row) {
  const status = row.failed === 0 ? 'PASS' : 'FAIL';
  return [
    pad(row.group, COLS[0].width),
    pad(row.subject, COLS[1].width),
    pad(row.checked, COLS[2].width, true),
    pad(row.failed, COLS[3].width, true),
    pad(status, COLS[4].width)
  ].join('  ').trimEnd();
}

function printReport(rows, skipped, selfNotes, requested) {
  const totalChecked = rows.reduce((a, r) => a + r.checked, 0);
  const totalFailed = rows.reduce((a, r) => a + r.failed, 0);

  console.log('');
  console.log(`CULTURE-FAIRNESS AUDIT  —  ${requested} sampled items, ${FAMILIES.length} families`);
  console.log('No letters, no digits, no cultural glyphs, in any script.');
  console.log('');
  console.log(headerLine());
  console.log(ruleLine());
  for (const row of rows) console.log(rowLine(row));
  console.log(ruleLine());
  console.log([
    pad('TOTAL', COLS[0].width),
    pad('', COLS[1].width),
    pad(totalChecked, COLS[2].width, true),
    pad(totalFailed, COLS[3].width, true),
    pad(totalFailed === 0 ? 'PASS' : 'FAIL', COLS[4].width)
  ].join('  ').trimEnd());

  const noted = rows.filter((r) => r.notes.length > 0);
  if (noted.length > 0) {
    console.log('');
    console.log('NOTES');
    for (const row of noted) {
      for (const note of row.notes) console.log(`  ${row.group}/${row.subject}: ${note}`);
    }
  }

  if (skipped.length > 0) {
    console.log('');
    console.log('SKIPPED (module not available yet)');
    for (const s of skipped) console.log(`  ${s}`);
  }

  const failing = rows.filter((r) => r.failed > 0);
  if (failing.length > 0) {
    console.log('');
    console.log('OFFENDING CONTENT');
    for (const row of failing) {
      console.log(`  ${row.group}/${row.subject}  (${row.failed} of ${row.checked} failed)`);
      for (const detail of row.details.slice(0, MAX_DETAIL_PER_ROW)) {
        console.log(`    - ${detail}`);
      }
      if (row.details.length > MAX_DETAIL_PER_ROW) {
        console.log(`    ... and ${row.details.length - MAX_DETAIL_PER_ROW} more`);
      }
    }
  }

  if (selfNotes.length > 0) {
    console.log('');
    console.log('SCANNER SELF-CHECK FAILED — results below are not trustworthy:');
    for (const note of selfNotes) console.log(`  ${note}`);
  }

  console.log('');
  console.log(totalFailed === 0 && selfNotes.length === 0
    ? 'RESULT: PASS — every scanned stimulus is wordless.'
    : `RESULT: FAIL — ${totalFailed} scanned stimulus/stimuli must be fixed.`);
  console.log('');

  return totalFailed;
}

/* ------------------------------------------------------------------ *
 * Entry point
 * ------------------------------------------------------------------ */

function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('-h') || argv.includes('--help')) {
    console.log('Usage: node tools/audit-culture.mjs [n]');
    console.log('  n  number of items to sample across all families (default 400)');
    return 0;
  }

  const requested = parseCount(argv);
  const selfNotes = selfCheck();

  const rows = auditFamilies(requested);
  const skipped = [];

  const drillReport = auditDrills();
  if (drillReport.skipped) skipped.push(drillReport.skipped);
  rows.push(...drillReport.rows);

  const demoReport = auditDemos(drillReport.ids);
  if (demoReport.skipped) skipped.push(demoReport.skipped);
  rows.push(...demoReport.rows);

  const totalFailed = printReport(rows, skipped, selfNotes, requested);
  if (selfNotes.length > 0) return 2;
  return totalFailed === 0 ? 0 : 1;
}

try {
  process.exitCode = main();
} catch (err) {
  console.error(`audit-culture: fatal error: ${msgOf(err)}`);
  if (err && err.stack) console.error(err.stack);
  process.exitCode = 2;
}
