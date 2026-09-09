/**
 * Registry of every item family plus difficulty-targeted item generation.
 * Also owns `auditItem`, the culture-fairness + structural validity gate that
 * every generated item must pass before it can be shown to a candidate.
 */

import * as matrixModule from './matrix.js';
import * as progressionModule from './progression.js';
import * as seriesModule from './series.js';
import * as analogyModule from './analogy.js';
import * as oddOneOutModule from './oddoneout.js';
import * as constraintGridModule from './logicgrid.js';
import * as paperFoldingModule from './folding.js';
import * as mentalRotationModule from './rotation.js';

import { priorIrtParams, blendedParams, itemKey } from './calibration.js';
import { maxInfoTheta } from '../core/irt.js';

/* ------------------------------------------------------------------ *
 * Family table
 * ------------------------------------------------------------------ */

export const FAMILIES = Object.freeze([
  matrixModule,
  progressionModule,
  seriesModule,
  analogyModule,
  oddOneOutModule,
  constraintGridModule,
  paperFoldingModule,
  mentalRotationModule
]);

/** Fallback keys, used only if a family module fails to export `family`. */
const EXPECTED_KEYS = new Map([
  [matrixModule, 'matrix'],
  [progressionModule, 'progression'],
  [seriesModule, 'series'],
  [analogyModule, 'analogy'],
  [oddOneOutModule, 'oddOneOut'],
  [constraintGridModule, 'constraintGrid'],
  [paperFoldingModule, 'paperFolding'],
  [mentalRotationModule, 'mentalRotation']
]);

const DEFAULT_B_RANGE = [-1.5, 5.5];

/** Difficulty error (in theta units) below which the search stops immediately. */
const EXIT_GOOD = 0.12;
/** After this many attempts a merely decent candidate is accepted. */
const RELAX_AFTER = 8;
const EXIT_OK = 0.4;
/** How far outside its declared bRange a family may still be asked to stretch. */
const RANGE_TOLERANCE = 0.25;

const MAX_PROBLEMS = 48;
const EPS = 1e-9;

function keyOf(mod) {
  if (mod && typeof mod.family === 'string' && mod.family.length > 0) return mod.family;
  return EXPECTED_KEYS.get(mod) || 'unknown';
}

function rangeOf(mod) {
  const r = mod && mod.bRange;
  if (
    Array.isArray(r) && r.length >= 2 &&
    Number.isFinite(r[0]) && Number.isFinite(r[1]) && r[1] > r[0]
  ) {
    return [r[0], r[1]];
  }
  return DEFAULT_B_RANGE.slice();
}

export function familyByKey(key) {
  if (typeof key !== 'string' || key.length === 0) return null;
  for (const mod of FAMILIES) {
    if (keyOf(mod) === key) return mod;
  }
  return null;
}

/* ------------------------------------------------------------------ *
 * Spec normalisation
 * ------------------------------------------------------------------ */

function toSet(value) {
  if (value instanceof Set) return value;
  if (Array.isArray(value)) return new Set(value);
  return new Set();
}

function normalizeFamilies(list) {
  if (list === null || list === undefined) return FAMILIES.slice();
  const raw = Array.isArray(list) ? list : [list];
  const out = [];
  for (const entry of raw) {
    let mod = null;
    if (typeof entry === 'string') mod = familyByKey(entry);
    else if (entry && FAMILIES.includes(entry)) mod = entry;
    else if (entry && typeof entry.family === 'string') mod = familyByKey(entry.family);
    if (mod && !out.includes(mod)) out.push(mod);
  }
  return out.length > 0 ? out : FAMILIES.slice();
}

function normalizeSpec(spec) {
  const s = spec && typeof spec === 'object' ? spec : {};
  const targetB = Number.isFinite(s.targetB) ? s.targetB : 0;
  let optionCount = Number.isInteger(s.optionCount) ? s.optionCount : 8;
  if (optionCount !== 6 && optionCount !== 8) optionCount = 8;
  let maxTries = Number.isInteger(s.maxTries) && s.maxTries > 0 ? s.maxTries : 24;
  maxTries = Math.min(maxTries, 200);
  return {
    targetB,
    optionCount,
    maxTries,
    exclude: toSet(s.exclude),
    bank: s.bank && typeof s.bank === 'object' ? s.bank : null,
    families: normalizeFamilies(s.families)
  };
}

/* ------------------------------------------------------------------ *
 * Rng plumbing (deterministic; never touches Math.random)
 * ------------------------------------------------------------------ */

function requireRng(rng) {
  if (!rng || typeof rng.next !== 'function') {
    throw new TypeError('registry: an rng object with next() is required (see core/rng.js)');
  }
  return rng;
}

function saltOf(rng) {
  if (typeof rng.int === 'function') {
    const v = rng.int(0, 2147483647);
    if (Number.isFinite(v)) return v >>> 0;
  }
  return Math.floor(rng.next() * 2147483647) >>> 0;
}

function forkRng(rng, tag) {
  if (typeof rng.fork === 'function') {
    try {
      const child = rng.fork(tag);
      if (child && typeof child.next === 'function') return child;
    } catch (err) {
      /* fall through to the parent stream */
    }
  }
  return rng;
}

function shuffled(rng, arr) {
  if (arr.length < 2) return arr.slice();
  if (typeof rng.shuffle === 'function') {
    try {
      const out = rng.shuffle(arr);
      if (Array.isArray(out) && out.length === arr.length) return out;
    } catch (err) {
      /* fall through */
    }
  }
  return arr.slice();
}

function pickFrom(rng, pool) {
  if (pool.length === 1) return pool[0];
  if (typeof rng.pick === 'function') {
    const picked = rng.pick(pool);
    if (picked) return picked;
  }
  const i = Math.floor(rng.next() * pool.length);
  return pool[Math.min(pool.length - 1, Math.max(0, i))];
}

/* ------------------------------------------------------------------ *
 * Candidate search
 * ------------------------------------------------------------------ */

function eligibleFor(pool, targetB) {
  const hits = pool.filter((mod) => {
    const [lo, hi] = rangeOf(mod);
    return targetB >= lo - RANGE_TOLERANCE && targetB <= hi + RANGE_TOLERANCE;
  });
  if (hits.length > 0) return hits;
  let best = null;
  let bestDist = Infinity;
  for (const mod of pool) {
    const [lo, hi] = rangeOf(mod);
    const dist = targetB < lo ? lo - targetB : targetB > hi ? targetB - hi : 0;
    if (dist < bestDist) {
      bestDist = dist;
      best = mod;
    }
  }
  return best ? [best] : pool.slice();
}

function widestFamily(pool) {
  let best = pool[0] || FAMILIES[0];
  let bestSpan = -Infinity;
  for (const mod of pool.length > 0 ? pool : FAMILIES) {
    const [lo, hi] = rangeOf(mod);
    if (hi - lo > bestSpan) {
      bestSpan = hi - lo;
      best = mod;
    }
  }
  return best;
}

function errText(err) {
  if (!err) return 'unknown error';
  if (err instanceof Error && err.message) return err.message;
  return String(err);
}

function callGenerate(mod, rng, targetB, optionCount) {
  if (!mod || typeof mod.generate !== 'function') {
    throw new Error(`family '${keyOf(mod)}' does not export generate(rng, spec)`);
  }
  return mod.generate(rng, { targetB, optionCount });
}

/**
 * Minimum structure needed to score and serve a candidate. Full validity is the
 * job of `auditItem`; this only rejects candidates we cannot even evaluate.
 */
function structuralProblem(item) {
  if (!item || typeof item !== 'object') return 'generate() returned a non-object';
  if (typeof item.family !== 'string' || item.family.length === 0) return 'item.family missing';
  if (!item.meta || typeof item.meta !== 'object') return 'item.meta missing';
  if (!item.prompt || typeof item.prompt.svg !== 'string' || item.prompt.svg.length === 0) {
    return 'item.prompt.svg missing';
  }
  if (!Array.isArray(item.options) || item.options.length < 2) return 'item.options missing';
  if (typeof item.answerId !== 'string' || item.answerId.length === 0) return 'item.answerId missing';
  if (!item.options.some((opt) => opt && opt.id === item.answerId)) {
    return `item.answerId '${item.answerId}' is not among the option ids`;
  }
  return null;
}

function validIrt(p) {
  return !!p && Number.isFinite(p.a) && p.a > 0 && Number.isFinite(p.b) &&
    Number.isFinite(p.c) && p.c >= 0 && p.c < 1;
}

/**
 * Fills `item.irt` from the design-time prior, then blends in the online bank
 * when one is supplied. Returns null on success, or a reason string on failure.
 */
function attachIrt(item, bank) {
  let prior = null;
  try {
    prior = priorIrtParams(item.meta, item.family);
  } catch (err) {
    return `calibration.priorIrtParams threw: ${errText(err)}`;
  }
  if (!validIrt(prior)) {
    return `calibration.priorIrtParams returned unusable params ${JSON.stringify(prior)}`;
  }
  item.irt = { a: prior.a, b: prior.b, c: prior.c };
  if (bank) {
    try {
      const blended = blendedParams(item, bank);
      if (validIrt(blended)) item.irt = { a: blended.a, b: blended.b, c: blended.c };
    } catch (err) {
      /* an unusable posterior must never destroy a usable prior */
    }
  }
  return null;
}

function scoreOf(item, targetB) {
  let peak;
  try {
    peak = maxInfoTheta(item.irt);
  } catch (err) {
    return NaN;
  }
  if (!Number.isFinite(peak)) return NaN;
  return Math.abs(peak - targetB);
}

function isExcluded(item, exclude) {
  if (!exclude || exclude.size === 0) return false;
  if (typeof item.id === 'string' && exclude.has(item.id)) return true;
  let key = null;
  try {
    key = itemKey(item);
  } catch (err) {
    key = null;
  }
  return typeof key === 'string' && exclude.has(key);
}

/**
 * Generates the item whose information peak sits closest to `spec.targetB`.
 * Candidates are preferred in this order: right `optionCount` and not excluded,
 * right `optionCount` but excluded, wrong `optionCount`. Never returns null: on
 * total generator failure it makes one last attempt with the widest-range family
 * and otherwise throws with a diagnosable message.
 */
export function generateItemAtDifficulty(rng, spec) {
  requireRng(rng);
  const s = normalizeSpec(spec);
  const eligible = eligibleFor(s.families, s.targetB);
  const salt = saltOf(rng);
  const order = shuffled(rng, eligible);
  const failures = [];

  let best = null;
  let bestScore = Infinity;
  let bestExcluded = null;
  let bestExcludedScore = Infinity;
  /* A candidate that ignored spec.optionCount is kept only as a last resort:
   * auditItem rejects an item whose options.length is not 6 or 8, and cat.js
   * lays out a fixed option grid, so a mismatched count is a real defect. */
  let bestWrongCount = null;
  let bestWrongCountScore = Infinity;
  let attempts = 0;

  for (let i = 0; i < s.maxTries; i += 1) {
    const mod = order[i % order.length];
    const famKey = keyOf(mod);
    attempts += 1;
    const child = forkRng(rng, `${salt}:${famKey}:${i}`);

    let item;
    try {
      item = callGenerate(mod, child, s.targetB, s.optionCount);
    } catch (err) {
      failures.push(`${famKey} threw: ${errText(err)}`);
      continue;
    }

    const structural = structuralProblem(item);
    if (structural) {
      failures.push(`${famKey}: ${structural}`);
      continue;
    }

    const irtProblem = attachIrt(item, s.bank);
    if (irtProblem) {
      failures.push(`${famKey}: ${irtProblem}`);
      continue;
    }

    const score = scoreOf(item, s.targetB);
    if (!Number.isFinite(score)) {
      failures.push(`${famKey}: irt ${JSON.stringify(item.irt)} has no finite information peak`);
      continue;
    }

    if (item.options.length !== s.optionCount) {
      failures.push(
        `${famKey}: asked for ${s.optionCount} options, got ${item.options.length}`
      );
      if (score < bestWrongCountScore) {
        bestWrongCountScore = score;
        bestWrongCount = item;
      }
      continue;
    }

    if (isExcluded(item, s.exclude)) {
      if (score < bestExcludedScore) {
        bestExcludedScore = score;
        bestExcluded = item;
      }
      continue;
    }

    if (score < bestScore) {
      bestScore = score;
      best = item;
    }
    if (bestScore <= EXIT_GOOD) break;
    if (attempts >= RELAX_AFTER && bestScore <= EXIT_OK) break;
  }

  if (best) return best;
  /* Exclusion is a preference, not a contract: serving a repeat beats serving nothing. */
  if (bestExcluded) return bestExcluded;
  if (bestWrongCount) return bestWrongCount;

  const fallbackMod = widestFamily(s.families);
  const [flo, fhi] = rangeOf(fallbackMod);
  const fallbackB = Math.min(fhi, Math.max(flo, s.targetB));
  try {
    const child = forkRng(rng, `${salt}:fallback:${keyOf(fallbackMod)}`);
    const item = callGenerate(fallbackMod, child, fallbackB, s.optionCount);
    const structural = structuralProblem(item);
    if (structural) throw new Error(structural);
    const irtProblem = attachIrt(item, s.bank);
    if (irtProblem) throw new Error(irtProblem);
    return item;
  } catch (err) {
    const tried = eligible.map(keyOf).join(', ');
    const detail = failures.length > 0 ? failures.slice(0, 6).join(' | ') : 'no candidate was attempted';
    throw new Error(
      `registry.generateItemAtDifficulty: no usable item at targetB=${s.targetB} ` +
      `after ${attempts} attempt(s) across [${tried}]; fallback family ` +
      `'${keyOf(fallbackMod)}' also failed: ${errText(err)}. Earlier failures: ${detail}`
    );
  }
}

/**
 * Non-targeted generation: picks a family, then a difficulty uniformly inside
 * that family's declared bRange.
 */
export function generateItem(rng, spec) {
  requireRng(rng);
  const s = normalizeSpec(spec);
  const mod = pickFrom(rng, s.families);
  const [lo, hi] = rangeOf(mod);
  const targetB = lo + (hi - lo) * rng.next();
  return generateItemAtDifficulty(rng, {
    targetB,
    optionCount: s.optionCount,
    families: [keyOf(mod)],
    exclude: s.exclude,
    bank: s.bank,
    maxTries: s.maxTries
  });
}

/* ------------------------------------------------------------------ *
 * Culture-fairness + validity audit
 * ------------------------------------------------------------------ */

const LETTER_OR_DIGIT = /[\p{L}\p{Nd}]/u;
const LETTER_OR_DIGIT_RUNS = /[\p{L}\p{Nd}]+/gu;

const XML_ENTITIES = new Set(['amp', 'lt', 'gt', 'quot', 'apos']);

/** Elements that can put glyphs or foreign content on the canvas. */
const FORBIDDEN_ELEMENTS = new Set([
  'text', 'tspan', 'textpath', 'tref', 'altglyph', 'altglyphdef', 'altglyphitem',
  'glyph', 'glyphref', 'font', 'font-face', 'font-face-src', 'font-face-uri',
  'font-face-format', 'font-face-name', 'missing-glyph', 'foreignobject',
  'image', 'script', 'iframe', 'video', 'audio', 'embed', 'object'
]);

/** Attribute names whose value is a plain number / number list. */
const NUMERIC_ATTRS = new Set([
  'x', 'y', 'x1', 'y1', 'x2', 'y2', 'cx', 'cy', 'r', 'rx', 'ry', 'dx', 'dy',
  'width', 'height', 'opacity', 'fill-opacity', 'stroke-opacity', 'stop-opacity',
  'flood-opacity', 'stroke-width', 'stroke-dasharray', 'stroke-dashoffset',
  'stroke-miterlimit', 'offset', 'pathlength', 'markerwidth', 'markerheight',
  'refx', 'refy', 'fr', 'fx', 'fy', 'stddeviation', 'z', 'surfacescale',
  'specularconstant', 'specularexponent', 'diffuseconstant', 'azimuth',
  'elevation', 'limitingconeangle', 'pointsatx', 'pointsaty', 'pointsatz',
  'k1', 'k2', 'k3', 'k4', 'slope', 'intercept', 'amplitude', 'exponent',
  'basefrequency', 'numoctaves', 'seed', 'scale', 'divisor', 'bias', 'targetx',
  'targety', 'order', 'radius', 'tablevalues', 'kernelmatrix', 'dur', 'keytimes',
  'keysplines'
]);

const TRANSFORM_ATTRS = new Set([
  'transform', 'gradienttransform', 'patterntransform', 'transform-origin'
]);

const PAINT_ATTRS = new Set([
  'fill', 'stroke', 'color', 'stop-color', 'flood-color', 'lighting-color'
]);

/**
 * Attributes whose values are structural, enumerated or identifier-like. None of
 * them can put a glyph on screen, so their letters/digits are not scanned.
 */
const OPAQUE_ATTRS = new Set([
  'xmlns', 'xmlns:xlink', 'xmlns:svg', 'version', 'baseprofile', 'class', 'id',
  'role', 'aria-hidden', 'focusable', 'tabindex', 'overflow',
  'preserveaspectratio', 'shape-rendering', 'image-rendering', 'text-rendering',
  'color-rendering', 'vector-effect', 'pointer-events', 'visibility', 'display',
  'clip-path', 'clip-rule', 'fill-rule', 'stroke-linecap', 'stroke-linejoin',
  'paint-order', 'mix-blend-mode', 'isolation', 'color-interpolation',
  'color-interpolation-filters', 'mask', 'filter', 'patternunits',
  'patterncontentunits', 'gradientunits', 'spreadmethod', 'clippathunits',
  'maskunits', 'maskcontentunits', 'filterunits', 'primitiveunits',
  'markerunits', 'in', 'in2', 'result', 'mode', 'type', 'operator',
  'xchannelselector', 'ychannelselector', 'edgemode', 'preservealpha',
  'attributename', 'attributetype', 'calcmode', 'additive', 'accumulate',
  'restart', 'repeatcount', 'repeatdur', 'begin', 'end', 'min', 'max', 'from',
  'to', 'by', 'values', 'orient', 'enable-background', 'requiredfeatures',
  'requiredextensions', 'systemlanguage', 'shape-inside', 'buffered-rendering'
]);

/** CSS properties (inside style="") that are safe and non-typographic. */
const CSS_EXTRA_PROPS = new Set([
  'transform-box', 'will-change', 'cursor', 'user-select', 'touch-action',
  'transition', 'transition-duration', 'transition-property', 'transition-delay',
  'transition-timing-function', 'animation', 'animation-duration',
  'animation-name', 'animation-timing-function', 'animation-iteration-count',
  'animation-fill-mode', 'animation-delay', 'animation-direction', 'transform',
  'transform-origin', 'opacity', 'overflow'
]);

const TYPOGRAPHIC_ATTRS = new Set([
  'text-anchor', 'textlength', 'lengthadjust', 'letter-spacing', 'word-spacing',
  'dominant-baseline', 'alignment-baseline', 'baseline-shift', 'writing-mode',
  'direction', 'unicode-bidi', 'glyph-orientation-horizontal',
  'glyph-orientation-vertical', 'kerning', 'text-decoration', 'text-transform',
  'white-space', 'xml:space', 'aria-label', 'aria-labelledby',
  'aria-describedby', 'aria-roledescription', 'alt', 'title', 'label', 'content',
  'startoffset', 'unicode', 'glyph-name'
]);

const PAINT_KEYWORDS = new Set([
  'none', 'currentcolor', 'transparent', 'inherit', 'initial', 'unset', 'revert',
  'context-fill', 'context-stroke'
]);

const NUM_KEYWORDS = new Set(['none', 'auto', 'inherit', 'initial', 'unset', 'revert', 'indefinite']);

const TRANSFORM_FUNCS = new Set([
  'translate', 'translatex', 'translatey', 'rotate', 'scale', 'scalex',
  'scaley', 'matrix', 'skewx', 'skewy', 'none'
]);

const PATH_COMMANDS = /[MmZzLlHhVvCcSsQqTtAa]/g;

/* A number with an optional CSS/SVG unit suffix. Used to subtract geometry from
 * an attribute value so that only "unexpected" characters remain. */
const NUMBER_UNIT = /[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?(?:px|pt|pc|mm|cm|in|em|ex|rem|ch|vw|vh|%|deg|grad|rad|turn|ms|s)?/g;

function decodeXml(s) {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function trunc(s, n = 48) {
  const flat = String(s).replace(/\s+/g, ' ').trim();
  return flat.length > n ? `${flat.slice(0, n)}...` : flat;
}

function quoteList(list, n = 4) {
  const shown = list.slice(0, n).map((s) => `'${trunc(s, 24)}'`);
  if (list.length > n) shown.push(`(+${list.length - n} more)`);
  return shown.join(', ');
}

function isTypographicName(name) {
  return name.startsWith('font') || TYPOGRAPHIC_ATTRS.has(name);
}

function isNumericValue(value) {
  const t = value.trim();
  if (t === '') return true;
  if (NUM_KEYWORDS.has(t.toLowerCase())) return true;
  const residue = t.replace(NUMBER_UNIT, ' ').replace(/[\s,;]+/g, '');
  return residue === '';
}

function pathResidue(value) {
  const residue = value
    .replace(NUMBER_UNIT, ' ')
    .replace(PATH_COMMANDS, ' ')
    .replace(/[\s,]+/g, '');
  return residue.length > 0 ? residue : null;
}

function pointsResidue(value) {
  const residue = value.replace(NUMBER_UNIT, ' ').replace(/[\s,]+/g, '');
  return residue.length > 0 ? residue : null;
}

function transformResidue(value) {
  const stripped = value.replace(NUMBER_UNIT, ' ');
  const words = stripped.match(/[A-Za-z][A-Za-z0-9-]*/g) || [];
  const bad = words.filter((w) => !TRANSFORM_FUNCS.has(w.toLowerCase()));
  if (bad.length > 0) return bad.join(' ');
  const rest = stripped.replace(/[A-Za-z][A-Za-z0-9-]*/g, ' ').replace(/[\s,()]+/g, '');
  return rest.length > 0 ? rest : null;
}

function isPaintValue(value) {
  let t = value.trim();
  if (t === '') return true;
  const url = t.match(/^url\(\s*['"]?#([A-Za-z0-9_.:-]+)['"]?\s*\)\s*(.*)$/);
  if (url) {
    t = url[2].trim();
    if (t === '') return true;
  }
  const varRef = t.match(/^var\(\s*(--[A-Za-z0-9_-]+)\s*(?:,([\s\S]*))?\)$/);
  if (varRef) {
    const fallback = (varRef[2] || '').trim();
    return fallback === '' || isPaintValue(fallback);
  }
  const lower = t.toLowerCase();
  if (PAINT_KEYWORDS.has(lower)) return true;
  if (/^#[0-9a-fA-F]{3,8}$/.test(t)) return true;
  if (/^(rgb|rgba|hsl|hsla|hwb|lab|lch|oklab|oklch|color)\([^()]*\)$/i.test(t)) return true;
  /* CSS named colours: a single lowercase word, no digits, cannot render text. */
  if (/^[a-z]{3,24}$/.test(lower)) return true;
  return false;
}

function scanStyleText(css, label, problems) {
  if (/@font-face/i.test(css)) problems.push(`${label}: contains an @font-face rule`);
  if (/\bcontent\s*:/i.test(css)) problems.push(`${label}: contains the CSS 'content' property`);
  if (/\bfont[-a-z]*\s*:/i.test(css)) problems.push(`${label}: contains a CSS font property`);
}

function scanStyleAttr(value, label, problems) {
  scanStyleText(value, label, problems);
  for (const decl of value.split(';')) {
    if (decl.trim() === '') continue;
    const idx = decl.indexOf(':');
    if (idx < 0) {
      problems.push(`${label}: malformed style declaration '${trunc(decl)}'`);
      continue;
    }
    const prop = decl.slice(0, idx).trim().toLowerCase();
    const val = decl.slice(idx + 1).trim();
    if (prop === '') continue;
    if (isTypographicName(prop)) {
      problems.push(`${label}: typographic style property '${prop}'`);
      continue;
    }
    if (PAINT_ATTRS.has(prop)) {
      if (!isPaintValue(val)) problems.push(`${label}: unrecognised paint value '${prop}: ${trunc(val)}'`);
      continue;
    }
    if (NUMERIC_ATTRS.has(prop)) {
      if (!isNumericValue(val)) problems.push(`${label}: non-numeric style value '${prop}: ${trunc(val)}'`);
      continue;
    }
    if (TRANSFORM_ATTRS.has(prop)) {
      const bad = transformResidue(val);
      if (bad) problems.push(`${label}: unexpected transform token '${trunc(bad)}' in style '${prop}'`);
      continue;
    }
    if (OPAQUE_ATTRS.has(prop) || CSS_EXTRA_PROPS.has(prop)) continue;
    const hits = val.match(LETTER_OR_DIGIT_RUNS);
    if (hits) {
      problems.push(`${label}: letters/digits in style '${prop}: ${trunc(val)}' -> ${quoteList(hits)}`);
    }
  }
}

function scanAttribute(rawName, rawValue, label, problems) {
  const name = rawName.toLowerCase();
  const value = decodeXml(rawValue);

  if (isTypographicName(name)) {
    problems.push(`${label}: typographic attribute ${rawName}="${trunc(value)}"`);
    return;
  }
  if (name === 'd') {
    const bad = pathResidue(value);
    if (bad) problems.push(`${label}: unexpected characters '${trunc(bad, 24)}' in path data ${rawName}`);
    return;
  }
  if (name === 'points') {
    const bad = pointsResidue(value);
    if (bad) problems.push(`${label}: unexpected characters '${trunc(bad, 24)}' in ${rawName}`);
    return;
  }
  if (TRANSFORM_ATTRS.has(name)) {
    const bad = transformResidue(value);
    if (bad) problems.push(`${label}: unexpected transform token '${trunc(bad, 24)}' in ${rawName}`);
    return;
  }
  if (name === 'viewbox') {
    const bad = pointsResidue(value);
    if (bad) problems.push(`${label}: unexpected characters '${trunc(bad, 24)}' in ${rawName}`);
    return;
  }
  if (NUMERIC_ATTRS.has(name)) {
    if (!isNumericValue(value)) {
      problems.push(`${label}: non-numeric value ${rawName}="${trunc(value)}"`);
    }
    return;
  }
  if (PAINT_ATTRS.has(name)) {
    if (!isPaintValue(value)) {
      problems.push(`${label}: unrecognised paint value ${rawName}="${trunc(value)}"`);
    }
    return;
  }
  if (name === 'style') {
    scanStyleAttr(value, label, problems);
    return;
  }
  if (name === 'href' || name === 'xlink:href') {
    if (!/^#[A-Za-z0-9_.:-]+$/.test(value.trim())) {
      problems.push(`${label}: non-local reference ${rawName}="${trunc(value)}"`);
    }
    return;
  }
  if (OPAQUE_ATTRS.has(name)) return;

  const hits = value.match(LETTER_OR_DIGIT_RUNS);
  if (hits && hits.length > 0) {
    problems.push(
      `${label}: letters/digits in attribute value ${rawName}="${trunc(value)}" -> ${quoteList(hits)}`
    );
  }
}

/**
 * The culture-fairness scan. Rejects any markup that could put a letter, digit
 * or foreign glyph in front of a candidate, in any script.
 */
function scanSvg(svg, label, problems) {
  if (typeof svg !== 'string' || svg.length === 0) {
    problems.push(`${label}: missing or empty svg string`);
    return;
  }
  if (!/^\s*<svg[\s>]/i.test(svg)) {
    problems.push(`${label}: does not start with an <svg> element`);
  }

  const numericEntities = svg.match(/&#[0-9a-fA-FxX]{0,10};?/g);
  if (numericEntities) {
    problems.push(`${label}: numeric character entity ${quoteList(numericEntities)}`);
  }
  const named = [];
  for (const m of svg.matchAll(/&([A-Za-z][A-Za-z0-9]{0,30});/g)) {
    if (!XML_ENTITIES.has(m[1])) named.push(`&${m[1]};`);
  }
  if (named.length > 0) problems.push(`${label}: non-XML entity ${quoteList(named)}`);

  let work = svg;
  if (/<!\[CDATA\[/.test(work)) problems.push(`${label}: contains a CDATA section`);
  work = work.replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, ' ');
  work = work.replace(/<!--[\s\S]*?-->/g, ' ');
  work = work.replace(/<style\b[^>]*>([\s\S]*?)<\/\s*style\s*>/gi, (whole, css) => {
    scanStyleText(css, `${label} <style>`, problems);
    return ' ';
  });

  const seenBad = new Set();
  for (const m of work.matchAll(/<\s*\/?\s*([A-Za-z_][A-Za-z0-9_.:-]*)/g)) {
    const name = m[1].toLowerCase();
    if (FORBIDDEN_ELEMENTS.has(name) && !seenBad.has(name)) {
      seenBad.add(name);
      problems.push(`${label}: forbidden element '<${m[1]}>'`);
    }
  }
  if (svg.includes('<text') && !seenBad.has('text') && !seenBad.has('textpath')) {
    problems.push(`${label}: contains the substring '<text'`);
  }

  const textPieces = [];
  const betweenTags = work.replace(/<[^>]*>/g, '\u0001');
  for (const piece of betweenTags.split('\u0001')) {
    if (LETTER_OR_DIGIT.test(piece)) textPieces.push(piece.trim());
  }
  if (textPieces.length > 0) {
    problems.push(`${label}: renderable text content ${quoteList(textPieces)}`);
  }

  const tags = work.match(/<[^>]*>/g) || [];
  for (const tag of tags) {
    for (const m of tag.matchAll(/([A-Za-z_:][A-Za-z0-9_.:-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
      const value = m[2] !== undefined ? m[2] : (m[3] !== undefined ? m[3] : '');
      scanAttribute(m[1], value, label, problems);
      if (problems.length > MAX_PROBLEMS) return;
    }
  }
}

function checkFrame(problems, label, frame) {
  if (!frame || typeof frame !== 'object') {
    problems.push(`${label}: missing`);
    return;
  }
  scanSvg(frame.svg, `${label}.svg`, problems);
  if (!Number.isFinite(frame.width) || frame.width <= 0) {
    problems.push(`${label}.width: ${String(frame.width)} is not a positive number`);
  }
  if (!Number.isFinite(frame.height) || frame.height <= 0) {
    problems.push(`${label}.height: ${String(frame.height)} is not a positive number`);
  }
}

const META_RANGES = [
  { key: 'ruleCount', lo: 1, hi: 8, integer: true },
  { key: 'abstractness', lo: 1, hi: 4, integer: false },
  { key: 'elementCount', lo: 1, hi: 64, integer: true },
  { key: 'distractorSystematicity', lo: 0, hi: 1, integer: false },
  { key: 'wmLoad', lo: 1, hi: 6, integer: false },
  { key: 'perceptualSalience', lo: 0, hi: 1, integer: false },
  { key: 'generatorVersion', lo: 1, hi: 1000000, integer: true }
];

function checkMeta(problems, item) {
  const meta = item.meta;
  if (!meta || typeof meta !== 'object') {
    problems.push('meta: missing');
    return;
  }
  for (const spec of META_RANGES) {
    const v = meta[spec.key];
    if (v === undefined || v === null) {
      problems.push(`meta.${spec.key}: missing`);
      continue;
    }
    if (!Number.isFinite(v)) {
      problems.push(`meta.${spec.key}: ${String(v)} is not a finite number`);
      continue;
    }
    if (spec.integer && !Number.isInteger(v)) {
      problems.push(`meta.${spec.key}: ${v} must be an integer`);
      continue;
    }
    if (v < spec.lo - EPS || v > spec.hi + EPS) {
      problems.push(`meta.${spec.key}: ${v} outside [${spec.lo}, ${spec.hi}]`);
    }
  }

  if (!Array.isArray(meta.ruleTypes)) {
    problems.push('meta.ruleTypes: missing or not an array');
  } else if (meta.ruleTypes.length === 0) {
    problems.push('meta.ruleTypes: empty');
  } else {
    const bad = meta.ruleTypes.filter((r) => typeof r !== 'string' || r.length === 0);
    if (bad.length > 0) problems.push(`meta.ruleTypes: ${bad.length} entr(y/ies) are not non-empty strings`);
    if (meta.ruleTypes.length > 12) problems.push(`meta.ruleTypes: ${meta.ruleTypes.length} entries is implausible`);
  }

  const oc = meta.optionCount;
  if (oc === undefined || oc === null) {
    problems.push('meta.optionCount: missing');
  } else if (oc !== 6 && oc !== 8) {
    problems.push(`meta.optionCount: ${String(oc)} must be 6 or 8`);
  } else if (Array.isArray(item.options) && item.options.length !== oc) {
    problems.push(`meta.optionCount: ${oc} does not match options.length ${item.options.length}`);
  }
}

function checkIrt(problems, irt) {
  if (!irt || typeof irt !== 'object') {
    problems.push('irt: missing');
    return;
  }
  const { a, b, c } = irt;
  if (!Number.isFinite(a)) problems.push(`irt.a: ${String(a)} is not finite`);
  else if (a < 0.45 - EPS || a > 2.6 + EPS) problems.push(`irt.a: ${a} outside [0.45, 2.60]`);
  if (!Number.isFinite(b)) problems.push(`irt.b: ${String(b)} is not finite`);
  if (!Number.isFinite(c)) problems.push(`irt.c: ${String(c)} is not finite`);
  else if (c <= 0 || c >= 0.3) problems.push(`irt.c: ${c} outside the open interval (0, 0.30)`);
}

/**
 * Full validity + culture-fairness audit of one item.
 * Returns `{ ok, problems }` — `problems` is an array of human-readable strings.
 */
export function auditItem(item) {
  const problems = [];
  if (!item || typeof item !== 'object') {
    return { ok: false, problems: ['item: not an object'] };
  }

  if (typeof item.family !== 'string' || item.family.length === 0) {
    problems.push('family: missing or not a string');
  } else if (!familyByKey(item.family)) {
    problems.push(`family: '${item.family}' is not a registered family`);
  }

  if (typeof item.id !== 'string' || item.id.length === 0) {
    problems.push('id: missing or not a string');
  } else if (typeof item.family === 'string' && item.family.length > 0 &&
    !item.id.startsWith(`${item.family}:`)) {
    problems.push(`id: '${item.id}' does not start with '${item.family}:'`);
  }

  const seedOk = Number.isFinite(item.seed) ||
    (typeof item.seed === 'string' && item.seed.length > 0);
  if (!seedOk) problems.push(`seed: ${String(item.seed)} is missing or unusable`);

  checkFrame(problems, 'prompt', item.prompt);

  if (!Array.isArray(item.options)) {
    problems.push('options: missing or not an array');
  } else {
    const n = item.options.length;
    if (n !== 6 && n !== 8) problems.push(`options: length ${n} must be 6 or 8`);
    const seenIds = new Set();
    const seenSvg = new Map();
    item.options.forEach((opt, i) => {
      const label = `options[${i}]`;
      if (!opt || typeof opt !== 'object') {
        problems.push(`${label}: not an object`);
        return;
      }
      if (typeof opt.id !== 'string' || opt.id.length === 0) {
        problems.push(`${label}.id: missing or not a string`);
      } else if (seenIds.has(opt.id)) {
        problems.push(`${label}.id: duplicate option id '${opt.id}'`);
      } else {
        seenIds.add(opt.id);
      }
      checkFrame(problems, label, opt);
      if (typeof opt.svg === 'string') {
        if (seenSvg.has(opt.svg)) {
          problems.push(`${label}.svg: byte-identical to options[${seenSvg.get(opt.svg)}].svg`);
        } else {
          seenSvg.set(opt.svg, i);
        }
      }
    });

    if (typeof item.answerId !== 'string' || item.answerId.length === 0) {
      problems.push('answerId: missing or not a string');
    } else {
      const matches = item.options.filter((opt) => opt && opt.id === item.answerId).length;
      if (matches === 0) problems.push(`answerId: '${item.answerId}' is not one of the option ids`);
      else if (matches > 1) problems.push(`answerId: '${item.answerId}' matches ${matches} options`);
    }
  }

  checkMeta(problems, item);
  checkIrt(problems, item.irt);

  const capped = problems.length > MAX_PROBLEMS
    ? problems.slice(0, MAX_PROBLEMS).concat([`(+${problems.length - MAX_PROBLEMS} further problems suppressed)`])
    : problems;

  return { ok: problems.length === 0, problems: capped };
}
